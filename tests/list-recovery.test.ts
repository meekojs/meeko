import assert from "node:assert/strict";
import test from "node:test";
import { Window } from "happy-dom";
import { bindFor, renderFor } from "../src/dom.ts";
import { signal } from "../src/reactivity.ts";

interface Row { id: string; label: string }

function listText(root: Element): string[] {
  return [...root.querySelectorAll("button")].map((button) => button.textContent ?? "");
}

test("failed list hydration preserves previous rows and listeners, then retries", () => {
  const browser = new Window();
  const root = browser.document.createElement("main");
  const rows = signal<Row[]>([{ id: "a", label: "A" }, { id: "b", label: "B" }]);
  const failure = new Error("row C failed");
  let fail = true;
  let clicks = 0;
  let releases = 0;
  root.innerHTML = renderFor(0, rows.value, (row) => row.id, (row) => `<button>${row.label}</button>`);
  const stop = bindFor({ root: root as unknown as Element }, 0, () => rows.value, (row) => row.id,
    (row) => `<button>${row.label}</button>`, (item, _index, inner) => {
      if (item.value.id === "c" && fail) throw failure;
      const button = inner.start!.nextSibling as HTMLButtonElement;
      const onClick = () => { clicks++; };
      button.addEventListener("click", onClick);
      return () => { releases++; button.removeEventListener("click", onClick); };
    });
  try {
    const oldA = root.querySelectorAll("button")[0];
    const oldB = root.querySelectorAll("button")[1];
    assert.throws(() => { rows.value = [{ id: "a", label: "A" }, { id: "c", label: "C" }]; }, (error: unknown) => error === failure);
    assert.deepEqual(listText(root as unknown as Element), ["A", "B"]);
    assert.equal(root.querySelectorAll("button")[0], oldA);
    assert.equal(root.querySelectorAll("button")[1], oldB);
    oldB!.dispatchEvent(new browser.Event("click"));
    assert.equal(clicks, 1);
    assert.equal(releases, 0);
    fail = false;
    rows.value = [{ id: "a", label: "A" }, { id: "c", label: "C" }, { id: "b", label: "B" }];
    assert.deepEqual(listText(root as unknown as Element), ["A", "C", "B"]);
    assert.equal(root.querySelectorAll("button")[0], oldA);
    assert.equal(root.querySelectorAll("button")[2], oldB);
  } finally {
    stop();
    browser.happyDOM.abort();
  }
});

test("failed list rendering leaves existing rows in place", () => {
  const browser = new Window();
  const root = browser.document.createElement("main");
  const rows = signal<Row[]>([{ id: "a", label: "A" }]);
  const failure = new Error("row B render failed");
  root.innerHTML = renderFor(0, rows.value, (row) => row.id, (row) => `<button>${row.label}</button>`);
  const stop = bindFor({ root: root as unknown as Element }, 0, () => rows.value, (row) => row.id,
    (row) => { if (row.id === "b") throw failure; return `<button>${row.label}</button>`; },
    () => () => {});
  try {
    const old = root.querySelector("button");
    assert.throws(() => { rows.value = [{ id: "b", label: "B" }]; }, (error: unknown) => error === failure);
    assert.deepEqual(listText(root as unknown as Element), ["A"]);
    assert.equal(root.querySelector("button"), old);
  } finally {
    stop();
    browser.happyDOM.abort();
  }
});

test("a failed row move restores the original order and node identity", () => {
  const browser = new Window();
  const root = browser.document.createElement("main");
  const rows = signal<Row[]>([{ id: "a", label: "A" }, { id: "b", label: "B" }, { id: "c", label: "C" }]);
  const failure = new Error("insert failed once");
  root.innerHTML = renderFor(0, rows.value, (row) => row.id, (row) => `<button>${row.label}</button>`);
  const stop = bindFor({ root: root as unknown as Element }, 0, () => rows.value, (row) => row.id,
    (row) => `<button>${row.label}</button>`, () => () => {});
  const old = [...root.querySelectorAll("button")];
  const insertBefore = root.insertBefore.bind(root);
  let fail = true;
  root.insertBefore = ((...args: Parameters<typeof root.insertBefore>) => {
    if (fail && args[0].nodeType === 11) {
      fail = false;
      throw failure;
    }
    return insertBefore(...args);
  }) as typeof root.insertBefore;
  try {
    assert.throws(() => { rows.value = [rows.value[2]!, rows.value[0]!, rows.value[1]!]; }, (error: unknown) => error === failure);
    assert.deepEqual(listText(root as unknown as Element), ["A", "B", "C"]);
    assert.deepEqual([...root.querySelectorAll("button")], old);
    rows.value = [rows.value[0]!, rows.value[2]!, rows.value[1]!];
    assert.deepEqual(listText(root as unknown as Element), ["C", "B", "A"]);
  } finally {
    root.insertBefore = insertBefore;
    stop();
    browser.happyDOM.abort();
  }
});

