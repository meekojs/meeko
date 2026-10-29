import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import test from "node:test";
import { contentSecurityPolicy, createServerApp, defineApiRoute, defineServerRuntime, MemorySessionStore, SessionManager } from "../src/framework-server.ts";
import type { AppManifest, PrerenderedPage, ServerApp, ServerAppOptions } from "../src/framework-server.ts";
import { discoverAppManifest } from "../src/framework/app-manifest.ts";
import { loadMeekoConfig } from "../src/framework/config.ts";
import { DOCUMENT_HEAD_PREFIX } from "../src/framework/server.ts";
import { inlineScriptHashes, inlineStyleHashes } from "../src/framework/script-hashes.ts";
import { resolveThemeConfig, themeScript } from "../src/framework/theme.ts";
import { createTempProject } from "./helpers/temp-project.ts";

const sha256 = (text: string): string => `'sha256-${createHash("sha256").update(text, "utf8").digest("base64")}'`;
const theme = resolveThemeConfig(true)!;
const JSON_POLICY = "default-src 'none'; frame-ancestors 'none'";

const basePolicy = {
  "default-src": ["'self'"],
  "script-src": ["'self'"],
  // Shiki and other highlighters write style="…" attributes: a nonce here would turn them off.
  "style-src": ["'self'", "'unsafe-inline'"],
  "object-src": ["'none'"],
};

function manifest(overrides: Partial<AppManifest> = {}): AppManifest {
  return {
    version: 1,
    routes: [
      { id: "/", file: "/app/pages/index.meeko", layouts: [], sidecar: "/app/pages/index.route.ts", render: "prerender" },
      { id: "/about", file: "/app/pages/about.meeko", layouts: [], sidecar: "/app/pages/about.route.ts" },
    ],
    server: {
      api: [{ kind: "api", file: "/server/api/ping.get.ts", pathname: "/api/ping", method: "GET", clientKey: "ping" }],
      rpc: [],
      socket: [],
    },
    routeMiddleware: [],
    serverMiddleware: ["/server/middleware/10-header.ts"],
    client: { entry: "/assets/entry-abc.js", css: [], preload: [] },
    document: { theme },
    contentSecurityPolicy: basePolicy,
    ...overrides,
  };
}

function modules(rendered: string[]): Record<string, unknown> {
  const page = (name: string) => ({
    css: `.${name}{color:red}`,
    renderWithState() {
      rendered.push(name);
      return { html: `<h1>${name}</h1>`, state: {} };
    },
  });
  return {
    "/app/pages/index.meeko": page("home"),
    "/app/pages/about.meeko": page("about"),
    "/app/pages/index.route.ts": { route: { render: "prerender" } },
    "/app/pages/about.route.ts": { route: { load: () => ({ ok: true }) } },
    "/server/api/ping.get.ts": { default: defineApiRoute({ contentType: "response", handler: () => Response.json({ pong: true }) }) },
    "/server/middleware/10-header.ts": { default: async (_request: Request, next: () => Promise<Response>) => {
      const response = await next();
      const headers = new Headers(response.headers);
      headers.set("x-frame-options", "SAMEORIGIN");
      return new Response(response.body, { status: response.status, headers });
    } },
  };
}

async function app(options: Partial<ServerAppOptions> & { manifest?: AppManifest } = {}): Promise<{ server: ServerApp; rendered: string[] }> {
  const rendered: string[] = [];
  const table = modules(rendered);
  const server = await createServerApp({
    manifest: manifest(),
    production: true,
    runtime: defineServerRuntime(() => ({ sessions: new SessionManager({ store: new MemorySessionStore(), secure: false }), onError: () => {} })),
    load: async (key) => {
      if (!Object.hasOwn(table, key)) throw new Error(`Missing ${key}`);
      return table[key];
    },
    ...options,
  });
  return { server, rendered };
}

const html = (server: ServerApp, path: string, headers: Record<string, string> = {}): Promise<Response> =>
  server.fetch(new Request(`http://local.test${path}`, { headers: { accept: "text/html", ...headers } }));

