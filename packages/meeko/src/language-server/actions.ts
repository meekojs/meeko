import { basename } from "node:path";
import { pathToFileURL } from "node:url";
import ts from "@typescript/typescript6";
import { CodeActionKind } from "vscode-languageserver/node";
import type { CodeAction, Range } from "vscode-languageserver/node";
import { parseSfc } from "../compiler/sfc.js";
import { attributeValueStart, parseTemplate } from "../compiler/template.js";
import type { TemplateNode } from "../compiler/template.js";
import { isPageFile } from "../framework/route-block.js";
import type { FeatureContext } from "./features.js";
import { nodeAt } from "./reactivity.js";

/** What the client can apply in a workspace edit. */
export interface EditCapabilities {
  /** `documentChanges` with `delete` resource operations. */
  readonly deleteFiles?: boolean;
}

function intersects(range: Range, start: { line: number }, end: { line: number }): boolean {
  return range.start.line <= end.line && range.end.line >= start.line;
}

/**
 * Moves a page's `x.route.ts` sidecar into a `<script server lang="ts">` block of `x.meeko` and
 * deletes the sidecar, in one workspace edit. Relative imports keep working: both files share
 * a directory. Offered on the first lines of the page, up to its `<script>` tag.
 */
export function sidecarActions(context: FeatureContext, range: Range, capabilities: EditCapabilities, only?: readonly string[]): CodeAction[] {
  const { component, document } = context;
  if (!capabilities.deleteFiles || component.server || !component.filename.endsWith(".meeko")) return [];
  if (!isPageFile(component.filename, context.project.sourceRoots())) return [];
  const sidecar = `${component.filename.slice(0, -".meeko".length)}.route.ts`;
  const located = context.locate(sidecar);
  if (!located) return [];
  const source = document.getText();
  let scriptStart: number;
  try { scriptStart = parseSfc(source, component.filename).script.start; }
  catch { return []; }
  const requested = only?.some((kind) => kind === CodeActionKind.Refactor || kind.startsWith(`${CodeActionKind.Refactor}.`)) ?? false;
  if (!requested && !intersects(range, { line: 0 }, document.positionAt(scriptStart))) return [];
  const newline = source.includes("\r\n") ? "\r\n" : "\n";
  const content = located.document.getText().replace(/\r\n|\r|\n/g, newline).replace(/\s+$/, "");
  const block = `<script server lang="ts">${newline}${content}${newline}</script>${newline}${newline}`;
  return [{
    title: `Mover ${basename(sidecar)} a <script server>`,
    kind: CodeActionKind.RefactorRewrite,
    edit: {
      documentChanges: [
        { textDocument: { uri: document.uri, version: document.version }, edits: [{ range: { start: { line: 0, character: 0 }, end: { line: 0, character: 0 } }, newText: block }] },
        { kind: "delete", uri: located.uri.startsWith("file:") ? located.uri : pathToFileURL(sidecar).href },
      ],
    },
  }];
}

/** Property names that identify a list item, in order of preference. */
const keyProperties = ["id", "key", "uuid", "slug"];

/** Elements of the template, depth first. */
function elements(node: TemplateNode, found: TemplateNode[] = []): TemplateNode[] {
  for (const child of [...node.childNodes ?? [], ...node.content?.childNodes ?? []]) {
    if (child.attrs) found.push(child);
    elements(child, found);
  }
  return found;
}

/** The key for the items of a list: `item.id` when the item has an identifying property, the item itself when it is a string or number. */
function suggestedKey(context: FeatureContext, item: string, listStart: number): string | undefined {
  const program = context.project.service.getProgram();
  const file = program?.getSourceFile(context.component.virtualFilename);
  const generated = context.component.toGenerated(listStart);
  if (!program || !file || generated === undefined) return undefined;
  // The virtual code declares the item as `for (const item of (list))`.
  const itemStart = generated - " of (".length - item.length;
  if (context.component.code.slice(itemStart, itemStart + item.length) !== item) return undefined;
  const node = nodeAt(file, itemStart);
  if (!node || !ts.isIdentifier(node)) return undefined;
  const checker = program.getTypeChecker();
  const type = checker.getNonNullableType(checker.getTypeAtLocation(node));
  if (type.flags & ts.TypeFlags.Any) return undefined;
  const property = keyProperties.find((name) => {
    const symbol = type.getProperty(name);
    if (!symbol) return false;
    const value = checker.getTypeOfSymbolAtLocation(symbol, node);
    return (value.flags & (ts.TypeFlags.StringLike | ts.TypeFlags.NumberLike)) !== 0;
  });
  if (property) return `${item}.${property}`;
  const primitive = (type.isUnion() ? type.types : [type]).every((part) => (part.flags & (ts.TypeFlags.StringLike | ts.TypeFlags.NumberLike)) !== 0);
  return primitive ? item : undefined;
}

/** Adds `each:key` to a list without one, keyed by `item.id` (or another identifying property) when the item has it. */
export function eachKeyActions(context: FeatureContext, range: Range): CodeAction[] {
  const { component, document } = context;
  const source = component.source;
  let root: TemplateNode;
  try { root = parseTemplate(source, parseSfc(source, component.filename).template, component.filename); }
  catch { return []; }
  const actions: CodeAction[] = [];
  for (const element of elements(root)) {
    const attributes = element.attrs ?? [];
    const list = attributes.find((attribute) => attribute.name === "each:of");
    if (!list || attributes.some((attribute) => attribute.name === "each:key")) continue;
    const startTagEnd = element.sourceCodeLocation?.startTag ? element.start + (element.sourceCodeLocation.startTag.endOffset - element.sourceCodeLocation.startTag.startOffset) : list.end;
    if (!intersects(range, document.positionAt(element.start), document.positionAt(startTagEnd))) continue;
    const item = attributes.find((attribute) => attribute.name === "each:as")?.value.trim() || "item";
    const listStart = attributeValueStart(source, list);
    if (listStart === undefined) continue;
    const key = suggestedKey(context, item, listStart);
    if (!key) continue;
    const at = document.positionAt(list.end);
    actions.push({
      title: `Añadir each:key="${key}"`,
      kind: CodeActionKind.QuickFix,
      edit: { changes: { [document.uri]: [{ range: { start: at, end: at }, newText: ` each:key="${key}"` }] } },
    });
  }
  return actions;
}
