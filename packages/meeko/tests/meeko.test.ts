import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import test from "node:test";
import { Window } from "happy-dom";
import { createServer } from "vite";
import { checkSource } from "../src/check.ts";
import { compile } from "../src/compiler.ts";
import { MeekoCompileError } from "../src/compiler/sfc.ts";
import { meeko } from "../src/vite.ts";
import { batch, computed, createContext, createRoot, effect, inject, provide, signal } from "../src/reactivity.ts";
import { escapeHtml, serializeJson } from "../src/server.ts";
import { bindAttribute, bindComponent, bindFor, bindText, renderFor } from "../src/dom.ts";
import type { Component } from "../src/dom.ts";
import { hydrate, renderToString, renderWithState } from "../examples/counter/Counter.generated.ts";
import { renderExamplePage } from "../examples/counter/server.ts";
import { hydrate as hydrateAttributes, renderToString as renderAttributes } from "../examples/attributes/Attributes.generated.ts";
import { hydrate as hydrateRegions, renderToString as renderRegions } from "../examples/regions/Regions.generated.ts";
import { hydrate as hydratePrimitives, renderToString as renderPrimitives } from "../examples/primitives/Primitives.generated.ts";

test("el contexto usa la instancia antecesora más cercana sin mezclar raíces", () => {
  const key = createContext<number>("count");
  assert.throws(() => inject(key), /Missing Meeko context/);
  assert.throws(() => provide(key, 1), /active component root/);
  createRoot((dispose) => {
    provide(key, 2);
    assert.equal(inject(key), 2);
    createRoot(() => {
      assert.equal(inject(key), 2);
      provide(key, 3);
      assert.equal(inject(key), 3);
    });
    assert.equal(inject(key), 2);
    dispose();
  });
  createRoot(() => assert.throws(() => inject(key), /Missing Meeko context/));
});

test("un contenido de componente tipado puede cambiar conservando sus límites", () => {
  const window = new Window();
  const root = window.document.createElement("div");
  root.innerHTML = "<!--meeko:component:0--><span>A</span><!--/meeko:component:0-->";
  const released: string[] = [];
  const moduleFor = (name: string): Component<{ label: string }> => ({
    renderToString: ({ label }) => `<span>${name}:${label}</span>`,
    renderWithState: ({ label }) => ({ html: `<span>${name}:${label}</span>`, state: {} }),
    hydrateScope: () => () => { released.push(name); },
  });
  const first = moduleFor("A");
  const second = moduleFor("B");
  const selected = signal<Component<{ label: string }>>(first);
  const stop = bindComponent({ root: root as unknown as Element }, 0, () => selected.value, () => ({ label: "ok" }), "Host.meeko:1:1");
  assert.equal(root.textContent, "A");
  selected.value = second;
  assert.equal(root.textContent, "B:ok");
  assert.deepEqual(released, ["A"]);
  stop();
  assert.deepEqual(released, ["A", "B"]);
  window.happyDOM.abort();
});

test("SSR genera HTML escapado y estado aislado por render", () => {
  assert.match(renderToString({ initial: 2 }), /meeko:text:0-->2/);
  assert.match(renderToString({ initial: 7 }), /meeko:text:0-->7/);
  assert.equal(escapeHtml('<img src="x" onerror="x">'), "&lt;img src=&quot;x&quot; onerror=&quot;x&quot;&gt;");
  assert.equal(serializeJson({ value: "</script>" }), '{"value":"\\u003c/script\\u003e"}');
  assert.match(renderExamplePage({ initial: 2 }), /<script id="meeko-payload" type="application\/json">/);
});

test("hidratar texto y atributos iguales al SSR no muta el DOM", () => {
  const window = new Window();
  const root = window.document.createElement("main");
  root.innerHTML = '<!--meeko:text:0-->A<!--/meeko:text:0--><span data-meeko="0" title="A"></span>';
  const value = signal("A");
  const observer = new window.MutationObserver(() => {});
  observer.observe(root, { subtree: true, childList: true, characterData: true, attributes: true });
  const stopText = bindText({ root: root as unknown as Element }, 0, () => value.value, "Test.meeko:1:1");
  const stopAttribute = bindAttribute({ root: root as unknown as Element }, 0, "title", () => value.value, "Test.meeko:1:2");
  assert.equal(observer.takeRecords().length, 0);
  value.value = "B";
  assert.equal(root.querySelector("span")?.getAttribute("title"), "B");
  assert.equal(root.firstChild?.nextSibling?.textContent, "B");
  assert.ok(observer.takeRecords().length > 0);
  stopAttribute();
  stopText();
  observer.disconnect();
  window.happyDOM.abort();
});

