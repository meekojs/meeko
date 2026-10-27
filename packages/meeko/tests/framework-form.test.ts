import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, symlink, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import test from "node:test";
import { pathToFileURL } from "node:url";
import { Window as HappyWindow } from "happy-dom";
import { applyAutoImports, discoverAutoImports } from "../src/autoimports.ts";
import { compile } from "../src/compiler.ts";
import { ClientError, useForm } from "../src/framework.ts";
import type { Form } from "../src/framework.ts";
import { checkApp } from "../src/framework/check-app.ts";
import type { ClientComponent } from "../src/framework/client.ts";
import { prepareFrameworkTypeDeclarations } from "../src/framework/type-declarations.ts";
import { createRouteManifest } from "../src/framework/router.ts";
import type { RouteRecord } from "../src/framework/router.ts";
import { createRoot, provideErrorHandler } from "../src/index.ts";
import type { Signal } from "../src/index.ts";
import { createTempProject } from "./helpers/temp-project.ts";

type Issue = { readonly message: string; readonly path?: readonly (PropertyKey | { readonly key: PropertyKey })[] };
type Result<O> = { readonly value: O; readonly issues?: undefined } | { readonly issues: readonly Issue[] };

/** A Standard Schema v1 written by hand, with the same shape as a Valibot schema. */
function schema<I, O = I>(validate: (value: I) => Result<O> | Promise<Result<O>>) {
  return {
    "~standard": {
      version: 1 as const,
      vendor: "test",
      validate: (value: unknown) => validate(value as I),
      types: undefined as { readonly input: I; readonly output: O } | undefined,
    },
  };
}

type CategoryInput = { name: string; price: string };
type CategoryOutput = { name: string; priceCents: number };

const category = schema<CategoryInput, CategoryOutput>((input) => {
  const issues: Issue[] = [];
  const name = input.name.trim();
  if (!name) issues.push({ message: "Escribe un nombre.", path: [{ key: "name" }] });
  const priceCents = Math.round(Number(input.price.replace(",", ".")) * 100);
  if (!input.price.trim() || !Number.isFinite(priceCents)) issues.push({ message: "Escribe un precio.", path: [{ key: "price" }] });
  else if (priceCents <= 0) issues.push({ message: "El precio debe ser mayor que cero.", path: [{ key: "price" }] });
  return issues.length ? { issues } : { value: { name, priceCents } };
});

const flush = async (): Promise<void> => {
  for (let index = 0; index < 10; index++) await new Promise((resolve) => setTimeout(resolve, 0));
};

function deferred<T>(): { promise: Promise<T>; resolve: (value: T) => void; reject: (error: unknown) => void } {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((done, fail) => { resolve = done; reject = fail; });
  return { promise, resolve, reject };
}

/** Runs `work` inside a component root with an error observer, as a component script would. */
function withObserver<T>(work: () => T): { value: T; reported: unknown[]; dispose: () => void } {
  const reported: unknown[] = [];
  let dispose!: () => void;
  const value = createRoot((release) => {
    dispose = release;
    provideErrorHandler((error) => { reported.push(error); });
    return work();
  });
  return { value, reported, dispose };
}

