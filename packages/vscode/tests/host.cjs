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
  const api = await extension.activate();
  assert.ok(existsSync(path.join(extension.extensionPath, "dist", "server.js")), "El servidor incluido debe estar empaquetado");
  assert.equal(api?.server?.source, "workspace", `Con confianza se usa el servidor de @meekojs/meeko del proyecto: ${JSON.stringify(api?.server)}`);
  assert.match(api.server.module, /node_modules[\\/]@meekojs[\\/]meeko[\\/]dist[\\/]language-server[\\/]main\.js$/);

  const diagnostics = await waitForDiagnostics(uri, "TS2322");
  assert.ok(diagnostics.some((item) => item.source === "Meeko"));
  const mismatch = diagnostics.find((item) => item.code === "TS2322");
  assert.equal(document.getText(mismatch.range), "bad", "El diagnóstico debe cubrir el identificador completo");

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

  // Clases en class="…": las del <style> propio y las de app/styles/main.css, con la regla al resolver.
  const classPosition = document.positionAt(source.indexOf('class="counter"') + 'class="'.length);
  const classes = await vscode.commands.executeCommand("vscode.executeCompletionItemProvider", uri, classPosition, undefined, 20);
  const labelOf = (item) => typeof item.label === "string" ? item.label : item.label.label;
  const globalClass = classes.items.find((item) => labelOf(item) === "btn-primary");
  assert.ok(globalClass && classes.items.some((item) => labelOf(item) === "counter"), `Completado de clases: ${classes.items.map(labelOf).join(", ")}`);
  assert.equal(globalClass.detail, "main.css (global)");
  assert.match(String(globalClass.documentation?.value ?? globalClass.documentation ?? ""), /\.btn-primary \{/, "Documentación con la regla de la clase");

  const references = await vscode.commands.executeCommand("vscode.executeReferenceProvider", uri, position);
  assert.ok(references.filter((item) => item.uri.toString() === uri.toString()).length >= 3, `Referencias en script y plantilla: ${references.length}`);

  const symbols = await vscode.commands.executeCommand("vscode.executeDocumentSymbolProvider", uri);
  assert.deepEqual(symbols.map((item) => item.name), ["<script>", "<template>", "<style>"]);
  assert.ok(symbols[0].children.some((item) => item.name === "count"), "Símbolos del script");

  const folding = await vscode.commands.executeCommand("vscode.executeFoldingRangeProvider", uri);
  assert.ok(folding?.some((range) => range.start === 0), "Plegado de la sección script");

  const help = await vscode.commands.executeCommand("vscode.executeSignatureHelpProvider", uri, document.positionAt(source.indexOf("signal(0)") + "signal(".length));
  assert.ok(help?.signatures?.length, "Ayuda de firma de signal");

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

  // Zonas de ejecución, lentes de código y tokens reactivos de una página.
  const zonesUri = vscode.Uri.file(path.join(process.env.MEEKO_HOST_CONSUMER, "app", "pages", "zones.meeko"));
  const zonesDocument = await vscode.workspace.openTextDocument(zonesUri);
  await vscode.window.showTextDocument(zonesDocument);
  const waitForZones = async (predicate) => {
    for (let attempt = 0; attempt < 60; attempt++) {
      const applied = api.executionZones(zonesUri);
      if (applied && predicate(applied)) return applied;
      await new Promise((resolve) => setTimeout(resolve, 250));
    }
    throw new Error(`Zonas no aplicadas: ${JSON.stringify(api.executionZones(zonesUri))}`);
  };
  const zones = await waitForZones((applied) => applied.length > 0);
  assert.deepEqual(zones.map((zone) => [zone.kind, zone.range.start.line, zone.range.end.line]), [["server", 0, 3], ["shared", 4, 7], ["browser", 8, 10], ["shared", 11, 11]]);
  assert.equal(zones[0].label, "Sólo servidor");
  const zonesSetting = vscode.workspace.getConfiguration("meeko");
  assert.equal(zonesSetting.get("editor.executionZones"), true);
  await zonesSetting.update("editor.executionZones", false, vscode.ConfigurationTarget.Global);
  await waitForZones((applied) => applied.length === 0);
  await zonesSetting.update("editor.executionZones", undefined, vscode.ConfigurationTarget.Global);
  await waitForZones((applied) => applied.length === 4);

  let lenses = [];
  for (let attempt = 0; attempt < 60; attempt++) {
    lenses = await vscode.commands.executeCommand("vscode.executeCodeLensProvider", zonesUri);
    if (lenses?.some((lens) => lens.command?.title.startsWith("Ruta /zones"))) break;
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  assert.ok(lenses.some((lens) => lens.command?.title === "Ruta /zones · render ssr · layouts: app/layouts/default.meeko"), JSON.stringify(lenses.map((lens) => lens.command?.title)));
  assert.ok(lenses.some((lens) => lens.command?.title === "Envía al cliente: { title: string; }"), JSON.stringify(lenses.map((lens) => lens.command?.title)));
  const countLens = lenses.find((lens) => lens.command?.command === "editor.action.showReferences");
  assert.equal(countLens?.command.title, "1 lectura · 1 escritura · en la plantilla");
  const [lensUri, lensPosition, lensLocations] = countLens.command.arguments;
  assert.ok(lensUri instanceof vscode.Uri && lensPosition instanceof vscode.Position, "La lente debe convertir sus argumentos a tipos de VS Code");
  assert.ok(Array.isArray(lensLocations) && lensLocations.length === 2 && lensLocations.every((item) => item instanceof vscode.Location));
  await vscode.commands.executeCommand(countLens.command.command, ...countLens.command.arguments);

  const zonesLegend = await vscode.commands.executeCommand("vscode.provideDocumentSemanticTokensLegend", zonesUri);
  assert.ok(["signal", "computed", "resource", "reactive", "modification"].every((modifier) => zonesLegend.tokenModifiers.includes(modifier)));
  const zonesTokens = await vscode.commands.executeCommand("vscode.provideDocumentSemanticTokens", zonesUri);
  const zonesSource = zonesDocument.getText();
  const reactiveRead = zonesDocument.positionAt(zonesSource.indexOf("count.value}"));
  const writeValue = zonesDocument.positionAt(zonesSource.indexOf("value = 1"));
  let line = 0;
  let character = 0;
  const found = [];
  for (let index = 0; index < zonesTokens.data.length; index += 5) {
    line += zonesTokens.data[index];
    character = zonesTokens.data[index] === 0 ? character + zonesTokens.data[index + 1] : zonesTokens.data[index + 1];
    found.push({ line, character, modifiers: zonesLegend.tokenModifiers.filter((_, bit) => (zonesTokens.data[index + 4] & (1 << bit)) !== 0) });
  }
  const modifiersAt = (position) => found.find((token) => token.line === position.line && token.character === position.character)?.modifiers ?? [];
  assert.deepEqual(["signal", "reactive"].filter((modifier) => modifiersAt(reactiveRead).includes(modifier)), ["signal", "reactive"]);
  assert.ok(modifiersAt(writeValue).includes("modification"), "La escritura de .value debe marcarse");
};
