import assert from "node:assert/strict";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import test from "node:test";
import { clientMiddlewareSource, discoverAppManifest } from "../src/framework/app-manifest.ts";
import { checkFrameworkProject } from "../src/framework/check-project.ts";
import { discoverConfiguredRoutes } from "../src/framework/config.ts";
import { isRouteOptionsSource, routeOptionsKey } from "../src/framework/dev-watch.ts";
import { generateRoutes } from "../src/framework/generate.ts";
import { composeFrameworkRoutes } from "../src/framework/modules.ts";
import { discoverRouteMiddleware, extractRouteMiddlewareOptions } from "../src/framework/route-middleware-discovery.ts";
import { discoverRoutes, extractGroupOptions, extractRouteOptions } from "../src/framework/routes-discovery.ts";
import type { RouteRecord } from "../src/framework/router.ts";
import { tempProject } from "./helpers/temp-project.ts";

async function put(root: string, path: string, source: string): Promise<void> {
  const file = join(root, path);
  await mkdir(dirname(file), { recursive: true });
  await writeFile(file, source);
}

const global = "export default defineRouteMiddleware(() => undefined);\n";
const named = "export default defineRouteMiddleware(() => undefined, { global: false });\n";
const page = (name: string): string => `<template><p>${name}</p></template>\n`;
const withMiddleware = (value: string, name = "p"): string => `<script server lang="ts">
export const route = definePage({ middleware: ${value} });
</script>
<template><p>${name}</p></template>
`;

/** The named middleware of each route, as paths relative to `root`. */
function middlewareOf(root: string, routes: readonly RouteRecord[]): Record<string, string[]> {
  const relative = (file: string): string => file.slice(root.length + 1).replaceAll("\\", "/");
  return Object.fromEntries(routes.map((route) => [route.id, (route.middleware ?? []).map(relative)]));
}

const file = "/project/app/middleware/auth.ts";

test("{ global } of defineRouteMiddleware is read without running the file", () => {
  assert.deepEqual(extractRouteMiddlewareOptions(file, global), { global: true });
  assert.deepEqual(extractRouteMiddlewareOptions(file, named), { global: false });
  assert.deepEqual(extractRouteMiddlewareOptions(file, "export default defineRouteMiddleware(() => undefined, { global: true });\n"), { global: true });
  // An import, an alias, a constant, `as const` and `export { x as default }` are read too.
  assert.deepEqual(extractRouteMiddlewareOptions(file, 'import { defineRouteMiddleware as guard } from "@meekojs/meeko/framework";\nexport default guard(() => undefined, { global: false } as const);\n'), { global: false });
  assert.deepEqual(extractRouteMiddlewareOptions(file, "const options = { global: false };\nconst auth = defineRouteMiddleware(() => undefined, options);\nexport { auth as default };\n"), { global: false });
  assert.deepEqual(extractRouteMiddlewareOptions(file, 'import * as meeko from "@meekojs/meeko/framework";\nexport default meeko.defineRouteMiddleware(() => undefined, { global: false });\n'), { global: false });
  // Without defineRouteMiddleware or its options, a middleware stays global, as before 1.6.
  assert.deepEqual(extractRouteMiddlewareOptions(file, "export default function guard() {}\n"), { global: true });
  assert.deepEqual(extractRouteMiddlewareOptions(file, "export default (() => undefined);\n"), { global: true });
  assert.deepEqual(extractRouteMiddlewareOptions(file, 'export { default } from "./other";\n'), { global: true });
  assert.throws(() => extractRouteMiddlewareOptions(file, "const global = false;\nexport default defineRouteMiddleware(() => undefined, { global });\n"),
    /auth\.ts: las opciones de defineRouteMiddleware deben ser un objeto literal/);
  assert.throws(() => extractRouteMiddlewareOptions(file, "export default defineRouteMiddleware(() => undefined, makeOptions());\n"), /deben ser un objeto literal/);
  assert.throws(() => extractRouteMiddlewareOptions(file, "export default defineRouteMiddleware(() => undefined, { ...base });\n"), /deben ser un objeto literal/);
  assert.throws(() => extractRouteMiddlewareOptions(file, "export default defineRouteMiddleware(() => undefined, { global: !true });\n"), /auth\.ts: global debe ser el literal true o false/);
  assert.throws(() => extractRouteMiddlewareOptions(file, "export default defineRouteMiddleware(() => undefined, { name: \"x\" });\n"), /opción de middleware desconocida "name"/);
});