test("useForm types its fields from the schema input and the submitted values from its output", () => {
  if (false) {
    const form = useForm({
      schema: category,
      initial: { name: "", price: "" },
      submit: (values) => {
        const cents: number = values.priceCents;
        // @ts-expect-error submit receives the schema output, which has no price
        void values.price;
        return Promise.resolve({ id: "c1", cents });
      },
    });
    const name: Signal<string> = form.fields.name;
    const price: Signal<string> = form.fields.price;
    // @ts-expect-error unknown fields are not in the form
    void form.fields.nope;
    const message: string | undefined = form.errors.value.name;
    // @ts-expect-error errors only name the paths of the fields
    void form.errors.value.nope;
    const formMessage: string | null = form.error.value;
    const failure: Error | null = form.failure.value;
    const flags: boolean[] = [form.pending.value, form.submitted.value, form.dirty.value];
    const submitted: Promise<{ id: string; cents: number } | undefined> = form.submit();
    // @ts-expect-error the state is read-only
    form.pending.value = true;
    form.reset({ name: "Bebidas" });
    // @ts-expect-error reset follows the field types
    form.reset({ price: 1 });
    void [name, price, message, formMessage, failure, flags, submitted];

    // @ts-expect-error initial needs every field of the schema input
    useForm({ schema: category, initial: { name: "" }, submit: () => {} });
    // @ts-expect-error initial follows the schema input
    useForm({ schema: category, initial: { name: "", price: 1 }, submit: () => {} });

    // Optional keys keep undefined, literal unions are kept, and nested paths name errors.
    const order = schema<{ kind: "single" | "combo"; note?: string; items: { name: string }[] }>((value) => ({ value }));
    const orderForm = useForm({ schema: order, initial: { kind: "single", note: undefined, items: [] }, submit: (values) => values.items.length });
    const kind: Signal<"single" | "combo"> = orderForm.fields.kind;
    const note: Signal<string | undefined> = orderForm.fields.note;
    const nested: string | undefined = orderForm.errors.value["items.0.name"];
    const count: Promise<number | undefined> = orderForm.submit();
    void [kind, note, nested, count];

    // Without a schema, fields and values have the type of initial.
    const login = useForm({
      initial: { email: "", remember: false },
      submit: (values) => { const email: string = values.email; void email; },
    });
    const remember: Signal<boolean> = login.fields.remember;
    // @ts-expect-error unknown fields are not in the form
    void login.fields.password;
    const typed: Form<{ email: string; remember: boolean }, void> = login;
    void [remember, typed];
  }
});

test("useForm validates on submit, maps the issues to fields and sends the schema output", async () => {
  const sent: CategoryOutput[] = [];
  const form = useForm({ schema: category, initial: { name: "", price: "" }, submit: (values) => { sent.push(values); return { id: "c1" }; } });
  let prevented = 0;
  const event = { preventDefault: () => { prevented++; } } as unknown as Event;
  assert.equal(await form.submit(event), undefined);
  assert.equal(prevented, 1);
  assert.deepEqual(form.errors.value, { name: "Escribe un nombre.", price: "Escribe un precio." });
  assert.equal(form.error.value, null);
  assert.equal(form.submitted.value, false);
  assert.deepEqual(sent, []);

  // A field with an error is validated again when it changes; others are not.
  form.fields.name.value = "  Bebidas ";
  assert.deepEqual(form.errors.value, { price: "Escribe un precio." });
  form.fields.price.value = "-1";
  assert.deepEqual(form.errors.value, { price: "El precio debe ser mayor que cero." });
  form.fields.price.value = "12,5";
  assert.deepEqual(form.errors.value, {});
  form.fields.name.value = "";
  assert.deepEqual(form.errors.value, {}, "a field without an error waits for the next submit");
  form.fields.name.value = "Bebidas";

  assert.equal(form.dirty.value, true);
  assert.deepEqual(await form.submit(event), { id: "c1" });
  assert.deepEqual(sent, [{ name: "Bebidas", priceCents: 1250 }]);
  assert.equal(form.submitted.value, true);
  assert.equal(form.pending.value, false);

  form.reset();
  assert.deepEqual([form.fields.name.value, form.fields.price.value, form.dirty.value, form.submitted.value], ["", "", false, false]);
  form.reset({ name: "Postres" });
  assert.deepEqual([form.fields.name.value, form.fields.price.value, form.dirty.value], ["Postres", "", false]);
  form.fields.price.value = "3";
  assert.equal(form.dirty.value, true);
  form.fields.price.value = "";
  assert.equal(form.dirty.value, false, "dirty compares with the values of the last reset");
});

