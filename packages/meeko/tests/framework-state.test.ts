import assert from "node:assert/strict";
import test from "node:test";
import { onCleanup } from "../src/reactivity.ts";
import { StateStore, hydrateWithStateStore, useState, withStateStore } from "../src/framework/state.ts";

test("keyed state is isolated between requests and snapshots safely", () => {
  const first = new StateStore();
  const second = new StateStore();
  const left = withStateStore(first, () => useState("counter", () => 1));
  left.value = 4;
  assert.equal(withStateStore(first, () => useState("counter", () => 99)).value, 4);
  assert.equal(withStateStore(second, () => useState("counter", () => 2)).value, 2);
  assert.deepEqual({ ...first.snapshot() }, { counter: 4 });
  assert.deepEqual({ ...new StateStore(first.snapshot()).snapshot() }, { counter: 4 });
  assert.throws(() => useState("counter", () => 1), /Missing Meeko context/);
  assert.throws(() => new StateStore(JSON.parse('{"__proto__":"unsafe"}') as Record<string, unknown>), /Invalid state key/);
});

test("state roots preserve both work and cleanup failures", () => {
  const renderError = new Error("render failed");
  const cleanupError = new Error("cleanup failed");
  assert.throws(() => withStateStore(new StateStore(), () => {
    onCleanup(() => { throw cleanupError; });
    throw renderError;
  }), (error: unknown) => {
    assert.ok(error instanceof AggregateError);
    assert.deepEqual(error.errors, [renderError, cleanupError]);
    return true;
  });

  const releaseError = new Error("component release failed");
  const rootError = new Error("root cleanup failed");
  const release = hydrateWithStateStore(new StateStore(), () => {
    onCleanup(() => { throw rootError; });
    return () => { throw releaseError; };
  });
  assert.throws(release, (error: unknown) => {
    assert.ok(error instanceof AggregateError);
    assert.deepEqual(error.errors, [releaseError, rootError]);
    return true;
  });
});

test("invalid server state is rejected without seeding earlier keys", () => {
  const store = new StateStore();
  const values = JSON.parse('{"valid":1,"__proto__":"unsafe"}') as Record<string, unknown>;
  assert.throws(() => store.seed(values), /Invalid state key/);
  assert.equal(store.get("valid", () => 2).value, 2);
});

test("navigation state restores a nested value mutated by a failed commit", () => {
  const store = new StateStore({ settings: { theme: "dark" } });
  const draft = store.navigationDraft();
  draft.state.get("counter", () => 1);
  assert.throws(() => draft.commit(() => {
    store.get("settings", () => ({ theme: "missing" })).value.theme = "broken";
    throw new Error("commit failed");
  }), /commit failed/);
  assert.deepEqual(store.get("settings", () => ({ theme: "missing" })).value, { theme: "dark" });
  assert.equal(store.get("counter", () => 2).value, 2);
});

test("a navigation draft cannot overwrite state changed while its loader waited", () => {
  const store = new StateStore({ owner: "first" });
  const draft = store.navigationDraft();
  draft.state.get("owner", () => "missing").value = "stale";
  store.get("owner", () => "missing").value = "newer";
  assert.throws(() => draft.commit(() => undefined), /state changed while navigating: owner/);
  assert.equal(store.get("owner", () => "missing").value, "newer");
});