test("los atributos de formulario enlazados actualizan la propiedad viva tras editar el control", () => {
  const window = new Window();
  const root = window.document.createElement("main");
  root.innerHTML = '<input data-meeko="0" value=""><input type="checkbox" data-meeko="1"><select><option value="a">A</option><option value="b" data-meeko="2">B</option></select>';
  const text = signal("");
  const checked = signal(false);
  const selected = signal(false);
  const scope = { root: root as unknown as Element };
  const stops = [
    bindAttribute(scope, 0, "value", () => text.value, "Form.meeko:1:1"),
    bindAttribute(scope, 1, "checked", () => checked.value, "Form.meeko:1:2"),
    bindAttribute(scope, 2, "selected", () => selected.value, "Form.meeko:1:3"),
  ];
  const input = root.querySelector("input") as unknown as HTMLInputElement;
  const checkbox = root.querySelector("input[type=checkbox]") as unknown as HTMLInputElement;
  const option = root.querySelector("option[value=b]") as unknown as HTMLOptionElement;
  // The user edits each control, which detaches it from its attribute.
  input.value = "typed";
  checkbox.checked = true;
  option.selected = true;
  text.value = "reset";
  text.value = "";
  checked.value = true;
  checked.value = false;
  selected.value = true;
  selected.value = false;
  assert.equal(input.value, "");
  assert.equal(input.getAttribute("value"), "");
  assert.equal(checkbox.checked, false);
  assert.equal(option.selected, false);
  text.value = "next";
  assert.equal(input.value, "next");
  for (const stop of stops) stop();
  window.happyDOM.abort();
});

test("bind:value aplica el valor inicial a textarea y select sin pisar lo que el usuario ya cambió", () => {
  const window = new Window();
  const markup = '<textarea data-meeko="0" value="hola"></textarea><select data-meeko="1" value="b"><option value="a">A</option><option value="b">B</option><option value="c">C</option></select>';
  const pristine = window.document.createElement("main");
  pristine.innerHTML = markup;
  const edited = window.document.createElement("main");
  edited.innerHTML = markup;
  (edited.querySelector("textarea") as unknown as HTMLTextAreaElement).value = "escrito";
  (edited.querySelector("select") as unknown as HTMLSelectElement).value = "c";
  const text = signal("hola");
  const choice = signal("b");
  const stops = [pristine, edited].flatMap((root) => {
    const scope = { root: root as unknown as Element };
    return [
      bindAttribute(scope, 0, "value", () => text.value, "Form.meeko:1:1"),
      bindAttribute(scope, 1, "value", () => choice.value, "Form.meeko:1:2"),
    ];
  });
  assert.equal((pristine.querySelector("textarea") as unknown as HTMLTextAreaElement).value, "hola");
  assert.equal((pristine.querySelector("select") as unknown as HTMLSelectElement).value, "b");
  assert.equal((edited.querySelector("textarea") as unknown as HTMLTextAreaElement).value, "escrito");
  assert.equal((edited.querySelector("select") as unknown as HTMLSelectElement).value, "c");
  for (const stop of stops) stop();
  window.happyDOM.abort();
});

