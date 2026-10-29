import assert from "node:assert/strict";
import { after, before, describe, test } from "node:test";
import { fileURLToPath } from "node:url";
import type { Location, MarkupContent } from "vscode-languageserver/node";
import { definition, hover } from "../src/language-server/features.ts";
import { documentLinks, inlayHints, workspaceSymbols } from "../src/language-server/nav.ts";
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

const userList = `<script lang="ts">
interface User { id: string; email: string }
const users = signal<User[]>([]);
</script>
<template><ul><li each:of="users.value" each:as="user" each:key="user.id"><Rows bind:items="[user]"><snippet name="row" params="entry">{entry.email}</snippet></Rows></li></ul></template>
`;

const rows = `<script lang="ts" generic="T">
const props = defineProps<{ items: T[] }>();
const snippets = defineSnippets<{ row: [entry: T] }>();
</script>
<template><div each:of="props.items" each:as="item"><render snippet="snippets.row" args="item" /></div></template>
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
      "app/components/UserList.meeko": userList,
      "app/components/Rows.meeko": rows,
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

  test("the strings of href, useApi and useRpcQuery link to their page or handler", () => {
    const links = documentLinks(component);
    const linked = (needle: string) => links.find((link) => component.document.offsetAt(link.range.start) === component.offset(needle, 1));
    assert.equal(fileURLToPath(linked("\"/users/[id]\"")!.target!).toLowerCase(), workspace.file("app/pages/users/[id].meeko").toLowerCase());
    assert.match(linked("\"/api/notes\"")!.target!, /notes\.get\.ts#L\d+,\d+$/);
    assert.match(linked("\"users.get\"")!.target!, /rpc\/users\/get\.ts/);
    assert.equal(component.document.getText(linked("\"/users/[id]\"")!.range), "/users/[id]");
    assert.equal(linked("\"/nowhere\""), undefined, "a route that does not exist has no link");
  });

  test("workspace symbols list components, pages, endpoints and procedures", async () => {
    const all = (await workspaceSymbols([workspace.project], "")).map((symbol) => symbol.name);
    for (const name of ["UserList", "Rows", "/", "/users/[id]", "GET /api/notes", "GET /api/notes/[id]", "rpc.users.get"]) assert.ok(all.includes(name), `${name} in ${JSON.stringify(all)}`);
    assert.deepEqual((await workspaceSymbols([workspace.project], "usid")).map((symbol) => symbol.name), ["/users/[id]"]);
  });

  test("inlay hints show the type of each:as items and snippet parameters", async () => {
    const list = await workspace.open("app/components/UserList.meeko");
    const whole = { start: { line: 0, character: 0 }, end: list.document.positionAt(list.document.getText().length) };
    const hints = inlayHints(list, whole).map((hint) => [list.document.offsetAt(hint.position), hint.label]);
    assert.deepEqual(hints, [[list.offset("user\" each:key", 4), ": User"], [list.offset("entry\">", 5), ": User"]]);
  });
});

describe("language server: named layouts", () => {
  let workspace: LanguageProject;
  let component: OpenedComponent;

  before(async () => {
    workspace = await languageProject("lsp-layouts-", {
      "app/layouts/default.meeko": "<template><main><MeekoOutlet /></main></template>\n",
      "app/layouts/dashboard.meeko": "<script lang=\"ts\">\nexport interface Props { title?: string }\nconst props = defineProps<Props>();\n</script>\n<template><h1>{props.title}</h1><MeekoOutlet /></template>\n",
      "app/pages/index.meeko": "<template><p>Inicio</p></template>\n",
      "app/pages/panel.meeko": "<script server lang=\"ts\">\nexport const route = definePage({ layout: \"dashboard\" });\n</script>\n<template><p>Panel</p></template>\n",
    });
    await workspace.project.ready();
    component = await workspace.open("app/pages/panel.meeko");
  });

  after(async () => {
    await workspace?.dispose();
  });

  test("the layout of definePage shows its file and pages and goes to the layout", () => {
    assert.deepEqual(Object.keys(component.app?.layouts ?? {}).sort(), ["dashboard", "default"]);
    const text = (hover(component, component.at("\"dashboard\"", 2))?.contents as MarkupContent | undefined)?.value ?? "";
    assert.match(text, /\*\*Layout\*\* `dashboard` → \[app\/layouts\/dashboard\.meeko\]\(file:/);
    assert.match(text, /páginas: `\/panel`/);
    const [target] = definition(component, component.at("\"dashboard\"", 2)) as Location[];
    assert.equal(fileURLToPath(target!.uri).toLowerCase(), workspace.file("app/layouts/dashboard.meeko").toLowerCase());
  });
});

describe("language server: named route middleware", () => {
  let workspace: LanguageProject;
  let component: OpenedComponent;

  before(async () => {
    workspace = await languageProject("lsp-middleware-", {
      "app/middleware/10-locale.ts": "export default defineRouteMiddleware(() => undefined);\n",
      "app/middleware/20-auth.ts": "export default defineRouteMiddleware(() => undefined, { global: false });\n",
      "app/middleware/owner.server.ts": "export default defineServerRouteMiddleware(() => undefined, { global: false });\n",
      "app/pages/index.meeko": "<template><p>Inicio</p></template>\n",
      "app/pages/panel.meeko": "<script server lang=\"ts\">\nexport const route = definePage({ middleware: [\"auth\", \"locale\", \"owner\"] });\n</script>\n<template><p>Panel</p></template>\n",
    });
    await workspace.project.ready();
    component = await workspace.open("app/pages/panel.meeko");
  });

  after(async () => {
    await workspace?.dispose();
  });

  test("a name of middleware shows its file and pages and goes to the middleware; a global one says so", () => {
    assert.deepEqual(Object.keys(component.app?.middleware?.named ?? {}), ["auth", "owner"]);
    const text = (hover(component, component.at("\"auth\"", 2))?.contents as MarkupContent | undefined)?.value ?? "";
    assert.match(text, /\*\*Middleware\*\* `auth` → \[app\/middleware\/20-auth\.ts\]\(file:/);
    const [target] = definition(component, component.at("\"auth\"", 2)) as Location[];
    assert.equal(fileURLToPath(target!.uri).toLowerCase(), workspace.file("app/middleware/20-auth.ts").toLowerCase());
    const global = (hover(component, component.at("\"locale\"", 2))?.contents as MarkupContent | undefined)?.value ?? "";
    assert.match(global, /\*\*Middleware\*\* `locale` es global \(\[app\/middleware\/10-locale\.ts\]/);
    assert.deepEqual(definition(component, component.at("\"locale\"", 2)) ?? [], []);
    // A server route middleware says that it only runs on the server.
    const server = (hover(component, component.at("\"owner\"", 2))?.contents as MarkupContent | undefined)?.value ?? "";
    assert.match(server, /\*\*Middleware\*\* `owner` → \[app\/middleware\/owner\.server\.ts\]\(file:/);
    assert.match(server, /- sólo servidor: se ejecuta en el servidor/);
    assert.doesNotMatch(text, /sólo servidor/);
  });
});
