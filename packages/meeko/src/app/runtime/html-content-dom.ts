import type { HtmlContentNamespace } from "../../core/html-content.js";

const namespaceUris: Record<HtmlContentNamespace, string> = {
  html: "http://www.w3.org/1999/xhtml",
  svg: "http://www.w3.org/2000/svg",
  math: "http://www.w3.org/1998/Math/MathML",
};

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
