import assert from "node:assert/strict";
import { appendFile, mkdir, mkdtemp, readdir, readFile, realpath, rm, stat, symlink, utimes, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test, { mock } from "node:test";
import { createSettleDebounce, findLinkedMeeko, linkWatchEnabled, warnLinkedMeekoRebuilds, watchLinkedMeeko } from "../src/framework/dev-link.ts";

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

const pause = (milliseconds: number) => new Promise((done) => setTimeout(done, milliseconds));

async function until(condition: () => boolean, message: () => string, timeout = 10_000): Promise<void> {
  const start = Date.now();
  while (!condition()) {
    if (Date.now() - start > timeout) throw new Error(message());
    await pause(25);
  }
}

test("the link watch reports writes to the linked build, not reads of it", { timeout: 30_000 }, async (context) => {
  const root = await sandbox(context);
  const checkout = join(root, "meeko");
  await fakeMeeko(checkout);
  await mkdir(join(checkout, "dist", "framework"), { recursive: true });
  const server = join(checkout, "dist", "framework", "server.js");
  await writeFile(server, "export {};\n");
  const files = [join(checkout, "package.json"), join(checkout, "dist", "index.js"), server];
  // Last read hours ago: Windows updates the access time on the next read and reports it as a
  // change (with access time updates on), as when a fresh `meeko dev` loads a build from yesterday.
  const hoursAgo = new Date(Date.now() - 3 * 3_600_000);
  for (const file of files) await utimes(file, hoursAgo, (await stat(file)).mtime);
  await pause(200);
  let changes = 0;
  const watcher = watchLinkedMeeko({ directory: checkout, dist: join(checkout, "dist") }, () => { changes++; });
  context.after(() => watcher.close());
  await pause(300);
  for (const file of files) await readFile(file);
  await readdir(join(checkout, "dist"), { recursive: true });
  await pause(800);
  assert.equal(changes, 0, "Reading the build is not a rebuild");
  await appendFile(server, "\n");
  await until(() => changes > 0, () => "A write to dist was not reported");
  const afterWrite = changes;
  await writeFile(join(checkout, "dist", "added.js"), "export {};\n");
  await until(() => changes > afterWrite, () => "A new file in dist was not reported");
  const afterAdd = changes;
  await writeFile(files[0]!, `${await readFile(files[0]!, "utf8")}\n`);
  await until(() => changes > afterAdd, () => "A change of package.json was not reported");
});

test("an unsupervised dev warns once per settled rebuild of the linked Meeko", { timeout: 30_000 }, async (context) => {
  const root = await sandbox(context);
  const checkout = join(root, "meeko");
  await fakeMeeko(checkout);
  const previous = process.env.MEEKO_LINK_WATCH;
  process.env.MEEKO_LINK_WATCH = "0";
  context.after(() => {
    if (previous === undefined) delete process.env.MEEKO_LINK_WATCH;
    else process.env.MEEKO_LINK_WATCH = previous;
  });
  const lines: string[] = [];
  const warning = warnLinkedMeekoRebuilds({ directory: checkout, dist: join(checkout, "dist") }, (text) => { lines.push(text); }, 150);
  context.after(() => warning.close());
  await pause(300);
  // A build writes in bursts: one warning once it settles.
  const index = join(checkout, "dist", "index.js");
  for (let round = 0; round < 5; round++) {
    await appendFile(index, "\n");
    await pause(40);
  }
  await until(() => lines.length > 0, () => "The rebuild was not reported");
  await pause(600);
  assert.equal(lines.length, 1, lines.join(""));
  assert.equal(lines[0], `[meeko] Meeko enlazado cambió (${join(checkout, "dist")}), pero este meeko dev no se reinicia solo (MEEKO_LINK_WATCH=0): `
    + "el servidor sigue con el código anterior y el navegador recibe el nuevo. Reinicia meeko dev.\n");
  // The next build warns again; a closed warning stays quiet.
  await appendFile(index, "\n");
  await until(() => lines.length === 2, () => `The second rebuild was not reported: ${lines.join("")}`);
  warning.close();
  await appendFile(index, "\n");
  await pause(600);
  assert.equal(lines.length, 2);
});
