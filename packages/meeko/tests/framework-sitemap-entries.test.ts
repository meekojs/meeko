import assert from "node:assert/strict";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import test from "node:test";
import { buildProject } from "../src/framework/project.ts";
import { createRouteManifest } from "../src/framework/router.ts";
import { discoverRoutes } from "../src/framework/routes-discovery.ts";
import { collectSitemapEntries, sitemapEntryRoutes, sitemapUrls, sitemapXml } from "../src/framework/site-files.ts";
import type { SitemapEntriesContext } from "../src/framework/config-type.ts";
import { staticAppConfig, writeStaticApp } from "./helpers/static-app.ts";
import { tempProject } from "./helpers/temp-project.ts";

const context: SitemapEntriesContext = { env: { POST: "hello" }, prerendering: true };

async function write(root: string, files: Record<string, string>): Promise<void> {
  for (const [file, contents] of Object.entries(files)) {
    const path = join(root, ...file.split("/"));
    await mkdir(dirname(path), { recursive: true });
    await writeFile(path, contents);
  }
}

test("sitemapEntries adds SSR URLs with their fields, completes prerendered pages and keeps exclude and noindex", async (context_) => {
  const root = await tempProject(context_, "sitemap-entries");
  await write(root, {
    "index.html": "<html><head></head></html>",
    "docs/a/index.html": "<html><head></head></html>",
    "docs/b/index.html": '<html><head><meta name="robots" content="noindex"></head></html>',
  });
  const index = {
    version: 1 as const,
    pages: Object.fromEntries(["/", "/docs/a", "/docs/b"].map((pathname) => [pathname, { file: `${pathname === "/" ? "" : `${pathname.slice(1)}/`}index.html`, headOffset: 0, etag: '"x"' }])),
  };
  const routes = createRouteManifest([
    { id: "/", file: "index.meeko", layouts: [], render: "prerender" },
    { id: "/docs/[slug]", file: "doc.meeko", layouts: [], render: "prerender", sidecar: "doc.route.ts" },
    { id: "/posts/[id]", file: "post.meeko", layouts: [], sidecar: "post.route.ts" },
    { id: "/about", file: "about.meeko", layouts: [], sidecar: "about.route.ts" },
    { id: "/users/[id]", file: "user.meeko", layouts: [], sidecar: "user.route.ts" },
  ]);
  const options: Record<string, unknown> = {
    "doc.route.ts": { render: "prerender", sitemapEntries: [{ params: { slug: "a" }, priority: 0.9 }, { params: { slug: "b" }, priority: 0.1 }] },
    "post.route.ts": { sitemapEntries: async ({ env }: SitemapEntriesContext) => [
      { params: { id: env.POST! }, lastmod: new Date("2026-10-01T10:00:00Z"), changefreq: "weekly" },
      { params: { id: "draft" } },
    ] },
    "about.route.ts": { sitemapEntries: () => [{ lastmod: "2026-09-30" }] },
    "user.route.ts": { load: () => 1 },
  };
  const loaded: string[] = [];
  const loadRoute = async (key: string): Promise<unknown> => { loaded.push(key); return options[key]; };
  const declared = await collectSitemapEntries({ routes, declared: new Set(["/docs/[slug]", "/posts/[id]", "/about"]), loadRoute, context });
  assert.deepEqual(loaded.sort(), ["about.route.ts", "doc.route.ts", "post.route.ts"]);
  const urls = await sitemapUrls({ index, prerenderDirectory: root, routes, declared, exclude: ["/posts/draft"] });
  assert.deepEqual(urls, [
    { pathname: "/" },
    { pathname: "/about", lastmod: "2026-09-30" },
    { pathname: "/docs/a", priority: 0.9 },
    { pathname: "/posts/hello", lastmod: "2026-10-01T10:00:00.000Z", changefreq: "weekly" },
  ]);
  assert.equal(sitemapXml("https://example.com", urls), [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">',
    "  <url><loc>https://example.com/</loc></url>",
    "  <url><loc>https://example.com/about</loc><lastmod>2026-09-30</lastmod></url>",
    "  <url><loc>https://example.com/docs/a</loc><priority>0.9</priority></url>",
    "  <url><loc>https://example.com/posts/hello</loc><lastmod>2026-10-01T10:00:00.000Z</lastmod><changefreq>weekly</changefreq></url>",
    "</urlset>", "",
  ].join("\n"));

  // A prerender route lists only its prerendered pages.
  const missing = await collectSitemapEntries({ routes, declared: new Set(["/docs/[slug]"]), context, loadRoute: async () => ({ render: "prerender", sitemapEntries: [{ params: { slug: "zz" } }] }) });
  await assert.rejects(sitemapUrls({ index, prerenderDirectory: root, routes, declared: missing }), /route \/docs\/\[slug\] lists \/docs\/zz, which is not prerendered/);
  const collect = (value: unknown, id = "/posts/[id]"): Promise<unknown> => collectSitemapEntries({ routes, declared: new Set([id]), context, loadRoute: async () => value });
  await assert.rejects(collect({ sitemapEntries: [{ params: { id: "a" } }, { params: { id: "a" } }] }), /duplicate sitemap URL/);
  await assert.rejects(collect({ sitemapEntries: [{ params: { id: "a" }, priority: 2 }] }), /priority must be a number from 0 to 1/);
  await assert.rejects(collect({ sitemapEntries: [{ params: { id: "a" }, lastmod: "yesterday" }] }), /lastmod must be a Date or a W3C Datetime/);
  await assert.rejects(collect({ sitemapEntries: [{ params: { id: "a" }, changefreq: "often" }] }), /changefreq must be/);
  await assert.rejects(collect({ sitemapEntries: [{}] }), /Missing route parameter|parameter/i);
  await assert.rejects(collect({ sitemapEntries: () => "nope" }), /must be a list/);
  await assert.rejects(collect({ render: "client", sitemapEntries: [{}] }, "/about"), /render: "client" and cannot declare sitemapEntries/);
});