test("an SSR document gets a nonce per response in script-src, never next to 'unsafe-inline'", async () => {
  const { server } = await app();
  try {
    const first = await html(server, "/about");
    const csp = first.headers.get("content-security-policy") ?? "";
    const nonce = /script-src 'self' 'nonce-([A-Za-z0-9_-]+)'/.exec(csp)?.[1];
    assert.ok(nonce, csp);
    assert.match(csp, /style-src 'self' 'unsafe-inline'(;|$)/, "the style directive keeps 'unsafe-inline' working");
    assert.match(csp, /object-src 'none'/);
    const body = await first.text();
    assert.ok(body.includes(`<script nonce="${nonce}">${themeScript(theme)}</script>`), "the theme script runs with the nonce");
    assert.ok(body.includes(`<script type="module" nonce="${nonce}" src="/assets/entry-abc.js"></script>`));
    assert.ok(body.includes(`<style nonce="${nonce}">.about{color:red}</style>`));
    const second = await html(server, "/about");
    assert.notEqual(/'nonce-([^']+)'/.exec(second.headers.get("content-security-policy") ?? "")?.[1], nonce, "every response has its own nonce");
    await second.text();
  } finally {
    await server.close();
  }
  // A strict style-src gets the nonce too, so Meeko's <style> elements still apply.
  const strict = await app({ manifest: manifest({ contentSecurityPolicy: { "default-src": ["'self'"] } }) });
  try {
    const response = await html(strict.server, "/about");
    const csp = response.headers.get("content-security-policy") ?? "";
    assert.match(csp, /^default-src 'self'; script-src 'self' 'nonce-[^']+'; style-src 'self' 'nonce-[^']+'$/);
    await response.text();
  } finally {
    await strict.server.close();
  }
});

test("API, RPC and navigation JSON get default-src 'none'; other responses the configured policy", async () => {
  const { server } = await app();
  try {
    const api = await server.fetch(new Request("http://local.test/api/ping"));
    assert.equal(api.status, 200);
    assert.equal(api.headers.get("content-security-policy"), JSON_POLICY);
    await api.text();
    // Whatever the RPC answers (here, an unknown procedure), its JSON runs nothing.
    const rpc = await server.fetch(new Request("http://local.test/_meeko/rpc/missing", { method: "POST", headers: { origin: "http://local.test" } }));
    assert.equal(rpc.headers.get("content-security-policy"), JSON_POLICY);
    await rpc.text();
    const payload = await server.fetch(new Request("http://local.test/about", { headers: { accept: "application/meeko+json" } }));
    assert.equal(payload.headers.get("content-security-policy"), JSON_POLICY);
    await payload.text();
    const missing = await server.fetch(new Request("http://local.test/nothing.txt"));
    assert.equal(missing.status, 404);
    assert.equal(missing.headers.get("content-security-policy"), contentSecurityPolicy(basePolicy));
    await missing.text();
  } finally {
    await server.close();
  }
});

