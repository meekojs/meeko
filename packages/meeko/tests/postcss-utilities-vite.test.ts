import assert from "node:assert/strict";
import { mkdir, utimes, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import test from "node:test";
import { build, createServer, normalizePath } from "vite";
import { meeko } from "../src/vite.ts";
import { createTempProject, linkRepositoryPackages } from "./helpers/temp-project.ts";

const files: Record<string, string> = {
  // The configuration a project writes: Vite loads it from the root and imports the published subpath.
  "postcss.config.ts": `import { meekoUtilities } from "@meekojs/meeko/postcss";\nexport default { plugins: [meekoUtilities()] };\n`,
  "app/styles/main.css": `@layer tokens, utilities;\n@utilities './utilities/color.ts' layer(utilities);\n`,
  "app/styles/utilities/palette.ts": `export const names = ["gray", "blue"];\n`,
  "app/styles/utilities/color.ts": `import { defineUtilities } from "@meekojs/meeko/postcss";
import { names } from "./palette";
export default defineUtilities(({ rule }) =>
  names.map((name) => rule(\`.color[data-color='\${name}']\`, { "--color-1": \`var(--\${name}-1)\` })));
`,
  "app/components/sizes.ts": `export default ({ rule }: import("@meekojs/meeko/postcss").UtilityHelpers) =>
  ["sm", "lg"].map((size) => rule(\`.card[data-size='\${size}']\`, { padding: size === "sm" ? "0.5rem" : "2rem" }));
`,
  "app/components/Card.meeko": `<template><p class="card" data-size="sm">x</p></template>\n<style scoped>\n.card { color: red; }\n@utilities "./sizes.ts";\n</style>\n`,
  "index.html": `<!doctype html><html><head><link rel="stylesheet" href="/app/styles/main.css"></head><body><script type="module" src="/main.ts"></script></body></html>\n`,
  "main.ts": `import "./app/components/Card.meeko";\n`,
};

async function createProject() {
  const project = await createTempProject("vite-postcss-utilities-");
  await linkRepositoryPackages(project.root);
  for (const [path, contents] of Object.entries(files)) {
    await mkdir(dirname(join(project.root, path)), { recursive: true });
    await writeFile(join(project.root, path), contents);
  }
  return project;
}

test("Vite expands @utilities in a global stylesheet and a .meeko style, and watches the TypeScript graph", async () => {
  const project = await createProject();
  const root = project.root;
  const server = await createServer({ root, configFile: false, plugins: [meeko()], server: { middlewareMode: true, hmr: false }, logLevel: "silent" });
  try {
    const global = await server.transformRequest("/app/styles/main.css");
    assert.match(global?.code ?? "", /@layer utilities \{[^]*\.color\[data-color='gray'\] \{[^]*--color-1: var\(--gray-1\)/);
    const graph = server.environments.client.moduleGraph;
    const stylesheet = await graph.getModuleByUrl("/app/styles/main.css");
    assert.ok(stylesheet);
    for (const dependency of ["app/styles/utilities/color.ts", "app/styles/utilities/palette.ts"]) {
      const modules = graph.getModulesByFile(normalizePath(join(root, dependency)));
      assert.ok(modules?.size, `${dependency} is in the module graph`);
      assert.ok([...modules].some((module) => module.importers.has(stylesheet)), `${dependency} updates the stylesheet`);
    }

    // A nested import changes: once Vite invalidates the stylesheet, the next transform regenerates it.
    const palette = join(root, "app/styles/utilities/palette.ts");
    await writeFile(palette, `export const names = ["gray", "red"];\n`);
    const later = new Date(Date.now() + 2_000);
    await utimes(palette, later, later);
    graph.invalidateModule(stylesheet);
    const updated = await server.transformRequest("/app/styles/main.css");
    assert.match(updated?.code ?? "", /\.color\[data-color='red'\]/);
    assert.doesNotMatch(updated?.code ?? "", /data-color='blue'/);

    const component = await server.transformRequest(join(root, "app/components/Card.meeko"));
    const id = /import "([^"]*\?meeko-style=[0-9a-f]{64}&lang\.css)"/.exec(component?.code ?? "")?.[1];
    assert.ok(id, component?.code);
    const style = await server.transformRequest(id);
    assert.match(style?.code ?? "", /\.card\[data-meeko-s-[0-9a-f]+\]/, "the block keeps its scoped rule");
    assert.match(style?.code ?? "", /\.card\[data-size='lg'\] \{[^]*padding: 2rem/, "the path resolves from the component's folder");
  } finally {
    await server.close();
    await project.remove();
  }
});

test("vite build writes the generated utilities into the CSS asset", { timeout: 60_000 }, async () => {
  const project = await createProject();
  try {
    const result = await build({
      root: project.root, configFile: false, plugins: [meeko()], logLevel: "silent",
      build: { outDir: join(project.root, "dist"), write: false, minify: false },
    });
    const outputs = (Array.isArray(result) ? result : [result]) as Array<{ output: Array<{ type: string; fileName: string; source?: string | Uint8Array }> }>;
    const css = outputs.flatMap((entry) => entry.output)
      .filter((item) => item.fileName.endsWith(".css"))
      .map((item) => typeof item.source === "string" ? item.source : new TextDecoder().decode(item.source)).join("\n");
    assert.match(css, /\.color\[data-color='blue'\]/);
    assert.match(css, /\.card\[data-size='sm'\]/);
    assert.doesNotMatch(css, /@utilities/);
  } finally {
    await project.remove();
  }
});
