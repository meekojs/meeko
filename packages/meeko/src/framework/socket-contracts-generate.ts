import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, isAbsolute, join, relative, resolve, sep } from "node:path";
import ts from "@typescript/typescript6";
import { discoverAutoImports } from "../autoimports.js";
import { autoImportCompilerHost, autoImportSourceReader } from "../autoimports-ts.js";
import { resolveProjectAliases, withAliasPaths } from "./aliases.js";
import { resolveConfigSources } from "./config.js";
import { discoverServerManifest } from "../framework-server/manifest-discovery.js";
import { standardSchemaTypes } from "./standard-schema-types.js";

/** An import of a channel file; its specifier resolves only when a schema uses it. */
interface ImportedSymbol { specifier: string; exported: string; }
interface SchemaReference { file: string; exported: string; }
type ReadSource = (file: string) => string | undefined;

function inside(parent: string, child: string): boolean {
  const path = relative(parent, child);
  return path === "" || (path !== ".." && !path.startsWith(`..${sep}`) && !isAbsolute(path));
}

function compilerOptions(root: string): ts.CompilerOptions {
  const config = ts.findConfigFile(root, ts.sys.fileExists, "tsconfig.json");
  if (!config) return { module: ts.ModuleKind.ESNext, moduleResolution: ts.ModuleResolutionKind.Bundler };
  const loaded = ts.readConfigFile(config, ts.sys.readFile);
  if (loaded.error) throw new Error(ts.flattenDiagnosticMessageText(loaded.error.messageText, "\n"));
  return ts.parseJsonConfigFileContent(loaded.config, ts.sys, dirname(config)).options;
}

function resolveImport(specifier: string, importer: string, options: ts.CompilerOptions): string {
  const target = ts.resolveModuleName(specifier, importer, options, ts.sys).resolvedModule?.resolvedFileName;
  if (!target) throw new Error(`${importer}: no se puede resolver el import ${specifier}`);
  return target;
}

function validateSharedGraph(file: string, root: string, shared: string, options: ts.CompilerOptions, seen: Set<string>, read: ReadSource): void {
  if (seen.has(file)) return;
  seen.add(file);
  if (!inside(shared, file)) throw new Error(`${file}: un schema público de Socket debe quedarse dentro de shared/`);
  // Autoimported dependencies appear as the imports that the Vite transform adds.
  const source = read(file);
  if (source === undefined) throw new Error(`${file}: no se encuentra el archivo del schema de Socket`);
  const ast = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true);
  const check = (specifier: string): void => {
    const target = resolveImport(specifier, file, options);
    if (inside(root, target) && !relative(root, target).split(sep).includes("node_modules")) validateSharedGraph(target, root, shared, options, seen, read);
  };
  for (const statement of ast.statements) {
    if ((ts.isImportDeclaration(statement) || ts.isExportDeclaration(statement)) && statement.moduleSpecifier && ts.isStringLiteral(statement.moduleSpecifier)) check(statement.moduleSpecifier.text);
  }
  const visit = (node: ts.Node): void => {
    if (ts.isImportTypeNode(node) && ts.isLiteralTypeNode(node.argument) && ts.isStringLiteral(node.argument.literal)) check(node.argument.literal.text);
    ts.forEachChild(node, visit);
  };
  visit(ast);
}

function property(object: ts.ObjectLiteralExpression, name: string): ts.Expression | undefined {
  const entry = object.properties.find((candidate) => (ts.isPropertyAssignment(candidate) || ts.isShorthandPropertyAssignment(candidate)) && candidate.name && (ts.isIdentifier(candidate.name) || ts.isStringLiteral(candidate.name)) && candidate.name.text === name);
  if (!entry) return undefined;
  return ts.isPropertyAssignment(entry) ? entry.initializer : ts.isShorthandPropertyAssignment(entry) ? entry.name : undefined;
}

