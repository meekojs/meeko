import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import test from "node:test";
import { createServerApp, defineApiRoute, defineServerRuntime, MemorySessionStore, SessionManager } from "../src/framework-server.ts";
import type { AppManifest, PrerenderedPage, Schema, ServerApp } from "../src/framework-server.ts";
import { useForm } from "../src/framework.ts";
import { formFlashCookies } from "../src/framework/form-flash.ts";
import { createRouteManifest } from "../src/framework/router.ts";
import { DOCUMENT_HEAD_PREFIX } from "../src/framework/server.ts";
import { inlineScriptHashes, inlineStyleHashes } from "../src/framework/script-hashes.ts";
import { resolveThemeConfig, themeScript } from "../src/framework/theme.ts";

// definePage({ cache }) (1.7) and native forms (1.7) together: the one-time cookie of a form result
// renders the page for that request alone, and the next request without it is cached again.

const sha256 = (text: string): string => `'sha256-${createHash("sha256").update(text, "utf8").digest("base64")}'`;
const theme = resolveThemeConfig(true)!;
// HTTPS, so the flash travels in __Host-meeko-form, as in production.
const origin = "https://local.test";

const commentInput: Schema<{ comment?: unknown }, { comment: string }> = { "~standard": { version: 1, validate(value) {
  const comment = (value as { comment?: unknown } | undefined)?.comment;
  return typeof comment === "string" && comment !== ""
    ? { value: { comment } }
    : { issues: [{ message: "Escribe un comentario.", path: [{ key: "comment" }] }] };
} } };

function fixture(): { server: Promise<ServerApp>; renders: string[]; loads: string[] } {
  const renders: string[] = [];
  const loads: string[] = [];
  const manifest: AppManifest = {
    version: 1,
    routes: createRouteManifest([
      { id: "/docs", file: "/app/pages/docs.meeko", layouts: [], sidecar: "/app/pages/docs.route.ts" },
      { id: "/static", file: "/app/pages/static.meeko", layouts: [], sidecar: "/app/pages/static.route.ts", render: "prerender" },
    ]),
    server: {
      api: [{ kind: "api", file: "/server/api/feedback.post.ts", pathname: "/api/feedback", method: "POST", clientKey: "feedback" }],
      rpc: [],
      socket: [],
    },
    routeMiddleware: [],
    serverMiddleware: [],
    client: { entry: "/assets/entry-abc.js", css: [], preload: [] },
    document: { theme },
    contentSecurityPolicy: { "default-src": ["'self'"], "script-src": ["'self'"], "style-src": ["'self'"], "object-src": ["'none'"] },
    buildId: "build-1",
  };
  /** A page with the form of `/api/feedback`: what `useForm({ action })` shows in the server render. */
  const formPage = (name: string) => ({
    renderWithState() {
      renders.push(name);
      const form = useForm({ schema: commentInput, initial: { comment: "" as unknown }, action: "/api/feedback", submit: async () => undefined });
      return { html: `<h1>${name}</h1><p id="errors">${JSON.stringify(form.errors.value)}</p><p id="sent">${form.submitted.value}</p>`, state: {} };
    },
  });
  const modules: Record<string, unknown> = {
    "/app/pages/docs.meeko": formPage("docs"),
    "/app/pages/static.meeko": formPage("static"),
    "/app/pages/docs.route.ts": { route: {
      cache: { etag: () => "v1", memory: true },
      load: () => {
        loads.push("docs");
        return { version: 1 };
      },
    } },
    "/app/pages/static.route.ts": { route: { render: "prerender" } },
    "/server/api/feedback.post.ts": { default: defineApiRoute({ body: commentInput, status: 204, form: true, handler: () => undefined }) },
  };
  const stored = `${DOCUMENT_HEAD_PREFIX}<script>${themeScript(theme)}</script></head><body><div id="app"><h1>stored</h1></div></body></html>`;
  const prerendered: PrerenderedPage = {
    html: stored, headOffset: DOCUMENT_HEAD_PREFIX.length, etag: "\"static\"",
    scriptHashes: inlineScriptHashes(stored).hashes, styleHashes: inlineStyleHashes(stored),
  };
  const server = createServerApp({
    manifest, production: true,
    runtime: defineServerRuntime(() => ({ sessions: new SessionManager({ store: new MemorySessionStore(), secure: false }), onError: () => {} })),
    load: async (key) => {
      if (!Object.hasOwn(modules, key)) throw new Error(`Missing ${key}`);
      return modules[key];
    },
    prerender: { get: async (pathname) => pathname === "/static" ? prerendered : undefined },
  });
  return { server, renders, loads };
}

const get = (server: ServerApp, path: string, headers: Record<string, string> = {}): Promise<Response> =>
  server.fetch(new Request(`${origin}${path}`, { headers: { accept: "text/html", ...headers } }));

