import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import test from "node:test";
import { composeFrameworkRoutes } from "../src/framework/modules.ts";

async function page(root: string, path: string): Promise<void> {
  const filename = join(root, "app/pages", path);
  await mkdir(dirname(filename), { recursive: true });
  await writeFile(filename, "<template><p>Route</p></template>");
}

test("explicit app, layer and module routes compose without overrides", async () => {
  const root = await mkdtemp(join(tmpdir(), "meeko-layers-"));
  const app = join(root, "app");
  const layer = join(root, "layer");
  try {
    await page(app, "index.meeko");
    await page(layer, "help.meeko");
    const routes = await composeFrameworkRoutes({
      projectRoot: app,
      layers: [{ name: "help", root: layer }],
      modules: [{
        name: "account",
        routes: () => [{ id: "/account", file: "virtual:account", layouts: [] }],
      }],
    });
    assert.deepEqual(new Set(routes.map((route) => route.id)), new Set(["/", "/help", "/account"]));
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("layer collisions and duplicate source identifiers fail visibly", async () => {
  const root = await mkdtemp(join(tmpdir(), "meeko-layers-"));
  const app = join(root, "app");
  const layer = join(root, "layer");
  try {
    await page(app, "users/[id].meeko");
    await page(layer, "users/[name].meeko");
    await assert.rejects(composeFrameworkRoutes({
      projectRoot: app,
      layers: [{ name: "users", root: layer }],
    }), /Route collision/);
    await assert.rejects(composeFrameworkRoutes({
      projectRoot: app,
      layers: [{ name: "same", root: layer }, { name: "same", root: layer }],
    }), /duplicate route source name/);
    await assert.rejects(composeFrameworkRoutes({
      projectRoot: app,
      layers: [{ name: "same", root: app }],
    }), /Duplicate route root/);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
