import assert from "node:assert/strict";
import test from "node:test";
import { batch, createRoot, effect, onCleanup, signal } from "../src/reactivity.ts";
import { Window as HappyWindow } from "happy-dom";
import { checkSource } from "../src/check.ts";
import { bindFor, releaseAll, renderFor } from "../src/dom.ts";

if (false) {
  // @ts-expect-error reactive effects cannot track work after an await
  effect(async () => undefined);
  // @ts-expect-error a conditional promise is still an asynchronous effect
  effect(() => Math.random() > 0.5 ? Promise.resolve() : undefined);
  // @ts-expect-error cleanup cannot continue after the owning root has been released
  onCleanup(async () => undefined);
  // @ts-expect-error a conditional Promise still makes the cleanup asynchronous
  onCleanup(() => Math.random() > 0.5 ? Promise.resolve() : undefined);
}

test("an async reactive effect is rejected without an unhandled rejection", async () => {
  const logged: unknown[][] = [];
  const originalError = console.error;
  console.error = (...args: unknown[]) => { logged.push(args); };
  try {
    assert.throws(() => effect((async () => { throw new Error("effect rejected"); }) as () => void), /must be synchronous/);
    await new Promise<void>((done) => setImmediate(done));
    assert.match(String(logged[0]?.[0]), /Meeko asynchronous effect rejected/);
    assert.match(String(logged[0]?.[1]), /effect rejected/);
  } finally {
    console.error = originalError;
  }
});

test("an effect that becomes asynchronous detaches after its first failure", () => {
  const source = signal(false);
  let runs = 0;
  effect((() => {
    runs++;
    if (source.value) return Promise.resolve();
    return undefined;
  }) as () => void);
  assert.throws(() => { source.value = true; }, /must be synchronous/);
  assert.doesNotThrow(() => { source.value = false; });
  assert.equal(runs, 2);
});

test("a .meeko component cannot register an asynchronous cleanup", async () => {
  const source = `<script lang="ts">onCleanup(async () => undefined);</script><template><div>cleanup</div></template>`;
  const diagnostics = await checkSource(source, "AsyncCleanup.meeko");
  assert.ok(diagnostics.some((entry) =>
    entry.code === "TS2345"
    && /Promise<undefined>/.test(entry.message)
    && /never/.test(entry.message)), JSON.stringify(diagnostics));
});

test("external resource cleanup follows the component root", () => {
  const released: string[] = [];
  const dispose = createRoot((stop) => {
    onCleanup(() => released.push("socket"));
    return stop;
  });
  assert.deepEqual(released, []);
  dispose();
  assert.deepEqual(released, ["socket"]);
  assert.throws(() => onCleanup(() => undefined), /active component root/);
});

test("an asynchronous cleanup is observed and combined with other cleanup failures", async () => {
  const logged: unknown[][] = [];
  const unhandled: unknown[] = [];
  const originalError = console.error;
  const onUnhandled = (error: unknown) => { unhandled.push(error); };
  console.error = (...args: unknown[]) => { logged.push(args); };
  process.on("unhandledRejection", onUnhandled);
  const synchronous = new Error("synchronous cleanup failed");
  const released: string[] = [];
  try {
    const dispose = createRoot((stop) => {
      onCleanup((async () => { throw new Error("asynchronous cleanup failed"); }) as () => void);
      onCleanup(() => { throw synchronous; });
      onCleanup(() => { released.push("last cleanup"); });
      return stop;
    });
    assert.throws(dispose, (error: unknown) => {
      assert.ok(error instanceof AggregateError);
      assert.equal(error.errors.length, 2);
      assert.match(String(error.errors[0]), /cleanup callbacks must be synchronous/);
      assert.equal(error.errors[1], synchronous);
      return true;
    });
    await new Promise<void>((done) => setImmediate(done));
    assert.deepEqual(released, ["last cleanup"]);
    assert.deepEqual(unhandled, []);
    assert.match(String(logged[0]?.[0]), /Meeko asynchronous cleanup rejected/);
    assert.match(String(logged[0]?.[1]), /asynchronous cleanup failed/);
  } finally {
    process.off("unhandledRejection", onUnhandled);
    console.error = originalError;
  }
});

test("a cleanup that becomes asynchronous is rejected when the root releases", () => {
  let asynchronous = false;
  const dispose = createRoot((stop) => {
    onCleanup((() => asynchronous ? Promise.resolve() : undefined) as () => void);
    return stop;
  });
  asynchronous = true;
  assert.throws(dispose, /cleanup callbacks must be synchronous/);
});

test("one failing resource does not prevent the rest of a root from releasing", () => {
  const released: string[] = [];
  const dispose = createRoot((stop) => {
    onCleanup(() => { throw new Error("release failed"); });
    onCleanup(() => { released.push("other"); });
    return stop;
  });
  assert.throws(dispose, /release failed/);
  assert.deepEqual(released, ["other"]);
});