test("prerendered pages are still served from their file with the hashes of the index, also with a host nonce", async () => {
  const inline = "window.ready = true";
  const stored = `${DOCUMENT_HEAD_PREFIX}<style>.home{color:red}</style><script>${inline}</script></head><body><div id="app"><h1>home</h1></div></body></html>`;
  const page: PrerenderedPage = {
    html: stored, headOffset: DOCUMENT_HEAD_PREFIX.length, etag: "\"home\"",
    scriptHashes: inlineScriptHashes(stored).hashes, styleHashes: inlineStyleHashes(stored),
  };
  // Before 1.7 a nonce turned prerendered pages into SSR: Meeko's CSP serves the file by its hashes.
  const { server, rendered } = await app({
    prerender: { get: async (pathname) => pathname === "/" ? page : undefined },
    document: { nonce: () => "host-nonce" },
  });
  try {
    const response = await html(server, "/");
    assert.equal(response.status, 200);
    assert.equal(await response.text(), stored);
    assert.deepEqual(rendered, [], "the stored HTML is sent, not rendered again");
    const csp = response.headers.get("content-security-policy") ?? "";
    assert.ok(csp.includes(`script-src 'self' ${sha256(inline)}`), csp);
    assert.doesNotMatch(csp, /nonce-/);
    // The style hash is not added next to 'unsafe-inline'.
    assert.match(csp, /style-src 'self' 'unsafe-inline'(;|$)/);
    const revalidated = await html(server, "/", { "if-none-match": "\"home\"" });
    assert.equal(revalidated.status, 304);
    assert.equal(revalidated.headers.get("content-security-policy"), null);
  } finally {
    await server.close();
  }
  // An index written before the hashes: Meeko computes them from the HTML once.
  const legacy = await app({ prerender: { get: async (pathname) => pathname === "/" ? { html: stored, headOffset: page.headOffset, etag: page.etag } : undefined } });
  try {
    const response = await html(legacy.server, "/");
    assert.ok((response.headers.get("content-security-policy") ?? "").includes(sha256(inline)));
    assert.equal(await response.text(), stored);
  } finally {
    await legacy.server.close();
  }
});

test("a prerendered page without index hashes allows Meeko's inline code, never a <script> or <style> injected in the page", async () => {
  const injected = "alert(document.cookie)";
  const stored = `${DOCUMENT_HEAD_PREFIX}<style>.home{color:red}</style><script>window.head = 1</script></head><body><div id="app"><main><script>${injected}</script><style>body{display:none}</style></main></div>`
    + `<div id="modal"><script>window.teleported = 1</script></div><script id="meeko-payload" type="application/json">{}</script><script>window.end = 1</script></body></html>`;
  const { server } = await app({ prerender: { get: async (pathname) => pathname === "/" ? { html: stored, headOffset: DOCUMENT_HEAD_PREFIX.length, etag: "\"h\"" } : undefined } });
  try {
    const response = await html(server, "/");
    assert.equal(await response.text(), stored);
    const csp = response.headers.get("content-security-policy") ?? "";
    assert.ok(csp.includes(sha256("window.head = 1")) && csp.includes(sha256("window.end = 1")), csp);
    assert.ok(!csp.includes(sha256(injected)), csp);
    assert.ok(!csp.includes(sha256("window.teleported = 1")), csp);
  } finally {
    await server.close();
  }
  // Strict styles: the page's <style> is allowed, the injected one is not.
  const strict = await app({
    manifest: manifest({ contentSecurityPolicy: { "default-src": ["'self'"] } }),
    prerender: { get: async (pathname) => pathname === "/" ? { html: stored, headOffset: DOCUMENT_HEAD_PREFIX.length, etag: "\"h\"" } : undefined },
  });
  try {
    const response = await html(strict.server, "/");
    await response.text();
    const csp = response.headers.get("content-security-policy") ?? "";
    assert.ok(csp.includes(sha256(".home{color:red}")), csp);
    assert.ok(!csp.includes(sha256("body{display:none}")), csp);
  } finally {
    await strict.server.close();
  }
});

