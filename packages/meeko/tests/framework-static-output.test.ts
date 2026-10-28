import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import type { AddressInfo } from "node:net";
import { join } from "node:path";
import test from "node:test";
import { pathToFileURL } from "node:url";
import { buildProject } from "../src/framework/project.ts";
import { previewStatic } from "../src/framework/static-adapter.ts";
import { staticAppConfig, writeStaticApp } from "./helpers/static-app.ts";
import { tempProject } from "./helpers/temp-project.ts";

const sha256 = (text: string): string => `'sha256-${createHash("sha256").update(text, "utf8").digest("base64")}'`;

async function files(directory: string): Promise<string[]> {
  return (await readdir(directory, { recursive: true, withFileTypes: true }))
    .filter((entry) => entry.isFile())
    .map((entry) => join(entry.parentPath, entry.name).slice(directory.length + 1).replaceAll("\\", "/"))
    .sort();
}

test("the static adapter rejects what needs a server and a URL it cannot know, before building", { timeout: 60_000 }, async (context) => {
  const root = await tempProject(context, "static-reject");
  await writeStaticApp(root, staticAppConfig);
  await writeFile(join(root, "app", "pages", "live.meeko"), "<template><p>live</p></template>\n");
  await mkdir(join(root, "server", "api"), { recursive: true });
  await writeFile(join(root, "server", "api", "time.get.ts"), 'import { defineApiRoute } from "@meekojs/meeko/server";\n\nexport default defineApiRoute({ handler: () => ({ now: 1 }) });\n');
  await assert.rejects(buildProject(root), (error: Error) => {
    assert.match(error.message, /El adaptador static genera un sitio sin servidor/);
    assert.match(error.message, /páginas que no usan render: "prerender": \/live \(app\/pages\/live\.meeko, "ssr"\)/);
    assert.match(error.message, /endpoints de API: GET \/api\/time \(server\/api\/time\.get\.ts\)/);
    return true;
  });
  await writeFile(join(root, "meeko.config.mjs"), 'export default { document: { seo: true }, sitemap: true, server: { adapter: "static" } };\n');
  await assert.rejects(buildProject(root, { adapter: "node" }), /sitemap y document\.seo \(canonical y og:url\) necesitan la URL pública del sitio/);
});