test("useForm maps the issues of a server 400 to fields and the rest to the form message", async () => {
  const issues = [
    { path: "name", message: "Ese nombre ya existe." },
    { path: "name", message: "Segundo mensaje." },
    { path: "items.0.name", message: "Falta el nombre." },
    { path: "", message: "Revisa el formulario." },
    { path: "restaurantId", message: "Elige un restaurante." },
  ];
  const { value: form, reported, dispose } = withObserver(() => useForm({
    initial: { name: "Bebidas", items: [{ name: "" }] },
    submit: async (): Promise<string> => { throw new ClientError("INVALID_BODY", 400, "r1", issues); },
  }));
  assert.equal(await form.submit(), undefined);
  assert.deepEqual(form.errors.value, { name: "Ese nombre ya existe.", "items.0.name": "Falta el nombre." });
  assert.equal(form.error.value, "Revisa el formulario.");
  assert.ok(form.failure.value instanceof ClientError);
  assert.equal((form.failure.value as ClientError).requestId, "r1");
  assert.deepEqual(reported, [], "a server answer is not an unexpected failure");

  // Without a schema, changing a field clears its server messages.
  form.fields.items.value = [{ name: "Agua" }];
  assert.deepEqual(form.errors.value, { name: "Ese nombre ya existe." });
  form.fields.name.value = "Otra";
  assert.deepEqual(form.errors.value, {});
  dispose();
});

test("useForm shows other failures as the form message, keeps the error and reports unexpected ones", async () => {
  let failure: unknown = new ClientError("CATEGORY_EXISTS", 409);
  const { value: form, reported, dispose } = withObserver(() => useForm({
    schema: category,
    initial: { name: "Bebidas", price: "5" },
    submit: async () => { throw failure; },
    errorMessage: (error) => error instanceof ClientError && error.code === "CATEGORY_EXISTS" ? "Ya existe una categoría con ese nombre." : "No se pudo guardar.",
  }));
  assert.equal(await form.submit(), undefined);
  assert.equal(form.error.value, "Ya existe una categoría con ese nombre.");
  assert.equal((form.failure.value as ClientError).code, "CATEGORY_EXISTS");
  assert.deepEqual(form.errors.value, {});
  assert.deepEqual(reported, []);

  failure = new TypeError("Failed to fetch");
  assert.equal(await form.submit(), undefined);
  assert.equal(form.error.value, "No se pudo guardar.");
  assert.equal(form.failure.value, failure);
  assert.deepEqual(reported, [failure], "a failure that is not a server answer reaches the error observer");

  // Without errorMessage, the message is the error's own.
  const plain = withObserver(() => useForm({ initial: { name: "" }, submit: () => { throw new ClientError("FORBIDDEN", 403); } }));
  assert.equal(await plain.value.submit(), undefined);
  assert.equal(plain.value.error.value, "FORBIDDEN");

  // A new submission clears the previous failure.
  failure = undefined;
  const ok = withObserver(() => useForm({ initial: { name: "" }, submit: () => { if (failure) throw failure; return "ok"; } }));
  failure = new ClientError("BUSY", 503);
  await ok.value.submit();
  failure = undefined;
  assert.equal(await ok.value.submit(), "ok");
  assert.deepEqual([ok.value.error.value, ok.value.failure.value, ok.value.submitted.value], [null, null, true]);
  dispose();
  plain.dispose();
  ok.dispose();
});

test("useForm ignores a second submit while one is pending and keeps pending until it settles", async () => {
  const gate = deferred<string>();
  let calls = 0;
  const form = useForm({ initial: { name: "Bebidas" }, submit: () => { calls++; return gate.promise; } });
  let prevented = 0;
  const event = { preventDefault: () => { prevented++; } } as unknown as Event;
  const first = form.submit(event);
  assert.equal(form.pending.value, true);
  assert.equal(await form.submit(event), undefined, "a second submit while pending is ignored");
  assert.equal(prevented, 2, "the ignored submit still prevents the browser's own submission");
  assert.equal(calls, 1);
  gate.resolve("saved");
  assert.equal(await first, "saved");
  assert.equal(form.pending.value, false);
  assert.equal(calls, 1);
});

