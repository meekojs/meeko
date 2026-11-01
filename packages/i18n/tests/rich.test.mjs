import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { join } from "node:path";
import test from "node:test";
import { fileURLToPath, pathToFileURL } from "node:url";

import { createI18n } from "../dist/index.js";
import { compileCatalog, messageParameters, messageTags, richSegments } from "../dist/messages.js";
import { localeCookie } from "../dist/runtime.js";

const translator = (messages, extra = {}) => createI18n({ locale: "es", catalog: compileCatalog(messages, "es.json"), locales: ["es", "en"], defaultLocale: "es", path: () => "/", ...extra });

test("rich() splits a message by its tags, and t() still returns the text as written", () => {
  const i18n = translator({ built: "Hecho con <code>.meeko</code>, <kbd>{key}</kbd> y {name}.", plain: "Sin marcado", lone: "<br/>" });
  assert.deepEqual(i18n.rich("built", { key: "K", name: "Ana" }), [
    { text: "Hecho con " }, { tag: "code", text: ".meeko" }, { text: ", " }, { tag: "kbd", text: "K" }, { text: " y Ana." },
  ]);
  assert.deepEqual(i18n.rich("plain"), [{ text: "Sin marcado" }]);
  assert.deepEqual(i18n.rich("lone"), [{ tag: "br", text: "" }]);
  assert.equal(i18n.t("built", { key: "K", name: "Ana" }), "Hecho con <code>.meeko</code>, <kbd>K</kbd> y Ana.");
});

test("a value never becomes a tag: only the catalog's text forms them", () => {
  const i18n = translator({ found: "Sin resultados para «{query}» en <code>{where}</code>." });
  const attack = "<img src=x onerror=alert(1)></code><code>";
  assert.deepEqual(i18n.rich("found", { query: attack, where: "</code><b>" }), [
    { text: `Sin resultados para «${attack}» en ` }, { tag: "code", text: "</code><b>" }, { text: "." },
  ]);
});

test("what is not a pair of tags stays text, and a tag cannot contain another", () => {
  assert.deepEqual(richSegments(["Array<T> y <b> sin cerrar, <a href=x>y</a> con atributo"]), [{ parts: ["Array", "<T>", " y ", "<b>", " sin cerrar, <a href=x>y", "</a>", " con atributo"] }]);
  assert.deepEqual(richSegments(["<code>Array<T></code>"]), [{ tag: "code", parts: ["Array", "<T>"] }]);
  // A name of Object.prototype could reach something that is not a snippet: it is text.
  assert.deepEqual(richSegments(["<__proto__>x</__proto__> <constructor/>"]), [{ parts: ["<__proto__>x</__proto__> <constructor/>"] }]);
  assert.throws(() => compileCatalog({ deep: "<a>ver <b>esto</b></a>" }, "es.json"), /es\.json: deep: <b> is nested inside <a>/);
  assert.throws(() => compileCatalog({ plural: { plural: "n", forms: { other: "<a><br/></a>" } } }, "es.json"), /es\.json: plural\.forms\.other: <br> is nested inside <a>/);
});

test("the tags of a message come from all its forms; they are not parameters", () => {
  const { items } = compileCatalog({ items: { plural: "total", forms: { one: "<b>{count}</b> elemento", other: "<b>{count}</b> elementos de <i>{owner}</i>" } } }, "es.json");
  assert.deepEqual(messageTags(items), ["b", "i"]);
  assert.deepEqual(messageParameters(items), { owner: "value", total: "number" });
  const i18n = translator({ items: { plural: "total", forms: { one: "<b>{count}</b> elemento", other: "<b>{count}</b> elementos" } } });
  assert.deepEqual(i18n.rich("items", { total: 1 }), [{ tag: "b", text: "1" }, { text: " elemento" }]);
  assert.deepEqual(i18n.rich("items", { total: 3 }), [{ tag: "b", text: "3" }, { text: " elementos" }]);
});

