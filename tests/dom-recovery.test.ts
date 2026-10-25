import assert from "node:assert/strict";
import test from "node:test";
import { Window } from "happy-dom";
import { bindComponent, bindIf, renderComponent, renderIf } from "../src/dom.ts";
import type { ComponentModule, DomScope } from "../src/dom.ts";
import { signal } from "../src/reactivity.ts";

test("a failed reactive child hydration restores its previous DOM and listener", () => {
  const browser = new Window();
  const root = browser.document.createElement("main");
  const failure = new Error("new child failed");
  let clicks = 0;
  let releases = 0;
  const old: ComponentModule<{ label: string }> = {
    renderToString: ({ label }) => `<button>${label}</button>`,
    hydrateScope(inner) {
      const button = inner.start!.nextSibling as HTMLButtonElement;
      const onClick = () => { clicks++; };
      button.addEventListener("click", onClick);
      return () => { releases++; button.removeEventListener("click", onClick); };
    },
  };
  const broken: ComponentModule<{ label: string }> = {
    renderToString: () => "<button>broken</button>",
    hydrateScope() { throw failure; },
  };
  const good: ComponentModule<{ label: string }> = {
    renderToString: () => "<button>good</button>",
    hydrateScope: () => () => {},
  };
  root.innerHTML = renderComponent(0, old, { label: "old" });
  const selected = signal(old);
  const stop = bindComponent({ root: root as unknown as Element }, 0, () => selected.value, () => ({ label: "old" }), "test child");
  try {
    assert.throws(() => { selected.value = broken; }, (error: unknown) => error === failure);
    assert.equal(root.textContent, "old");
    root.querySelector("button")!.click();
    assert.equal(clicks, 1);
    selected.value = good;
    assert.equal(root.textContent, "good");
    assert.equal(releases, 2);
  } finally {
    stop();
    browser.happyDOM.abort();
  }
});

test("a failed child rollback keeps both errors and stops its reactive binding", () => {
  const browser = new Window();
  const root = browser.document.createElement("main");
  const failure = new Error("new child failed");
  const rollbackFailure = new Error("old child could not hydrate");
  let hydrations = 0;
  const old: ComponentModule<Record<string, never>> = {
    renderToString: () => "<p>old</p>",
    hydrateScope() {
      if (++hydrations > 1) throw rollbackFailure;
      return () => {};
    },
  };
  const broken: ComponentModule<Record<string, never>> = {
    renderToString: () => "<p>broken</p>",
    hydrateScope() { throw failure; },
  };
  root.innerHTML = renderComponent(0, old, {});
  const selected = signal<ComponentModule<Record<string, never>>>(old);
  const stop = bindComponent({ root: root as unknown as Element }, 0, () => selected.value, () => ({}), "rollback case");
  try {
    assert.throws(() => { selected.value = broken; }, (error: unknown) => {
      assert.ok(error instanceof AggregateError);
      assert.deepEqual(error.errors, [failure, rollbackFailure]);
      return true;
    });
    assert.equal(root.textContent, "old");
    selected.value = old;
    assert.equal(hydrations, 2);
  } finally {
    stop();
    browser.happyDOM.abort();
  }
});

test("a failed condition hydration leaves an empty region and can retry", () => {
  const browser = new Window();
  const root = browser.document.createElement("main");
  const visible = signal(false);
  const failure = new Error("conditional hydration failed");
  let fail = true;
  root.innerHTML = renderIf(0, false, () => "<button>ready</button>");
  const stop = bindIf({ root: root as unknown as Element }, 0, () => visible.value,
    () => "<button>ready</button>", (_inner: DomScope) => {
      if (fail) throw failure;
      return () => {};
    });
  try {
    assert.throws(() => { visible.value = true; }, (error: unknown) => error === failure);
    assert.equal(root.querySelector("button") === null, true);
    fail = false;
    visible.value = false;
    visible.value = true;
    assert.equal(root.querySelector("button")?.textContent, "ready");
  } finally {
    stop();
    browser.happyDOM.abort();
  }
});

test("a failing condition release still removes its region", () => {
  const browser = new Window();
  const root = browser.document.createElement("main");
  const visible = signal(true);
  const failure = new Error("condition release failed");
  root.innerHTML = renderIf(0, true, () => "<button>ready</button>");
  const stop = bindIf({ root: root as unknown as Element }, 0, () => visible.value,
    () => "<button>ready</button>", () => () => { throw failure; });
  try {
    assert.throws(() => { visible.value = false; }, (error: unknown) => error === failure);
    assert.equal(root.querySelector("button") === null, true);
  } finally {
    stop();
    browser.happyDOM.abort();
  }
});
