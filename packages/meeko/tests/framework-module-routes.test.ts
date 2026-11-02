import assert from "node:assert/strict";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import test from "node:test";

import { createRouteManifest, matchRoute } from "../src/app/runtime/router.ts";
import { sitemapXml as publicSitemapXml } from "../src/framework.ts";
import { checkFrameworkProject } from "../src/framework/check-project.ts";
import { discoverConfiguredRoutes, extendModuleRoutes } from "../src/framework/config.ts";
import { sitemapXml } from "../src/framework/site-files.ts";
import { linkRepositoryPackages, tempProject } from "./helpers/temp-project.ts";

async function put(root: string, path: string, source: string): Promise<void> {
  const file = join(root, path);
  await mkdir(dirname(file), { recursive: true });
  await writeFile(file, source);
}

const page = (name: string): string => `<template><p>${name}</p></template>\n`;

test("extendRoutes adds routes that reuse the page files, in module order, validated as a manifest", async (context) => {
  const root = await tempProject(context, "module-extend-routes");
  await linkRepositoryPackages(root);
  await put(root, "meeko.config.mjs", 'export default { modules: ["./modules/prefix"] };\n');
  await put(root, "app/pages/index.meeko", page("home"));
  await put(root, "app/pages/guide.meeko", page("guide"));
  await put(root, "app/pages/docs/[slug].meeko", page("doc"));
  await put(root, "modules/prefix/index.ts", `import { defineMeekoModule } from "@meekojs/meeko/framework";
export default defineMeekoModule({ meta: { name: "prefix" }, setup(_options, meeko) {
  meeko.extendRoutes((routes) => [...routes, ...routes.map((route) => ({ ...route, id: route.id === "/" ? "/en" : \`/en\${route.id}\` }))]);
} });
`);
  const routes = await discoverConfiguredRoutes(root);
  assert.deepEqual(routes.map((route) => route.id), ["/en/docs/[slug]", "/en/guide", "/docs/[slug]", "/en", "/guide", "/"]);
  const english = matchRoute(routes, "/en/docs/intro");
  assert.equal(english?.route.id, "/en/docs/[slug]");
  assert.deepEqual(english?.params, { slug: "intro" });
  // The alias shares the page file, layouts and options of its route.
  assert.equal(english?.route.file, matchRoute(routes, "/docs/intro")?.route.file);
  assert.equal(Object.isFrozen(routes), true);

  // A collision names the module that produced it.
  await put(root, "modules/collide/index.ts", `import { defineMeekoModule } from "@meekojs/meeko/framework";
export default defineMeekoModule({ meta: { name: "collide" }, setup(_options, meeko) {
  meeko.extendRoutes((routes) => [...routes, { ...routes[0], file: "other.meeko" }]);
} });
`);
  await put(root, "meeko.config.mjs", 'export default { modules: ["./modules/prefix", "./modules/collide"] };\n');
  await assert.rejects(discoverConfiguredRoutes(root), /Módulo de Meeko collide: extendRoutes: Route collision/);
});

const prefixModule = `import { defineMeekoModule } from "@meekojs/meeko/framework";
export default defineMeekoModule({ meta: { name: "prefix" }, setup(_options, meeko) {
  meeko.extendRoutes((routes) => [...routes, ...routes.map((route) => ({ ...route, id: route.id === "/" ? "/en" : \`/en\${route.id}\` }))]);
} });
`;

