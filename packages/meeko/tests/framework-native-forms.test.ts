import assert from "node:assert/strict";
import test from "node:test";
import { ApiError, createServerApp, defineApiRoute, defineServerRuntime, MemorySessionStore, SessionManager } from "../src/framework-server.ts";
import type { AppManifest, Schema, ServerApp } from "../src/framework-server.ts";
import { useForm } from "../src/framework.ts";
import type { Form } from "../src/framework.ts";
import { parseFormFlash } from "../src/framework/form-flash.ts";
import { hydrateWithStateStore, StateStore } from "../src/framework/state.ts";
import { collectMounted } from "../src/lifecycle.ts";

type Issue = { readonly message: string; readonly path?: readonly { readonly key: PropertyKey }[] };
type Feedback = { page: string; rating: number; helpful: boolean; comment: string; tags: string[] };

/** A Standard Schema written by hand, shaped like Valibot's: typed fields, no conversion of its own. */
const feedbackInput: Schema<Partial<Feedback>, Feedback> = { "~standard": { version: 1, validate(value) {
  const input = (value ?? {}) as Record<string, unknown>;
  const issues: Issue[] = [];
  if (typeof input.page !== "string" || !input.page) issues.push({ message: "Falta la página.", path: [{ key: "page" }] });
  if (typeof input.rating !== "number" || input.rating < 1 || input.rating > 5) issues.push({ message: "Elige de 1 a 5.", path: [{ key: "rating" }] });
  if (input.helpful !== undefined && typeof input.helpful !== "boolean") issues.push({ message: "Sí o no.", path: [{ key: "helpful" }] });
  if (input.comment !== undefined && typeof input.comment !== "string") issues.push({ message: "Escribe texto.", path: [{ key: "comment" }] });
  if (input.tags !== undefined && !(Array.isArray(input.tags) && input.tags.every((tag) => typeof tag === "string"))) issues.push({ message: "Etiquetas no válidas.", path: [{ key: "tags" }] });
  if (issues.length) return { issues };
  return { value: { page: input.page as string, rating: input.rating as number, helpful: (input.helpful as boolean | undefined) ?? false, comment: (input.comment as string | undefined) ?? "", tags: (input.tags as string[] | undefined) ?? [] } };
} } };
const savedSchema: Schema<{ id: string }> = { "~standard": { version: 1, validate: (value) => ({ value: value as { id: string } }) } };
const uploadInput: Schema<{ file: File }> = { "~standard": { version: 1, validate(value) {
  const file = (value as { file?: unknown } | undefined)?.file;
  return file instanceof File ? { value: { file } } : { issues: [{ message: "Adjunta un archivo.", path: [{ key: "file" }] }] };
} } };

/** An asynchronous schema with a side effect, as a uniqueness check against a database would have. */
const asyncChecks: unknown[] = [];
const asyncInput: Schema<{ rating: number }> = { "~standard": { version: 1, async validate(value) {
  asyncChecks.push(value);
  const rating = (value as { rating?: unknown } | undefined)?.rating;
  return typeof rating === "number" ? { value: { rating } } : { issues: [{ message: "Un número.", path: [{ key: "rating" }] }] };
} } };

const origin = "http://local.test";
const received: unknown[] = [];

const manifest: AppManifest = {
  version: 1,
  routes: [
    { id: "/docs", file: "/app/pages/docs.meeko", layouts: [] },
    { id: "/other", file: "/app/pages/other.meeko", layouts: [] },
  ],
  server: {
    api: [
      { kind: "api", file: "/server/api/feedback.post.ts", pathname: "/api/feedback", method: "POST", clientKey: "feedback" },
      { kind: "api", file: "/server/api/thanks.post.ts", pathname: "/api/thanks", method: "POST", clientKey: "thanks" },
      { kind: "api", file: "/server/api/plain.post.ts", pathname: "/api/plain", method: "POST", clientKey: "plain" },
      { kind: "api", file: "/server/api/upload.post.ts", pathname: "/api/upload", method: "POST", clientKey: "upload" },
      { kind: "api", file: "/server/api/login.post.ts", pathname: "/api/login", method: "POST", clientKey: "login" },
      { kind: "api", file: "/server/api/limited.post.ts", pathname: "/api/limited", method: "POST", clientKey: "limited" },
      { kind: "api", file: "/server/api/checked.post.ts", pathname: "/api/checked", method: "POST", clientKey: "checked" },
    ],
    rpc: [],
  },
  routeMiddleware: [],
  serverMiddleware: [],
  client: { entry: "/assets/entry.js", css: [], preload: [] },
};

