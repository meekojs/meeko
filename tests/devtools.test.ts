import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import test from "node:test";
import { pathToFileURL } from "node:url";
import { Window } from "happy-dom";
import { compile } from "../src/compiler.ts";
import { DEVTOOLS_PROTOCOL_VERSION, devtoolsUpdate, devtoolsWrite, registerDevtoolsInstance } from "../src/devtools.ts";
import type { DevtoolsAssignmentSite, DevtoolsEvent, DevtoolsHook } from "../src/devtools.ts";
import { bindAttribute, bindText } from "../src/dom.ts";
import { enableHotModule, registerHotInstance, replaceHotModule } from "../src/hmr.ts";
import type { HotComponent, HotState } from "../src/hmr.ts";
import { batch, computed, createRoot, effect, signal } from "../src/reactivity.ts";

interface CompiledFixture {
  renderToString(props: Record<string, never>): string;
  hydrate(root: Element, props: Record<string, never>): () => void;
}

const fixtureDirectory = resolve("tests/fixtures/devtools");
const devtoolsInstrumentation = /trackReadSite|withReadSite|devtoolsWrite|devtoolsUpdate|registerDevtoolsInstance/;

/** Compila los fixtures DevTools contra el runtime fuente para compartir el mismo hook que la prueba. */
async function loadFixture(hot: boolean): Promise<{ component: CompiledFixture; cleanup: () => Promise<void> }> {
  const directory = await mkdtemp(join(tmpdir(), "meeko-devtools-"));
  const runtime = (path: string): string => JSON.stringify(pathToFileURL(resolve(path)).href);
  for (const name of ["Locations", "Child"]) {
    const filename = join(fixtureDirectory, `${name}.meeko`);
    const code = compile(await readFile(filename, "utf8"), filename, { hot }).code
      .replace(`from "@meekojs/meeko/internal"`, `from ${runtime("src/internal.ts")}`)
      .replace(`from "@meekojs/meeko"`, `from ${runtime("src/index.ts")}`)
      .replace(`from "./Child.meeko"`, `from "./Child.ts"`);
    await writeFile(join(directory, `${name}.ts`), code);
  }
  const component = await import(pathToFileURL(join(directory, "Locations.ts")).href) as CompiledFixture;
  return { component, cleanup: () => rm(directory, { recursive: true, force: true }) };
}

function assignment(event: DevtoolsEvent | undefined): DevtoolsAssignmentSite {
  assert.equal(event?.write?.kind, "assignment", JSON.stringify(event));
  return event!.write as DevtoolsAssignmentSite;
}

/** Sustituye temporalmente las clases DOM globales durante una prueba de navegador. */
async function withBrowser<T>(window: Window, run: () => T | Promise<T>): Promise<T> {
  const names = ["window", "Node"] as const;
  const previous = names.map((name) => ({ name, value: Reflect.get(globalThis, name), present: Reflect.has(globalThis, name) }));
  Reflect.set(globalThis, "window", window);
  Reflect.set(globalThis, "Node", window.Node);
  try {
    return await run();
  } finally {
    for (const item of previous) {
      if (item.present) Reflect.set(globalThis, item.name, item.value);
      else Reflect.deleteProperty(globalThis, item.name);
    }
  }
}

test("DevTools sólo se emite en compilación de desarrollo y no se instala durante SSR", () => {
  const source = `<script lang="ts">const count = signal(1);</script><template><p>{count.value}</p></template>`;
  assert.doesNotMatch(compile(source, "Probe.meeko").code, /registerDevtoolsInstance/);
  const hotCode = compile(source, "Probe.meeko", { hot: true }).code;
  assert.match(hotCode, /registerDevtoolsInstance/);
  assert.doesNotMatch(compile(source, "Probe.meeko").code, /expression: "count\.value"/);
  assert.ok(hotCode.includes(`file: "Probe.meeko", line: 1, column: ${source.indexOf("count.value") + 1}, expression: "count.value", kind: "text"`));
  const release = registerDevtoolsInstance({ componentId: "server", name: "Server", file: "Server.meeko", scope: { root: {} as Element }, props: {}, bindings: {} });
  release();
  assert.equal(Reflect.has(globalThis, "window"), false);
});