test("'strict-dynamic' gets the nonce even next to 'unsafe-inline', and script-src-elem gets it like style-src-elem", async () => {
  const strictDynamic = await app({ manifest: manifest({ contentSecurityPolicy: { "script-src": ["'strict-dynamic'", "'unsafe-inline'", "https:"], "object-src": ["'none'"] } }) });
  try {
    const response = await html(strictDynamic.server, "/about");
    const csp = response.headers.get("content-security-policy") ?? "";
    const nonce = /script-src 'strict-dynamic' 'unsafe-inline' https: 'nonce-([A-Za-z0-9_-]+)'/.exec(csp)?.[1];
    assert.ok(nonce, csp);
    assert.ok((await response.text()).includes(`<script type="module" nonce="${nonce}" src="/assets/entry-abc.js"></script>`));
  } finally {
    await strictDynamic.server.close();
  }
  // Without 'strict-dynamic', 'unsafe-inline' still keeps the directive as written.
  const inline = await app({ manifest: manifest({ contentSecurityPolicy: { "script-src": ["'self'", "'unsafe-inline'"] } }) });
  try {
    const response = await html(inline.server, "/about");
    assert.equal(response.headers.get("content-security-policy"), "script-src 'self' 'unsafe-inline'");
    await response.text();
  } finally {
    await inline.server.close();
  }
  const elements = await app({ manifest: manifest({ contentSecurityPolicy: { "script-src": ["'self'"], "script-src-elem": ["'self'"], "style-src-elem": ["'self'"] } }) });
  try {
    const response = await html(elements.server, "/about");
    const csp = response.headers.get("content-security-policy") ?? "";
    assert.match(csp, /^script-src 'self'; script-src-elem 'self' 'nonce-[^']+'; style-src-elem 'self' 'nonce-[^']+'$/);
    await response.text();
  } finally {
    await elements.server.close();
  }
  // The public builder sends the hashes to script-src-elem too.
  const hash = sha256("window.ready = true");
  assert.equal(contentSecurityPolicy({ "script-src": ["'self'"], "script-src-elem": ["'self'"] }, [hash]), `script-src 'self'; script-src-elem 'self' ${hash}`);
});

