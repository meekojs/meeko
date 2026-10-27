const assert = require("node:assert/strict");
const { existsSync, writeFileSync } = require("node:fs");
const { createServer } = require("node:http");
const path = require("node:path");
const { pathToFileURL } = require("node:url");
const vscode = require("vscode");

async function waitFor(check, message, timeout = 15000) {
  const start = Date.now();
  for (;;) {
    const value = await check();
    if (value) return value;
    if (Date.now() - start > timeout) throw new Error(typeof message === "function" ? message() : message);
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
}

/**
 * `meeko dev` mínimo: el puente real del paquete instalado en el consumidor, en loopback,
 * con una pestaña de navegador falsa que contesta las órdenes del editor.
 */
async function startDevBridge(consumer, signals) {
  const { startEditorBridge } = await import(pathToFileURL(path.join(consumer, "node_modules", "@meekojs", "meeko", "dist", "framework", "editor-bridge.js")).href);
  const listeners = new Map();
  const emit = (event, data) => { for (const listener of listeners.get(event) ?? []) listener(data, tab); };
  const commands = [];
  const tab = {
    send(_event, message) {
      if (message.type !== "setSignal") return;
      commands.push(message);
      const current = signals.find((item) => item.instanceId === message.instanceId && item.name === message.name);
      current.json = JSON.stringify(message.value);
      emit("meeko:live:result", { request: message.request, result: { ok: true } });
      emit("meeko:live:update", { reset: false, removed: [], signals: [current] });
    },
  };
  const hot = {
    on(event, listener) { if (!listeners.has(event)) listeners.set(event, new Set()); listeners.get(event).add(listener); },
    off(event, listener) { listeners.get(event)?.delete(listener); },
    send(event, message) {
      // The browser starts sending once an editor subscribes.
      if (event === "meeko:live" && message.type === "state" && message.active) {
        setTimeout(() => emit("meeko:live:update", { reset: true, removed: [], signals }), 10);
      }
    },
  };
  let bridge;
  const server = createServer((request, response) => { if (!bridge.handle(request, response)) { response.statusCode = 404; response.end(); } });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  bridge = await startEditorBridge({ root: consumer, origin: `http://127.0.0.1:${server.address().port}`, hot });
  emit("meeko:live:hello", {});
  return {
    bridge, commands,
    async stop() {
      await bridge.close();
      server.closeAllConnections();
      await new Promise((resolve) => server.close(resolve));
    },
  };
}

exports.run = async function run() {
  const consumer = process.env.MEEKO_HOST_CONSUMER;
  const file = path.join(consumer, "Live.meeko");
  writeFileSync(file, [
    "<script lang=\"ts\">",
    "import { signal } from \"@meekojs/meeko\";",
    "const count = signal(0);",
    "const profile = signal({ name: \"Ada\" });",
    "</script>",
    "<template><p>{count.value} {profile.value.name}</p></template>",
    "",
  ].join("\n"));
  const extension = vscode.extensions.getExtension("meekojs.meeko-language");
  const api = await extension.activate();
  assert.ok(api.live, "La extensión expone el estado de los valores en vivo");
  assert.deepEqual(extension.packageJSON.contributes.commands.map((command) => `${command.category}: ${command.title}`), ["Meeko: Editar valor de la señal", "Meeko: Reconectar valores en vivo"]);

  const uri = vscode.Uri.file(file);
  const document = await vscode.workspace.openTextDocument(uri);
  await vscode.window.showTextDocument(document);
  await waitFor(() => api.live.status === "$(debug-disconnect) Meeko live: desconectado", () => `Estado sin meeko dev: ${api.live.status}`);

  const bridgeFile = file.replaceAll("\\", "/");
  const signals = [
    { instanceId: "meeko-1", component: "Live", file: bridgeFile, name: "count", line: 3, column: 7, json: "3", truncated: false },
    { instanceId: "meeko-2", component: "Live", file: bridgeFile, name: "count", line: 3, column: 7, json: "5", truncated: false },
    { instanceId: "meeko-1", component: "Live", file: bridgeFile, name: "profile", line: 4, column: 7, json: "{\"name\":\"Ada\"}", truncated: false },
  ];
  let dev = await startDevBridge(consumer, signals);
  await waitFor(() => api.live.connected, "La extensión no detectó .meeko/dev/editor-bridge-<puerto>.json");
  assert.equal(api.live.status, "$(pulse) Meeko live: conectado");
  const decorations = await waitFor(() => api.live.decorations(uri).length === 2 && api.live.decorations(uri), () => `Decoraciones: ${JSON.stringify(api.live.decorations(uri))}`);
  assert.deepEqual(decorations.map((item) => [item.line, item.text]), [[2, "count = 3 · 2 instancias"], [3, "profile = {\"name\":\"Ada\"}"]]);

  const hovers = await vscode.commands.executeCommand("vscode.executeHoverProvider", uri, new vscode.Position(5, document.lineAt(5).text.indexOf("count") + 1));
  const hoverText = hovers.flatMap((hover) => hover.contents.map((content) => typeof content === "string" ? content : content.value)).join("\n");
  assert.match(hoverText, /Meeko live/);
  assert.match(hoverText, /2 instancias/);
  assert.match(hoverText, /```json\n3\n```/);
  assert.match(hoverText, /```json\n5\n```/);
  assert.match(hoverText, /command:meeko\.live\.editSignal/);

  await vscode.commands.executeCommand("meeko.live.editSignal", { id: "tab1/meeko-1/count", json: "42" });
  assert.deepEqual(dev.commands.map((command) => [command.instanceId, command.name, command.value]), [["meeko-1", "count", 42]]);
  await waitFor(() => api.live.decorations(uri).some((item) => item.text === "count = 42 · 2 instancias" && item.flashing), () => `Sin resaltado del cambio: ${JSON.stringify(api.live.decorations(uri))}`);
  await waitFor(() => api.live.decorations(uri).every((item) => !item.flashing), "El resaltado debe ser breve");

  await vscode.workspace.getConfiguration("meeko").update("live.inlineValues", false, vscode.ConfigurationTarget.Global);
  await waitFor(() => api.live.decorations(uri).length === 0, "meeko.live.inlineValues=false quita las decoraciones");
  await vscode.workspace.getConfiguration("meeko").update("live.inlineValues", undefined, vscode.ConfigurationTarget.Global);
  await waitFor(() => api.live.decorations(uri).length === 2, "Las decoraciones vuelven al reactivar el ajuste");

  // meeko dev stops: the descriptor goes away and the values with it.
  await dev.stop();
  assert.equal(existsSync(dev.bridge.file), false);
  await waitFor(() => !api.live.connected && api.live.decorations(uri).length === 0, "Al parar meeko dev desaparecen los valores");
  await waitFor(() => api.live.status === "$(debug-disconnect) Meeko live: desconectado", () => `Estado tras parar: ${api.live.status}`);

  // meeko dev starts again on another port with another token.
  dev = await startDevBridge(consumer, signals);
  await waitFor(() => api.live.connected && api.live.decorations(uri).length === 2, "La extensión debe reconectar al reiniciar meeko dev");

  await vscode.workspace.getConfiguration("meeko").update("live.enabled", false, vscode.ConfigurationTarget.Global);
  await waitFor(() => !api.live.connected && api.live.connections === 0 && api.live.decorations(uri).length === 0 && api.live.status === undefined, "meeko.live.enabled=false desconecta");
  await vscode.workspace.getConfiguration("meeko").update("live.enabled", undefined, vscode.ConfigurationTarget.Global);
  await waitFor(() => api.live.connected, "Reactivar meeko.live.enabled reconecta");
  await dev.stop();
};
