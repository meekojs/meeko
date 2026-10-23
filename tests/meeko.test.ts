import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { Window } from "happy-dom";
import { compile } from "../src/compiler.ts";
import { batch, computed, createRoot, effect, signal } from "../src/reactivity.ts";
import { escapeHtml, serializeJson } from "../src/server.ts";
import { hydrate, renderToString } from "../examples/counter/Counter.generated.ts";
import { renderExamplePage } from "../examples/counter/server.ts";
import { hydrate as hydrateAttributes, renderToString as renderAttributes } from "../examples/attributes/Attributes.generated.ts";

test("SSR genera HTML escapado y estado aislado por render", () => {
  assert.match(renderToString({ initial: 2 }), /meeko:text:0-->2/);
  assert.match(renderToString({ initial: 7 }), /meeko:text:0-->7/);
  assert.equal(escapeHtml('<img src="x" onerror="x">'), "&lt;img src=&quot;x&quot; onerror=&quot;x&quot;&gt;");
  assert.equal(serializeJson({ value: "</script>" }), '{"value":"\\u003c/script\\u003e"}');
  assert.match(renderExamplePage({ initial: 2 }), /<script id="meeko-props" type="application\/json">/);
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
  assert.equal(button.textContent, "3 · doble: 6");
  dispose();
  button.dispatchEvent(new window.MouseEvent("click", { bubbles: true }));
  assert.equal(button.textContent, "3 · doble: 6");
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
  assert.throws(() => hydrate(root as unknown as Element, { initial: 3 }), /Hydration mismatch/);
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