/** The page of the form: what `useForm({ action })` shows in the server render. */
const docsPage = {
  renderWithState() {
    const form = useForm({
      schema: feedbackInput,
      initial: { page: "/docs", rating: undefined, helpful: undefined, comment: "", tags: undefined },
      action: "/api/feedback",
      submit: async () => undefined,
      errorMessage: (failure) => `fallo ${(failure as { code?: string }).code}`,
    });
    const values = { rating: form.fields.rating.value, comment: form.fields.comment.value, tags: form.fields.tags.value };
    return {
      html: `<p id="errors">${JSON.stringify(form.errors.value)}</p><p id="error">${form.error.value ?? ""}</p><p id="values">${JSON.stringify(values)}</p><p id="sent">${form.submitted.value}</p><p id="csrf">${form.csrfToken ?? ""}</p>`,
      state: {},
    };
  },
};

const modules: Record<string, unknown> = {
  "/app/pages/docs.meeko": docsPage,
  "/app/pages/other.meeko": { renderWithState: () => ({ html: "<p>other</p>", state: {} }) },
  "/server/api/feedback.post.ts": { default: defineApiRoute({
    body: feedbackInput,
    response: savedSchema,
    // `password` is listed only to show that a credential never travels back.
    form: { echo: ["rating", "comment", "tags", "password"] },
    handler: ({ body }) => {
      if (body.comment === "dup") throw new ApiError("DUPLICATE", 409, { issues: [{ path: "comment", message: "Ya lo enviaste." }] });
      received.push(body);
      return { id: "f1" };
    },
  }) },
  "/server/api/thanks.post.ts": { default: defineApiRoute({
    body: feedbackInput,
    response: savedSchema,
    form: { redirect: (saved, { request }) => new URL(request.url).searchParams.get("to") ?? `/gracias?id=${saved.id}` },
    handler: () => ({ id: "t1" }),
  }) },
  "/server/api/plain.post.ts": { default: defineApiRoute({ body: feedbackInput, response: savedSchema, handler: () => ({ id: "p1" }) }) },
  "/server/api/upload.post.ts": { default: defineApiRoute({
    body: uploadInput,
    status: 204,
    form: { files: true, maxBytes: 4096 },
    handler: async ({ body }) => { received.push(await body.file.text()); },
  }) },
  "/server/api/login.post.ts": { default: defineApiRoute({ contentType: "response", async handler({ context }) {
    const session = await context.session.create({ user: "ada" });
    return Response.json({ csrf: session.csrfToken });
  } }) },
  "/server/api/limited.post.ts": { default: defineApiRoute({
    body: feedbackInput,
    status: 204,
    form: true,
    rateLimit: { limit: 1, window: "1m", key: () => "one" },
    handler: () => {},
  }) },
  "/server/api/checked.post.ts": { default: defineApiRoute({
    body: asyncInput,
    status: 204,
    form: true,
    handler: () => {},
  }) },
};

async function app(): Promise<ServerApp> {
  const runtime = defineServerRuntime(() => ({ sessions: new SessionManager({ store: new MemorySessionStore(), secure: false }), onError: () => {} }));
  return createServerApp({ manifest, production: false, runtime, load: async (key) => modules[key] });
}

function post(path: string, body: BodyInit, headers: Record<string, string> = {}): Request {
  const init: RequestInit = { method: "POST", body, headers: { origin, ...headers } };
  if (typeof body === "string" && !("content-type" in headers)) (init.headers as Record<string, string>)["content-type"] = "application/x-www-form-urlencoded";
  return new Request(`${origin}${path}`, init);
}

