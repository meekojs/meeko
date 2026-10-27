/**
 * @internal `aria-current` of a `<MeekoLink>`: `"page"` when the path of its href, without the
 * query string or the fragment, is the path of the committed route.
 */
export function linkCurrent(route: { readonly path: { readonly value: string } }, href: string): "page" | undefined {
  const path = href.split(/[?#]/, 1)[0];
  return path === route.path.value ? "page" : undefined;
}
