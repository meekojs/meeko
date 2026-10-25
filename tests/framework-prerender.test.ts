import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { prerenderRoutes } from "../src/framework/prerender.ts";
import { createRouteManifest } from "../src/framework/router.ts";

test("prerender writes static and explicit dynamic HTML under one output root", async () => {
  const root = await mkdtemp(join(tmpdir(), "meeko-prerender-"));
  const routes = createRouteManifest([
    { id: "/", file: "index.meeko", layouts: [], sidecar: "index.route.ts" },
    { id: "/posts/[slug]", file: "post.meeko", layouts: [], sidecar: "post.route.ts" },
    { id: "/account", file: "account.meeko", layouts: [], sidecar: "account.route.ts" },
  ]);
  const requests: string[] = [];
  try {
    const outputs = await prerenderRoutes({
      routes,
      outputRoot: join(root, ".meeko/output/prerender"),
      loadRoute: async (file) => file === "post.route.ts"
        ? { render: "prerender", prerenderEntries: [{ slug: "one" }, { slug: "two" }] }
        : file === "index.route.ts" ? { render: "prerender" } : { render: "ssr" },
      handler: async (request) => {
        const path = new URL(request.url).pathname;
        if (request.headers.get("accept") === "application/meeko+json") {
          return new Response(JSON.stringify({ route: path }), { headers: { "content-type": "application/meeko+json; charset=utf-8" } });
        }
        requests.push(path);
        return new Response(`<!doctype html><html><head><title>${path}</title></head><body><main>${path}</main></body></html>`, { headers: { "content-type": "text/html" } });
      },
      transformHtml: (html) => html + "<!-- generated -->",
    });
    assert.equal(outputs.length, 3);
    assert.deepEqual([...requests].sort(), ["/", "/posts/one", "/posts/two"]);
    const home = await readFile(join(root, ".meeko/output/prerender/index.html"), "utf8");
    assert.match(home, /generated/);
    assert.match(await readFile(join(root, ".meeko/output/prerender/posts/two/index.html"), "utf8"), /posts\/two/);
    assert.deepEqual(JSON.parse(await readFile(join(root, ".meeko/output/prerender/posts/two/index.meeko.json"), "utf8")), { route: "/posts/two" });
    const manifest = JSON.parse(await readFile(join(root, ".meeko/output/prerender/manifest.json"), "utf8")) as {
      version: number; pages: Record<string, { file: string; headOffset: number; etag: string; payload?: string }>;
    };
    assert.equal(manifest.version, 1);
    assert.deepEqual(Object.keys(manifest.pages), requests);
    const entry = manifest.pages["/posts/two"]!;
    assert.equal(entry.file, "posts/two/index.html");
    assert.equal(entry.payload, "posts/two/index.meeko.json");
    assert.match(entry.etag, /^"[A-Za-z0-9_-]{27}"$/);
    // The CSRF meta tag is inserted where the stored document's head closes.
    assert.equal(home.slice(manifest.pages["/"]!.headOffset).startsWith("</head>"), true);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("dynamic prerender requires entries and rejects a shadowed URL", async () => {
  const root = await mkdtemp(join(tmpdir(), "meeko-prerender-"));
  const routes = createRouteManifest([
    { id: "/posts/new", file: "new.meeko", layouts: [] },
    { id: "/posts/[slug]", file: "post.meeko", layouts: [], sidecar: "post.route.ts" },
  ]);
  try {
    await assert.rejects(prerenderRoutes({
      routes, outputRoot: root,
      loadRoute: async () => ({ render: "prerender" }),
      handler: async () => new Response("<main/>", { headers: { "content-type": "text/html" } }),
    }), /requires prerenderEntries/);
    await assert.rejects(prerenderRoutes({
      routes, outputRoot: root,
      loadRoute: async () => ({ render: "prerender", prerenderEntries: [{ slug: "new" }] }),
      handler: async () => new Response("<main/>", { headers: { "content-type": "text/html" } }),
    }), /shadowed/);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("prerender fails on non-success or non-HTML response", async () => {
  const root = await mkdtemp(join(tmpdir(), "meeko-prerender-"));
  try {
    const routes = createRouteManifest([{ id: "/", file: "index.meeko", layouts: [], sidecar: "index.route.ts" }]);
    await assert.rejects(prerenderRoutes({
      routes, outputRoot: root,
      loadRoute: async () => ({ render: "prerender" }),
      handler: async () => new Response("fail", { status: 500 }),
    }), /HTTP 500/);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("SSR remains default for an unmarked static route", async () => {
  const root = await mkdtemp(join(tmpdir(), "meeko-prerender-"));
  try {
    const routes = createRouteManifest([{ id: "/", file: "index.meeko", layouts: [] }]);
    const outputs = await prerenderRoutes({
      routes, outputRoot: root,
      handler: async () => { throw new Error("Unmarked route must not render"); },
    });
    assert.deepEqual(outputs, []);
    assert.deepEqual(JSON.parse(await readFile(join(root, "manifest.json"), "utf8")), { version: 1, pages: {} });
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("prerender rejects a document without a head for the CSRF token", async () => {
  const root = await mkdtemp(join(tmpdir(), "meeko-prerender-"));
  try {
    const routes = createRouteManifest([{ id: "/", file: "index.meeko", layouts: [], render: "prerender" }]);
    await assert.rejects(prerenderRoutes({
      routes, outputRoot: root,
      handler: async () => new Response("<main>No head</main>", { headers: { "content-type": "text/html" } }),
    }), /Prerendered \/ has no <head>; the CSRF token cannot be inserted/);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
