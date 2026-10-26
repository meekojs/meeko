import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { test } from "node:test";
import ts from "@typescript/typescript6";
import { createEditorModel } from "../src/language-server/model.ts";

const source = `<script lang="ts">
import { signal } from "@meekojs/meeko";
import { useApi, useRpcMutation, useRpcQuery } from "./data.js";
const q = signal("a");
const notes = await useApi("/api/notes", { query: { q } });
const lazy = useApi("/api/notes", { query: { q } });
const user = await useRpcQuery("users.get", { id: 1 });
const add = useRpcMutation("notes.add");
const first = notes.data.value[0];
const name = user.data.value.name;
</script>
<template><p on:click="() => add.mutate({ text: 'x' })">{first}{name}{String(lazy.data.value)}</p></template>`;

const data = `import { createUseApi, createUseRpcMutation, createUseRpcQuery } from "@meekojs/meeko/framework";
import type { ApiOperation, RpcOperation } from "@meekojs/meeko/framework";
const manifest = {
  api: [{ clientKey: "notes", pathname: "/api/notes", method: "GET" }, { clientKey: "notes.item", pathname: "/api/notes/[id]", method: "GET" }, { clientKey: "notes", pathname: "/api/notes", method: "POST" }, { clientKey: "users", pathname: "/api/users", method: "POST" }],
  rpc: [{ id: "users.get", pathname: "/_meeko/rpc/users.get" }, { id: "notes.add", pathname: "/_meeko/rpc/notes.add" }],
} as const;
type ApiContract = {
  notes: { get: ApiOperation<undefined, { q: string }, undefined, string[]>; post: ApiOperation<undefined, undefined, { text: string }, { id: number }> };
  "notes.item": { get: ApiOperation<{ id: string }, undefined, undefined, { text: string }> };
  users: { post: ApiOperation<undefined, undefined, { name: string }, { id: number }> };
};
type RpcContract = { "users.get": RpcOperation<{ id: number }, { name: string }>; "notes.add": RpcOperation<{ text: string }, { saved: string }> };
export const useApi = createUseApi<ApiContract, typeof manifest>(manifest);
export const useRpcQuery = createUseRpcQuery<RpcContract>(manifest);
export const useRpcMutation = createUseRpcMutation<RpcContract>(manifest);
`;

async function project(): Promise<{ filename: string; cleanup: () => Promise<void> }> {
  await mkdir(resolve(".meeko"), { recursive: true });
  const root = await mkdtemp(resolve(".meeko", "lsp-resources-"));
  await writeFile(join(root, "package.json"), '{"private":true,"type":"module"}\n');
  await writeFile(join(root, "tsconfig.json"), `${JSON.stringify({
    compilerOptions: {
      strict: true, module: "nodenext", moduleResolution: "nodenext", target: "es2023", types: [],
      paths: { "@meekojs/meeko/framework": ["../../src/framework.ts"], "@meekojs/meeko": ["../../src/index.ts"] },
    },
  })}\n`);
  await writeFile(join(root, "data.ts"), data);
  return { filename: join(root, "Notes.meeko"), cleanup: () => rm(root, { recursive: true, force: true }) };
}

test("the editor types the data composables from the contracts and narrows awaited data", async () => {
  const { filename, cleanup } = await project();
  const model = createEditorModel(source, filename);
  try {
    const quickInfo = (text: string): string => {
      const at = model.toGenerated(source.indexOf(text))!;
      return ts.displayPartsToString(model.service.getQuickInfoAtPosition(model.virtualFilename, at)?.displayParts);
    };
    const errors = [...model.service.getSyntacticDiagnostics(model.virtualFilename), ...model.service.getSemanticDiagnostics(model.virtualFilename)]
      .filter((item) => item.category === ts.DiagnosticCategory.Error)
      .map((item) => ts.flattenDiagnosticMessageText(item.messageText, "\n"));
    assert.deepEqual(errors, []);
    assert.match(quickInfo("notes ="), /LoadedResource<string\[\]>/);
    assert.match(quickInfo("lazy ="), /DataResource<string\[\]>/);
    assert.match(quickInfo("user ="), /LoadedResource<\{\s*name: string;?\s*\}>/);
    assert.match(quickInfo("add ="), /RpcMutation<\{\s*text: string;?\s*\}, \{\s*saved: string;?\s*\}>/);
    assert.match(quickInfo("first ="), /const first: string$/);
    assert.match(quickInfo("name ="), /const name: string$/);
  } finally {
    model.dispose();
    await cleanup();
  }
});

test("the editor completes API paths and RPC procedures of the data composables", async () => {
  const { filename, cleanup } = await project();
  const model = createEditorModel(source, filename);
  try {
    const complete = (text: string): string[] => {
      const at = model.toGenerated(source.indexOf(text) + text.length)!;
      return [...model.service.getCompletionsAtPosition(model.virtualFilename, at, {})?.entries.map((entry) => entry.name) ?? []].sort();
    };
    assert.deepEqual(complete("useApi(\""), ["/api/notes", "/api/notes/[id]"], "only GET endpoints load data");
    assert.deepEqual(complete("useRpcQuery(\""), ["notes.add", "users.get"]);
    assert.deepEqual(complete("useRpcMutation(\""), ["notes.add", "users.get"]);
  } finally {
    model.dispose();
    await cleanup();
  }
});
