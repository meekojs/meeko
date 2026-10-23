import assert from "node:assert/strict";
import test from "node:test";
import { Window } from "happy-dom";
import { enableHotModule, registerHotInstance, registerHotScope, replaceHotModule, restoreSignals, snapshotSignals } from "../src/hmr.ts";
import type { HotComponent } from "../src/hmr.ts";
import type { DomScope } from "../src/dom.ts";
import { computed, createRoot, signal } from "../src/reactivity.ts";

test("HMR conserva señales editables y omite valores derivados", () => {
  const release = createRoot((dispose) => {
    const count = signal(3);
    const doubled = computed(() => count.value * 2);
    assert.deepEqual(snapshotSignals({ count, doubled, plain: 4 }), { count: 3 });
    restoreSignals({ count, doubled }, { count: 5, doubled: 99 });
    assert.equal(count.value, 5);
    assert.equal(doubled.value, 10);
    return dispose;
  });
  release();
});

test("HMR reemplaza varias raíces y la limpieza original libera la versión nueva", () => {
  const window = new Window();
  const id = "test:hot-replacement";
  enableHotModule(id);
  const releases: string[] = [];
  function component(label: string): HotComponent<{ name: string }> {
    const current: HotComponent<{ name: string }> = {
      renderToString(props, state) { return `<button>${label} ${props.name} ${state?.count ?? 0}</button>`; },
      hydrate(root, props, state) {
        const count = signal(Number(state?.count ?? 0));
        return registerHotInstance(id, root, props, current, () => ({ count: count.value }), () => { releases.push(`${label}:${props.name}`); });
      },
    };
    return current;
  }
  const old = component("old");
  const next = component("new");
  const roots = [window.document.createElement("main"), window.document.createElement("main")];
  const names = ["A", "B"];
  const stops = roots.map((root, index) => {
    const props = { name: names[index]! };
    root.innerHTML = old.renderToString(props, { count: index + 2 });
    return old.hydrate(root as unknown as Element, props, { count: index + 2 });
  });
  replaceHotModule(id, next);
  assert.deepEqual(roots.map((root) => root.textContent), ["new A 2", "new B 3"]);
  assert.deepEqual(releases, ["old:A", "old:B"]);
  stops[0]!();
  stops[1]!();
  assert.deepEqual(releases, ["old:A", "old:B", "new:A", "new:B"]);
  replaceHotModule(id, component("later"));
  assert.deepEqual(roots.map((root) => root.textContent), ["new A 2", "new B 3"]);
  window.happyDOM.abort();
});

test("HMR restaura la versión anterior si falla la nueva hidratación", () => {
  const window = new Window();
  const id = "test:hot-rollback";
  enableHotModule(id);
  const root = window.document.createElement("main") as unknown as Element;
  const previous: HotComponent<{ initial: number }> = {
    renderToString(props, state) { return `<button>previous ${state?.count ?? props.initial}</button>`; },
    hydrate(element, props, state) {
      const count = signal(Number(state?.count ?? props.initial));
      return registerHotInstance(id, element, props, previous, () => ({ count: count.value }), () => {});
    },
  };
  root.innerHTML = previous.renderToString({ initial: 4 });
  const stop = previous.hydrate(root, { initial: 4 });
  const broken: HotComponent<{ initial: number }> = {
    renderToString() { return "<button>broken</button>"; },
    hydrate() { throw new Error("Hydration failed"); },
  };
  assert.throws(() => replaceHotModule(id, broken), /Hydration failed/);
  assert.equal(root.textContent, "previous 4");
  const recovered: HotComponent<{ initial: number }> = {
    renderToString(_props, state) { return `<button>recovered ${state?.count}</button>`; },
    hydrate(element, props, state) { return registerHotInstance(id, element, props, previous, () => state ?? {}, () => {}); },
  };
  replaceHotModule(id, recovered);
  assert.equal(root.textContent, "recovered 4");
  stop();
  window.happyDOM.abort();
});

test("HMR de un hijo actualiza solo su rango y conserva su señal", () => {
  const window = new Window();
  const id = "test:hot-child";
  enableHotModule(id);
  const root = window.document.createElement("main");
  root.innerHTML = '<p>parent</p><!--child:start--><button>old 2</button><!--child:end--><p>after</p>';
  const scope: DomScope = {
    root: root as unknown as Element,
    start: root.childNodes[1] as unknown as Comment,
    end: root.childNodes[3] as unknown as Comment,
  };
  function component(label: string): HotComponent<{ initial: number }> {
    const current: HotComponent<{ initial: number }> = {
      renderToString(props, state) { return `<button>${label} ${state?.count ?? props.initial}</button>`; },
      hydrate() { throw new Error("Child must hydrate through its scope"); },
      hydrateScope(inner, props, state) {
        const count = signal(Number(state?.count ?? props.initial));
        return registerHotScope(id, inner, props, current, () => ({ count: count.value }), () => {});
      },
    };
    return current;
  }
  const stop = component("old").hydrateScope!(scope, { initial: 2 });
  const before = root.firstChild;
  const after = root.lastChild;
  replaceHotModule(id, component("new"));
  assert.equal(root.textContent, "parentnew 2after");
  assert.equal(root.firstChild, before);
  assert.equal(root.lastChild, after);
  stop();
  window.happyDOM.abort();
});
