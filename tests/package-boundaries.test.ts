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

test("the root entry exposes only the documented public runtime", async () => {
  const root = await import(pathToFileURL(resolve("dist/index.js")).href);
  assert.deepEqual(Object.keys(root).sort(), [
    "batch", "computed", "createContext", "createRoot", "effect", "inject",
    "onCleanup", "provide", "provideErrorHandler", "serializeJson", "signal", "untrack",
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