test("DevTools atribuye la lectura a la expresión y raíz actuales, no al lugar de escritura", async () => {
  const browser = new Window();
  try {
    await withBrowser(browser, () => {
      const shared = signal(1);
      const visible = signal(true);
      const rootA = browser.document.createElement("div");
      rootA.innerHTML = "<!--meeko:text:0-->1<!--meeko:text:1-->1<span data-meeko-a-0 title=\"1\"></span>";
      const rootB = browser.document.createElement("div");
      rootB.innerHTML = "<!--meeko:text:0-->1";
      browser.document.body.append(rootA, rootB);
      const sourceA = { file: "/src/A.meeko", line: 4, column: 8, expression: "visible.value ? shared.value : 'off'", kind: "text" as const };
      const sourceA2 = { file: "/src/A.meeko", line: 5, column: 7, expression: "shared.value", kind: "text" as const };
      const sourceA3 = { file: "/src/A.meeko", line: 6, column: 15, expression: "shared.value", kind: "attribute" as const };
      const sourceB = { file: "/src/B.meeko", line: 3, column: 9, expression: "shared.value", kind: "text" as const };
      const releaseA = createRoot((dispose) => {
        const stopA = bindText({ root: rootA as unknown as Element }, 0, () => visible.value ? shared.value : "off", "A.meeko:4:8", sourceA);
        const stopA2 = bindText({ root: rootA as unknown as Element }, 1, () => shared.value, "A.meeko:5:7", sourceA2);
        const stopA3 = bindAttribute({ root: rootA as unknown as Element }, 0, "title", () => shared.value, "A.meeko:6:15", sourceA3);
        const stopDevtools = registerDevtoolsInstance({ componentId: "a", name: "A", file: sourceA.file, scope: { root: rootA as unknown as Element }, props: {}, bindings: { shared, visible } });
        return () => { stopA(); stopA2(); stopA3(); stopDevtools(); dispose(); };
      });
      const releaseB = createRoot((dispose) => {
        const stopB = bindText({ root: rootB as unknown as Element }, 0, () => shared.value, "B.meeko:3:9", sourceB);
        const stopDevtools = registerDevtoolsInstance({ componentId: "b", name: "B", file: sourceB.file, scope: { root: rootB as unknown as Element }, props: {}, bindings: { shared } });
        return () => { stopB(); stopDevtools(); dispose(); };
      });
      const hook = Reflect.get(browser, "__MEEKO_DEVTOOLS__") as DevtoolsHook;
      const instances = hook.snapshot().instances;
      const idA = instances.find((entry) => entry.name === "A")!.id;
      const idB = instances.find((entry) => entry.name === "B")!.id;
      shared.value = 2;
      const firstEvents = hook.snapshot().events.filter((event) => event.kind === "signal" && event.detail === "shared");
      assert.deepEqual(firstEvents.find((event) => event.instanceId === idA)?.reads, [sourceA, sourceA2, sourceA3]);
      assert.deepEqual(firstEvents.find((event) => event.instanceId === idB)?.reads, [sourceB]);
      visible.value = false;
      shared.value = 3;
      const latestA = hook.snapshot().events.filter((event) => event.kind === "signal" && event.instanceId === idA && event.detail === "shared").at(-1);
      assert.deepEqual(latestA?.reads, [sourceA2, sourceA3]);
      assert.equal(latestA?.file, "/src/A.meeko");
      releaseA();
      releaseB();
    });
  } finally {
    browser.happyDOM.abort();
  }
});

