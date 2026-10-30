import assert from "node:assert/strict";
import { mkdir, readFile, readdir, rename, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import test from "node:test";
import { build, createServer } from "vite";
import { Window } from "happy-dom";
import { generateComponentRegistry } from "../src/autoimports/components.ts";
import { compileWithAutoImports } from "../src/autoimports/transform.ts";
import { meeko } from "../src/vite.ts";
import { createTempProject, linkRepositoryPackages, tempProject } from "./helpers/temp-project.ts";

test("the generated component resolver uses only literal lazy imports and rejects unknown names", async (context) => {
  const root = await tempProject(context, "component-registry-runtime");
  await writeFile(join(root, "package.json"), '{"private":true,"type":"module"}\n');
  const button = join(root, "app", "components", "Button.meeko");
  await mkdir(dirname(button), { recursive: true });
  await writeFile(button, "<template><button>ok</button></template>\n");
  const output = await generateComponentRegistry(root);
  const source = await readFile(output, "utf8");
  assert.match(source, /"Button": \(\) => import\("\.\.\/\.\.\/app\/components\/Button\.meeko"\)/);
  assert.doesNotMatch(source, /import \* as Button/);
  assert.doesNotMatch(source, /import\(name\)/);
  assert.doesNotMatch(source, /[A-Za-z]:\\/);
  assert.match(source, /Object\.hasOwn\(loaders, name\)/);
  assert.equal(await readFile(await generateComponentRegistry(root), "utf8"), source);
  const page = join(root, "app", "pages", "index.meeko");
  await mkdir(dirname(page), { recursive: true });
  const compiled = await compileWithAutoImports('<script lang="ts">const pending = resolveComponent("Button");</script><template><p>Loading</p></template>', page, {}, "client");
  assert.match(compiled.code, /import \{ resolveComponent as resolveComponent \} from .*\.meeko\/generated\/components\.js/);
  await rename(button, join(dirname(button), "Card.meeko"));
  const renamed = await readFile(await generateComponentRegistry(root), "utf8");
  assert.match(renamed, /"Card": \(\) => import/);
  assert.doesNotMatch(renamed, /"Button": \(\) => import/);
});

test("a production browser build keeps registered components in lazy chunks", async () => {
  const project = await createTempProject("component-registry-chunk-");
  const root = project.root;
  await linkRepositoryPackages(root);
  const button = join(root, "app", "components", "Button.meeko");
  await mkdir(dirname(button), { recursive: true });
  await writeFile(button, '<template><button>lazy-only-content</button></template>\n');
  await generateComponentRegistry(root);
  await writeFile(join(root, "index.html"), '<div id="app"></div><script type="module" src="/main.ts"></script>');
  await writeFile(join(root, "main.ts"), 'import { resolveComponent } from "./.meeko/generated/components.ts";\n(document.getElementById("app") as HTMLElement).onclick = () => { void resolveComponent("Button"); };\n');
  try {
    await build({ root, configFile: false, plugins: [meeko()], logLevel: "silent", build: { outDir: "dist", manifest: true } });
    const assets = join(root, "dist", "assets");
    const chunks = await Promise.all((await readdir(assets)).filter((file) => file.endsWith(".js")).map((file) => readFile(join(assets, file), "utf8")));
    assert.ok(chunks.length >= 2, "the component gets a separate chunk");
    assert.equal(chunks.filter((code) => code.includes("lazy-only-content")).length, 1);
    const manifest = JSON.parse(await readFile(join(root, "dist", ".vite", "manifest.json"), "utf8")) as Record<string, { isEntry?: boolean; file: string }>;
    const entry = Object.values(manifest).find((item) => item.isEntry);
    assert.ok(entry);
    assert.doesNotMatch(await readFile(join(root, "dist", entry.file), "utf8"), /lazy-only-content/);
  } finally {
    await project.remove();
  }
});

test("the lazy resolver loads the original renderable module through Vite SSR", async () => {
  const project = await createTempProject("component-registry-vite-");
  const root = project.root;
  await linkRepositoryPackages(root);
  const button = join(root, "app", "components", "Button.meeko");
  await mkdir(dirname(button), { recursive: true });
  await writeFile(button, '<script lang="ts">const props = defineProps<{ label: string }>();</script><template><button>{props.label}</button></template>\n');
  const generated = await generateComponentRegistry(root);
  const server = await createServer({ root, configFile: false, plugins: [meeko()], server: { middlewareMode: true, hmr: false }, logLevel: "silent" });
  try {
    const registry = await server.ssrLoadModule(generated) as { resolveComponent(name: string): Promise<{ renderToString(props: { label: string }): string; hydrate(root: Element, props: { label: string }): () => void }> };
    const component = await registry.resolveComponent("Button");
    const html = component.renderToString({ label: "saved" });
    assert.match(html, /<button[^>]*>.*saved.*<\/button>/);
    const window = new Window();
    try {
      const root = window.document.createElement("main");
      root.innerHTML = html;
      const release = component.hydrate(root as unknown as Element, { label: "saved" });
      assert.equal(root.innerHTML, html);
      release();
    } finally {
      await window.happyDOM.close();
    }
    await assert.rejects(registry.resolveComponent("Missing"), /no registrado: Missing/);
  } finally {
    await server.close();
    await project.remove();
  }
});
