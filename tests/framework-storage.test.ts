import assert from "node:assert/strict";
import { mkdir, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import test from "node:test";
import { pathToFileURL } from "node:url";
import { Window as HappyWindow } from "happy-dom";
import { compile } from "../src/compiler.ts";
import { applyAutoImports, discoverAutoImports } from "../src/autoimports.ts";
import type { ClientComponent } from "../src/framework/client.ts";
import { createRouteManifest } from "../src/framework/router.ts";
import type { RouteRecord } from "../src/framework/router.ts";
import { createTempProject } from "./helpers/temp-project.ts";

const fileUrl = (path: string): string => pathToFileURL(resolve(path)).href;

/** The runtime as the compiled pages import it, by file URL: one instance for pages, server and browser. */
const runtime = async () => ({
  ...await import(fileUrl("src/framework/server.ts")) as typeof import("../src/framework/server.ts"),
  ...await import(fileUrl("src/framework/client.ts")) as typeof import("../src/framework/client.ts"),
  ...await import(fileUrl("src/framework/storage.ts")) as typeof import("../src/framework/storage.ts"),
  ...await import(fileUrl("src/reactivity.ts")) as typeof import("../src/reactivity.ts"),
  ...await import(fileUrl("src/lifecycle.ts")) as typeof import("../src/lifecycle.ts"),
});

const log = (): string[] => (globalThis as unknown as { storageLog: string[] }).storageLog;

const ticketPage = `<script lang="ts">
import { onMounted, signal } from "@meekojs/meeko";
import { useStorage } from "@meekojs/meeko/framework";
import * as Badge from "./badge.meeko";
import * as Late from "./late.meeko";
const record = (globalThis as unknown as { storageLog: string[] }).storageLog;
const open = useStorage("ui:open", false);
const lines = useStorage("pos:ticket", [] as string[]);
const same = useStorage("pos:ticket", [] as string[]);
const draft = useStorage("form:draft", "", { storage: "session" });
const note = useStorage<string | undefined>("note", undefined);
const count = useStorage("count", 0, { schema: { "~standard": { version: 1, vendor: "test", validate: (value: unknown) => typeof value === "number" ? { value } : { issues: [{ message: "not a number" }] } } } });
const weird = useStorage<unknown>("weird", null);
const extra = signal(false);
record.push("setup:" + String(open.value) + ":" + lines.value.join("+") + ":" + String(count.value));
onMounted(() => { record.push("mounted:" + String(open.value) + ":" + lines.value.join("+") + ":" + String(lines === same)); });
</script>
<template><p class="open" if:when="open.value">open</p><p class="lines">{lines.value.join(",")}</p><p class="draft">{draft.value}</p><p class="note">{note.value ?? "none"}</p><p class="count">{String(count.value)}</p><Badge /><div class="extra" if:when="extra.value"><Badge /><Late /></div><button class="add" on:click="() => { lines.value = [...lines.value, 'x']; }">a</button><button class="toggle" on:click="() => { open.value = !open.value; }">t</button><button class="type" on:click="() => { draft.value = 'hola'; }">d</button><button class="note-set" on:click="() => { note.value = 'n'; }">n</button><button class="note-clear" on:click="() => { note.value = undefined; }">u</button><button class="show" on:click="() => { extra.value = !extra.value; }">e</button><button class="weird" on:click="() => { weird.value = 10n; }">w</button></template>`;

const badge = `<script lang="ts">
import { useStorage } from "@meekojs/meeko/framework";
const lines = useStorage("pos:ticket", [] as string[]);
</script>
<template><span class="badge">{String(lines.value.length)}</span></template>`;

const otherPage = `<script lang="ts">
import { useStorage } from "@meekojs/meeko/framework";
const lines = useStorage("pos:ticket", [] as string[]);
</script>
<template><p class="other">{lines.value.join(",")}</p></template>`;

const late = `<script lang="ts">
import { useStorage } from "@meekojs/meeko/framework";
const value = useStorage("late", "none");
(globalThis as unknown as { storageLog: string[] }).storageLog.push("late:" + value.value);
</script>
<template><span class="late">{value.value}</span></template>`;

const sources: Record<string, string> = { "ticket.meeko": ticketPage, "badge.meeko": badge, "late.meeko": late, "other.meeko": otherPage };

/** Compiles the components against the source runtime, so the test does not depend on dist/. */
async function loadModules(): Promise<{ modules: Record<string, ClientComponent>; cleanup: () => Promise<void> }> {
  const project = await createTempProject("storage-test");
  const directory = project.root;
  const runtimePath = (path: string): string => JSON.stringify(pathToFileURL(resolve(path)).href);
  const modules: Record<string, ClientComponent> = {};
  // Children first, so a page imports a written module.
  for (const file of ["badge.meeko", "late.meeko", "ticket.meeko", "other.meeko"]) {
    const code = compile(sources[file]!, join(directory, file)).code
      .replace(`from "@meekojs/meeko/internal"`, `from ${runtimePath("src/internal.ts")}`)
      .replace(`from "@meekojs/meeko/framework"`, `from ${runtimePath("src/framework.ts")}`)
      .replace(`from "@meekojs/meeko"`, `from ${runtimePath("src/index.ts")}`)
      .replace(/from "\.\/(\w+)\.meeko"/g, 'from "./$1.ts"');
    const target = join(directory, file.replace(/\.meeko$/, ".ts"));
    await writeFile(target, code);
    modules[file] = await import(pathToFileURL(target).href) as ClientComponent;
  }
  return { modules, cleanup: () => project.remove() };
}

const routes: readonly RouteRecord[] = createRouteManifest([
  { id: "/ticket", file: "ticket.meeko", layouts: [] },
  { id: "/other", file: "other.meeko", layouts: [] },
]);

const text = (root: { querySelector(selector: string): { textContent: string | null } | null }, selector: string): string | null | undefined => root.querySelector(selector)?.textContent;
const click = (root: Element, selector: string): void => (root.querySelector(selector) as unknown as HTMLButtonElement).click();

interface Boot {
  readonly errors: unknown[];
  readonly serverErrors: unknown[];
  readonly listeners: { added: number; removed: number };
}

async function boot(modules: Record<string, ClientComponent>, url: string, prepare: (browser: HappyWindow) => void = () => {}) {
  const { createFrameworkHandler, mountClientApp } = await runtime();
  const state: Boot = { errors: [], serverErrors: [], listeners: { added: 0, removed: 0 } };
  const server = createFrameworkHandler({ routes, loadPage: async (file) => modules[file]!, onError: (error) => { state.serverErrors.push(error); } });
  const browser = new HappyWindow({ url });
  prepare(browser);
  const add = browser.addEventListener.bind(browser);
  const remove = browser.removeEventListener.bind(browser);
  browser.addEventListener = ((type: string, ...rest: unknown[]) => {
    if (type === "storage") state.listeners.added++;
    return (add as (...args: unknown[]) => void)(type, ...rest);
  }) as typeof browser.addEventListener;
  browser.removeEventListener = ((type: string, ...rest: unknown[]) => {
    if (type === "storage") state.listeners.removed++;
    return (remove as (...args: unknown[]) => void)(type, ...rest);
  }) as typeof browser.removeEventListener;
  const response = await server(new Request(url, { headers: { accept: "text/html" } }));
  const document = await response.text();
  if (response.status !== 200) throw new Error(`SSR failed (${response.status})`, { cause: state.serverErrors[0] });
  browser.document.write(document);
  const root = browser.document.getElementById("app")! as unknown as Element;
  const payload = browser.document.getElementById("meeko-payload")!.textContent!;
  const app = await mountClientApp({
    routes, root, payload,
    loadPage: async (file) => modules[file]!,
    onNavigationError: () => {},
    onError: (error) => { state.errors.push(error); },
    browser: browser as unknown as Window,
  });
  return { app, browser, root, html: document.replace(/<!--[\s\S]*?-->/g, ""), ...state };
}

function storageEvent(browser: HappyWindow, key: string | null, newValue: string | null): void {
  const event = new browser.StorageEvent("storage", { key: key as string, newValue: newValue as string, storageArea: browser.localStorage });
  browser.dispatchEvent(event);
}

test("SSR and hydration use the initial value; the stored value arrives after hydration, before onMounted", async () => {
  (globalThis as unknown as { storageLog: string[] }).storageLog = [];
  const { modules, cleanup } = await loadModules();
  try {
    const { app, browser, root, html, errors } = await boot(modules, "https://example.test/ticket", (browser) => {
      browser.localStorage.setItem("ui:open", "true");
      browser.localStorage.setItem("pos:ticket", '["a","b"]');
      browser.localStorage.setItem("count", "7");
      browser.sessionStorage.setItem("form:draft", '"borrador"');
    });
    // The server never reads the storage: the HTML and the payload have the initial values.
    assert.doesNotMatch(html, /class="open"/);
    assert.match(html, /<p class="lines"><\/p>/);
    assert.match(html, /<span class="badge">0<\/span>/);
    // The page state of the payload leaves the stored signals out: the browser storage is their source.
    const payload = JSON.parse(browser.document.getElementById("meeko-payload")!.textContent!) as { state: Record<string, unknown> };
    assert.deepEqual(Object.keys(payload.state).filter((name) => ["open", "lines", "same", "draft", "note", "count", "weird"].includes(name)), []);
    // An if: that the stored value would open hydrated against the SSR value: no mismatch.
    assert.deepEqual(log().splice(0), ["setup:false::0", "setup:false::0", "mounted:true:a+b:true"]);
    assert.equal(text(root, ".open"), "open");
    assert.equal(text(root, ".lines"), "a,b");
    assert.equal(text(root, ".badge"), "2", "a child component shares the signal of the key");
    assert.equal(text(root, ".draft"), "borrador");
    assert.equal(text(root, ".count"), "7");
    // Hydration did not write the stored values back over themselves or the SSR values.
    assert.equal(browser.localStorage.getItem("pos:ticket"), '["a","b"]');
    assert.deepEqual(errors, []);
    app.dispose();
    browser.happyDOM.abort();
  } finally {
    await cleanup();
  }
});

test("writes persist as JSON, undefined removes the key, and a later mount reads the stored value at once", async () => {
  (globalThis as unknown as { storageLog: string[] }).storageLog = [];
  const { modules, cleanup } = await loadModules();
  try {
    const { app, browser, root, errors } = await boot(modules, "https://example.test/ticket");
    click(root, ".add");
    click(root, ".add");
    assert.equal(browser.localStorage.getItem("pos:ticket"), '["x","x"]');
    assert.equal(text(root, ".badge"), "2");
    click(root, ".toggle");
    assert.equal(browser.localStorage.getItem("ui:open"), "true");
    click(root, ".type");
    assert.equal(browser.sessionStorage.getItem("form:draft"), '"hola"');
    assert.equal(browser.localStorage.getItem("form:draft"), null, "session storage is a separate area");
    click(root, ".note-set");
    assert.equal(browser.localStorage.getItem("note"), '"n"');
    click(root, ".note-clear");
    assert.equal(browser.localStorage.getItem("note"), null);
    assert.equal(text(root, ".note"), "none");

    // A component that mounts later renders the stored value in its first HTML, without a flash
    // of the initial value; a key already in use keeps its signal and is not read again.
    browser.localStorage.setItem("pos:ticket", '["x","x","x"]');
    browser.localStorage.setItem("late", '"saved"');
    log().splice(0);
    click(root, ".show");
    assert.equal(root.querySelectorAll(".badge")[1]?.textContent, "2");
    assert.equal(text(root, ".late"), "saved");
    assert.deepEqual(log().splice(0), ["late:saved", "late:saved"], "the browser render and the hydration of a later mount both see the stored value");
    // Hiding it releases the last user of "late": the next mount reads the storage again.
    click(root, ".show");
    browser.localStorage.setItem("late", '"again"');
    click(root, ".show");
    assert.equal(text(root, ".late"), "again");
    assert.deepEqual(errors, []);

    // A client navigation renders its page in the browser with the signal the app already uses.
    assert.equal(await app.navigate("/other"), true);
    assert.equal(text(root, ".other"), "x,x");
    app.dispose();
    browser.happyDOM.abort();
  } finally {
    await cleanup();
  }
});

test("another tab updates the signal through the storage event until the component is released", async () => {
  (globalThis as unknown as { storageLog: string[] }).storageLog = [];
  const { modules, cleanup } = await loadModules();
  try {
    const { app, browser, root, listeners, errors } = await boot(modules, "https://example.test/ticket");
    browser.localStorage.setItem("pos:ticket", '["z"]');
    storageEvent(browser, "pos:ticket", '["z"]');
    assert.equal(text(root, ".lines"), "z");
    assert.equal(text(root, ".badge"), "1");
    // Corrupt JSON and a value the schema rejects fall back to the initial value.
    storageEvent(browser, "pos:ticket", "{nope");
    assert.equal(text(root, ".lines"), "");
    storageEvent(browser, "count", '"seven"');
    assert.equal(text(root, ".count"), "0");
    storageEvent(browser, "count", "3");
    assert.equal(text(root, ".count"), "3");
    // Another key, or another storage area, does not touch the signal.
    browser.dispatchEvent(new browser.StorageEvent("storage", { key: "count", newValue: "9", storageArea: browser.sessionStorage }));
    assert.equal(text(root, ".count"), "3");
    // A clear() in another tab resets every key to its initial value.
    storageEvent(browser, null, null);
    assert.equal(text(root, ".count"), "0");
    // An event never writes back.
    assert.equal(browser.localStorage.getItem("count"), null);
    assert.ok(listeners.added > 0);
    app.dispose();
    assert.equal(listeners.removed, listeners.added, "every storage listener is released with its components");
    assert.deepEqual(errors, []);
    browser.happyDOM.abort();
  } finally {
    await cleanup();
  }
});

test("blocked or full storage never throws: the signal keeps working in memory", async () => {
  (globalThis as unknown as { storageLog: string[] }).storageLog = [];
  const { modules, cleanup } = await loadModules();
  try {
    const blocked = await boot(modules, "https://example.test/ticket", (browser) => {
      Object.defineProperty(browser, "localStorage", { configurable: true, get() { throw new browser.DOMException("The operation is insecure.", "SecurityError"); } });
    });
    click(blocked.root, ".add");
    click(blocked.root, ".toggle");
    assert.equal(text(blocked.root, ".lines"), "x");
    assert.equal(text(blocked.root, ".badge"), "1");
    assert.equal(text(blocked.root, ".open"), "open");
    assert.deepEqual(blocked.errors, []);
    blocked.app.dispose();
    blocked.browser.happyDOM.abort();

    const full = await boot(modules, "https://example.test/ticket", (browser) => {
      const items = new Map<string, string>();
      const storage = {
        getItem: (key: string) => items.get(key) ?? null,
        setItem: () => { throw new browser.DOMException("Quota exceeded", "QuotaExceededError"); },
        removeItem: (key: string) => { items.delete(key); },
      };
      Object.defineProperty(browser, "sessionStorage", { configurable: true, get: () => storage });
    });
    click(full.root, ".type");
    assert.equal(text(full.root, ".draft"), "hola");
    assert.equal(full.errors.length, 0);
    // An unexpected failure, a value that JSON cannot represent, reaches the error observer.
    click(full.root, ".weird");
    assert.equal(full.errors.length, 1);
    assert.ok(full.errors[0] instanceof TypeError, String(full.errors[0]));
    full.app.dispose();
    full.browser.happyDOM.abort();
  } finally {
    await cleanup();
  }
});

test("useStorage fails clearly outside a component script and validates its arguments", async () => {
  const { useStorage, createRoot } = await runtime();
  assert.throws(() => useStorage("k", 1), /must be called while a component script runs/);
  const { collectMounted } = await runtime();
  createRoot((dispose) => {
    collectMounted(null, () => {
      assert.throws(() => useStorage("", 1), TypeError);
      assert.throws(() => useStorage("k", 1, { storage: "disk" as never }), TypeError);
      // A render outside the browser keeps the initial value.
      assert.equal(useStorage("k", 1).value, 1);
    });
    dispose();
  });
});

test("useStorage is a framework autoimport that a project composable of the same name replaces", { timeout: 30_000 }, async () => {
  const project = await createTempProject("storage-autoimport");
  const root = project.root;
  try {
    await writeFile(join(root, "package.json"), '{"private":true,"type":"module"}\n');
    const filename = join(root, "app", "pages", "index.meeko");
    const registry = await discoverAutoImports(root);
    assert.match(applyAutoImports('const theme = useStorage("theme", "light");', filename, registry, "client"), /import \{ useStorage as useStorage \} from "@meekojs\/meeko\/framework"/);
    await mkdir(join(root, "app", "composables"), { recursive: true });
    await writeFile(join(root, "app", "composables", "storage.ts"), "export function useStorage() { return 1; }\n");
    const own = await discoverAutoImports(root);
    assert.equal(own.filter((entry) => entry.name === "useStorage").length, 1);
    assert.match(applyAutoImports("const value = useStorage();", filename, own, "client"), /composables\/storage\.js/);
  } finally {
    await project.remove();
  }
});

test("useApiMutation comes from the generated clients and yields to a project composable of the same name", { timeout: 30_000 }, async () => {
  const project = await createTempProject("mutation-autoimport");
  const root = project.root;
  try {
    await writeFile(join(root, "package.json"), '{"private":true,"type":"module"}\n');
    const generated = join(root, ".meeko", "generated");
    await mkdir(generated, { recursive: true });
    for (const scope of ["client", "server"]) await writeFile(join(generated, `clients.${scope}.ts`), "export const useApiMutation = () => undefined;\n");
    const filename = join(root, "app", "pages", "index.meeko");
    const registry = await discoverAutoImports(root);
    assert.deepEqual(registry.filter((entry) => entry.name === "useApiMutation").map((entry) => entry.scope).sort(), ["client", "server"]);
    assert.match(applyAutoImports('const save = useApiMutation("/api/notes", "POST");', filename, registry, "client"), /clients\.client/);
    await mkdir(join(root, "app", "composables"), { recursive: true });
    await writeFile(join(root, "app", "composables", "mutation.ts"), "export function useApiMutation() { return 1; }\n");
    const own = await discoverAutoImports(root);
    assert.equal(own.filter((entry) => entry.name === "useApiMutation").length, 1);
    assert.match(applyAutoImports("const value = useApiMutation();", filename, own, "client"), /composables\/mutation\.js/);
  } finally {
    await project.remove();
  }
});

// Types only: this function is never called.
export function typedStorage(useStorage: typeof import("../src/framework.ts").useStorage): void {
  type Theme = "light" | "dark";
  const picklist = {
    "~standard": {
      version: 1 as const,
      vendor: "test",
      validate: (value: unknown): { readonly value: Theme; readonly issues?: undefined } | { readonly issues: readonly { readonly message: string }[] } =>
        value === "light" || value === "dark" ? { value } : { issues: [{ message: "invalid theme" }] },
      types: undefined as { readonly input: unknown; readonly output: Theme } | undefined,
    },
  };
  // With a schema, the type comes from the schema.
  const theme = useStorage("theme", "light", { schema: picklist });
  const narrowed: Theme = theme.value;
  // @ts-expect-error the initial value must satisfy the schema
  useStorage("theme", "blue", { schema: picklist });
  const count = useStorage("count", 0, { storage: "session" });
  const total: number = count.value;
  const draft = useStorage<string | undefined>("draft", undefined);
  draft.value = undefined;
  // @ts-expect-error only "local" and "session"
  useStorage("x", 1, { storage: "disk" });
  void [narrowed, total];
}