test("DevTools registra árbol, valores seguros, señales y limpia instancias", async () => {
  const browser = new Window();
  try {
    await withBrowser(browser, async () => {
      const root = browser.document.createElement("main");
      root.innerHTML = `<div><!--child:start--><span>Child</span><!--child:end--></div>`;
      browser.document.body.appendChild(root);
      const start = [...root.querySelector("div")!.childNodes].find((node) => node.nodeType === 8) as unknown as Comment;
      const end = start.nextSibling!.nextSibling as Comment;
      const circular: Record<string, unknown> = { fn: () => 1, node: root };
      circular.self = circular;
      const count = signal(1);
      let ready = 0;
      browser.addEventListener("meeko:devtools-ready", () => { ready++; });
      const releaseChild = registerDevtoolsInstance({ componentId: "child", name: "Child", file: "Child.meeko", scope: { root: root as unknown as Element, start, end }, props: { label: "Child" }, bindings: { count } });
      const releaseParent = registerDevtoolsInstance({ componentId: "parent", name: "Parent", file: "Parent.meeko", scope: { root: root as unknown as Element }, props: circular, bindings: {} });
      const hook = Reflect.get(browser, "__MEEKO_DEVTOOLS__") as DevtoolsHook;
      assert.equal(ready, 1);
      const first = hook.snapshot();
      assert.equal(first.instances.length, 2);
      const parent = first.instances.find((instance) => instance.name === "Parent")!;
      const child = first.instances.find((instance) => instance.name === "Child")!;
      assert.equal(child.status, "hydrated");
      assert.equal(child.parentId, parent.id);
      assert.deepEqual(parent.childIds, [child.id]);
      assert.equal(child.signals.count, 1);
      assert.equal(JSON.stringify(first).includes("[circular]"), true);
      assert.equal(JSON.stringify(first).includes("[DOM node]"), true);
      assert.equal(JSON.stringify(first).includes("[function]"), true);
      let notices = 0;
      const unsubscribe = hook.subscribe(() => { notices++; });
      hook.setBreakpoint(child.id, true);
      hook.select(child.id);
      count.value = 2;
      assert.equal(hook.snapshot().selectedId, child.id);
      assert.equal(hook.snapshot().instances.find((instance) => instance.id === child.id)?.signals.count, 2);
      assert.ok(hook.snapshot().events.some((event) => event.kind === "signal" && event.instanceId === child.id && event.detail === "count"));
      const signalEvent = hook.snapshot().events.find((event) => event.kind === "signal" && event.instanceId === child.id);
      assert.equal(signalEvent?.componentName, "Child");
      assert.equal(signalEvent?.file, "Child.meeko");
      assert.equal(signalEvent?.value, 2);
      assert.ok(notices >= 3);
      let left = 10;
      Object.defineProperty(root, "getBoundingClientRect", {
        value: () => ({ left, top: 20, width: 80, height: 30, right: left + 80, bottom: 50 }),
      });
      hook.highlight(parent.id);
      const overlay = browser.document.querySelector("[data-meeko-devtools-highlight]") as unknown as HTMLElement;
      assert.equal(overlay.style.left, "10px");
      left = 35;
      browser.dispatchEvent(new browser.Event("resize"));
      await new Promise<void>((resolve) => browser.requestAnimationFrame(() => resolve()));
      assert.equal(overlay.style.left, "35px");
      unsubscribe();
      releaseChild();
      const unmountEvent = hook.snapshot().events.at(-1);
      assert.equal(unmountEvent?.kind, "unmount");
      assert.equal(unmountEvent?.componentName, "Child");
      assert.equal(unmountEvent?.file, "Child.meeko");
      assert.equal(hook.snapshot().selectedId, null);
      assert.equal(hook.snapshot().instances.length, 1);
      releaseParent();
      assert.deepEqual(hook.snapshot().instances, []);
      assert.equal(browser.document.querySelector("[data-meeko-devtools-highlight]"), null);
      const after = notices;
      count.value = 3;
      assert.equal(notices, after);
    });
  } finally {
    browser.happyDOM.abort();
  }
});

test("DevTools conserva ID y breakpoint al rehidratar el mismo ámbito", async () => {
  const browser = new Window();
  try {
    await withBrowser(browser, () => {
      const root = browser.document.createElement("main");
      const firstSignal = signal(1);
      const input = { componentId: "stable", name: "Stable", file: "Stable.meeko", scope: { root: root as unknown as Element }, props: {}, bindings: { firstSignal } };
      const firstRelease = registerDevtoolsInstance(input);
      const hook = Reflect.get(browser, "__MEEKO_DEVTOOLS__") as DevtoolsHook;
      const id = hook.snapshot().instances[0]!.id;
      hook.setBreakpoint(id, true);
      firstRelease();
      const secondRelease = registerDevtoolsInstance({ ...input, bindings: { secondSignal: signal(2) } });
      const snapshot = hook.snapshot();
      assert.equal(snapshot.instances[0]!.id, id);
      assert.equal(snapshot.instances[0]!.breakpoint, true);
      assert.equal(snapshot.events.at(-1)?.kind, "hmr");
      secondRelease();
    });
  } finally {
    browser.happyDOM.abort();
  }
});