test("bind:value no reescribe un input cuyo valor ya coincide, para conservar el cursor", () => {
  const window = new Window();
  const root = window.document.createElement("main");
  root.innerHTML = '<input data-meeko="0" value="">';
  const input = root.querySelector("input") as unknown as HTMLInputElement;
  const text = signal("");
  const stop = bindAttribute({ root: root as unknown as Element }, 0, "value", () => text.value, "Form.meeko:1:1");
  const descriptor = Object.getOwnPropertyDescriptor(Object.getPrototypeOf(input), "value")!;
  let writes = 0;
  Object.defineProperty(input, "value", {
    configurable: true,
    get() { return descriptor.get!.call(this); },
    set(value: string) { writes++; descriptor.set!.call(this, value); },
  });
  input.value = "abc";
  writes = 0;
  text.value = "abc";
  assert.equal(writes, 0);
  text.value = "";
  assert.equal(writes, 1);
  stop();
  window.happyDOM.abort();
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

test("listas con claves mueven solo las regiones necesarias y conservan estado y nodos", () => {
  const window = new Window();
  const root = window.document.createElement("main");
  type Item = { id: number; label: string };
  const items = signal<Item[]>(Array.from({ length: 5 }, (_, id) => ({ id, label: `Row ${id}` })));
  root.innerHTML = renderFor(0, items.value, (item) => item.id, (item) => `<li data-id="${item.id}">${item.label}</li>`);
  const nodes = new Map([...root.querySelectorAll("li")].map((node) => [Number(node.getAttribute("data-id")), node]));
  const originalInsertBefore = root.insertBefore.bind(root);
  let moves = 0;
  root.insertBefore = (node, before) => {
    if (node.nodeType === 11) moves++;
    return originalInsertBefore(node, before);
  };
  const dispose = bindFor(
    { root: root as unknown as Element }, 0, () => items.value, (item) => item.id,
    (item) => `<li data-id="${item.id}">${item.label}</li>`,
    (item, index, inner) => {
      const element = inner.start!.nextSibling as Element;
      return effect(() => { element.textContent = `${item.value.label}:${index.value}`; });
    },
  );
  const assertOrder = (ids: number[]): void => {
    assert.deepEqual([...root.querySelectorAll("li")].map((node) => Number(node.getAttribute("data-id"))), ids);
    for (const id of ids) assert.equal(root.querySelector(`[data-id="${id}"]`), nodes.get(id));
  };
  assert.equal(moves, 0);
  items.value = [items.value[4]!, ...items.value.slice(0, -1)];
  assertOrder([4, 0, 1, 2, 3]);
  assert.equal(moves, 1, "una rotación solo mueve un rango");
  assert.equal(nodes.get(4)?.textContent, "Row 4:0");
  const newItem = { id: 5, label: "New" };
  items.value = [items.value[0]!, newItem, items.value[2]!, items.value[4]!];
  nodes.set(5, root.querySelector('[data-id="5"]')!);
  assertOrder([4, 5, 1, 3]);
  assert.equal(nodes.get(0)?.isConnected, false);
  assert.equal(nodes.get(2)?.isConnected, false);
  items.value = [...items.value].reverse().map((item) => item.id === 5 ? { ...item, label: "Renamed" } : item);
  assertOrder([3, 1, 5, 4]);
  assert.equal(nodes.get(5)?.textContent, "Renamed:2");
  const permutations = (values: Item[]): Item[][] => values.length === 0 ? [[]] : values.flatMap((value, index) =>
    permutations(values.filter((_, candidate) => candidate !== index)).map((tail) => [value, ...tail]));
  for (const permutation of permutations(items.value)) {
    items.value = permutation;
    assertOrder(permutation.map((item) => item.id));
  }
  dispose();
  window.happyDOM.abort();
});

test("una lista reconcilia cambios ocurridos durante la hidratación inicial", () => {
  const window = new Window();
  const root = window.document.createElement("main");
  const items = signal(["a", "b"]);
  root.innerHTML = renderFor(0, items.value, (item) => item, (item) => `<span>${item}</span>`);
  const first = root.querySelector("span");
  const second = root.querySelectorAll("span")[1];
  const dispose = bindFor(
    { root: root as unknown as Element }, 0, () => items.value, (item) => item,
    (item) => `<span>${item}</span>`,
    (item) => {
      if (item.value === "a") items.value = ["b", "a"];
      return () => {};
    },
  );
  assert.deepEqual([...root.querySelectorAll("span")], [second, first]);
  dispose();
  window.happyDOM.abort();
});

test("una lista detecta claves mutadas durante la hidratación inicial", () => {
  const window = new Window();
  const root = window.document.createElement("main");
  const items = [{ id: 1 }, { id: 2 }];
  root.innerHTML = renderFor(0, items, (item) => item.id, (item) => `<span>${item.id}</span>`);
  const oldSecond = root.querySelectorAll("span")[1];
  const dispose = bindFor(
    { root: root as unknown as Element }, 0, () => items, (item) => item.id,
    (item) => `<span>${item.id}</span>`,
    (item) => {
      if (item.value.id === 2) items[1]!.id = 3;
      return () => {};
    },
  );
  assert.deepEqual([...root.querySelectorAll("span")].map((node) => node.textContent), ["1", "3"]);
  assert.equal(oldSecond?.isConnected, false);
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
  assert.throws(() => compile(source.replace("button {", ":global button {")), /:global/);
});

test("los estilos con ámbito admiten :global(...) sin limitar el selector interno", () => {
  const styled = (rules: string): string =>
    compile(`<script lang="ts">const value = 1;</script><template><p>{value}</p></template><style scoped>${rules}</style>`, "Global.meeko").css;
  const scope = /\[(data-meeko-s-[a-f0-9]{8})\]/.exec(styled(".probe {}"))?.[1];
  assert.ok(scope);
  const cases: Array<[string, string]> = [
    [".card :global(.icon) { color: red; }", `.card[${scope}] .icon { color: red; }`],
    [":global(body) .card { color: red; }", `body .card[${scope}] { color: red; }`],
    [":global(html.dark) { color: red; }", "html.dark { color: red; }"],
    [":global( .theme > .app ) .card { color: red; }", `.theme > .app .card[${scope}] { color: red; }`],
    [".card :global(.icon)::before { content: \"\"; }", `.card[${scope}] .icon::before { content: ""; }`],
    [".card:hover::before { content: \"\"; }", `.card:hover[${scope}]::before { content: ""; }`],
    [".card:hover :global(.icon) { color: red; }", `.card:hover[${scope}] .icon { color: red; }`],
    [".card > :global(.icon) .label { color: red; }", `.card > .icon .label[${scope}] { color: red; }`],
    [".a, :global(.b) { color: red; }", `.a[${scope}], .b { color: red; }`],
    ["@media (min-width: 1px) { :global(body) .card { color: red; } }", `@media (min-width: 1px) { body .card[${scope}] { color: red; } }`],
    ["@keyframes spin { from { opacity: 0; } }", "@keyframes spin { from { opacity: 0; } }"],
  ];
  for (const [input, expected] of cases) assert.equal(styled(input), expected, input);
});

test("los estilos con ámbito rechazan :global sin selector o en posiciones ambiguas", () => {
  const prefix = `<script lang="ts">const value = 1;</script><template><p>{value}</p></template><style scoped>\n`;
  const cases: Array<[string, RegExp]> = [
    [":global .card { color: red; }", /:global\(<selector>\)/],
    [".card :global { color: red; }", /:global\(<selector>\)/],
    [":global() { color: red; }", /:global\(<selector>\)/],
    [":global(.a, .b) { color: red; }", /un solo selector/],
    [".card:not(:global(.b)) { color: red; }", /nivel superior/],
  ];
  for (const [rules, message] of cases) {
    const source = `${prefix}${rules}\n</style>`;
    assert.throws(() => compile(source, "Global.meeko"), (error: unknown) => {
      assert.ok(error instanceof MeekoCompileError, String(error));
      assert.equal(error.diagnostic.code, "MEEK019");
      assert.match(error.diagnostic.message, message);
      assert.equal(error.diagnostic.location.offset, source.indexOf(":global"), rules);
      return true;
    });
  }
});

test("SSR e hidratación coinciden con expresiones de texto anidadas", { timeout: 35_000 }, async () => {
  const fixture = resolve("tests/fixtures/NestedInterpolation.meeko");
  assert.deepEqual(await checkSource(await readFile(fixture, "utf8"), fixture), []);
  const server = await createServer({ configFile: false, plugins: [meeko()], server: { middlewareMode: true, hmr: false } });
  const browser = new Window();
  try {
    const component = await server.ssrLoadModule(fixture) as {
      renderToString(props: Record<string, never>): string;
      hydrate(root: Element, props: Record<string, never>): () => void;
    };
    const root = browser.document.createElement("main");
    const html = component.renderToString({});
    root.innerHTML = html;
    const text = (selector: string): string[] => [...root.querySelectorAll(selector)].map((node) => node.textContent);
    const snapshot = (): Array<string | null> => [...text(".object"), ...text(".template"), ...text(".string"), ...text(".comment"), ...text("li"), root.querySelector(".attribute")?.getAttribute("title") ?? null];
    assert.deepEqual(snapshot(), ["2", "1px {a}b}", "}a}b{", "1", "1:one-1", "2:two-1", "n1"]);
    const release = component.hydrate(root as unknown as Element, {});
    assert.equal(root.innerHTML, html);
    root.querySelector("button")!.click();
    assert.deepEqual(snapshot(), ["4", "2px {a}b}", "}a}b{", "2", "1:one-2", "2:two-2", "n2"]);
    release();
  } finally {
    browser.happyDOM.abort();
    await server.close();
  }
});
