/**
 * Normalizes the content of `html="..."` so it always fits inside its element.
 *
 * The browser parses the SSR document as a whole, so a value written as is can leave its element:
 * a stray `</div>` closes it, a truncated `<b>` makes the following template bold, an unclosed
 * `<style>` swallows the rest of the page and a `<div>` inside a `<p>` closes the paragraph. Those
 * nodes land among the template's, where they can imitate Meeko markers or break the hydration.
 *
 * This module has no dependencies, so the server runtime does not carry an HTML parser. It reads
 * the value with the tokenizer rules of HTML and follows the tree builder only as far as it decides
 * where nodes go:
 *
 * - Text, comments and attributes are written as they came, so their meaning does not change.
 * - A start tag that the browser would use to close the element or one of its ancestors, or to move
 *   content out of it (foster parenting in a table, a breakout from SVG), means the value does not
 *   fit: the element renders empty and the browser fills it on hydration with `innerHTML`, which
 *   keeps everything inside. When the ancestors decide it, such as a `<div>` inside a `<span>` that
 *   may sit in a `<p>`, it assumes they would.
 * - An end tag closes only what the value opened, writing the end tags of what it skips; any other
 *   end tag is dropped. Raw text elements, comments and every open element are closed at the end.
 *
 * Nested links, buttons, `<nobr>` and forms are the exception: they depend only on ancestors, and
 * nesting them is not valid HTML, so the value is written as if no ancestor had them.
 */

/** Namespace of an element that `html="..."` fills. */
export type HtmlContentNamespace = "html" | "svg" | "math";

const namespaceUris: Record<HtmlContentNamespace, string> = {
  html: "http://www.w3.org/1999/xhtml",
  svg: "http://www.w3.org/2000/svg",
  math: "http://www.w3.org/1998/Math/MathML",
};

/** An element open while the value is read. `integration` marks the foreign elements whose content is HTML. */
interface OpenElement {
  /** Lowercase name, for comparisons. */
  readonly name: string;
  /** Name as the start tag wrote it, for its end tag (`foreignObject`). */
  readonly written: string;
  readonly namespace: HtmlContentNamespace;
  readonly integration: boolean;
}

const words = (list: string): ReadonlySet<string> => new Set(list.split(" "));

const voidElements = words("area base basefont bgsound br col embed frame hr image img input keygen link meta param source track wbr");
const rawTextElements = words("script style xmp iframe noembed noframes textarea title");
const headings = words("h1 h2 h3 h4 h5 h6");
/** Start tags that close a `<p>` in button scope. */
const closesParagraph = words("address article aside blockquote center details dialog dir div dl fieldset figcaption figure footer form header hgroup hr li dd dt listing main menu nav ol p plaintext pre search section summary table ul xmp h1 h2 h3 h4 h5 h6");
const special = words("address applet area article aside base basefont bgsound blockquote body br button caption center col colgroup dd details dir div dl dt embed fieldset figcaption figure footer form frame frameset h1 h2 h3 h4 h5 h6 head header hgroup hr html iframe img input keygen li link listing main marquee menu meta nav noembed noframes noscript object ol p param plaintext pre script search section select source style summary table tbody td template textarea tfoot th thead title tr track ul wbr xmp");
const defaultScope = words("applet caption html table td th marquee object template");
const formattingMarkers = words("applet object marquee template td th caption");
/** Start tags that the tree builder treats in the HTML namespace even inside SVG or MathML. */
const breakout = words("b big blockquote body br center code dd div dl dt em embed h1 h2 h3 h4 h5 h6 head hr i img li listing menu meta nobr ol p pre ruby s small span strong strike sub sup table tt u ul var");
const tableParts = words("caption col colgroup tbody td tfoot th thead tr");
const cellLike = words("td th caption template");
/** Start tags that stay inside each table element when they are its direct content. */
const tableContent: Readonly<Record<string, ReadonlySet<string>>> = {
  table: words("caption colgroup col tbody thead tfoot tr td th script style template"),
  tbody: words("tr td th script style template"),
  thead: words("tr td th script style template"),
  tfoot: words("tr td th script style template"),
  tr: words("td th script style template"),
  colgroup: words("col template"),
};
const impliedEnd = words("dd dt li optgroup option p rb rp rt rtc");
const foreignLookalikes = words("caption col colgroup tbody td tfoot th thead tr template select option optgroup html body frameset");
/** Start tags that a select handles; `select`, `input`, `keygen` and `textarea` close it. */
const selectContent = words("option optgroup hr script template select input keygen textarea");
/** Start tags the body ignores but whose attributes would land on the page's own elements. */
const documentStructure = words("html head body frameset frame");

