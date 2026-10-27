import assert from "node:assert/strict";
import { PassThrough } from "node:stream";
import { after, before, describe, test } from "node:test";
import { pathToFileURL } from "node:url";
import {
  CodeLensRequest, createConnection, createProtocolConnection, DidOpenTextDocumentNotification, InitializedNotification, InitializeRequest,
  PublishDiagnosticsNotification, ShutdownRequest, StreamMessageReader, StreamMessageWriter,
} from "vscode-languageserver/node";
import { ExecutionZonesRequest, startLanguageServer } from "../src/language-server/server.ts";
import { executionZones } from "../src/language-server/zones.ts";
import { languageProject } from "./language-server-workspace.ts";
import type { LanguageProject } from "./language-server-workspace.ts";

const page = `<script server lang="ts">
import { definePage } from "@meekojs/meeko/framework";
export const route = definePage({ load: () => ({ title: "Hi" }) });
</script>

<script lang="ts">
import { signal } from "@meekojs/meeko";
const props = defineProps<{ data: { title: string } }>();
const count = signal(0);
onMounted(() => {
  count.value = 1;
});
const input = await useElementRef("field");
input.focus();
</script>
<template><input ref:field />{props.data.title}{count.value}</template>
`;

const clientPage = `<script server lang="ts">
import { definePage } from "@meekojs/meeko/framework";
export const route = definePage({ render: "client" });
</script>
<script lang="ts">
const value = 1;
</script>
<template><p>{value}</p></template>
`;

const component = `<script lang="ts">
const value = 1;
onMounted(() => { console.log(value); });
</script>
<template><p>{value}</p></template>
`;

// The consumer app's case: functions used only from browser code are browser zones.
const resize = `<script lang="ts">
import { effect, signal } from "@meekojs/meeko";
const width = signal(0);
const clicks = signal(0);
effect(() => {
  console.log(width.value);
  track();
});
onMounted(() => {
  measure();
});
function onResize(): void {
  width.value = window.innerWidth;
}
function track(): void {
  clicks.value++;
}
const handleClick = () => {
  logClick();
};
function logClick(): void {
  console.log(clicks.value);
}
function measure(): void {
  width.value = document.body.clientWidth;
}
const label = (): string => \`\${width.value}px\`;
function unused(): void {}
const panel = await useElementRef("panel");
panel.focus();
</script>
<template>
  <section ref:panel>
    <p on:click="onResize">{label()}</p>
    <button on:click="track">+</button>
    <button on:click="handleClick">log</button>
    <button
      on:click="() => {
        onResize();
      }"
    >x</button>
    <button on:click="() => onResize()">y</button>
  </section>
</template>
`;

const child = `<script lang="ts">
const props = defineProps<{ run: () => void }>();
const emit = defineEmits<{ save: [] }>();
</script>
<template><button on:click="() => emit('save')">{String(props.run)}</button></template>
`;

const parent = `<script lang="ts">
import Child from "./Child.meeko";
function save(): void {
  console.log("save");
}
function asProp(): void {
  console.log("prop");
}
function exposed(): void {
  console.log("exposed");
}
function called(): void {
  console.log("called");
}
function bound(): () => void {
  return () => console.log("bound");
}
function shadowed(): void {
  console.log("shadowed");
}
function local(shadowed: () => void): void {
  shadowed();
}
called();
defineExpose({ exposed });
</script>
<template><Child on:save="save" bind:run="asProp" /><p on:click="bound()" on:dblclick="local">x</p></template>
`;

