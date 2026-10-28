import assert from "node:assert/strict";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import test from "node:test";
import { discoverConfiguredRoutes } from "../src/framework/config.ts";
import { isRouteOptionsSource, routeOptionsKey } from "../src/framework/dev-watch.ts";
import { generateRoutes } from "../src/framework/generate.ts";
import { discoverErrorPage, discoverLayouts, discoverRoutes, extractGroupOptions, extractRouteOptions } from "../src/framework/routes-discovery.ts";
import type { RouteRecord } from "../src/framework/router.ts";
import { linkRepositoryPackages, tempProject } from "./helpers/temp-project.ts";

async function put(root: string, path: string, source: string): Promise<void> {
  const file = join(root, path);
  await mkdir(dirname(file), { recursive: true });
  await writeFile(file, source);
}

const layout = "<template><MeekoOutlet /></template>\n";
const page = (name: string): string => `<template><p>${name}</p></template>\n`;
const withLayout = (value: string, name = "p"): string => `<script server lang="ts">
export const route = definePage({ layout: ${value} });
</script>
<template><p>${name}</p></template>
`;

/** Each route as `id → [layouts relative to root] (layout name + props)`. */
function summary(root: string, routes: readonly RouteRecord[]): Record<string, string> {
  const relative = (file: string): string => file.slice(root.length + 1).replaceAll("\\", "/");
  return Object.fromEntries(routes.map((route) => [route.id, `${route.layouts.map(relative).join(" > ")}${route.layout ? ` (${route.layout.name}${route.layout.props ? ` ${JSON.stringify(route.layout.props)}` : ""})` : ""}`]));
}

const file = "/project/app/pages/index.route.ts";
const header = 'import { definePage } from "@meekojs/meeko/framework";\n';

test("layout is read as a literal or false, like render", () => {
  assert.deepEqual(extractRouteOptions(file, `${header}export const route = definePage({ layout: "dashboard", render: "prerender" });\n`), { render: "prerender", layout: "dashboard" });
  assert.deepEqual(extractRouteOptions(file, `${header}export const route = definePage({ layout: \`admin/panel\` });\n`), { layout: "admin/panel" });
  assert.deepEqual(extractRouteOptions(file, `${header}export const route = definePage({ layout: false });\n`), { layout: false });
  assert.deepEqual(extractRouteOptions(file, `${header}export const route = definePage({ load: () => ({}) });\n`), {});
  assert.throws(() => extractRouteOptions(file, `${header}const name = "dashboard";\nexport const route = definePage({ layout: name });\n`),
    /index\.route\.ts: layout debe ser un literal de texto \(el nombre de un layout de app\/layouts\) o false/);
  assert.throws(() => extractRouteOptions(file, `${header}export const route = definePage({ layout: true } as never);\n`), /layout debe ser un literal de texto/);
  assert.throws(() => extractRouteOptions(file, `${header}export const route = definePage({ layout: "../x" } as never);\n`), /"\.\.\/x" no es un nombre de layout válido/);
});

test("+group.ts options are read as literals", () => {
  const group = "/project/app/pages/(dashboard)/+group.ts";
  assert.deepEqual(extractGroupOptions(group, 'export default defineGroup({ layout: "dashboard", layoutProps: { showAlert: false, title: "Panel", tags: ["a", 1, null], nested: { n: -2 } } });\n'),
    { layout: "dashboard", layoutProps: { showAlert: false, title: "Panel", tags: ["a", 1, null], nested: { n: -2 } } });
  assert.deepEqual(extractGroupOptions(group, "const options = { layout: false } as const;\nexport default options;\n"), { layout: false });
  assert.throws(() => extractGroupOptions(group, 'const title = "x";\nexport default defineGroup({ layoutProps: { title } });\n'), /\+group\.ts: layoutProps debe ser un objeto literal con claves normales/);
  assert.throws(() => extractGroupOptions(group, "export default defineGroup({ layoutProps: { at: Date.now() } });\n"), /layoutProps\.at debe ser un valor literal/);
  assert.throws(() => extractGroupOptions(group, 'export default defineGroup({ middleware: ["auth"] });\n'), /middleware no se admite en \+group\.ts/);
  assert.throws(() => extractGroupOptions(group, 'export default defineGroup({ title: "x" });\n'), /opción de grupo desconocida "title"/);
  assert.throws(() => extractGroupOptions(group, "export const layout = 'x';\n"), /debe exportar por defecto defineGroup/);
  assert.throws(() => extractGroupOptions(group, "const base = {};\nexport default defineGroup({ ...base });\n"), /propiedades normales/);
});

