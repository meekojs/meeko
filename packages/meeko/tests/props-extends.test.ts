import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { after, before, describe, test } from "node:test";
import { pathToFileURL } from "node:url";
import { TextDocument } from "vscode-languageserver-textdocument";

import { checkSource } from "../src/check.ts";
import { componentDiagnostics } from "../src/language-server/diagnostics.ts";
import { MeekoProject } from "../src/language-server/project.ts";

const children: Record<string, string> = {
  Plain: `<script lang="ts">
const props = defineProps<{ label: string }>();
</script><template><p>{props.label}</p></template>`,
  Emits: `<script lang="ts">
interface Props { label: string; size?: number }
const props = defineProps<Props>();
const emit = defineEmits<{ click: [event: MouseEvent] }>();
</script><template><button type="button" on:click="(event) => emit('click', event)">{props.label}</button></template>`,
  Defaults: `<script lang="ts">
const { label, size = 2 } = defineProps<{ label: string; size?: number }>();
const emit = defineEmits<{ click: [] }>();
</script><template><button type="button" on:click="() => emit('click')">{label}{size}</button></template>`,
  Generic: `<script lang="ts" generic="T">
const props = defineProps<{ value: T }>();
const emit = defineEmits<{ pick: [value: T] }>();
</script><template><button type="button" on:click="() => emit('pick', props.value)">x</button></template>`,
  Union: `<script lang="ts">
type Props = { kind: "a"; a: string } | { kind: "b"; b: string };
const props = defineProps<Props>();
</script><template><p>{props.kind}</p></template>`,
  UnionEmits: `<script lang="ts">
type Props = { kind: "a"; a: string } | { kind: "b"; b: string };
const props = defineProps<Props>();
const emit = defineEmits<{ click: [] }>();
</script><template><button type="button" on:click="() => emit('click')">{props.kind}</button></template>`,
};

const extending = (child: string, typeArguments = ""): string => `<script lang="ts">
import type { ComponentProps as Base } from "./${child}.meeko";
interface Props extends Base${typeArguments} { extra?: string }
const props = defineProps<Props>();
</script><template><p>{props.extra}</p></template>`;

/** A wrapper over `ComponentProps`, which carries `onClick`: `bind` rejects it, with a precise error. */
const carrying = `<script lang="ts">
import * as Emits from "./Emits.meeko";
import type { ComponentProps } from "./Emits.meeko";
interface Props extends ComponentProps { extra?: string }
const { extra, ...rest } = defineProps<Props>();
</script><template><Emits bind="rest" /><p>{extra}</p></template>`;

describe("interface Props extends the ComponentProps of a component", () => {
  let root: string;
  let project: MeekoProject;

  before(async () => {
    await mkdir(resolve(".meeko"), { recursive: true });
    root = await mkdtemp(resolve(".meeko", "props-extends-"));
    await writeFile(join(root, "package.json"), '{"private":true,"type":"module"}\n');
    await writeFile(join(root, "tsconfig.json"), JSON.stringify({ compilerOptions: { strict: true, types: ["node"], paths: { "@meekojs/meeko/internal": ["../../src/internal.ts"], "@meekojs/meeko/framework": ["../../src/framework.ts"], "@meekojs/meeko": ["../../src/index.ts"] } } }));
    for (const [name, source] of Object.entries(children)) await writeFile(join(root, `${name}.meeko`), source);
    project = new MeekoProject(root, { trusted: false });
    await project.ready();
  });

  after(async () => {
    project?.service.dispose();
    if (root) await rm(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 });
  });

  /** What `meeko check` and the editor report for a new component, each as `code: message`. */
  async function report(name: string, source: string): Promise<{ check: string[]; editor: string[] }> {
    const file = join(root, `${name}.meeko`);
    await writeFile(file, source);
    const check = await checkSource(source, file);
    assert.ok(project.setDocument(file, source), String(project.componentError(file)));
    const editor = await componentDiagnostics(project, TextDocument.create(pathToFileURL(file).href, "meeko", 1, source), file, () => undefined);
    return { check: check.map((item) => `${item.code}: ${item.message}`), editor: editor.map((item) => `${String(item.code)}: ${item.message}`) };
  }

  for (const [child, typeArguments] of [["Plain", ""], ["Emits", ""], ["Defaults", ""], ["Generic", "<string>"]] as const) {
    test(`props that are an object can be extended: ${child}`, async () => {
      // The listeners, a mapped type with `as`, do not get in the way: emits only add known members.
      assert.deepEqual(await report(`Extends${child}`, extending(child, typeArguments)), { check: [], editor: [] });
    });
  }

  test("the rest of ComponentProps carries the listeners, which bind rejects: MEEK113, not a silent loss", async () => {
    const { check, editor } = await report("Carrying", carrying);
    assert.ok(check.some((item) => item.startsWith("MEEK113: bind no admite claves on*")), check.join("\n"));
    assert.ok(editor.some((item) => item.startsWith("MEEK113: bind no admite claves on*")), editor.join("\n"));
  });

  for (const child of ["Union", "UnionEmits"]) {
    test(`props that are a union propose a type with an intersection: ${child}`, async () => {
      const { check, editor } = await report(`Extends${child}`, extending(child));
      const message = "TS2312: Una interface no puede extender Base porque no tiene una forma única: suele ser una unión de props, y cada variante es distinta. Escribe un tipo, que conserva todas las variantes: type Props = Base & { … }";
      assert.deepEqual(check, [message]);
      assert.deepEqual(editor, [message]);
    });
  }

  // Not about props, but the same two checkers: `data` of route options beside top-level server code.
  test("data of the route options is typed from the exports of the page", async () => {
    await mkdir(join(root, "app", "pages"), { recursive: true });
    const server = (options: string, imports = ""): string => `<script server lang="ts">
${imports}export const route = definePage(${options});
const { params } = usePage();
const row = await Promise.resolve({ title: String(params.id), count: 1 });
export const title = row.title;
export const count = row.count;
</script>
<script lang="ts">
const props = defineProps<{ params: { id: string }; data: { title: string; count: number } }>();
</script>
<template><p>{props.data.title}</p></template>`;
    const page = async (name: string, source: string): Promise<{ check: string[]; editor: string[] }> => {
      const file = join(root, "app", "pages", `${name}.meeko`);
      await writeFile(file, source);
      const check = await checkSource(source, file);
      assert.ok(project.setDocument(file, source), String(project.componentError(file)));
      const editor = await componentDiagnostics(project, TextDocument.create(pathToFileURL(file).href, "meeko", 1, source), file, () => undefined);
      return { check: check.map((item) => `${item.code}: ${item.message}`), editor: editor.map((item) => `${String(item.code)}: ${item.message}`) };
    };
    const typed = "{ layoutProps: ({ data }) => ({ title: data.title.toUpperCase(), count: data.count + 1 }) }";
    assert.deepEqual(await page("[id]", server(typed)), { check: [], editor: [] });
    assert.deepEqual(await page("[id]", server(typed, 'import { definePage } from "@meekojs/meeko/framework";\n')), { check: [], editor: [] });
    const wrong = await page("[id]", server("{ layoutProps: ({ data }) => ({ title: data.missing }) }"));
    assert.ok(wrong.check.some((item) => item.startsWith("TS2339") && item.includes("missing")), wrong.check.join("\n"));
    assert.ok(wrong.editor.some((item) => item.startsWith("TS2339") && item.includes("missing")), wrong.editor.join("\n"));
  });

});
