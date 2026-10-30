import assert from "node:assert/strict";
import { test } from "node:test";
import {
  SseParser, aliasDescription, bridgeDescriptorGlob, bridgeOffFromRecord, devServerRecordGlob, editableValue, fileKey, formatValue, groupSignals, hoverMarkdown, inlineText, isWorkspaceBridgeDescriptor, isWorkspaceDevServerRecord, liveStatus, loopbackBridgeUrl, parseEditedValue, placeGroups, previewValue,
} from "../src/live/model.js";
import type { EditorLiveSignal } from "../src/live/model.js";

function signal(overrides: Partial<EditorLiveSignal>): EditorLiveSignal {
  const base: EditorLiveSignal = { id: "tab1/meeko-1/count", tab: "tab1", instanceId: "meeko-1", component: "Counter", name: "count", file: "D:/app/pages/Counter.meeko", line: 2, column: 7, json: "3", truncated: false };
  return { ...base, ...overrides };
}

function withoutSite(value: EditorLiveSignal): EditorLiveSignal {
  const { line: _line, column: _column, ...rest } = value;
  return rest;
}

const source = [
  "<script lang=\"ts\">",
  "const count = signal(3);",
  "const items = signal([1, 2]);",
  "</script>",
  "<template><p>{count.value}</p></template>",
];

test("agrupa por archivo y declaración, con rutas de Windows sin distinguir mayúsculas", () => {
  const signals = [
    signal({}),
    signal({ id: "tab1/meeko-10/count", instanceId: "meeko-10", json: "7" }),
    signal({ id: "tab1/meeko-2/count", instanceId: "meeko-2", json: "5" }),
    signal({ id: "tab1/meeko-1/items", name: "items", line: 3, json: "[1,2]" }),
    signal({ id: "tab1/meeko-3/other", file: "D:/app/pages/Other.meeko" }),
    withoutSite(signal({ id: "tab1/meeko-4/nosite", name: "nosite" })),
  ];
  const groups = groupSignals(signals, "d:\\app\\pages\\Counter.meeko", true);
  assert.deepEqual(groups.map((group) => [group.name, group.line, group.signals.map((item) => item.instanceId)]), [
    ["count", 2, ["meeko-1", "meeko-2", "meeko-10"]],
    ["items", 3, ["meeko-1"]],
  ]);
  assert.deepEqual(groupSignals(signals, "d:\\app\\pages\\Counter.meeko", false), [], "En Linux la ruta distingue mayúsculas");
  assert.equal(fileKey("C:\\A\\b.meeko", true), "c:/a/b.meeko");
});

test("sitúa cada valor en la línea de su declaración y la busca si el documento cambió", () => {
  const groups = groupSignals([signal({}), signal({ id: "tab1/meeko-1/items", name: "items", line: 3, json: "[1,2]" })], "D:/app/pages/Counter.meeko", true);
  assert.deepEqual(placeGroups(groups, source).map((placement) => [placement.group.name, placement.line]), [["count", 1], ["items", 2]]);
  const edited = ["// new line", ...source];
  assert.deepEqual(placeGroups(groups, edited).map((placement) => [placement.group.name, placement.line]), [["count", 2], ["items", 3]]);
  const renamed = source.map((line) => line.replace("const items", "const things"));
  assert.deepEqual(placeGroups(groups, renamed).map((placement) => placement.group.name), ["count"], "Una señal que ya no existe no se decora");
  const prefix = groupSignals([signal({ name: "co", id: "x", line: 2, column: 7 })], "D:/app/pages/Counter.meeko", true);
  assert.deepEqual(placeGroups(prefix, source), [], "El nombre debe coincidir completo");
});

