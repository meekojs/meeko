import { readFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import ts from "@typescript/typescript6";
import { discoverServerManifest } from "../framework-server/manifest-discovery.js";
import { clientSegment } from "../framework-server/discovery.js";
import type { ApiEndpoint, RpcEndpoint } from "../framework-server/discovery.js";
import { composeFrameworkRoutes } from "../framework/modules.js";
import { discoverConfiguredLayouts, discoverConfiguredRoutes, readMeekoConfigSync, resolveConfigSources } from "../framework/config.js";
import { discoverLayouts } from "../framework/routes-discovery.js";
import type { RouteRecord } from "../framework/router.js";
import { nodeAt } from "./reactivity.js";

/**
 * Pages, API endpoints and RPC procedures of a project, found with the same static discovery that
 * writes `.meeko/manifests`. No route or handler module is executed; in a trusted workspace the
 * Meeko configuration is, as `meeko check` does, to know its layers.
 */
export interface AppIndex {
  readonly routes: readonly RouteRecord[];
  readonly api: readonly ApiEndpoint[];
  readonly rpc: readonly RpcEndpoint[];
  /** Named layouts by name (`app/layouts`, layers and, in a trusted workspace, the modules'). */
  readonly layouts?: Readonly<Record<string, string>>;
}

export const emptyAppIndex: AppIndex = { routes: [], api: [], rpc: [] };

async function layoutsOf(root: string, trusted: boolean): Promise<Readonly<Record<string, string>>> {
  if (trusted) {
    try { return await discoverConfiguredLayouts(root); }
    catch { /* The static reader below still finds those of the project and its layers. */ }
  }
  const result: Record<string, string> = {};
  try {
    for (const source of await resolveConfigSources(root, readMeekoConfigSync(root))) {
      for (const [name, file] of Object.entries(await discoverLayouts(source.root))) if (!Object.hasOwn(result, name)) result[name] = file;
    }
  } catch { /* `meeko check` reports a broken configuration. */ }
  return result;
}

/** The routes of `.meeko/manifests/routes.json`, with absolute files, if discovery fails. */
async function generatedRoutes(root: string): Promise<readonly RouteRecord[]> {
  try {
    const parsed = JSON.parse(await readFile(join(root, ".meeko", "manifests", "routes.json"), "utf8")) as { routes?: RouteRecord[] };
    return (parsed.routes ?? []).map((route) => ({
      ...route,
      file: resolve(root, route.file),
      layouts: route.layouts.map((layout) => resolve(root, layout)),
      ...(route.error ? { error: resolve(root, route.error) } : {}),
      ...(route.sidecar ? { sidecar: resolve(root, route.sidecar) } : {}),
    }));
  } catch { return []; }
}

async function routesOf(root: string, trusted: boolean): Promise<readonly RouteRecord[]> {
  if (trusted) {
    try { return await discoverConfiguredRoutes(root); }
    catch { /* The static reader below reports the same configuration problem. */ }
  }
  try {
    const sources = await resolveConfigSources(root, readMeekoConfigSync(root));
    return await composeFrameworkRoutes({ projectRoot: root, layers: sources.slice(1).map(({ name, root: layer }) => ({ name, root: layer })) });
  } catch { return generatedRoutes(root); }
}

/** Discovers the application index of a project; a failing part is empty. */
export async function loadAppIndex(root: string, trusted: boolean): Promise<AppIndex> {
  const routes = await routesOf(root, trusted);
  let api: readonly ApiEndpoint[] = [];
  let rpc: readonly RpcEndpoint[] = [];
  try { ({ api, rpc } = await discoverServerManifest(root)); }
  catch { /* A collision is reported by `meeko check`; the editor keeps the routes. */ }
  return { routes, api, rpc, layouts: await layoutsOf(root, trusted) };
}

/** Parameters of a route id, such as `id` in `/users/[id]` and `path` in `/docs/[...path]`. */
export function routeParams(id: string): Array<{ name: string; rest: boolean }> {
  return [...id.matchAll(/\[(\.\.\.)?([A-Za-z_$][\w$]*)\]/g)].map((match) => ({ name: match[2]!, rest: Boolean(match[1]) }));
}

/** A schema of a handler contract: its source text and the module it is imported from. */
export interface ContractSchema {
  readonly name: string;
  readonly text: string;
  readonly from?: string;
}

/** What a handler module declares statically, read without executing it. */
export interface HandlerContract {
  readonly schemas: readonly ContractSchema[];
  readonly contentType?: string;
  /** Position of the `handler` member, or of `export default`, in the handler file. */
  readonly offset: number;
  readonly line: number;
  readonly character: number;
}

const apiSchemas = ["params", "query", "body", "response"];
const rpcSchemas = ["input", "output"];

/** Schemas of `export default defineApiRoute({...})` or `defineRpc({...})`. */
export function handlerContract(file: string, kind: "api" | "rpc", text = ts.sys.readFile(file)): HandlerContract | undefined {
  if (text === undefined) return undefined;
  const source = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
  const imports = new Map<string, string>();
  for (const statement of source.statements) {
    if (!ts.isImportDeclaration(statement) || !ts.isStringLiteral(statement.moduleSpecifier) || !statement.importClause) continue;
    const clause = statement.importClause;
    if (clause.name) imports.set(clause.name.text, statement.moduleSpecifier.text);
    const bindings = clause.namedBindings;
    if (bindings && ts.isNamedImports(bindings)) for (const element of bindings.elements) imports.set(element.name.text, statement.moduleSpecifier.text);
    if (bindings && ts.isNamespaceImport(bindings)) imports.set(bindings.name.text, statement.moduleSpecifier.text);
  }
  const assignment = source.statements.find((statement): statement is ts.ExportAssignment => ts.isExportAssignment(statement) && !statement.isExportEquals);
  const at = (offset: number) => ({ offset, ...source.getLineAndCharacterOfPosition(offset) });
  if (!assignment) return { schemas: [], ...at(0) };
  let definition: ts.Expression = assignment.expression;
  while (ts.isCallExpression(definition) && definition.arguments[0]) definition = definition.arguments[0];
  if (!ts.isObjectLiteralExpression(definition)) return { schemas: [], ...at(assignment.getStart(source)) };
  const schemas: ContractSchema[] = [];
  let contentType: string | undefined;
  let offset = assignment.getStart(source);
  for (const property of definition.properties) {
    const name = property.name && (ts.isIdentifier(property.name) || ts.isStringLiteral(property.name)) ? property.name.text : undefined;
    if (!name) continue;
    if (name === "handler") offset = property.getStart(source);
    if (name === "contentType" && ts.isPropertyAssignment(property) && ts.isStringLiteral(property.initializer)) contentType = property.initializer.text;
    if (!(kind === "api" ? apiSchemas : rpcSchemas).includes(name)) continue;
    const value = ts.isPropertyAssignment(property) ? property.initializer : ts.isShorthandPropertyAssignment(property) ? property.name : undefined;
    if (!value) continue;
    let root: ts.Expression = value;
    while (ts.isPropertyAccessExpression(root)) root = root.expression;
    const from = ts.isIdentifier(root) ? imports.get(root.text) : undefined;
    const valueText = value.getText(source).replace(/\s+/g, " ");
    schemas.push({ name, text: valueText.length > 80 ? `${valueText.slice(0, 77)}...` : valueText, ...(from ? { from } : {}) });
  }
  return { schemas, ...(contentType ? { contentType } : {}), ...at(offset) };
}

/** A route, API endpoint or RPC procedure named at a position of the virtual code. */
export type AppTarget =
  | { readonly kind: "route"; readonly id: string; readonly route?: RouteRecord; readonly node: ts.Node }
  | { readonly kind: "api"; readonly label: string; readonly endpoints: readonly ApiEndpoint[]; readonly node: ts.Node }
  | { readonly kind: "rpc"; readonly id: string; readonly endpoint?: RpcEndpoint; readonly node: ts.Node }
  | { readonly kind: "layout"; readonly name: string; readonly file?: string; readonly node: ts.Node };

const apiMethods = new Set(["get", "post", "put", "patch", "delete"]);

function stringArgument(call: ts.CallExpression, node: ts.Node): ts.StringLiteralLike | undefined {
  return call.arguments.find((argument): argument is ts.StringLiteralLike => argument === node && ts.isStringLiteralLike(argument));
}

/** The client of `.meeko/generated/clients` (or its autoimport), not a local variable of the same name. */
function generatedClient(identifier: ts.Identifier, checker: ts.TypeChecker): boolean {
  const symbol = checker.getSymbolAtLocation(identifier);
  if (!symbol) return true;
  return (symbol.declarations ?? []).every((declaration) => ts.isImportSpecifier(declaration) || ts.isImportClause(declaration)
    || ts.isNamespaceImport(declaration) || declaration.getSourceFile().fileName.replaceAll("\\", "/").includes("/.meeko/generated/"));
}

/**
 * The parameter of a segment call such as `api.notes({ id })`: the only property of its only
 * argument. A call of an HTTP method (`api.notes.get({ query })`) is never a segment call.
 */
function segmentParam(call: ts.CallExpression, checker: ts.TypeChecker): string | undefined {
  const callee = call.expression;
  if (call.arguments.length !== 1 || (ts.isPropertyAccessExpression(callee) && apiMethods.has(callee.name.text))) return undefined;
  const argument = call.arguments[0]!;
  if (ts.isObjectLiteralExpression(argument)) {
    const [property] = argument.properties;
    if (argument.properties.length !== 1 || !property || (!ts.isPropertyAssignment(property) && !ts.isShorthandPropertyAssignment(property))) return undefined;
    return ts.isIdentifier(property.name) || ts.isStringLiteral(property.name) ? property.name.text : undefined;
  }
  const properties = checker.getTypeAtLocation(argument).getProperties();
  return properties.length === 1 ? properties[0]!.name : undefined;
}

/**
 * `api.notes.byId.get` or `api.notes({ id }).get`: the whole member chain around `node`, from the
 * client to its last name, with the client segment of each segment call when `calls` is set.
 */
function memberChain(node: ts.Identifier, checker: ts.TypeChecker, calls: boolean): { chain: ts.Expression; names: string[]; labels: string[]; root: ts.Expression } {
  let chain: ts.Expression = node;
  if (ts.isPropertyAccessExpression(node.parent) && node.parent.name === node) chain = node.parent;
  for (;;) {
    const parent: ts.Node = chain.parent;
    if (ts.isPropertyAccessExpression(parent) && parent.expression === chain) chain = parent;
    else if (calls && ts.isCallExpression(parent) && parent.expression === chain && ts.isPropertyAccessExpression(parent.parent)
      && parent.parent.expression === parent && segmentParam(parent, checker) !== undefined) chain = parent.parent;
    else break;
  }
  const names: string[] = [];
  const labels: string[] = [];
  let root: ts.Expression = chain;
  for (;;) {
    if (ts.isPropertyAccessExpression(root)) {
      names.unshift(root.name.text);
      labels.unshift(`.${root.name.text}`);
      root = root.expression;
      continue;
    }
    const param = calls && ts.isCallExpression(root) ? segmentParam(root, checker) : undefined;
    if (param === undefined || !ts.isCallExpression(root)) break;
    names.unshift(clientSegment(param));
    labels.unshift(`({ ${param} })`);
    root = root.expression;
  }
  return { chain, names, labels, root };
}

/**
 * The route of `href("/users/[id]")`, the endpoint of `useApi("/api/notes")`,
 * `useApiMutation("/api/notes", "POST")` and `api.notes.get`, or the procedure of
 * `useRpcQuery("users.get")`, `useRpcMutation(...)` and `rpc.users.get`.
 */
export function appTargetAt(program: ts.Program, fileName: string, offset: number, index: AppIndex): AppTarget | undefined {
  const file = program.getSourceFile(fileName);
  const node = file && nodeAt(file, offset);
  if (!file || !node) return undefined;
  const checker = program.getTypeChecker();
  // `to="/users/[id]"` of a `<MeekoLink>`, which the editor checks as `__meeko_builtin_MeekoLink({ to: "…" })`.
  const property = ts.isStringLiteralLike(node) && ts.isPropertyAssignment(node.parent) && node.parent.initializer === node ? node.parent : undefined;
  const link = property && ts.isIdentifier(property.name) && property.name.text === "to" && ts.isObjectLiteralExpression(property.parent)
    && ts.isCallExpression(property.parent.parent) && ts.isIdentifier(property.parent.parent.expression) && property.parent.parent.expression.text === "__meeko_builtin_MeekoLink";
  if (link && ts.isStringLiteralLike(node)) {
    const route = index.routes.find((candidate) => candidate.id === node.text);
    return { kind: "route", id: node.text, ...(route ? { route } : {}), node };
  }
  // `layout: "dashboard"` of `definePage({ ... })` or `defineGroup({ ... })`.
  const options = property && ts.isIdentifier(property.name) && property.name.text === "layout" && ts.isObjectLiteralExpression(property.parent)
    ? property.parent.parent : undefined;
  if (options && ts.isCallExpression(options) && ts.isIdentifier(options.expression)
    && (options.expression.text === "definePage" || options.expression.text === "defineGroup") && ts.isStringLiteralLike(node)) {
    const file = index.layouts?.[node.text];
    return { kind: "layout", name: node.text, ...(file ? { file } : {}), node };
  }
  if (ts.isStringLiteralLike(node) && ts.isCallExpression(node.parent)) {
    const call = node.parent;
    const callee = ts.isIdentifier(call.expression) ? call.expression.text : undefined;
    const argument = stringArgument(call, node);
    if (!argument) return undefined;
    const position = call.arguments.indexOf(argument);
    const first = call.arguments[0];
    // `__meeko_href` is the href() that `<MeekoLink to="…">` compiles to.
    if ((callee === "href" || callee === "__meeko_href") && (position === 0 || (position === 1 && first && !ts.isStringLiteralLike(first)))) {
      const route = index.routes.find((candidate) => candidate.id === argument.text);
      return { kind: "route", id: argument.text, ...(route ? { route } : {}), node: argument };
    }
    if (callee === "useApi" && position === 0) {
      return { kind: "api", label: argument.text, endpoints: index.api.filter((endpoint) => endpoint.pathname === argument.text && endpoint.method === "GET"), node: argument };
    }
    if (callee === "useApiMutation" && position === 0) {
      const method = call.arguments[1];
      const verb = method && ts.isStringLiteralLike(method) ? method.text.toUpperCase() : undefined;
      return { kind: "api", label: argument.text, endpoints: index.api.filter((endpoint) => endpoint.pathname === argument.text && endpoint.method !== "GET" && (!verb || endpoint.method === verb)), node: argument };
    }
    if ((callee === "useRpcQuery" || callee === "useRpcMutation") && position === 0) {
      const endpoint = index.rpc.find((candidate) => candidate.id === argument.text);
      return { kind: "rpc", id: argument.text, ...(endpoint ? { endpoint } : {}), node: argument };
    }
    return undefined;
  }
  if (!ts.isIdentifier(node)) return undefined;
  // Only `api` has segment calls; `rpc.users.find({ id }).then` stays a plain member chain.
  let member = memberChain(node, checker, true);
  if (!ts.isIdentifier(member.root) || member.root.text !== "api") member = memberChain(node, checker, false);
  const { chain, names, labels, root } = member;
  if (!ts.isIdentifier(root) || !names.length) return undefined;
  if (root.text === "api" && generatedClient(root, checker)) {
    const method = names.at(-1)!;
    const key = apiMethods.has(method) ? names.slice(0, -1).join(".") : names.join(".");
    const endpoints = index.api.filter((endpoint) => endpoint.clientKey === key && (!apiMethods.has(method) || endpoint.method.toLowerCase() === method));
    return endpoints.length ? { kind: "api", label: `api${labels.join("")}`, endpoints, node: chain } : undefined;
  }
  if (root.text === "rpc" && generatedClient(root, checker)) {
    const id = names.join(".");
    const endpoint = index.rpc.find((candidate) => candidate.id === id);
    return endpoint ? { kind: "rpc", id, endpoint, node: chain } : undefined;
  }
  return undefined;
}