test("t(key, values, { locale }) reads another language's messages with its plural rules", () => {
  const foreign = { en: compileCatalog({ go: "Read in {name}", files: { plural: "total", forms: { one: "{count} file", other: "{count} files" } }, rich: "See <a>this</a>" }, "en.json") };
  const calls = [];
  const i18n = translator({ go: "Leer en {name}", files: { plural: "total", forms: { one: "{count} archivo", other: "{count} archivos" } } }, {
    foreign, missing: (key, locale) => { calls.push([key, locale]); return key; },
  });
  assert.equal(i18n.t("go", { name: "x" }), "Leer en x");
  assert.equal(i18n.t("go", { name: "x" }, { locale: "en" }), "Read in x");
  assert.equal(i18n.t("go", { name: "x" }, { locale: "es" }), "Leer en x");
  assert.equal(i18n.t("files", { total: 1 }, { locale: "en" }), "1 file");
  assert.deepEqual(i18n.rich("rich", undefined, { locale: "en" }), [{ text: "See " }, { tag: "a", text: "this" }]);
  // A key outside the multilingual namespaces is a missing message of that locale.
  assert.equal(i18n.t("home.title", undefined, { locale: "en" }), "home.title");
  assert.deepEqual(calls, [["home.title", "en"]]);
  assert.throws(() => i18n.t("go", { name: "x" }, { locale: "fr" }), { name: "RangeError" });
  assert.throws(() => translator({ a: "b" }).t("a", undefined, { locale: "en" }), { name: "ReferenceError", message: "Missing i18n message a for en" });
});

test("the cookie omits Domain on a host outside that domain, so localhost keeps working", () => {
  const cookie = { name: "meeko-locale", domain: "meekojs.com" };
  for (const host of ["meekojs.com", "i18n.meekojs.com", "A.B.MEEKOJS.COM"]) assert.match(localeCookie(cookie, "en", host), /; Domain=meekojs\.com$/, host);
  for (const host of ["localhost", "127.0.0.1", "notmeekojs.com", "meekojs.com.evil.test", "preview.pages.dev"]) assert.doesNotMatch(localeCookie(cookie, "en", host), /Domain/, host);
  assert.match(localeCookie({ name: "l", domain: ".meekojs.com" }, "en", "ui.meekojs.com"), /; Domain=meekojs\.com$/);
  // Without a host (a Set-Cookie written by the application), the configured Domain stays.
  assert.match(localeCookie(cookie, "en"), /; Domain=meekojs\.com$/);
  assert.doesNotMatch(localeCookie({ name: "l" }, "en", "meekojs.com"), /Domain/);
});

test("rememberLocale writes the cookie for the document's host", () => {
  const written = [];
  const original = Object.getOwnPropertyDescriptor(globalThis, "document");
  try {
    for (const hostname of ["localhost", "ui.meekojs.com"]) {
      Object.defineProperty(globalThis, "document", { configurable: true, value: { location: { hostname }, set cookie(text) { written.push(text); }, get cookie() { return ""; } } });
      translator({ a: "b" }, { cookie: { name: "meeko-locale", domain: "meekojs.com" } }).rememberLocale("en");
    }
  } finally {
    if (original) Object.defineProperty(globalThis, "document", original);
    else delete globalThis.document;
  }
  assert.doesNotMatch(written[0], /Domain/);
  assert.match(written[1], /Domain=meekojs\.com/);
});

/**
 * The real <I18nT>, compiled and run against the same runtime in SSR and over a DOM. happy-dom is the
 * core's test dependency: this package only needs it here.
 */
