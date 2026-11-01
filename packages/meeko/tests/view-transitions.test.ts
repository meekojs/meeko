import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { createViewTransitionController } from "../src/app/runtime/view-transitions.ts";
import { clientRoutesSource } from "../src/framework/app-manifest.ts";
import { loadMeekoConfig } from "../src/framework/config.ts";

function fakeBrowser(options: { reduced?: boolean; hidden?: boolean; supported?: boolean; throws?: boolean; rejectedAnimation?: boolean; pendingAnimation?: boolean; types?: boolean } = {}) {
  const callbacks: Array<() => void> = [];
  const transitions: ViewTransition[] = [];
  const started: unknown[] = [];
  let skips = 0;
  const browser = {
    ...(options.types ? { ViewTransition: { prototype: { types: undefined } } } : { ViewTransition: { prototype: {} } }),
    matchMedia: () => ({ matches: options.reduced ?? false }),
    document: {
      visibilityState: options.hidden ? "hidden" : "visible",
      startViewTransition: options.supported === false ? undefined : (argument: (() => void) | { update: () => void; types: string[] }) => {
        if (options.throws) throw new Error("native unavailable");
        started.push(argument);
        const update = typeof argument === "function" ? argument : argument.update;
        let resolve!: () => void;
        let reject!: (error: unknown) => void;
        const updateCallbackDone = new Promise<void>((yes, no) => { resolve = yes; reject = no; });
        const ready = updateCallbackDone.then(() => { if (options.rejectedAnimation) throw new Error("duplicate transition name"); });
        const transition = {
          updateCallbackDone, ready,
          finished: options.pendingAnimation ? updateCallbackDone.then(() => new Promise<void>(() => {})) : updateCallbackDone,
          skipTransition() { skips++; },
        } as unknown as ViewTransition;
        transitions.push(transition);
        callbacks.push(() => { try { update(); resolve(); } catch (error) { reject(error); } });
        return transition;
      },
    },
  } as unknown as Window;
  return { browser, callbacks, transitions, started, get skips() { return skips; } };
}

test("a navigation names its transition type, and falls back to the callback where types do not exist", async () => {
  const typed = fakeBrowser({ types: true });
  let updates = 0;
  const result = createViewTransitionController(typed.browser).commit(() => { updates++; }, new AbortController().signal, true);
  assert.deepEqual((typed.started[0] as { types: string[] }).types, ["meeko-route"]);
  typed.callbacks[0]!();
  assert.equal(await result, true);
  assert.equal(updates, 1);

  const old = fakeBrowser({ types: false });
  const fallback = createViewTransitionController(old.browser).commit(() => { updates++; }, new AbortController().signal, true);
  assert.equal(typeof old.started[0], "function");
  old.callbacks[0]!();
  assert.equal(await fallback, true);
  assert.equal(updates, 2);

  // A browser without the ViewTransition interface on window, such as a minimal DOM.
  const bare = fakeBrowser();
  delete (bare.browser as unknown as { ViewTransition?: unknown }).ViewTransition;
  const none = createViewTransitionController(bare.browser).commit(() => { updates++; }, new AbortController().signal, true);
  assert.equal(typeof bare.started[0], "function");
  bare.callbacks[0]!();
  assert.equal(await none, true);
  assert.equal(updates, 3);
});

test("view transitions update exactly once and skip unsupported, disabled, hidden and reduced-motion paths", async () => {
  for (const options of [{ supported: false }, { hidden: true }, { reduced: true }, { throws: true }, {}]) {
    const fake = fakeBrowser(options);
    const controller = createViewTransitionController(fake.browser);
    let updates = 0;
    const result = controller.commit(() => { updates++; }, new AbortController().signal, Object.keys(options).length > 0);
    assert.equal(await result, true);
    assert.equal(updates, 1);
    assert.equal(fake.callbacks.length, 0);
  }
});

test("native transitions wait for the DOM callback and animation failures do not undo navigation", async () => {
  const fake = fakeBrowser({ rejectedAnimation: true });
  const controller = createViewTransitionController(fake.browser);
  let updates = 0;
  const result = controller.commit(() => { updates++; }, new AbortController().signal, true);
  assert.equal(updates, 0);
  fake.callbacks[0]!();
  assert.equal(await result, true);
  assert.equal(updates, 1);
});

test("aborted and superseded transitions cannot commit stale content", async () => {
  const fake = fakeBrowser();
  const controller = createViewTransitionController(fake.browser);
  const first = new AbortController();
  const updates: string[] = [];
  const old = controller.commit(() => { updates.push("old"); }, first.signal, true);
  first.abort();
  const next = controller.commit(() => { updates.push("new"); }, new AbortController().signal, true);
  fake.callbacks[0]!();
  fake.callbacks[1]!();
  assert.equal(await old, false);
  assert.equal(await next, true);
  assert.deepEqual(updates, ["new"]);
  assert.ok(fake.skips > 0);
});

test("failed DOM updates propagate and are never retried", async () => {
  const fake = fakeBrowser();
  let updates = 0;
  const result = createViewTransitionController(fake.browser).commit(() => { updates++; throw new Error("hydrate failed"); }, new AbortController().signal, true);
  const rejected = assert.rejects(result, /hydrate failed/);
  fake.callbacks[0]!();
  await rejected;
  assert.equal(updates, 1);
});

test("navigation waits for its update, not for the animation, and disposal can skip it", async () => {
  const fake = fakeBrowser({ pendingAnimation: true });
  const controller = createViewTransitionController(fake.browser);
  const result = controller.commit(() => {}, new AbortController().signal, true);
  fake.callbacks[0]!();
  assert.equal(await result, true);
  controller.skip();
  assert.equal(fake.skips, 1);
  const aborted = new AbortController();
  aborted.abort();
  assert.equal(await controller.commit(() => assert.fail("aborted update"), aborted.signal, true), false);
  assert.equal(fake.callbacks.length, 1);
});

test("viewTransitions is validated and emitted to the client manifest without executing browser code", async () => {
  const root = await mkdtemp(join(tmpdir(), "meeko-view-transitions-"));
  try {
    await mkdir(join(root, "app/pages"), { recursive: true });
    await writeFile(join(root, "app/pages/index.meeko"), "<template>Home</template>");
    const file = join(root, "meeko.config.mjs");
    await writeFile(file, "export default { viewTransitions: true };");
    assert.equal((await loadMeekoConfig(root)).viewTransitions, true);
    assert.match(await clientRoutesSource(root), /export const viewTransitions = true;/);
    await writeFile(file, "export default { viewTransitions: false };");
    assert.match(await clientRoutesSource(root), /export const viewTransitions = false;/);
    await writeFile(file, 'export default { viewTransitions: "yes" };');
    await assert.rejects(loadMeekoConfig(root), /viewTransitions debe ser un booleano/);
  } finally { await rm(root, { recursive: true, force: true }); }
});