test("useForm marks pending during an asynchronous validation and drops results that a reset made stale", async () => {
  const validation = deferred<Result<{ name: string }>>();
  const asyncSchema = schema<{ name: string }>(() => validation.promise);
  const sent: unknown[] = [];
  const form = useForm({ schema: asyncSchema, initial: { name: "" }, submit: (values) => { sent.push(values); } });
  const run = form.submit();
  assert.equal(form.pending.value, true);
  form.reset({ name: "Nueva" });
  validation.resolve({ issues: [{ message: "Escribe un nombre.", path: ["name"] }] });
  assert.equal(await run, undefined);
  assert.deepEqual(form.errors.value, {}, "the reset discarded the validation that was running");
  assert.equal(form.pending.value, false);
  assert.equal(form.fields.name.value, "Nueva");
  assert.equal(sent.length, 0);

  const passing = deferred<Result<{ name: string }>>();
  const passingForm = useForm({ schema: schema<{ name: string }>(() => passing.promise), initial: { name: "Vieja" }, submit: (values) => { sent.push(values); } });
  const stale = passingForm.submit();
  passingForm.reset();
  passing.resolve({ value: { name: "Vieja" } });
  assert.equal(await stale, undefined);
  assert.deepEqual(sent, [], "values that a reset discarded are not sent");

  // A schema that throws is a failure of the form, not a rejection of submit.
  const broken = withObserver(() => useForm({
    schema: schema<{ name: string }>(() => { throw new Error("schema broke"); }),
    initial: { name: "" },
    submit: () => {},
  }));
  assert.equal(await broken.value.submit(), undefined);
  assert.equal(broken.value.error.value, "schema broke");
  assert.equal(broken.reported.length, 1);
  broken.dispose();
});

const fileUrl = (path: string): string => pathToFileURL(resolve(path)).href;

const runtime = async () => ({
  ...await import(fileUrl("src/framework/server.ts")) as typeof import("../src/framework/server.ts"),
  ...await import(fileUrl("src/framework/client.ts")) as typeof import("../src/framework/client.ts"),
});

const globals = globalThis as unknown as { meekoFormFetch?: typeof fetch };

const dataModule = (framework: string): string => `import { createRpcClient } from ${framework};
import type { RpcOperation } from ${framework};
const manifest = { api: [], rpc: [{ id: "categories.create", pathname: "/_meeko/rpc/categories.create" }] } as const;
const globals = globalThis as unknown as { meekoFormFetch: typeof fetch };
export const rpc = createRpcClient<{ "categories.create": RpcOperation<{ name: string; priceCents: number }, { id: string }> }>(manifest, {
  baseUrl: "https://example.test",
  fetch: ((input, init) => globals.meekoFormFetch(input, init)) as typeof fetch,
});
type Issue = { message: string; path: { key: string }[] };
export const categoryInput = {
  "~standard": {
    version: 1 as const,
    vendor: "test",
    types: undefined as { input: { name: string; price: string }; output: { name: string; priceCents: number } } | undefined,
    validate(value: unknown) {
      const input = value as { name: string; price: string };
      const issues: Issue[] = [];
      const name = input.name.trim();
      if (!name) issues.push({ message: "Escribe un nombre.", path: [{ key: "name" }] });
      const priceCents = Math.round(Number(input.price.replace(",", ".")) * 100);
      if (!input.price.trim() || !Number.isFinite(priceCents)) issues.push({ message: "Escribe un precio.", path: [{ key: "price" }] });
      return issues.length ? { issues } : { value: { name, priceCents } };
    },
  },
};
`;

const priceField = `<script lang="ts">
const props = defineProps<{ error?: string | undefined }>();
const value = defineModel<string>("value");
</script>
<template><label>Precio <input class="price" model="value"></label><p class="price-error">{props.error ?? ""}</p></template>`;

