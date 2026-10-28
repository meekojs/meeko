import { readFileSync, statSync } from "node:fs";
import { basename, dirname, isAbsolute, join, relative, resolve, sep } from "node:path";
import { pathToFileURL } from "node:url";
import { TextDocument } from "vscode-languageserver-textdocument";
import { CompletionItemKind, MarkupKind } from "vscode-languageserver/node";
import type { CompletionItem, CompletionList, Hover, Location, MarkupContent, Position } from "vscode-languageserver/node";
import { classRuleSnippet, cssClassRules, cssImports } from "./class-rules.js";
import type { ClassRule } from "./class-rules.js";
import { styleRegion, tagAt } from "./embedded.js";
import { pathKey } from "./project.js";

// CSS classes of a project for `class="…"` and the string literals of `bind:class`: the
// `<style>` of the component (also unsaved), the `<style>` without `scoped` of the other
// components, and the global stylesheet. The stylesheet is the one `meeko dev` writes already
// processed by Vite and PostCSS (`.meeko/styles/main.css`) together with `app/styles/main.css`
// and its local `@import`, read as they are. Only text is read, never a PostCSS plugin or
// configuration, so it works the same in an untrusted workspace.

/** Where the classes of a {@link ClassSource} come from, in priority order. */
export type ClassOrigin = "own" | "component" | "stylesheet" | "snapshot";

/** The classes that one file defines, read from one version of its text. */
export interface ClassSource {
  readonly origin: ClassOrigin;
  readonly filename: string | undefined;
  /** {@link pathKey} of the file. */
  readonly key: string | undefined;
  readonly text: string;
  readonly rules: readonly ClassRule[];
  readonly byName: ReadonlyMap<string, readonly ClassRule[]>;
  /** Classes of an earlier text, kept while the current CSS does not parse: no positions. */
  readonly stale: boolean;
}

/** A `.meeko` of the project and its current text. */
export interface ComponentText {
  readonly filename: string;
  readonly source: string;
}

/** The global stylesheet that `meeko dev` writes processed (imports resolved, `@utilities` expanded). */
export const processedStylesheet = join(".meeko", "styles", "main.css");
/** The global stylesheet of the application, read when there is no processed one. */
export const applicationStylesheet = join("app", "styles", "main.css");

function sourceOf(origin: ClassOrigin, filename: string | undefined, text: string, rules: readonly ClassRule[], stale = false): ClassSource {
  const byName = new Map<string, ClassRule[]>();
  for (const rule of rules) {
    const list = byName.get(rule.name);
    if (list) list.push(rule);
    else byName.set(rule.name, [rule]);
  }
  return { origin, filename, key: filename === undefined ? undefined : pathKey(filename), text, rules, byName, stale };
}

/** The classes of the `<style>` of a component: all of them, or only `:global(…)` in another component's `<style scoped>`. */
function componentSource(origin: "own" | "component", filename: string | undefined, text: string, previous: ClassSource | undefined): ClassSource | undefined {
  const style = styleRegion(text);
  if (!style) return undefined;
  const rules = cssClassRules(text.slice(style.contentStart, style.contentEnd), style.contentStart);
  if (!rules) return previous && sourceOf(origin, filename, previous.text, previous.rules, true);
  const scoped = /\bscoped\b/.test(style.attributes);
  return sourceOf(origin, filename, text, origin === "component" && scoped ? rules.filter((rule) => rule.global) : rules);
}

interface CssFile {
  readonly stamp: string;
  readonly source: ClassSource;
  readonly imports: readonly string[];
}

/** The classes visible from one component: its own, then the global ones by name. */
export interface ClassView {
  readonly root: string | undefined;
  readonly own: ClassSource | undefined;
  /** Global sources that define each class, in priority order, without the component itself. */
  readonly global: ReadonlyMap<string, readonly ClassSource[]>;
}

const maximumImports = 64;

/**
 * Index of the classes of one project. Each file is read again only when its text (a component)
 * or its modification time and size (a stylesheet) change, and the table of global classes is
 * rebuilt only when one of its sources changed: a keystroke reads the `<style>` of the edited
 * component and nothing else.
 */
export class ClassIndex {
  private readonly files = new Map<string, CssFile>();
  private components = new Map<string, { readonly text: string; readonly source: ClassSource | undefined }>();
  private readonly own = new Map<string, { readonly text: string; readonly source: ClassSource | undefined }>();
  private merged: { readonly sources: readonly ClassSource[]; readonly table: Map<string, ClassSource[]> } | undefined;

  constructor(readonly root: string) {}

  /** Forgets the stylesheets among `paths`, as reported by the client's file watcher. */
  filesChanged(paths: readonly string[]): void {
    for (const path of paths) this.files.delete(pathKey(path));
  }