test("formatea la decoración, el hover y los valores recortados", () => {
  const [single] = groupSignals([signal({ json: "{\"a\":1,\"b\":[true,null]}" })], "D:/app/pages/Counter.meeko", true);
  assert.ok(single);
  assert.equal(inlineText(single), "count = {\"a\":1,\"b\":[true,null]}");
  const [many] = groupSignals([signal({}), signal({ id: "tab2/meeko-1/count", tab: "tab2", json: "9" }), signal({ id: "tab1/meeko-5/count", instanceId: "meeko-5", json: "4" })], "D:/app/pages/Counter.meeko", true);
  assert.ok(many);
  assert.equal(inlineText(many), "count = 3 · 3 instancias");
  assert.equal(previewValue(signal({ json: JSON.stringify("x".repeat(100)) }), 20).length, 20);
  assert.equal(previewValue(signal({ json: "[1,2", truncated: true })), "[1,2…");
  assert.equal(formatValue(signal({ json: "{\"a\":1}" })), "{\n  \"a\": 1\n}");
  assert.equal(formatValue(signal({ json: "[1,2", truncated: true })), "[1,2…");
  const markdown = hoverMarkdown(many, (item) => `command:edit?${item.id}`);
  assert.match(markdown, /3 instancias/);
  assert.match(markdown, /\[Editar valor\]\(command:edit\?tab1\/meeko-1\/count\)/);
  assert.equal(markdown.match(/```json/g)?.length, 3);
  const hostile = hoverMarkdown({ name: "x", line: 1, column: 1, signals: [signal({ component: "[x](command:evil)", json: JSON.stringify("```\n[link](command:evil)") })] });
  const header = hostile.split("\n\n")[1] ?? "";
  assert.ok(header.startsWith(String.raw`\[x\]\(command:evil\)`), `El nombre del componente no puede inyectar enlaces: ${header}`);
  assert.match(hostile, /````json/, "El valor no puede cerrar su bloque de código");
});

test("marca los alias de defineModel en la decoración y en el hover", () => {
  const alias = { id: "tab1/meeko-5/dialogOpen", instanceId: "meeko-5", component: "lab", name: "dialogOpen", file: "D:/app/pages/lab.meeko", line: 5, column: 8 };
  const open = signal({ id: "tab1/meeko-4/open", instanceId: "meeko-4", component: "Modal", name: "open", file: "D:/app/components/App/Modal.meeko", line: 13, column: 8, json: "true", alias });
  const [group] = groupSignals([open], "D:/app/components/App/Modal.meeko", true);
  assert.ok(group);
  assert.equal(inlineText(group), "open = true (= dialogOpen)");
  // Markdown renders `lab\.meeko:5` as «lab.meeko:5».
  assert.equal(aliasDescription(alias), "alias de `dialogOpen` (lab\\.meeko:5)");
  const { line: _line, column: _column, ...unsited } = alias;
  assert.equal(aliasDescription(unsited), "alias de `dialogOpen` (lab\\.meeko)");
  assert.equal(aliasDescription({ ...alias, name: "a`b", file: "C:\\app\\[x].meeko" }), "alias de `` a`b `` (\\[x\\]\\.meeko:5)", "El nombre y el archivo no pueden inyectar Markdown");
  const markdown = hoverMarkdown(group, (item) => `command:edit?${item.id}`);
  assert.match(markdown, /Modal · meeko\\-4 · tab1 · alias de `dialogOpen` \(lab\\\.meeko:5\)/);
  const [principal] = groupSignals([signal({ id: alias.id, instanceId: "meeko-5", component: "lab", name: "dialogOpen", file: alias.file, line: 5, column: 8, json: "true" })], alias.file, true);
  assert.ok(principal);
  assert.equal(inlineText(principal), "dialogOpen = true", "La principal no lleva marca");
  assert.equal(bridgeDescriptorGlob, "**/.meeko/dev/editor-bridge-*.json");
});

test("sólo se conecta a los descriptores de proyectos del workspace", () => {
  for (const path of [".meeko/dev/editor-bridge-4173.json", "apps/web/.meeko/dev/editor-bridge-5173.json", "apps\\web\\.meeko\\dev\\editor-bridge-1.json"]) {
    assert.ok(isWorkspaceBridgeDescriptor(path), path);
  }
  for (const path of [
    "node_modules/@meekojs/meeko/.meeko/editor-bridge-x/.meeko/dev/editor-bridge-50705.json",
    "node_modules/@meekojs/meeko/.claude/worktrees/a/.meeko/tmp/dev-watch-y/.meeko/dev/editor-bridge-1.json",
    ".meeko/tmp/dev-editor-bridge-z/.meeko/dev/editor-bridge-2.json",
    "apps\\web\\node_modules\\pkg\\.meeko\\dev\\editor-bridge-3.json",
    ".meeko/dev/editor-bridge.json",
    ".meeko/dev/other-4173.json",
  ]) {
    assert.ok(!isWorkspaceBridgeDescriptor(path), path);
  }
});

test("valida el JSON editado y propone el valor actual", () => {
  assert.deepEqual(parseEditedValue(" {\"a\": [1, 2]} "), { ok: true, value: { a: [1, 2] } });
  assert.deepEqual(parseEditedValue("null"), { ok: true, value: null });
  assert.equal(parseEditedValue("{a:1}").ok, false);
  assert.equal(parseEditedValue("  ").ok, false);
  assert.equal(editableValue(signal({ json: "{\n\"a\": 1\n}" })), "{\"a\":1}");
  assert.equal(editableValue(signal({ json: "[1,", truncated: true })), "", "Un valor recortado no se propone para editar");
});

test("sólo acepta URLs del puente en loopback", () => {
  assert.equal(loopbackBridgeUrl("http://127.0.0.1:4173/__meeko/editor-bridge")?.port, "4173");
  assert.ok(loopbackBridgeUrl("http://[::1]:4173/__meeko/editor-bridge"));
  assert.ok(loopbackBridgeUrl("http://localhost:4173/x"));
  assert.equal(loopbackBridgeUrl("http://192.168.1.4:4173/x"), undefined);
  assert.equal(loopbackBridgeUrl("https://127.0.0.1/x"), undefined);
  assert.equal(loopbackBridgeUrl("http://user:pass@127.0.0.1/x"), undefined);
  assert.equal(loopbackBridgeUrl("http://127.0.0.1.evil.example/x"), undefined);
  assert.equal(loopbackBridgeUrl(3), undefined);
});

test("lee eventos SSE partidos en trozos y omite comentarios", () => {
  const events: Array<[string, string]> = [];
  const parser = new SseParser((event, data) => events.push([event, data]));
  parser.push(": ping\n\nevent: hel");
  parser.push("lo\ndata: {\"a\":1}\r\n\r\n");
  parser.push("data: x\ndata: y\n\n");
  assert.deepEqual(events, [["hello", "{\"a\":1}"], ["message", "x\ny"]]);
});

test("el registro de meeko dev dice si se arrancó sin puente, sólo en proyectos del workspace", () => {
  assert.equal(devServerRecordGlob, "**/.meeko/dev/server.json");
  assert.equal(isWorkspaceDevServerRecord(".meeko/dev/server.json"), true);
  assert.equal(isWorkspaceDevServerRecord("apps/site/.meeko/dev/server.json"), true);
  assert.equal(isWorkspaceDevServerRecord("node_modules/@meekojs/meeko/.meeko/dev/server.json"), false);
  assert.equal(isWorkspaceDevServerRecord(".meeko/tmp/app/.meeko/dev/server.json"), false);
  assert.equal(isWorkspaceDevServerRecord(".meeko/dev/editor-bridge-4173.json"), false);
  // Un meeko dev con puente, o anterior a 1.7.1, no escribe editorBridge.
  assert.equal(bridgeOffFromRecord(JSON.stringify({ pid: 42, startedAt: "2026-10-29T00:00:00.000Z" })), undefined);
  assert.deepEqual(bridgeOffFromRecord(JSON.stringify({ pid: 42, startedAt: "x", editorBridge: false, editorBridgeReason: "MEEKO_EDITOR_BRIDGE=0" })), { pid: 42, reason: "MEEKO_EDITOR_BRIDGE=0" });
  assert.deepEqual(bridgeOffFromRecord(JSON.stringify({ pid: 42, editorBridge: false })), { pid: 42, reason: "sin motivo registrado" });
  for (const invalid of ["", "null", "{", JSON.stringify({ pid: -1, editorBridge: false }), JSON.stringify({ pid: "42", editorBridge: false })]) {
    assert.equal(bridgeOffFromRecord(invalid), undefined, invalid);
  }
});

test("la barra de estado explica un meeko dev sin puente; una conexión gana", () => {
  const off = [{ pid: 42, reason: "MEEKO_EDITOR_BRIDGE=0" }];
  const disabled = liveStatus([], 0, off);
  assert.equal(disabled.text, "$(circle-slash) Meeko live: desactivado en meeko dev");
  assert.match(disabled.tooltip, /meeko dev \(PID 42\): MEEKO_EDITOR_BRIDGE=0/);
  assert.match(disabled.tooltip, /MEEKO_EDITOR_BRIDGE=0 \(en el entorno o en el \.env del proyecto\)/);
  assert.equal(liveStatus(["http://127.0.0.1:4173/__meeko/editor-bridge"], 1, off).text, "$(pulse) Meeko live: conectado");
  assert.deepEqual(liveStatus([], 1, []), { text: "$(debug-disconnect) Meeko live: desconectado", tooltip: "meeko dev no responde. Pulsa para reconectar." });
  assert.equal(liveStatus([], 0, []).tooltip, "Arranca meeko dev para ver los valores de las señales junto al código.");
});
