import assert from "node:assert/strict";
import test from "node:test";
import { Window } from "happy-dom";
import { enableHotModule, registerHotInstance, registerHotScope, replaceHotModule, replaceHotStyle, restoreSignals, snapshotSignals } from "../src/hmr.ts";
import type { HotComponent } from "../src/hmr.ts";
import type { DomScope } from "../src/dom.ts";
import { computed, createContext, createRoot, inject, provide, signal } from "../src/reactivity.ts";

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

test("HMR updates styles for module IDs containing CSS selector syntax", () => {
  const browser = new Window();
  const priorDocument = Object.getOwnPropertyDescriptor(globalThis, "document");
  Object.defineProperty(globalThis, "document", { configurable: true, value: browser.document });
  const id = 'src/components/has"quote.meeko';
  try {
    replaceHotStyle(id, "first");
    replaceHotStyle(id, "second");
    const styles = [...browser.document.querySelectorAll("style[data-meeko-hot]")];
    assert.equal(styles.length, 1);
    assert.equal(styles[0]?.getAttribute("data-meeko-hot"), id);
    assert.equal(styles[0]?.textContent, "second");
  } finally {
    if (priorDocument) Object.defineProperty(globalThis, "document", priorDocument);
    else Reflect.deleteProperty(globalThis, "document");
    browser.happyDOM.abort();
  }
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

test("HMR retains replacement and rollback errors and releases a partial instance", () => {
  const window = new Window();
  const id = "test:hot-double-failure";
  enableHotModule(id);
  const root = window.document.createElement("main") as unknown as Element;
  const replacementError = new Error("replacement failed");
  const rollbackError = new Error("rollback failed");
  let failRollback = false;
  let partialReleased = 0;
  const old: HotComponent<Record<string, never>> = {
    renderToString() { return "<button>old</button>"; },
    hydrate(element, props) {
      if (failRollback) throw rollbackError;
      return registerHotInstance(id, element, props, old, () => ({}), () => {});
    },
  };
  const broken: HotComponent<Record<string, never>> = {
    renderToString() { return "<button>broken</button>"; },
    hydrate(element, props) {
      registerHotInstance(id, element, props, broken, () => ({}), () => { partialReleased++; });
      throw replacementError;
    },
  };
  root.innerHTML = old.renderToString({});
  old.hydrate(root, {});
  failRollback = true;
  try {
    assert.throws(() => replaceHotModule(id, broken), (error: unknown) => {
      assert.ok(error instanceof AggregateError);
      assert.deepEqual(error.errors, [replacementError, rollbackError]);
      return true;
    });
    assert.equal(partialReleased, 1);
    assert.equal(root.textContent, "old");
    replaceHotModule(id, old);
    assert.equal(root.textContent, "old");
  } finally {
    window.happyDOM.abort();
  }
});

test("HMR restores live listeners when previous cleanup fails", () => {
  const window = new Window();
  const id = "test:hot-cleanup-recovery";
  enableHotModule(id);
  const root = window.document.createElement("main") as unknown as Element;
  const cleanupError = new Error("cleanup failed");
  let releases = 0;
  let clicks = 0;
  const old: HotComponent<Record<string, never>> = {
    renderToString() { return "<button>old</button>"; },
    hydrate(element, props) {
      const button = element.querySelector("button")!;
      const onClick = () => { clicks++; };
      button.addEventListener("click", onClick);
      return registerHotInstance(id, element, props, old, () => ({}), () => {
        button.removeEventListener("click", onClick);
        if (++releases === 1) throw cleanupError;
      });
    },
  };
  const next: HotComponent<Record<string, never>> = {
    renderToString() { return "<button>new</button>"; },
    hydrate(element, props) { return registerHotInstance(id, element, props, next, () => ({}), () => {}); },
  };
  root.innerHTML = old.renderToString({});
  const stop = old.hydrate(root, {});
  try {
    assert.throws(() => replaceHotModule(id, next), (error: unknown) => error === cleanupError);
    assert.equal(root.textContent, "old");
    (root.querySelector("button") as HTMLButtonElement).click();
    assert.equal(clicks, 1);
    replaceHotModule(id, next);
    assert.equal(root.textContent, "new");
  } finally {
    stop();
    window.happyDOM.abort();
  }
});

test("HMR retains cleanup and rollback failures and forgets an unusable slot", () => {
  const window = new Window();
  const id = "test:hot-cleanup-double-failure";
  enableHotModule(id);
  const root = window.document.createElement("main") as unknown as Element;
  const cleanupError = new Error("cleanup failed");
  const rollbackError = new Error("rollback failed");
  let hydrations = 0;
  const old: HotComponent<Record<string, never>> = {
    renderToString() { return "<button>old</button>"; },
    hydrate(element, props) {
      if (++hydrations > 1) throw rollbackError;
      return registerHotInstance(id, element, props, old, () => ({}), () => { throw cleanupError; });
    },
  };
  const next: HotComponent<Record<string, never>> = {
    renderToString() { return "<button>new</button>"; },
    hydrate() { throw new Error("new should not hydrate"); },
  };
  root.innerHTML = old.renderToString({});
  old.hydrate(root, {});
  try {
    assert.throws(() => replaceHotModule(id, next), (error: unknown) => {
      assert.ok(error instanceof AggregateError);
      assert.deepEqual(error.errors, [cleanupError, rollbackError]);
      return true;
    });
    assert.equal(root.textContent, "old");
    replaceHotModule(id, next);
    assert.equal(hydrations, 2);
    assert.equal(root.textContent, "old");
  } finally {
    window.happyDOM.abort();
  }
});

test("HMR restores every root and keeps the old style when a later root fails", () => {
  const browser = new Window();
  const priorDocument = Object.getOwnPropertyDescriptor(globalThis, "document");
  Object.defineProperty(globalThis, "document", { configurable: true, value: browser.document });
  const id = "test:hot-multi-root-rollback";
  enableHotModule(id);
  const roots = ["A", "B"].map(() => browser.document.createElement("main") as unknown as Element);
  let oldClicks = 0;
  let newReleases = 0;
  function component(label: string, failOnB = false): HotComponent<{ name: string }> {
    const current: HotComponent<{ name: string }> = {
      css: `${label} style`,
      renderToString(props) { return `<button>${label}:${props.name}</button>`; },
      hydrate(root, props) {
        if (failOnB && props.name === "B") throw new Error("second root failed");
        const button = root.querySelector("button")!;
        const onClick = () => { if (label === "old") oldClicks++; };
        button.addEventListener("click", onClick);
        return registerHotInstance(id, root, props, current, () => ({}), () => {
          button.removeEventListener("click", onClick);
          if (label === "new") newReleases++;
        });
      },
    };
    return current;
  }
  const old = component("old");
  const stops = roots.map((root, index) => {
    const props = { name: index === 0 ? "A" : "B" };
    root.innerHTML = old.renderToString(props);
    return old.hydrate(root, props);
  });
  try {
    replaceHotStyle(id, "old style");
    assert.throws(() => replaceHotModule(id, component("new", true)), /second root failed/);
    assert.deepEqual(roots.map((root) => root.textContent), ["old:A", "old:B"]);
    for (const root of roots) (root.querySelector("button") as HTMLButtonElement).click();
    assert.equal(oldClicks, 2);
    assert.equal(newReleases, 1);
    assert.equal(browser.document.querySelector(`style[data-meeko-hot="${id}"]`)?.textContent, "old style");
    replaceHotModule(id, component("ready"));
    assert.deepEqual(roots.map((root) => root.textContent), ["ready:A", "ready:B"]);
  } finally {
    for (const stop of stops) stop();
    if (priorDocument) Object.defineProperty(globalThis, "document", priorDocument);
    else Reflect.deleteProperty(globalThis, "document");
    browser.happyDOM.abort();
  }
});

test("HMR retains later-root failure and earlier-root rollback failure", () => {
  const browser = new Window();
  const id = "test:hot-multi-root-double-failure";
  enableHotModule(id);
  const roots = ["A", "B"].map(() => browser.document.createElement("main") as unknown as Element);
  const replacementError = new Error("second root failed");
  const rollbackError = new Error("first root rollback failed");
  let firstHydrations = 0;
  const old: HotComponent<{ name: string }> = {
    renderToString(props) { return `<button>old:${props.name}</button>`; },
    hydrate(root, props) {
      if (props.name === "A" && ++firstHydrations > 1) throw rollbackError;
      return registerHotInstance(id, root, props, old, () => ({}), () => {});
    },
  };
  const broken: HotComponent<{ name: string }> = {
    renderToString(props) { return `<button>new:${props.name}</button>`; },
    hydrate(root, props) {
      if (props.name === "B") throw replacementError;
      return registerHotInstance(id, root, props, broken, () => ({}), () => {});
    },
  };
  const stops = roots.map((root, index) => {
    const props = { name: index === 0 ? "A" : "B" };
    root.innerHTML = old.renderToString(props);
    return old.hydrate(root, props);
  });
  try {
    assert.throws(() => replaceHotModule(id, broken), (error: unknown) => {
      assert.ok(error instanceof AggregateError);
      assert.deepEqual(error.errors, [replacementError, rollbackError]);
      return true;
    });
    assert.deepEqual(roots.map((root) => root.textContent), ["old:A", "old:B"]);
    const working: HotComponent<{ name: string }> = {
      renderToString(props) { return `<button>ready:${props.name}</button>`; },
      hydrate(root, props) { return registerHotInstance(id, root, props, working, () => ({}), () => {}); },
    };
    replaceHotModule(id, working);
    assert.deepEqual(roots.map((root) => root.textContent), ["old:A", "ready:B"]);
  } finally {
    for (const stop of stops) stop();
    browser.happyDOM.abort();
  }
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

test("HMR preserves each component's parent context during replacement and rollback", () => {
  const window = new Window();
  const id = "test:hot-context";
  const key = createContext<string>("hot-context");
  enableHotModule(id);
  function component(label: string): HotComponent<Record<string, never>> {
    const current: HotComponent<Record<string, never>> = {
      renderToString() { return `<span>${label}:${inject(key)}</span>`; },
      hydrate(root, props) {
        return createRoot((dispose) => {
          const value = inject(key);
          assert.equal(root.textContent, `${label}:${value}`);
          return registerHotInstance(id, root, props, current, () => ({}), dispose);
        });
      },
    };
    return current;
  }
  const original = component("old");
  const roots = [window.document.createElement("main"), window.document.createElement("main")];
  const stops = roots.map((root, index) => createRoot((dispose) => {
    provide(key, `app-${index}`);
    root.innerHTML = original.renderToString({});
    original.hydrate(root as unknown as Element, {});
    return dispose;
  }));
  try {
    replaceHotModule(id, component("new"));
    assert.deepEqual(roots.map((root) => root.textContent), ["new:app-0", "new:app-1"]);
    const broken: HotComponent<Record<string, never>> = {
      renderToString() { return `<span>broken:${inject(key)}</span>`; },
      hydrate() { throw new Error("replacement failed"); },
    };
    assert.throws(() => replaceHotModule(id, broken), /replacement failed/);
    assert.deepEqual(roots.map((root) => root.textContent), ["new:app-0", "new:app-1"]);
    replaceHotModule(id, component("last"));
    assert.deepEqual(roots.map((root) => root.textContent), ["last:app-0", "last:app-1"]);
  } finally {
    for (const stop of stops) stop();
    window.happyDOM.abort();
  }
});