test("meeko check accepts routes that extendRoutes adds over pages with <script server> and an inherited layout", { timeout: 240_000 }, async (context) => {
  const root = await tempProject(context, "module-extend-routes-check");
  await linkRepositoryPackages(root);
  await put(root, "package.json", '{"private":true,"type":"module"}\n');
  await put(root, "meeko.config.mjs", 'export default { modules: ["./modules/prefix"] };\n');
  await put(root, "modules/prefix/index.ts", prefixModule);
  await put(root, "app/app.meeko", "<template><MeekoOutlet /></template>\n");
  await put(root, "app/layouts/docs.meeko", '<script lang="ts">\nconst props = defineProps<{ title?: string; wide?: boolean }>();\n</script>\n<template><h1>{props.title}</h1><MeekoOutlet /></template>\n');
  await put(root, "app/pages/index.meeko", page("home"));
  await put(root, "app/pages/docs/+group.ts", 'export default defineGroup({ layout: "docs", layoutProps: { wide: true } });\n');
  // Top-level server code: usePage() is typed from the page's own route.
  const body = (title: string): string => `<script server lang="ts">
const { params } = usePage();
export const slug: string = params.slug;
export const route = definePage({ layoutProps: { title: ${title} } });
</script>
<script lang="ts">
const props = defineProps<{ params: { slug: string }; data: { slug: string } }>();
</script>
<template><p>{props.data.slug}</p></template>
`;
  await put(root, "app/pages/docs/[slug].meeko", body('"Doc"'));
  // definePage only, with a loader.
  await put(root, "app/pages/docs/guide.meeko", `<script server lang="ts">
export const route = definePage({ load: () => ({ n: 1 }), layoutProps: { title: "Guía" } });
</script>
<script lang="ts">
const props = defineProps<{ data: { n: number } }>();
</script>
<template><p>{props.data.n}</p></template>
`);
  assert.deepEqual(await checkFrameworkProject(root), []);
  const contracts = await readFile(join(root, ".meeko", "generated", "page-contracts.server.ts"), "utf8");
  const names = [...contracts.matchAll(/^type (__\w+)/gm)].map((match) => match[1]);
  assert.deepEqual(names.filter((name, index) => names.indexOf(name) !== index), [], "no duplicate identifiers");
  // Each route checks the page against its own params; layoutProps are checked once per file.
  for (const id of ["/docs/[slug]", "/en/docs/[slug]", "/docs/guide", "/en/docs/guide"]) assert.ok(contracts.includes(`GeneratedRoutes[${JSON.stringify(id)}]`), id);
  assert.equal(contracts.match(/__CheckLayoutProps<__WrittenLayoutProps<[^\n]*"app\/pages\/docs\/\[slug\]\.meeko"/g)?.length, 1);
  assert.equal(contracts.match(/__CheckLayoutProps<__WrittenLayoutProps<[^\n]*"app\/pages\/docs\/guide\.meeko"/g)?.length, 1);
  assert.equal(contracts.match(/"app\/pages\/docs\/\+group\.ts"/g)?.length, 1);
  const block = await readFile(join(root, ".meeko", "routes", "app", "pages", "docs", "[slug].meeko.route.ts"), "utf8");
  assert.match(block, /PageRequestOf<typeof __meeko_request_route, "\/docs\/\[slug\]">/);

  // A wrong prop is still reported for the shared page file.
  await put(root, "app/pages/docs/[slug].meeko", body("1"));
  await assert.rejects(checkFrameworkProject(root), /Las layoutProps de app\/pages\/docs\/\[slug\]\.meeko no coinciden con las props del layout docs/);

  // `export const layoutProps`, typed by its own values: with the inherited layout and with its own.
  const exported = (title: string, route = ""): string => `<script server lang="ts">
${route}const { params } = usePage();
export const slug: string = params.slug;
const title = ${title};
export const layoutProps = { title };
</script>
<script lang="ts">
const props = defineProps<{ params: { slug: string }; data: { slug: string } }>();
</script>
<template><p>{props.data.slug}</p></template>
`;
  await put(root, "app/pages/docs/[slug].meeko", exported("params.slug"));
  assert.deepEqual(await checkFrameworkProject(root), []);
  await put(root, "app/pages/docs/[slug].meeko", exported("1"));
  await assert.rejects(checkFrameworkProject(root), /Las layoutProps de app\/pages\/docs\/\[slug\]\.meeko no coinciden con las props del layout docs/);
  const chosen = 'export const route = definePage({ layout: "docs" });\n';
  await put(root, "app/pages/docs/[slug].meeko", exported("params.slug", chosen));
  assert.deepEqual(await checkFrameworkProject(root), []);
  await put(root, "app/pages/docs/[slug].meeko", exported("1", chosen));
  await assert.rejects(checkFrameworkProject(root), /TS2322|TS2352|TS1360/);
  await put(root, "app/pages/docs/[slug].meeko", exported("params.slug", chosen).replace("{ title }", "{ title, unknownProp: 1 }"));
  await assert.rejects(checkFrameworkProject(root), /TS2322|TS2352|TS1360/);
});

test("extendModuleRoutes validates each result and keeps the routes without extenders", () => {
  const routes = createRouteManifest([{ id: "/", file: "index.meeko", layouts: [] }]);
  assert.equal(extendModuleRoutes(routes, []), routes);
  assert.throws(() => extendModuleRoutes(routes, [{ module: "bad", extend: () => undefined as never }]), /Módulo de Meeko bad: extendRoutes debe devolver la lista de rutas/);
  assert.throws(() => extendModuleRoutes(routes, [{ module: "bad", extend: () => [{ id: "nope", file: "x.meeko", layouts: [] }] }]), /Módulo de Meeko bad: extendRoutes: Route must start with \//);
  const removed = extendModuleRoutes(routes, [{ module: "a", extend: (current) => [...current, { id: "/b", file: "b.meeko", layouts: [] }] }, { module: "c", extend: (current) => current.filter((route) => route.id !== "/") }]);
  assert.deepEqual(removed.map((route) => route.id), ["/b"]);
});

test("sitemapXml writes the language versions of a URL as xhtml:link alternates", () => {
  assert.equal(sitemapXml("https://example.com", [
    { pathname: "/guide", alternates: [{ hreflang: "es", pathname: "/guide" }, { hreflang: "en", pathname: "/en/guide" }, { hreflang: "x-default", pathname: "/guide" }] },
    { pathname: "/a&b" },
  ]), [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9" xmlns:xhtml="http://www.w3.org/1999/xhtml">',
    '  <url><loc>https://example.com/guide</loc><xhtml:link rel="alternate" hreflang="es" href="https://example.com/guide"/><xhtml:link rel="alternate" hreflang="en" href="https://example.com/en/guide"/><xhtml:link rel="alternate" hreflang="x-default" href="https://example.com/guide"/></url>',
    "  <url><loc>https://example.com/a&amp;b</loc></url>",
    "</urlset>", "",
  ].join("\n"));
  assert.throws(() => sitemapXml("https://example.com", [{ pathname: "/", alternates: [{ hreflang: 'en"x', pathname: "/en" }] }]), /invalid hreflang/);
  assert.throws(() => sitemapXml("https://example.com", [{ pathname: "/", alternates: [{ hreflang: "en", pathname: "en" }] }]), /must be a pathname that starts with \//);
});

test("sitemapXml is public: the build's function, with no Node imports for the browser and Workers", async () => {
  assert.equal(publicSitemapXml, sitemapXml);
  assert.equal(publicSitemapXml("https://example.com", [{ pathname: "/guide", lastmod: "2026-11-01", changefreq: "weekly", priority: 0.5 }]), [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">',
    "  <url><loc>https://example.com/guide</loc><lastmod>2026-11-01</lastmod><changefreq>weekly</changefreq><priority>0.5</priority></url>",
    "</urlset>", "",
  ].join("\n"));
  assert.doesNotMatch(await readFile(new URL("../src/framework/sitemap-xml.ts", import.meta.url), "utf8"), /from "node:/);
});
