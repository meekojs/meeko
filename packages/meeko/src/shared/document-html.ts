/**
 * The placeholder of a `documentHtml` value in the payload of its document. It is a comment, so a
 * read that reaches the page by mistake shows nothing and runs nothing. Its number is a position in
 * the `documentHtml` list of that payload, which only the server writes: a value that imitates the
 * placeholder can at most name a value that the server declares marked in its next response.
 */
const placeholder = /^<!--meeko:document-html:(\d+)-->$/;

/** The placeholder of the value at `index` of the `documentHtml` list of a payload. */
export function documentHtmlPlaceholder(index: number): string {
  return `<!--meeko:document-html:${index}-->`;
}

/** The position that `html` names when it is a placeholder. */
export function documentHtmlIndex(html: string): number | undefined {
  const match = placeholder.exec(html);
  return match ? Number(match[1]) : undefined;
}
