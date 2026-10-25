import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, isAbsolute, join, relative, resolve, sep } from "node:path";
import ts from "@typescript/typescript6";
import { discoverServerManifest } from "../framework-server/discovery.js";
import type { ApiEndpoint, RpcEndpoint } from "../framework-server/discovery.js";
import { generateSocketContracts } from "./socket-contracts-generate.js";
import { standardSchemaTypes } from "./standard-schema-types.js";

export interface GeneratedServerContracts {
  readonly types: string;
  readonly manifest: string;
  readonly apiCount: number;
  readonly rpcCount: number;
}

async function writeIfChanged(file: string, source: string): Promise<void> {
  try { if (await readFile(file, "utf8") === source) return; }
  catch (error) { if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error; }
  await writeFile(file, source, "utf8");
}

type Kind = "api" | "rpc";
type Imports = Map<string, { file: string; exported: string }>;

function inside(parent: string, child: string): boolean {
  const path = relative(parent, child);
  return path === "" || (path !== ".." && !path.startsWith(`..${sep}`) && !isAbsolute(path));
}

function optionsFor(root: string): ts.CompilerOptions {
  const config = ts.findConfigFile(root, ts.sys.fileExists, "tsconfig.json");
  if (!config) return { module: ts.ModuleKind.NodeNext, moduleResolution: ts.ModuleResolutionKind.NodeNext, target: ts.ScriptTarget.ES2022, skipLibCheck: true };
  const loaded = ts.readConfigFile(config, ts.sys.readFile);
  if (loaded.error) throw new Error(ts.flattenDiagnosticMessageText(loaded.error.messageText, "\n"));
  return ts.parseJsonConfigFileContent(loaded.config, ts.sys, dirname(config)).options;
}

function resolvedImport(specifier: string, importer: string, options: ts.CompilerOptions): string | undefined {
  return ts.resolveModuleName(specifier, importer, options, ts.sys).resolvedModule?.resolvedFileName;
}

function importMap(file: ts.SourceFile, sharedRoot: string, options: ts.CompilerOptions): Imports {
  const imports: Imports = new Map();
  for (const statement of file.statements) {
    if (!ts.isImportDeclaration(statement) || !ts.isStringLiteral(statement.moduleSpecifier)) continue;
    const specifier = statement.moduleSpecifier.text;
    const target = resolvedImport(specifier, file.fileName, options);
    if (!target || !inside(sharedRoot, target)) continue;
    const clause = statement.importClause;
    if (!clause) continue;
    if (clause.name) imports.set(clause.name.text, { file: target, exported: "default" });
    if (clause.namedBindings && ts.isNamedImports(clause.namedBindings)) {
      for (const element of clause.namedBindings.elements) imports.set(element.name.text, { file: target, exported: element.propertyName?.text ?? element.name.text });
    }
    if (clause.namedBindings && ts.isNamespaceImport(clause.namedBindings)) imports.set(clause.namedBindings.name.text, { file: target, exported: "*" });
  }
  return imports;
}