/** The content of a flash cookie. */
function flashOf(cookie: string): Record<string, unknown> {
  return JSON.parse(Buffer.from(cookie.slice(cookie.indexOf("=") + 1), "base64url").toString("utf8")) as Record<string, unknown>;
}

/** The flash cookie of a `303`, as the browser sends it back. */
function flashCookie(response: Response): string {
  const cookie = response.headers.getSetCookie().find((value) => value.startsWith("meeko-form="));
  assert.ok(cookie, "the 303 sets the flash cookie");
  assert.match(cookie, /; Path=\/; Max-Age=60; HttpOnly; SameSite=Lax$/);
  return cookie.split(";")[0]!;
}

test("a urlencoded form is validated with the body schema, converted where the text fails, and answers 303 to return", async () => {
  received.length = 0;
  const server = await app();
  const response = await server.fetch(post("/api/feedback", "page=%2Fdocs&rating=4&helpful=on&comment=42&tags%5B%5D=a&tags%5B%5D=b&return=%2Fdocs%3Ftab%3Done"));
  assert.equal(response.status, 303);
  assert.equal(response.headers.get("location"), "/docs?tab=one");
  assert.equal(response.headers.get("cache-control"), "no-store");
  flashCookie(response);
  // "42" stays text (the schema wants text); rating and helpful are read as a number and a boolean.
  assert.deepEqual(received, [{ page: "/docs", rating: 4, helpful: true, comment: "42", tags: ["a", "b"] }]);
  await server.close();
});

test("a multipart form answers the same, and a declared redirect wins over return", async () => {
  received.length = 0;
  const server = await app();
  const data = new FormData();
  data.set("page", "/docs");
  data.set("rating", "5");
  data.set("return", "/docs");
  const response = await server.fetch(post("/api/feedback", data));
  assert.equal(response.status, 303);
  assert.equal(response.headers.get("location"), "/docs");
  assert.deepEqual(received, [{ page: "/docs", rating: 5, helpful: false, comment: "", tags: [] }]);
  const thanks = await server.fetch(post("/api/thanks", "page=%2Fdocs&rating=3&return=%2Fdocs"));
  assert.equal(thanks.headers.get("location"), "/gracias?id=t1");
  // Files only reach a route that accepts them, within its size limit.
  const upload = new FormData();
  upload.set("file", new File(["hola"], "a.txt", { type: "text/plain" }));
  upload.set("return", "/docs");
  const uploaded = await server.fetch(post("/api/upload", upload));
  assert.equal(uploaded.status, 303);
  assert.deepEqual(received.at(-1), "hola");
  const withFile = new FormData();
  withFile.set("page", "/docs");
  withFile.set("rating", "2");
  withFile.set("comment", new File(["x"], "x.txt"));
  withFile.set("return", "/docs");
  const rejected = await server.fetch(post("/api/feedback", withFile));
  assert.equal(rejected.status, 303);
  const page = await server.fetch(new Request(`${origin}/docs`, { headers: { cookie: flashCookie(rejected) } }));
  assert.match(await page.text(), /<p id="error">fallo FILES_NOT_ALLOWED<\/p>/);
  const big = new FormData();
  big.set("file", new File(["x".repeat(8192)], "big.txt"));
  const tooLarge = await server.fetch(post("/api/upload", big, { referer: `${origin}/docs` }));
  assert.equal(tooLarge.headers.get("location"), "/docs", "without return, the Referer of this site");
  assert.deepEqual(flashOf(flashCookie(tooLarge)), { v: 1, p: "/docs", action: "/api/upload", ok: false, code: "BODY_TOO_LARGE", status: 413, requestId: flashOf(flashCookie(tooLarge)).requestId });
  await server.close();
});

