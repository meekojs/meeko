import assert from "node:assert/strict";
import { mkdtemp, mkdir, rename, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import test from "node:test";
import { discoverAutoImports, discoverAutoImportsSync, discoverComponents, discoverComponentsSync } from "../src/autoimports/registry.ts";
import { loadMeekoConfig, readMeekoConfigSync } from "../src/framework/config.ts";

async function fixture(files: Record<string, string>, run: (root: string) => Promise<void>): Promise<void> {
  const root = await mkdtemp(join(tmpdir(), "meeko-components-"));
  try {
    for (const [path, content] of Object.entries(files)) {
      const file = join(root, path);
      await mkdir(dirname(file), { recursive: true });
      await writeFile(file, content);
    }
    await run(root);
  } finally { await rm(root, { recursive: true, force: true }); }
}

test("configured directories, nested names and overlaps share one autoimport catalog", async () => {
  await fixture({
    "meeko.config.ts": `export default { components: { dirs: [{ path: "app/components/Form", prefix: "Form" }, { path: "app/widgets", prefix: "Widget" }] } };`,
    "app/components/Button.meeko": "<template><button>OK</button></template>",
    "app/components/Form/UserCreate.meeko": "<template><p>Create</p></template>",
    "app/widgets/Notice.meeko": "<template><p>Notice</p></template>",
    "app/other/Hidden.meeko": "<template><p>Hidden</p></template>",
  }, async (root) => {
    const expected = ["Button", "FormUserCreate", "WidgetNotice"];
    assert.deepEqual((await discoverComponents(root)).map((component) => component.name), expected);
    assert.deepEqual(discoverComponentsSync(root).map((component) => component.name), expected);
    assert.deepEqual((await discoverAutoImports(root)).filter((entry) => entry.component).map((entry) => entry.name), expected);
    assert.deepEqual(discoverAutoImportsSync(root).filter((entry) => entry.component).map((entry) => entry.name), expected);
    assert.equal((await discoverAutoImports(root)).some((entry) => entry.name === "FormFormUserCreate" || entry.name === "Hidden"), false);
  });
});

test("project component takes precedence over the same name in a layer", async () => {
  await fixture({
    "meeko.config.ts": `export default { layers: ["./layers/base"] };`,
    "app/components/Card.meeko": "<template><p>Project</p></template>",
    "layers/base/app/pages/index.meeko": "<template><p>Layer</p></template>",
    "layers/base/app/components/Card.meeko": "<template><p>Layer</p></template>",
  }, async (root) => {
    const components = await discoverComponents(root);
    assert.equal(components.length, 1);
    assert.equal(components[0]?.source, "app");
    assert.equal(components[0]?.file, join(root, "app", "components", "Card.meeko"));
  });
});

test("module component directories participate after project sources", async () => {
  const moduleDefinition = new URL("../src/modules/define-meeko-module.ts", import.meta.url).href;
  await fixture({
    "meeko.config.ts": `import { defineMeekoModule } from ${JSON.stringify(moduleDefinition)}; export default { modules: [defineMeekoModule({ meta: { name: "ui" }, setup(_options, meeko) { meeko.addComponentsDir("module-components", { prefix: "Ui" }); } })] };`,
    "module-components/Badge.meeko": "<template><p>Badge</p></template>",
  }, async (root) => {
    const components = await discoverComponents(root);
    assert.deepEqual(components.map((component) => component.name), ["UiBadge"]);
    assert.equal((await discoverAutoImports(root)).some((entry) => entry.name === "UiBadge" && entry.component), true);
    assert.deepEqual(discoverComponentsSync(root), []);
  });
});

test("two distinct files with one name in a source fail explicitly", async () => {
  await fixture({
    "app/components/FormCard.meeko": "<template />",
    "app/components/Form/Card.meeko": "<template />",
  }, async (root) => {
    await assert.rejects(discoverComponents(root), /Nombre de componente duplicado FormCard/);
    assert.throws(() => discoverComponentsSync(root), /Nombre de componente duplicado FormCard/);
  });
});

test("discovery reflects added, renamed and removed files without stale entries", async () => {
  await fixture({}, async (root) => {
    const folder = join(root, "app", "components");
    await mkdir(folder, { recursive: true });
    assert.deepEqual(await discoverComponents(root), []);
    await writeFile(join(folder, "Old.meeko"), "<template />");
    assert.deepEqual((await discoverComponents(root)).map((entry) => entry.name), ["Old"]);
    await rename(join(folder, "Old.meeko"), join(folder, "New.meeko"));
    assert.deepEqual((await discoverComponents(root)).map((entry) => entry.name), ["New"]);
    await rm(join(folder, "New.meeko"));
    assert.deepEqual(await discoverComponents(root), []);
  });
});

test("Windows separators resolve from the source root and missing directories are empty", async () => {
  await fixture({
    "meeko.config.ts": `export default { components: { dirs: [{ path: "app\\\\widgets", prefix: "Ui" }, { path: "app/missing", prefix: "Missing" }] } };`,
    "app/widgets/Badge.meeko": "<template />",
  }, async (root) => {
    assert.deepEqual((await discoverComponents(root)).map((entry) => entry.name), ["UiBadge"]);
    assert.deepEqual(discoverComponentsSync(root).map((entry) => entry.name), ["UiBadge"]);
  });
});

test("component paths and prefixes are validated in executed and static configuration", async () => {
  for (const directory of ["../private", "/absolute", "C:/private", "app/./components", "app//components"]) {
    await fixture({ "meeko.config.ts": `export default { components: { dirs: [{ path: ${JSON.stringify(directory)} }] } };` }, async (root) => {
      await assert.rejects(loadMeekoConfig(root), /components\.dirs\[0\]\.path/);
      assert.throws(() => readMeekoConfigSync(root), /components\.dirs\[0\]\.path/);
    });
  }
  await fixture({ "meeko.config.ts": `export default { components: { dirs: [{ path: "app/components", prefix: "bad prefix" }] } };` }, async (root) => {
    await assert.rejects(loadMeekoConfig(root), /components\.dirs\[0\]\.prefix/);
    assert.throws(() => readMeekoConfigSync(root), /components\.dirs\[0\]\.prefix/);
  });
});

test("the generated async resolver is autoimported in app code when present", async () => {
  await fixture({
    ".meeko/generated/components.ts": "export async function resolveComponent() {}",
  }, async (root) => {
    const entry = (await discoverAutoImports(root)).find((item) => item.name === "resolveComponent");
    assert.equal(entry?.scope, "app");
    assert.equal(entry?.browserCode, true);
    assert.equal(entry?.file, join(root, ".meeko", "generated", "components.ts"));
  });
});