test("named middleware takes the file name without its order prefix; duplicates and invalid names fail", async (context) => {
  const root = await tempProject(context, "named-middleware-names");
  await put(root, "app/middleware/10-locale.ts", global);
  await put(root, "app/middleware/20-auth.ts", named);
  await put(root, "app/middleware/admin.ts", named);
  await put(root, "app/middleware/team/05_role.ts", named);
  await put(root, "app/middleware/2fa.ts", named);
  await put(root, "app/middleware/helper.client.ts", named);
  await put(root, "app/middleware/auth.test.ts", named);
  // Two global files with the same name never meet a route by name: as before 1.6.
  await put(root, "app/middleware/30-locale.ts", global);
  const discovered = await discoverRouteMiddleware(root);
  const relative = (path: string): string => path.slice(root.length + 1).replaceAll("\\", "/");
  assert.deepEqual(discovered.global.map(relative), ["app/middleware/10-locale.ts", "app/middleware/30-locale.ts"]);
  assert.deepEqual(Object.fromEntries(Object.entries(discovered.named).map(([name, path]) => [name, relative(path)])), {
    "2fa": "app/middleware/2fa.ts",
    admin: "app/middleware/admin.ts",
    auth: "app/middleware/20-auth.ts",
    "team/role": "app/middleware/team/05_role.ts",
  });
  await put(root, "app/middleware/auth.ts", global);
  await assert.rejects(discoverRouteMiddleware(root), /20-auth\.ts y .*auth\.ts declaran el mismo middleware "auth"/);
  await put(root, "app/middleware/auth.ts", named);
  await assert.rejects(discoverRouteMiddleware(root), /declaran el mismo middleware "auth"/);
  await rm(join(root, "app/middleware/auth.ts"));
  await put(root, "app/middleware/my guard.ts", named);
  await assert.rejects(discoverRouteMiddleware(root), /my guard\.ts: "my guard" no es un nombre de middleware válido/);
});

test("middleware of definePage and +group.ts is an array literal of names or false", () => {
  const sidecar = "/project/app/pages/index.route.ts";
  assert.deepEqual(extractRouteOptions(sidecar, 'export const route = definePage({ middleware: ["auth", `admin`], render: "ssr" });\n'), { render: "ssr", middleware: ["auth", "admin"] });
  assert.deepEqual(extractRouteOptions(sidecar, "export const route = definePage({ middleware: false });\n"), { middleware: false });
  assert.deepEqual(extractRouteOptions(sidecar, 'export const route = definePage({ middleware: ["team/role"] as const });\n'), { middleware: ["team/role"] });
  assert.throws(() => extractRouteOptions(sidecar, 'const guards = ["auth"];\nexport const route = definePage({ middleware: guards });\n'),
    /index\.route\.ts: middleware debe ser un array literal de nombres de app\/middleware, o false/);
  assert.throws(() => extractRouteOptions(sidecar, 'const name = "auth";\nexport const route = definePage({ middleware: [name] });\n'), /middleware debe ser un array literal/);
  assert.throws(() => extractRouteOptions(sidecar, "export const route = definePage({ middleware: true } as never);\n"), /middleware debe ser un array literal/);
  assert.throws(() => extractRouteOptions(sidecar, 'export const route = definePage({ middleware: ["../auth"] } as never);\n'), /"\.\.\/auth" no es un nombre de middleware válido/);
  const group = "/project/app/pages/(dashboard)/+group.ts";
  assert.deepEqual(extractGroupOptions(group, 'export default defineGroup({ layout: "dashboard", middleware: ["auth"] });\n'), { layout: "dashboard", middleware: ["auth"] });
  assert.deepEqual(extractGroupOptions(group, "export default defineGroup({ middleware: false });\n"), { middleware: false });
  assert.throws(() => extractGroupOptions(group, "export default defineGroup({ middleware: guards });\n"), /\+group\.ts: middleware debe ser un array literal/);
  assert.throws(() => extractGroupOptions(group, 'export default defineGroup({ title: "x" });\n'), /un \+group\.ts admite layout, layoutProps y middleware/);
});

