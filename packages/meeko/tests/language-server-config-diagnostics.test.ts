import assert from "node:assert/strict";
import { utimes, writeFile } from "node:fs/promises";
import { after, before, describe, test } from "node:test";
import { TextDocument } from "vscode-languageserver-textdocument";
import type { Diagnostic } from "vscode-languageserver/node";
import { componentDiagnostics, configErrorRange } from "../src/language-server/diagnostics.ts";
import { MeekoProject } from "../src/language-server/project.ts";
import { languageProject, locateOnDisk } from "./language-server-workspace.ts";
import type { LanguageProject } from "./language-server-workspace.ts";

/** The configuration of the report: a function titleTemplate in `document.head`, as a method. */
const userConfig = `import { defineMeekoConfig } from '@meekojs/meeko/framework'

export default defineMeekoConfig({
\tdocument: {
\t\thead: {
\t\t\thtmlAttrs: {
\t\t\t\tlang: 'es',
\t\t\t},
\t\t\ttitle: 'Mi Sitio',
\t\t\ttitleTemplate(title) {
\t\t\t\treturn title ? \`\${title} - Mi Sitio\` : 'Mi Sitio'
\t\t\t},
\t\t},
\t},
})
`;

const marked = (text: string, message: string, filename = "meeko.config.ts"): string => {
  const [start, end] = configErrorRange(text, filename, message);
  return text.slice(start, end);
};

describe("language server: meeko.config.* failures", () => {
  test("the range of a validation error is the property it names", () => {
    assert.equal(marked(userConfig, "document.head: titleTemplate must be a string here, since it is serialized"), "titleTemplate");
    assert.equal(marked(userConfig, "document.head.htmlAttrs: event handler attribute onclick is not allowed"), "htmlAttrs");
    // `export default config`, `satisfies` and an element of an array.
    const declared = `const config = {\n  document: { head: { meta: [{ name: "a", content: "x" }, { name: "b" }] } },\n} satisfies object;\nexport default config;\n`;
    assert.equal(marked(declared, "document.head.meta[1]: content is required"), `{ name: "b" }`);
    assert.equal(marked(declared, "document: unknown field other"), "document");
    // Nothing named: the `export default` line.
    assert.equal(marked(userConfig, "must export a Meeko configuration object"), "export default defineMeekoConfig({");
    assert.equal(marked("// empty\n", "anything"), "// empty");
  });

  describe("with a trusted project", () => {
    let workspace: LanguageProject;
    let project: MeekoProject;
    const page = "<template><p>hola</p></template>\n";
    // The project executes it, like `meeko check`: no import, so it loads in a temporary folder.
    const broken = `const defineMeekoConfig = (config) => config;\nexport default defineMeekoConfig({\n  document: {\n    head: {\n      title: "Mi Sitio",\n      titleTemplate(title) { return title ? \`\${title} - Mi Sitio\` : "Mi Sitio"; },\n    },\n  },\n});\n`;

    before(async () => {
      workspace = await languageProject("lsp-config-", { "meeko.config.mjs": broken, "app/components/Hello.meeko": page });
      project = new MeekoProject(workspace.root, { trusted: true });
      await project.ready();
    });

    after(async () => {
      project?.dispose();
      await workspace?.dispose();
    });

    test("a failing configuration is reported on its file, at the property, not on the component", { timeout: 120_000 }, async () => {
      const filename = workspace.file("app/components/Hello.meeko");
      const configFile = workspace.file("meeko.config.mjs");
      project.setDocument(filename, page);
      const document = TextDocument.create("file:///index.meeko", "meeko", 1, page);
      const reported: Array<[string, Diagnostic[]]> = [];
      const own = await componentDiagnostics(project, document, filename, locateOnDisk, (file, diagnostics) => reported.push([file, diagnostics]));
      assert.deepEqual(own, [], "the component itself has no diagnostic");
      assert.equal(reported.length, 1);
      const [file, diagnostics] = reported[0]!;
      assert.equal(file, configFile);
      assert.equal(diagnostics.length, 1);
      const diagnostic = diagnostics[0]!;
      assert.equal(diagnostic.code, "MEEK_CONFIG");
      assert.equal(diagnostic.message, "document.head: titleTemplate must be a string here, since it is serialized");
      const config = locateOnDisk(configFile)!.document;
      assert.equal(config.getText(diagnostic.range), "titleTemplate");
      assert.equal(diagnostic.range.start.line, 5);

      // Without a reporter, the component shows it once, at the script, linked to the property.
      const fallback = await componentDiagnostics(project, document, filename, locateOnDisk);
      assert.equal(fallback.length, 1);
      assert.equal(fallback[0]!.code, "MEEK_CHECK");
      assert.match(String(fallback[0]!.message), /meeko\.config\.mjs: document\.head: titleTemplate must be a string/);
      assert.equal(fallback[0]!.relatedInformation?.[0]?.location.range.start.line, 5);

      // Fixed: the next check clears the configuration file.
      await writeFile(configFile, broken.replace(/titleTemplate\(title\) \{[^\n]*\},/, 'titleTemplate: "%s - Mi Sitio",'));
      const later = new Date(Date.now() + 5_000);
      await utimes(configFile, later, later);
      reported.length = 0;
      // (The temporary project has no Node types, so the framework autoimports bring unrelated errors.)
      const checked = await componentDiagnostics(project, document, filename, locateOnDisk, (file, items) => reported.push([file, items]));
      assert.deepEqual(checked.filter((item) => item.code === "MEEK_CHECK" || item.code === "MEEK_CONFIG"), []);
      assert.deepEqual(reported, [[configFile, []]]);
    });
  });
});
