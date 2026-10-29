import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import test from "node:test";
import { createServerApp, defineServerRuntime, MemorySessionStore, SessionManager } from "../src/framework-server.ts";
import type { AppManifest, ServerApp } from "../src/framework-server.ts";
import { definePage } from "../src/framework/page.ts";
import { formFlashCookies } from "../src/framework/form-flash.ts";
import { createRouteManifest } from "../src/framework/router.ts";
import { resolveThemeConfig, themeScript, themeStyle } from "../src/framework/theme.ts";

const sha256 = (text: string): string => `'sha256-${createHash("sha256").update(text, "utf8").digest("base64")}'`;
const theme = resolveThemeConfig(true)!;

interface Counters { loads: string[]; renders: string[]; guards: string[] }

/** Content versions that `cache.etag` reads, as a database would. */
const versions = new Map<string, number>();

function fixture(route: Record<string, unknown>, extra: { render?: "ssr" | "stream" } = {}): { manifest: AppManifest; modules: Record<string, unknown>; counters: Counters } {
  const counters: Counters = { loads: [], renders: [], guards: [] };
  const manifest: AppManifest = {
    version: 1,
    routes: createRouteManifest([
      {
        id: "/docs/[slug]", file: "/app/pages/docs/[slug].meeko", layouts: [], sidecar: "/app/pages/docs/[slug].route.ts",
        serverMiddleware: ["/app/middleware/guard.server.ts"], ...(extra.render ? { render: extra.render } : {}),
      },
    ]),
    server: { api: [], rpc: [], socket: [] },
    routeMiddleware: [],
    serverMiddleware: [],
    client: { entry: "/assets/entry-abc.js", css: [], preload: [] },
    document: { theme },
    contentSecurityPolicy: { "default-src": ["'self'"], "script-src": ["'self'"], "style-src": ["'self'"], "object-src": ["'none'"] },
    buildId: "build-1",
  };
  const modules: Record<string, unknown> = {
    "/app/pages/docs/[slug].meeko": {
      renderWithState(props: Record<string, unknown>) {
        const data = props.data as { slug: string; version: number };
        counters.renders.push(data.slug);
        return { html: `<article>${data.slug} v${data.version}</article>`, state: {} };
      },
    },
    "/app/pages/docs/[slug].route.ts": { route: {
      ...extra.render ? { render: extra.render } : {},
      load: ({ params }: { params: { slug: string } }) => {
        counters.loads.push(params.slug);
        return { slug: params.slug, version: versions.get(params.slug) ?? 1 };
      },
      ...route,
    } },
    "/app/middleware/guard.server.ts": { default: ({ url }: { url: URL }) => {
      counters.guards.push(url.pathname);
      if (url.searchParams.has("blocked")) return new Response(null, { status: 302, headers: { location: "/login" } });
      return undefined;
    } },
  };
  return { manifest, modules, counters };
}

async function app(setup: ReturnType<typeof fixture>, production = true): Promise<ServerApp> {
  return createServerApp({
    manifest: setup.manifest, production,
    runtime: defineServerRuntime(() => ({ sessions: new SessionManager({ store: new MemorySessionStore(), secure: false }), onError: () => {} })),
    load: async (key) => {
      if (!Object.hasOwn(setup.modules, key)) throw new Error(`Missing ${key}`);
      return setup.modules[key];
    },
  });
}

const get = (server: ServerApp, path: string, headers: Record<string, string> = {}): Promise<Response> =>
  server.fetch(new Request(`http://local.test${path}`, { headers: { accept: "text/html", ...headers } }));
const payloadHeaders = { accept: "application/meeko+json" };