test("a cleanup failure does not hide the original root failure", () => {
  const original = new Error("setup failed");
  const cleanup = new Error("cleanup failed");
  assert.throws(() => createRoot(() => {
    onCleanup(() => { throw cleanup; });
    throw original;
  }), (error: unknown) => {
    assert.ok(error instanceof AggregateError);
    assert.deepEqual(error.errors, [original, cleanup]);
    return true;
  });
});

test("compiled binding cleanup releases every binding and keeps the triggering error", () => {
  const released: string[] = [];
  const original = new Error("hydrate failed");
  const cleanup = new Error("listener release failed");
  const bindings = [
    () => released.push("first"),
    () => { throw cleanup; },
    () => released.push("last"),
  ];
  assert.throws(() => releaseAll(bindings, { error: original }), (error: unknown) => {
    assert.ok(error instanceof AggregateError);
    assert.deepEqual(error.errors, [original, cleanup]);
    return true;
  });
  assert.deepEqual(released, ["last", "first"]);
  assert.equal(bindings.length, 0);
});

test("a failing reactive observer does not skip other pending observers", () => {
  const value = signal(0);
  const first = new Error("first observer failed");
  const second = new Error("second observer failed");
  const seen: string[] = [];
  const stopFirst = effect(() => { if (value.value === 1) throw first; });
  const stopSecond = effect(() => { if (value.value === 1) throw second; });
  const stopLast = effect(() => { seen.push(`value:${value.value}`); });
  assert.throws(() => { value.value = 1; }, (error: unknown) => {
    assert.ok(error instanceof AggregateError);
    assert.deepEqual(error.errors, [first, second]);
    return true;
  });
  assert.deepEqual(seen, ["value:0", "value:1"]);
  stopFirst();
  stopSecond();
  stopLast();
});

test("batch retains both its callback error and a reactive flush error", () => {
  const value = signal(0);
  const workError = new Error("batch work failed");
  const observerError = new Error("observer failed");
  const stop = effect(() => { if (value.value === 1) throw observerError; });
  assert.throws(() => batch(() => {
    value.value = 1;
    throw workError;
  }), (error: unknown) => {
    assert.ok(error instanceof AggregateError);
    assert.deepEqual(error.errors, [workError, observerError]);
    return true;
  });
  stop();
});

test("a failed initial effect does not remain subscribed", () => {
  const value = signal(0);
  const original = new Error("initial effect failed");
  let runs = 0;
  assert.throws(() => effect(() => {
    runs++;
    void value.value;
    throw original;
  }), (error: unknown) => error === original);
  assert.doesNotThrow(() => { value.value = 1; });
  assert.equal(runs, 1);
});

test("a failing list item cleanup still releases every item and its root", () => {
  const browser = new HappyWindow({ url: "https://example.test/" });
  const root = browser.document.createElement("div");
  browser.document.body.append(root);
  const values = signal(["a", "b"]);
  root.innerHTML = renderFor(0, values.value, (item) => item, (item) => `<span>${item}</span>`);
  const released: string[] = [];
  const failure = new Error("a cleanup failed");
  try {
    const stop = bindFor({ root: root as unknown as Element }, 0, () => values.value,
      (item) => item, (item) => `<span>${item}</span>`, (item) => {
        const key = item.value;
        onCleanup(() => { released.push(`root:${key}`); });
        return () => {
          released.push(`item:${key}`);
          if (key === "a") throw failure;
        };
      });
    assert.throws(stop, (error: unknown) => error === failure);
    assert.deepEqual(new Set(released), new Set(["item:a", "root:a", "item:b", "root:b"]));
  } finally {
    browser.happyDOM.abort();
  }
});

test("a later list hydration failure releases items hydrated earlier", () => {
  const browser = new HappyWindow({ url: "https://example.test/" });
  const root = browser.document.createElement("div");
  browser.document.body.append(root);
  const items = ["a", "b"];
  root.innerHTML = renderFor(0, items, (item) => item, (item) => `<span>${item}</span>`);
  const released: string[] = [];
  const failure = new Error("b hydration failed");
  try {
    assert.throws(() => bindFor({ root: root as unknown as Element }, 0, () => items,
      (item) => item, (item) => `<span>${item}</span>`, (item) => {
        const key = item.value;
        if (key === "b") throw failure;
        onCleanup(() => { released.push("root:a"); });
        return () => { released.push("item:a"); };
      }), (error: unknown) => error === failure);
    assert.deepEqual(new Set(released), new Set(["item:a", "root:a"]));
  } finally {
    browser.happyDOM.abort();
  }
});
