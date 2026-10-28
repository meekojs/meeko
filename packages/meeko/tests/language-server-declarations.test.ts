import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { after, before, describe, test } from "node:test";
import { pathToFileURL } from "node:url";
import ts from "@typescript/typescript6";
import { TextDocument } from "vscode-languageserver-textdocument";
import type { MarkupContent } from "vscode-languageserver/node";
import { completion, hover } from "../src/language-server/features.ts";
import type { FeatureContext } from "../src/language-server/features.ts";
import { MeekoProject } from "../src/language-server/project.ts";

const list = `<script lang="ts" generic="T extends { id: string }">
const props = defineProps<{ rows: T[] }>();
const emit = defineEmits<{ select: [row: T] }>();
const snippets = defineSnippets<{ row: [row: T] }>();
</script>
<template><ul><li each:of="props.rows" each:key="row.id" each:as="row" on:click="() => emit('select', row)"><render snippet="snippets.row" args="row" /></li></ul></template>`;

const parent = `<script lang="ts">
import { signal, type Signal } from "@meekojs/meeko";
import * as TmpList from "./TmpList.meeko";
interface User { id: string; email: string }
const users: Signal<User[]> = signal([]);
</script>
<template><TmpList bind:rows="users.value" on:select="(user) => console.log(user.email)"><snippet name="row" params="user">{user.email}</snippet></TmpList></template>`;

/** A declaration that `meeko types` wrote before the component became generic. */
const stale = `export type ComponentProps = { rows: { stale: true }[] };
export declare const __meekoTag: (props: ComponentProps, events: {}, models: unknown, snippets: { readonly row: (row: { stale: true }) => void }) => { readonly exposed: null };
export declare function renderToString(props: ComponentProps): string;
`;

describe("language server: generated component declarations", () => {
  let root: string;
  let project: MeekoProject;

  before(async () => {
    await mkdir(resolve(".meeko"), { recursive: true });
    root = await mkdtemp(resolve(".meeko", "lsp-declarations-"));
    await writeFile(join(root, "package.json"), '{"private":true,"type":"module"}\n');
    // NodeNext, as in the projects that `meeko init-framework` creates: TypeScript resolves
    // `./TmpList.meeko` to a generated `TmpList.d.meeko.ts` before any other candidate.
    await writeFile(join(root, "tsconfig.json"), `${JSON.stringify({ compilerOptions: {
      strict: true, module: "NodeNext", moduleResolution: "NodeNext", target: "ES2022", lib: ["ES2022", "DOM"], types: [], noEmit: true, skipLibCheck: true,
      paths: { "@meekojs/meeko/internal": ["../../src/internal.ts"], "@meekojs/meeko": ["../../src/index.ts"] },
    } })}\n`);
    await mkdir(join(root, ".meeko", "types"), { recursive: true });
    await writeFile(join(root, ".meeko", "types", "TmpList.d.meeko.ts"), stale);
    await writeFile(join(root, "TmpList.meeko"), list);
    await writeFile(join(root, "Users.meeko"), parent);
    project = new MeekoProject(root, { trusted: false });
    await project.ready();
  });

  after(async () => {
    project?.service.dispose();
    if (root) await rm(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 });
  });

  function open(name: string, text: string): FeatureContext & { at(needle: string, delta?: number): { line: number; character: number } } {
    const filename = join(root, name);
    const component = project.setDocument(filename, text);
    assert.ok(component, String(project.componentError(filename)));
    const document = TextDocument.create(pathToFileURL(filename).href, "meeko", 1, text);
    return {
      project, component, document, locate: () => undefined,
      at: (needle, delta = 0) => {
        const offset = text.indexOf(needle);
        assert.ok(offset >= 0, needle);
        return document.positionAt(offset + delta);
      },
    };
  }

  const hoverText = (context: FeatureContext, position: { line: number; character: number }): string =>
    (hover(context, position)?.contents as MarkupContent | undefined)?.value ?? "";

  test("a component of the project resolves to its live module, not to a stale generated declaration", async () => {
    const context = open("Users.meeko", parent);
    const file = context.component.virtualFilename;
    const errors = [...project.service.getSyntacticDiagnostics(file), ...project.service.getSemanticDiagnostics(file)]
      .map((item) => `${item.code}: ${ts.flattenDiagnosticMessageText(item.messageText, " ")}`);
    assert.deepEqual(errors, []);
    const files = project.service.getProgram()!.getSourceFiles().map((source) => source.fileName);
    assert.equal(files.some((name) => name.endsWith(".d.meeko.ts")), false, files.join("\n"));
    // T comes from the tag's props: the parameters of the handler and of the snippet are User.
    assert.match(hoverText(context, context.at("user\">", 1)), /\(parameter\) user: User/);
    assert.match(hoverText(context, context.at("{user.email}", 2)), /\(parameter\) user: User/);
    assert.match(hoverText(context, context.at("(user) =>", 2)), /\(parameter\) user: User/);
    assert.match(hoverText(context, context.at("<TmpList", 2)), /```ts\n<TmpList<T = User>\n/);
    const members = (completion(context, context.at("{user.email}", 7)) ?? []).map((item) => item.label);
    assert.ok(members.includes("email") && members.includes("id"), JSON.stringify(members));
  });

  test("a declaration next to the component is ignored the same way", async () => {
    await writeFile(join(root, "TmpList.d.meeko.ts"), stale);
    try {
      project.filesChanged([join(root, "TmpList.d.meeko.ts")]);
      await project.ready();
      const context = open("Users.meeko", `${parent}\n`);
      assert.deepEqual(project.service.getSemanticDiagnostics(context.component.virtualFilename).map((item) => item.code), []);
      assert.match(hoverText(context, context.at("user\">", 1)), /\(parameter\) user: User/);
    } finally {
      await rm(join(root, "TmpList.d.meeko.ts"), { force: true });
    }
  });
});
