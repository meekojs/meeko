import { access, mkdir, readFile, readdir, realpath, unlink, writeFile } from "node:fs/promises";
import { dirname, isAbsolute, join, relative, resolve, sep } from "node:path";
import ts from "@typescript/typescript6";
import { checkSource } from "../check.js";
import { MeekoCompileError } from "../compiler/sfc.js";
import type { CompileDiagnostic } from "../compiler/sfc.js";
import { componentTypeDeclarationMarker, componentTypesPath, generateTypes } from "../types.js";
import { checkAliasScopes, resolveProjectAliases } from "./aliases.js";
import { loadConfiguredModules, resolveConfigSources } from "./config.js";
import { assertRouteBlockPlacement } from "./route-block.js";

const componentTypesManifest = "component-types.json";
const componentTypeSuffix = ".d.meeko.ts";

interface ComponentTypesOwnership {
  readonly version: 1;
  readonly files: readonly string[];
}

function inside(root: string, target: string): boolean {
  const path = relative(root, target);
  return path === "" || (path !== ".." && !path.startsWith(`..${sep}`) && !isAbsolute(path));
}

function ownedTypePath(typesRoot: string, file: string): string | undefined {
  const path = relative(typesRoot, resolve(file));
  if (!path || path === ".." || path.startsWith(`..${sep}`) || isAbsolute(path) || !path.endsWith(componentTypeSuffix)) return undefined;
  return path.replaceAll("\\", "/");
}

async function readTypeOwnership(file: string): Promise<readonly string[] | undefined> {
  let source: string;
  try { source = await readFile(file, "utf8"); }
  catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return undefined;
    throw error;
  }
  let value: unknown;
  try { value = JSON.parse(source) as unknown; }
  catch (error) { throw new Error(`Manifiesto de tipos de componentes de Meeko no válido: ${file}`, { cause: error }); }
  if (!value || typeof value !== "object" || (value as Partial<ComponentTypesOwnership>).version !== 1 ||
      !Array.isArray((value as Partial<ComponentTypesOwnership>).files) ||
      (value as Partial<ComponentTypesOwnership>).files!.some((entry) => typeof entry !== "string" || !entry)) {
    throw new Error(`Manifiesto de tipos de componentes de Meeko no válido: ${file}`);
  }
  return (value as ComponentTypesOwnership).files;
}

