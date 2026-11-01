/**
 * Development only: the Vite module of each component stylesheet, by the CSS that SSR inlines.
 * `meeko dev` compiles each component of the SSR graph with a call to {@link registerStyleModule},
 * and the document gives each inline `<style>` the `data-vite-dev-id` of its module. Vite's client
 * adopts such a `<style>` instead of appending a second copy at the end of `<head>`: the cascade
 * of the hydrated page is the one of the first paint, and a hot update replaces or prunes the
 * stylesheet that the server sent.
 */
const moduleIds = new Map<string, string>();

/** The component file of a style module id, without Vite's query. */
function moduleFile(id: string): string {
  const query = id.indexOf("?");
  return query < 0 ? id : id.slice(0, query);
}

/**
 * @internal Records that the processed `css` of a component is the Vite module `id`
 * (`Card.meeko?meeko-style=<hash>&lang.css`). A new version of the same component replaces the
 * previous entry, so hot updates do not accumulate stylesheets.
 */
export function registerStyleModule(css: string, id: string): void {
  if (!css) return;
  const file = moduleFile(id);
  for (const [known, knownId] of moduleIds) {
    if (moduleFile(knownId) === file) moduleIds.delete(known);
  }
  moduleIds.set(css, id);
}

/** The Vite module that serves `css` in development, when a compiled component registered it. */
export function styleModuleId(css: string): string | undefined {
  return moduleIds.get(css);
}