function objectProperty(object: ts.ObjectLiteralExpression, name: string): ts.Expression | undefined {
  const property = object.properties.find((candidate) => {
    if (!ts.isPropertyAssignment(candidate) && !ts.isShorthandPropertyAssignment(candidate)) return false;
    return candidate.name.getText(object.getSourceFile()).replace(/^['"]|['"]$/g, "") === name;
  });
  if (!property) return undefined;
  if (ts.isPropertyAssignment(property)) return property.initializer;
  return ts.isShorthandPropertyAssignment(property) ? property.name : undefined;
}

function definition(file: ts.SourceFile, kind: Kind): ts.ObjectLiteralExpression {
  const assignment = file.statements.find((statement): statement is ts.ExportAssignment => ts.isExportAssignment(statement) && !statement.isExportEquals);
  const expression = assignment?.expression;
  const name = kind === "api" ? "defineApiRoute" : "defineRpc";
  if (!expression || !ts.isCallExpression(expression) || !ts.isIdentifier(expression.expression) || expression.expression.text !== name || !expression.arguments[0] || !ts.isObjectLiteralExpression(expression.arguments[0])) {
    throw new Error(`${file.fileName}: public ${kind.toUpperCase()} contract requires export default ${name}({...})`);
  }
  return expression.arguments[0];
}

function publicSchema(expression: ts.Expression | undefined, label: string, file: ts.SourceFile, imports: Imports, checker: ts.TypeChecker, root: string, sharedRoot: string, options: ts.CompilerOptions, outputDir: string): string | undefined {
  if (!expression) return undefined;
  let local: string;
  let member: string | undefined;
  if (ts.isIdentifier(expression)) local = expression.text;
  else if (ts.isPropertyAccessExpression(expression) && ts.isIdentifier(expression.expression)) { local = expression.expression.text; member = expression.name.text; }
  else throw new Error(`${file.fileName}: ${label} must reference an imported shared schema`);
  const imported = imports.get(local);
  if (!imported) throw new Error(`${file.fileName}: ${label} must come from shared/`);
  const exported = imported.exported === "*" ? member : imported.exported;
  if (!exported || (imported.exported !== "*" && member)) throw new Error(`${file.fileName}: ${label} must reference one shared export`);
  standardSchemaTypes(expression, checker, () => new Error(`${file.fileName}: ${label} must expose concrete Standard Schema input and output types`));
  validateSharedGraph(imported.file, root, sharedRoot, options, new Set());
  const target = relative(outputDir, imported.file).replaceAll("\\", "/").replace(/\.(?:ts|mts|cts)$/, (suffix) => suffix === ".mts" ? ".mjs" : suffix === ".cts" ? ".cjs" : ".js");
  const specifier = target.startsWith(".") ? target : `./${target}`;
  return `typeof import(${JSON.stringify(specifier)})[${JSON.stringify(exported)}]`;
}

function schemaInputType(expression: ts.Expression, checker: ts.TypeChecker, invalid: () => Error): ts.Type {
  return standardSchemaTypes(expression, checker, invalid).input;
}

function validatePathParams(expression: ts.Expression, pathname: string, checker: ts.TypeChecker, file: ts.SourceFile): void {
  const expected = [...pathname.matchAll(/\[(?:\.\.\.)?([A-Za-z_$][\w$]*)\]/g)].map((match) => match[1]!);
  const invalid = () => new Error(`${file.fileName}: params must contain exactly the route parameters as required URL strings`);
  const inputType = schemaInputType(expression, checker, invalid);
  const stringType = checker.getStringType();
  for (const variant of inputType.isUnion() ? inputType.types : [inputType]) {
    if (variant.flags & (ts.TypeFlags.Any | ts.TypeFlags.Unknown | ts.TypeFlags.Never)
      || checker.getIndexTypeOfType(variant, ts.IndexKind.String)) throw invalid();
    const fields = checker.getPropertiesOfType(variant);
    if (fields.length !== expected.length || fields.some((field) => !expected.includes(field.getName()))) throw invalid();
    for (const name of expected) {
      const field = checker.getPropertyOfType(variant, name);
      if (!field || field.flags & ts.SymbolFlags.Optional) throw invalid();
      const value = checker.getTypeOfSymbolAtLocation(field, expression);
      if (value.flags & (ts.TypeFlags.Any | ts.TypeFlags.Unknown | ts.TypeFlags.Never)
        || !checker.isTypeAssignableTo(value, stringType)) throw invalid();
    }
  }
}

function validateQuery(expression: ts.Expression, checker: ts.TypeChecker, file: ts.SourceFile): void {
  const invalid = () => new Error(`${file.fileName}: query values must be URL strings or arrays of URL strings`);
  const inputType = schemaInputType(expression, checker, invalid);
  const stringType = checker.getStringType();
  const validValue = (value: ts.Type, arrayAllowed: boolean): boolean => {
    if (value.flags & (ts.TypeFlags.Any | ts.TypeFlags.Unknown | ts.TypeFlags.Never)) return false;
    if (value.isUnion()) return value.types.every((part) => validValue(part, arrayAllowed));
    if (value.flags & ts.TypeFlags.Undefined) return true;
    if (checker.isTypeAssignableTo(value, stringType)) return true;
    if (arrayAllowed && (checker.isArrayType(value) || checker.isTupleType(value))) {
      const item = checker.getIndexTypeOfType(value, ts.IndexKind.Number);
      return !!item && validValue(item, false);
    }
    return false;
  };
  for (const variant of inputType.isUnion() ? inputType.types : [inputType]) {
    if (!(variant.flags & (ts.TypeFlags.Object | ts.TypeFlags.Intersection))
      || checker.isArrayType(variant) || checker.isTupleType(variant)) throw invalid();
    for (const field of checker.getPropertiesOfType(variant)) {
      if (!validValue(checker.getTypeOfSymbolAtLocation(field, expression), true)) throw invalid();
    }
    const indexValue = checker.getIndexTypeOfType(variant, ts.IndexKind.String);
    if (indexValue && !validValue(indexValue, true)) throw invalid();
  }
}

function validateSharedGraph(file: string, root: string, sharedRoot: string, options: ts.CompilerOptions, seen: Set<string>): void {
  if (seen.has(file)) return;
  seen.add(file);
  if (!inside(sharedRoot, file)) throw new Error(`${file}: public schema dependency escapes shared/`);
  const source = ts.sys.readFile(file);
  if (source === undefined) throw new Error(`${file}: public schema dependency not found`);
  const ast = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true);
  const checkDependency = (specifier: string): void => {
    const target = resolvedImport(specifier, file, options);
    if (!target) throw new Error(`${file}: unresolved public schema dependency ${specifier}`);
    if (inside(root, target) && !relative(root, target).split(sep).includes("node_modules")) validateSharedGraph(target, root, sharedRoot, options, seen);
  };
  for (const statement of ast.statements) {
    if (!ts.isImportDeclaration(statement) && !ts.isExportDeclaration(statement)) continue;
    const literal = statement.moduleSpecifier;
    if (!literal || !ts.isStringLiteral(literal)) continue;
    checkDependency(literal.text);
  }
  const visit = (node: ts.Node): void => {
    if (ts.isImportTypeNode(node) && ts.isLiteralTypeNode(node.argument) && ts.isStringLiteral(node.argument.literal)) checkDependency(node.argument.literal.text);
    ts.forEachChild(node, visit);
  };
  visit(ast);
}

function shapeFor(endpoint: ApiEndpoint | RpcEndpoint, checker: ts.TypeChecker, program: ts.Program, root: string, options: ts.CompilerOptions, outputDir: string): { type: string; contentType?: "response" } {
  const file = program.getSourceFile(endpoint.file);
  if (!file) throw new Error(`Handler not found: ${endpoint.file}`);
  const sharedRoot = join(root, "shared");
  const imports = importMap(file, sharedRoot, options);
  const kind: Kind = endpoint.kind;
  const contract = definition(file, kind);
  const schema = (name: string): string | undefined => publicSchema(objectProperty(contract, name), name, file, imports, checker, root, sharedRoot, options, outputDir);
  if (kind === "rpc") {
    const input = schema("input");
    const output = schema("output");
    if (!input || !output) throw new Error(`${file.fileName}: RPC requires public input and output schemas`);
    return { type: `import("@meekojs/meeko/framework").RpcOperation<__Input<${input}>, __Output<${output}>>` };
  }
  const params = schema("params");
  if (params && !endpoint.pathname.includes("[")) throw new Error(`${file.fileName}: static API path cannot declare params`);
  if (params) validatePathParams(objectProperty(contract, "params")!, endpoint.pathname, checker, file);
  const query = schema("query");
  if (query) validateQuery(objectProperty(contract, "query")!, checker, file);
  const body = schema("body");
  const response = schema("response");
  const content = objectProperty(contract, "contentType");
  if (content && (!ts.isStringLiteral(content) || (content.text !== "json" && content.text !== "response"))) throw new Error(`${file.fileName}: contentType must be a static json or response literal`);
  const responseType = content && ts.isStringLiteral(content) && content.text === "response";
  if (!responseType && !response) throw new Error(`${file.fileName}: API requires a public response schema`);
  if (endpoint.pathname.includes("[") && !params) throw new Error(`${file.fileName}: dynamic API path requires a public params schema`);
  return {
    type: `import("@meekojs/meeko/framework").ApiOperation<${params ? `__Input<${params}>` : "undefined"}, ${query ? `__Input<${query}>` : "undefined"}, ${body ? `__Input<${body}>` : "undefined"}, ${responseType ? "Response" : `__Output<${response}>`}>`,
    ...(responseType ? { contentType: "response" as const } : {}),
  };
}

/** Generate public API/RPC declarations without importing handler modules. */
export async function generateServerContracts(projectRoot: string): Promise<GeneratedServerContracts> {
  const root = resolve(projectRoot);
  await generateSocketContracts(root);
  const discovered = await discoverServerManifest(root);
  const outputDir = join(root, ".meeko", "types");
  const types = join(outputDir, "server-contracts.d.ts");
  const manifest = join(root, ".meeko", "manifests", "server.json");
  const generatedDir = join(root, ".meeko", "generated");
  const options = optionsFor(root);
  const files = [...discovered.api, ...discovered.rpc].map((entry) => entry.file);
  const program = ts.createProgram(files, { ...options, noEmit: true });
  const checker = program.getTypeChecker();
  const api = discovered.api.map((endpoint) => ({ endpoint, shape: shapeFor(endpoint, checker, program, root, options, outputDir) }));
  const rpc = discovered.rpc.map((endpoint) => ({ endpoint, shape: shapeFor(endpoint, checker, program, root, options, outputDir) }));
  const apiMethods = new Map<string, string[]>();
  for (const { endpoint, shape } of api) {
    const methods = apiMethods.get(endpoint.clientKey) ?? [];
    methods.push(`${endpoint.method.toLowerCase()}: ${shape.type}`);
    apiMethods.set(endpoint.clientKey, methods);
  }
  const lines = [
    "// Generated by Meeko. Public schemas must live in shared/.",
    'type __Input<S> = S extends { readonly "~standard": { readonly types?: infer T } } ? NonNullable<T> extends { readonly input: infer I } ? I : never : never;',
    'type __Output<S> = S extends { readonly "~standard": { readonly types?: infer T } } ? NonNullable<T> extends { readonly output: infer O } ? O : never : never;',
    "export type ApiContract = {",
    ...[...apiMethods].map(([key, methods]) => `  ${JSON.stringify(key)}: { ${methods.join("; ")} };`),
    "};",
    "export type RpcContract = {",
    ...rpc.map(({ endpoint, shape }) => `  ${JSON.stringify(endpoint.id)}: ${shape.type};`),
    "};",
    "",
  ];
  await mkdir(outputDir, { recursive: true });
  await mkdir(dirname(manifest), { recursive: true });
  await writeIfChanged(types, lines.join("\n"));
  const publicManifest = { version: 1, api: api.map(({ endpoint, shape }) => ({ clientKey: endpoint.clientKey, pathname: endpoint.pathname, method: endpoint.method, ...(shape.contentType ? { contentType: shape.contentType } : {}) })), rpc: rpc.map(({ endpoint }) => ({ id: endpoint.id, pathname: endpoint.pathname })) };
  await writeIfChanged(manifest, `${JSON.stringify(publicManifest, null, 2)}\n`);
  await mkdir(generatedDir, { recursive: true });
  const clientSource = (server: boolean): string => [
    "// Generated by Meeko. Contains only public route descriptors and shared contract types.",
    `import { createApiClient, createRpcClient${server ? "" : ", createBrowserClientOptions"} } from "@meekojs/meeko/framework";`,
    'import { createSocketRegistry, useSocketChannel, type SocketRegistryOptions } from "@meekojs/meeko/framework";',
    ...(server ? ['import { createServerClientOptions } from "@meekojs/meeko/server";'] : []),
    'import type { ApiContract, RpcContract } from "../types/server-contracts.js";',
    'import { socketContracts } from "./socket-contracts.js";',
    `const manifest = ${JSON.stringify(publicManifest, null, 2)} as const;`,
    `const options = ${server ? "createServerClientOptions()" : "createBrowserClientOptions()"};`,
    "export const api = createApiClient<ApiContract>(manifest, options);",
    "export const rpc = createRpcClient<RpcContract>(manifest, options);",
    "export const socket = createSocketRegistry(socketContracts);",
    "export const useSocket = <K extends keyof typeof socketContracts & string>(name: K, options?: SocketRegistryOptions) => useSocketChannel(socketContracts, name, options);",
    "",
  ].join("\n");
  await writeIfChanged(join(generatedDir, "clients.client.ts"), clientSource(false));
  await writeIfChanged(join(generatedDir, "clients.server.ts"), clientSource(true));
  return { types, manifest, apiCount: api.length, rpcCount: rpc.length };
}