test("a spread in the route options that may carry middleware needs an explicit middleware after it", () => {
  const sidecar = "/project/app/pages/panel.route.ts";
  // The review's case: the build would not see "auth" and the page would be served without it.
  const spreadError = /panel\.route\.ts: el spread protegida puede llevar middleware, que Meeko no lee durante el build y la ruta se serviría sin él; declara middleware de forma explícita después del último spread/;
  assert.throws(() => extractRouteOptions(sidecar, 'const protegida = { middleware: ["auth"] } as const;\nexport const route = definePage({ ...protegida, render: "ssr", load: () => ({}) });\n'), spreadError);
  // An import or any other value may set it too.
  assert.throws(() => extractRouteOptions(sidecar, 'import { protegida } from "./shared";\nexport const route = definePage({ ...protegida, render: "ssr" });\n'), spreadError);
  assert.throws(() => extractRouteOptions(sidecar, 'const base = { ...protegida };\nexport const route = definePage({ ...base, render: "ssr" });\n'), /el spread base puede llevar middleware/);
  assert.throws(() => extractRouteOptions(sidecar, 'export const route = definePage({ middleware: ["auth"], ...protegida, render: "ssr" });\n'), spreadError);
  // Declared after the last spread, the explicit value is the one that counts.
  assert.deepEqual(extractRouteOptions(sidecar, 'import { protegida } from "./shared";\nexport const route = definePage({ ...protegida, render: "ssr", middleware: ["auth"] });\n'), { render: "ssr", middleware: ["auth"] });
  assert.deepEqual(extractRouteOptions(sidecar, 'import { shared } from "./shared";\nexport const route = definePage({ ...shared, middleware: [], render: "ssr" });\n'), { render: "ssr", middleware: [] });
  // A spread of a const of the same file without middleware stays valid, as in 1.5.
  assert.deepEqual(extractRouteOptions(sidecar, 'const common = { params: undefined, head: () => ({ title: "x" }) };\nexport const route = definePage({ ...common, render: "ssr" });\n'), { render: "ssr" });
  // A +group.ts does not admit spreads at all.
  assert.throws(() => extractGroupOptions("/project/app/pages/(dashboard)/+group.ts", 'const protegida = { middleware: ["auth"] };\nexport default defineGroup({ ...protegida });\n'), /sin spread/);
});

