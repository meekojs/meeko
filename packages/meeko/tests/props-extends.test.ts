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

/** The wrapper of a union: the intersection keeps its variants, also without the listeners. */
const unionWrapper = `<script lang="ts">
import type { ComponentOwnProps, ComponentProps } from "./UnionEmits.meeko";
type Props = ComponentOwnProps & { extra?: string };
const props = defineProps<Props>();
const emit = defineEmits<{ click: [] }>();
const narrow = (value: ComponentProps): string => value.kind === "a" ? value.a : value.b;
void narrow; void props; void emit;
</script><template><p>{props.kind === "a" ? props.a : props.b}</p></template>`;

/** The wrapper of an object: the rest goes through `bind`, which admits no `on*` key, and it re-emits. */
const wrapper = `<script lang="ts">
import * as Emits from "./Emits.meeko";
import type { ComponentOwnProps } from "./Emits.meeko";
interface Props extends ComponentOwnProps { extra?: string }
const { extra, ...rest } = defineProps<Props>();
const emit = defineEmits<{ click: [event: MouseEvent] }>();
</script><template><Emits bind="rest" on:click="(event) => emit('click', event)" /><p>{extra}</p></template>`;

/** The same wrapper over `ComponentProps`, which carries `onClick`: two explanations, both precise. */
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
    await writeFile(join(root, "tsconfig.json"), JSON.stringify({ compilerOptions: { strict: true, types: ["node"], paths: { "@meekojs/meeko/internal": ["../../src/internal.ts"], "@meekojs/meeko": ["../../src/index.ts"] } } }));
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

  test("a wrapper extends ComponentOwnProps, forwards the rest with bind and declares the event itself", async () => {
    assert.deepEqual(await report("Wrapper", wrapper), { check: [], editor: [] });
  });

  test("the rest of ComponentProps carries the listeners, which bind rejects: MEEK113, not a silent loss", async () => {
    const { check, editor } = await report("Carrying", carrying);
    assert.ok(check.some((item) => item.startsWith("MEEK113: bind no admite claves on*")), check.join("\n"));
    assert.ok(editor.some((item) => item.startsWith("MEEK113: bind no admite claves on*")), editor.join("\n"));
  });

  for (const [name, child, members] of [
    ["emits and props", "Emits", "{ label: string; size?: number }"],
    ["defaults", "Defaults", "{ label: string; size?: number | undefined }"],
    ["no emits", "Plain", "{ label: string }"],
  ] as const) {
    test(`ComponentOwnProps has the props without the listeners: ${name}`, async () => {
      const source = `<script lang="ts">
import type { ComponentOwnProps } from "./${child}.meeko";
const same = (value: ComponentOwnProps): ${members} => value;
const back = (value: ${members}): ComponentOwnProps => value;
const none: "onClick" extends keyof ComponentOwnProps ? never : true = true;
void same; void back; void none;
</script><template><p>x</p></template>`;
      assert.deepEqual(await report(`Own${child}`, source), { check: [], editor: [] });
    });
  }

  test("ComponentOwnProps of a generic component keeps its parameters", async () => {
    const source = `<script lang="ts">
import type { ComponentOwnProps } from "./Generic.meeko";
const value: ComponentOwnProps<number> = { value: 1 };
const wrong: ComponentOwnProps<string> = { value: 1 };
void value; void wrong;
</script><template><p>x</p></template>`;
    const message = "TS2322: Type 'number' is not assignable to type 'string'.";
    assert.deepEqual(await report("OwnGeneric", source), { check: [message], editor: [message] });
  });

  for (const child of ["Union", "UnionEmits"]) {
    test(`props that are a union propose a type with an intersection: ${child}`, async () => {
      const source = extending(child);
      const { check, editor } = await report(`Extends${child}`, source);
      const message = "TS2312: Una interface no puede extender Base porque no tiene una forma única: suele ser una unión de props, y cada variante es distinta. Escribe un tipo, que conserva todas las variantes: type Props = Base & { … }";
      assert.deepEqual(check, [message]);
      assert.deepEqual(editor, [message]);
    });
  }

  test("the proposed type keeps the variants of the union", async () => {
    assert.deepEqual(await report("UnionWrapper", unionWrapper), { check: [], editor: [] });
  });
});