function generatedComponentDeclaration(source: string): boolean {
  if (source.startsWith(`${componentTypeDeclarationMarker}\n`) || source.startsWith(`${componentTypeDeclarationMarker}\r\n`)) return true;
  // Releases before the ownership manifest did not preserve a comment marker.
  // Parse their complete generated runtime surface so comments and strings cannot impersonate it.
  const file = ts.createSourceFile("component.d.meeko.ts", source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
  const modifiers = (node: { readonly modifiers?: ts.NodeArray<ts.ModifierLike> }): readonly ts.ModifierLike[] => node.modifiers ?? [];
  const exportedDeclaration = (node: { readonly modifiers?: ts.NodeArray<ts.ModifierLike> }): boolean =>
    modifiers(node).some((modifier) => modifier.kind === ts.SyntaxKind.ExportKeyword) &&
    modifiers(node).some((modifier) => modifier.kind === ts.SyntaxKind.DeclareKeyword);
  const typeName = (node: ts.TypeNode | undefined): string | undefined => {
    if (!node || !ts.isTypeReferenceNode(node)) return undefined;
    if (ts.isIdentifier(node.typeName)) return node.typeName.text;
    return ts.isIdentifier(node.typeName.left) && ts.isIdentifier(node.typeName.right)
      ? `${node.typeName.left.text}.${node.typeName.right.text}` : undefined;
  };
  const generatedFunction = (name: string, expected: readonly (readonly [string, string])[]): boolean =>
    file.statements.some((statement) => ts.isFunctionDeclaration(statement) && statement.name?.text === name &&
      exportedDeclaration(statement) && expected.every(([parameterName, parameterType], index) => {
        const parameter = statement.parameters[index];
        return parameter !== undefined && ts.isIdentifier(parameter.name) && parameter.name.text === parameterName && typeName(parameter.type) === parameterType;
      }));
  const internalImport = file.statements.some((statement) => {
    if (!ts.isImportDeclaration(statement) || !ts.isStringLiteral(statement.moduleSpecifier) ||
        statement.moduleSpecifier.text !== "@meekojs/meeko/internal") return false;
    const bindings = statement.importClause?.namedBindings;
    return bindings !== undefined && ts.isNamespaceImport(bindings) && bindings.name.text === "__meeko";
  });
  const componentProps = file.statements.some((statement) => ts.isTypeAliasDeclaration(statement) &&
    statement.name.text === "ComponentProps" && modifiers(statement).some((modifier) => modifier.kind === ts.SyntaxKind.ExportKeyword));
  const css = file.statements.some((statement) => ts.isVariableStatement(statement) && exportedDeclaration(statement) &&
    statement.declarationList.declarations.some((declaration) => ts.isIdentifier(declaration.name) && declaration.name.text === "css" &&
      declaration.initializer !== undefined && ts.isStringLiteral(declaration.initializer)));
  return internalImport && componentProps && css &&
    generatedFunction("renderWithState", [["__inputProps", "ComponentProps"]]) &&
    generatedFunction("renderToString", [["__inputProps", "ComponentProps"]]) &&
    generatedFunction("hydrate", [["root", "Element"], ["__inputProps", "ComponentProps"]]) &&
    generatedFunction("hydrateScope", [["__scope", "__meeko.DomScope"], ["__inputProps", "ComponentProps"]]);
}

/** Adopts only orphaned declarations with a current marker or the complete legacy generator fingerprint. */
async function adoptGeneratedTypes(projectRoot: string, typesRoot: string): Promise<readonly string[]> {
  const files: string[] = [];
  async function walk(directory: string): Promise<void> {
    for (const entry of await readdir(directory, { withFileTypes: true })) {
      const file = join(directory, entry.name);
      if (entry.isDirectory()) await walk(file);
      else if (entry.isFile() && entry.name.endsWith(componentTypeSuffix) && generatedComponentDeclaration(await readFile(file, "utf8"))) {
        const path = ownedTypePath(typesRoot, file);
        if (!path) continue;
        const source = resolve(projectRoot, `${path.slice(0, -componentTypeSuffix.length)}.meeko`);
        try { await access(source); }
        catch (error) {
          if ((error as NodeJS.ErrnoException).code === "ENOENT") { files.push(path); continue; }
          throw error;
        }
      }
    }
  }
  await walk(typesRoot);
  return files;
}

/** Removes only declarations recorded by a previous successful generation. */
async function reconcileOwnedTypes(projectRoot: string, outputs: readonly string[]): Promise<void> {
  const root = resolve(projectRoot);
  const typesRoot = resolve(root, ".meeko", "types");
  const manifest = resolve(root, ".meeko", "manifests", componentTypesManifest);
  const current = new Set(outputs.map((output) => ownedTypePath(typesRoot, output)).filter((path): path is string => path !== undefined));
  const recorded = await readTypeOwnership(manifest);
  await mkdir(typesRoot, { recursive: true });
  const actualRoot = await realpath(root);
  const actualTypesRoot = await realpath(typesRoot);
  if (!inside(actualRoot, actualTypesRoot)) throw new Error(`La carpeta de tipos de Meeko sale de la raíz del proyecto: ${typesRoot}`);
  const previous = recorded ?? await adoptGeneratedTypes(root, typesRoot);
  for (const path of previous) {
    const target = resolve(typesRoot, path);
    if (path.includes("\\") || ownedTypePath(typesRoot, target) !== path) {
      throw new Error(`Ruta de tipo de componente de Meeko no válida: ${path}`);
    }
    if (current.has(path)) continue;
    let actualTarget: string;
    try { actualTarget = await realpath(target); }
    catch (error) { if ((error as NodeJS.ErrnoException).code === "ENOENT") continue; throw error; }
    if (!inside(actualTypesRoot, actualTarget)) throw new Error(`Un tipo de componente de Meeko sale de la carpeta generada: ${target}`);
    await unlink(target);
  }
  const body = `${JSON.stringify({ version: 1, files: [...current].sort() } satisfies ComponentTypesOwnership, null, 2)}\n`;
  await mkdir(dirname(manifest), { recursive: true });
  try { if (await readFile(manifest, "utf8") === body) return; }
  catch (error) { if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error; }
  await writeFile(manifest, body, "utf8");
}

async function appMeekoFiles(projectRoot: string): Promise<string[]> {
  const root = resolve(projectRoot);
  const files: string[] = [];
  async function walk(directory: string): Promise<void> {
    let entries;
    try { entries = await readdir(directory, { withFileTypes: true }); }
    catch (error) { if ((error as NodeJS.ErrnoException).code === "ENOENT") return; throw error; }
    for (const entry of entries) {
      const path = join(directory, entry.name);
      if (entry.isDirectory()) await walk(path);
      else if (entry.isFile() && entry.name.endsWith(".meeko")) files.push(path);
    }
  }
  const { config, modules } = await loadConfiguredModules(root);
  for (const source of await resolveConfigSources(root, config)) {
    await walk(join(source.root, "app", "pages"));
    await walk(join(source.root, "app", "layouts"));
    await walk(join(source.root, "app", "components"));
    for (const file of [join(source.root, "app", "app.meeko"), join(source.root, "app", "error.meeko")]) {
      try { await readFile(file); files.push(file); }
      catch (error) { if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error; }
    }
  }
  // Components of a module inside the project (not an installed package) are project sources too.
  for (const { dir } of modules.componentsDirs) {
    if (inside(root, dir) && !relative(root, dir).split(sep).includes("node_modules")) await walk(dir);
  }
  // So are the layouts that a module adds, whose props pages and +group.ts files are checked against.
  for (const { file } of modules.layouts) {
    if (inside(root, file) && !relative(root, file).split(sep).includes("node_modules")) files.push(file);
  }
  return [...new Set(files)].sort();
}

/**
 * `MEEK115`: a `+group.ts` that is not in `app/pages` of the project or a layer configures nothing.
 * Only the `app` folder of each source is searched.
 */
async function strayGroupFiles(sourceRoots: readonly string[]): Promise<CompileDiagnostic[]> {
  const diagnostics: CompileDiagnostic[] = [];
  async function walk(directory: string, pages: string): Promise<void> {
    let entries;
    try { entries = await readdir(directory, { withFileTypes: true }); }
    catch (error) { if ((error as NodeJS.ErrnoException).code === "ENOENT") return; throw error; }
    for (const entry of entries) {
      const path = join(directory, entry.name);
      if (entry.isDirectory()) { if (path !== pages && entry.name !== "node_modules") await walk(path, pages); }
      else if (entry.isFile() && entry.name === "+group.ts") {
        diagnostics.push({
          code: "MEEK115",
          message: "+group.ts sólo configura las carpetas de app/pages; aquí no tiene efecto. Muévelo a la carpeta de app/pages cuyas páginas debe configurar.",
          filename: path,
          location: { offset: 0, line: 1, column: 1 },
          severity: "warning",
        });
      }
    }
  }
  for (const root of sourceRoots) await walk(join(root, "app"), join(root, "app", "pages"));
  return diagnostics;
}

/** The TypeScript modules of `app/`, `shared/` and `server/` of each source, without `node_modules` nor declarations. */
async function sourceTypeScriptFiles(sourceRoots: readonly string[]): Promise<string[]> {
  const files: string[] = [];
  async function walk(directory: string): Promise<void> {
    let entries;
    try { entries = await readdir(directory, { withFileTypes: true }); }
    catch (error) { if ((error as NodeJS.ErrnoException).code === "ENOENT") return; throw error; }
    for (const entry of entries) {
      const path = join(directory, entry.name);
      if (entry.isDirectory()) { if (entry.name !== "node_modules" && !entry.name.startsWith(".")) await walk(path); }
      else if (entry.isFile() && /\.[cm]?tsx?$/.test(entry.name) && !/\.d\.[cm]?tsx?$/.test(entry.name)) files.push(path);
    }
  }
  for (const root of sourceRoots) {
    await walk(join(root, "app"));
    await walk(join(root, "shared"));
    // Only its `.client.ts` and `.shared.ts` run outside the server.
    await walk(join(root, "server"));
  }
  return files;
}

/** Checks every discovered application component, including new pages and layouts. */
export async function checkApp(projectRoot: string): Promise<CompileDiagnostic[]> {
  const diagnostics: CompileDiagnostic[] = [];
  const sourceRoots = (await resolveConfigSources(projectRoot)).map((source) => source.root);
  for (const file of await appMeekoFiles(projectRoot)) {
    const source = await readFile(file, "utf8");
    try { assertRouteBlockPlacement(source, file, sourceRoots); }
    catch (error) {
      if (!(error instanceof MeekoCompileError)) throw error;
      diagnostics.push(error.diagnostic);
      continue;
    }
    diagnostics.push(...await checkSource(source, file));
  }
  diagnostics.push(...await strayGroupFiles(sourceRoots));
  // `#server/` in app/ or shared/ and `@/` in shared/: TypeScript alone would only say the module does not exist.
  const aliases = await resolveProjectAliases(projectRoot);
  diagnostics.push(...await checkAliasScopes(aliases, await sourceTypeScriptFiles(sourceRoots), (file) => readFile(file, "utf8")));
  return diagnostics;
}

/** Options of {@link generateAppTypes} for the editor, which checks the project while it is being edited. */
export interface AppTypesOptions {
  /** Text of a `.meeko` that is not the saved one: the editor passes its open documents. */
  readonly read?: (filename: string) => string | undefined;
  /**
   * Receives a component that does not compile instead of failing: the others are still generated
   * and the component keeps its previous declaration. Empty components are skipped silently.
   */
  readonly onError?: (filename: string, error: unknown) => void;
}

/** Mirrors app component declarations into the project's virtual type tree. */
export async function generateAppTypes(projectRoot: string, options: AppTypesOptions = {}): Promise<string[]> {
  const root = resolve(projectRoot);
  const outputs = new Set<string>();
  for (const file of await appMeekoFiles(root)) {
    const source = options.read?.(file) ?? await readFile(file, "utf8");
    if (!options.onError) {
      for (const output of await generateTypes(source, file, options)) outputs.add(output);
      continue;
    }
    // A component being written (new and still empty, or with a syntax error) keeps its last
    // declaration, so the rest of the project is still checked; an empty file is not reported.
    try {
      for (const output of await generateTypes(source, file, options)) outputs.add(output);
    } catch (error) {
      if (source.trim()) options.onError(file, error);
      const previous = componentTypesPath(root, file);
      try { await access(previous); outputs.add(previous); }
      catch { /* Never generated: nothing to keep. */ }
    }
  }
  const generated = [...outputs].sort();
  await reconcileOwnedTypes(root, generated);
  return generated;
}
