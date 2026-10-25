import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import oniguruma from "vscode-oniguruma";
import textmate, { type IRawGrammar } from "vscode-textmate";

const { createOnigScanner, createOnigString, loadWASM } = oniguruma;
const { parseRawGrammar, Registry } = textmate;

const testDirectory = fileURLToPath(new URL(".", import.meta.url));
const grammarFile = join(testDirectory, "../syntaxes/meeko.tmLanguage.json");
const fixtureGrammars = new Map<string, IRawGrammar>([
  ["source.ts", parseRawGrammar(JSON.stringify({ scopeName: "source.ts", patterns: [
    { name: "keyword.control.ts", match: "\\b(?:const|return)\\b" },
    { name: "variable.other.readwrite.ts", match: "\\b(?:count|value|id|props|outlet)\\b" },
    { name: "constant.numeric.ts", match: "\\b\\d+\\b" },
  ] }), "source.ts.json")],
  ["text.html.basic", parseRawGrammar('{"scopeName":"text.html.basic","patterns":[]}', "html.json")],
  ["source.css", parseRawGrammar(JSON.stringify({ scopeName: "source.css", patterns: [
    { name: "support.type.property-name.css", match: "\\bcolor\\b" },
  ] }), "css.json")],
]);

test("Meeko tokens distinguish section attributes, HTML and TypeScript expressions", async () => {
  const require = createRequire(import.meta.url);
  await loadWASM(readFileSync(require.resolve("vscode-oniguruma/release/onig.wasm")));
  const registry = new Registry({
    onigLib: Promise.resolve({ createOnigScanner, createOnigString }),
    loadGrammar: async (scope) => scope === "source.meeko"
      ? parseRawGrammar(readFileSync(grammarFile, "utf8"), grammarFile)
      : fixtureGrammars.get(scope) ?? null,
  });
  const grammar = await registry.loadGrammarWithConfiguration("source.meeko", 1, {
    embeddedLanguages: {
      "meta.embedded.block.typescript": 2,
      "meta.embedded.inline.typescript": 2,
      "meta.embedded.block.html": 3,
      "meta.embedded.block.css": 4,
    },
  });
  assert.ok(grammar);
  const lines = [
    '<script lang="ts">',
    "const count = 1;",
    "</script>",
    "<template>",
    '<button class="plain" on:click="() => count.value++">{count.value}</button>',
    '<component is="props.outlet"></component>',
    "<p>{({ id: 1 }).id}</p>",
    "</template>",
    "<style scoped>",
    "button { color: red; }",
    "</style>",
  ];
  let state = null;
  const tokens: Array<{ text: string; scopes: string[] }> = [];
  for (const line of lines) {
    const result = grammar.tokenizeLine(line, state);
    state = result.ruleStack;
    tokens.push(...result.tokens.map((token) => ({
      text: line.slice(token.startIndex, token.endIndex),
      scopes: token.scopes,
    })));
  }
  const hasScope = (text: string, scope: string) => tokens.some((token) => token.text === text && token.scopes.includes(scope));
  assert.ok(hasScope("lang", "entity.other.attribute-name.meeko"), "script language attribute");
  assert.ok(hasScope("scoped", "entity.other.attribute-name.meeko"), "scoped style attribute");
  assert.ok(hasScope("class", "entity.other.attribute-name.html"), "plain HTML attribute");
  assert.ok(hasScope("on:click", "entity.other.attribute-name.directive.meeko"), "Meeko directive");
  assert.ok(hasScope("is", "entity.other.attribute-name.directive.meeko"), "dynamic component prop");
  assert.ok(tokens.some((token) => token.text === "count" && token.scopes.includes("meta.embedded.inline.typescript") && token.scopes.includes("variable.other.readwrite.ts")), "TypeScript inside attribute and interpolation");
  assert.ok(tokens.some((token) => token.text === "id" && token.scopes.includes("meta.embedded.inline.typescript") && token.scopes.includes("variable.other.readwrite.ts")), "nested object literal keeps TypeScript scope");
  assert.ok(hasScope("color", "support.type.property-name.css"), "CSS scope survives");
  assert.ok(!tokens.some((token) => token.text === "plain" && token.scopes.includes("meta.embedded.inline.typescript")), "plain HTML values must not use TypeScript scope");
});
