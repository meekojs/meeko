/** A path with each segment in the encoding of `href()`, whether it arrives encoded or not. */
function encodedPath(path: string): string {
  return path.split("/").map((segment) => {
    try { return encodeURIComponent(decodeURIComponent(segment)); }
    catch { return segment; }
  }).join("/");
}

/**
 * @internal `aria-current` of a `<MeekoLink>`: `"page"` when the path of its href, without the
 * query string or the fragment, is the path of the committed route. Both paths are compared in the
 * encoding of `href()`, so `/categorías` and `/categor%C3%ADas` are the same route.
 */
export function linkCurrent(route: { readonly path: { readonly value: string } }, href: string): "page" | undefined {
  const path = href.split(/[?#]/, 1)[0]!;
  const current = route.path.value;
  return path === current || encodedPath(path) === encodedPath(current) ? "page" : undefined;
}
