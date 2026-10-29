import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, symlink, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import test from "node:test";
import { checkSource } from "../src/check.ts";
import { checkFrameworkProject } from "../src/framework/check-project.ts";
import { initFrameworkProject } from "../src/framework/init.ts";

async function project(files: Record<string, string>): Promise<string> {
  const base = resolve(".meeko");
  await mkdir(base, { recursive: true });
  const root = await mkdtemp(join(base, "check-single-"));
  await initFrameworkProject(root);
  await mkdir(join(root, "node_modules", "@meekojs"), { recursive: true });
  await symlink(resolve("."), join(root, "node_modules", "@meekojs", "meeko"), "junction");
  await symlink(resolve("node_modules", "vite"), join(root, "node_modules", "vite"), "junction");
  for (const [path, content] of Object.entries(files)) {
    await mkdir(join(root, path, ".."), { recursive: true });
    await writeFile(join(root, path), content);
  }
  return root;
}

/** `meeko check componente.meeko`: the CLI reads the file and calls `checkSource` without options. */
async function checkFile(root: string, path: string, source: string): Promise<Array<{ code: string; text: string }>> {
  const file = join(root, path);
  await mkdir(join(file, ".."), { recursive: true });
  await writeFile(file, source);
  const diagnostics = await checkSource(source, file);
  return diagnostics.filter((item) => item.severity !== "warning").map((item) => ({ code: item.code, text: source.slice(item.location.offset, item.location.offset + 8) }));
}

const deferredPage = `<script server lang="ts">
export const route = definePage({ render: "stream" });
export const stats = defer(Promise.resolve({ visits: 3, items: [{ id: 1, name: "a" }] }));
</script>

<template>
  <p if:when="stats.status === 'resolved'">{stats.value?.visits.toFixed()}</p>
  <ul><li each:of="stats.value?.items ?? []" each:as="item" each:key="item.id">{item.name.toUpperCase()}</li></ul>
</template>
`;

test("a component checked alone reports what the project check reports", { timeout: 300_000 }, async () => {
  const root = await project({});
  try {
    // A project that `meeko check .` already prepared, as when its author edits a component.
    await checkFrameworkProject(root);
    // MEEK044 and MEEK100: a <script server> outside a page, generic in a page.
    assert.deepEqual(await checkFile(root, "app/components/Card.meeko", '<script server lang="ts">\nexport const route = definePage({});\n</script>\n<template><p>card</p></template>\n'),
      [{ code: "MEEK044", text: "<script " }]);
    assert.deepEqual((await checkFile(root, "app/pages/generic.meeko", '<script lang="ts" generic="T">\nconst x = 1;\n</script>\n<template><p>{x}</p></template>\n')).map((item) => item.code), ["MEEK100"]);
    // The TypeScript of <script server>: a redirect status that redirect() does not accept.
    assert.deepEqual(await checkFile(root, "app/pages/redirect.meeko", '<script server lang="ts">\nredirect("/login", 404);\nexport const a = 1;\n</script>\n<template><p>{a}</p></template>\n'),
      [{ code: "TS2345", text: "404);\nex" }]);
    // export default definePage is accepted, as by the project check.
    assert.deepEqual(await checkFile(root, "app/pages/default.meeko", '<script server lang="ts">\nexport default definePage({ render: "ssr" });\n</script>\n<template><p>x</p></template>\n'), []);
    // defer, autoimported in <script server>, gives the template the exact type of its value.
    assert.deepEqual(await checkFile(root, "app/pages/deferred.meeko", deferredPage), []);
    const misread = await checkFile(root, "app/pages/deferred.meeko", deferredPage.replace("stats.value?.visits.toFixed()", "stats.value.value.visits"));
    assert.deepEqual(misread.map((item) => item.code).sort(), ["TS18048", "TS2339"], JSON.stringify(misread));
    // defer inside the route options of a block without top-level code.
    assert.deepEqual(await checkFile(root, "app/pages/loaded.meeko", '<script server lang="ts">\nexport const route = definePage({ render: "stream", load: async () => ({ c: defer(Promise.resolve(1)) }) });\n</script>\n<script lang="ts">\nconst navigation = useNavigation();\nconst release = createRoot((dispose) => dispose);\nrelease();\n</script>\n<template><p>{navigation.pending.value ? "a" : "b"}</p></template>\n'), []);
    // A layout created after the last `meeko check .`: its props type the page's layoutProps.
    await writeFile(join(root, "app", "layouts", "dashboard.meeko"), '<script lang="ts">\nexport interface Props { title: string }\nconst props = defineProps<Props>();\n</script>\n<template><h1>{props.title}</h1><MeekoOutlet /></template>\n');
    const page = (title: string) => `<script server lang="ts">\nexport const route = definePage({ layout: "dashboard", layoutProps: { title: ${title} } });\n</script>\n<template><p>x</p></template>\n`;
    assert.deepEqual(await checkFile(root, "app/pages/dash.meeko", page('"Hola"')), []);
    assert.deepEqual((await checkFile(root, "app/pages/dash.meeko", page("3"))).map((item) => item.code), ["TS2769"]);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("the project check agrees with the single-file check on the autoimported defer", { timeout: 300_000 }, async () => {
  const root = await project({
    "app/pages/deferred.meeko": deferredPage,
    "app/pages/sidecar.route.ts": 'export const route = definePage({ render: "stream", load: async () => ({ c: defer(async () => 1) }) });\n',
    "app/pages/sidecar.meeko": '<script lang="ts">\nconst props = defineProps<{ params: Record<string, string>; search: Record<string, string | string[]>; data: { c: import("@meekojs/meeko/framework").Deferred<number> } }>();\n</script>\n<template><p>{props.data.c.value}</p></template>\n',
  });
  try {
    await checkFrameworkProject(root);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