test("a hostile return or redirect never leaves the site", async () => {
  const server = await app();
  for (const hostile of ["//evil.example/x", "https://evil.example/x", "/\\evil.example", "javascript:alert(1)", "/.//evil.example", "evil"]) {
    const response = await server.fetch(post("/api/feedback", `page=%2Fdocs&rating=1&return=${encodeURIComponent(hostile)}`));
    assert.equal(response.status, 303);
    assert.equal(response.headers.get("location"), "/", hostile);
    const redirected = await server.fetch(post(`/api/thanks?to=${encodeURIComponent(hostile)}`, "page=%2Fdocs&rating=1"));
    assert.equal(redirected.headers.get("location"), "/", `redirect ${hostile}`);
  }
  const foreignReferer = await server.fetch(post("/api/feedback", "rating=9", { referer: "https://evil.example/form" }));
  assert.equal(foreignReferer.headers.get("location"), "/");
  const sameOriginAbsolute = await server.fetch(post("/api/feedback", `page=%2Fdocs&rating=1&return=${encodeURIComponent(`${origin}/docs#f`)}`));
  assert.equal(sameOriginAbsolute.headers.get("location"), "/docs#f");
  await server.close();
});

test("return arrives the same raw, encoded, multipart or absolute; a Windows path rewritten by the shell is not a path", async () => {
  const server = await app();
  const expect = async (response: Response, location: string, label: string) => {
    assert.equal(response.status, 303, label);
    assert.equal(response.headers.get("location"), location, label);
    assert.equal(flashOf(flashCookie(response)).p, new URL(location, origin).pathname, `${label} (flash)`);
  };
  // A `/` without encoding is what curl and many clients send; browsers send `%2F`.
  await expect(await server.fetch(post("/api/feedback", "page=%2Fdocs&rating=1&return=/docs?tab=one")), "/docs?tab=one", "urlencoded raw");
  await expect(await server.fetch(post("/api/feedback", "page=%2Fdocs&rating=1&return=%2Fdocs%3Ftab%3Done")), "/docs?tab=one", "urlencoded encoded");
  await expect(await server.fetch(post("/api/feedback", "rating=9&return=/docs")), "/docs", "urlencoded raw, failed");
  const multipart = new FormData();
  multipart.set("page", "/docs");
  multipart.set("rating", "1");
  multipart.set("return", "/docs");
  await expect(await server.fetch(post("/api/feedback", multipart)), "/docs", "multipart");
  await expect(await server.fetch(post("/api/feedback", `page=%2Fdocs&rating=1&return=${origin}/docs`)), "/docs", "absolute raw");
  // Git Bash rewrites `return=/docs` into this before curl sends it: a `c:` scheme, so `/`.
  for (const hostile of ["C:/Program Files/Git/docs", "//evil.example/x", "/\\evil.example", "/./docs/../..//evil.example", "/%2e%2e//evil.example", "https:evil.example"]) {
    await expect(await server.fetch(post("/api/feedback", `page=%2Fdocs&rating=1&return=${hostile}`)), "/", hostile);
  }
  await server.close();
});

test("a validation error returns with its issues and values, the SSR page shows them once, and hydration keeps them", async () => {
  received.length = 0;
  const server = await app();
  const response = await server.fetch(post("/api/feedback", "page=%2Fdocs&rating=9&comment=hola&tags=a&tags=b&password=secret1&return=%2Fdocs"));
  assert.equal(response.status, 303);
  assert.equal(response.headers.get("location"), "/docs");
  assert.deepEqual(received, [], "the handler never ran");
  const cookie = flashCookie(response);
  // Another page does not take it.
  const other = await server.fetch(new Request(`${origin}/other`, { headers: { cookie } }));
  assert.equal(other.headers.getSetCookie().some((value) => value.startsWith("meeko-form=")), false);
  const page = await server.fetch(new Request(`${origin}/docs`, { headers: { cookie } }));
  assert.equal(page.status, 200);
  const html = await page.text();
  assert.match(html, /<p id="errors">\{"rating":"Elige de 1 a 5\."\}<\/p>/);
  // A field that still fails comes back as the user wrote it.
  assert.match(html, /<p id="values">\{"rating":"9","comment":"hola","tags":\["a","b"\]\}<\/p>/);
  assert.doesNotMatch(html, /secret1/, "a password never travels back");
  // The payload carries the same state, so hydration paints the same form.
  assert.match(html, /"meeko:form:\/api\/feedback":\{"action":"\/api\/feedback","ok":false,"code":"INVALID_BODY","status":400/);
  assert.ok(page.headers.getSetCookie().includes("meeko-form=; Path=/; Max-Age=0; HttpOnly; SameSite=Lax"), "the page deletes the cookie: single use");
  assert.equal(page.headers.get("cache-control"), "no-store");
  const again = await (await server.fetch(new Request(`${origin}/docs`))).text();
  assert.match(again, /<p id="errors">\{\}<\/p>/);
  // An ApiError with issues comes back the same way; a success marks the form as submitted.
  const duplicate = await server.fetch(post("/api/feedback", "page=%2Fdocs&rating=2&comment=dup&return=%2Fdocs"));
  const duplicatePage = await (await server.fetch(new Request(`${origin}/docs`, { headers: { cookie: flashCookie(duplicate) } }))).text();
  assert.match(duplicatePage, /<p id="errors">\{"comment":"Ya lo enviaste\."\}<\/p>/);
  const ok = await server.fetch(post("/api/feedback", "page=%2Fdocs&rating=2&return=%2Fdocs"));
  const okPage = await (await server.fetch(new Request(`${origin}/docs`, { headers: { cookie: flashCookie(ok) } }))).text();
  assert.match(okPage, /<p id="sent">true<\/p>/);
  await server.close();
});

test("without form.echo no submitted value travels back: only the code and the issues", async () => {
  const server = await app();
  // /api/thanks declares form without echo; a card number or a PIN with a name no list knows stays out.
  const response = await server.fetch(post("/api/thanks", "page=%2Fdocs&rating=9&cardNumber=4111111111111111&pin=1234&contrasena=clave1&return=%2Fdocs"));
  assert.equal(response.status, 303);
  const flash = flashOf(flashCookie(response));
  assert.equal(flash.code, "INVALID_BODY");
  assert.deepEqual(flash.issues, [{ path: "rating", message: "Elige de 1 a 5." }]);
  assert.equal(flash.values, undefined);
  assert.doesNotMatch(JSON.stringify(flash), /4111|1234|clave1/);
  await server.close();
});

test("rateLimit is checked before the body of a form is read", async () => {
  const server = await app();
  let pulls = 0;
  const streamed = (): Request => new Request(`${origin}/api/limited`, {
    method: "POST", duplex: "half", headers: { origin, "content-type": "application/x-www-form-urlencoded" },
    body: new ReadableStream<Uint8Array>({ pull(controller) {
      pulls++;
      controller.enqueue(new TextEncoder().encode("page=%2Fdocs&rating=2&return=%2Fdocs"));
      controller.close();
    } }, { highWaterMark: 0 }),
  } as RequestInit);
  const first = await server.fetch(streamed());
  assert.equal(first.status, 303);
  assert.equal(flashOf(flashCookie(first)).ok, true);
  const read = pulls;
  const limited = await server.fetch(streamed());
  assert.equal(limited.status, 303);
  assert.equal(flashOf(flashCookie(limited)).code, "RATE_LIMITED");
  assert.equal(pulls, read, "the limited submission's body was never read");
  await server.close();
});

test("an asynchronous body schema runs once: its fields get no second, converted attempt", async () => {
  asyncChecks.length = 0;
  const server = await app();
  const response = await server.fetch(post("/api/checked", "rating=4&return=%2Fdocs"));
  assert.equal(response.status, 303);
  assert.equal(flashOf(flashCookie(response)).code, "INVALID_BODY");
  assert.deepEqual(asyncChecks.map((value) => ({ ...value as object })), [{ rating: "4" }], "the schema saw the text once");
  await server.close();
});

test("the values of a flash are a null-prototype object: __proto__ is a field, never a prototype", () => {
  const flash = parseFormFlash(JSON.parse('{"action":"/api/feedback","ok":false,"values":{"__proto__":["x"],"name":"Ada"}}'));
  assert.ok(flash?.values);
  assert.equal(Object.getPrototypeOf(flash.values), null);
  assert.ok(Object.hasOwn(flash.values, "__proto__"));
  assert.deepEqual(Object.keys(flash.values), ["__proto__", "name"]);
});

test("the browser reads the flash from the page state once", async () => {
  const flash = { action: "/api/feedback", ok: false, code: "INVALID_BODY", status: 400, issues: [{ path: "rating", message: "Elige de 1 a 5." }], values: { rating: 9 } };
  const store = new StateStore({ "meeko:form:/api/feedback": flash });
  const make = () => {
    let form!: Form<{ rating: unknown }, unknown>;
    // As hydration runs it: the root lives on, with the effects of the form.
    hydrateWithStateStore(store, () => {
      form = collectMounted([], () => useForm({ initial: { rating: 0 as unknown }, action: "/api/feedback?from=docs", submit: async () => undefined }));
      return () => {};
    });
    return form;
  };
  const hydrated = make();
  assert.deepEqual(hydrated.errors.value, { rating: "Elige de 1 a 5." });
  assert.equal(hydrated.fields.rating.value, 9);
  assert.equal((hydrated.failure.value as { status?: number } | null)?.status, 400);
  // A field with a server message loses it when it changes, as after a submission with JavaScript.
  hydrated.fields.rating.value = 3;
  await new Promise((resolve) => setImmediate(resolve));
  assert.deepEqual(hydrated.errors.value, {});
  const later = make();
  assert.deepEqual(later.errors.value, {}, "a later mount starts from initial");
  assert.equal(later.fields.rating.value, 0);
});

test("a foreign or missing Origin and a session without the CSRF token get 403; the _csrf field passes", async () => {
  const server = await app();
  const foreign = await server.fetch(post("/api/feedback", "page=%2Fdocs&rating=2", { origin: "https://evil.example" }));
  assert.equal(foreign.status, 403);
  assert.equal(((await foreign.json()) as { code: string }).code, "INVALID_ORIGIN");
  const missing = await server.fetch(new Request(`${origin}/api/feedback`, { method: "POST", body: "page=%2Fdocs&rating=2", headers: { "content-type": "application/x-www-form-urlencoded" } }));
  assert.equal(missing.status, 403);
  const login = await server.fetch(new Request(`${origin}/api/login`, { method: "POST", headers: { origin } }));
  const session = login.headers.get("set-cookie")!.split(";")[0]!;
  const { csrf } = (await login.json()) as { csrf: string };
  const withoutToken = await server.fetch(post("/api/feedback", "page=%2Fdocs&rating=2&return=%2Fdocs", { cookie: session }));
  assert.equal(withoutToken.status, 403);
  assert.equal(((await withoutToken.json()) as { code: string }).code, "INVALID_CSRF");
  const withToken = await server.fetch(post("/api/feedback", `page=%2Fdocs&rating=2&return=%2Fdocs&_csrf=${csrf}`, { cookie: session }));
  assert.equal(withToken.status, 303);
  // The page gives the token to the form for its hidden _csrf field.
  const page = await (await server.fetch(new Request(`${origin}/docs`, { headers: { cookie: session } }))).text();
  assert.match(page, new RegExp(`<p id="csrf">${csrf}</p>`));
  await server.close();
});

test("JSON is unchanged, and a route without form still answers 415 to a form", async () => {
  const server = await app();
  const json = await server.fetch(post("/api/feedback", JSON.stringify({ page: "/docs", rating: 3 }), { "content-type": "application/json" }));
  assert.equal(json.status, 200);
  assert.deepEqual(await json.json(), { id: "f1" });
  const invalid = await server.fetch(post("/api/feedback", JSON.stringify({ page: "/docs", rating: "3" }), { "content-type": "application/json" }));
  assert.equal(invalid.status, 400, "JSON is never converted");
  const plain = await server.fetch(post("/api/plain", "page=%2Fdocs&rating=3"));
  assert.equal(plain.status, 415);
  assert.equal(((await plain.json()) as { code: string }).code, "UNSUPPORTED_MEDIA_TYPE");
  const multipart = new FormData();
  multipart.set("page", "/docs");
  assert.equal((await server.fetch(post("/api/plain", multipart))).status, 415);
  await server.close();
});