test("cache.etag answers 304 for the document and the payload without the loader or the render", async () => {
  versions.clear();
  const setup = fixture({ cache: { etag: ({ params }: { params: { slug: string } }) => versions.get(params.slug) ?? 1 } });
  const server = await app(setup);
  try {
    const first = await get(server, "/docs/intro");
    assert.equal(first.status, 200);
    const etag = first.headers.get("etag");
    assert.match(etag ?? "", /^W\/"[A-Za-z0-9_-]+"$/);
    assert.equal(first.headers.get("cache-control"), "public, max-age=0, must-revalidate");
    assert.match(first.headers.get("vary") ?? "", /Accept/);
    assert.match(first.headers.get("vary") ?? "", /Cookie/);
    assert.match(await first.text(), /intro v1/);
    const revalidated = await get(server, "/docs/intro", { "if-none-match": etag! });
    assert.equal(revalidated.status, 304);
    assert.equal(revalidated.headers.get("etag"), etag);
    assert.equal(revalidated.headers.get("content-security-policy"), null, "a 304 never replaces the stored document's policy");
    assert.deepEqual(setup.counters.loads, ["intro"]);
    assert.deepEqual(setup.counters.renders, ["intro"]);

    // The payload of a navigation has its own ETag and its own 304.
    const payload = await get(server, "/docs/intro", payloadHeaders);
    assert.equal(payload.status, 200);
    const payloadTag = payload.headers.get("etag");
    assert.ok(payloadTag && payloadTag !== etag, "document and payload never share an ETag");
    assert.equal(payload.headers.get("content-security-policy"), "default-src 'none'; frame-ancestors 'none'");
    await payload.text();
    const payload304 = await get(server, "/docs/intro", { ...payloadHeaders, "if-none-match": payloadTag });
    assert.equal(payload304.status, 304);
    // The document's ETag does not validate the payload.
    assert.equal((await get(server, "/docs/intro", { ...payloadHeaders, "if-none-match": etag! })).status, 200);

    // A new version of the content changes the ETag: the page renders again.
    versions.set("intro", 2);
    const changed = await get(server, "/docs/intro", { "if-none-match": etag! });
    assert.equal(changed.status, 200);
    assert.notEqual(changed.headers.get("etag"), etag);
    assert.match(await changed.text(), /intro v2/);
    // Another theme renders another document.
    const dark = await get(server, "/docs/intro", { cookie: "meeko-theme=dark" });
    assert.notEqual(dark.headers.get("etag"), changed.headers.get("etag"));
    await dark.text();
  } finally {
    await server.close();
  }
});

test("server route middleware runs before every 304 and can still stop the route", async () => {
  versions.clear();
  const setup = fixture({ cache: { etag: () => "v1" } });
  const server = await app(setup);
  try {
    const first = await get(server, "/docs/guarded");
    const etag = first.headers.get("etag")!;
    await first.text();
    assert.equal((await get(server, "/docs/guarded", { "if-none-match": etag })).status, 304);
    assert.deepEqual(setup.counters.guards, ["/docs/guarded", "/docs/guarded"]);
    const blocked = await get(server, "/docs/guarded?blocked=1", { "if-none-match": etag });
    assert.equal(blocked.status, 302, "a guard is never skipped by the cache");
    assert.equal(setup.counters.guards.length, 3);
  } finally {
    await server.close();
  }
});

test("a session request or a response that sets a cookie is never cached", async () => {
  versions.clear();
  const setup = fixture({ cache: { etag: () => "v1", memory: true } });
  const server = await app(setup);
  try {
    const anonymous = await get(server, "/docs/intro");
    const etag = anonymous.headers.get("etag")!;
    await anonymous.text();
    // The session cookie, even an unknown one, takes the request out of the cache.
    const withSession = await get(server, "/docs/intro", { cookie: `meeko.sid=${"a".repeat(43)}`, "if-none-match": etag });
    assert.equal(withSession.status, 200);
    assert.equal(withSession.headers.get("etag"), null);
    assert.equal(withSession.headers.get("cache-control"), "no-store");
    await withSession.text();
    assert.deepEqual(setup.counters.renders, ["intro", "intro"], "a session request never reads cache.memory");

    // A loader that starts a session sets a cookie: no-store, no ETag and no stored copy.
    const login = fixture({
      cache: { etag: () => "v1", memory: true },
      load: async ({ params, context }: { params: { slug: string }; context: { session: { create(data: unknown): Promise<unknown> } } }) => {
        await context.session.create({ user: "ada" });
        return { slug: params.slug, version: 1 };
      },
    });
    const loginServer = await app(login);
    try {
      for (let attempt = 0; attempt < 2; attempt++) {
        const response = await get(loginServer, "/docs/welcome");
        assert.equal(response.status, 200);
        assert.ok(response.headers.get("set-cookie"));
        assert.equal(response.headers.get("etag"), null);
        assert.equal(response.headers.get("cache-control"), "no-store");
        await response.text();
      }
      assert.deepEqual(login.counters.renders, ["welcome", "welcome"]);
    } finally {
      await loginServer.close();
    }
  } finally {
    await server.close();
  }
});

test("the one-time cookie of a form result skips the 304 and cache.memory, and is never stored", async () => {
  versions.clear();
  const setup = fixture({ cache: { etag: () => "v1", memory: true } });
  const server = await app(setup);
  try {
    const first = await get(server, "/docs/form");
    const etag = first.headers.get("etag")!;
    await first.text();
    for (const cookie of Object.values(formFlashCookies)) {
      const result = await get(server, "/docs/form", { cookie: `${cookie}=done`, "if-none-match": etag });
      assert.equal(result.status, 200);
      assert.equal(result.headers.get("etag"), null);
      assert.equal(result.headers.get("cache-control"), "no-store");
      await result.text();
    }
    assert.deepEqual(setup.counters.renders, ["form", "form", "form"]);
    // The anonymous copy is still the one stored.
    await (await get(server, "/docs/form")).text();
    assert.equal(setup.counters.renders.length, 3);
  } finally {
    await server.close();
  }
});

