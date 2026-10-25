import assert from "node:assert/strict";
import test from "node:test";
import { Window } from "happy-dom";
import { compile } from "../src/compiler.ts";
import { registerDevtoolsInstance } from "../src/devtools.ts";
import type { DevtoolsHook } from "../src/devtools.ts";
import { bindAttribute, bindText } from "../src/dom.ts";
import { enableHotModule, registerHotInstance, replaceHotModule } from "../src/hmr.ts";
import type { HotComponent, HotState } from "../src/hmr.ts";
import { createRoot, signal } from "../src/reactivity.ts";

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