test("DevTools sigue HMR sin duplicar instancias ni perder el breakpoint", async () => {
  const browser = new Window();
  try {
    await withBrowser(browser, () => {
      const element = browser.document.createElement("main");
      browser.document.body.appendChild(element);
      const root = element as unknown as Element;
      const id = "devtools-hmr-probe";
      enableHotModule(id);
      function component(version: string): HotComponent<{ label: string }> {
        const module: HotComponent<{ label: string }> = {
          renderToString(props, state) { return `<p>${version}:${props.label}:${String(state?.count ?? 1)}</p>`; },
          hydrate(target, props, state) {
            const count = signal(Number(state?.count ?? 1));
            const stopDevtools = registerDevtoolsInstance({ componentId: id, name: "Probe", file: "Probe.meeko", scope: { root: target }, props, bindings: { count } });
            return registerHotInstance(id, target, props, module, () => ({ count: count.value } satisfies HotState), stopDevtools);
          },
        };
        return module;
      }
      const first = component("first");
      root.innerHTML = first.renderToString({ label: "A" });
      const release = first.hydrate(root, { label: "A" });
      const hook = Reflect.get(browser, "__MEEKO_DEVTOOLS__") as DevtoolsHook;
      const instanceId = hook.snapshot().instances[0]!.id;
      hook.setBreakpoint(instanceId, true);
      replaceHotModule(id, component("second"));
      const snapshot = hook.snapshot();
      assert.equal(snapshot.instances.length, 1);
      assert.equal(snapshot.instances[0]!.id, instanceId);
      assert.equal(snapshot.instances[0]!.breakpoint, true);
      assert.match(root.innerHTML, /second:A:1/);
      release();
      assert.equal(hook.snapshot().instances.length, 0);
    });
  } finally {
    browser.happyDOM.abort();
  }
});

test("una captura suscrita no conecta señales de instancias distintas", async () => {
  const browser = new Window();
  try {
    await withBrowser(browser, () => {
      const rootA = browser.document.createElement("section") as unknown as Element;
      const rootB = browser.document.createElement("section") as unknown as Element;
      const signalA = signal(0);
      const signalB = signal(0);
      const stopA = registerDevtoolsInstance({ componentId: "a", name: "A", file: "A.meeko", scope: { root: rootA }, props: {}, bindings: { signalA } });
      const bindingsB: Record<string, unknown> = { signalB };
      Object.defineProperty(bindingsB, "__proto__", { value: signal("safe"), enumerable: true, configurable: true });
      const stopB = registerDevtoolsInstance({ componentId: "b", name: "B", file: "B.meeko", scope: { root: rootB }, props: {}, bindings: bindingsB });
      const hook = Reflect.get(browser, "__MEEKO_DEVTOOLS__") as DevtoolsHook;
      const unsubscribe = hook.subscribe(() => { void hook.snapshot(); });
      signalA.value = 1;
      const lastEvent = hook.snapshot().events.at(-1)!.id;
      signalB.value = 1;
      const recent = hook.snapshot().events.filter((event) => event.id > lastEvent && event.kind === "signal");
      assert.deepEqual(recent.map((event) => event.detail), ["signalB"]);
      const instanceB = hook.snapshot().instances.find((instance) => instance.name === "B")!;
      assert.equal(Object.getPrototypeOf(instanceB.signals), null);
      assert.equal(instanceB.signals.__proto__, "safe");
      assert.match(JSON.stringify(instanceB.signals), /"__proto__":"safe"/);
      unsubscribe();
      stopB();
      stopA();
    });
  } finally {
    browser.happyDOM.abort();
  }
});