test("routes inherit named middleware from outer to inner groups and the page, without repeats; false drops it", async (context) => {
  const root = await tempProject(context, "named-middleware-routes");
  await put(root, "app/middleware/10-locale.ts", global);
  await put(root, "app/middleware/20-auth.ts", named);
  await put(root, "app/middleware/admin.ts", named);
  await put(root, "app/middleware/audit.ts", named);
  await put(root, "app/pages/index.meeko", page("home"));
  await put(root, "app/pages/login.meeko", withMiddleware("[]"));
  await put(root, "app/pages/(dashboard)/+group.ts", 'export default defineGroup({ middleware: ["auth"] });\n');
  await put(root, "app/pages/(dashboard)/connections.meeko", page("connections"));
  await put(root, "app/pages/(dashboard)/admin/+group.ts", 'export default defineGroup({ middleware: ["admin", "auth"] });\n');
  await put(root, "app/pages/(dashboard)/admin/users.meeko", withMiddleware('["audit", "admin"]'));
  await put(root, "app/pages/(dashboard)/admin/sidecar.meeko", page("sidecar"));
  await put(root, "app/pages/(dashboard)/admin/sidecar.route.ts", 'export const route = definePage({ middleware: ["audit"] });\n');
  await put(root, "app/pages/(dashboard)/public.meeko", withMiddleware("false"));
  await put(root, "app/pages/(dashboard)/open/+group.ts", "export default defineGroup({ middleware: false });\n");
  await put(root, "app/pages/(dashboard)/open/index.meeko", page("open"));
  await put(root, "app/pages/(dashboard)/open/audited.meeko", withMiddleware('["audit"]'));
  const routes = await discoverRoutes(root);
  assert.deepEqual(middlewareOf(root, routes), {
    "/": [],
    "/admin/sidecar": ["app/middleware/20-auth.ts", "app/middleware/admin.ts", "app/middleware/audit.ts"],
    "/admin/users": ["app/middleware/20-auth.ts", "app/middleware/admin.ts", "app/middleware/audit.ts"],
    "/connections": ["app/middleware/20-auth.ts"],
    "/login": [],
    "/open": [],
    "/open/audited": ["app/middleware/audit.ts"],
    "/public": [],
  });
  // A route without named middleware has no field: the 1.5 manifest is unchanged.
  assert.equal(Object.hasOwn(routes.find((route) => route.id === "/")!, "middleware"), false);

  // The app manifest keeps the global middleware apart; each route lists its own module keys.
  const { manifest, modules } = await discoverAppManifest(root, { entry: "/client.js", css: [], preload: [] });
  assert.deepEqual(manifest.routeMiddleware, ["/app/middleware/10-locale.ts"]);
  assert.deepEqual(manifest.routes.find((route) => route.id === "/connections")?.middleware, ["/app/middleware/20-auth.ts"]);
  for (const key of ["/app/middleware/10-locale.ts", "/app/middleware/20-auth.ts", "/app/middleware/admin.ts", "/app/middleware/audit.ts"]) assert.ok(modules.includes(key), key);

  // The browser imports the global middleware with the entry and each named one lazily.
  const source = await clientMiddlewareSource(root);
  assert.match(source, /import \* as middleware0 from "\/app\/middleware\/10-locale\.ts";/);
  assert.match(source, /export const middleware = \[\["\/app\/middleware\/10-locale\.ts", middleware0\]\];/);
  assert.match(source, /"\/app\/middleware\/20-auth\.ts": \(\) => import\("\/app\/middleware\/20-auth\.ts"\)/);
  assert.doesNotMatch(source, /import \* as \w+ from "\/app\/middleware\/(?:20-auth|admin|audit)\.ts"/);
  // A named middleware that no route uses stays out of the bundle.
  await put(root, "app/middleware/unused.ts", named);
  assert.doesNotMatch(await clientMiddlewareSource(root), /unused/);

  // The generated types and the portable manifest.
  await generateRoutes(root);
  const declarations = await readFile(join(root, ".meeko", "types", "routes.d.ts"), "utf8");
  assert.match(declarations, /interface GeneratedRouteMiddleware \{\n {4}"admin": "app\/middleware\/admin\.ts";\n {4}"audit": "app\/middleware\/audit\.ts";\n {4}"auth": "app\/middleware\/20-auth\.ts";\n {4}"unused": "app\/middleware\/unused\.ts";\n {2}\}/);
  assert.doesNotMatch(declarations, /"locale"/);
  const portable = JSON.parse(await readFile(join(root, ".meeko", "manifests", "routes.json"), "utf8")) as { routes: RouteRecord[] };
  assert.deepEqual(portable.routes.find((route) => route.id === "/connections")?.middleware, ["app/middleware/20-auth.ts"]);
});

test("an unknown or global middleware name stops discovery with the file", async (context) => {
  const root = await tempProject(context, "named-middleware-errors");
  await put(root, "app/middleware/10-locale.ts", global);
  await put(root, "app/middleware/auth.ts", named);
  await put(root, "app/middleware/admin.ts", named);
  await put(root, "app/pages/index.meeko", withMiddleware('["nowhere"]'));
  await assert.rejects(discoverRoutes(root),
    /index\.meeko: el middleware "nowhere" no existe; crea app\/middleware\/nowhere\.ts con defineRouteMiddleware\(\.\.\., \{ global: false \}\) \(middleware con nombre disponibles: "admin", "auth"\)/);
  await put(root, "app/pages/index.meeko", withMiddleware('["locale"]'));
  await assert.rejects(discoverRoutes(root), /index\.meeko: el middleware "locale" \(.*10-locale\.ts\) es global y ya se ejecuta en todas las rutas/);
  await put(root, "app/pages/index.meeko", page("home"));
  // A +group.ts without pages still names middleware that exists.
  await put(root, "app/pages/empty/+group.ts", 'export default defineGroup({ middleware: ["ghost"] });\n');
  await assert.rejects(discoverRoutes(root), /empty[\\/]\+group\.ts: el middleware "ghost" no existe/);
  // meeko check stops on it before checking types.
  await assert.rejects(checkFrameworkProject(root), /el middleware "ghost" no existe/);
  await put(root, "app/pages/empty/+group.ts", 'export default defineGroup({ middleware: ["auth"] });\n');
  assert.equal((await discoverRoutes(root)).length, 1);
});

