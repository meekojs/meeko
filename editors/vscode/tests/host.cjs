const assert = require("node:assert/strict");
const path = require("node:path");
const vscode = require("vscode");

async function waitForDiagnostics(uri, code) {
  for (let attempt = 0; attempt < 60; attempt++) {
    const found = vscode.languages.getDiagnostics(uri);
    if (found.some((item) => item.code === code)) return found;
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  throw new Error(`No apareció el diagnóstico ${code} en ${uri.fsPath}`);
}

exports.run = async function run() {
  const component = path.join(process.env.MEEKO_HOST_CONSUMER, "Counter.meeko");
  const uri = vscode.Uri.file(component);
  const document = await vscode.workspace.openTextDocument(uri);
  const extension = vscode.extensions.getExtension("meekojs.meeko-language");
  assert.ok(extension, "No se encontró la extensión empaquetada");
  await extension.activate();

  const diagnostics = await waitForDiagnostics(uri, "TS2322");
  assert.ok(diagnostics.some((item) => item.source === "Meeko"));

  const source = document.getText();
  const use = source.indexOf("count.value", source.indexOf("<template>"));
  const declaration = source.indexOf("const count") + "const ".length;
  const position = document.positionAt(use + 2);
  const definitions = await vscode.commands.executeCommand("vscode.executeDefinitionProvider", uri, position);
  assert.ok(definitions.some((item) => item.uri.fsPath.toLowerCase() === component.toLowerCase() && document.offsetAt(item.range.start) === declaration), "Definición del script desde plantilla");

  const hover = await vscode.commands.executeCommand("vscode.executeHoverProvider", uri, position);
  assert.ok(hover.length > 0, "Hover TypeScript");

  const rename = await vscode.commands.executeCommand("vscode.executeDocumentRenameProvider", uri, position, "value");
  assert.ok(rename.get(uri).length >= 2, "Renombrado entre script y plantilla");

  const completions = await vscode.commands.executeCommand("vscode.executeCompletionItemProvider", uri, document.positionAt(use + "count.".length));
  assert.ok(completions.items.some((item) => item.label === "value"), "Completado de señal");

  const formatting = await vscode.commands.executeCommand("vscode.executeFormatDocumentProvider", uri, { tabSize: 2, insertSpaces: true });
  assert.ok(formatting?.length, "Formato de la sección TypeScript");
  let formatted = source;
  for (const edit of [...formatting].sort((left, right) => document.offsetAt(right.range.start) - document.offsetAt(left.range.start))) {
    const start = document.offsetAt(edit.range.start);
    const end = document.offsetAt(edit.range.end);
    formatted = formatted.slice(0, start) + edit.newText + formatted.slice(end);
  }
  assert.ok(formatted.includes("const count = signal(0);"), `Resultado del formato TypeScript: ${JSON.stringify(formatted.slice(0, 150))}, ediciones=${JSON.stringify(formatting.map((item) => ({ start: document.offsetAt(item.range.start), end: document.offsetAt(item.range.end), text: item.newText })))}`);
};
