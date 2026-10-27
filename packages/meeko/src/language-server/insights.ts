import { pathToFileURL } from "node:url";
import ts from "@typescript/typescript6";
import type { Location } from "vscode-languageserver/node";
import { appTargetAt, handlerContract, routeParams } from "./app-index.js";
import type { AppTarget } from "./app-index.js";
import { componentSummary, componentSummaryMarkdown } from "./components.js";
import type { FeatureContext } from "./features.js";
import { projectPath } from "./lenses.js";
import type { VirtualComponent } from "./model.js";
import { analyzeReactivity, crossing, nodeAt, reactiveDeclarationAt } from "./reactivity.js";
import type { ReactiveAccess, ReactiveDeclaration } from "./reactivity.js";

/** A Markdown section that the hover appends to TypeScript's quick info. */
export interface HoverSection {
  readonly markdown: string;
  /** Source range of the hovered name, if TypeScript gives none. */
  readonly range?: readonly [number, number];
}

/** Link to a position of a file; VS Code opens `#L<line>,<column>` at that position. */
export function positionLink(uri: string, line: number, character: number): string {
  return `${uri}#L${line + 1},${character + 1}`;
}

function fileUri(context: FeatureContext, file: string): string {
  return context.locate(file)?.uri ?? pathToFileURL(file).href;
}

const maximumListed = 8;

function accessList(context: FeatureContext, accesses: readonly ReactiveAccess[]): string[] {
  const { document } = context;
  const lines = accesses.slice(0, maximumListed).map((access) => {
    const position = document.positionAt(access.start);
    // `where` names code (`computed`, `on:click`, `setup`); only the words around it are translated.
    const where = access.template ? `plantilla \`${access.where}\`` : access.where.replace(/^function\b/, "función");
    return `- [línea ${position.line + 1}](${positionLink(document.uri, position.line, position.character)}) ${where}`;
  });
  if (accesses.length > maximumListed) lines.push(`- … y ${accesses.length - maximumListed} más`);
  return lines;
}

/** Spanish name of a reactive declaration family. */
const kindNames: Readonly<Record<ReactiveDeclaration["kind"], string>> = {
  signal: "señal",
  computed: "valor derivado",
  resource: "recurso",
};

/** Summary of a reactive declaration: its type, where it is read and written and whether it crosses to the client. */
export function reactiveMarkdown(context: FeatureContext, declaration: ReactiveDeclaration): string {
  const reads = declaration.accesses.filter((access) => access.read);
  const writes = declaration.accesses.filter((access) => access.write);
  const origin = declaration.origin === "composable" ? "" : ` de \`${declaration.origin}\``;
  return [
    `**${kindNames[declaration.kind]}** \`${declaration.name}\`${origin}: \`${declaration.type}\``,
    "",
    `**Lecturas (${reads.length})**${reads.length ? "" : ": ninguna"}`,
    ...accessList(context, reads),
    "",
    `**Escrituras (${writes.length})**${writes.length ? "" : ": ninguna"}`,
    ...accessList(context, writes),
    "",
    crossing(declaration),
  ].join("\n");
}

/** Reactive summary of the declaration at a source offset of the component's script or template. */
export function reactiveHover(context: FeatureContext, sourceOffset: number): HoverSection | undefined {
  const analysis = analyzeReactivity(context.project.service, context.component);
  const declaration = reactiveDeclarationAt(analysis, sourceOffset);
  return declaration ? { markdown: reactiveMarkdown(context, declaration) } : undefined;
}

/**
 * The component behind a `X.d.meeko.ts` declaration that `meeko types` writes, next to it or under
 * `.meeko/types`: TypeScript (NodeNext or Bundler resolution) resolves `./X.meeko` to it.
 */
function generatedDeclarationOwner(context: FeatureContext, fileName: string): VirtualComponent | undefined {
  if (!fileName.endsWith(".d.meeko.ts")) return undefined;
  const sibling = `${fileName.slice(0, -".d.meeko.ts".length)}.meeko`;
  const types = `${context.project.root.replaceAll("\\", "/")}/.meeko/types/`;
  const normalized = sibling.replaceAll("\\", "/");
  const source = normalized.toLowerCase().startsWith(types.toLowerCase())
    ? `${context.project.root}/${normalized.slice(types.length)}`
    : sibling;
  return context.project.component(source);
}

/** The `.meeko` module that an identifier names, such as `AppButton` of `import * as AppButton`. */
export function componentModuleAt(context: FeatureContext, generatedOffset: number): { component: VirtualComponent; node: ts.Identifier } | undefined {
  const program = context.project.service.getProgram();
  const file = program?.getSourceFile(context.component.virtualFilename);
  const node = file && nodeAt(file, generatedOffset);
  if (!program || !node || !ts.isIdentifier(node)) return undefined;
  const checker = program.getTypeChecker();
  let symbol = checker.getSymbolAtLocation(node);
  if (symbol && symbol.flags & ts.SymbolFlags.Alias) symbol = checker.getAliasedSymbol(symbol);
  const declaration = symbol?.declarations?.[0];
  if (!declaration || !ts.isSourceFile(declaration)) return undefined;
  const component = context.project.virtualEntry(declaration.fileName) ?? generatedDeclarationOwner(context, declaration.fileName);
  return component && component.filename.endsWith(".meeko") && component !== context.component ? { component, node } : undefined;
}

