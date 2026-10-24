import assert from "node:assert/strict";
import test from "node:test";
import { StateStore, useState, withStateStore } from "../src/framework/state.ts";

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