test("the one-time cookie of a form result renders a prerendered page instead of serving its file", async () => {
  const stored = `${DOCUMENT_HEAD_PREFIX}</head><body><div id="app"><h1>stored</h1></div></body></html>`;
  const { server, rendered } = await app({ prerender: { get: async (pathname) => pathname === "/" ? { html: stored, headOffset: DOCUMENT_HEAD_PREFIX.length, etag: "\"s\"" } : undefined } });
  try {
    const response = await html(server, "/", { cookie: "meeko-form=done" });
    assert.match(await response.text(), /<h1>home<\/h1>/);
    assert.deepEqual(rendered, ["home"]);
    assert.match(response.headers.get("content-security-policy") ?? "", /'nonce-/);
  } finally {
    await server.close();
  }
});

test("server.headers adds global and per-path headers without replacing the response's own", async () => {
  const { server } = await app({
    manifest: manifest({
      contentSecurityPolicy: undefined,
      headers: {
        "X-Content-Type-Options": "nosniff",
        "X-Frame-Options": "DENY",
        "/about": { "X-Robots-Tag": "noindex" },
        "/api/*": { "Cache-Control": "no-cache", "X-Robots-Tag": "none" },
      },
    }),
  });
  try {
    const about = await html(server, "/about");
    assert.equal(about.headers.get("x-content-type-options"), "nosniff");
    assert.equal(about.headers.get("x-robots-tag"), "noindex");
    assert.equal(about.headers.get("x-frame-options"), "SAMEORIGIN", "the server middleware's header wins");
    assert.equal(about.headers.get("content-security-policy"), null, "without contentSecurityPolicy, no CSP");
    await about.text();
    const api = await server.fetch(new Request("http://local.test/api/ping"));
    assert.equal(api.headers.get("x-robots-tag"), "none");
    assert.equal(api.headers.get("x-content-type-options"), "nosniff");
    await api.text();
  } finally {
    await server.close();
  }
});

test("a response that sets a cookie never leaves as public", async () => {
  const rendered: string[] = [];
  const table: Record<string, unknown> = {
    ...modules(rendered),
    "/server/middleware/10-header.ts": { default: async (_request: Request, next: () => Promise<Response>) => {
      const response = await next();
      const headers = new Headers(response.headers);
      headers.append("set-cookie", "tracking=1; Path=/");
      return new Response(response.body, { status: response.status, headers });
    } },
  };
  const server = await createServerApp({
    manifest: manifest({ contentSecurityPolicy: undefined }), production: true,
    runtime: defineServerRuntime(() => ({ sessions: new SessionManager({ store: new MemorySessionStore(), secure: false }), onError: () => {} })),
    load: async (key) => table[key],
    prerender: { get: async (pathname) => pathname === "/" ? { html: `${DOCUMENT_HEAD_PREFIX}</head><body></body></html>`, headOffset: DOCUMENT_HEAD_PREFIX.length, etag: "\"x\"" } : undefined },
  });
  try {
    const response = await html(server, "/");
    assert.equal(response.headers.get("cache-control"), "private, no-store");
    assert.equal(response.headers.get("etag"), null);
    await response.text();
  } finally {
    await server.close();
  }
  // `s-maxage` lets a shared cache store it too, whether the response or server.headers sets it.
  for (const [own, configured] of [["max-age=0, s-maxage=60", undefined], [undefined, "s-maxage=60"]] as const) {
    const sharedTable: Record<string, unknown> = {
      ...modules([]),
      "/server/middleware/10-header.ts": { default: async () => new Response("ok", {
        headers: { "set-cookie": "tracking=1; Path=/", ...own ? { "cache-control": own } : {} },
      }) },
    };
    const shared = await createServerApp({
      manifest: manifest({ contentSecurityPolicy: undefined, ...configured ? { headers: { "Cache-Control": configured } } : {} }), production: true,
      runtime: defineServerRuntime(() => ({ sessions: new SessionManager({ store: new MemorySessionStore(), secure: false }), onError: () => {} })),
      load: async (key) => sharedTable[key],
    });
    try {
      const response = await html(shared, "/about");
      assert.equal(response.headers.get("cache-control"), "private, no-store", own ?? configured);
      await response.text();
    } finally {
      await shared.close();
    }
  }
});

test("meeko.config.ts: contentSecurityPolicy and headers for the adapters with a server reach the manifest", async () => {
  const project = await createTempProject("server-csp-config");
  try {
    const root = project.root;
    await writeFile(join(root, "package.json"), '{"private":true,"type":"module"}\n');
    await mkdir(join(root, "app", "pages"), { recursive: true });
    await writeFile(join(root, "meeko.config.mjs"), `export default { server: { adapter: "node", contentSecurityPolicy: { "default-src": ["'self'"] }, headers: { "X-Content-Type-Options": "nosniff", "/docs/*": { "Cache-Control": "public, max-age=60" } } } };\n`);
    await loadMeekoConfig(root);
    const { manifest: discovered } = await discoverAppManifest(root, { entry: "/entry.js", css: [], preload: [] });
    assert.deepEqual(discovered.contentSecurityPolicy, { "default-src": ["'self'"] });
    assert.deepEqual(discovered.headers, { "X-Content-Type-Options": "nosniff", "/docs/*": { "Cache-Control": "public, max-age=60" } });

    await writeFile(join(root, "meeko.config.mjs"), 'export default { server: { adapter: "bun", headers: { "/docs/*": "x" } } };\n');
    await assert.rejects(loadMeekoConfig(root), /server\.headers "\/docs\/\*" debe ser un objeto de valores de cabecera/);
    await writeFile(join(root, "meeko.config.mjs"), 'export default { server: { adapter: "deno", headers: { "/docs/*": { "Content-Security-Policy": "x" } } } };\n');
    await assert.rejects(loadMeekoConfig(root), /no puede fijar Content-Security-Policy/);
    await writeFile(join(root, "meeko.config.mjs"), `export default { server: { adapter: "cloudflare", contentSecurityPolicy: { "script-src": ["'self' 'unsafe-eval'"] } } };\n`);
    await assert.rejects(loadMeekoConfig(root), /server\.contentSecurityPolicy: invalid source/);
    // The static adapter writes one set of headers for every path.
    await writeFile(join(root, "meeko.config.mjs"), 'export default { server: { adapter: "static", headers: { "/docs/*": { "X-Robots-Tag": "noindex" } } } };\n');
    await assert.rejects(loadMeekoConfig(root), /los patrones de ruta necesitan un adaptador con servidor/);
  } finally {
    await project.remove();
  }
});