test("a rejecting DevTools subscriber is reported without stopping other subscribers", async () => {
  const browser = new Window();
  try {
    await withBrowser(browser, async () => {
      const root = browser.document.createElement("div") as unknown as Element;
      const release = registerDevtoolsInstance({ componentId: "subscriber", name: "Subscriber", file: "Subscriber.meeko", scope: { root }, props: {}, bindings: {} });
      const hook = Reflect.get(browser, "__MEEKO_DEVTOOLS__") as DevtoolsHook;
      const id = hook.snapshot().instances[0]!.id;
      const logged: unknown[][] = [];
      const originalError = console.error;
      console.error = (...args: unknown[]) => { logged.push(args); };
      let notifications = 0;
      const stopFailing = hook.subscribe(async () => { throw new Error("subscriber rejected"); });
      const stopHealthy = hook.subscribe(() => { notifications++; });
      try {
        hook.select(id);
        await new Promise<void>((done) => setImmediate(done));
        assert.equal(notifications, 1);
        assert.match(String(logged[0]?.[0]), /Meeko DevTools subscriber failed/);
        assert.match(String(logged[0]?.[1]), /subscriber rejected/);
      } finally {
        stopFailing();
        stopHealthy();
        console.error = originalError;
        release();
      }
    });
  } finally {
    browser.happyDOM.abort();
  }
});

test("el hook y cada captura declaran la versión 1 del protocolo", async () => {
  const browser = new Window();
  try {
    await withBrowser(browser, () => {
      const root = browser.document.createElement("div") as unknown as Element;
      const release = registerDevtoolsInstance({ componentId: "v", name: "Versioned", file: "Versioned.meeko", scope: { root }, props: {}, bindings: {} });
      const hook = Reflect.get(browser, "__MEEKO_DEVTOOLS__") as DevtoolsHook;
      assert.equal(DEVTOOLS_PROTOCOL_VERSION, 1);
      assert.equal(hook.protocolVersion, 1);
      assert.equal(hook.snapshot().protocolVersion, 1);
      release();
    });
  } finally {
    browser.happyDOM.abort();
  }
});

test("setSignal edita señales editables, informa errores y marca la escritura como edición de DevTools", async () => {
  const browser = new Window();
  try {
    await withBrowser(browser, () => {
      const root = browser.document.createElement("div");
      root.innerHTML = "<!--meeko:text:0-->1";
      const count = signal<unknown>(1);
      const doubled = computed(() => Number(count.value) * 2);
      const release = createRoot((dispose) => {
        const stopText = bindText({ root: root as unknown as Element }, 0, () => typeof count.value === "number" ? count.value : "object", "Edit.meeko:1:1");
        const stop = registerDevtoolsInstance({ componentId: "edit", name: "Edit", file: "Edit.meeko", scope: { root: root as unknown as Element }, props: {}, bindings: { count, doubled, helper: () => 1 } });
        return () => { stopText(); stop(); dispose(); };
      });
      const hook = Reflect.get(browser, "__MEEKO_DEVTOOLS__") as DevtoolsHook;
      const id = hook.snapshot().instances[0]!.id;
      assert.deepEqual(hook.setSignal(id, "count", 5), { ok: true });
      assert.equal(count.value, 5);
      assert.equal(root.textContent, "5");
      assert.equal(doubled.value, 10);
      const edited = hook.snapshot().events.at(-1);
      assert.equal(edited?.kind, "signal");
      assert.equal(edited?.value, 5);
      assert.deepEqual(edited?.write, { kind: "devtools" });
      assert.deepEqual(hook.setSignal(id, "count", { nested: [1, "two", null, true] }), { ok: true });
      assert.deepEqual(count.value, { nested: [1, "two", null, true] });
      assert.equal(root.textContent, "object");
      const before = hook.snapshot().events.length;
      assert.deepEqual(hook.setSignal(id, "count", count.value as never), { ok: true });
      assert.equal(hook.snapshot().events.length, before);
      const failures = [
        hook.setSignal("missing", "count", 1),
        hook.setSignal(id, "doubled", 1),
        hook.setSignal(id, "helper", 1),
        hook.setSignal(id, "toString", 1),
        hook.setSignal(id, "count", Number.NaN),
        hook.setSignal(id, "count", (() => 1) as unknown as number),
        hook.setSignal(id, "count", new Date() as unknown as string),
        hook.setSignal(id, "count", [undefined] as unknown as null[]),
      ];
      const errors = failures.map((failure) => failure.ok ? "" : failure.error);
      assert.ok(errors.every((error) => error.length > 0), JSON.stringify(errors));
      assert.match(errors[0]!, /Unknown Meeko instance/);
      assert.match(errors[1]!, /no writable signal named "doubled"/);
      assert.match(errors[3]!, /no writable signal named "toString"/);
      assert.match(errors[4]!, /Invalid JSON value/);
      assert.deepEqual(count.value, { nested: [1, "two", null, true] });
      release();
      assert.equal(hook.setSignal(id, "count", 1).ok, false);
    });
  } finally {
    browser.happyDOM.abort();
  }
});

