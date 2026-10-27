import assert from "node:assert/strict";
import { after, before, describe, test } from "node:test";
import { fileURLToPath } from "node:url";
import type { Location, MarkupContent } from "vscode-languageserver/node";
import { definition, hover } from "../src/language-server/features.ts";
import { languageProject } from "./language-server-workspace.ts";
import type { LanguageProject, OpenedComponent } from "./language-server-workspace.ts";

const index = `<script lang="ts">
const link = href("/users/[id]", { params: { id: "1" } });
const missing = href("/nowhere");
const notes = useApi("/api/notes", { query: { q: "" } });
const user = useRpcQuery("users.get", { id: 1 });
async function load(): Promise<void> {
  await api.notes.get({ query: { q: "x" } });
  await api.notes({ id: "n1" }).get();
  await api.notes.byId.get({ params: { id: "n1" } });
  await rpc.users.get({ id: 1 });
}
</script>
<template><a bind:href="href('/')" on:click="load">{link}{String(missing)}{String(notes.data.value)}{String(user.data.value)}</a></template>
`;

const handler = `import { defineApiRoute } from "@meekojs/meeko/server";
import { NoteList, NoteQuery } from "../../shared/notes.js";
export default defineApiRoute({
  query: NoteQuery,
  response: NoteList,
  handler: () => [],
});
`;

const procedure = `import { defineRpc } from "@meekojs/meeko/server";
import * as users from "../../../shared/users.js";
export default defineRpc({
  input: users.UserInput,
  output: users.User,
  handler: () => ({ name: "Ada" }),
});
`;

const noteHandler = `import { defineApiRoute } from "@meekojs/meeko/server";
import { Note, NoteParams } from "../../../shared/notes.js";
export default defineApiRoute({
  params: NoteParams,
  response: Note,
  handler: () => "",
});
`;

const clients = `export declare const api: {
  notes: { get(input?: { query?: { q: string } }): Promise<string[]>; byId: { get(input: { params: { id: string } }): Promise<string> } }
    & ((params: { readonly id: string }) => { get(): Promise<string> });
};
export declare const rpc: { users: { get(input: { id: number }): Promise<{ name: string }> } };
export declare function useApi(path: "/api/notes", options?: { query: { q: string } }): { data: { value: string[] | null } };
export declare function useRpcQuery(id: "users.get", input: { id: number }): { data: { value: { name: string } | null } };
export declare function useRpcMutation(id: "users.get"): unknown;
export declare const socket: unknown;
export declare function useSocket(name: string): unknown;
`;