test("named layouts come from app/layouts, subfolders included, and pages choose them", async (context) => {
  const root = await tempProject(context, "named-layouts");
  await put(root, "app/app.meeko", layout);
  for (const name of ["default", "dashboard", "auth", "admin/panel"]) await put(root, `app/layouts/${name}.meeko`, layout);
  await put(root, "app/layouts/notes.md", "not a layout\n");
  // Not a layout name: a component kept beside the layouts.
  await put(root, "app/layouts/_parts.meeko", layout);
  await put(root, "app/pages/index.meeko", page("home"));
  await put(root, "app/pages/login.meeko", withLayout('"auth"'));
  await put(root, "app/pages/print.meeko", withLayout("false"));
  await put(root, "app/pages/admin.meeko", withLayout('"admin/panel"'));
  await put(root, "app/pages/sidecar.meeko", page("sidecar"));
  await put(root, "app/pages/sidecar.route.ts", 'export const route = definePage({ layout: "dashboard", layoutProps: { title: "x" } });\n');
  // Groups and +layout.meeko nest inside the named layout.
  await put(root, "app/pages/(dashboard)/+group.ts", 'export default defineGroup({ layout: "dashboard", layoutProps: { showAlert: false, title: "Panel" } });\n');
  await put(root, "app/pages/(dashboard)/+layout.meeko", layout);
  await put(root, "app/pages/(dashboard)/connections.meeko", page("connections"));
  await put(root, "app/pages/(dashboard)/reports/+group.ts", 'export default defineGroup({ layoutProps: { title: "Informes" } });\n');
  await put(root, "app/pages/(dashboard)/reports/+layout.meeko", layout);
  await put(root, "app/pages/(dashboard)/reports/monthly/+group.ts", "export default defineGroup({ layoutProps: { showAlert: true } });\n");
  await put(root, "app/pages/(dashboard)/reports/monthly/index.meeko", page("monthly"));
  await put(root, "app/pages/(dashboard)/reports/monthly/plain.meeko", withLayout("false"));
  await put(root, "app/pages/(dashboard)/reports/monthly/auth.meeko", withLayout('"auth"'));
  await put(root, "app/pages/(dashboard)/reports/monthly/same.meeko", withLayout('"dashboard"'));
  assert.deepEqual(Object.keys(await discoverLayouts(root)).sort(), ["admin/panel", "auth", "dashboard", "default"]);
  const routes = await discoverRoutes(root);
  assert.deepEqual(summary(root, routes), {
    "/": "app/app.meeko > app/layouts/default.meeko (default)",
    "/admin": "app/app.meeko > app/layouts/admin/panel.meeko (admin/panel)",
    "/connections": "app/app.meeko > app/layouts/dashboard.meeko > app/pages/(dashboard)/+layout.meeko (dashboard {\"showAlert\":false,\"title\":\"Panel\"})",
    "/login": "app/app.meeko > app/layouts/auth.meeko (auth)",
    "/print": "app/app.meeko",
    "/reports/monthly": "app/app.meeko > app/layouts/dashboard.meeko > app/pages/(dashboard)/+layout.meeko > app/pages/(dashboard)/reports/+layout.meeko (dashboard {\"showAlert\":true,\"title\":\"Informes\"})",
    // layout: false in a page of a group removes only the named layout.
    "/reports/monthly/plain": "app/app.meeko > app/pages/(dashboard)/+layout.meeko > app/pages/(dashboard)/reports/+layout.meeko",
    // Another layout starts without the props inherited for the dashboard.
    "/reports/monthly/auth": "app/app.meeko > app/layouts/auth.meeko > app/pages/(dashboard)/+layout.meeko > app/pages/(dashboard)/reports/+layout.meeko (auth)",
    "/reports/monthly/same": "app/app.meeko > app/layouts/dashboard.meeko > app/pages/(dashboard)/+layout.meeko > app/pages/(dashboard)/reports/+layout.meeko (dashboard {\"showAlert\":true,\"title\":\"Informes\"})",
    "/sidecar": "app/app.meeko > app/layouts/dashboard.meeko (dashboard)",
  });
  const errorPage = await discoverErrorPage(root);
  assert.equal(errorPage, undefined);
  await put(root, "app/error.meeko", "<template><p>Error</p></template>\n");
  const appError = await discoverErrorPage(root);
  assert.deepEqual(appError?.layout, { name: "default", file: join(root, "app", "layouts", "default.meeko") });

  // A layout that does not exist, named in a page or in a group.
  await put(root, "app/pages/missing.meeko", withLayout('"nowhere"'));
  await assert.rejects(discoverRoutes(root), /missing\.meeko: el layout "nowhere" no existe; crea app\/layouts\/nowhere\.meeko \(layouts disponibles: "admin\/panel", "auth", "dashboard", "default"\)/);
  await put(root, "app/pages/missing.meeko", page("missing"));
  await put(root, "app/pages/(dashboard)/+group.ts", 'export default defineGroup({ layout: "nowhere" });\n');
  await assert.rejects(discoverRoutes(root), /\+group\.ts: el layout "nowhere" no existe/);
  await put(root, "app/pages/(dashboard)/+group.ts", "export default defineGroup({ layout: dashboard });\n");
  await assert.rejects(discoverRoutes(root), /\+group\.ts: layout debe ser un literal de texto/);
});