  /** The classes for the component `filename` with the text `text`. */
  view(filename: string, text: string, components: readonly ComponentText[]): ClassView {
    const key = pathKey(filename);
    const cached = this.own.get(key);
    let own = cached?.source;
    if (cached?.text !== text) {
      own = componentSource("own", filename, text, cached?.source);
      this.own.set(key, { text, source: own });
    }
    const table = this.table(components);
    // The table holds the saved `<style>` of this component too; its live text is `own`.
    const saved = this.merged?.sources.find((source) => source.origin === "component" && source.key === key);
    if (!saved) return { root: this.root, own, global: table };
    const global = new Map(table);
    for (const name of saved.byName.keys()) {
      const others = table.get(name)!.filter((source) => source !== saved);
      if (others.length) global.set(name, others);
      else global.delete(name);
    }
    return { root: this.root, own, global };
  }

  private table(components: readonly ComponentText[]): Map<string, ClassSource[]> {
    const sources: ClassSource[] = [];
    const next = new Map<string, { readonly text: string; readonly source: ClassSource | undefined }>();
    for (const component of components) {
      // The project gives each component under one stable filename.
      const key = component.filename;
      const cached = this.components.get(key);
      const entry = cached?.text === component.source
        ? cached
        : { text: component.source, source: componentSource("component", component.filename, component.source, cached?.source) };
      next.set(key, entry);
      if (entry.source?.rules.length) sources.push(entry.source);
    }
    this.components = next;
    sources.push(...this.stylesheets());
    const snapshot = this.cssFile(join(this.root, processedStylesheet), "snapshot");
    if (snapshot) sources.push(snapshot.source);
    const previous = this.merged;
    if (previous && previous.sources.length === sources.length && previous.sources.every((source, index) => source === sources[index])) return previous.table;
    const table = new Map<string, ClassSource[]>();
    for (const source of sources) {
      for (const name of source.byName.keys()) {
        const list = table.get(name);
        if (list) list.push(source);
        else table.set(name, [source]);
      }
    }
    this.merged = { sources, table };
    return table;
  }

  /** `app/styles/main.css` and the local files it imports, depth first, each once. */
  private stylesheets(): ClassSource[] {
    const found: ClassSource[] = [];
    const seen = new Set<string>();
    const visit = (filename: string): void => {
      const key = pathKey(filename);
      if (seen.has(key) || seen.size >= maximumImports) return;
      seen.add(key);
      const inner = relative(this.root, filename);
      if (!inner || inner.startsWith(`..${sep}`) || inner === ".." || isAbsolute(inner)) return;
      const file = this.cssFile(filename, "stylesheet");
      if (!file) return;
      found.push(file.source);
      for (const target of file.imports) {
        // `/x.css` is relative to the project root, as Vite resolves it; anything else to the file.
        const path = target.startsWith("/") ? join(this.root, target) : resolve(dirname(filename), target);
        if (path.endsWith(".css")) visit(path);
      }
    };
    visit(join(this.root, applicationStylesheet));
    return found;
  }

  private cssFile(filename: string, origin: "stylesheet" | "snapshot"): CssFile | undefined {
    const key = pathKey(filename);
    let stamp: string;
    try {
      const stat = statSync(filename, { throwIfNoEntry: false });
      if (!stat?.isFile()) { this.files.delete(key); return undefined; }
      stamp = `${stat.mtimeMs}:${stat.size}`;
    } catch { return undefined; }
    const cached = this.files.get(key);
    if (cached?.stamp === stamp) return cached;
    let text: string;
    try { text = readFileSync(filename, "utf8"); }
    catch { return undefined; }
    const rules = cssClassRules(text);
    const source = rules
      ? sourceOf(origin, filename, text, rules)
      : sourceOf(origin, filename, cached?.source.text ?? text, cached?.source.rules ?? [], true);
    const file: CssFile = { stamp, source, imports: origin === "stylesheet" ? cssImports(text) : [] };
    this.files.set(key, file);
    return file;
  }
}

/** The classes of the component alone, for callers without a project. */
function ownView(text: string): ClassView {
  return { root: undefined, own: componentSource("own", undefined, text, undefined), global: new Map() };
}

/** The class word under the cursor in `class="…"` or in a string literal of `bind:class`. */
export interface ClassToken {
  readonly start: number;
  readonly end: number;
  /** The other classes of the same value or literal. */
  readonly written: ReadonlySet<string>;
  /** In an expression of `bind:class`, not in a static `class`. */
  readonly dynamic: boolean;
}

