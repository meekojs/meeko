import assert from "node:assert/strict";
import test from "node:test";
import { parse } from "parse5";
import { normalizeHtmlContent } from "../src/html-content.ts";
import type { HtmlContentNamespace } from "../src/html-content.ts";

/** A parse5 node, as far as these checks read it. */
interface ParsedNode {
  readonly nodeName: string;
  readonly data?: string;
  readonly attrs?: ReadonlyArray<{ readonly name: string; readonly value: string }>;
  readonly childNodes?: ParsedNode[];
  readonly content?: ParsedNode;
  readonly parentNode?: ParsedNode | null;
  readonly sourceCodeLocation?: { readonly startOffset: number } | null;
}

/** Where the element with `html="..."` sits in the page: a valid parent for it. */
interface Placement {
  readonly tag: string;
  readonly namespace?: HtmlContentNamespace;
  readonly open: string;
  readonly close: string;
}

const cell = { open: "<table><tbody><tr><td>", close: "</td></tr></tbody></table>" };
const placements: readonly Placement[] = [
  { tag: "div", open: "<div>", close: "</div>" },
  { tag: "div", open: "<ul><li>", close: "</li></ul>" },
  { tag: "div", ...cell },
  { tag: "p", open: "<div>", close: "</div>" },
  { tag: "p", ...cell },
  { tag: "span", open: "<p>", close: "</p>" },
  { tag: "span", open: "<ul><li>", close: "</li></ul>" },
  { tag: "span", open: "<h2>", close: "</h2>" },
  { tag: "span", ...cell },
  { tag: "em", open: "<p>", close: "</p>" },
  { tag: "a", open: "<p>", close: "</p>" },
  { tag: "a", open: "<div>", close: "</div>" },
  { tag: "li", open: "<ul>", close: "</ul>" },
  { tag: "dd", open: "<dl>", close: "</dl>" },
  { tag: "td", open: "<table><tbody><tr>", close: "</tr></tbody></table>" },
  { tag: "th", open: "<table><thead><tr>", close: "</tr></thead></table>" },
  { tag: "tr", open: "<table><tbody>", close: "</tbody></table>" },
  { tag: "tbody", open: "<table>", close: "</table>" },
  { tag: "table", open: "<div>", close: "</div>" },
  { tag: "caption", open: "<table>", close: "</table>" },
  { tag: "colgroup", open: "<table>", close: "</table>" },
  { tag: "select", open: "<div>", close: "</div>" },
  { tag: "option", open: "<select>", close: "</select>" },
  { tag: "optgroup", open: "<select>", close: "</select>" },
  { tag: "h2", open: "<div>", close: "</div>" },
  { tag: "pre", open: "<div>", close: "</div>" },
  { tag: "button", open: "<p>", close: "</p>" },
  { tag: "article", open: "<div>", close: "</div>" },
  { tag: "ul", open: "<div>", close: "</div>" },
  { tag: "form", open: "<div>", close: "</div>" },
  { tag: "rt", open: "<ruby>", close: "</ruby>" },
  { tag: "label", open: "<form>", close: "</form>" },
  { tag: "svg", namespace: "svg", open: "<div>", close: "</div>" },
  { tag: "g", namespace: "svg", open: "<div><svg>", close: "</svg></div>" },
  { tag: "foreignObject", namespace: "svg", open: "<div><svg>", close: "</svg></div>" },
  { tag: "math", namespace: "math", open: "<p>", close: "</p>" },
];