test("without app/layouts/default.meeko pages have no named layout, and default must exist to be chosen", async (context) => {
  const root = await tempProject(context, "named-layouts-no-default");
  await put(root, "app/pages/+layout.meeko", layout);
  await put(root, "app/layouts/dashboard.meeko", layout);
  await put(root, "app/pages/index.meeko", page("home"));
  await put(root, "app/pages/panel.meeko", withLayout('"dashboard"'));
  const routes = await discoverRoutes(root);
  // The root +layout.meeko still nests inside the named layout.
  assert.deepEqual(summary(root, routes), {
    "/": "app/pages/+layout.meeko",
    "/panel": "app/layouts/dashboard.meeko > app/pages/+layout.meeko (dashboard)",
  });
  await put(root, "app/pages/explicit.meeko", withLayout('"default"'));
  await assert.rejects(discoverRoutes(root), /explicit\.meeko: el layout "default" no existe/);
  // The combination forbidden before 1.5 still is.
  await put(root, "app/pages/explicit.meeko", page("explicit"));
  await put(root, "app/layouts/default.meeko", layout);
  await assert.rejects(discoverRoutes(root), /default\.meeko y .*\+layout\.meeko definen los dos el layout raíz/);
});

test("layers and modules add named layouts and the project wins", async (context) => {
  const root = await tempProject(context, "named-layouts-sources");
  await linkRepositoryPackages(root);
  await put(root, "meeko.config.mjs", 'export default { layers: ["./layers/base"], modules: ["./modules/docs"] };\n');
  await put(root, "app/layouts/default.meeko", layout);
  await put(root, "app/layouts/shared.meeko", layout);
  await put(root, "app/pages/index.meeko", page("home"));
  await put(root, "app/pages/base-layout.meeko", withLayout('"base"'));
  await put(root, "app/pages/docs-layout.meeko", withLayout('"docs"'));
  await put(root, "app/pages/shared.meeko", withLayout('"shared"'));
  await put(root, "layers/base/app/layouts/base.meeko", layout);
  await put(root, "layers/base/app/layouts/shared.meeko", layout);
  await put(root, "layers/base/app/layouts/default.meeko", layout);
  await put(root, "layers/base/app/pages/layer.meeko", page("layer"));
  await put(root, "layers/base/app/pages/layer-docs.meeko", withLayout('"docs"'));
  await put(root, "modules/docs/index.ts", `import { defineMeekoModule } from "@meekojs/meeko/framework";
export default defineMeekoModule({ meta: { name: "docs" }, setup(_options, meeko) {
  meeko.addLayout("docs", new URL("./docs.meeko", import.meta.url));
  meeko.addLayout("base", new URL("./docs.meeko", import.meta.url));
} });
`);
  await put(root, "modules/docs/docs.meeko", layout);
  const routes = await discoverConfiguredRoutes(root);
  assert.deepEqual(summary(root, routes), {
    "/": "app/layouts/default.meeko (default)",
    // A layer's layout reaches the project's pages; the layer wins over a module.
    "/base-layout": "layers/base/app/layouts/base.meeko (base)",
    "/docs-layout": "modules/docs/docs.meeko (docs)",
    // The project's layout wins over the layer's.
    "/shared": "app/layouts/shared.meeko (shared)",
    // The project's default wraps the layer's pages too, as before 1.5.
    "/layer": "app/layouts/default.meeko (default)",
    "/layer-docs": "modules/docs/docs.meeko (docs)",
  });
  const generated = await generateRoutes(root);
  const declarations = await readFile(generated.types, "utf8");
  assert.match(declarations, /interface GeneratedLayouts \{\n {4}"base": import\("\.\.\/\.\.\/layers\/base\/app\/layouts\/base\.meeko"\)\.ComponentProps;/);
  assert.match(declarations, /"docs": import\("\.\.\/\.\.\/modules\/docs\/docs\.meeko"\)\.ComponentProps;/);
  assert.match(declarations, /"shared": import\("\.\.\/\.\.\/app\/layouts\/shared\.meeko"\)\.ComponentProps;/);
  assert.match(declarations, /interface GeneratedPageLayouts \{[^}]*"\/layer-docs": "docs";/);
  const manifest = JSON.parse(await readFile(generated.manifest, "utf8")) as { routes: RouteRecord[] };
  assert.deepEqual(manifest.routes.find((route) => route.id === "/docs-layout")?.layout, { name: "docs", file: "modules/docs/docs.meeko" });

  // Two modules with the same layout name are an error.
  await put(root, "modules/other/index.ts", `import { defineMeekoModule } from "@meekojs/meeko/framework";
export default defineMeekoModule({ meta: { name: "other" }, setup(_options, meeko) { meeko.addLayout("docs", new URL("./docs.meeko", import.meta.url)); } });
`);
  await put(root, "modules/other/docs.meeko", layout);
  await put(root, "meeko.config.mjs", 'export default { layers: ["./layers/base"], modules: ["./modules/docs", "./modules/other"] };\n');
  await assert.rejects(discoverConfiguredRoutes(root), /Meeko module other: layout docs is already added by docs/);
});

test("meeko dev rebuilds when an edit changes the options that discovery reads", () => {
  const root = join("/project");
  const sources = [root, join(root, "layers", "base")];
  for (const file of ["app/pages/a.meeko", "app/pages/(g)/+group.ts", "app/pages/a.route.ts", "layers/base/app/pages/x.meeko"]) {
    assert.equal(isRouteOptionsSource(join(root, file), sources), true, file);
  }
  for (const file of ["app/components/A.meeko", "app/pages/helper.ts", "app/layouts/default.meeko", "app/+group.ts"]) {
    assert.equal(isRouteOptionsSource(join(root, file), sources), false, file);
  }
  const route = { id: "/", file: "a.meeko", layouts: ["app.meeko", "dashboard.meeko"], layout: { name: "dashboard", file: "dashboard.meeko" } };
  assert.equal(routeOptionsKey([route]), routeOptionsKey([{ ...route }]));
  assert.notEqual(routeOptionsKey([route]), routeOptionsKey([{ ...route, layout: { ...route.layout, props: { title: "x" } } }]));
});

test("a layer without a project default keeps its own default", async (context) => {
  const root = await tempProject(context, "named-layouts-layer-default");
  await put(root, "meeko.config.mjs", 'export default { layers: ["./layers/base"] };\n');
  await put(root, "app/pages/index.meeko", page("home"));
  await put(root, "layers/base/app/layouts/default.meeko", layout);
  await put(root, "layers/base/app/pages/layer.meeko", page("layer"));
  assert.deepEqual(summary(root, await discoverConfiguredRoutes(root)), {
    // The layer's default does not wrap the project's pages, as before 1.5.
    "/": "",
    "/layer": "layers/base/app/layouts/default.meeko (default)",
  });
});