/** The text of the string literal of `code` that contains `offset`, outside `${…}`. */
function literalAt(code: string, offset: number): { start: number; end: number } | undefined {
  type Frame = { kind: "code"; depth: number } | { kind: "string"; quote: string; start: number } | { kind: "template"; start: number };
  const stack: Frame[] = [{ kind: "code", depth: 0 }];
  for (let index = 0; index < offset; index++) {
    const char = code[index]!;
    const top = stack.at(-1)!;
    if (top.kind === "string") {
      if (char === "\\") index++;
      else if (char === top.quote) stack.pop();
    } else if (top.kind === "template") {
      if (char === "\\") index++;
      else if (char === "`") stack.pop();
      else if (char === "$" && code[index + 1] === "{") {
        stack.push({ kind: "code", depth: 0 });
        index++;
      }
    } else if (char === "'" || char === '"') stack.push({ kind: "string", quote: char, start: index + 1 });
    else if (char === "`") stack.push({ kind: "template", start: index + 1 });
    else if (char === "{") top.depth++;
    else if (char === "}") {
      if (top.depth > 0) top.depth--;
      else if (stack.length > 1) {
        stack.pop();
        const template = stack.at(-1);
        if (template?.kind === "template") template.start = index + 1;
      }
    }
  }
  const top = stack.at(-1)!;
  if (top.kind === "code") return undefined;
  let end = offset;
  while (end < code.length) {
    const char = code[end]!;
    if (char === "\\") { end += 2; continue; }
    if (top.kind === "string" ? char === top.quote : char === "`" || (char === "$" && code[end + 1] === "{")) break;
    end++;
  }
  return { start: top.start, end: Math.min(end, code.length) };
}

/**
 * The class word at `offset` of a `.meeko`: in a static `class="…"`, or in the text of a string
 * or template literal of `bind:class` (outside its `${…}`). The word may be empty, between spaces.
 */
export function classTokenAt(source: string, offset: number): ClassToken | undefined {
  const context = tagAt(source, offset);
  const value = context?.value;
  if (!value || (value.attribute !== "class" && value.attribute !== "bind:class")) return undefined;
  const quote = source[value.start - 1]!;
  let valueEnd = source.indexOf(quote, offset);
  if (valueEnd < 0 || valueEnd > context.tagEnd) valueEnd = context.tagEnd;
  let segmentStart = value.start;
  let segmentEnd = valueEnd;
  const dynamic = value.attribute === "bind:class";
  if (dynamic) {
    const literal = literalAt(source.slice(value.start, valueEnd), offset - value.start);
    if (!literal) return undefined;
    segmentStart = value.start + literal.start;
    segmentEnd = value.start + literal.end;
  }
  const start = offset - /\S*$/.exec(source.slice(segmentStart, offset))![0].length;
  const end = offset + /^\S*/.exec(source.slice(offset, segmentEnd))![0].length;
  const written = new Set([...source.slice(segmentStart, start).split(/\s+/), ...source.slice(end, segmentEnd).split(/\s+/)].filter(Boolean));
  return { start, end, written, dynamic };
}

const origins: Record<ClassOrigin, string> = { own: "0", component: "1", stylesheet: "2", snapshot: "3" };

/** The short origin of a class, the detail of its completion: `este componente`, `Card.meeko`, `main.css (global)`. */
function originLabel(source: ClassSource): string {
  if (source.origin === "own") return "este componente";
  const name = source.filename ? basename(source.filename) : "";
  if (source.origin === "component") return name;
  return source.origin === "snapshot" ? `${name} (global, procesada)` : `${name} (global)`;
}

function originPlace(source: ClassSource, root: string | undefined): string {
  if (source.origin === "own") return "el `<style>` de este componente";
  const path = source.filename && root ? relative(root, source.filename).replaceAll("\\", "/") : source.filename ?? "";
  if (source.origin === "snapshot") return `\`${path}\`, la hoja global que procesa \`meeko dev\``;
  return source.origin === "component" ? `el \`<style>\` de \`${path}\`` : `\`${path}\``;
}

/** Sources of a class, own first. */
function sourcesOf(view: ClassView, name: string): ClassSource[] {
  return [...view.own?.byName.has(name) ? [view.own] : [], ...view.global.get(name) ?? []];
}

/** Markdown of a class: where it is defined, the rule and the other places that define it. */
function classMarkdown(view: ClassView, name: string): MarkupContent | undefined {
  const [first, ...others] = sourcesOf(view, name);
  const rule = first?.byName.get(name)?.[0];
  if (!first || !rule) return undefined;
  const lines = [`Clase \`.${name}\` de ${originPlace(first, view.root)}.`, "", "```css", classRuleSnippet(first.text, rule), "```"];
  const more = [...new Set(others.map(originLabel))];
  if (more.length) lines.push("", `También en: ${more.slice(0, 4).join(", ")}${more.length > 4 ? "…" : ""}`);
  return { kind: MarkupKind.Markdown, value: lines.join("\n") };
}

/** Data of a class completion item, so that `completionItem/resolve` adds its documentation. */
export interface ClassCompletionData {
  readonly meekoClass: string;
}