const categoryPage = `<script lang="ts">
import { ClientError, useForm } from "@meekojs/meeko/framework";
import { categoryInput, rpc } from "./data.ts";
import * as PriceField from "./PriceField.meeko";
const form = useForm({
  schema: categoryInput,
  initial: { name: "Bebidas", price: "" },
  submit: (values) => rpc.categories.create(values),
  errorMessage: (failure) => failure instanceof ClientError && failure.code === "CATEGORY_EXISTS" ? "Ya existe." : "No se pudo guardar.",
});
</script>
<template><form on:submit="form.submit"><p class="form-error">{form.error.value ?? ""}</p><input class="name" model="form.fields.name"><p class="name-error">{form.errors.value.name ?? ""}</p><PriceField model:value="form.fields.price" bind:error="form.errors.value.price" /><p class="state">{form.pending.value ? "pending" : form.submitted.value ? "saved" : "idle"}:{String(form.dirty.value)}</p><button class="save">Guardar</button></form></template>`;

async function loadPage(): Promise<{ page: ClientComponent; cleanup: () => Promise<void> }> {
  await mkdir(resolve(".meeko"), { recursive: true });
  const directory = await mkdtemp(resolve(".meeko", "form-test-"));
  const runtimeUrl = (path: string): string => JSON.stringify(fileUrl(path));
  await writeFile(join(directory, "data.ts"), dataModule(runtimeUrl("src/framework.ts")));
  for (const [file, source] of Object.entries({ "PriceField.meeko": priceField, "category.meeko": categoryPage })) {
    const code = compile(source, join(directory, file)).code
      .replace(`from "@meekojs/meeko/internal"`, `from ${runtimeUrl("src/internal.ts")}`)
      .replace(`from "@meekojs/meeko/framework"`, `from ${runtimeUrl("src/framework.ts")}`)
      .replaceAll(`from "@meekojs/meeko"`, `from ${runtimeUrl("src/index.ts")}`)
      .replace(`from "./PriceField.meeko"`, `from "./PriceField.ts"`);
    await writeFile(join(directory, file.replace(/\.meeko$/, ".ts")), code);
  }
  const page = await import(pathToFileURL(join(directory, "category.ts")).href) as ClientComponent;
  return { page, cleanup: () => rm(directory, { recursive: true, force: true }) };
}

const routes: readonly RouteRecord[] = createRouteManifest([{ id: "/", file: "category.meeko", layouts: [] }]);

