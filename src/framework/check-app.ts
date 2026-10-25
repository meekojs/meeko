import { access, mkdir, readFile, readdir, realpath, unlink, writeFile } from "node:fs/promises";
import { dirname, isAbsolute, join, relative, resolve, sep } from "node:path";
import ts from "@typescript/typescript6";
import { checkSource } from "../check.js";
import type { CompileDiagnostic } from "../compiler/sfc.js";
import { componentTypeDeclarationMarker, generateTypes } from "../types.js";
import { resolveConfigSources } from "./config.js";

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
  catch (error) { throw new Error(`Invalid Meeko component type ownership manifest: ${file}`, { cause: error }); }
  if (!value || typeof value !== "object" || (value as Partial<ComponentTypesOwnership>).version !== 1 ||
      !Array.isArray((value as Partial<ComponentTypesOwnership>).files) ||
      (value as Partial<ComponentTypesOwnership>).files!.some((entry) => typeof entry !== "string" || !entry)) {
    throw new Error(`Invalid Meeko component type ownership manifest: ${file}`);
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
  if (!inside(actualRoot, actualTypesRoot)) throw new Error(`Meeko type directory escapes project root: ${typesRoot}`);
  const previous = recorded ?? await adoptGeneratedTypes(root, typesRoot);
  for (const path of previous) {
    const target = resolve(typesRoot, path);
    if (path.includes("\\") || ownedTypePath(typesRoot, target) !== path) {
      throw new Error(`Invalid owned Meeko component type path: ${path}`);
    }
    if (current.has(path)) continue;
    let actualTarget: string;
    try { actualTarget = await realpath(target); }
    catch (error) { if ((error as NodeJS.ErrnoException).code === "ENOENT") continue; throw error; }
    if (!inside(actualTypesRoot, actualTarget)) throw new Error(`Owned Meeko component type escapes generated directory: ${target}`);
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
  for (const source of await resolveConfigSources(root)) {
    await walk(join(source.root, "app", "pages"));
    await walk(join(source.root, "app", "layouts"));
    await walk(join(source.root, "app", "components"));
    for (const file of [join(source.root, "app", "app.meeko"), join(source.root, "app", "error.meeko")]) {
      try { await readFile(file); files.push(file); }
      catch (error) { if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error; }
    }
  }
  return files.sort();
}

/** Checks every discovered application component, including new pages and layouts. */
export async function checkApp(projectRoot: string): Promise<CompileDiagnostic[]> {
  const diagnostics: CompileDiagnostic[] = [];
  for (const file of await appMeekoFiles(projectRoot)) diagnostics.push(...await checkSource(await readFile(file, "utf8"), file));
  return diagnostics;
}

/** Mirrors app component declarations into the project's virtual type tree. */
export async function generateAppTypes(projectRoot: string): Promise<string[]> {
  const root = resolve(projectRoot);
  const outputs = new Set<string>();
  for (const file of await appMeekoFiles(root)) {
    for (const output of await generateTypes(await readFile(file, "utf8"), file)) outputs.add(output);
  }
  const generated = [...outputs].sort();
  await reconcileOwnedTypes(root, generated);
  return generated;
}
