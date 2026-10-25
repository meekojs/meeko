const assert = require("node:assert/strict");
const { existsSync } = require("node:fs");
const path = require("node:path");
const vscode = require("vscode");

async function waitForDiagnostics(uri, code) {
  for (let attempt = 0; attempt < 60; attempt++) {
    const found = vscode.languages.getDiagnostics(uri);
    if (found.some((item) => item.code === code)) return found;
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  throw new Error(`No apareció el diagnóstico ${code} en ${uri.fsPath}; recibidos: ${JSON.stringify(vscode.languages.getDiagnostics(uri).map((item) => ({ code: item.code, message: item.message })))}`);
}

exports.run = async function run() {
  const component = path.join(process.env.MEEKO_HOST_CONSUMER, "Counter.meeko");
  const uri = vscode.Uri.file(component);
  const document = await vscode.workspace.openTextDocument(uri);
  const extension = vscode.extensions.getExtension("meekojs.meeko-language");
  assert.ok(extension, "No se encontró la extensión empaquetada");
  assert.equal(extension.packageJSON.icon, "./icons/meeko-logo.png");
  assert.ok(existsSync(path.join(extension.extensionPath, "icons", "meeko-logo.png")), "El logo debe estar empaquetado");
  assert.equal(extension.packageJSON.contributes.languages[0].icon.dark, "./icons/meeko-logo.png");
  await extension.activate();

  const diagnostics = await waitForDiagnostics(uri, "TS2322");
  assert.ok(diagnostics.some((item) => item.source === "Meeko"));

  const layoutUri = vscode.Uri.file(path.join(process.env.MEEKO_HOST_CONSUMER, "app", "layouts", "default.meeko"));
  const layoutDocument = await vscode.workspace.openTextDocument(layoutUri);
  assert.ok(vscode.workspace.isTrusted, "El host aislado debe confiar en su proyecto temporal para comprobar contratos");
  const contractErrors = await waitForDiagnostics(layoutUri, "MEEK_LAYOUT_PROPS");
  const contract = contractErrors.find((item) => item.code === "MEEK_LAYOUT_PROPS");
  assert.ok(contract && contract.source === "Meeko", "El contrato del layout debe aparecer en Problems");
  assert.equal(layoutDocument.offsetAt(contract.range.start), layoutDocument.getText().indexOf("{ outlet:"), "El contrato debe apuntar a defineProps en el .meeko");
  const layoutFix = new vscode.WorkspaceEdit();
  const missing = layoutDocument.getText().indexOf("; missing: string");
  layoutFix.delete(layoutUri, new vscode.Range(layoutDocument.positionAt(missing), layoutDocument.positionAt(missing + "; missing: string".length)));
  assert.ok(await vscode.workspace.applyEdit(layoutFix));
  assert.ok(await layoutDocument.save());
  let contractCleared = false;
  for (let attempt = 0; attempt < 60; attempt++) {
    if (!vscode.languages.getDiagnostics(layoutUri).some((item) => item.code === "MEEK_LAYOUT_PROPS")) { contractCleared = true; break; }
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  assert.ok(contractCleared, "El diagnóstico de contrato debe desaparecer tras corregir el layout");

  const dependentUri = vscode.Uri.file(path.join(process.env.MEEKO_HOST_CONSUMER, "app", "pages", "dependent.meeko"));
  await vscode.workspace.openTextDocument(dependentUri);
  await new Promise((resolve) => setTimeout(resolve, 1200));
  assert.ok(!vscode.languages.getDiagnostics(dependentUri).some((item) => item.code === "MEEK_PAGE_PROPS"), "El contrato inicial de datos debe ser válido");
  const contractDataUri = vscode.Uri.file(path.join(process.env.MEEKO_HOST_CONSUMER, "contract-data.ts"));
  const contractDataDocument = await vscode.workspace.openTextDocument(contractDataUri);
  const contractDataChange = new vscode.WorkspaceEdit();
  const typeOffset = contractDataDocument.getText().indexOf("string");
  contractDataChange.replace(contractDataUri, new vscode.Range(contractDataDocument.positionAt(typeOffset), contractDataDocument.positionAt(typeOffset + "string".length)), "number");
  assert.ok(await vscode.workspace.applyEdit(contractDataChange));
  assert.ok(await contractDataDocument.save());
  await waitForDiagnostics(dependentUri, "MEEK_PAGE_PROPS");

  const importedUri = vscode.Uri.file(path.join(process.env.MEEKO_HOST_CONSUMER, "Imported.meeko"));
  await vscode.workspace.openTextDocument(importedUri);
  await new Promise((resolve) => setTimeout(resolve, 1200));
  assert.ok(!vscode.languages.getDiagnostics(importedUri).some((item) => item.code === "TS2322"), "El tipo inicial del import debe ser valido");
  const answerUri = vscode.Uri.file(path.join(process.env.MEEKO_HOST_CONSUMER, "answer.ts"));
  const answerDocument = await vscode.workspace.openTextDocument(answerUri);
  const answerChange = new vscode.WorkspaceEdit();
  const answerStart = answerDocument.getText().indexOf('"ok"');
  answerChange.replace(answerUri, new vscode.Range(answerDocument.positionAt(answerStart), answerDocument.positionAt(answerStart + 4)), "42");
  assert.ok(await vscode.workspace.applyEdit(answerChange));
  assert.ok(await answerDocument.save());
  const importedErrors = await waitForDiagnostics(importedUri, "TS2322");
  assert.ok(importedErrors.some((item) => item.source === "Meeko"), "Un cambio en un modulo importado debe actualizar el componente abierto");

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
  assert.equal(vscode.workspace.textDocuments.filter((item) => item.isUntitled && ["html", "css"].includes(item.languageId)).length, 0, "El formateador no debe abrir documentos HTML/CSS temporales");
  let formatted = source;
  for (const edit of [...formatting].sort((left, right) => document.offsetAt(right.range.start) - document.offsetAt(left.range.start))) {
    const start = document.offsetAt(edit.range.start);
    const end = document.offsetAt(edit.range.end);
    formatted = formatted.slice(0, start) + edit.newText + formatted.slice(end);
  }
  assert.ok(formatted.includes("const count = signal(0);"), `Resultado del formato TypeScript: ${JSON.stringify(formatted.slice(0, 150))}, ediciones=${JSON.stringify(formatting.map((item) => ({ start: document.offsetAt(item.range.start), end: document.offsetAt(item.range.end), text: item.newText })))}`);
  assert.ok(formatted.includes("color: red;"), "Formato de la sección CSS");
  assert.ok(formatted.includes('class="counter"'), "Formato de la sección HTML");
  assert.ok(!formatted.includes('<button  class='), "El formato HTML debe normalizar el espacio entre atributos");
  assert.ok(formatted.includes("<template>\n"), "El formato debe separar la etiqueta template de su contenido");
  assert.ok(formatted.includes("\n</template>"), "El formato debe separar el cierre de template");
  assert.ok(formatted.includes("<style>\n"), "El formato debe separar la etiqueta style de su contenido");
  assert.ok(formatted.includes("\n</style>"), "El formato debe separar el cierre de style");

  await vscode.workspace.getConfiguration("editor", uri).update("formatOnSave", true, vscode.ConfigurationTarget.Global);
  await vscode.window.showTextDocument(document);
  const change = new vscode.WorkspaceEdit();
  change.insert(uri, document.positionAt(document.getText().indexOf("const count=")), " ");
  assert.ok(await vscode.workspace.applyEdit(change), "La edición del componente debe aplicarse");
  assert.ok(await document.save(), "El componente debe guardarse");
  assert.equal(vscode.window.activeTextEditor?.document.uri.toString(), uri.toString(), "Guardar debe conservar el editor .meeko activo");
  assert.equal(vscode.workspace.textDocuments.filter((item) => item.isUntitled && ["html", "css"].includes(item.languageId)).length, 0, "Guardar no debe abrir documentos HTML/CSS temporales");
  assert.ok(document.getText().includes("const count = signal(0);"), "El guardado debe formatear el script");
  assert.ok(document.getText().includes("color: red;"), "El guardado debe formatear el CSS");

  const fix = new vscode.WorkspaceEdit();
  const badValue = document.getText().indexOf('"invalid"');
  fix.replace(uri, new vscode.Range(document.positionAt(badValue), document.positionAt(badValue + '"invalid"'.length)), "0");
  assert.ok(await vscode.workspace.applyEdit(fix));
  assert.ok(await document.save());
  let cleared = false;
  for (let attempt = 0; attempt < 60; attempt++) {
    if (!vscode.languages.getDiagnostics(uri).some((item) => item.code === "TS2322")) { cleared = true; break; }
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  assert.ok(cleared, "El diagnóstico debe actualizarse tras guardar el componente corregido");

  const semanticUri = vscode.Uri.file(path.join(process.env.MEEKO_HOST_CONSUMER, "Semantic.meeko"));
  const semanticDocument = await vscode.workspace.openTextDocument(semanticUri);
  const semanticSource = semanticDocument.getText();
  assert.equal(vscode.workspace.getConfiguration("editor", { uri: semanticUri, languageId: "meeko" }).get("semanticHighlighting.enabled"), true);
  const legend = await vscode.commands.executeCommand("vscode.provideDocumentSemanticTokensLegend", semanticUri);
  const semantic = await vscode.commands.executeCommand("vscode.provideDocumentSemanticTokens", semanticUri);
  assert.ok(legend && semantic?.data?.length, "El documento debe recibir tokens semánticos");
  const decode = (result) => {
    const entries = [];
    let line = 0;
    let character = 0;
    for (let index = 0; index < result.data.length; index += 5) {
      const lineDelta = result.data[index];
      line += lineDelta;
      character = lineDelta === 0 ? character + result.data[index + 1] : result.data[index + 1];
      entries.push({
        line, character, length: result.data[index + 2],
        type: legend.tokenTypes[result.data[index + 3]],
        modifiers: legend.tokenModifiers.filter((_, bit) => (result.data[index + 4] & (1 << bit)) !== 0),
      });
    }
    return entries;
  };
  let decoded = decode(semantic);
  const tokenAt = (offset) => {
    const position = semanticDocument.positionAt(offset);
    const token = decoded.find((item) => item.line === position.line && item.character <= position.character && position.character < item.character + item.length);
    assert.ok(token, "Falta token semántico en " + semanticDocument.getText().slice(offset, offset + 12));
    return token;
  };
  const templateStart = semanticSource.indexOf("<template>");
  for (const [name, references] of [
    ["title", ['bind:title="title"', "{title}"]],
    ["enabled", ['if:condition="enabled"']],
    ["items", ['each:of="items"']],
    ["handler", ['on:click="handler"']],
    ["chosen", ["{chosen.name}", "{chosen?.name}", 'is="chosen"']],
  ]) {
    const declaration = tokenAt(semanticSource.indexOf("const " + name) + "const ".length);
    for (const reference of references) {
      const occurrence = semanticSource.indexOf(reference, templateStart);
      assert.ok(occurrence >= 0, "Falta variante " + reference);
      const offset = occurrence + reference.lastIndexOf(name);
      const usage = tokenAt(offset);
      assert.equal(usage.type, declaration.type, "Tipo semántico distinto para " + reference);
      assert.deepEqual(usage.modifiers, declaration.modifiers, "Modificadores distintos para " + reference);
    }
  }
  assert.equal(tokenAt(semanticSource.lastIndexOf("{item.name}") + 1).type, "variable");
  assert.equal(tokenAt(semanticSource.indexOf("name}", semanticSource.indexOf("{item.name}"))).type, "property");
  const mutableDeclaration = tokenAt(semanticSource.indexOf("let mutable") + "let ".length);
  const mutableUsage = tokenAt(semanticSource.indexOf("{mutable}") + 1);
  assert.equal(mutableUsage.type, mutableDeclaration.type, "Una variable mutable conserva su tipo");
  assert.deepEqual(mutableUsage.modifiers, mutableDeclaration.modifiers, "Una variable mutable conserva sus modificadores");
  assert.ok(tokenAt(semanticSource.indexOf("const title") + "const ".length).modifiers.includes("readonly"));
  const semanticChange = new vscode.WorkspaceEdit();
  const constOffset = semanticSource.indexOf("const title");
  semanticChange.replace(semanticUri, new vscode.Range(semanticDocument.positionAt(constOffset), semanticDocument.positionAt(constOffset + "const".length)), "let");
  assert.ok(await vscode.workspace.applyEdit(semanticChange));
  assert.ok(await semanticDocument.save());
  const updatedSemantic = await vscode.commands.executeCommand("vscode.provideDocumentSemanticTokens", semanticUri);
  assert.ok(updatedSemantic?.data?.length, "Los tokens deben regenerarse tras un cambio");
  decoded = decode(updatedSemantic);
  const changedSource = semanticDocument.getText();
  const changedDeclaration = tokenAt(changedSource.indexOf("let title") + "let ".length);
  const changedUsage = tokenAt(changedSource.indexOf("{title}") + 1);
  assert.equal(changedDeclaration.type, "variable");
  assert.deepEqual(changedDeclaration.modifiers, changedUsage.modifiers);
  assert.ok(!changedUsage.modifiers.includes("readonly"), "Una variable mutable no debe conservar el color de constante");
};