describe("language server: routes, API and RPC", () => {
  let workspace: LanguageProject;
  let component: OpenedComponent;

  before(async () => {
    workspace = await languageProject("lsp-app-", {
      "app/pages/index.meeko": index,
      "app/pages/users/[id].meeko": `<script lang="ts">\nconst props = defineProps<{ params: { id: string } }>();\n</script>\n<template><p>{props.params.id}</p></template>\n`,
      "app/layouts/default.meeko": `<script lang="ts">\nconst props = defineProps<{ outlet: object }>();\n</script>\n<template><main>{String(props.outlet)}</main></template>\n`,
      "server/api/notes.get.ts": handler,
      "server/api/notes/[id].get.ts": noteHandler,
      "server/rpc/users/get.ts": procedure,
      "shared/notes.ts": "export const NoteQuery = {};\nexport const NoteList = {};\nexport const NoteParams = {};\nexport const Note = {};\n",
      "shared/users.ts": "export const UserInput = {};\nexport const User = {};\n",
      ".meeko/generated/clients.client.ts": clients,
      ".meeko/generated/clients.server.ts": clients,
    });
    // The generated clients register `api`, `rpc` and the data composables as autoimports.
    workspace.project.filesChanged([workspace.file(".meeko/generated/clients.client.ts")]);
    await workspace.project.ready();
    component = await workspace.open("app/pages/index.meeko");
  });

  after(async () => {
    await workspace?.dispose();
  });

  const hoverText = (needle: string, delta = 1, from?: string): string =>
    (hover(component, component.at(needle, delta, from))?.contents as MarkupContent | undefined)?.value ?? "";

  test("the application index has the pages, endpoints and procedures", () => {
    assert.deepEqual(component.app?.routes.map((route) => route.id).sort(), ["/", "/users/[id]"]);
    assert.deepEqual(component.app?.api.map((endpoint) => `${endpoint.method} ${endpoint.pathname}`), ["GET /api/notes", "GET /api/notes/[id]"]);
    assert.deepEqual(component.app?.rpc.map((endpoint) => endpoint.id), ["users.get"]);
  });

  test("href shows the page, its params, render mode and layouts and goes to the page", () => {
    const text = hoverText("\"/users/[id]\"");
    assert.match(text, /\*\*Ruta\*\* `\/users\/\[id\]` → \[app\/pages\/users\/\[id\]\.meeko\]\(file:/);
    assert.match(text, /params: `\{ id: string \}`/);
    assert.match(text, /render: ssr/);
    assert.match(text, /layouts: app\/layouts\/default\.meeko/);
    const target = definition(component, component.at("\"/users/[id]\"", 2)) as Location[];
    assert.equal(target.length, 1);
    assert.equal(fileURLToPath(target[0]!.uri).toLowerCase(), workspace.file("app/pages/users/[id].meeko").toLowerCase());
    assert.match(hoverText("'/'"), /\*\*Ruta\*\* `\/` → \[app\/pages\/index\.meeko\]/);
    assert.match(hoverText("\"/nowhere\""), /no es una página de este proyecto/);
  });

  test("useApi and api.* show the method, schemas and handler and go to the handler", () => {
    const text = hoverText("\"/api/notes\"");
    assert.match(text, /\*\*GET\*\* `\/api\/notes` → handler \[server\/api\/notes\.get\.ts\]\(file:[^)]+#L6,3\)/);
    assert.match(text, /- query: `NoteQuery` de `\.\.\/\.\.\/shared\/notes\.js`/);
    assert.match(text, /- response: `NoteList` de `\.\.\/\.\.\/shared\/notes\.js`/);
    const member = hoverText("get({ query", 1);
    assert.match(member, /get\(input\?/);
    assert.match(member, /\*\*GET\*\* `\/api\/notes`/);
    for (const needle of ["\"/api/notes\"", "get({ query"]) {
      const [target] = definition(component, component.at(needle, 2)) as Location[];
      assert.equal(fileURLToPath(target!.uri).toLowerCase(), workspace.file("server/api/notes.get.ts").toLowerCase());
      assert.deepEqual(target!.range.start, { line: 5, character: 2 });
    }
  });

  test("a segment call and its byId alias show the endpoint of the dynamic route", () => {
    for (const [needle, delta] of [["notes({ id", 1], ["get();", 1], ["byId.get", 1], ["byId.get", 6]] as const) {
      const text = hoverText(needle, delta, "api.notes({");
      assert.match(text, /\*\*GET\*\* `\/api\/notes\/\[id\]` → handler \[server\/api\/notes\/\[id\]\.get\.ts\]/, `${needle}: ${text}`);
      assert.match(text, /- params: `NoteParams`/);
      const [target] = definition(component, component.at(needle, delta, "api.notes({")) as Location[];
      assert.equal(fileURLToPath(target!.uri).toLowerCase(), workspace.file("server/api/notes/[id].get.ts").toLowerCase());
    }
    // The static member of the same node keeps its own endpoint.
    assert.match(hoverText("get({ query", 1), /\*\*GET\*\* `\/api\/notes` →/);
  });

  test("useRpcQuery and rpc.* show the procedure, its schemas and handler", () => {
    for (const [needle, delta] of [["\"users.get\"", 1], ["users.get({ id", 7]] as const) {
      const text = hoverText(needle, delta);
      assert.match(text, /\*\*RPC\*\* `users\.get` \(POST `\/_meeko\/rpc\/users\/get`\) → handler \[server\/rpc\/users\/get\.ts\]/, text);
      assert.match(text, /- input: `users\.UserInput` de `\.\.\/\.\.\/\.\.\/shared\/users\.js`/);
      assert.match(text, /- output: `users\.User`/);
      const [target] = definition(component, component.at(needle, delta)) as Location[];
      assert.equal(fileURLToPath(target!.uri).toLowerCase(), workspace.file("server/rpc/users/get.ts").toLowerCase());
    }
  });
});
