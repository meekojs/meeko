import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, symlink, writeFile } from "node:fs/promises";
import { join, relative, resolve, sep } from "node:path";
import test from "node:test";
import { checkFrameworkProject } from "../src/framework/check-project.js";

test("page contract checks data from an indirectly declared loader", async () => {
  const parent = resolve(".meeko");
  await mkdir(parent, { recursive: true });
  const root = await mkdtemp(join(parent, "page-contract-indirect-"));
  const path = relative(parent, root);
  assert.ok(path && path !== ".." && !path.startsWith(`..${sep}`));
  try {
    await mkdir(join(root, "app", "pages"), { recursive: true });
    await mkdir(join(root, "server"), { recursive: true });
    await mkdir(join(root, "node_modules", "@meekojs"), { recursive: true });
    await symlink(resolve("."), join(root, "node_modules", "@meekojs", "meeko"), "junction");
    await writeFile(join(root, "package.json"), '{"private":true,"type":"module"}\n');
    await writeFile(join(root, "app", "pages", "index.meeko"), [
      '<script lang="ts">',
      "export interface Props { params: Record<string, string>; data?: number }",
      "const props = defineProps<Props>();",
      "</script>",
      "<template><p>{props.data}</p></template>",
      "",
    ].join("\n"));
    await writeFile(join(root, "app", "pages", "index.route.ts"), [
      'import { definePage } from "@meekojs/meeko/framework";',
      'const options = { load: () => ({ name: "Ada" }) };',
      "export const route = definePage(options);",
      "",
    ].join("\n"));
    await writeFile(join(root, "server", "runtime.ts"), [
      'import { defineServerRuntime, MemorySessionStore, SessionManager } from "@meekojs/meeko/server";',
      "export default defineServerRuntime(() => ({",
      "  sessions: new SessionManager({ store: new MemorySessionStore(), production: false }),",
      "}));",
      "",
    ].join("\n"));
    await assert.rejects(checkFrameworkProject(root), /Las props de la página app\/pages\/index\.meeko no coinciden con el loader app\/pages\/index\.route\.ts/);
    await writeFile(join(root, "app", "pages", "index.meeko"), [
      '<script lang="ts">',
      "export interface Props { params: Record<string, string>; data?: { name: string } }",
      "const props = defineProps<Props>();",
      "</script>",
      "<template><p>{props.data?.name}</p></template>",
      "",
    ].join("\n"));
    await checkFrameworkProject(root);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("page contracts and meeko check understand render: client sidecars", async () => {
  const parent = resolve(".meeko");
  await mkdir(parent, { recursive: true });
  const root = await mkdtemp(join(parent, "page-contract-client-"));
  try {
    await mkdir(join(root, "app", "pages"), { recursive: true });
    await mkdir(join(root, "server"), { recursive: true });
    await mkdir(join(root, "node_modules", "@meekojs"), { recursive: true });
    await symlink(resolve("."), join(root, "node_modules", "@meekojs", "meeko"), "junction");
    await writeFile(join(root, "package.json"), '{"private":true,"type":"module"}\n');
    const pageSource = (data: string) => [
      '<script lang="ts">',
      `export interface Props { params: Record<string, string>; search: Record<string, string | string[]>; data: ${data} }`,
      "const props = defineProps<Props>();",
      "</script>",
      "<template><p>{String(props.data)}</p></template>",
      "",
    ].join("\n");
    const sidecar = (load: string) => [
      'import { definePage } from "@meekojs/meeko/framework";',
      `export const route = definePage({ render: "client", ${load}, head: ({ data }) => ({ title: data.path }) });`,
      "",
    ].join("\n");
    await writeFile(join(root, "app", "pages", "index.meeko"), pageSource("number"));
    await writeFile(join(root, "app", "pages", "index.route.ts"), sidecar("load: ({ url, signal }) => ({ path: url.pathname, aborted: signal.aborted })"));
    await writeFile(join(root, "server", "runtime.ts"), [
      'import { defineServerRuntime, MemorySessionStore, SessionManager } from "@meekojs/meeko/server";',
      "export default defineServerRuntime(() => ({",
      "  sessions: new SessionManager({ store: new MemorySessionStore(), production: false }),",
      "}));",
      "",
    ].join("\n"));
    await assert.rejects(checkFrameworkProject(root), /Las props de la página app\/pages\/index\.meeko no coinciden con el loader app\/pages\/index\.route\.ts/);
    await writeFile(join(root, "app", "pages", "index.meeko"), pageSource("{ path: string; aborted: boolean }"));
    await checkFrameworkProject(root);
    // A browser loader has no Request: the server-only context is a type error.
    await writeFile(join(root, "app", "pages", "index.route.ts"), sidecar("load: ({ request }) => ({ path: request.url, aborted: false })"));
    await assert.rejects(checkFrameworkProject(root), /index\.route\.ts/);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
