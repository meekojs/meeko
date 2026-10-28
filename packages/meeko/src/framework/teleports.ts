import type { TeleportEntry } from "../teleport.js";

/** Elements without content or end tag: a teleport cannot render inside them. */
const voidElements = new Set(["area", "base", "br", "col", "embed", "hr", "img", "input", "link", "meta", "param", "source", "track", "wbr"]);

/** Elements whose content is text up to their end tag, never markup. */
const rawTextElements = new Set(["script", "style", "textarea", "title", "xmp", "iframe", "noembed", "noframes", "noscript", "plaintext"]);

/** The start tag of the element whose `id` is `id`, and where its end tag starts. */
type ElementSearch = { found: false } | { found: true; tag: string; end: number | undefined };

/**
 * Finds the first element with `id="id"` in HTML that Meeko rendered and the offset of its end
 * tag, where a teleport's content goes. It reads tags, comments and the text of raw-text elements;
 * Meeko writes every end tag of the elements of a template, so counting the start and end tags of
 * the element's name finds its own.
 */
function findElement(html: string, id: string): ElementSearch {
  const tagPattern = /<(\/?)([A-Za-z][^\s/>]*)/y;
  const attributePattern = /[\s/]*([^\s"'>/=]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]*)))?/y;
  let target: string | undefined;
  let depth = 0;
  let index = 0;
  while (index < html.length) {
    const open = html.indexOf("<", index);
    if (open < 0) break;
    if (html.startsWith("<!--", open)) {
      const close = html.indexOf("-->", open + 4);
      if (close < 0) break;
      index = close + 3;
      continue;
    }
    tagPattern.lastIndex = open;
    const tag = tagPattern.exec(html);
    if (!tag) {
      // `<!DOCTYPE>`, `<?…>` or a `<` of text.
      index = html[open + 1] === "!" || html[open + 1] === "?" ? Math.max(open + 1, html.indexOf(">", open) + 1) : open + 1;
      continue;
    }
    const closing = tag[1] === "/";
    const name = tag[2]!.toLowerCase();
    let cursor = open + tag[0].length;
    let value: string | undefined;
    if (!closing) {
      for (;;) {
        while (cursor < html.length && /[\s/]/.test(html[cursor]!)) cursor++;
        if (cursor >= html.length || html[cursor] === ">") break;
        attributePattern.lastIndex = cursor;
        const attribute = attributePattern.exec(html);
        if (!attribute || attribute[0].length === 0) { cursor++; continue; }
        if (attribute[1]!.toLowerCase() === "id" && value === undefined) value = attribute[2] ?? attribute[3] ?? attribute[4] ?? "";
        cursor += attribute[0].length;
      }
    } else {
      const close = html.indexOf(">", cursor);
      cursor = close < 0 ? html.length : close;
    }
    index = cursor + 1;
    if (closing) {
      if (target === name && --depth === 0) return { found: true, tag: name, end: open };
      continue;
    }
    if (target === undefined && value === id) {
      if (voidElements.has(name)) return { found: true, tag: name, end: undefined };
      target = name;
      depth = 1;
    } else if (target === name && !voidElements.has(name)) depth++;
    if (rawTextElements.has(name)) {
      const end = new RegExp(`</${name}[\\s/>]`, "gi");
      end.lastIndex = index;
      const match = end.exec(html);
      index = match ? match.index : html.length;
    }
  }
  return target === undefined ? { found: false } : { found: true, tag: target, end: undefined };
}

/** What the document does with a teleport whose target the page does not render. */
export interface TeleportPlacementOptions {
  /** In production the content renders in its place with a warning; in development the render fails. */
  readonly production: boolean;
  /** Receives the warning of a missing target in production. */
  readonly warn?: (message: string) => void;
}

/**
 * @internal Places the teleports of a server document: the content for `#id` goes before the end
 * tag of that element, in `html` (the application) or in the content for `body`, and the content
 * for `body` comes back apart, for the document to write after the application, before Meeko's
 * scripts. Several teleports for one target keep the order of their places. A teleport whose place
 * is not in the final HTML, such as one in a child that the browser renders later, is dropped.
 *
 * A missing `#id`, or one on an element without content (`<input>`), fails in development; in
 * production the content renders in its place, where the browser hydrates it, and `warn`
 * receives why.
 */
export function placeTeleports(html: string, entries: readonly TeleportEntry[], options: TeleportPlacementOptions): { html: string; body: string } {
  let app = html;
  let body = "";
  const referenced = (entry: TeleportEntry): boolean => {
    const reference = `<!--meeko:portal-ref:${entry.key}-->`;
    return app.includes(reference) || body.includes(reference);
  };
  let pending = [...entries];
  /** Why the target of an entry cannot hold it, when it exists. */
  const unusable = new Map<TeleportEntry, string>();
  // A teleport inside another one's content has its place, or its target, there.
  for (let progress = true; progress && pending.length;) {
    progress = false;
    const waiting: TeleportEntry[] = [];
    for (const entry of pending) {
      if (!referenced(entry)) { waiting.push(entry); continue; }
      if (entry.to === "body") {
        body += entry.html;
        progress = true;
        continue;
      }
      const id = entry.to.slice(1);
      const inApp = findElement(app, id);
      const search = inApp.found ? inApp : findElement(body, id);
      if (!search.found || search.end === undefined) {
        if (search.found) unusable.set(entry, `<MeekoTeleport to="${entry.to}">: the element with id "${id}" is <${search.tag}>, which cannot hold content; point to at an element that can`);
        waiting.push(entry);
        continue;
      }
      if (inApp.found) app = app.slice(0, search.end) + entry.html + app.slice(search.end);
      else body = body.slice(0, search.end) + entry.html + body.slice(search.end);
      progress = true;
    }
    pending = waiting;
  }
  for (const entry of pending) {
    if (!referenced(entry)) continue;
    const message = unusable.get(entry) ?? `<MeekoTeleport to="${entry.to}">: the page renders no element with id "${entry.to.slice(1)}"; render it in the page, a layout or app.meeko, or use to="body"`;
    if (!options.production) throw new Error(message);
    options.warn?.(`${message}. The content renders in its place.`);
    const reference = `<!--meeko:portal-ref:${entry.key}-->`;
    // In its place: the same portal markers, which the browser hydrates there.
    if (app.includes(reference)) app = app.replace(reference, () => entry.html);
    else body = body.replace(reference, () => entry.html);
  }
  return { html: app, body };
}