/** Props, events, models, snippets and exposed members of a child component. */
export function componentMarkdown(context: FeatureContext, child: VirtualComponent): string | undefined {
  const program = context.project.service.getProgram();
  const summary = program && componentSummary(program, child);
  return summary ? componentSummaryMarkdown(summary).join("\n\n") : undefined;
}

function nodeRange(context: FeatureContext, node: ts.Node): readonly [number, number] | undefined {
  const file = node.getSourceFile();
  const start = context.component.toSource(node.getStart(file));
  return start === undefined ? undefined : [start, start + node.getWidth(file)];
}

function schemaLines(schemas: ReturnType<typeof handlerContract>): string[] {
  return (schemas?.schemas ?? []).map((schema) => `- ${schema.name}: \`${schema.text}\`${schema.from ? ` de \`${schema.from}\`` : ""}`);
}

function targetMarkdown(context: FeatureContext, target: AppTarget): string {
  const root = context.project.root;
  if (target.kind === "route") {
    if (!target.route) return `**Ruta** \`${target.id}\` no es una página de este proyecto.`;
    const route = target.route;
    const params = routeParams(target.id);
    return [
      `**Ruta** \`${target.id}\` → [${projectPath(root, route.file)}](${fileUri(context, route.file)})`,
      "",
      `- params: ${params.length ? `\`{ ${params.map((param) => `${param.name}: string`).join("; ")} }\`` : "ninguno"}`,
      `- render: ${route.render ?? "ssr"}`,
      `- layouts: ${route.layouts.length ? route.layouts.map((layout) => projectPath(root, layout)).join(" › ") : "ninguno"}`,
    ].join("\n");
  }
  if (target.kind === "api") {
    if (!target.endpoints.length) return `**API** \`${target.label}\` no tiene un handler GET en \`server/api\`.`;
    return target.endpoints.map((endpoint) => {
      const contract = handlerContract(endpoint.file, "api");
      const link = contract ? positionLink(fileUri(context, endpoint.file), contract.line, contract.character) : fileUri(context, endpoint.file);
      return [
        `**${endpoint.method}** \`${endpoint.pathname}\` → handler [${projectPath(root, endpoint.file)}](${link})`,
        ...(contract?.schemas.length || contract?.contentType ? [""] : []),
        ...schemaLines(contract),
        ...(contract?.contentType ? [`- contentType: \`${contract.contentType}\``] : []),
      ].join("\n");
    }).join("\n\n");
  }
  if (!target.endpoint) return `**RPC** \`${target.id}\` no tiene un procedimiento en \`server/rpc\`.`;
  const contract = handlerContract(target.endpoint.file, "rpc");
  const link = contract ? positionLink(fileUri(context, target.endpoint.file), contract.line, contract.character) : fileUri(context, target.endpoint.file);
  return [
    `**RPC** \`${target.id}\` (POST \`${target.endpoint.pathname}\`) → handler [${projectPath(root, target.endpoint.file)}](${link})`,
    ...(contract?.schemas.length ? ["", ...schemaLines(contract)] : []),
  ].join("\n");
}

function targetAt(context: FeatureContext, generatedOffset: number): AppTarget | undefined {
  const program = context.project.service.getProgram();
  return program && context.app ? appTargetAt(program, context.component.virtualFilename, generatedOffset, context.app) : undefined;
}

/** Route of `href(...)`, endpoint of `useApi`/`api.*` or procedure of `useRpcQuery`/`useRpcMutation`/`rpc.*`. */
export function appTargetHover(context: FeatureContext, generatedOffset: number): HoverSection | undefined {
  const target = targetAt(context, generatedOffset);
  if (!target) return undefined;
  const range = nodeRange(context, target.node);
  return { markdown: targetMarkdown(context, target), ...(range ? { range } : {}) };
}

/** Definition of a route id (its page) or of an endpoint or procedure (its handler). */
export function appTargetDefinition(context: FeatureContext, generatedOffset: number): Location[] | undefined {
  const target = targetAt(context, generatedOffset);
  if (!target) return undefined;
  const start = { line: 0, character: 0 };
  if (target.kind === "route") return target.route ? [{ uri: fileUri(context, target.route.file), range: { start, end: start } }] : undefined;
  const files = target.kind === "api" ? target.endpoints.map((endpoint) => endpoint.file) : target.endpoint ? [target.endpoint.file] : [];
  const locations = files.map((file): Location => {
    const contract = handlerContract(file, target.kind === "api" ? "api" : "rpc");
    const position = contract ? { line: contract.line, character: contract.character } : start;
    return { uri: fileUri(context, file), range: { start: position, end: position } };
  });
  return locations.length ? locations : undefined;
}