test("the static adapter writes a site for any static host, with 404.html, sitemap, robots and the CSP of its inline scripts", { timeout: 180_000 }, async (context) => {
  let server: import("node:http").Server | undefined;
  const root = await tempProject(context, "static-output", () => new Promise<void>((done) => server ? server.close(() => done()) : done()));
  await writeStaticApp(root, staticAppConfig);
  const result = await buildProject(root);
  assert.deepEqual(result, { adapter: "static", output: join(root, ".meeko", "output", "static") });
  const output = await files(result.output);
  for (const file of [
    "index.html", "index.meeko.json", "docs/a/index.html", "docs/a/index.meeko.json", "docs/b/index.html", "docs/b/index.meeko.json",
    "404.html", "sitemap.xml", "robots.txt", "_headers", "_meeko/headers.conf", "hello.txt",
  ]) assert.ok(output.includes(file), `${file} in ${output.join(", ")}`);
  assert.ok(output.some((file) => /^assets\/.+\.js$/.test(file)));
  assert.ok(!output.some((file) => file.startsWith(".vite/") || file === "manifest.json" || file.startsWith("prerender/")), output.join(", "));
  const read = (file: string): Promise<string> => readFile(join(result.output, ...file.split("/")), "utf8");
  const home = await read("index.html");
  assert.match(home, /<link rel="canonical" href="https:\/\/example\.com\/">/);
  const doc = await read("docs/a/index.html");
  assert.match(doc, /<title>Doc a · Test<\/title>/);
  assert.match(doc, /<meta property="og:url" content="https:\/\/example\.com\/docs\/a">/);
  assert.match(doc, /<meta property="og:title" content="Doc a · Test">/);
  assert.match(doc, /<meta property="og:description" content="About a">/);
  assert.equal(JSON.parse(await read("docs/a/index.meeko.json")).route, "/docs/[slug]");
  const notFound = await read("404.html");
  assert.match(notFound, /<p id="error">(?:<!--[^>]*-->)?404/);
  assert.match(notFound, /"error":true/);
  assert.doesNotMatch(notFound, /canonical|og:url/);
  assert.equal(await read("sitemap.xml"), [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">',
    "  <url><loc>https://example.com/</loc></url>",
    "  <url><loc>https://example.com/docs/a</loc></url>",
    "  <url><loc>https://example.com/docs/b</loc></url>",
    "</urlset>", "",
  ].join("\n"));
  assert.equal(await read("robots.txt"), "User-agent: *\nDisallow: /private/\n\nSitemap: https://example.com/sitemap.xml\n");
  const csp = `default-src 'self'; img-src 'self' data:; style-src 'self' 'unsafe-inline'; object-src 'none'; script-src 'self' ${sha256("window.boot = 1")}`;
  assert.equal(await read("_headers"), `# Generado por meeko build --adapter static.\n/*\n  Content-Security-Policy: ${csp}\n  X-Content-Type-Options: nosniff\n`);
  assert.match(await read("_meeko/headers.conf"), new RegExp(`add_header Content-Security-Policy "${csp.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}" always;\nadd_header X-Content-Type-Options "nosniff" always;\n$`));
  // The client of a static build reads each page's payload file.
  const bundles = await Promise.all(output.filter((file) => file.endsWith(".js")).map(read));
  assert.ok(bundles.some((code) => code.includes("index.meeko.json")));
  // The static entry has its own file: the entry that `meeko dev` and `meeko check` share keeps
  // negotiating Accept, so a static build during dev does not send navigation to payload files.
  const sharedEntry = await readFile(join(root, ".meeko", "generated", "entry-client.ts"), "utf8");
  assert.match(sharedEntry, /serverData: true,/);
  assert.doesNotMatch(sharedEntry, /serverData: "static"/);
  assert.match(await readFile(join(root, ".meeko", "build", "entry-client-static.ts"), "utf8"), /serverData: "static",/);

  // meeko preview answers like a static host, with the headers of the build.
  const previous = { port: process.env.MEEKO_PORT, host: process.env.MEEKO_HOST };
  process.env.MEEKO_PORT = "0";
  process.env.MEEKO_HOST = "127.0.0.1";
  try { server = await previewStatic(root); }
  finally {
    if (previous.port === undefined) delete process.env.MEEKO_PORT; else process.env.MEEKO_PORT = previous.port;
    if (previous.host === undefined) delete process.env.MEEKO_HOST; else process.env.MEEKO_HOST = previous.host;
  }
  const origin = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  const page = await fetch(`${origin}/docs/a`);
  assert.equal(page.status, 200);
  assert.equal(page.headers.get("content-security-policy"), csp);
  assert.equal(page.headers.get("x-content-type-options"), "nosniff");
  assert.match(await page.text(), /<p id="doc">(?:<!--[^>]*-->)?a</);
  const payload = await fetch(`${origin}/docs/a/index.meeko.json`);
  assert.equal(payload.headers.get("content-type"), "application/json; charset=utf-8");
  assert.equal((await payload.json() as { route: string }).route, "/docs/[slug]");
  const missing = await fetch(`${origin}/docs/zz`);
  assert.equal(missing.status, 404);
  assert.match(await missing.text(), /<p id="error">(?:<!--[^>]*-->)?404/);
  for (const hidden of ["/_headers", "/_meeko/headers.conf", "/..%2fpackage.json", "/%2e%2e/package.json"]) {
    const response = await fetch(`${origin}${hidden}`);
    assert.equal(response.status, 404, hidden);
    await response.body?.cancel();
  }
  assert.equal(await (await fetch(`${origin}/hello.txt`)).text(), "hello\n");
});

test("with sitemap and robots, the Node output serves both from its asset manifest and the prerender index has the script hashes", { timeout: 180_000 }, async (context) => {
  const root = await tempProject(context, "node-sitemap");
  await writeStaticApp(root, '{ site: "https://example.com", sitemap: true, robots: true, document: { head: { script: [{ children: "window.boot = 1" }] } } }');
  const result = await buildProject(root, { adapter: "node" });
  const index = JSON.parse(await readFile(join(result.output, "prerender", "manifest.json"), "utf8")) as { pages: Record<string, { scriptHashes?: string[] }> };
  assert.deepEqual(Object.keys(index.pages).sort(), ["/", "/docs/a", "/docs/b"]);
  assert.deepEqual(index.pages["/"]?.scriptHashes, [sha256("window.boot = 1")]);
  const { createNodeApp } = await import(`${pathToFileURL(join(result.output, "index.mjs")).href}?test=${Date.now()}`) as { createNodeApp(options: { prerendering: boolean }): Promise<{ fetch(request: Request): Promise<Response>; close(): Promise<void> }> };
  // Production needs a persistent session store; the asset reader is the same while prerendering.
  const app = await createNodeApp({ prerendering: true });
  try {
    const sitemap = await app.fetch(new Request("http://localhost/sitemap.xml"));
    assert.equal(sitemap.status, 200);
    assert.equal(sitemap.headers.get("content-type"), "application/xml; charset=utf-8");
    assert.match(await sitemap.text(), /<loc>https:\/\/example\.com\/docs\/b<\/loc>/);
    const robots = await app.fetch(new Request("http://localhost/robots.txt"));
    assert.equal(await robots.text(), "User-agent: *\nAllow: /\n\nSitemap: https://example.com/sitemap.xml\n");
    // The client of a server build keeps negotiating Accept.
    const page = await app.fetch(new Request("http://localhost/docs/a", { headers: { accept: "application/meeko+json" } }));
    assert.equal(page.headers.get("content-type"), "application/meeko+json; charset=utf-8");
    await page.body?.cancel();
  } finally {
    await app.close();
  }
});