test("a .meeko form renders in SSR without submitting, hydrates, and submits valid and invalid data", { timeout: 60_000 }, async () => {
  const calls: string[] = [];
  let gate: Promise<void> | undefined;
  globals.meekoFormFetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    calls.push(`${new URL(String(input)).pathname} ${String(init?.body)}`);
    if (gate) await gate;
    const body = JSON.parse(String(init?.body)) as { name: string; priceCents: number };
    if (body.name === "Existe") return Response.json({ code: "CATEGORY_EXISTS", status: 409, requestId: "r" }, { status: 409 });
    if (body.name === "Reservada") {
      return Response.json({ code: "INVALID_INPUT", status: 400, requestId: "r", issues: [{ path: "name", message: "Ese nombre está reservado." }, { path: "", message: "Revisa los datos." }] }, { status: 400 });
    }
    return Response.json({ id: "c1" });
  }) as typeof fetch;
  const { page, cleanup } = await loadPage();
  try {
    const { createFrameworkHandler, mountClientApp } = await runtime();
    const server = createFrameworkHandler({ routes, loadPage: async () => page });
    const response = await server(new Request("https://example.test/", { headers: { accept: "text/html" } }));
    const html = await response.text();
    const visible = html.replace(/<!--[\s\S]*?-->/g, "");
    assert.match(visible, /<input[^>]* value="Bebidas" class="name">/);
    assert.match(visible, /<p class="state">idle:false<\/p>/);
    assert.deepEqual(calls, [], "SSR never submits");

    const browser = new HappyWindow({ url: "https://example.test/" });
    browser.document.write(html);
    const root = browser.document.getElementById("app")!;
    const reported: unknown[] = [];
    const app = await mountClientApp({
      routes, root: root as unknown as Element, payload: browser.document.getElementById("meeko-payload")!.textContent!,
      loadPage: async () => page, browser: browser as unknown as Window, onError: (error) => { reported.push(error); },
    });
    const query = (selector: string) => root.querySelector(selector)!;
    const text = (selector: string): string | null => query(selector).textContent;
    const type = (selector: string, value: string): void => {
      const input = query(selector) as unknown as HTMLInputElement;
      input.value = value;
      input.dispatchEvent(new browser.Event("input", { bubbles: true }) as unknown as Event);
    };
    const submit = async (): Promise<void> => {
      const form = query("form");
      const event = new browser.Event("submit", { bubbles: true, cancelable: true });
      form.dispatchEvent(event);
      assert.equal(event.defaultPrevented, true, "submit prevents the browser's own submission");
      await flush();
    };

    // Invalid data: the schema's messages reach the native input and the component field.
    type(".name", " ");
    await submit();
    assert.deepEqual(calls, []);
    assert.equal(text(".name-error"), "Escribe un nombre.");
    assert.equal(text(".price-error"), "Escribe un precio.");
    assert.equal(text(".state"), "idle:true");
    type(".price", "12,5");
    assert.equal(text(".price-error"), "", "a field with an error is validated again as it changes");

    // Server issues map onto the fields and the form message.
    type(".name", "Reservada");
    await submit();
    assert.deepEqual(calls.splice(0), ['/_meeko/rpc/categories.create {"name":"Reservada","priceCents":1250}']);
    assert.equal(text(".name-error"), "Ese nombre está reservado.");
    assert.equal(text(".form-error"), "Revisa los datos.");

    // A server error without issues is the form message.
    type(".name", "Existe");
    assert.equal(text(".name-error"), "", "the edited field drops the server message once the schema accepts it");
    await submit();
    calls.splice(0);
    assert.equal(text(".form-error"), "Ya existe.");

    // Valid data, with pending while the request runs.
    let open!: () => void;
    gate = new Promise((resolve) => { open = resolve; });
    type(".name", "Postres");
    const form = query("form");
    form.dispatchEvent(new browser.Event("submit", { bubbles: true, cancelable: true }));
    await flush();
    assert.equal(text(".state"), "pending:true");
    form.dispatchEvent(new browser.Event("submit", { bubbles: true, cancelable: true }));
    gate = undefined;
    open();
    await flush();
    assert.deepEqual(calls.splice(0), ['/_meeko/rpc/categories.create {"name":"Postres","priceCents":1250}'], "a second submit while pending is ignored");
    assert.equal(text(".state"), "saved:true");
    assert.equal(text(".form-error"), "");
    assert.deepEqual(reported, []);
    app.dispose();
    browser.happyDOM.abort();
  } finally {
    delete globals.meekoFormFetch;
    await cleanup();
  }
});

test("useForm is a framework autoimport that a project composable of the same name replaces", { timeout: 30_000 }, async () => {
  const project = await createTempProject("form-autoimport");
  const root = project.root;
  try {
    await writeFile(join(root, "package.json"), '{"private":true,"type":"module"}\n');
    const filename = join(root, "app", "pages", "index.meeko");
    const registry = await discoverAutoImports(root);
    assert.match(applyAutoImports("const form = useForm({ initial: {}, submit: () => {} });", filename, registry, "client"), /import \{ useForm as useForm \} from "@meekojs\/meeko\/framework"/);
    await mkdir(join(root, "app", "composables"), { recursive: true });
    await writeFile(join(root, "app", "composables", "form.ts"), "export function useForm() { return 1; }\n");
    const own = await discoverAutoImports(root);
    assert.equal(own.filter((entry) => entry.name === "useForm").length, 1);
    assert.match(applyAutoImports("const form = useForm();", filename, own, "client"), /composables\/form\.js/);
  } finally {
    await project.remove();
  }
});

