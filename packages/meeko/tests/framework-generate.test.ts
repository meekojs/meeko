import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import test from "node:test";
import { promisify } from "node:util";
import { generateRoutes } from "../src/framework/generate.ts";

const execFileAsync = promisify(execFile);

test("routes command emits typed IDs and portable manifest under .meeko", async () => {
  await mkdir(resolve(".meeko"), { recursive: true });
  const root = await mkdtemp(resolve(".meeko/routes-test-"));
  const pages = join(root, "app", "pages");
  try {
    for (const file of ["index.meeko", "(private)/+layout.meeko", "(private)/users/[id].meeko", "docs/[...slug].meeko"]) {
      const path = join(pages, file);
      await mkdir(resolve(path, ".."), { recursive: true });
      await writeFile(path, `<script lang="ts">const label = "ok";</script><template><p>{label}</p></template>`);
    }
    const generated = await generateRoutes(root);
    assert.equal(generated.count, 3);
    const declarations = await readFile(generated.types, "utf8");
    assert.match(declarations, /"\/": Record<never, never>/);
    assert.match(declarations, /"\/users\/\[id\]": \{ "id": string \}/);
    assert.match(declarations, /"\/docs\/\[\.\.\.slug\]": \{ "slug": string \}/);
    assert.match(declarations, /export type RouteId = "\/users\/\[id\]" \| "\/docs\/\[\.\.\.slug\]" \| "\/";/);
    const manifest = JSON.parse(await readFile(generated.manifest, "utf8")) as {
      version: number; routes: Array<{ id: string; file: string; layouts: string[] }>;
    };
    assert.equal(manifest.version, 1);
    assert.deepEqual(manifest.routes.map((route) => route.id).sort(), ["/", "/docs/[...slug]", "/users/[id]"]);
    assert.equal(manifest.routes.find((route) => route.id === "/users/[id]")?.layouts[0], "app/pages/(private)/+layout.meeko");
    assert.ok(manifest.routes.every((route) => route.file.startsWith("app/pages/") && !route.file.includes("\\")));
    const cli = await execFileAsync(process.execPath, [resolve("dist/cli.js"), "routes", root]);
    assert.match(cli.stdout, /\.meeko[\\/]types[\\/]routes\.d\.ts/);
    assert.match(cli.stdout, /\.meeko[\\/]manifests[\\/]routes\.json/);
    const consumer = join(root, "consumer.ts");
    await writeFile(consumer, `import { href } from "@meekojs/meeko/framework";
import type { MeekoLinkProps, RouteState } from "@meekojs/meeko/framework";
const routes = [] as const;
href(routes, "/");
href(routes, "/users/[id]", { params: { id: "123" } });
href(routes, "/docs/[...slug]", { params: { slug: "a/b" } });
// @ts-expect-error dynamic route requires params
href(routes, "/users/[id]");
// @ts-expect-error unknown route ID
href(routes, "/missing");
const short: string = href("/users/[id]", { params: { id: "123" } });
href("/");
href("/", { search: { page: 2 } });
href("/docs/[...slug]", { params: { slug: "a/b" } });
// @ts-expect-error dynamic route requires params
href("/users/[id]");
// @ts-expect-error static route rejects params
href("/", { params: { id: "x" } });
// @ts-expect-error unknown route ID
href("/missing");
// @ts-expect-error unknown parameter
href("/users/[id]", { params: { slug: "x" } });
void short;
declare const route: RouteState;
const active: "page" | "true" | false = route.isActive("/", { prefix: true });
route.isActive("/users/[id]", { params: { id: "1" }, prefix: true });
// @ts-expect-error dynamic route requires params
route.isActive("/users/[id]");
// @ts-expect-error unknown route ID
route.isActive("/missing");
// @ts-expect-error static route rejects params
route.isActive("/", { params: { id: "x" } });
const section: MeekoLinkProps<"/"> = { to: "/", match: "prefix" };
// @ts-expect-error match is "exact" or "prefix"
const partial: MeekoLinkProps<"/"> = { to: "/", match: "partial" };
void active; void section; void partial;
`);
    const config = join(root, "tsconfig.json");
    await writeFile(config, JSON.stringify({ compilerOptions: {
      noEmit: true, strict: true, skipLibCheck: true, module: "nodenext", moduleResolution: "nodenext",
      target: "es2022",
    }, files: [consumer, generated.types] }));
    await execFileAsync(process.execPath, [resolve("node_modules/typescript/bin/tsc"), "-p", config]);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("route generation fails for colliding URLs", async () => {
  await mkdir(resolve(".meeko"), { recursive: true });
  const root = await mkdtemp(resolve(".meeko/routes-collision-test-"));
  const pages = join(root, "app", "pages");
  try {
    await mkdir(pages, { recursive: true });
    await writeFile(join(pages, "[id].meeko"), "");
    await writeFile(join(pages, "[name].meeko"), "");
    await assert.rejects(generateRoutes(root), /Route collision/);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
