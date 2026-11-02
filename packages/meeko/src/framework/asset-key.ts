/**
 * URL pathname of a build file exactly as WHATWG URL serializes it, which is
 * what `new URL(request.url).pathname` yields for a browser request. `%`, `?`,
 * `#`, `\`, spaces and control characters in names are data, not URL syntax.
 */
export function assetKey(segments: readonly string[]): string {
  const escaped = segments.map((segment) => segment.replace(/[%?#\\ \u0000-\u001f\u007f]/g, (character) => encodeURIComponent(character)));
  return new URL(`/${escaped.join("/")}`, "http://meeko.invalid").pathname;
}