function publicSchemas(file: string, root: string, options: ts.CompilerOptions, program: ts.Program, checker: ts.TypeChecker, read: ReadSource): { clientToServer: Record<string, SchemaReference>; serverToClient: Record<string, SchemaReference> } {
  const ast = program.getSourceFile(file);
  if (!ast) throw new Error(`${file}: no se encuentra el archivo del canal Socket`);
  const imports = new Map<string, ImportedSymbol>();
  for (const statement of ast.statements) {
    if (!ts.isImportDeclaration(statement) || !ts.isStringLiteral(statement.moduleSpecifier)) continue;
    const clause = statement.importClause;
    if (!clause || clause.isTypeOnly) continue;
    // Resolved on use: an import that names no schema, such as the autoimported defineSocketChannel
    // from @meekojs/meeko/server, need not resolve.
    const specifier = statement.moduleSpecifier.text;
    if (clause.name) imports.set(clause.name.text, { specifier, exported: "default" });
    if (clause.namedBindings && ts.isNamedImports(clause.namedBindings)) {
      for (const element of clause.namedBindings.elements) {
        if (!element.isTypeOnly) imports.set(element.name.text, { specifier, exported: element.propertyName?.text ?? element.name.text });
      }
    }
    if (clause.namedBindings && ts.isNamespaceImport(clause.namedBindings)) imports.set(clause.namedBindings.name.text, { specifier, exported: "*" });
  }
  const assignment = ast.statements.find((statement): statement is ts.ExportAssignment => ts.isExportAssignment(statement) && !statement.isExportEquals);
  const call = assignment?.expression;
  if (!call || !ts.isCallExpression(call) || !ts.isIdentifier(call.expression) || call.expression.text !== "defineSocketChannel" || !call.arguments[0] || !ts.isObjectLiteralExpression(call.arguments[0])) {
    throw new Error(`${file}: el contrato público de Socket requiere export default defineSocketChannel({...})`);
  }
  const shared = join(root, "shared");
  const seen = new Set<string>();
  const direction = (name: "clientToServer" | "serverToClient"): Record<string, SchemaReference> => {
    const object = property(call.arguments[0] as ts.ObjectLiteralExpression, name);
    if (!object || !ts.isObjectLiteralExpression(object)) throw new Error(`${file}: ${name} debe ser un objeto estático`);
    const result: Record<string, SchemaReference> = Object.create(null);
    for (const entry of object.properties) {
      // `{ kitchenChanged }` names the event after the imported schema, like `{ kitchenChanged: kitchenChanged }`.
      const named = (ts.isPropertyAssignment(entry) && (ts.isIdentifier(entry.name) || ts.isStringLiteral(entry.name))) || ts.isShorthandPropertyAssignment(entry);
      if (!named) throw new Error(`${file}: ${name} sólo admite propiedades con nombre que referencien un schema, como \`evento: schema\` o la forma abreviada \`schema\``);
      const event = (entry.name as ts.Identifier | ts.StringLiteral).text;
      const value: ts.Expression = ts.isPropertyAssignment(entry) ? entry.initializer : entry.name;
      let local: string;
      let member: string | undefined;
      if (ts.isIdentifier(value)) local = value.text;
      else if (ts.isPropertyAccessExpression(value) && ts.isIdentifier(value.expression)) { local = value.expression.text; member = value.name.text; }
      else throw new Error(`${file}: ${name}.${event} debe referenciar un schema importado de shared/`);
      const imported = imports.get(local);
      const importedFile = imported && resolveImport(imported.specifier, file, options);
      if (!imported || !importedFile || !inside(shared, importedFile)) throw new Error(`${file}: ${name}.${event} debe venir de shared/`);
      const exported = imported.exported === "*" ? member : imported.exported;
      if (!exported || (member && imported.exported !== "*")) throw new Error(`${file}: ${name}.${event} debe referenciar un único export de shared/`);
      standardSchemaTypes(value, checker, () => new Error(`${file}: ${name}.${event} debe exponer tipos de entrada y salida de Standard Schema concretos`));
      validateSharedGraph(importedFile, root, shared, options, seen, read);
      if (result[event]) throw new Error(`${file}: el evento de Socket ${name}.${event} está repetido`);
      result[event] = { file: importedFile, exported };
    }
    return result;
  };
  return { clientToServer: direction("clientToServer"), serverToClient: direction("serverToClient") };
}

/** Emits browser-safe, inferred Socket contracts from server channel definitions. */
export async function generateSocketContracts(projectRoot: string): Promise<{ file: string; count: number }> {
  const root = resolve(projectRoot);
  const manifest = await discoverServerManifest(root);
  const output = join(root, ".meeko", "generated", "socket-contracts.ts");
  // A schema imported through an alias (`#shared/schemas/chat`) resolves to its file, as in Vite.
  const options = withAliasPaths(compilerOptions(root), await resolveProjectAliases(root), "server");
  const files = (manifest.socket ?? []).map((endpoint) => endpoint.file);
  // Channels and shared schemas are read as Vite runs them, so an autoimported schema
  // resolves to its shared/ file instead of an unknown global.
  const read = files.length > 0
    ? autoImportSourceReader(root, await discoverAutoImports(root), (await resolveConfigSources(root)).map((source) => source.root))
    : (file: string) => ts.sys.readFile(file);
  const programOptions = { ...options, noEmit: true };
  const program = ts.createProgram({ rootNames: files, options: programOptions, host: autoImportCompilerHost(programOptions, read) });
  const checker = program.getTypeChecker();
  const channels = (manifest.socket ?? []).map((endpoint) => ({ name: endpoint.name, schemas: publicSchemas(endpoint.file, root, options, program, checker, read) }));
  const sources = [...new Set(channels.flatMap(({ schemas }) => [...Object.values(schemas.clientToServer), ...Object.values(schemas.serverToClient)].map((entry) => entry.file)))].sort();
  const aliases = new Map(sources.map((file, index) => [file, `__schema${index}`]));
  const lines = sources.map((file) => {
    const target = relative(dirname(output), file).replaceAll("\\", "/").replace(/\.(?:ts|mts|cts)$/, (suffix) => suffix === ".mts" ? ".mjs" : suffix === ".cts" ? ".cjs" : ".js");
    return `import * as ${aliases.get(file)} from ${JSON.stringify(target.startsWith(".") ? target : `./${target}`)};`;
  });
  lines.push("export const socketContracts = {");
  for (const channel of channels) {
    lines.push(`  ${JSON.stringify(channel.name)}: {`);
    for (const direction of ["clientToServer", "serverToClient"] as const) {
      lines.push(`    ${direction}: {`);
      for (const [event, schema] of Object.entries(channel.schemas[direction])) lines.push(`      ${JSON.stringify(event)}: ${aliases.get(schema.file)}[${JSON.stringify(schema.exported)}],`);
      lines.push("    },");
    }
    lines.push("  },");
  }
  lines.push("} as const;", "");
  const code = lines.join("\n");
  let previous: string | undefined;
  try { previous = await readFile(output, "utf8"); } catch { /* First generation. */ }
  if (previous !== code) { await mkdir(dirname(output), { recursive: true }); await writeFile(output, code); }
  return { file: output, count: channels.length };
}
