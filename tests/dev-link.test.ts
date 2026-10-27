import assert from "node:assert/strict";
import { mkdir, mkdtemp, realpath, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test, { mock } from "node:test";
import { createSettleDebounce, findLinkedMeeko, linkWatchEnabled } from "../src/framework/dev-link.ts";

/** A junction on Windows (no privilege needed), a directory symlink elsewhere. */
const link = (target: string, path: string) => symlink(target, path, process.platform === "win32" ? "junction" : "dir");

/** Writes a minimal `@meekojs/meeko` package at `directory`. */
async function fakeMeeko(directory: string): Promise<void> {
  await mkdir(join(directory, "dist"), { recursive: true });
  await writeFile(join(directory, "package.json"), JSON.stringify({ name: "@meekojs/meeko", type: "module", exports: { ".": { default: "./dist/index.js" } } }));
  await writeFile(join(directory, "dist", "index.js"), "export {};\n");
}

async function sandbox(context: { after(fn: () => Promise<void>): void }): Promise<string> {
  const root = await realpath(await mkdtemp(join(tmpdir(), "meeko-dev-link-")));
  context.after(() => rm(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 }));
  return root;
}

test("a Meeko installed in node_modules is not linked", async (context) => {
  const root = await sandbox(context);
  const app = join(root, "app");
  await fakeMeeko(join(app, "node_modules", "@meekojs", "meeko"));
  assert.equal(findLinkedMeeko(app), undefined);
});

test("a Meeko in the pnpm store, reached through a link, is not linked", async (context) => {
  const root = await sandbox(context);
  const app = join(root, "app");
  // pnpm's layout: node_modules/@meekojs/meeko links into node_modules/.pnpm.
  const store = join(app, "node_modules", ".pnpm", "@meekojs+meeko@1.2.0", "node_modules", "@meekojs", "meeko");
  await fakeMeeko(store);
  await mkdir(join(app, "node_modules", "@meekojs"), { recursive: true });
  await link(store, join(app, "node_modules", "@meekojs", "meeko"));
  assert.equal(findLinkedMeeko(app), undefined);
  // A store shared by a workspace, above the app's own node_modules.
  const workspace = join(root, "workspace");
  const shared = join(workspace, "node_modules", ".pnpm", "@meekojs+meeko@1.2.0", "node_modules", "@meekojs", "meeko");
  await fakeMeeko(shared);
  const nested = join(workspace, "apps", "web");
  await mkdir(join(nested, "node_modules", "@meekojs"), { recursive: true });
  await link(shared, join(nested, "node_modules", "@meekojs", "meeko"));
  assert.equal(findLinkedMeeko(nested), undefined);
});

test("a Meeko linked from a checkout is found with its dist", async (context) => {
  const root = await sandbox(context);
  const checkout = join(root, "meeko");
  await fakeMeeko(checkout);
  const app = join(root, "app");
  await mkdir(join(app, "node_modules", "@meekojs"), { recursive: true });
  await link(checkout, join(app, "node_modules", "@meekojs", "meeko"));
  assert.deepEqual(findLinkedMeeko(app), { directory: checkout, dist: join(checkout, "dist") });
  // From a subdirectory of the app too, as Node resolves it.
  await mkdir(join(app, "app", "pages"), { recursive: true });
  assert.deepEqual(findLinkedMeeko(join(app, "app", "pages")), { directory: checkout, dist: join(checkout, "dist") });
});

test("an app that does not resolve Meeko has nothing to watch", async (context) => {
  const root = await sandbox(context);
  const app = join(root, "app");
  await mkdir(app, { recursive: true });
  assert.equal(findLinkedMeeko(app), undefined);
  assert.equal(findLinkedMeeko(join(root, "missing")), undefined);
});

test("MEEKO_LINK_WATCH=0 and a supervised server turn the link watch off", () => {
  assert.equal(linkWatchEnabled({}), true);
  assert.equal(linkWatchEnabled({ MEEKO_LINK_WATCH: "1" }), true);
  assert.equal(linkWatchEnabled({ MEEKO_LINK_WATCH: "0" }), false);
  assert.equal(linkWatchEnabled({ MEEKO_DEV_SUPERVISED: "1" }), false);
});

test("the settle debounce runs once after the last trigger", (context) => {
  context.mock.timers.enable({ apis: ["setTimeout"] });
  const run = mock.fn();
  const debounce = createSettleDebounce(400, run);
  // A build writes files in bursts; each write extends the quiet period.
  for (let index = 0; index < 50; index++) {
    debounce.trigger();
    context.mock.timers.tick(100);
  }
  assert.equal(run.mock.callCount(), 0);
  assert.equal(debounce.pending, true);
  context.mock.timers.tick(299);
  assert.equal(run.mock.callCount(), 0);
  context.mock.timers.tick(1);
  assert.equal(run.mock.callCount(), 1);
  assert.equal(debounce.pending, false);
  // A later build restarts again.
  debounce.trigger();
  context.mock.timers.tick(400);
  assert.equal(run.mock.callCount(), 2);
  // A cancelled run never happens.
  debounce.trigger();
  debounce.cancel();
  context.mock.timers.tick(1000);
  assert.equal(run.mock.callCount(), 2);
  assert.equal(debounce.pending, false);
});
