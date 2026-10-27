import assert from "node:assert/strict";
import test from "node:test";
import { resolve } from "node:path";
import { Window as HappyWindow } from "happy-dom";
import { createServer } from "vite";
import { bindEvent } from "../src/dom.ts";
import { provideErrorHandler } from "../src/component-errors.ts";
import { createRoot } from "../src/reactivity.ts";
import { meeko } from "../src/vite.ts";

test("component event failures are reported and listeners still release", async () => {
  const browser = new HappyWindow({ url: "https://example.test/" });
  const root = browser.document.createElement("div");
  root.innerHTML = '<button data-meeko-e-1>Run</button>';
  browser.document.body.append(root);
  const button = root.querySelector("button")!;
  const logged: unknown[][] = [];
  const originalError = console.error;
  console.error = (...args: unknown[]) => { logged.push(args); };
  let calls = 0;
  try {
    const release = bindEvent({ root: root as unknown as Element }, 1, "click", async () => {
      calls++;
      throw new Error("event failed");
    });
    assert.doesNotThrow(() => button.click());
    await new Promise<void>((resolve) => setImmediate(resolve));
    assert.equal(calls, 1);
    assert.match(String(logged[0]?.[0]), /Meeko component event failed/);
    assert.match(String(logged[0]?.[1]), /event failed/);
    release();
    button.click();
    assert.equal(calls, 1);
  } finally {
    console.error = originalError;
    browser.happyDOM.abort();
  }
});

test("component error observers inherit, override, and stay isolated by root", async () => {
  const browser = new HappyWindow({ url: "https://example.test/" });
  const seen: string[] = [];
  const roots = ["first", "nested", "second"].map((name) => {
    const root = browser.document.createElement("div");
    root.innerHTML = `<button data-meeko-e-1>${name}</button>`;
    browser.document.body.append(root);
    return root;
  });
  const first = roots[0]!;
  const nested = roots[1]!;
  const second = roots[2]!;
  const releaseFirst = createRoot((dispose) => {
    provideErrorHandler((error) => { seen.push(`first:${String(error)}`); });
    const releaseFirstEvent = bindEvent({ root: first as unknown as Element }, 1, "click", () => { throw new Error("one"); });
    const releaseNested = createRoot((disposeNested) => {
      const releaseInherited = bindEvent({ root: nested as unknown as Element }, 1, "click", async () => { throw new Error("two"); });
      return () => { releaseInherited(); disposeNested(); };
    });
    return () => { releaseNested(); releaseFirstEvent(); dispose(); };
  });
  const releaseSecond = createRoot((dispose) => {
    provideErrorHandler((error) => { seen.push(`second:${String(error)}`); });
    const release = bindEvent({ root: second as unknown as Element }, 1, "click", () => { throw new Error("three"); });
    return () => { release(); dispose(); };
  });
  try {
    first.querySelector("button")!.click();
    nested.querySelector("button")!.click();
    second.querySelector("button")!.click();
    await new Promise<void>((done) => setImmediate(done));
    assert.deepEqual(seen, ["first:Error: one", "second:Error: three", "first:Error: two"]);
  } finally {
    releaseFirst();
    releaseSecond();
    browser.happyDOM.abort();
  }
});

test("a rejected component error observer reports both failures", async () => {
  const browser = new HappyWindow({ url: "https://example.test/" });
  const root = browser.document.createElement("div");
  root.innerHTML = '<button data-meeko-e-1>Run</button>';
  const logged: unknown[][] = [];
  const originalError = console.error;
  console.error = (...args: unknown[]) => { logged.push(args); };
  const original = new Error("event failure");
  const observer = new Error("observer failure");
  const release = createRoot((dispose) => {
    provideErrorHandler(async () => { throw observer; });
    const releaseEvent = bindEvent({ root: root as unknown as Element }, 1, "click", () => { throw original; });
    return () => { releaseEvent(); dispose(); };
  });
  try {
    assert.doesNotThrow(() => root.querySelector("button")!.click());
    await new Promise<void>((done) => setImmediate(done));
    assert.equal(logged.length, 1);
    assert.equal(logged[0]?.[1], observer);
    assert.equal(logged[0]?.[2], original);
  } finally {
    release();
    console.error = originalError;
    browser.happyDOM.abort();
  }
});

test("compiled component forwards an async event rejection to the event boundary", { timeout: 35_000 }, async () => {
  const fixture = resolve("tests/fixtures/AsyncEvent.meeko");
  const server = await createServer({ configFile: false, plugins: [meeko()], server: { middlewareMode: true, hmr: false } });
  const browser = new HappyWindow({ url: "https://example.test/" });
  const logged: unknown[][] = [];
  const originalError = console.error;
  console.error = (...args: unknown[]) => { logged.push(args); };
  try {
    const component = await server.ssrLoadModule(fixture) as {
      renderToString(props: Record<string, never>): string;
      hydrate(root: Element, props: Record<string, never>): () => void;
    };
    const root = browser.document.createElement("div");
    root.innerHTML = component.renderToString({});
    browser.document.body.append(root);
    const release = component.hydrate(root as unknown as Element, {});
    root.querySelector("button")!.click();
    await new Promise<void>((done) => setImmediate(done));
    assert.match(String(logged[0]?.[0]), /Meeko component event failed/);
    assert.match(String(logged[0]?.[1]), /compiled event rejected/);
    release();
  } finally {
    console.error = originalError;
    browser.happyDOM.abort();
    await server.close();
  }
});

test("compiled parent autoimports a typed error observer for child events", { timeout: 35_000 }, async () => {
  const fixture = resolve("tests/fixtures/ErrorProvider.meeko");
  const server = await createServer({ configFile: false, plugins: [meeko()], server: { middlewareMode: true, hmr: false } });
  const browser = new HappyWindow({ url: "https://example.test/" });
  try {
    const component = await server.ssrLoadModule(fixture) as {
      renderToString(props: { onError: (error: unknown) => void }): string;
      hydrate(root: Element, props: { onError: (error: unknown) => void }): () => void;
    };
    const observed: unknown[] = [];
    const props = { onError: (error: unknown) => { observed.push(error); } };
    const root = browser.document.createElement("div");
    root.innerHTML = component.renderToString(props);
    browser.document.body.append(root);
    const release = component.hydrate(root as unknown as Element, props);
    root.querySelector("button")!.click();
    await new Promise<void>((done) => setImmediate(done));
    assert.equal(observed.length, 1);
    assert.match(String(observed[0]), /compiled event rejected/);
    release();
  } finally {
    browser.happyDOM.abort();
    await server.close();
  }
});
