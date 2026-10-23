import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { Window } from "happy-dom";
import { compile } from "../src/compiler.ts";
import { batch, computed, createRoot, effect, signal } from "../src/reactivity.ts";
import { escapeHtml, serializeJson } from "../src/server.ts";
import { renderFor } from "../src/dom.ts";
import { hydrate, renderToString, renderWithState } from "../examples/counter/Counter.generated.ts";
import { renderExamplePage } from "../examples/counter/server.ts";
import { hydrate as hydrateAttributes, renderToString as renderAttributes } from "../examples/attributes/Attributes.generated.ts";
import { hydrate as hydrateRegions, renderToString as renderRegions } from "../examples/regions/Regions.generated.ts";
import { hydrate as hydratePrimitives, renderToString as renderPrimitives } from "../examples/primitives/Primitives.generated.ts";

test("SSR genera HTML escapado y estado aislado por render", () => {
  assert.match(renderToString({ initial: 2 }), /meeko:text:0-->2/);
  assert.match(renderToString({ initial: 7 }), /meeko:text:0-->7/);
  assert.equal(escapeHtml('<img src="x" onerror="x">'), "&lt;img src=&quot;x&quot; onerror=&quot;x&quot;&gt;");
  assert.equal(serializeJson({ value: "</script>" }), '{"value":"\\u003c/script\\u003e"}');
  assert.match(renderExamplePage({ initial: 2 }), /<script id="meeko-payload" type="application\/json">/);
});

test("la transferencia de estado rechaza datos que JSON cambiaría silenciosamente", () => {
  assert.throws(() => serializeJson({ value: Number.NaN }), /Non-finite number at \$\.value/);
  assert.throws(() => serializeJson({ value: undefined }), /Non-serializable value at \$\.value/);
  assert.throws(() => serializeJson({ value: new Date() }), /Non-plain object at \$\.value/);
  assert.throws(() => serializeJson([, 1]), /Sparse array/);
  const circular: { self?: unknown } = {};
  circular.self = circular;
  assert.throws(() => serializeJson(circular), /Circular reference at \$\.self/);
  assert.equal(serializeJson({ nested: ["<script>", 2] }), '{"nested":["\\u003cscript\\u003e",2]}');
});

test("SSR entrega señales serializables y la hidratación restaura sus valores", () => {
  const { html, state } = renderWithState({ initial: 6 });
  assert.deepEqual(state, { count: 6 });
  assert.match(html, /meeko:text:0-->6/);
  assert.equal(serializeJson(state), '{"count":6}');
  assert.match(renderToString({ initial: 0 }, state), /meeko:text:0-->6/);
  const window = new Window();
  const root = window.document.createElement("main");
  root.innerHTML = html;
  const release = hydrate(root as unknown as Element, { initial: 6 }, state);
  root.querySelector("button")?.dispatchEvent(new window.MouseEvent("click", { bubbles: true }));
  assert.match(root.textContent ?? "", /7 · doble: 14/);
  release();
  window.happyDOM.abort();
});

test("hidrata el HTML existente y actualiza solo los textos reactivos", () => {
  const window = new Window();
  const root = window.document.createElement("div");
  root.innerHTML = renderToString({ initial: 2 });
  const button = root.querySelector("button");
  assert.ok(button);
  const dispose = hydrate(root as unknown as Element, { initial: 2 });
  assert.equal(root.querySelector("button"), button);
  button.dispatchEvent(new window.MouseEvent("click", { bubbles: true }));
  assert.equal(button.textContent?.trim(), "3 · doble: 6");
  dispose();
  button.dispatchEvent(new window.MouseEvent("click", { bubbles: true }));
  assert.equal(button.textContent?.trim(), "3 · doble: 6");
  window.happyDOM.abort();
});

test("dos raíces del mismo componente mantienen estado y eventos independientes", () => {
  const window = new Window();
  const first = window.document.createElement("main");
  const second = window.document.createElement("main");
  first.innerHTML = renderToString({ initial: 1 });
  second.innerHTML = renderToString({ initial: 10 });
  const releaseFirst = hydrate(first as unknown as Element, { initial: 1 });
  const releaseSecond = hydrate(second as unknown as Element, { initial: 10 });
  first.querySelector("button")?.dispatchEvent(new window.MouseEvent("click", { bubbles: true }));
  assert.match(first.textContent ?? "", /2 · doble: 4/);
  assert.match(second.textContent ?? "", /10 · doble: 20/);
  releaseFirst();
  second.querySelector("button")?.dispatchEvent(new window.MouseEvent("click", { bubbles: true }));
  assert.match(second.textContent ?? "", /11 · doble: 22/);
  releaseSecond();
  window.happyDOM.abort();
});

test("detecta diferencias entre el servidor y el navegador", () => {
  const window = new Window();
  const root = window.document.createElement("div");
  root.innerHTML = renderToString({ initial: 2 });
  assert.throws(() => hydrate(root as unknown as Element, { initial: 3 }), /Hydration mismatch in Counter\.meeko:\d+:\d+/);
  window.happyDOM.abort();
});

