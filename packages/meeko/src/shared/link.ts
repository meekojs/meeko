/** A path with each segment in the encoding of `href()`, whether it arrives encoded or not. */
function encodedPath(path: string): string {
  return path.split("/").map((segment) => {
    try { return encodeURIComponent(decodeURIComponent(segment)); }
    catch { return segment; }
  }).join("/");
}

/**
 * Whether `href` is the committed `path`: `"page"` when its path, without the query string or the
 * fragment, is that path; with `prefix`, `"true"` when the path is below it by whole segments
 * (`/dashboard` covers `/dashboard/stats`, not `/dashboards`). `/` only matches itself, or it would
 * cover every page. Both paths are compared in the encoding of `href()`, so `/categorías` and
 * `/categor%C3%ADas` are the same route.
 */
export function routeCurrent(path: string, href: string, prefix: boolean): "page" | "true" | false {
  const target = encodedPath(href.split(/[?#]/, 1)[0]!);
  const current = encodedPath(path);
  if (target === current) return "page";
  if (!prefix) return false;
  const base = target.replace(/\/+$/, "");
  return base !== "" && current.startsWith(`${base}/`) ? "true" : false;
}

/**
 * @internal `aria-current` of a `<MeekoLink>`: `"page"` when the path of its href is the path of
 * the committed route and, with `match="prefix"`, `"true"` when the route is below it (see
 * {@link routeCurrent}); no attribute otherwise.
 */
export function linkCurrent(route: { readonly path: { readonly value: string } }, href: string, match?: "exact" | "prefix"): "page" | "true" | undefined {
  return routeCurrent(route.path.value, href, match === "prefix") || undefined;
}