const tokens = [
  "text", " ", "\n", "&amp;", "<", "</", ">", "<b>", "</b>", "<i>", "</i>", "<p>", "</p>", "<div>", "</div>", "<span>", "</span>",
  "<a href=x>", "</a>", "<li>", "</li>", "<ul>", "</ul>", "<dl>", "<dd>", "<dt>", "<table>", "</table>", "<tbody>", "<tr>", "</tr>",
  "<td>", "</td>", "<th>", "<caption>", "<col>", "<colgroup>", "<select>", "</select>", "<option>", "</option>", "<optgroup>",
  "<input>", "<input type=hidden>", "<textarea>", "</textarea>", "<script>x()", "</script>", "<style>", "</style>", "<title>",
  "<svg>", "</svg>", "<circle/>", "<foreignObject>", "</foreignObject>", "<math>", "<mi>", "</math>", "<h2>", "</h2>", "<h3>",
  "<button>", "</button>", "<form>", "</form>", "<br>", "</br>", "<hr>", "<pre>", "</pre>", "<!-- c -->", "<!--", "<![CDATA[x]]>",
  "<!doctype html>", "<body class=x>", "</body>", "</html>", "<xmp>", "</xmp>", "<template>", "</template>", "<rt>", "<rp>",
  "<ruby>", "</ruby>", "<nobr>", "<plaintext>", "<iframe>", "<noscript>", "</noscript>", "<font color=red>", "<image>", "</ x>",
  "<?pi>", "<b", '<div data-meeko-e-0="">', "<a title='>'>", '<p a="<div>">', '<em ="x><div>">', "<listing>", "<details>",
];

/** Small deterministic generator, so a failure always reproduces. */
function random(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let value = state;
    value = Math.imul(value ^ (value >>> 15), value | 1);
    value ^= value + Math.imul(value ^ (value >>> 7), value | 61);
    return ((value ^ (value >>> 14)) >>> 0) / 4294967296;
  };
}

/** Every node with its parent; the content of a `<template>` belongs to the template. */
function nodes(root: ParsedNode): Map<ParsedNode, ParsedNode | undefined> {
  const parents = new Map<ParsedNode, ParsedNode | undefined>([[root, undefined]]);
  const visit = (node: ParsedNode): void => {
    for (const child of [...(node.childNodes ?? []), ...(node.content?.childNodes ?? [])]) {
      parents.set(child, node);
      visit(child);
    }
  };
  visit(root);
  return parents;
}

function inside(node: ParsedNode, ancestor: ParsedNode, parents: Map<ParsedNode, ParsedNode | undefined>): boolean {
  for (let current: ParsedNode | undefined = node; current; current = parents.get(current)) if (current === ancestor) return true;
  return false;
}

/**
 * Parses the page with `content` written inside the element and checks, with parse5 as the
 * browser, that every node of the content stays inside the element and the template after it
 * keeps its place.
 */
function assertStaysInside(placement: Placement, content: string, input: string): void {
  const before = `<!DOCTYPE html><html><head></head><body><section>${placement.open}<${placement.tag} data-probe="">`;
  const page = `${before}${content}</${placement.tag}><!--after-->${placement.close}</section><b data-tail=""></b></body></html>`;
  const document = parse(page, { sourceCodeLocationInfo: true }) as unknown as ParsedNode;
  const parents = nodes(document);
  const all = [...parents.keys()];
  const label = `${placement.open}<${placement.tag}> ${JSON.stringify(input)} -> ${JSON.stringify(content)}`;
  const probes = all.filter((node) => node.attrs?.some((attribute) => attribute.name === "data-probe"));
  assert.equal(probes.length, 1, label);
  const element = probes[0]!;
  const end = before.length + content.length;
  for (const node of all) {
    const offset = node.sourceCodeLocation?.startOffset;
    if (offset === undefined || offset < before.length || offset >= end) continue;
    assert.ok(inside(node, element, parents), `${label}: ${node.nodeName} left the element`);
  }
  const after = all.find((node) => node.nodeName === "#comment" && node.data === "after");
  assert.ok(after && parents.get(after) === parents.get(element), `${label}: the template after the element moved`);
  const tail = all.find((node) => node.attrs?.some((attribute) => attribute.name === "data-tail"));
  assert.equal(tail && parents.get(tail)?.nodeName, "body", `${label}: the page after the component moved`);
}

