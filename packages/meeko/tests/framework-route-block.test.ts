import assert from "node:assert/strict";
import { mkdtemp, mkdir, rm, symlink, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import test from "node:test";
import { compile } from "../src/compiler.ts";
import { MeekoCompileError, parseSfc } from "../src/compiler/sfc.ts";
import { checkApp } from "../src/framework/check-app.ts";
import { checkFrameworkProject } from "../src/framework/check-project.ts";
import { routeBlockFile, routeBlockId, routeBlockSource } from "../src/framework/route-block.ts";
import { discoverRoutes } from "../src/framework/routes-discovery.ts";
import { meeko } from "../src/vite.ts";

const page = (server: string, script = "export interface Props { params: Record<string, string> }\nconst props = defineProps<Props>();") => [
  '<script server lang="ts">',
  server,
  "</script>",
  "",
  '<script lang="ts">',
  script,
  "</script>",
  "<template><p>Page</p></template>",
  "",
].join("\n");

async function project(files: Record<string, string>): Promise<string> {
  const parent = resolve(".meeko");
  await mkdir(parent, { recursive: true });
  const root = await mkdtemp(join(parent, "route-block-"));
  await writeFile(join(root, "package.json"), '{"private":true,"type":"module"}\n');
  await mkdir(join(root, "node_modules", "@meekojs"), { recursive: true });
  await symlink(resolve("."), join(root, "node_modules", "@meekojs", "meeko"), "junction");
  for (const [path, content] of Object.entries(files)) {
    await mkdir(join(root, path, ".."), { recursive: true });
    await writeFile(join(root, path), content);
  }
  return root;
}

function compileCode(error: unknown): string | undefined {
  return error instanceof MeekoCompileError ? error.diagnostic.code : undefined;
}

test("parseSfc separates <script server> from the component script and validates it", () => {
  const source = page('export const route = definePage({ render: "prerender" });');
  const document = parseSfc(source, "index.meeko");
  assert.equal(document.server?.name, "server");
  assert.match(document.server!.content, /render: "prerender"/);
  assert.match(document.script.content, /defineProps/);
  assert.throws(() => parseSfc(`${page("")}<script server lang="ts"></script>`, "x.meeko"), (error) => compileCode(error) === "MEEK004");
  assert.throws(() => parseSfc(page("").replace('<script server lang="ts">', "<script server>"), "x.meeko"), (error) => compileCode(error) === "MEEK006");
  assert.throws(() => parseSfc(page("").replace("<script server", '<script server="yes"'), "x.meeko"), (error) => compileCode(error) === "MEEK043");
});

test("the compiled component never contains the <script server> block", () => {
  const source = page('import { secret } from "../../server/secret.js";\nexport const route = definePage({ load: () => secret });');
  const { code } = compile(source, "/project/app/pages/index.meeko");
  assert.doesNotMatch(code, /secret|definePage/);
});

test("routeBlockSource keeps every offset of the .meeko file", () => {
  const source = page("export const route = definePage({});").replaceAll("\n", "\r\n");
  const block = routeBlockSource(source, "index.meeko")!;
  const offset = source.indexOf("definePage");
  assert.equal(block.indexOf("definePage"), offset);
  assert.equal(block.split("\r\n").length, source.slice(0, block.length).split("\r\n").length);
  assert.equal(routeBlockSource('<script lang="ts"></script><template></template>', "plain.meeko"), undefined);
  assert.equal(routeBlockFile(routeBlockId("/p/app/pages/a.meeko")), "/p/app/pages/a.meeko");
  assert.equal(routeBlockFile("/p/app/pages/a.route.ts"), undefined);
});

test("route discovery reads options from <script server> and rejects ambiguous declarations", async () => {
  const root = await project({
    "app/pages/index.meeko": page('export const route = definePage({ render: "prerender" });'),
    "app/pages/plain.meeko": '<script lang="ts">\nconst x = 1;\n</script>\n<template><p>{x}</p></template>\n',
  });
  try {
    const routes = await discoverRoutes(root);
    const index = routes.find((route) => route.id === "/")!;
    assert.equal(index.sidecar, routeBlockId(join(root, "app", "pages", "index.meeko")));
    assert.equal(index.render, "prerender");
    assert.equal(routes.find((route) => route.id === "/plain")!.sidecar, undefined);

    await writeFile(join(root, "app", "pages", "index.route.ts"), "export const route = {};\n");
    await assert.rejects(discoverRoutes(root), /las opciones de ruta están declaradas dos veces/);
    await rm(join(root, "app", "pages", "index.route.ts"));

    await writeFile(join(root, "app", "pages", "+error.meeko"), page("export const route = {};"));
    await assert.rejects(discoverRoutes(root), /sólo se admite en las páginas/);
    await rm(join(root, "app", "pages", "+error.meeko"));

    await writeFile(join(root, "app", "pages", "index.meeko"), page("const mode = pick();\nexport const route = definePage({ render: mode });"));
    await assert.rejects(discoverRoutes(root), /index\.meeko: render debe ser un literal de texto/);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("meeko check rejects <script server> in components and checks the block in the server scope", async () => {
  const root = await project({
    "app/pages/index.meeko": page(
      'import { definePage } from "@meekojs/meeko/framework";\nexport const route = definePage({ load: () => ({ name: "Ada" }) });',
      "export interface Props { params: Record<string, string>; data: { name: string } }\nconst props = defineProps<Props>();",
    ),
    "app/components/Card.meeko": page("export const route = {};"),
  });
  try {
    const diagnostics = await checkApp(root);
    assert.deepEqual(diagnostics.map((diagnostic) => [diagnostic.code, diagnostic.filename.endsWith("Card.meeko")]), [["MEEK044", true]]);
    await rm(join(root, "app", "components"), { recursive: true });
    await checkFrameworkProject(root);

    // A type error inside the block is reported on the page, at its own line.
    await writeFile(join(root, "app", "pages", "index.meeko"), page(
      'import { definePage } from "@meekojs/meeko/framework";\nconst count: number = "many";\nexport const route = definePage({ load: () => ({ name: "Ada", count }) });',
      "export interface Props { params: Record<string, string>; data: { name: string } }\nconst props = defineProps<Props>();",
    ));
    await assert.rejects(checkFrameworkProject(root), (error: unknown) => {
      assert.ok(error instanceof Error);
      assert.match(error.message, /app[\\/]pages[\\/]index\.meeko\(3,7\): error TS2322/);
      assert.doesNotMatch(error.message, /\.meeko[\\/]routes[\\/]/);
      return true;
    });

    // The page contract compares the props with the block's loader data.
    await writeFile(join(root, "app", "pages", "index.meeko"), page(
      'import { definePage } from "@meekojs/meeko/framework";\nexport const route = definePage({ load: () => ({ name: 42 }) });',
      "export interface Props { params: Record<string, string>; data: { name: string } }\nconst props = defineProps<Props>();",
    ));
    await assert.rejects(checkFrameworkProject(root), /index\.meeko <script server>/);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("the Vite plugin serves a server block only to SSR unless its route renders in the browser", async () => {
  const root = await project({
    "app/pages/index.meeko": page('export const route = definePage({ load: () => "private" });'),
    "app/pages/notes.meeko": page('export const route = definePage({ render: "client" });'),
  });
  try {
    const plugin = meeko();
    (plugin.configResolved as (config: unknown) => void)({ command: "build", build: { ssr: false }, root });
    const load = plugin.load as (this: unknown, id: string, options?: { ssr?: boolean }) => Promise<string | null>;
    const context = { addWatchFile() {} };
    const server = routeBlockId(join(root, "app", "pages", "index.meeko"));
    assert.match((await load.call(context, server, { ssr: true }))!, /"private"/);
    await assert.rejects(load.call(context, server, { ssr: false }), /Server route options reached the client bundle/);
    assert.match((await load.call(context, routeBlockId(join(root, "app", "pages", "notes.meeko")), { ssr: false }))!, /render: "client"/);
    await assert.rejects(load.call(context, routeBlockId(join(root, "package.json")), { ssr: true }), /only be loaded from a page/);

    // The component's source map embeds the .meeko text without the block.
    const transform = plugin.transform as (this: unknown, code: string, id: string, options?: { ssr?: boolean }) => Promise<{ code: string; map: { sourcesContent?: (string | null)[] } }>;
    const file = join(root, "app", "pages", "index.meeko");
    const result = await transform.call({ resolve: async () => null }, page('const secret = "s3cr3t";\nexport const route = definePage({ load: () => secret });'), file, { ssr: false });
    assert.doesNotMatch(result.code, /s3cr3t/);
    assert.doesNotMatch(JSON.stringify(result.map), /s3cr3t|definePage/);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
