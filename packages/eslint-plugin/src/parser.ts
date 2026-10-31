import { parseForESLint as parseTypeScript } from "@typescript-eslint/parser";
import type { ParserOptions } from "@typescript-eslint/parser";
import type { TSESTree } from "@typescript-eslint/utils";
import { locate, MeekoCompileError } from "@meekojs/meeko/parse";
import type { TemplateNode } from "@meekojs/meeko/parse";
import { Source } from "./source";

interface Point { line: number; column: number }
interface Node {
  type: string;
  range: [number, number];
  loc: { start: Point; end: Point };
  [key: string]: unknown;
}

export interface MeekoParserServices {
  readonly isMeeko: true;
  readonly templateBody: TemplateNode;
}

export const meta = { name: "@meekojs/eslint-plugin/parser", version: "0.1.0" };

/** Parse component scopes with TypeScript-ESLint, then restore original source nodes and ranges. */
export function parseForESLint(text: string, options: ParserOptions = {}): Omit<ReturnType<typeof parseTypeScript>, "services"> & { services: MeekoParserServices } {
  if (options.project || options.projectService || options.programs) {
    throw new Error("Meeko ESLint currently supports syntax-only linting; use meeko check for type checking and disable project/projectService/programs for .meeko files");
  }
  const filename = options.filePath ?? "component.meeko";
  let source: Source;
  try { source = new Source(text, filename); }
  catch (error) {
    if (!(error instanceof MeekoCompileError)) throw error;
    throw Object.assign(new SyntaxError(error.diagnostic.message), {
      index: error.diagnostic.location.offset,
      lineNumber: error.diagnostic.location.line,
      column: error.diagnostic.location.column,
    });
  }
  let result: ReturnType<typeof parseTypeScript>;
  try {
    result = parseTypeScript(source.code, {
      ...options, filePath: filename.replace(/\.meeko$/, ".ts"), sourceType: "module",
      range: true, loc: true, tokens: true, comment: true,
    });
  } catch (error) {
    if (typeof error === "object" && error !== null && "index" in error && typeof error.index === "number") {
      const index = source.offset(error.index);
      const point = locate(text, index);
      Object.assign(error, { index, lineNumber: point.line, column: point.column });
    }
    throw error;
  }
  const manager = result.scopeManager;
  // A server block must never capture a declaration from the component script. Its wrapper only
  // supplies a scope to the analyzer, not a JavaScript closure between the two execution worlds.
  if (source.serverRange && manager.globalScope) {
    const [start, end] = source.serverRange;
    for (const scope of manager.scopes) for (const reference of scope.references) {
      const at = reference.identifier.range[0];
      if (at < start || at >= end || !reference.resolved) continue;
      const variable = reference.resolved;
      if (!variable.defs.some((definition) => definition.name.range[0] < start || definition.name.range[0] >= end)) continue;
      const index = variable.references.indexOf(reference);
      if (index >= 0) variable.references.splice(index, 1);
      reference.resolved = null;
      if (!manager.globalScope.through.includes(reference)) manager.globalScope.through.push(reference);
    }
  }
  // Scope scaffolding introduces internal names and default list indexes, not user variables.
  for (const scope of manager.scopes) for (const variable of scope.variables) {
    if (variable.identifiers.length && variable.identifiers.every((identifier) => !source.original(...identifier.range))) variable.eslintUsed = true;
  }
  const keys = result.visitorKeys;
  // Hidden scaffolding still participates in reference analysis. Give those identifiers their
  // original parent chain too; ESLint only assigns parents to nodes exposed by our visitor keys.
  const parents = (node: Node, parent: Node | null): void => {
    node.parent = parent;
    for (const key of keys[node.type] ?? []) {
      const value = node[key];
      if (Array.isArray(value)) for (const child of value) { if (child) parents(child as Node, node); }
      else if (value && typeof value === "object" && "type" in value) parents(value as Node, node);
    }
  };
  parents(result.ast as unknown as Node, null);
  const lines = [0, ...[...text.matchAll(/\r\n|\r|\n/g)].map((match) => match.index + match[0].length)];
  const point = (offset: number): Point => {
    let low = 0;
    let high = lines.length - 1;
    while (low < high) {
      const middle = (low + high + 1) >>> 1;
      if (lines[middle] <= offset) low = middle; else high = middle - 1;
    }
    return { line: low + 1, column: offset - lines[low] };
  };
  const position = (node: Node): void => {
    const start = source.offset(node.range[0]);
    const end = source.offset(node.range[1], true);
    node.range = [Math.min(start, end), Math.max(start, end)];
    node.loc = { start: point(node.range[0]), end: point(node.range[1]) };
  };
  const restore = (node: Node, root = false): Node | undefined => {
    const original = source.original(...node.range);
    const children: Node[] = [];
    for (const key of keys[node.type] ?? []) {
      const value = node[key];
      if (Array.isArray(value)) {
        const restored = value.map((child: Node | null) => child ? restore(child) : child).filter((child) => child !== undefined);
        node[key] = restored;
        children.push(...restored.filter((child): child is Node => child !== null));
      } else if (value && typeof value === "object" && "type" in value) {
        const child = restore(value as Node);
        node[key] = child;
        if (child) children.push(child);
      }
    }
    if (root) {
      node.range = [0, text.length];
      node.loc = { start: point(0), end: point(text.length) };
    } else {
      position(node);
      if (!original) {
        if (!children.length) return undefined;
        node.type = "MeekoScope";
        node.children = children;
      }
    }
    return node;
  };
  // Remove generated delimiters: ESLint fixes must always address actual source tokens.
  const tokens = result.ast.tokens?.filter((token) => source.original(...token.range)) ?? [];
  const comments = result.ast.comments?.filter((comment) => source.original(...comment.range)) ?? [];
  for (const token of [...tokens, ...comments]) position(token as unknown as Node);
  restore(result.ast as unknown as Node, true);
  result.ast.tokens = tokens.sort((a, b) => a.range[0] - b.range[0]);
  result.ast.comments = comments.sort((a, b) => a.range[0] - b.range[0]);
  // Import cleanup/sorting rules use getTokenAfter/getTokensBetween. SFC delimiters are real
  // source boundaries, so they must be tokens too: otherwise the last import can consume a
  // closing script tag or import collections can be sorted across client/server sections.
  for (const section of source.scripts) {
    for (const [start, end] of [[section.start, section.contentStart], [section.contentEnd, section.end]]) {
      result.ast.tokens.push({
        type: "MeekoScriptBoundary",
        value: text.slice(start, end),
        range: [start, end],
        loc: { start: point(start), end: point(end) },
      } as unknown as TSESTree.Token);
    }
  }
  result.ast.tokens.sort((a, b) => a.range[0] - b.range[0]);
  // Scope construction starts with the server wrapper, but rule traversal follows source order.
  result.ast.body.sort((a, b) => a.range[0] - b.range[0]);
  return {
    ast: result.ast,
    scopeManager: manager,
    visitorKeys: { ...keys, MeekoScope: ["children"] },
    services: { isMeeko: true, templateBody: source.template } satisfies MeekoParserServices,
  };
}

export default { meta, parseForESLint };