test("cache.memory keys a route with a search schema by its validated search, and a request with Authorization is never cached", async () => {
  versions.clear();
  // Declares `tab` only: whatever else the query carries is dropped, as Valibot's object does.
  const search = { "~standard": { version: 1, validate: (value: unknown) => ({ value: { tab: (value as { tab?: string }).tab ?? "intro" } }) } };
  const setup = fixture({ search, cache: { etag: () => "v1", memory: true } });
  const server = await app(setup);
  try {
    const read = async (path: string, headers: Record<string, string> = {}): Promise<Response> => {
      const response = await get(server, path, headers);
      await response.text();
      return response;
    };
    await read("/docs/a?tab=one&utm_source=x");
    await read("/docs/a?tab=one&utm_source=y&_=123");
    assert.deepEqual(setup.counters.loads, ["a"], "undeclared parameters share the stored copy");
    await read("/docs/a?tab=two");
    assert.deepEqual(setup.counters.loads, ["a", "a"], "a declared parameter has its own copy");
    // Authorization: rendered for these credentials, never stored, read from the store or answered 304.
    const etag = (await read("/docs/a?tab=one")).headers.get("etag")!;
    const authorized = await read("/docs/a?tab=one", { authorization: "Bearer secret", "if-none-match": etag });
    assert.equal(authorized.status, 200);
    assert.equal(authorized.headers.get("cache-control"), "no-store");
    assert.equal(authorized.headers.get("etag"), null);
    assert.deepEqual(setup.counters.loads, ["a", "a", "a"]);
  } finally {
    await server.close();
  }
  // Without a search schema the page receives the raw query, so each query keeps its own copy.
  const raw = fixture({ cache: { etag: () => "v1", memory: true } });
  const rawServer = await app(raw);
  try {
    await (await get(rawServer, "/docs/a?x=1")).text();
    await (await get(rawServer, "/docs/a?x=2")).text();
    assert.deepEqual(raw.counters.loads, ["a", "a"]);
  } finally {
    await rawServer.close();
  }
});

test("cache.memory serves stored pages without the loader and keeps its entry limit", async () => {
  versions.clear();
  const setup = fixture({ cache: { etag: ({ params }: { params: { slug: string } }) => versions.get(params.slug) ?? 1, memory: { maxEntries: 2 } } });
  const server = await app(setup);
  try {
    const read = async (path: string, headers: Record<string, string> = {}): Promise<string> => (await get(server, path, headers)).text();
    const a = await read("/docs/a");
    await read("/docs/b");
    assert.equal(await read("/docs/a"), a, "a stored page is the same document");
    assert.deepEqual(setup.counters.loads, ["a", "b"]);
    // A third slot evicts the least recently used one, b.
    await read("/docs/c");
    await read("/docs/a");
    assert.deepEqual(setup.counters.loads, ["a", "b", "c"]);
    await read("/docs/b");
    assert.deepEqual(setup.counters.loads, ["a", "b", "c", "b"]);
    // A changed ETag invalidates the stored copy.
    versions.set("b", 2);
    assert.match(await read("/docs/b"), /b v2/);
    assert.deepEqual(setup.counters.loads, ["a", "b", "c", "b", "b"]);
    // The payload is stored apart from the document.
    await read("/docs/b", payloadHeaders);
    await read("/docs/b", payloadHeaders);
    assert.equal(setup.counters.loads.length, 6);
    // HEAD reads the stored copy without a body.
    const head = await server.fetch(new Request("http://local.test/docs/b", { method: "HEAD", headers: { accept: "text/html" } }));
    assert.equal(head.status, 200);
    assert.equal(await head.text(), "");
    assert.equal(setup.counters.loads.length, 6);
  } finally {
    await server.close();
  }

  // A page larger than maxBytes is never stored.
  const small = fixture({ cache: { etag: () => "v1", memory: { maxBytes: 64 } } });
  const smallServer = await app(small);
  try {
    await (await get(smallServer, "/docs/big")).text();
    await (await get(smallServer, "/docs/big")).text();
    assert.deepEqual(small.counters.loads, ["big", "big"]);
  } finally {
    await smallServer.close();
  }
});