/** Thrown when the value cannot stay inside its element. */
const doesNotFit = Symbol("doesNotFit");

function openElement(name: string, namespace: HtmlContentNamespace, rawTag: string): OpenElement {
  const integration = namespace === "svg" ? name === "foreignobject" || name === "desc" || name === "title"
    : namespace === "math" && (["mi", "mo", "mn", "ms", "mtext"].includes(name)
      || (name === "annotation-xml" && /[\s/]encoding\s*=\s*["']?(?:text\/html|application\/xhtml\+xml)/i.test(rawTag)));
  const written = /^<([^\t\n\f\r />]+)/.exec(rawTag)?.[1] ?? name;
  return { name, written, namespace, integration };
}

const isHtml = (element: OpenElement, names: ReadonlySet<string> | readonly string[]): boolean =>
  element.namespace === "html" && (names instanceof Set ? names.has(element.name) : (names as readonly string[]).includes(element.name));

/** Scope boundaries: the default list, its foreign integration points, and `extra`. */
const bounds = (element: OpenElement, extra?: string): boolean =>
  element.namespace === "html" ? defaultScope.has(element.name) || element.name === extra : element.integration;

const isSpecial = (element: OpenElement): boolean => element.namespace === "html" ? special.has(element.name) : element.integration;

const whitespace = (char: string | undefined): boolean => char === " " || char === "\t" || char === "\n" || char === "\f" || char === "\r";
const letter = (char: string | undefined): boolean => char !== undefined && /[a-zA-Z]/.test(char);

/** Index of the last element of `stack` that matches, or `-1`. */
function lastIndex(stack: readonly OpenElement[], matches: (element: OpenElement) => boolean): number {
  for (let index = stack.length - 1; index >= 0; index--) if (matches(stack[index]!)) return index;
  return -1;
}

/**
 * The `>` that ends a tag whose attributes start at `from`, following the tokenizer's attribute
 * states (quotes only delimit values), and whether it is self-closing. `undefined` when the value
 * ends inside the tag, which the browser drops.
 */
function tagEnd(html: string, from: number): { end: number; selfClosing: boolean } | undefined {
  type State = "before" | "name" | "after" | "beforeValue" | "double" | "single" | "unquoted" | "afterQuoted" | "solidus";
  let state: State = "before";
  for (let index = from; index < html.length; index++) {
    const char = html[index];
    switch (state) {
      case "before":
        if (whitespace(char)) break;
        if (char === "/") state = "solidus";
        else if (char === ">") return { end: index, selfClosing: false };
        else state = "name";
        break;
      case "name":
        if (whitespace(char)) state = "after";
        else if (char === "/") state = "solidus";
        else if (char === "=") state = "beforeValue";
        else if (char === ">") return { end: index, selfClosing: false };
        break;
      case "after":
        if (whitespace(char)) break;
        if (char === "/") state = "solidus";
        else if (char === "=") state = "beforeValue";
        else if (char === ">") return { end: index, selfClosing: false };
        else state = "name";
        break;
      case "beforeValue":
        if (whitespace(char)) break;
        if (char === '"') state = "double";
        else if (char === "'") state = "single";
        else if (char === ">") return { end: index, selfClosing: false };
        else state = "unquoted";
        break;
      case "double":
        if (char === '"') state = "afterQuoted";
        break;
      case "single":
        if (char === "'") state = "afterQuoted";
        break;
      case "unquoted":
        if (whitespace(char)) state = "before";
        else if (char === ">") return { end: index, selfClosing: false };
        break;
      case "afterQuoted":
        if (whitespace(char)) state = "before";
        else if (char === "/") state = "solidus";
        else if (char === ">") return { end: index, selfClosing: false };
        else { state = "before"; index--; }
        break;
      case "solidus":
        if (char === ">") return { end: index, selfClosing: true };
        state = "before";
        index--;
        break;
    }
  }
  return undefined;
}

/** The normalized value, or throws `doesNotFit`. */
function normalize(html: string, context: OpenElement): string {
  const stack: OpenElement[] = [];
  let out = "";
  const current = (): OpenElement => stack.at(-1) ?? context;
  const inForeignContent = (): boolean => current().namespace !== "html" && !current().integration;
  const fail = (): never => { throw doesNotFit; };
  /** Closes the open elements from the top down to `index`, as the browser pops them. */
  const closeTo = (index: number): void => {
    for (let at = stack.length - 1; at >= index; at--) out += `</${stack[at]!.written}>`;
    stack.length = index;
  };
  const tableContext = isHtml(context, Object.keys(tableContent));
  /** Inside a table element of the context, outside any cell or caption the value opened. */
  const atTableLevel = (): boolean => tableContext && !stack.some((element) => isHtml(element, cellLike));
  const tableNames = ["td", "th", "caption", "tr", "tbody", "thead", "tfoot", "colgroup", "table", "template"];
  /** The open element whose table insertion mode applies, or `-1` for the context's. */
  const tableMode = (): number => lastIndex(stack, (element) => isHtml(element, tableNames));
  /** Whether the innermost select, table or template is a select, of the value or the context. */
  const inSelectMode = (): boolean => {
    for (let index = stack.length - 1; index >= 0; index--) {
      const element = stack[index]!;
      if (isHtml(element, ["select"])) return true;
      if (isHtml(element, tableNames)) return false;
    }
    return isHtml(context, ["select", "option", "optgroup"]);
  };
  /** Anything but a column or a template closes a column group of the value. */
  const leaveColumnGroup = (): void => {
    const index = tableMode();
    if (index >= 0 && isHtml(stack[index]!, ["colgroup"])) closeTo(index);
  };

  const text = (value: string): void => {
    if (/[^\t\n\f\r ]/.test(value)) {
      leaveColumnGroup();
      // The browser moves text out of a table to before it (foster parenting).
      if (atTableLevel()) fail();
    }
    out += value;
  };

  /** `<p>` in button scope: an open one of the value closes, the context or an ancestor does not fit. */
  const closeParagraph = (): void => {
    for (let index = stack.length - 1; index >= 0; index--) {
      const element = stack[index]!;
      if (isHtml(element, ["p"])) { closeTo(index); return; }
      if (bounds(element, "button")) return;
    }
    if (isHtml(context, ["p"])) fail();
    if (bounds(context, "button")) return;
    // Only an element that closes paragraphs itself can never sit inside one.
    if (context.namespace === "html" && (closesParagraph.has(context.name) || context.name === "body")) return;
    fail();
  };

  /** `<li>`, `<dd>` and `<dt>` close the nearest one before a special element other than address, div or p. */
  const closeListItem = (names: readonly string[]): void => {
    const stops = (element: OpenElement): boolean => isSpecial(element) && !isHtml(element, ["address", "div", "p"]);
    for (let index = stack.length - 1; index >= 0; index--) {
      const element = stack[index]!;
      if (isHtml(element, names)) { closeTo(index); return; }
      if (stops(element)) return;
    }
    if (isHtml(context, names)) fail();
    if (!stops(context)) fail();
  };

  /** A start tag that closes an open element of `name` in scope: `<button>`, `<nobr>`, `<a>`. */
  const closeInScope = (name: string, isBoundary: (element: OpenElement) => boolean): void => {
    for (let index = stack.length - 1; index >= 0; index--) {
      const element = stack[index]!;
      if (isHtml(element, [name])) { closeTo(index); return; }
      if (isBoundary(element)) return;
    }
    if (isHtml(context, [name])) fail();
  };

  const select = (name: string): void => {
    const selectAt = lastIndex(stack, (element) => isHtml(element, ["select"]));
    const inSelect = selectAt >= 0 || isHtml(context, ["select", "option", "optgroup"]);
    if (name === "select" || name === "input" || name === "keygen" || name === "textarea") {
      if (selectAt >= 0) closeTo(selectAt);
      else if (inSelect) fail();
      return;
    }
    const popCurrent = (names: readonly string[]): void => {
      const node = current();
      if (!isHtml(node, names)) return;
      if (node === context) fail();
      closeTo(stack.length - 1);
    };
    if (name === "option") popCurrent(["option"]);
    else if (name === "optgroup" || (name === "hr" && inSelect)) {
      popCurrent(["option"]);
      if (inSelect) popCurrent(["optgroup"]);
    }
  };

  /** `<rb>`, `<rp>`, `<rt>` and `<rtc>` generate implied end tags while a `<ruby>` is in scope. */
  const ruby = (name: string): void => {
    const implied = (element: OpenElement): boolean => isHtml(element, impliedEnd) && !((name === "rt" || name === "rp") && element.name === "rtc");
    while (stack.length > 0 && implied(current())) closeTo(stack.length - 1);
    if (stack.length === 0 && implied(context)) fail();
  };

  /**
   * A table tag in the insertion mode of the innermost cell, caption, row, section, column group,
   * table or template, of the value or of the context. Like the table modes, it closes the cell,
   * row or section it cannot live in, or clears the stack back to the table; when that would close
   * the context, the value does not fit.
   */
  const tableStructure = (name: string): void => {
    // A select inside a table closes on a table tag (it ignores col and colgroup).
    const selectAt = lastIndex(stack, (element) => isHtml(element, ["select"]));
    if (selectAt >= 0 && selectAt > tableMode() && name !== "col" && name !== "colgroup") closeTo(selectAt);
    for (;;) {
      const index = tableMode();
      const mode = index >= 0 ? stack[index]!.name : context.namespace === "html" ? context.name : "";
      const close = (): void => {
        if (index < 0) fail();
        closeTo(index);
      };
      // In a template, table parts switch to table modes that ignore most tags and their raw text.
      if (mode === "template") fail();
      if (mode === "td" || mode === "th" || mode === "caption") {
        if (name === "table") return;
        close();
      } else if (mode === "tr") {
        if (name === "td" || name === "th") { closeTo(index + 1); return; }
        close();
      } else if (mode === "tbody" || mode === "thead" || mode === "tfoot") {
        if (name === "tr" || name === "td" || name === "th") { closeTo(index + 1); return; }
        close();
      } else if (mode === "colgroup") {
        if (name === "col") { closeTo(index + 1); return; }
        close();
      } else if (mode === "table") {
        if (name !== "table") { closeTo(index + 1); return; }
        close();
      } else {
        // The body ignores table parts, but they would close an enclosing cell or caption of the page.
        if (name !== "table") fail();
        return;
      }
    }
  };

  const rawText = (name: string, rawTag: string, from: number): number => {
    const closing = new RegExp(`</${name}(?=[\\t\\n\\f\\r />])`, "ig");
    closing.lastIndex = from;
    const match = closing.exec(html);
    const content = html.slice(from, match ? match.index : html.length);
    // A script with `<!--` has escaped states where `</script>` may not end it.
    if (name === "script" && content.includes("<!--")) fail();
    out += `${rawTag}${content}</${name}>`;
    if (!match) return html.length;
    const end = tagEnd(html, match.index + name.length + 2);
    return end ? end.end + 1 : html.length;
  };

  const startTag = (index: number): number => {
    const name = /^[a-zA-Z][^\t\n\f\r />]*/.exec(html.slice(index + 1))![0];
    const end = tagEnd(html, index + 1 + name.length);
    if (!end) return html.length;
    const rawTag = html.slice(index, end.end + 1);
    const lower = name.toLowerCase();
    const next = end.end + 1;
    if (inForeignContent()) {
      const breaks = breakout.has(lower) || (lower === "font" && /[\s/](?:color|face|size)[\s/=>]/i.test(rawTag));
      if (!breaks) {
        // Foreign elements named like table parts, selects or templates trip parsers that ignore
        // the namespace when they reset the insertion mode; no SVG or MathML element uses those names.
        if (foreignLookalikes.has(lower)) fail();
        out += rawTag;
        const namespace = lower === "svg" && current().name === "annotation-xml" ? "svg" : current().namespace;
        if (!end.selfClosing) stack.push(openElement(lower, namespace, rawTag));
        return next;
      }
      // The tag leaves the foreign elements; it fits only if the value opened them.
      if (!stack.some((element) => element.namespace === "html" || element.integration)) fail();
      while (inForeignContent()) closeTo(stack.length - 1);
    }
    if (documentStructure.has(lower)) return next;
    // <plaintext> never ends; <noscript> is raw text with JavaScript and markup without it.
    if (lower === "plaintext" || lower === "noscript") fail();
    // In a select, older parsers ignore most start tags (and the raw text after them) while newer
    // ones keep them: only the tags both treat alike fit.
    if (inSelectMode() && !selectContent.has(lower)) fail();
    if (lower === "form" && !stack.some((element) => isHtml(element, ["template"]))) {
      // The browser ignores a form inside another (and inserts and closes one in a table at once),
      // and that form's end tag would close the outer one early.
      const mode = tableMode();
      const inTable = mode >= 0 && isHtml(stack[mode]!, ["table", "tbody", "thead", "tfoot", "tr"]);
      if (inTable || isHtml(context, ["form"]) || stack.some((element) => isHtml(element, ["form"]))) fail();
    }
    const table = tableParts.has(lower) || lower === "table";
    if (!table && lower !== "template") leaveColumnGroup();
    // In a table (not a column group) a hidden input stays where it is; anything else moves out.
    const hiddenInput = lower === "input" && context.name !== "colgroup" && /[\s/]type\s*=\s*["']?hidden(?:["'\s/>])/i.test(rawTag);
    if (atTableLevel() && !tableContent[context.name]!.has(lower) && !hiddenInput) fail();
    if (table) tableStructure(lower);
    if (lower === "li") closeListItem(["li"]);
    else if (lower === "dd" || lower === "dt") closeListItem(["dd", "dt"]);
    if (closesParagraph.has(lower)) closeParagraph();
    if (headings.has(lower) && isHtml(current(), headings)) {
      if (current() === context) fail();
      closeTo(stack.length - 1);
    }
    if (lower === "a") closeInScope("a", (element) => isHtml(element, formattingMarkers) || element.integration);
    else if (lower === "nobr") closeInScope("nobr", (element) => bounds(element));
    else if (lower === "button") closeInScope("button", (element) => bounds(element));
    select(lower);
    if (lower === "rb" || lower === "rp" || lower === "rt" || lower === "rtc") ruby(lower);
    if (lower === "svg" || lower === "math") {
      out += rawTag;
      if (!end.selfClosing) stack.push(openElement(lower, lower, rawTag));
      return next;
    }
    if (rawTextElements.has(lower)) {
      // A select ignores these start tags (or not, with the newer parser), so their text may be markup.
      const inSelect = stack.some((element) => isHtml(element, ["select"])) || isHtml(context, ["select", "option", "optgroup"]);
      if (inSelect && lower !== "script") fail();
      return rawText(lower, rawTag, next);
    }
    out += rawTag;
    if (!voidElements.has(lower)) stack.push(openElement(lower, "html", rawTag));
    return next;
  };

  const endTag = (index: number): number => {
    const name = /^[a-zA-Z][^\t\n\f\r />]*/.exec(html.slice(index + 2))![0];
    const end = tagEnd(html, index + 2 + name.length);
    if (!end) return html.length;
    const lower = name.toLowerCase();
    const open = lastIndex(stack, (element) => element.name === lower);
    if (open >= 0) closeTo(open);
    return end.end + 1;
  };

  /** A comment, closed if the value ends inside it. */
  const comment = (index: number): number => {
    const start = index + 4;
    if (html[start] === ">") { out += "<!---->"; return start + 1; }
    if (html.startsWith("->", start)) { out += "<!---->"; return start + 2; }
    const ends = ["-->", "--!>"].map((marker) => ({ at: html.indexOf(marker, start), length: marker.length })).filter((item) => item.at >= 0);
    const close = ends.sort((first, second) => first.at - second.at)[0];
    if (!close) { out += `${html.slice(index)}-->`; return html.length; }
    out += `<!--${html.slice(start, close.at)}-->`;
    return close.at + close.length;
  };

  /** `<!...>`, `<?...>` or `</ ...>`: a bogus comment up to the next `>`. A doctype is dropped. */
  const bogusComment = (index: number, drop: boolean): number => {
    const end = html.indexOf(">", index);
    if (!drop) out += end < 0 ? `${html.slice(index)}>` : html.slice(index, end + 1);
    return end < 0 ? html.length : end + 1;
  };

  let index = 0;
  while (index < html.length) {
    const open = html.indexOf("<", index);
    if (open < 0) { text(html.slice(index)); break; }
    if (open > index) text(html.slice(index, open));
    index = open;
    const next = html[index + 1];
    if (html.startsWith("<!--", index)) index = comment(index);
    else if (next === "!") {
      if (html.startsWith("[CDATA[", index + 2) && inForeignContent()) {
        const end = html.indexOf("]]>", index + 9);
        out += end < 0 ? `${html.slice(index)}]]>` : html.slice(index, end + 3);
        index = end < 0 ? html.length : end + 3;
      } else index = bogusComment(index, /^<!doctype/i.test(html.slice(index, index + 9)));
    } else if (next === "?") index = bogusComment(index, false);
    else if (next === "/") {
      const third = html[index + 2];
      if (third === ">") index += 3;
      else if (letter(third)) index = endTag(index);
      else if (third === undefined) { text("&lt;/"); index += 2; }
      else index = bogusComment(index, false);
    } else if (letter(next)) index = startTag(index);
    else {
      // A `<` that starts no tag is text; written as a reference so nothing joins it into one.
      text("&lt;");
      index++;
    }
  }
  closeTo(0);
  return out;
}

/**
 * The HTML of `html="..."` normalized for `<tag>` in `namespace`: balanced, without end tags that
 * would close the element, and written so the browser keeps every node inside the element. `""`
 * when the browser would move part of it out, so the element renders empty and the browser fills
 * it on hydration.
 */
export function normalizeHtmlContent(html: string, tag: string, namespace: HtmlContentNamespace = "html"): string {
  const context = openElement(tag.toLowerCase(), namespace, "");
  let content: string;
  try { content = normalize(html, context); }
  catch (error) {
    if (error === doesNotFit) return "";
    throw error;
  }
  // Right after `<pre>` the parser drops a newline; the content keeps its own by writing one more.
  if (isHtml(context, ["pre", "listing"]) && content.startsWith("\n")) content = `\n${content}`;
  return content;
}

/** The namespace of `element` among the ones `html="..."` fills. */
export function contentNamespace(element: Element): HtmlContentNamespace {
  if (element.namespaceURI === namespaceUris.svg) return "svg";
  return element.namespaceURI === namespaceUris.math ? "math" : "html";
}

const inertDocuments = new WeakMap<Document, Document>();

/**
 * `<tag>` in an inert document of `owner` with `html` parsed as its content, as `innerHTML` does:
 * scripts in it never run and nothing loads.
 */
export function inertElement(owner: Document, tag: string, namespace: HtmlContentNamespace, html: string): Element {
  let document = inertDocuments.get(owner);
  if (!document) {
    document = owner.implementation.createHTMLDocument("");
    inertDocuments.set(owner, document);
  }
  const element = namespace === "html" ? document.createElement(tag) : document.createElementNS(namespaceUris[namespace], tag);
  element.innerHTML = html;
  return element;
}