test("atributos dinámicos se escapan en SSR y se actualizan sobre el nodo hidratado", () => {
  const window = new Window();
  const root = window.document.createElement("main");
  root.innerHTML = renderAttributes({ initial: `a\" & <b>` });
  const input = root.querySelector("input");
  const button = root.querySelector("button");
  assert.ok(input);
  assert.ok(button);
  assert.equal(input.getAttribute("value"), `a\" & <b>`);
  assert.equal(input.getAttribute("disabled"), "");
  const dispose = hydrateAttributes(root as unknown as Element, { initial: `a\" & <b>` });
  assert.equal(root.querySelector("input"), input);
  button.dispatchEvent(new window.MouseEvent("click", { bubbles: true }));
  assert.equal(input.getAttribute("value"), "updated & ready");
  assert.equal(input.hasAttribute("disabled"), false);
  dispose();
  button.dispatchEvent(new window.MouseEvent("click", { bubbles: true }));
  assert.equal(input.getAttribute("value"), "updated & ready");
  window.happyDOM.abort();
});

test("condiciones y listas con claves preservan nodos al reordenar y liberan regiones", () => {
  const window = new Window();
  const root = window.document.createElement("main");
  root.innerHTML = renderRegions({ initial: "Alpha" });
  const itemA = root.querySelector('[data-id="a"]');
  const itemB = root.querySelector('[data-id="b"]');
  assert.ok(itemA);
  assert.ok(itemB);
  const dispose = hydrateRegions(root as unknown as Element, { initial: "Alpha" });
  const click = (name: string): void => {
    const button = [...root.querySelectorAll("button")].find((candidate) => candidate.textContent === name);
    assert.ok(button, `Missing ${name} button`);
    button.dispatchEvent(new window.MouseEvent("click", { bubbles: true }));
  };
  click("Reverse");
  assert.deepEqual([...root.querySelectorAll("li")].map((item) => item.getAttribute("data-id")), ["b", "a"]);
  assert.equal(root.querySelector('[data-id="a"]'), itemA);
  assert.equal(root.querySelector('[data-id="b"]'), itemB);
  assert.equal(itemB.querySelector("small")?.textContent, "0");
  assert.equal(itemA.querySelector("small")?.textContent, "1");
  assert.equal(itemB.querySelector("strong")?.textContent, "first");
  assert.equal(itemA.querySelector("strong"), null);
  click("Prepend");
  assert.deepEqual([...root.querySelectorAll("li")].map((item) => item.getAttribute("data-id")), ["c", "b", "a"]);
  assert.equal(itemB.querySelector("small")?.textContent, "1");
  assert.equal(itemB.querySelector("strong"), null);
  click("Beta");
  assert.match(root.textContent ?? "", /Selected: b/);
  assert.match(itemB.textContent ?? "", /selected/);
  assert.doesNotMatch(itemA.textContent ?? "", /selected/);
  click("Rename");
  assert.equal(root.querySelector('[data-id="a"]'), itemA);
  assert.match(itemA.textContent ?? "", /Renamed/);
  click("Remove");
  assert.deepEqual([...root.querySelectorAll("li")].map((item) => item.getAttribute("data-id")), ["c", "a"]);
  assert.equal(itemB.isConnected, false);
  click("Toggle");
  assert.equal(root.querySelector("p"), null);
  click("Toggle");
  assert.match(root.querySelector("p")?.textContent ?? "", /Selected: b/);
  dispose();
  click("Reverse");
  assert.deepEqual([...root.querySelectorAll("li")].map((item) => item.getAttribute("data-id")), ["c", "a"]);
  window.happyDOM.abort();
});

test("una lista de valores primitivos actualiza el texto sin reemplazar su nodo", () => {
  const window = new Window();
  const root = window.document.createElement("main");
  root.innerHTML = renderPrimitives({});
  const first = root.querySelector("li");
  assert.ok(first);
  const dispose = hydratePrimitives(root as unknown as Element, {});
  root.querySelector("button")?.dispatchEvent(new window.MouseEvent("click", { bubbles: true }));
  assert.equal(root.querySelector("li"), first);
  assert.equal(first.textContent, "Gamma");
  dispose();
  window.happyDOM.abort();
});

test("SSR rechaza claves duplicadas y claves no serializables", () => {
  assert.throws(() => renderFor(0, [{ id: "a" }, { id: "a" }], (item) => item.id, () => "<li></li>"), /Duplicate Meeko list key/);
  assert.throws(() => renderFor(0, [{ id: null }], (item) => item.id as unknown as string, () => "<li></li>"), /keys must be strings or finite numbers/);
});

test("batch y computed actualizan una sola vez y liberan observadores", () => {
  const first = signal(1);
  const second = signal(2);
  let runs = 0;
  const dispose = createRoot((disposeRoot) => {
    const total = computed(() => first.value + second.value);
    effect(() => { runs++; void total.value; });
    return disposeRoot;
  });
  assert.equal(runs, 1);
  batch(() => { first.value = 3; second.value = 4; });
  assert.equal(runs, 2);
  dispose();
  first.value = 9;
  assert.equal(runs, 2);
});

test("liberar una raíz también libera sus instancias hijas", () => {
  const value = signal(0);
  let runs = 0;
  const dispose = createRoot((disposeParent) => {
    createRoot(() => {
      effect(() => { void value.value; runs++; });
    });
    return disposeParent;
  });
  assert.equal(runs, 1);
  dispose();
  value.value = 1;
  assert.equal(runs, 1);
});

test("el compilador rechaza secciones incompatibles de forma explícita", async () => {
  const source = await readFile(new URL("../examples/counter/Counter.meeko", import.meta.url), "utf8");
  const result = compile(source);
  assert.match(result.code, /export function renderToString/);
  assert.match(result.code, /export function hydrate/);
  assert.match(result.css, /button\[data-meeko-s-[a-f0-9]{8}\]/);
  assert.match(result.code, /data-meeko-s-[a-f0-9]{8}/);
  assert.throws(() => compile(source.replace("button {", ":global(button) {")), /:global/);
});