test("discovery reads which routes name sitemapEntries and rejects them on a client page", async (context_) => {
  const root = await tempProject(context_, "sitemap-discovery");
  await write(root, {
    "app/pages/posts/[id].meeko": "<template><p>Post</p></template>\n",
    "app/pages/posts/[id].route.ts": 'export const route = definePage({ sitemapEntries: [{ params: { id: "a" } }] });\n',
    "app/pages/about.meeko": '<script server lang="ts">\nexport const route = definePage({ sitemapEntries: [{ lastmod: "2026-10-01" }] });\n</script>\n<template><p>About</p></template>\n',
    "app/pages/index.meeko": "<template><p>Home</p></template>\n",
  });
  assert.deepEqual([...await sitemapEntryRoutes(await discoverRoutes(root))].sort(), ["/about", "/posts/[id]"]);
  await writeFile(join(root, "app", "pages", "posts", "[id].route.ts"), 'export const route = definePage({ render: "client", sitemapEntries: [] });\n');
  await assert.rejects(discoverRoutes(root), /una página render: "client" no declara sitemapEntries/);
});

test("meeko build lists sitemapEntries of an SSR dynamic route with the Node adapter, and completes prerendered pages with the static adapter", { timeout: 360_000 }, async (context_) => {
  const node = await tempProject(context_, "sitemap-entries-node");
  await writeStaticApp(node, '{ site: "https://example.com", sitemap: { exclude: ["/posts/hidden"] }, robots: true }');
  await write(node, {
    "app/pages/posts/[id].meeko": [
      '<script lang="ts">',
      "const props = defineProps<{ params: { id: string }; search: Record<string, string | string[]> }>();",
      "</script>",
      '<template><p id="post">{props.params.id}</p></template>',
      "",
    ].join("\n"),
    "app/pages/posts/[id].route.ts": [
      'import { definePage } from "@meekojs/meeko/framework";',
      "",
      "export const route = definePage({",
      '  sitemapEntries: async ({ env, prerendering }) => prerendering ? [{ params: { id: env.MEEKO_TEST_SITEMAP_POST ?? "missing" }, lastmod: "2026-10-01", changefreq: "daily" }, { params: { id: "hidden" } }] : [],',
      "});",
      "",
    ].join("\n"),
  });
  process.env.MEEKO_TEST_SITEMAP_POST = "hello";
  try {
    const result = await buildProject(node, { adapter: "node" });
    const sitemap = await readFile(join(result.output, "client", "sitemap.xml"), "utf8");
    assert.match(sitemap, /<url><loc>https:\/\/example\.com\/posts\/hello<\/loc><lastmod>2026-10-01<\/lastmod><changefreq>daily<\/changefreq><\/url>/);
    assert.match(sitemap, /<loc>https:\/\/example\.com\/docs\/a<\/loc>/);
    assert.doesNotMatch(sitemap, /posts\/hidden/);
    assert.equal(await readFile(join(result.output, "client", "robots.txt"), "utf8"), "User-agent: *\nAllow: /\n\nSitemap: https://example.com/sitemap.xml\n");
  } finally {
    delete process.env.MEEKO_TEST_SITEMAP_POST;
  }

  const site = await tempProject(context_, "sitemap-entries-static");
  await writeStaticApp(site, staticAppConfig);
  await write(site, {
    "app/pages/docs/[slug].route.ts": [
      'import { definePage } from "@meekojs/meeko/framework";',
      "",
      'export const route = definePage({ render: "prerender", prerenderEntries: [{ slug: "a" }, { slug: "b" }], sitemapEntries: [{ params: { slug: "a" }, lastmod: "2026-10-01", priority: 0.8 }] });',
      "",
    ].join("\n"),
  });
  const output = (await buildProject(site)).output;
  assert.equal(await readFile(join(output, "sitemap.xml"), "utf8"), [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">',
    "  <url><loc>https://example.com/</loc></url>",
    "  <url><loc>https://example.com/docs/a</loc><lastmod>2026-10-01</lastmod><priority>0.8</priority></url>",
    "  <url><loc>https://example.com/docs/b</loc></url>",
    "</urlset>", "",
  ].join("\n"));
});
