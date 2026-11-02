import assert from "node:assert/strict";
import { watch } from "node:fs";
import { mkdir, mkdtemp, readdir, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import test from "node:test";
import { pathToFileURL } from "node:url";

const { copyComponents } = await import(pathToFileURL(resolve("../../scripts/copy-components.mjs")).href) as {
  copyComponents(root: string, folders: ReadonlyArray<readonly [string, string]>, cli: string): Promise<void>;
};

/** A package with a stand-in for `meeko types`, which fails for a file named `Broken.meeko`. */
async function fixture(context: { after(fn: () => Promise<void>): void }): Promise<{ root: string; cli: string; target: string; source: string }> {
  const root = await mkdtemp(join(tmpdir(), "meeko-copy-components-"));
  context.after(() => rm(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 }));
  const cli = join(root, "fake-cli.mjs");
  await writeFile(cli, `import { mkdirSync, writeFileSync } from "node:fs";
import { basename, join } from "node:path";
const file = process.argv[3];
if (basename(file) === "Broken.meeko") process.exit(1);
const directory = join(process.cwd(), "generated");
mkdirSync(directory, { recursive: true });
const output = join(directory, basename(file).replace(/\\.meeko$/, ".d.meeko.ts"));
writeFileSync(output, "export type Name = " + JSON.stringify(basename(file)) + ";\\n");
console.log(output);
`);
  const source = join(root, "src", "app", "components");
  await mkdir(join(source, "Group"), { recursive: true });
  await writeFile(join(source, "Card.meeko"), "<template><p>card</p></template>");
  await writeFile(join(source, "Group", "Item.meeko"), "<template><p>item</p></template>");
  await writeFile(join(source, "helper.ts"), "export const helper = 1;\n");
  return { root, cli, source, target: join(root, "dist", "app", "components") };
}

const listing = async (directory: string): Promise<string[]> => (await readdir(directory, { recursive: true, withFileTypes: true })).filter((entry) => entry.isFile()).map((entry) => join(entry.parentPath, entry.name).slice(directory.length + 1).replaceAll("\\", "/")).sort();

test("copyComponents publishes each component with its declaration, also with a watcher open on the folder", async (context) => {
  // Renaming the folder failed with EPERM on Windows while `meeko dev` watched `dist`, and broke `pnpm build`.
  const { root, cli, source, target } = await fixture(context);
  await copyComponents(root, [["app", "components"]], cli);
  assert.deepEqual(await listing(target), ["Card.d.meeko.ts", "Card.meeko", "Group/Item.d.meeko.ts", "Group/Item.meeko", "helper.ts"]);
  assert.deepEqual(await readdir(join(root, "dist", "app")), ["components"], "no folder of the build remains");

  const events: string[] = [];
  const watcher = watch(join(root, "dist"), { recursive: true }, (_event, name) => { if (name) events.push(name.replaceAll("\\", "/")); });
  try {
    const untouched = (await stat(join(target, "Group", "Item.meeko"))).mtimeMs;
    await new Promise((done) => setTimeout(done, 30));
    await writeFile(join(source, "Card.meeko"), "<template><p>changed</p></template>");
    await writeFile(join(source, "New.meeko"), "<template><p>new</p></template>");
    await rm(join(source, "helper.ts"));
    await copyComponents(root, [["app", "components"]], cli);
    assert.deepEqual(await listing(target), ["Card.d.meeko.ts", "Card.meeko", "Group/Item.d.meeko.ts", "Group/Item.meeko", "New.d.meeko.ts", "New.meeko"]);
    assert.equal(await readFile(join(target, "Card.meeko"), "utf8"), "<template><p>changed</p></template>");
    assert.equal((await stat(join(target, "Group", "Item.meeko"))).mtimeMs, untouched, "what did not change is not written");
    await new Promise((done) => setTimeout(done, 200));
    // A new component reaches `dist` after its declaration.
    const published = events.filter((name) => name.startsWith("app/components/"));
    const declared = published.indexOf("app/components/New.d.meeko.ts");
    const component = published.indexOf("app/components/New.meeko");
    assert.ok(declared >= 0 && component > declared, published.join());
  } finally {
    watcher.close();
  }
});

test("a declaration that fails leaves the published components as they were", async (context) => {
  const { root, cli, source, target } = await fixture(context);
  await copyComponents(root, [["app", "components"]], cli);
  const before = await listing(target);
  await writeFile(join(source, "Card.meeko"), "<template><p>changed</p></template>");
  await writeFile(join(source, "Broken.meeko"), "<template><p>broken</p></template>");
  await assert.rejects(copyComponents(root, [["app", "components"]], cli));
  assert.deepEqual(await listing(target), before);
  assert.equal(await readFile(join(target, "Card.meeko"), "utf8"), "<template><p>card</p></template>");
  assert.deepEqual(await readdir(join(root, "dist", "app")), ["components"], "no folder of the build remains");
});
