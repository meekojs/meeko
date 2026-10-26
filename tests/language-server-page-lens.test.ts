import assert from "node:assert/strict";
import { after, before, describe, test } from "node:test";
import { codeLenses, largePayloadFields, pageRouteId } from "../src/language-server/lenses.ts";
import { languageProject } from "./language-server-workspace.ts";
import type { LanguageProject } from "./language-server-workspace.ts";

const user = `<script server lang="ts">
import { definePage } from "@meekojs/meeko/framework";
export const route = definePage({
  load: async () => ({ name: "Ada", joined: new Date(), tags: ["a"] }),
});
</script>

<script lang="ts">
const props = defineProps<{ data: { name: string } }>();
</script>
<template><p>{props.data.name}</p></template>
`;

const fields = Array.from({ length: largePayloadFields + 10 }, (_, index) => `f${index}: ${index}`).join(", ");
const big = `<script server lang="ts">
import { definePage } from "@meekojs/meeko/framework";
export const route = definePage({ render: "stream", load: () => ({ ${fields} }) });
</script>
<script lang="ts">
const props = defineProps<{ data: unknown }>();
</script>
<template><p>{String(props.data)}</p></template>
`;

const client = `<script server lang="ts">
import { definePage } from "@meekojs/meeko/framework";
export const route = definePage({ render: "client", load: () => ({ ok: true }) });
</script>
<script lang="ts">
const props = defineProps<{ data: { ok: boolean } }>();
</script>
<template><p>{String(props.data.ok)}</p></template>
`;

/** Top-level code in `<script server>`: its exports are the page data, without route.load. */
const body = `<script server lang="ts">
import { definePage } from "@meekojs/meeko/framework";
export const route = definePage({ render: "ssr" });
const found = { name: "Ada", joined: new Date() };
export const user = found;
export let count = 2;
export const head = { title: "User" };
</script>
<script lang="ts">
</script>
<template><p>{user.name} {count}</p></template>
`;

const notFoundOnly = `<script server lang="ts">
if (usePage().params.id === "0") notFound();
</script>
<script lang="ts">
</script>
<template><p>empty</p></template>
`;

const simple = `<script lang="ts">
const value = 1;
</script>
<template><p>{value}</p></template>
`;

describe("language server: page code lens", () => {
  let workspace: LanguageProject;

  before(async () => {
    workspace = await languageProject("lsp-page-lens-", {
      "app/pages/users/[id].meeko": user,
      "app/pages/(admin)/big.meeko": big,
      "app/pages/client.meeko": client,
      "app/pages/body/[id].meeko": body,
      "app/pages/missing/[id].meeko": notFoundOnly,
      "app/pages/index.meeko": simple,
      "app/pages/plain.meeko": simple,
      "app/pages/plain.route.ts": `import { definePage } from "@meekojs/meeko/framework";\nexport const route = definePage({ render: "prerender" });\n`,
      "app/layouts/default.meeko": `<script lang="ts">\nconst props = defineProps<{ outlet: object }>();\n</script>\n<template><main>{String(props.outlet)}</main></template>\n`,
      "app/components/Card.meeko": simple,
    });
  });

  after(async () => {
    await workspace?.dispose();
  });

  const titles = async (name: string): Promise<string[]> => {
    const context = await workspace.open(name);
    return codeLenses(context).filter((lens) => lens.range.start.line === 0).map((lens) => lens.command?.title ?? "");
  };

  test("route ids follow the page discovery", () => {
    const roots = [workspace.root];
    assert.equal(pageRouteId(workspace.file("app/pages/index.meeko"), roots), "/");
    assert.equal(pageRouteId(workspace.file("app/pages/(admin)/big.meeko"), roots), "/big");
    assert.equal(pageRouteId(workspace.file("app/pages/users/[id].meeko"), roots), "/users/[id]");
    assert.equal(pageRouteId(workspace.file("app/components/Card.meeko"), roots), undefined);
  });

  test("a page shows its route, render mode, layouts and the data it sends with serialization problems", async () => {
    const [route, data] = await titles("app/pages/users/[id].meeko");
    assert.equal(route, "Ruta /users/[id] · render ssr · layouts: app/layouts/default.meeko");
    assert.match(data!, /^Envía al cliente: \{ name: string; joined: Date; tags: string\[\]; \}/);
    assert.match(data!, /⚠ no serializable: data\.joined es un Date$/);
  });

  test("a large payload type, a client loader and a sidecar page", async () => {
    const [route, data] = await titles("app/pages/(admin)/big.meeko");
    assert.equal(route, "Ruta /big · render stream · layouts: app/layouts/default.meeko");
    assert.match(data!, new RegExp(`⚠ tipo de payload grande \\(${largePayloadFields + 10} campos\\)$`));
    const [, browser] = await titles("app/pages/client.meeko");
    assert.equal(browser, "El loader se ejecuta en el navegador: { ok: boolean; }");
    assert.deepEqual(await titles("app/pages/plain.meeko"), ["Ruta /plain · render prerender · layouts: app/layouts/default.meeko"]);
    assert.deepEqual(await titles("app/components/Card.meeko"), []);
  });

  test("a page with top-level server code sends its exports, without head", async () => {
    const [route, data] = await titles("app/pages/body/[id].meeko");
    assert.equal(route, "Ruta /body/[id] · render ssr · layouts: app/layouts/default.meeko");
    assert.match(data!, /^Envía al cliente: \{ user: \{ name: string; joined: Date; \}; count: number; \}/);
    assert.match(data!, /⚠ no serializable: user\.joined es un Date$/);
    const [, none] = await titles("app/pages/missing/[id].meeko");
    assert.equal(none, "No envía datos al cliente");
  });
});
