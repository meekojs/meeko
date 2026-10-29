import { parse } from "parse5";

/**
 * The inline code of an HTML document that a CSP governs, read as the browser reads it. Portable:
 * no Node built-in, so a server render on Workers can hash it with Web Crypto.
 */
export interface InlineSources {
  /** Text of each inline `<script>` that `script-src` checks, in document order. */
  readonly scripts: readonly string[];
  /** Text of each `<style>`, in document order. */
  readonly styles: readonly string[];
  /** JavaScript no hash can allow: `on*` attributes and `javascript:` URLs, described for a message. */
  readonly unhashable: readonly string[];
}

interface Parse5Node {
  readonly nodeName: string;
  readonly tagName?: string;
  readonly value?: string;
  readonly attrs?: ReadonlyArray<{ readonly name: string; readonly value: string }>;
  readonly childNodes?: readonly Parse5Node[];
  readonly content?: Parse5Node;
}

/** The JavaScript MIME type essences of the HTML standard. */
const javascriptTypes = new Set([
  "application/ecmascript", "application/javascript", "application/x-ecmascript", "application/x-javascript", "text/ecmascript",
  "text/javascript", "text/javascript1.0", "text/javascript1.1", "text/javascript1.2", "text/javascript1.3", "text/javascript1.4",
  "text/javascript1.5", "text/jscript", "text/livescript", "text/x-ecmascript", "text/x-javascript",
]);
/** Non-JavaScript `type` values that `script-src` still governs. */
const scriptBlockTypes = new Set(["module", "importmap", "speculationrules"]);
/** Attributes that navigate to or load a URL, where `javascript:` runs code. */
const urlAttributes = new Set(["href", "src", "action", "formaction", "xlink:href", "data"]);

/**
 * Whether a `<script type>` runs (or, like an import map, is checked by `script-src`); a data
 * block such as `application/json` or `application/ld+json` is not.
 */
function governedByScriptSrc(type: string | undefined): boolean {
  if (type === undefined) return true;
  const value = type.trim().toLowerCase();
  if (value === "" || scriptBlockTypes.has(value)) return true;
  return javascriptTypes.has(value.split(";")[0]!.trim());
}

function text(node: Parse5Node): string {
  return (node.childNodes ?? []).map((child) => child.nodeName === "#text" ? child.value ?? "" : "").join("");
}

/** Reads the inline scripts and styles of `html` and the JavaScript that no hash can allow. */
export function inlineSources(html: string): InlineSources {
  const scripts: string[] = [];
  const styles: string[] = [];
  const unhashable: string[] = [];
  const visit = (node: Parse5Node): void => {
    const tag = node.tagName;
    if (tag !== undefined) {
      const attributes = node.attrs ?? [];
      for (const { name, value } of attributes) {
        const lower = name.toLowerCase();
        if (lower.startsWith("on")) unhashable.push(`<${tag} ${lower}>`);
        // The URL parser strips leading spaces and controls, and drops tabs and newlines.
        else if (urlAttributes.has(lower) && /^javascript:/i.test(value.replace(/^[\u0000- ]+/, "").replace(/[\t\n\r]/g, ""))) {
          unhashable.push(`<${tag} ${lower}="${value.slice(0, 40)}">`);
        }
      }
      if (tag === "script" && !attributes.some((attribute) => attribute.name.toLowerCase() === "src")) {
        const type = attributes.find((attribute) => attribute.name.toLowerCase() === "type")?.value;
        if (governedByScriptSrc(type)) scripts.push(text(node));
      }
      if (tag === "style") styles.push(text(node));
    }
    for (const child of node.childNodes ?? []) visit(child);
    if (node.content) visit(node.content);
  };
  visit(parse(html) as unknown as Parse5Node);
  return { scripts, styles, unhashable };
}

/** Opening of the element that holds the rendered page; the teleports follow it, up to the payload. */
const appOpening = '<div id="app">';
/** Opening of the navigation payload, which `serializeJson` keeps free of `<`. */
const payloadOpening = '<script id="meeko-payload" type="application/json">';

/**
 * The part of a Meeko document that Meeko and the application write: everything before
 * `<div id="app">` (the head, with the theme, `useHead`, `document.head` and the component styles)
 * and everything from the navigation payload on (the client entry and `bodyEnd`). The rendered
 * page and its teleports, in between, may carry user content (`html=`, unsanitized data), so a hash
 * taken from them would allow an injected `<script>` or `<style>`. The first `#app` opening and the
 * last payload bracket every byte of the page, so content inside it cannot move them. A document
 * without both marks is not a Meeko document and is returned whole.
 */
export function documentShell(html: string): string {
  const app = html.indexOf(appOpening);
  const payload = html.lastIndexOf(payloadOpening);
  if (app < 0 || payload < app) return html;
  return `${html.slice(0, app + appOpening.length)}</div>${html.slice(payload)}`;
}

/** Standard base64 with padding, the encoding of CSP hash sources. */
function base64(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
}

/** The CSP source `'sha256-…'` of `text`, with Web Crypto. */
async function sha256Source(text: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
  return `'sha256-${base64(new Uint8Array(digest))}'`;
}

/**
 * The CSP hash sources of the inline scripts and styles that Meeko writes in a document (see
 * `documentShell`), sorted and without repeats, as the prerender index stores them.
 */
export async function documentHashes(html: string): Promise<{ readonly scripts: readonly string[]; readonly styles: readonly string[] }> {
  const sources = inlineSources(documentShell(html));
  const hash = async (texts: readonly string[]): Promise<string[]> => [...new Set(await Promise.all([...new Set(texts)].map(sha256Source)))].sort();
  return { scripts: await hash(sources.scripts), styles: await hash(sources.styles) };
}