describe("language server: execution zones", () => {
  let workspace: LanguageProject;

  before(async () => {
    workspace = await languageProject("lsp-zones-", {
      "app/pages/index.meeko": page,
      "app/pages/client.meeko": clientPage,
      "app/components/Plain.meeko": component,
      "app/components/Resize.meeko": resize,
      "app/components/Child.meeko": child,
      "app/components/Parent.meeko": parent,
    });
  });

  after(async () => {
    await workspace?.dispose();
  });

  const lineOf = (source: string, needle: string): number => source.slice(0, source.indexOf(needle)).split("\n").length - 1;

  test("a page has a server-only block, a shared setup, onMounted and the browser continuation", async () => {
    const context = await workspace.open("app/pages/index.meeko");
    const zones = executionZones(context.component, workspace.project.sourceRoots());
    assert.deepEqual(zones.map((zone) => [zone.kind, zone.reason, zone.startLine, zone.endLine]), [
      ["server", "server-block", 0, lineOf(page, "</script>")],
      ["shared", "setup", lineOf(page, "<script lang"), lineOf(page, "const count")],
      ["browser", "onMounted", lineOf(page, "onMounted"), lineOf(page, "});\nconst input")],
      ["browser", "continuation", lineOf(page, "const input"), lineOf(page, "</script>\n<template")],
    ]);
    assert.equal(zones[0]!.label, "Sólo servidor");
    assert.equal(zones[1]!.label, "Servidor y navegador");
    assert.equal(zones[2]!.label, "Sólo navegador");
    assert.match(zones[3]!.detail, /continúa en el navegador/);
  });

  test("a client page runs its route block and setup in the browser", async () => {
    const context = await workspace.open("app/pages/client.meeko");
    const zones = executionZones(context.component, workspace.project.sourceRoots());
    assert.deepEqual(zones.map((zone) => [zone.kind, zone.reason]), [["browser", "client-route-block"], ["browser", "client-page"]]);
  });

  test("the server answers meeko/executionZones and code lenses over LSP", async () => {
    const toServer = new PassThrough();
    const toClient = new PassThrough();
    const server = createConnection(new StreamMessageReader(toServer), new StreamMessageWriter(toClient));
    startLanguageServer(server);
    server.listen();
    const client = createProtocolConnection(new StreamMessageReader(toClient), new StreamMessageWriter(toServer));
    client.onNotification("window/logMessage", () => undefined);
    client.onNotification(PublishDiagnosticsNotification.type, () => undefined);
    client.listen();
    try {
      const result = await client.sendRequest(InitializeRequest.type, {
        processId: null, rootUri: pathToFileURL(workspace.root).href, workspaceFolders: null,
        capabilities: { workspace: { workspaceEdit: { documentChanges: true, resourceOperations: ["create", "rename", "delete"] } } },
        initializationOptions: { trusted: false, projectContracts: false, diagnosticsDelay: 0 },
      });
      assert.deepEqual(result.capabilities.codeLensProvider, { resolveProvider: false });
      assert.deepEqual(result.capabilities.codeActionProvider, { codeActionKinds: ["quickfix", "refactor.rewrite"] });
      assert.ok(result.capabilities.semanticTokensProvider?.legend.tokenModifiers.includes("signal"));
      await client.sendNotification(InitializedNotification.type, {});
      const uri = pathToFileURL(workspace.file("app/pages/index.meeko")).href;
      await client.sendNotification(DidOpenTextDocumentNotification.type, { textDocument: { uri, languageId: "meeko", version: 1, text: page } });
      const zones = await client.sendRequest(ExecutionZonesRequest, { textDocument: { uri } });
      assert.deepEqual(zones?.zones.map((zone) => zone.kind), ["server", "shared", "browser", "browser"]);
      assert.deepEqual(zones?.zones[0]!.range, { start: { line: 0, character: 0 }, end: { line: 3, character: "</script>".length } });
      const lenses = await client.sendRequest(CodeLensRequest.type, { textDocument: { uri } });
      assert.ok(lenses?.some((lens) => lens.command?.title.startsWith("Ruta / · render ssr")), JSON.stringify(lenses));
      assert.ok(lenses?.some((lens) => lens.command?.title === "1 lectura · 1 escritura · en la plantilla"), JSON.stringify(lenses));
      assert.equal(await client.sendRequest(ExecutionZonesRequest, { textDocument: { uri: pathToFileURL(workspace.file("notes.txt")).href } }), null);
    } finally {
      await client.sendRequest(ShutdownRequest.type);
      client.dispose();
      server.dispose();
    }
  });

  test("a component outside app/pages has a shared setup with onMounted lines in the browser", async () => {
    const context = await workspace.open("app/components/Plain.meeko");
    const zones = executionZones(context.component, workspace.project.sourceRoots());
    assert.deepEqual(zones.map((zone) => [zone.kind, zone.startLine, zone.endLine]), [["shared", 0, 1], ["browser", 2, 2], ["shared", 3, 3]]);
  });

  const lines = (source: string, from: string, to: string): [number, number] => [lineOf(source, from), lineOf(source, to)];

  test("setup functions used only from browser code are browser zones, transitively", async () => {
    const context = await workspace.open("app/components/Resize.meeko");
    const zones = executionZones(context.component, workspace.project.sourceRoots());
    assert.deepEqual(zones.map((zone) => [zone.kind, zone.reason, zone.startLine, zone.endLine]), [
      ["shared", "setup", 0, lineOf(resize, "});\nonMounted")],
      ["browser", "onMounted", ...lines(resize, "onMounted", "});\nfunction onResize")],
      // Only `on:click`, also from inline arrows: browser.
      ["browser", "browser-function", ...lines(resize, "function onResize", "}\nfunction track")],
      // Used in `on:click` and in an `effect`: the effect runs during SSR.
      ["shared", "setup", ...lines(resize, "function track", "}\nconst handleClick")],
      ["browser", "browser-function", ...lines(resize, "const handleClick", "};\nfunction logClick")],
      // Called only from the browser handler `handleClick`.
      ["browser", "browser-function", ...lines(resize, "function logClick", "}\nfunction measure")],
      ["browser", "browser-function", ...lines(resize, "function measure", "}\nconst label")],
      // Rendered by the template, and unused: shared.
      ["shared", "setup", ...lines(resize, "const label", "function unused")],
      ["browser", "continuation", ...lines(resize, "const panel", "</script>")],
      // A multiline inline handler on its own lines; the one-line `on:click` beside its tag is not a zone.
      ["browser", "inline-handler", ...lines(resize, "on:click=\"() => {", "}\"\n    >x")],
    ]);
    const detail = (needle: string) => zones.find((zone) => zone.startLine === lineOf(resize, needle))?.detail;
    assert.equal(detail("function onResize"), "Sólo se usa como manejador de `on:click`, así que nunca se ejecuta durante el SSR.");
    assert.match(detail("function logClick")!, /desde la función de navegador `handleClick`/);
    assert.match(detail("function measure")!, /en `onMounted`/);
    assert.match(detail("on:click=\"() => {")!, /manejador de `on:click`: sólo se ejecuta en el navegador/);
  });

  test("component events are browser uses; props, defineExpose, calls and calls in handlers keep functions shared", async () => {
    const context = await workspace.open("app/components/Parent.meeko");
    const zones = executionZones(context.component, workspace.project.sourceRoots());
    assert.deepEqual(zones.map((zone) => [zone.kind, zone.reason, zone.startLine, zone.endLine]), [
      ["shared", "setup", 0, lineOf(parent, "import Child")],
      ["browser", "browser-function", ...lines(parent, "function save", "}\nfunction asProp")],
      // `asProp` is a prop, `exposed` goes to defineExpose, `called` runs in the setup, `bound()` is
      // called while the handler is bound and the only `shadowed` reference is a parameter.
      ["shared", "setup", ...lines(parent, "function asProp", "}\nfunction local")],
      ["browser", "browser-function", ...lines(parent, "function local", "}\ncalled()")],
      ["shared", "setup", ...lines(parent, "called();", "</script>")],
    ]);
    assert.match(zones[1]!.detail, /manejador de `on:save`/);
  });
});