export function isClassCompletionData(data: unknown): data is ClassCompletionData {
  return typeof data === "object" && data !== null && typeof (data as { meekoClass?: unknown }).meekoClass === "string";
}

/** The classes of a project for a component, or only its own without `index`. */
export function classView(document: TextDocument, filename?: string, index?: ClassIndex, components: readonly ComponentText[] = []): ClassView {
  return index && filename ? index.view(filename, document.getText(), components) : ownView(document.getText());
}

/**
 * Inside `class="…"`, or a string literal of `bind:class`, the classes that the component, the
 * `<style>` without `scoped` of the other components and the global stylesheet define, once
 * each and without those already written. `undefined` elsewhere; in `bind:class`, also when
 * there are none, so that TypeScript answers.
 */
export function classCompletion(document: TextDocument, position: Position, filename?: string, index?: ClassIndex, components?: readonly ComponentText[]): CompletionItem[] | undefined {
  const source = document.getText();
  const offset = document.offsetAt(position);
  const token = classTokenAt(source, offset);
  if (!token) return undefined;
  const view = classView(document, filename, index, components);
  const start = document.positionAt(token.start);
  const items: CompletionItem[] = [];
  const add = (name: string, source: ClassSource): void => {
    if (token.written.has(name)) return;
    items.push({
      label: name, kind: CompletionItemKind.Value, detail: originLabel(source), sortText: `${origins[source.origin]}${name}`,
      textEdit: { range: { start, end: position }, newText: name }, data: { meekoClass: document.uri } satisfies ClassCompletionData,
    });
  };
  for (const name of view.own?.byName.keys() ?? []) add(name, view.own!);
  for (const [name, sources] of view.global) if (!view.own?.byName.has(name)) add(name, sources[0]!);
  return items.length || !token.dynamic ? items : undefined;
}

/**
 * The items of {@link classCompletion} with their shared range and data moved to `itemDefaults`
 * (LSP 3.17), for clients that announce `editRange` and `data` there: a stylesheet with
 * thousands of classes sends about a third of the bytes.
 */
export function withItemDefaults(items: readonly CompletionItem[]): CompletionList {
  const first = items[0];
  const edit = first?.textEdit;
  if (!first || !edit || !("range" in edit)) return { isIncomplete: false, items: [...items] };
  return {
    isIncomplete: false,
    itemDefaults: { editRange: edit.range, data: first.data },
    items: items.map(({ textEdit: _edit, data: _data, ...item }) => item),
  };
}

/** The documentation of a class completion item, added on `completionItem/resolve`. */
export function resolveClassCompletion(item: CompletionItem, view: ClassView): CompletionItem {
  const documentation = classMarkdown(view, item.label);
  return documentation ? { ...item, documentation } : item;
}

/** Hover of a class in `class="…"` or `bind:class`: where it is defined and its rule. */
export function classHover(document: TextDocument, position: Position, filename?: string, index?: ClassIndex, components?: readonly ComponentText[]): Hover | undefined {
  const source = document.getText();
  const token = classTokenAt(source, document.offsetAt(position));
  if (!token || token.start === token.end) return undefined;
  const contents = classMarkdown(classView(document, filename, index, components), source.slice(token.start, token.end));
  return contents && { contents, range: { start: document.positionAt(token.start), end: document.positionAt(token.end) } };
}

const documents = new WeakMap<ClassSource, TextDocument>();

function locationsIn(source: ClassSource, name: string, own: TextDocument): Location[] {
  if (source.stale) return [];
  let document = source.origin === "own" ? own : documents.get(source);
  if (!document) {
    document = TextDocument.create(pathToFileURL(source.filename!).href, "css", 0, source.text);
    documents.set(source, document);
  }
  const target = document;
  return (source.byName.get(name) ?? []).map((rule) => ({
    uri: target.uri, range: { start: target.positionAt(rule.start), end: target.positionAt(rule.end) },
  }));
}

/**
 * From a class in `class="…"` or `bind:class` to its selectors: in the component, in the
 * `<style>` of other components and in the project's stylesheets. A class that only the
 * processed stylesheet defines (generated by `@utilities` or Tailwind) leads to its rule there.
 */
export function classDefinition(document: TextDocument, position: Position, filename?: string, index?: ClassIndex, components?: readonly ComponentText[]): Location[] | undefined {
  const source = document.getText();
  const token = classTokenAt(source, document.offsetAt(position));
  if (!token || token.start === token.end) return undefined;
  const name = source.slice(token.start, token.end);
  const sources = sourcesOf(classView(document, filename, index, components), name);
  const written = sources.filter((item) => item.origin !== "snapshot").flatMap((item) => locationsIn(item, name, document));
  const targets = written.length ? written : sources.flatMap((item) => locationsIn(item, name, document));
  return targets.length ? targets : undefined;
}
