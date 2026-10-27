import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, rm, stat, symlink, utimes, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import test from "node:test";
import { discoverConfiguredRoutes, loadMeekoConfig, readMeekoConfigSync, resolveConfigSources } from "../src/framework/config.ts";
import { generateRoutes } from "../src/framework/generate.ts";

async function put(root: string, name: string, value: string): Promise<void> {
  const file = join(root, name);
  await mkdir(dirname(file), { recursive: true });
  await writeFile(file, value);
}

test("config composes app, layer and module pages into generated route types and manifest", async () => {
  const root = await mkdtemp(join(tmpdir(), "meeko-config-"));
  try {
    await put(root, "meeko.config.ts", `export default { extends: ["./layers/base"], modules: ["./modules/chat"], imports: { serverDirs: ["server/services"] } };`);
    await put(root, "app/pages/index.meeko", "<template>Home</template>");
    await put(root, "layers/base/app/pages/+layout.meeko", "<template>Layout</template>");
    await put(root, "layers/base/app/pages/layer-demo.meeko", "<template>Layer</template>");
    await put(root, "modules/chat/app/pages/chat.meeko", "<template>Chat</template>");
    assert.deepEqual((await loadMeekoConfig(root)).imports?.serverDirs, ["server/services"]);
    assert.deepEqual(readMeekoConfigSync(root).imports?.serverDirs, ["server/services"]);
    assert.deepEqual(readMeekoConfigSync(root).extends, ["./layers/base"]);
    assert.deepEqual(readMeekoConfigSync(root).modules, ["./modules/chat"]);
    const routes = await discoverConfiguredRoutes(root);
    assert.deepEqual(new Set(routes.map((route) => route.id)), new Set(["/", "/layer-demo", "/chat"]));
    assert.equal(routes.find((route) => route.id === "/layer-demo")?.layouts.length, 1);
    const generated = await generateRoutes(root);
    assert.equal(generated.count, 3);
    assert.match(await readFile(generated.types, "utf8"), /"\/layer-demo"/);
    assert.match(await readFile(generated.manifest, "utf8"), /layers\/base\/app\/pages\/layer-demo\.meeko/);
  } finally { await rm(root, { recursive: true, force: true }); }
});

test("config rejects colliding routes and source names with file paths", async () => {
  const root = await mkdtemp(join(tmpdir(), "meeko-config-"));
  try {
    await put(root, "meeko.config.mjs", `export default { extends: ["./layers/base"], modules: ["./modules/chat"] };`);
    await put(root, "app/pages/chat.meeko", "<template>App</template>");
    await put(root, "modules/chat/app/pages/chat.meeko", "<template>Module</template>");
    await put(root, "layers/base/app/pages/base.meeko", "<template>Layer</template>");
    await assert.rejects(discoverConfiguredRoutes(root), /Route collision:.*chat\.meeko/);
    await put(root, "meeko.config.mjs", `export default { extends: ["./layers/base"], modules: ["./modules/base"] };`);
    await put(root, "modules/base/app/pages/other.meeko", "<template>Other</template>");
    await assert.rejects(discoverConfiguredRoutes(root), /duplicate Meeko source name base/);
  } finally { await rm(root, { recursive: true, force: true }); }
});

test("configured layers cannot escape the project through a directory link", async () => {
  const root = await mkdtemp(join(tmpdir(), "meeko-config-"));
  const external = await mkdtemp(join(tmpdir(), "meeko-external-layer-"));
  try {
    await put(external, "app/pages/secret.meeko", "<template>External</template>");
    await mkdir(join(root, "layers"));
    await symlink(external, join(root, "layers", "external"), "junction");
    await assert.rejects(
      resolveConfigSources(root, { extends: ["./layers/external"] }),
      /escapes project root/,
    );
  } finally {
    await rm(root, { recursive: true, force: true });
    await rm(external, { recursive: true, force: true });
  }
});

test("loadMeekoConfig reads a rewrite that keeps the same mtime", async () => {
  // Two writes within one mtime tick, as a fast editor save or a test can make them.
  const root = await mkdtemp(join(tmpdir(), "meeko-config-reload-"));
  try {
    const file = join(root, "meeko.config.mjs");
    await writeFile(file, `export default { css: { scopeAttribute: "all" } };\n`);
    const { atime, mtime } = await stat(file);
    assert.equal((await loadMeekoConfig(root)).css?.scopeAttribute, "all");
    await writeFile(file, `export default { css: { scopeAttribute: "matched" } };\n`);
    await utimes(file, atime, mtime);
    assert.equal((await loadMeekoConfig(root)).css?.scopeAttribute, "matched");
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