test("normalized html content never leaves its element (parse5 as the browser)", () => {
  const next = random(20261026);
  let kept = 0;
  let total = 0;
  for (const placement of placements) {
    for (let round = 0; round < 300; round++) {
      const length = 1 + Math.floor(next() * 7);
      const input = Array.from({ length }, () => tokens[Math.floor(next() * tokens.length)]!).join("");
      // A form inside a form of the page is the documented exception: it depends on ancestors only.
      if (placement.open.includes("<form") && input.includes("<form")) continue;
      const content = normalizeHtmlContent(input, placement.tag, placement.namespace);
      assertStaysInside(placement, content, input);
      if (placement.tag === "div" && placement.open === "<div>") {
        total++;
        if (content !== "") kept++;
      }
    }
  }
  // Most tag soup still renders in SSR; only what the browser would move is left to the client.
  assert.ok(kept / total > 0.5, `only ${kept} of ${total} values fit in a <div>`);
});

test("normalized html content keeps valid HTML and closes or drops what would leave the element", () => {
  const markdown = `<h2 id="uso">Uso</h2>\n<p>Texto con <a href="/x">enlace</a> y <code>&lt;b&gt;</code>.</p>\n<ul><li>uno</li><li>dos <em>x</em></li></ul>\n<pre><code>\nconst a = 1;\n</code></pre>\n<table><thead><tr><th>A</th></tr></thead><tbody><tr><td>1</td></tr></tbody></table>`;
  assert.equal(normalizeHtmlContent(markdown, "article"), markdown);
  assert.equal(normalizeHtmlContent("<b>Hola", "div"), "<b>Hola</b>");
  assert.equal(normalizeHtmlContent("x</div><span>y</span>", "div"), "x<span>y</span>");
  assert.equal(normalizeHtmlContent("<style>.a{}", "div"), "<style>.a{}</style>");
  assert.equal(normalizeHtmlContent("a<!-- abierto", "div"), "a<!-- abierto-->");
  assert.equal(normalizeHtmlContent("<p>a<div>b</div>", "section"), "<p>a</p><div>b</div>");
  assert.equal(normalizeHtmlContent("<li>a<li>b", "ul"), "<li>a</li><li>b</li>");
  assert.equal(normalizeHtmlContent("<tr><td>1<td>2", "tbody"), "<tr><td>1</td><td>2</td></tr>");
  assert.equal(normalizeHtmlContent("<b>a<i>b</b>c", "p"), "<b>a<i>b</i></b>c");
  assert.equal(normalizeHtmlContent("1 < 2", "span"), "1 &lt; 2");
  // Content that the browser would move out of the element renders it empty.
  assert.equal(normalizeHtmlContent("<div>x</div>", "p"), "");
  assert.equal(normalizeHtmlContent("<div>x</div>", "span"), "", "a <span> may sit inside a <p>");
  assert.equal(normalizeHtmlContent("a<li>b", "li"), "");
  assert.equal(normalizeHtmlContent("texto", "tbody"), "");
  assert.equal(normalizeHtmlContent("<td>x</td>", "div"), "", "a cell closes an enclosing cell");
  assert.equal(normalizeHtmlContent("<h3>x</h3>", "h2"), "");
  assert.equal(normalizeHtmlContent("<div>x</div>", "svg", "svg"), "");
  assert.equal(normalizeHtmlContent("<plaintext>x", "div"), "");
  assert.equal(normalizeHtmlContent("<circle r='1'/><foreignObject><div>x</div></foreignObject>", "svg", "svg"), "<circle r='1'/><foreignObject><div>x</div></foreignObject>");
  // A newline right after <pre> is dropped by the parser, so the content's own one is written twice.
  assert.equal(normalizeHtmlContent("\nlinea", "pre"), "\n\nlinea");
  // Document structure tags would change the page's own <html> or <body>; doctypes are dropped.
  assert.equal(normalizeHtmlContent("<!doctype html><body onload=x>a</body>", "div"), "a");
});
