import assert from "node:assert/strict";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import test from "node:test";
import { checkFrameworkProject } from "../src/framework/check-project.ts";
import { linkRepositoryPackages, tempProject } from "./helpers/temp-project.ts";

async function put(root: string, path: string, source: string): Promise<void> {
  const file = join(root, path);
  await mkdir(dirname(file), { recursive: true });
  await writeFile(file, source);
}

const outlet = "<template><MeekoOutlet /></template>\n";
const dashboard = `<script lang="ts">
export interface Props { title?: string; showAlert?: boolean }
const props = defineProps<Props>({ showAlert: false });
</script>
<template><header>{props.title}</header><p if:when="props.showAlert">Alerta</p><main><MeekoOutlet /></main></template>
`;
const connections = (options: string, script = "layout.set({ showAlert: true });"): string => `<script server lang="ts">
export const route = definePage(${options});
</script>
<script lang="ts">
const layout = useLayout();
${script}
</script>
<template><p>{layout.name}</p></template>
`;

test("meeko check types layoutProps, +group.ts and useLayout() against each page's layout", { timeout: 240_000 }, async (context) => {
  const root = await tempProject(context, "named-layouts-check");
  await linkRepositoryPackages(root);
  await put(root, "package.json", '{"private":true,"type":"module"}\n');
  await put(root, "app/app.meeko", outlet);
  await put(root, "app/layouts/default.meeko", outlet);
  await put(root, "app/layouts/auth.meeko", outlet);
  await put(root, "app/layouts/dashboard.meeko", dashboard);
  await put(root, "app/pages/index.meeko", "<template><p>Inicio</p></template>\n");
  await put(root, "app/pages/login.meeko", connections('{ layout: "auth" }', ""));
  await put(root, "app/pages/(dashboard)/+group.ts", 'export default defineGroup({ layout: "dashboard", layoutProps: { showAlert: false } });\n');
  await put(root, "app/pages/(dashboard)/connections.meeko", connections('{ layoutProps: { title: "Conexiones" } }'));
  await put(root, "app/pages/(dashboard)/reports.meeko", "<template><p>Informes</p></template>\n");
  await put(root, "app/pages/(dashboard)/reports.route.ts", 'export const route = definePage({ load: () => ({ n: 1 }), layoutProps: ({ data }) => ({ title: String(data.n) }) });\n');
  assert.deepEqual(await checkFrameworkProject(root), []);
  const declarations = await readFile(join(root, ".meeko", "types", "routes.d.ts"), "utf8");
  assert.match(declarations, /"dashboard": import\("\.\.\/\.\.\/app\/layouts\/dashboard\.meeko"\)\.ComponentProps;/);
  assert.match(declarations, /"\/connections": "dashboard";/);
  assert.match(declarations, /"\/login": "auth";/);

  const rejects = async (message: RegExp, label: string): Promise<void> => {
    await assert.rejects(checkFrameworkProject(root), message, label);
  };
  // A +group.ts with a prop that its layout does not declare: defineGroup types it in place.
  await put(root, "app/pages/(dashboard)/+group.ts", 'export default defineGroup({ layout: "dashboard", layoutProps: { color: "red" } });\n');
  await rejects(/\+group\.ts\(1,\d+\): error TS2353: [^\n]*'color' does not exist/, "group");
  // One that inherits its layout from an outer +group.ts: meeko check compares it with that layout.
  await put(root, "app/pages/(dashboard)/+group.ts", 'export default defineGroup({ layout: "dashboard" });\n');
  await put(root, "app/pages/(auth)/+group.ts", 'export default defineGroup({ layout: "auth" });\n');
  await put(root, "app/pages/(auth)/inner/+group.ts", "export default defineGroup({ layoutProps: { showAlert: true } });\n");
  await put(root, "app/pages/(auth)/inner/page.meeko", "<template><p>Interior</p></template>\n");
  await rejects(/Las layoutProps de app\/pages\/\(auth\)\/inner\/\+group\.ts no coinciden con las props del layout auth/, "inherited group");
  await put(root, "app/pages/(auth)/inner/+group.ts", 'export default defineGroup({ layout: "dashboard", layoutProps: { showAlert: true } });\n');
  assert.deepEqual(await checkFrameworkProject(root), []);
  // A page that inherits the dashboard, with a prop of the wrong type.
  await put(root, "app/pages/(dashboard)/connections.meeko", connections("{ layoutProps: { title: 1 } }"));
  await rejects(/Las layoutProps de app\/pages\/\(dashboard\)\/connections\.meeko no coinciden con las props del layout dashboard/, "inherited");
  // useLayout() in the page is typed with the inherited layout.
  await put(root, "app/pages/(dashboard)/connections.meeko", connections("{}", "layout.set({ showAlert: 1 });"));
  await rejects(/connections\.meeko[\s\S]*not assignable/, "useLayout");
  await put(root, "app/pages/(dashboard)/connections.meeko", connections("{}"));
  // A page that chooses its layout: definePage checks layoutProps against it.
  await put(root, "app/pages/login.meeko", connections('{ layout: "auth", layoutProps: { title: "Entrar" } }', ""));
  await rejects(/login\.meeko/, "explicit");
  await put(root, "app/pages/login.meeko", connections('{ layout: "nowhere" }', ""));
  await rejects(/el layout "nowhere" no existe/, "missing");
  await put(root, "app/pages/login.meeko", connections('{ layout: "auth" }', ""));
  // A named layout must accept being rendered without the props a page may leave out.
  await put(root, "app/layouts/auth.meeko", '<script lang="ts">\nconst props = defineProps<{ title: string }>();\n</script>\n<template><h1>{props.title}</h1><MeekoOutlet /></template>\n');
  await rejects(/Las props del layout app\/layouts\/auth\.meeko no coinciden con los valores que aporta Meeko/, "required");
  await put(root, "app/layouts/auth.meeko", outlet);
  // A +group.ts outside app/pages configures nothing: a warning.
  await put(root, "app/components/+group.ts", 'export default defineGroup({ layout: "auth" });\n');
  const warnings = await checkFrameworkProject(root);
  assert.deepEqual(warnings.map((warning) => [warning.code, warning.severity, warning.filename.endsWith(join("components", "+group.ts"))]), [["MEEK115", "warning", true]]);
});
