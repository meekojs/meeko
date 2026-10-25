import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { discoverRoutes, extractRouteRender } from "../src/framework/routes-discovery.ts";

const file = "/project/app/pages/index.route.ts";
const header = 'import { definePage } from "@meekojs/meeko/framework";\n';

test("render extraction reads literal render modes without executing the sidecar", () => {
  assert.equal(extractRouteRender(file, `${header}export const route = definePage({ render: "prerender" });\n`), "prerender");
  assert.equal(extractRouteRender(file, `${header}export const route = definePage({ render: \`ssr\` } as const);\n`), "ssr");
  assert.equal(extractRouteRender(file, `${header}export default definePage(({ "render": "prerender" }) satisfies object);\n`), "prerender");
  assert.equal(extractRouteRender(file, "export default { render: \"ssr\" };\n"), "ssr");
  assert.equal(extractRouteRender(file, "export const render = \"prerender\";\n"), "prerender");
  assert.equal(extractRouteRender(file, `${header}export const route = definePage({ load: () => ({}) });\n`), undefined);
  assert.equal(extractRouteRender(file, `${header}const base = { load: () => ({}) };\nexport const route = definePage({ ...base, render: "prerender" });\n`), "prerender");
});

test("render extraction follows options declared as a local const", () => {
  const source = `${header}const options = { render: "prerender", load: () => ({ name: "Ada" }) } as const;\nexport const route = definePage(options);\n`;
  assert.equal(extractRouteRender(file, source), "prerender");
  assert.equal(extractRouteRender(file, `${header}const options = { load: () => ({}) };\nexport const route = definePage(options);\n`), undefined);
});

test("render extraction rejects values it cannot read at build time", () => {
  assert.throws(() => extractRouteRender(file, `${header}const mode = "prerender";\nexport const route = definePage({ render: mode });\n`),
    /index\.route\.ts: render must be a string literal so Meeko can read it at build time/);
  assert.throws(() => extractRouteRender(file, `${header}export const route = definePage({ render: process.env.MODE as "ssr" });\n`),
    /render must be a string literal/);
  assert.throws(() => extractRouteRender(file, `${header}export const route = definePage({ render() { return "ssr"; } } as never);\n`),
    /render must be a string literal/);
  assert.throws(() => extractRouteRender(file, `${header}export const route = definePage({ render: "client" } as never);\n`),
    /unsupported render mode "client"; use "ssr" or "prerender"/);
  assert.throws(() => extractRouteRender(file, `${header}import { options } from "./options.js";\nexport const route = definePage(options);\n`),
    /export definePage\(\{ \.\.\. \}\) or an object literal so Meeko can read render at build time/);
  assert.throws(() => extractRouteRender(file, `${header}let options = { render: "ssr" as const };\nexport const route = definePage(options);\n`),
    /export definePage\(\{ \.\.\. \}\) or an object literal/);
  assert.throws(() => extractRouteRender(file, `${header}const base = { render: "prerender" as const };\nexport const route = definePage({ ...base });\n`),
    /declare render explicitly; spread route options cannot be read at build time/);
  assert.throws(() => extractRouteRender(file, "export { route } from \"./shared.route.js\";\n"),
    /re-exported route options cannot be read at build time/);
});

test("route discovery records the extracted render mode in the manifest", async () => {
  const root = await mkdtemp(join(tmpdir(), "meeko-render-extraction-"));
  try {
    await mkdir(join(root, "app", "pages", "docs"), { recursive: true });
    await writeFile(join(root, "app", "pages", "index.meeko"), "<template><p>Home</p></template>");
    await writeFile(join(root, "app", "pages", "index.route.ts"), `${header}export const route = definePage({ render: "prerender" });\n`);
    await writeFile(join(root, "app", "pages", "docs", "index.meeko"), "<template><p>Docs</p></template>");
    await writeFile(join(root, "app", "pages", "docs", "index.route.ts"), `${header}export const route = definePage({});\n`);
    const routes = await discoverRoutes(root);
    assert.equal(routes.find((route) => route.id === "/")?.render, "prerender");
    assert.equal(routes.find((route) => route.id === "/docs")?.render, undefined);
    await writeFile(join(root, "app", "pages", "docs", "index.route.ts"), `${header}const mode = "ssr" as const;\nexport const route = definePage({ render: mode });\n`);
    await assert.rejects(discoverRoutes(root), /docs[\\/]index\.route\.ts: render must be a string literal/);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