/** Sends the form without JavaScript and returns the flash cookie as the browser sends it back. */
async function submit(server: ServerApp, body: string, returnTo: string): Promise<string> {
  const response = await server.fetch(new Request(`${origin}/api/feedback`, {
    method: "POST", body: `${body}&return=${encodeURIComponent(returnTo)}`,
    headers: { origin, "content-type": "application/x-www-form-urlencoded" },
  }));
  assert.equal(response.status, 303);
  assert.equal(response.headers.get("location"), returnTo);
  const cookie = response.headers.getSetCookie().find((value) => value.startsWith(`${formFlashCookies.secure}=`));
  assert.ok(cookie, "the 303 sets the __Host- flash cookie over HTTPS");
  return cookie.split(";")[0]!;
}

/** The CSP of a rendered document allows its inline theme script by the nonce it carries. */
function assertNoncePolicy(response: Response, html: string): void {
  const nonce = /<script nonce="([^"]+)"/.exec(html)?.[1];
  assert.ok(nonce, "the rendered document carries this response's nonce");
  assert.match(response.headers.get("content-security-policy") ?? "", new RegExp(`script-src 'self' 'nonce-${nonce}'`));
}

test("a form result on a cached page renders for that request alone, and the page is cached again without the cookie", async () => {
  const { server: starting, renders, loads } = fixture();
  const server = await starting;
  try {
    const first = await get(server, "/docs");
    const etag = first.headers.get("etag")!;
    assert.ok(etag, "the anonymous page is cacheable");
    assert.match(await first.text(), /<p id="errors">\{\}<\/p>/);
    assert.deepEqual(renders, ["docs"]);

    // The flash wins over If-None-Match and over the stored copy.
    const cookie = await submit(server, "comment=", "/docs");
    const result = await get(server, "/docs", { cookie, "if-none-match": etag });
    assert.equal(result.status, 200);
    assert.equal(result.headers.get("etag"), null);
    assert.equal(result.headers.get("cache-control"), "no-store");
    assert.ok(result.headers.getSetCookie().some((value) => value.startsWith(`${formFlashCookies.secure}=; Path=/; Max-Age=0`)), "the cookie is single use");
    const html = await result.text();
    assert.match(html, /<p id="errors">\{"comment":"Escribe un comentario\."\}<\/p>/);
    // The result is rendered with Meeko's CSP for this response, as any uncached document.
    assertNoncePolicy(result, html);
    assert.deepEqual(renders, ["docs", "docs"]);
    assert.deepEqual(loads, ["docs", "docs"]);

    // A success also renders for that request only.
    const sent = await (await get(server, "/docs", { cookie: await submit(server, "comment=hola", "/docs") })).text();
    assert.match(sent, /<p id="sent">true<\/p>/);
    assert.equal(renders.length, 3);

    // Without the cookie the page is the stored anonymous copy again: the results were never stored.
    const again = await get(server, "/docs");
    assert.equal(again.headers.get("etag"), etag);
    assert.match(await again.text(), /<p id="errors">\{\}<\/p><p id="sent">false<\/p>/);
    assert.equal(renders.length, 3, "served from cache.memory");
    const revalidated = await get(server, "/docs", { "if-none-match": etag });
    assert.equal(revalidated.status, 304);
    await revalidated.text();
    assert.equal(renders.length, 3);
    assert.equal(loads.length, 3);
  } finally {
    await server.close();
  }
});

test("a form result on a prerendered page renders it instead of serving its file, and the file is served again without the cookie", async () => {
  const { server: starting, renders } = fixture();
  const server = await starting;
  try {
    const stored = await get(server, "/static");
    assert.match(await stored.text(), /<h1>stored<\/h1>/);
    assert.deepEqual(renders, []);
    assert.ok((stored.headers.get("content-security-policy") ?? "").includes(sha256(themeScript(theme))));

    const cookie = await submit(server, "comment=", "/static");
    const result = await get(server, "/static", { cookie, "if-none-match": "\"static\"" });
    assert.equal(result.status, 200);
    assert.equal(result.headers.get("cache-control"), "no-store");
    assert.equal(result.headers.get("etag"), null);
    const html = await result.text();
    assert.match(html, /<h1>static<\/h1><p id="errors">\{"comment":"Escribe un comentario\."\}<\/p>/);
    assertNoncePolicy(result, html);
    assert.deepEqual(renders, ["static"]);

    const again = await get(server, "/static");
    assert.match(await again.text(), /<h1>stored<\/h1>/);
    assert.deepEqual(renders, ["static"], "the prerendered file is served again");
    const revalidated = await get(server, "/static", { "if-none-match": "\"static\"" });
    assert.equal(revalidated.status, 304);
    await revalidated.text();
  } finally {
    await server.close();
  }
});
