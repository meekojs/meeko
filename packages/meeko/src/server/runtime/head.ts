import { escapeHtml } from "../../core/server";
import { CONFIG_LEVEL, HEAD_END_MARKER, HEAD_START_MARKER, ROUTE_LEVEL, documentHeadInput, normalizeHeadInput, rawText } from "../../shared/head";
import type { DocumentConfig, HeadEntry, HeadInput, HeadTag, ResolvedHead } from "../../shared/head";

/**
 * Collects the head entries of a server render. A suspended pass starts over with `clear`. Values
 * of getters and signals are read when the document is assembled, after the render.
 */
export class HeadCollector {
  readonly live = false;
  private readonly sources: Array<{ level: number; order: number; read: () => HeadInput }> = [];

  add(level: number, read: () => HeadInput): void {
    this.sources.push({ level, order: this.sources.length, read });
  }

  clear(): void {
    this.sources.length = 0;
  }

  entries(): HeadEntry[] {
    return this.sources.map(({ level, order, read }) => ({ level, order, input: normalizeHeadInput(read(), "useHead") }));
  }
}

/** The head entries of a document besides its components: `document` of the configuration and the route head. */
export function documentHeadEntries(config: DocumentConfig | undefined, route: HeadInput | undefined): HeadEntry[] {
  return [
    { level: CONFIG_LEVEL, order: 0, input: documentHeadInput(config) },
    { level: ROUTE_LEVEL, order: 0, input: route },
  ];
}


function renderAttributes(entries: Iterable<readonly [string, string | true]>): string {
  let html = "";
  for (const [name, value] of entries) html += value === true ? ` ${name}` : ` ${name}="${escapeHtml(value)}"`;
  return html;
}

/** HTML of one resolved tag; inline scripts and styles, and external scripts, carry the CSP nonce. */
export function renderHeadTag(tag: HeadTag, nonce: string | undefined): string {
  const nonceAttribute = nonce && (tag.tag === "script" || tag.tag === "style") ? ` nonce="${escapeHtml(nonce)}"` : "";
  const open = `<${tag.tag}${renderAttributes(tag.attributes)}${nonceAttribute}>`;
  return tag.tag === "meta" || tag.tag === "link" ? open : `${open}${rawText(tag)}</${tag.tag}>`;
}

/** The parts of a Meeko document that the head decides. */
export interface HeadDocument {
  /** `<!doctype html><html …><head><meta charset>` and the default tags; the CSRF meta tag follows it. */
  readonly prefix: string;
  /** `<title>` and the managed tags between their markers. */
  readonly head: string;
  /** The `<body …>` open tag. */
  readonly bodyOpen: string;
}

/** Renders the resolved head of a server document. */
export function renderHeadDocument(head: ResolvedHead, nonce: string | undefined): HeadDocument {
  let prefix = `<!doctype html><html${renderAttributes(head.htmlAttrs)}><head><meta charset="utf-8">`;
  let managed = `<!--${HEAD_START_MARKER}-->`;
  if (head.title !== undefined) managed += `<title>${escapeHtml(head.title)}</title>`;
  for (const tag of head.tags) {
    if (tag.fallback) prefix += renderHeadTag(tag, nonce);
    else managed += renderHeadTag(tag, nonce);
  }
  return { prefix, head: `${managed}<!--${HEAD_END_MARKER}-->`, bodyOpen: `<body${renderAttributes(head.bodyAttrs)}>` };
}