test("<I18nT> renders, hydrates and updates inside the sentence, with values as text", { timeout: 120_000 }, async () => {
  const packageRoot = fileURLToPath(new URL("..", import.meta.url));
  const { Window } = createRequire(join(packageRoot, "..", "meeko", "package.json"))("happy-dom");
  const { compile } = await import("@meekojs/meeko/compiler");
  await mkdir(join(packageRoot, ".meeko", "tests"), { recursive: true });
  const directory = await mkdtemp(join(packageRoot, ".meeko", "tests", "rich-"));
  const sources = {
    "I18nT.ts": await readFile(join(packageRoot, "src", "app", "components", "I18nT.meeko"), "utf8"),
    "I18nTPart.ts": await readFile(join(packageRoot, "src", "app", "components", "internal", "I18nTPart.meeko"), "utf8"),
    "Host.ts": `<script lang="ts">
      import { provide, signal } from "@meekojs/meeko";
      import { createI18n, i18nContext } from "@meekojs/i18n";
      import { compileCatalog } from "@meekojs/i18n/messages-for-test";
      import * as I18nT from "./I18nT.meeko";
      const catalog = compileCatalog({
        hint: "Pulsa <kbd>{key}</kbd> para ver «{query}» o <a>la guía</a>.",
        count: { plural: "total", forms: { one: "<b>{count}</b> nota", other: "Hay <b>{count}</b> notas" } },
        unfilled: "Con <u>texto</u> de respaldo",
      }, "es.json");
      provide(i18nContext, createI18n({ locale: "es", catalog, foreign: { en: compileCatalog({ hint: "Press <kbd>{key}</kbd>", count: "x", unfilled: "y" }, "en.json") }, locales: ["es", "en"], defaultLocale: "es", path: () => "/" }));
      const query = signal("<img src=x onerror=alert(1)>");
      const key = signal("Esc");
      const total = signal(1);
      const label = signal("marca");
      globalThis.__richHost = { query, key, total, label };
    </script>
    <template><p id="hint">Antes: <I18nT key="hint" bind:values="{ key: key.value, query: query.value }"><snippet name="kbd" params="text"><kbd bind:title="label.value">{text}</kbd></snippet><snippet name="a" params="text"><a href="/guia">{text}</a></snippet></I18nT> Fin.</p><p id="count"><I18nT key="count" bind:values="{ total: total.value }"><snippet name="b" params="text"><b>{text}</b></snippet></I18nT></p><p id="unfilled"><I18nT key="unfilled" /></p><p id="other"><I18nT key="hint" locale="en" bind:values="{ key: 'K', query: '' }"><snippet name="kbd" params="text"><kbd>{text}</kbd></snippet></I18nT></p></template>`,
  };
  const window = new Window({ url: "https://meeko.test/" });
  try {
    const meeko = (specifier) => JSON.stringify(import.meta.resolve(specifier));
    for (const [name, source] of Object.entries(sources)) {
      const { code } = compile(source, join(directory, name.replace(/\.ts$/, ".meeko")));
      await writeFile(join(directory, name), code
        .replaceAll('"@meekojs/meeko/internal"', meeko("@meekojs/meeko/internal"))
        .replaceAll('"@meekojs/meeko"', meeko("@meekojs/meeko"))
        .replaceAll('"@meekojs/i18n/messages-for-test"', JSON.stringify(new URL("../dist/messages.js", import.meta.url).href))
        .replaceAll(/['"]@meekojs\/i18n['"]/g, JSON.stringify(new URL("../dist/index.js", import.meta.url).href))
        .replace("./internal/I18nTPart.meeko", "./I18nTPart.ts")
        .replace("./I18nT.meeko", "./I18nT.ts"));
    }
    const host = await import(pathToFileURL(join(directory, "Host.ts")).href);
    const rendered = host.renderWithState({});
    const root = window.document.createElement("div");
    window.document.body.appendChild(root);
    root.innerHTML = rendered.html;
    const text = (id) => root.querySelector(`#${id}`).textContent;
    const server = () => {
      assert.equal(text("hint"), "Antes: Pulsa Esc para ver «<img src=x onerror=alert(1)>» o la guía. Fin.");
      assert.equal(root.querySelector("#hint img"), null, "a value is text, never markup");
      assert.equal(root.querySelector("#hint kbd").textContent, "Esc");
      assert.equal(root.querySelector("#hint kbd").getAttribute("title"), "marca");
      assert.equal(root.querySelector("#hint a").getAttribute("href"), "/guia");
      assert.equal(root.querySelector("#hint a").textContent, "la guía");
      assert.equal(root.querySelector("#hint kbd").parentElement.id, "hint", "no element of its own around the sentence");
      assert.equal(text("count"), "1 nota");
      assert.equal(text("unfilled"), "Con texto de respaldo", "a tag without a snippet shows its text");
      assert.equal(root.querySelector("#unfilled u"), null);
      assert.equal(text("other"), "Press K");
    };
    server();
    const kbd = root.querySelector("#hint kbd");
    const release = host.hydrate(root, {}, rendered.state);
    assert.equal(root.querySelector("#hint kbd"), kbd, "hydration keeps the server's nodes");
    server();
    const state = globalThis.__richHost;
    state.query.value = "<script>x</script>";
    assert.equal(text("hint"), "Antes: Pulsa Esc para ver «<script>x</script>» o la guía. Fin.");
    assert.equal(root.querySelector("#hint script"), null);
    assert.equal(root.querySelector("#hint kbd"), kbd, "a new value keeps the snippet's nodes");
    state.key.value = "Tab";
    assert.equal(kbd.textContent, "Tab");
    state.label.value = "otra";
    assert.equal(kbd.getAttribute("title"), "otra", "the snippet still belongs to the parent's scope");
    // Another plural form has other runs: the sentence changes shape.
    state.total.value = 3;
    assert.equal(text("count"), "Hay 3 notas");
    assert.equal(root.querySelector("#count b").textContent, "3");
    state.total.value = 1;
    assert.equal(text("count"), "1 nota");
    release();
  } finally {
    delete globalThis.__richHost;
    await window.happyDOM.close();
    await rm(directory, { recursive: true, force: true });
  }
});