test("a later new-row hydration failure cleans earlier staged rows", () => {
  const browser = new Window();
  const root = browser.document.createElement("main");
  const rows = signal<Row[]>([{ id: "a", label: "A" }]);
  const failure = new Error("row C failed");
  let releases = 0;
  root.innerHTML = renderFor(0, rows.value, (row) => row.id, (row) => `<button>${row.label}</button>`);
  const stop = bindFor({ root: root as unknown as Element }, 0, () => rows.value, (row) => row.id,
    (row) => `<button>${row.label}</button>`, (item) => {
      if (item.value.id === "c") throw failure;
      return () => { if (item.value.id === "b") releases++; };
    });
  try {
    assert.throws(() => { rows.value = [rows.value[0]!, { id: "b", label: "B" }, { id: "c", label: "C" }]; }, (error: unknown) => error === failure);
    assert.deepEqual(listText(root as unknown as Element), ["A"]);
    assert.equal(releases, 1);
  } finally {
    stop();
    browser.happyDOM.abort();
  }
});

test("repeated keyed changes preserve every surviving node", () => {
  const browser = new Window();
  const root = browser.document.createElement("main");
  const rows = signal<Row[]>([{ id: "a", label: "A" }, { id: "b", label: "B" }, { id: "c", label: "C" }]);
  const markup = (row: Row) => `<button data-row="${row.id}">${row.label}</button>`;
  root.innerHTML = renderFor(0, rows.value, (row) => row.id, markup);
  const stop = bindFor({ root: root as unknown as Element }, 0, () => rows.value, (row) => row.id,
    markup, () => () => {});
  const orders = ["cab", "bac", "acb", "cba", "ab", "dba", "adbc", "bd", "edba", "a"];
  try {
    let surviving = new Map([...root.querySelectorAll("button")].map((node) => [node.dataset.row!, node]));
    for (const order of orders) {
      rows.value = [...order].map((id) => ({ id, label: id.toUpperCase() }));
      const actual = [...root.querySelectorAll("button")];
      assert.deepEqual(actual.map((node) => node.dataset.row), [...order]);
      for (const node of actual) {
        const previous = surviving.get(node.dataset.row!);
        if (previous) assert.equal(node, previous);
      }
      surviving = new Map(actual.map((node) => [node.dataset.row!, node]));
    }
  } finally {
    stop();
    browser.happyDOM.abort();
  }
});

test("failed removed-row cleanup does not leave obsolete rows or skip later cleanup", () => {
  const browser = new Window();
  const root = browser.document.createElement("main");
  const rows = signal<Row[]>([{ id: "a", label: "A" }, { id: "b", label: "B" }]);
  const failure = new Error("row A cleanup failed");
  let releasedB = false;
  root.innerHTML = renderFor(0, rows.value, (row) => row.id, (row) => `<button>${row.label}</button>`);
  const stop = bindFor({ root: root as unknown as Element }, 0, () => rows.value, (row) => row.id,
    (row) => `<button>${row.label}</button>`, (item) => () => {
      if (item.value.id === "a") throw failure;
      if (item.value.id === "b") releasedB = true;
    });
  try {
    assert.throws(() => { rows.value = []; }, (error: unknown) => error === failure);
    assert.deepEqual(listText(root as unknown as Element), []);
    assert.equal(releasedB, true);
  } finally {
    stop();
    browser.happyDOM.abort();
  }
});