test("layer pages use the named middleware of the project", async (context) => {
  const root = await tempProject(context, "named-middleware-layers");
  const layer = join(root, "layers", "base");
  await put(root, "app/middleware/auth.ts", named);
  await put(root, "app/pages/index.meeko", page("home"));
  await put(layer, "app/pages/(account)/+group.ts", 'export default defineGroup({ middleware: ["auth"] });\n');
  await put(layer, "app/pages/(account)/account.meeko", page("account"));
  // A layer's own app/middleware is not discovered, as before 1.6.
  await put(layer, "app/middleware/layer.ts", named);
  const routes = await composeFrameworkRoutes({ projectRoot: root, layers: [{ name: "base", root: layer }] });
  assert.deepEqual(middlewareOf(root, routes), { "/": [], "/account": ["app/middleware/auth.ts"] });
  await put(layer, "app/pages/(account)/+group.ts", 'export default defineGroup({ middleware: ["layer"] });\n');
  await assert.rejects(composeFrameworkRoutes({ projectRoot: root, layers: [{ name: "base", root: layer }] }), /el middleware "layer" no existe/);
});

test("the routes of a programmatic module run the project's global server route middleware", async (context) => {
  const root = await tempProject(context, "server-middleware-module-routes");
  await put(root, "app/middleware/session.server.ts", "export default defineServerRouteMiddleware(() => undefined);\n");
  await put(root, "app/pages/index.meeko", page("home"));
  const routes = await composeFrameworkRoutes({ projectRoot: root, modules: [{ name: "docs", routes: () => [
    { id: "/health", file: "/srv/health.meeko", layouts: [] },
    { id: "/docs", file: "/srv/docs.meeko", layouts: [], render: "prerender" },
  ] }] });
  const server = (id: string): string[] => (routes.find((route) => route.id === id)?.serverMiddleware ?? []).map((file) => file.slice(root.length + 1).replaceAll("\\", "/"));
  assert.deepEqual(server("/"), ["app/middleware/session.server.ts"]);
  assert.deepEqual(server("/health"), ["app/middleware/session.server.ts"]);
  assert.deepEqual(server("/docs"), []);
});

test("meeko dev rebuilds the app when a middleware changes { global } or a route its middleware", async (context) => {
  const root = await tempProject(context, "named-middleware-dev-watch");
  assert.equal(isRouteOptionsSource(join(root, "app", "middleware", "auth.ts"), [root]), true);
  assert.equal(isRouteOptionsSource(join(root, "app", "middleware", "notes.md"), [root]), false);
  await put(root, "app/middleware/auth.ts", named);
  await put(root, "app/pages/(dashboard)/+group.ts", 'export default defineGroup({ middleware: ["auth"] });\n');
  await put(root, "app/pages/(dashboard)/panel.meeko", page("panel"));
  await put(root, "app/pages/index.meeko", page("home"));
  const key = async (): Promise<string> => routeOptionsKey(await discoverConfiguredRoutes(root), (await discoverRouteMiddleware(root)).global);
  const before = await key();
  await put(root, "app/pages/(dashboard)/+group.ts", "export default defineGroup({});\n");
  const withoutGuard = await key();
  assert.notEqual(withoutGuard, before);
  // An unused middleware that becomes global changes what every route runs.
  await put(root, "app/middleware/auth.ts", global);
  assert.notEqual(await key(), withoutGuard);
});
