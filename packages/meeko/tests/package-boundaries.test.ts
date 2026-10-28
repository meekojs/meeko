import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import test from "node:test";
import { pathToFileURL } from "node:url";
import { build } from "esbuild";

test("engine and framework browser bundles exclude server transports", async () => {
  const result = await build({
    entryPoints: [resolve("dist/index.js"), resolve("dist/framework.js")],
    bundle: true,
    format: "esm",
    platform: "browser",
    write: false,
    metafile: true,
    outdir: "out",
  });
  const inputs = Object.keys(result.metafile.inputs).map((input) => input.replaceAll("\\", "/"));
  assert.ok(!inputs.some((input) => /(?:^|\/)(?:ws|framework-server)(?:\/|$)/.test(input)), inputs.join("\n"));
});

test("package.json exports exactly the public subpaths", async () => {
  const manifest = JSON.parse(await readFile(resolve("package.json"), "utf8")) as { exports: Record<string, unknown> };
  assert.deepEqual(Object.keys(manifest.exports), [
    ".", "./vite", "./framework", "./server", "./node", "./password", "./bun", "./deno", "./cloudflare",
    "./build", "./prettier", "./postcss", "./internal", "./devtools-ui",
  ]);
});

test("runtime entries never load the build-time PostCSS plugin", async () => {
  const runtimeEntries = ["index", "framework", "framework-server", "node", "bun", "deno", "cloudflare", "internal"];
  const result = await build({
    entryPoints: runtimeEntries.map((entry) => resolve(`dist/${entry}.js`)),
    bundle: true,
    format: "esm",
    platform: "node",
    packages: "external",
    write: false,
    metafile: true,
    outdir: "out",
  });
  const inputs = Object.keys(result.metafile.inputs).map((input) => input.replaceAll("\\", "/"));
  assert.ok(!inputs.some((input) => /(?:^|\/)dist\/postcss(?:\/|\.js$)/.test(input)), inputs.join("\n"));
  const postcssEntry = await import(pathToFileURL(resolve("dist/postcss.js")).href);
  assert.deepEqual(Object.keys(postcssEntry).sort(), ["default", "defineUtilities", "meekoUtilities"]);
});

test("the root entry exposes only the documented public runtime", async () => {
  const root = await import(pathToFileURL(resolve("dist/index.js")).href);
  assert.deepEqual(Object.keys(root).sort(), [
    "batch", "computed", "createContext", "createRoot", "effect", "inject",
    "onCleanup", "onMounted", "provide", "provideErrorHandler", "serializeJson", "signal", "trustHtml", "untrack",
  ]);
});

test("importing the Node entry does not load the optional ws transport", () => {
  const script = `import { createRequire } from "node:module";
    const require = createRequire(import.meta.url);
    await import("./dist/node.js");
    if (require.cache[require.resolve("ws")]) process.exit(1);`;
  const result = spawnSync(process.execPath, ["--input-type=module", "-e", script], {
    cwd: resolve("."), encoding: "utf8",
  });
  assert.equal(result.status, 0, result.stderr || result.stdout);
});

test("published entry source maps carry their sources without local absolute paths", async () => {
  for (const entry of ["index", "framework", "framework-server", "node", "build"]) {
    const output = await readFile(resolve(`dist/${entry}.js`), "utf8");
    assert.match(output, new RegExp(`sourceMappingURL=${entry}\\.js\\.map`));
    const map = JSON.parse(await readFile(resolve(`dist/${entry}.js.map`), "utf8")) as {
      sources: string[]; sourcesContent: Array<string | null>;
    };
    assert.equal(map.sources.length, map.sourcesContent.length);
    assert.ok(map.sourcesContent.every((source) => typeof source === "string"));
    assert.ok(map.sources.every((source) => !/^(?:[A-Za-z]:|\/)/.test(source)), map.sources.join("\n"));
  }
});

test("a component without the framework leaves the theme, the router state and <MeekoThemeToggle> out of its bundle", async () => {
  // A compiled component imports `@meekojs/meeko/internal`, which also re-exports Meeko's own components.
  const { compile } = await import(pathToFileURL(resolve("dist/compiler.js")).href) as typeof import("../src/compiler.ts");
  const component = compile(`<script lang="ts">\nimport { signal } from "@meekojs/meeko";\nconst count = signal(0);\n</script>\n<template><button on:click="() => count.value++">{count.value}</button></template>\n`, resolve("Counter.meeko")).code;
  const result = await build({
    stdin: { contents: component, loader: "ts", resolveDir: resolve("."), sourcefile: "Counter.ts" },
    bundle: true,
    format: "esm",
    platform: "browser",
    minify: true,
    write: false,
    metafile: true,
    outfile: "out.js",
    alias: { "@meekojs/meeko/internal": resolve("dist/internal.js"), "@meekojs/meeko": resolve("dist/index.js") },
  });
  const code = result.outputFiles[0]!.text;
  for (const marker of ["Meeko theme", "Meeko route", "Meeko navigation", "Meeko framework state", "Meeko browser window", "Meeko head", "data-meeko-theme-icon", "/_meeko/theme"]) {
    assert.ok(!code.includes(marker), `${marker} reached the bundle`);
  }
  const output = Object.values(result.metafile.outputs)[0]!;
  for (const module of ["navigation", "state", "storage", "theme-toggle.compiled"]) {
    const input = Object.entries(output.inputs).find(([path]) => path.replaceAll("\\", "/").endsWith(`dist/framework/${module}.js`));
    assert.equal(input?.[1].bytesInOutput ?? 0, 0, `dist/framework/${module}.js reached the bundle`);
  }
});