test("las escrituras instrumentadas se atribuyen sólo a la señal y al valor que escribieron", async () => {
  const browser = new Window();
  try {
    await withBrowser(browser, async () => {
      const root = browser.document.createElement("div") as unknown as Element;
      const count = signal(0);
      const other = signal(0);
      const release = registerDevtoolsInstance({ componentId: "writes", name: "Writes", file: "Writes.meeko", scope: { root }, props: {}, bindings: { count, other } });
      const hook = Reflect.get(browser, "__MEEKO_DEVTOOLS__") as DevtoolsHook;
      const site: DevtoolsAssignmentSite = { kind: "assignment", file: "Writes.meeko", line: 3, column: 5, expression: "count.value = 1" };
      const last = (name: string) => hook.snapshot().events.filter((event) => event.kind === "signal" && event.detail === name).at(-1);
      count.value = devtoolsWrite(count, site, 1);
      assert.deepEqual(last("count")?.write, site);
      // Una escritura sin cambio no deja un origen pendiente para la siguiente escritura no instrumentada.
      count.value = devtoolsWrite(count, site, 1);
      count.value = 2;
      assert.equal(last("count")?.value, 2);
      assert.equal(last("count")?.write, undefined);
      batch(() => { count.value = devtoolsWrite(count, site, 3); });
      assert.equal(last("count")?.value, 3);
      assert.deepEqual(last("count")?.write, site);
      const updateSite: DevtoolsAssignmentSite = { ...site, expression: "count.value++" };
      assert.equal(devtoolsUpdate(count, updateSite, () => count.value++), 3);
      assert.equal(count.value, 4);
      assert.deepEqual(last("count")?.write, updateSite);
      // Una cascada que escribe otra señal no hereda el origen de la primera.
      const stopCascade = effect(() => { other.value = count.value * 10; });
      count.value = devtoolsWrite(count, site, 5);
      assert.equal(last("other")?.value, 50);
      assert.equal(last("other")?.write, undefined);
      assert.deepEqual(last("count")?.write, site);
      stopCascade();
      // El origen caduca al terminar la tarea síncrona.
      count.value = devtoolsWrite(count, site, 6);
      await Promise.resolve();
      count.value = 5;
      count.value = 6;
      assert.equal(last("count")?.write, undefined);
      const plain = { value: 1 };
      assert.equal(devtoolsWrite(plain, site, 2), 2);
      assert.equal(devtoolsUpdate(plain, site, () => plain.value++), 1);
      release();
    });
  } finally {
    browser.happyDOM.abort();
  }
});