test("a cached document carries no nonce: the CSP allows its inline theme script and style by their hashes", async () => {
  versions.clear();
  const setup = fixture({ cache: { etag: () => "v1", maxAge: 60, staleWhileRevalidate: 300 } });
  const server = await app(setup);
  try {
    const response = await get(server, "/docs/intro");
    const html = await response.text();
    assert.equal(response.headers.get("cache-control"), "public, max-age=60, stale-while-revalidate=300");
    assert.doesNotMatch(html, /nonce=/);
    assert.ok(html.includes(`<script>${themeScript(theme)}</script>`), html);
    const csp = response.headers.get("content-security-policy") ?? "";
    assert.doesNotMatch(csp, /nonce-/);
    assert.match(csp, new RegExp(`script-src 'self' ${escape(sha256(themeScript(theme)))}`));
    assert.match(csp, new RegExp(`style-src 'self' ${escape(sha256(themeStyle(theme)))}`));

    // Without cache the same page gets a nonce per response instead.
    const plain = fixture({});
    const plainServer = await app(plain);
    try {
      const first = await get(plainServer, "/docs/intro");
      const nonce = /'nonce-([^']+)'/.exec(first.headers.get("content-security-policy") ?? "")?.[1];
      assert.ok(nonce);
      assert.ok((await first.text()).includes(`<script nonce="${nonce}">${themeScript(theme)}</script>`));
      assert.equal(first.headers.get("cache-control"), "no-store");
      assert.equal(first.headers.get("etag"), null);
    } finally {
      await plainServer.close();
    }
  } finally {
    await server.close();
  }
});

test("a cached document hashes only what Meeko writes: a <script> or <style> injected in the page is not allowed", async () => {
  const injectedScript = "alert(document.cookie)";
  const injectedStyle = "body{display:none}";
  for (const render of ["ssr", "stream"] as const) {
    versions.clear();
    const setup = fixture({ cache: { etag: () => "v1" } }, render === "stream" ? { render } : {});
    // What `html=` or unsanitized content would place inside the page.
    setup.modules["/app/pages/docs/[slug].meeko"] = {
      css: ".doc{color:red}",
      renderWithState: () => ({ html: `<article><script>${injectedScript}</script><style>${injectedStyle}</style></article>`, state: {} }),
    };
    const server = await app(setup);
    try {
      const response = await get(server, "/docs/intro");
      const html = await response.text();
      assert.ok(html.includes(`<script>${injectedScript}</script>`), html);
      const csp = response.headers.get("content-security-policy") ?? "";
      assert.ok(!csp.includes(sha256(injectedScript)), `${render}: ${csp}`);
      assert.ok(!csp.includes(sha256(injectedStyle)), `${render}: ${csp}`);
      // Meeko's own inline code keeps its hashes: the theme script and style, and the page's CSS.
      assert.ok(csp.includes(sha256(themeScript(theme))), csp);
      assert.ok(csp.includes(sha256(themeStyle(theme))), csp);
      assert.ok(csp.includes(sha256(".doc{color:red}")), csp);
    } finally {
      await server.close();
    }
  }
});

test("render: stream keeps the ETag and the 304 but never stores the body", async () => {
  versions.clear();
  const setup = fixture({ cache: { etag: () => "v1" } }, { render: "stream" });
  const server = await app(setup);
  try {
    const first = await get(server, "/docs/live");
    assert.equal(first.status, 200);
    const etag = first.headers.get("etag")!;
    assert.ok(etag);
    assert.equal(first.headers.get("cache-control"), "public, max-age=0, must-revalidate, no-transform");
    const html = await first.text();
    const csp = first.headers.get("content-security-policy") ?? "";
    assert.match(csp, new RegExp(escape(sha256(themeScript(theme)))));
    assert.doesNotMatch(html, /nonce=/);
    assert.equal((await get(server, "/docs/live", { "if-none-match": etag })).status, 304);
    assert.deepEqual(setup.counters.loads, ["live"]);
  } finally {
    await server.close();
  }
});

test("the page cache is off in development", async () => {
  versions.clear();
  const setup = fixture({ cache: { etag: () => "v1", memory: true } });
  const server = await app(setup, false);
  try {
    const response = await get(server, "/docs/intro");
    assert.equal(response.headers.get("etag"), null);
    assert.equal(response.headers.get("cache-control"), "no-store");
    assert.equal(response.headers.get("content-security-policy"), null, "the CSP applies in production only");
    await response.text();
  } finally {
    await server.close();
  }
});

test("definePage validates cache where the page is defined", () => {
  assert.throws(() => definePage({ cache: { memory: true } }), /cache\.memory needs cache\.etag/);
  assert.throws(() => definePage({ cache: { maxAge: -1 } } as never), /maxAge must be a whole number/);
  assert.throws(() => definePage({ cache: { ttl: 1 } } as never), /unknown field ttl/);
  assert.throws(() => definePage({ render: "client", cache: {} } as never), /render: "client" has no server cache/);
  const route = definePage({ cache: { etag: () => "v1", maxAge: 60, memory: { maxEntries: 10 } } });
  assert.equal(route.cache?.maxAge, 60);
});

function escape(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\/]/g, "\\$&");
}