test("meeko check types useForm fields with model, model:value and on:submit", { timeout: 120_000 }, async () => {
  const { checkSource } = await import("../src/check.ts");
  await mkdir(resolve(".meeko"), { recursive: true });
  const root = await mkdtemp(resolve(".meeko", "form-check-"));
  await writeFile(join(root, "package.json"), '{"private":true,"type":"module"}\n');
  await writeFile(join(root, "tsconfig.json"), `${JSON.stringify({
    compilerOptions: {
      types: ["node"],
      paths: { "@meekojs/meeko/internal": ["../../src/internal.ts"], "@meekojs/meeko/framework": ["../../src/framework.ts"], "@meekojs/meeko": ["../../src/index.ts"] },
    },
  })}\n`);
  await writeFile(join(root, "PriceField.meeko"), priceField);
  const head = `<script lang="ts">\nimport { useForm } from "@meekojs/meeko/framework";\nimport * as PriceField from "./PriceField.meeko";\nconst form = useForm({ initial: { name: "", price: "", count: 0 }, submit: (values) => values.name });\n</script>\n`;
  const cases = [
    { name: "Typed", template: `<template><form on:submit="form.submit"><input model="form.fields.name"><PriceField model:value="form.fields.price" bind:error="form.errors.value.price" /><p>{form.errors.value.name ?? ""}{form.error.value ?? ""}</p></form></template>`, codes: [] as string[] },
    { name: "UnknownField", template: `<template><input model="form.fields.nope"></template>`, codes: ["TS2339"] },
    { name: "NumberField", template: `<template><input model="form.fields.count"></template>`, codes: ["TS2322"] },
    { name: "ReadOnly", template: `<template><input model="form.pending"></template>`, codes: ["TS2322"] },
  ];
  try {
    for (const item of cases) {
      const source = head + item.template;
      const diagnostics = await checkSource(source, join(root, `${item.name}.meeko`));
      const messages = JSON.stringify(diagnostics);
      const codes = new Set(diagnostics.map((diagnostic) => diagnostic.code));
      if (item.codes.length === 0) assert.deepEqual([...codes], [], `${item.name}: ${messages}`);
      for (const code of item.codes) assert.ok(codes.has(code), `${item.name}: ${messages}`);
    }
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

const formPage = (field: string) => `<script lang="ts">
const form = useForm({ initial: { name: "", accepted: false }, submit: (values) => values.name.length });
</script>
<template><form on:submit="form.submit"><input model="form.fields.${field}"><input type="checkbox" model="form.fields.accepted"><p>{form.errors.value.name ?? ""}</p></form></template>
`;

test("meeko check types the useForm autoimport in an application page", { timeout: 120_000 }, async () => {
  const project = await createTempProject("form-app-check");
  const root = project.root;
  try {
    await writeFile(join(root, "package.json"), '{"private":true,"type":"module"}\n');
    await mkdir(join(root, "node_modules", "@meekojs"), { recursive: true });
    await symlink(resolve("."), join(root, "node_modules", "@meekojs", "meeko"), "junction");
    await mkdir(join(root, "app", "pages"), { recursive: true });
    const page = join(root, "app", "pages", "index.meeko");
    await writeFile(page, formPage("name"));
    await prepareFrameworkTypeDeclarations(root);
    assert.deepEqual((await checkApp(root)).map((item) => `${item.filename}:${item.code}: ${item.message}`), []);
    await writeFile(page, formPage("nmae"));
    const invalid = await checkApp(root);
    assert.ok(invalid.some((item) => item.filename === page && /TS2339/.test(item.code)), JSON.stringify(invalid));
  } finally {
    await project.remove();
  }
});