test("una compilación hot registra lecturas de computed, if, each y props y escrituras .value", async () => {
  const { component, cleanup } = await loadFixture(true);
  const browser = new Window();
  try {
    await withBrowser(browser, async () => {
      const root = browser.document.createElement("main");
      browser.document.body.appendChild(root);
      root.innerHTML = component.renderToString({});
      const release = component.hydrate(root as unknown as Element, {});
      const hook = Reflect.get(browser, "__MEEKO_DEVTOOLS__") as DevtoolsHook;
      const instance = hook.snapshot().instances.find((entry) => entry.name === "Locations");
      assert.ok(instance);
      const file = join(fixtureDirectory, "Locations.meeko");
      const button = (label: string): HTMLButtonElement => [...root.querySelectorAll("button")].find((candidate) => candidate.textContent === label) as unknown as HTMLButtonElement;
      const lastCount = () => hook.snapshot().events.filter((event) => event.kind === "signal" && event.instanceId === instance.id && event.detail === "count").at(-1);

      button("Inc").click();
      assert.equal(root.querySelector("p")?.textContent, "4");
      const increment = lastCount();
      assert.equal(increment?.value, 2);
      assert.deepEqual(assignment(increment), { kind: "assignment", file, line: 30, column: 29, expression: "count.value++" });
      const reads = (increment?.reads ?? []).filter((read) => read.kind !== "text")
        .map((read) => [read.kind, read.file === file, read.line, read.column, read.expression, read.name ?? null]);
      assert.deepEqual(reads.sort(), [
        ["computed", true, 8, 26, "() => count.value * 2", null],
        ["each", true, 27, 22, "items.value.slice(0, count.value)", null],
        ["if", true, 26, 19, "visible.value && count.value > 0", null],
        ["prop", true, 28, 39, "String(count.value)", "label"],
      ]);
      assert.equal(root.querySelectorAll("li").length, 2);
      assert.equal(root.querySelector("em")?.textContent, "2");

      button("Bump").click();
      assert.equal(lastCount()?.value, 3);
      assert.deepEqual(assignment(lastCount()), { kind: "assignment", file, line: 11, column: 3, expression: "count.value += 1" });

      button("Reset").click();
      assert.equal(lastCount()?.value, 0);
      assert.deepEqual(assignment(lastCount()), { kind: "assignment", file, line: 15, column: 3, expression: "count.value = 0" });
      assert.equal(root.querySelector("div span"), null);
      // La condición sigue leyendo `count` aunque su rama quede vacía.
      assert.ok(lastCount()?.reads?.some((read) => read.kind === "if"));

      button("Load").click();
      for (let attempt = 0; attempt < 20 && lastCount()?.value !== 5; attempt++) await new Promise<void>((done) => setImmediate(done));
      assert.equal(lastCount()?.value, 5);
      assert.deepEqual(assignment(lastCount()), { kind: "assignment", file, line: 19, column: 3, expression: "count.value = await Promise.resolve(5)" });

      assert.deepEqual(hook.setSignal(instance.id, "count", 1), { ok: true });
      assert.equal(root.querySelector("p")?.textContent, "2");
      assert.equal(root.querySelector("em")?.textContent, "1");
      assert.deepEqual(lastCount()?.write, { kind: "devtools" });
      release();
    });
  } finally {
    browser.happyDOM.abort();
    await cleanup();
  }
});

test("producción y SSR no contienen instrumentación DevTools y generan el mismo HTML", async () => {
  for (const name of ["Locations", "Child"]) {
    const filename = join(fixtureDirectory, `${name}.meeko`);
    const source = await readFile(filename, "utf8");
    const production = compile(source, filename).code;
    assert.doesNotMatch(production, devtoolsInstrumentation);
    assert.doesNotMatch(production, /kind: "(?:assignment|computed|if|each|prop)"/);
    assert.match(compile(source, filename, { hot: true }).code, devtoolsInstrumentation);
  }
  const hot = await loadFixture(true);
  const production = await loadFixture(false);
  try {
    assert.equal(hot.component.renderToString({}), production.component.renderToString({}));
    assert.equal(Reflect.has(globalThis, "window"), false);
  } finally {
    await hot.cleanup();
    await production.cleanup();
  }
});

test("la instrumentación hot conserva await, valores de expresión y destinos no estables", () => {
  const source = `<script lang="ts">
const count = signal(1);
const box = { current: signal(0) };
function make() { return box.current; }
async function load(): Promise<number> {
  count.value += await Promise.resolve(1);
  make().value = 2;
  return (count.value = 3) + box.current.value++;
}
</script><template><button on:click="() => box.current.value ??= 1">{count.value}</button></template>`;
  const code = compile(source, "Writes.meeko", { hot: true }).code;
  assert.ok(code.includes("count.value += await Promise.resolve(1)"));
  assert.doesNotMatch(code, /devtoolsUpdate\(count, [^;]*await/);
  assert.ok(code.includes("make().value = 2;"));
  assert.ok(code.includes(`(count.value = __meeko.devtoolsWrite(count, { kind: "assignment", file: "Writes.meeko", line: 8, column: 11, expression: "count.value = 3" }, 3))`));
  assert.ok(code.includes(`__meeko.devtoolsUpdate(box.current, { kind: "assignment", file: "Writes.meeko", line: 8, column: 30, expression: "box.current.value++" }, () => (box.current.value++))`));
  assert.ok(code.includes("box.current.value ??= __meeko.devtoolsWrite(box.current, "));
});
