import assert from "node:assert/strict";
import test from "node:test";
import { createRoot, onCleanup } from "../src/reactivity.ts";

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
