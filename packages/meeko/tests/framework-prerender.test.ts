import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { prerenderRoutes } from "../src/framework/prerender.ts";
import { createRouteManifest } from "../src/framework/router.ts";
import { defer } from "../src/framework/deferred.ts";
import { createFrameworkHandler } from "../src/framework/server.ts";
import type { PageRoute } from "../src/framework/server.ts";
import { initFrameworkProject } from "../src/framework/init.ts";
import { linkRepositoryPackages, repositoryRoot, tempProject } from "./helpers/temp-project.ts";

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

test("prerender stores the HTML and navigation payload of one loader run and fails on a rejected deferred value", async () => {
  const root = await mkdtemp(join(tmpdir(), "meeko-prerender-once-"));
  const routes = createRouteManifest([{ id: "/", file: "index.meeko", layouts: [], sidecar: "index.route.ts", render: "prerender" }]);
  const page = {
    renderWithState: (props: Record<string, unknown>) => ({ html: `<p>run ${String((props.data as { run: number }).run)}</p>`, state: {} }),
  };
  try {
    let runs = 0;
    let rejectDeferred = false;
    const sidecar = (): PageRoute => ({
      render: "prerender",
      load: () => ({ run: ++runs, extra: rejectDeferred ? defer(Promise.reject(new Error("upstream down"))) : defer(Promise.resolve("ok")) }),
    });
    const handler = createFrameworkHandler({ routes, loadPage: async () => page, loadRoute: async () => sidecar(), onError: () => {} });
    await prerenderRoutes({ routes, handler, loadRoute: async () => sidecar(), outputRoot: root });
    assert.equal(runs, 1);
    const html = await readFile(join(root, "index.html"), "utf8");
    assert.match(html, /<p>run 1<\/p>/);
    const stored = await readFile(join(root, "index.meeko.json"), "utf8");
    assert.equal(stored, html.match(/<script id="meeko-payload" type="application\/json">(.*?)<\/script>/)![1]);
    assert.equal((JSON.parse(stored) as { props: { data: { run: number } } }).props.data.run, 1);

    rejectDeferred = true;
    await assert.rejects(prerenderRoutes({ routes, handler, loadRoute: async () => sidecar(), outputRoot: join(root, "failed") }), /Prerender \/ returned HTTP 500/);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("the prerender index hashes only what Meeko writes, never a <script> or <style> injected in the page", async () => {
  const root = await mkdtemp(join(tmpdir(), "meeko-prerender-hashes-"));
  const routes = createRouteManifest([{ id: "/", file: "index.meeko", layouts: [], render: "prerender" }]);
  const sha256 = (text: string): string => `'sha256-${createHash("sha256").update(text, "utf8").digest("base64")}'`;
  const page = {
    css: ".home{color:red}",
    renderWithState: () => ({ html: "<main><script>alert(1)</script><style>body{display:none}</style></main>", state: {} }),
  };
  try {
    const handler = createFrameworkHandler({
      routes, loadPage: async () => page, loadRoute: async () => ({ render: "prerender" }), onError: () => {},
      document: { head: "<script>window.head = 1</script>", bodyEnd: "<script>window.end = 1</script>" },
    });
    await prerenderRoutes({ routes, handler, loadRoute: async () => ({ render: "prerender" }), outputRoot: root });
    assert.match(await readFile(join(root, "index.html"), "utf8"), /<main><script>alert\(1\)<\/script>/);
    const index = JSON.parse(await readFile(join(root, "manifest.json"), "utf8")) as { pages: Record<string, { scriptHashes: string[]; styleHashes: string[] }> };
    assert.deepEqual(index.pages["/"]!.scriptHashes, [sha256("window.end = 1"), sha256("window.head = 1")].sort());
    assert.deepEqual(index.pages["/"]!.styleHashes, [sha256(".home{color:red}")]);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("a rejected render names the URL and route and carries the error with its stack and cause chain", async () => {
  const root = await mkdtemp(join(tmpdir(), "meeko-prerender-error-"));
  const routes = createRouteManifest([{ id: "/posts/[slug]", file: "post.meeko", layouts: [], sidecar: "post.route.ts" }]);
  const failure = new Error("catalog unavailable", { cause: new TypeError("socket closed", { cause: "ECONNRESET" }) });
  try {
    const rejection = await prerenderRoutes({
      routes, outputRoot: root,
      loadRoute: async () => ({ render: "prerender", prerenderEntries: [{ slug: "first" }] }),
      handler: async () => { throw failure; },
    }).then(() => undefined, (error: unknown) => error);
    assert.ok(rejection instanceof Error);
    assert.equal(rejection.cause, failure);
    assert.match(rejection.message, /^Prerender \/posts\/first \(post\.meeko\) failed: Error: catalog unavailable\n\s+at /);
    assert.match(rejection.message, /\nCaused by: TypeError: socket closed\n\s+at /);
    assert.match(rejection.message, /\nCaused by: ECONNRESET$/);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("meeko build fails on a page that throws while prerendering and prints its route, message, stack and cause", { timeout: 120_000 }, async (context) => {
  const root = await tempProject(context, "prerender-error");
  await initFrameworkProject(root);
  await writeFile(join(root, "app", "pages", "broken.meeko"), [
    '<script server lang="ts">',
    'export const route = definePage({ render: "prerender" });',
    "</script>",
    '<script lang="ts">',
    "function readCatalog(): string {",
    '  throw new Error("catalog unavailable while prerendering", { cause: new Error("upstream returned 503") });',
    "}",
    "const title = readCatalog();",
    "</script>",
    "<template><h1>{title}</h1></template>",
    "",
  ].join("\n"));
  await linkRepositoryPackages(root, ["@meekojs/meeko", "vite"]);
  const result = spawnSync(process.execPath, [join(repositoryRoot, "dist", "cli.js"), "build", root], { cwd: root, encoding: "utf8", windowsHide: true });
  const output = `${result.stdout}\n${result.stderr}`;
  assert.equal(result.status, 1, output);
  assert.match(result.stderr, /Prerender \/broken \([^)]*broken\.meeko\) failed: /, output);
  assert.match(result.stderr, /Error: catalog unavailable while prerendering\n\s+at /, output);
  assert.match(result.stderr, /Caused by: Error: upstream returned 503/, output);
  assert.doesNotMatch(output, /request error/, "the build prints the full error, not the private one-line report");
});
