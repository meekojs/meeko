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
  ], repository: { type: { patterns: [{ name: "support.type.primitive.ts", match: "\\b(?:string|number)\\b" }] } } }), "source.ts.json")],
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
    '<script server lang="ts">',
    "const value = 2;",
    "</script>",
    '<script lang="ts">',
    "const count = 1;",
    "</script>",
    "<template>",
    '<button class="plain" on:click="() => count.value++">{count.value}</button>',
    '<component is="props.outlet"></component>',
    '<AppButton bind:id="count" on:save="() => count.value++" />',
    "<FormsField></FormsField><my-widget></my-widget>",
    '<input ref:search class="plain"><AppButton ref:save />',
    '<input model="value" data-model="plain"><AppDialog model:open="count"><snippet name="plain" params="plain">x</snippet></AppDialog>',
    '<render snippet="props.outlet" args="count, 1" />',
    "<p>{({ id: 1 }).id}</p>",
    '<li if:when="count" each:of="value" each:as="id">x</li>',
    '<article html="props.outlet" data-html="plain"></article>',
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
  assert.ok(hasScope("server", "entity.other.attribute-name.meeko"), "script server attribute");
  assert.ok(tokens.some((token) => token.text === "value" && token.scopes.includes("meta.embedded.block.typescript") && token.scopes.includes("variable.other.readwrite.ts")), "script server content is TypeScript");
  assert.ok(tokens.some((token) => token.text === "2" && token.scopes.includes("meta.embedded.block.typescript") && token.scopes.includes("constant.numeric.ts")), "script server literals are TypeScript");
  assert.ok(hasScope("class", "entity.other.attribute-name.html"), "plain HTML attribute");
  assert.ok(hasScope("on:click", "entity.other.attribute-name.directive.meeko"), "Meeko directive");
  assert.ok(hasScope("is", "entity.other.attribute-name.directive.meeko"), "dynamic component prop");
  const component = "entity.name.type.class.component.meeko";
  assert.ok(hasScope("AppButton", component), "self-closing PascalCase component tag");
  assert.equal(tokens.filter((token) => token.text === "FormsField" && token.scopes.includes(component)).length, 2, "opening and closing component tags");
  assert.ok(hasScope("on:save", "entity.other.attribute-name.directive.meeko"), "component event directive");
  assert.ok(hasScope("ref:search", "entity.other.attribute-name.directive.meeko"), "ref: directive on an element");
  assert.ok(hasScope("ref:save", "entity.other.attribute-name.directive.meeko"), "ref: directive on a component");
  assert.ok(tokens.some((token) => token.text === "count" && token.scopes.includes(component) === false && token.scopes.includes("meta.embedded.inline.typescript")), "component props are TypeScript");
  const directive = "entity.other.attribute-name.directive.meeko";
  assert.ok(hasScope("model", directive), "model on a form control");
  assert.ok(hasScope("model:open", directive), "model:name on a component");
  assert.ok(hasScope("data-model", "entity.other.attribute-name.html") && !hasScope("data-model", directive), "data-model stays an HTML attribute");
  assert.ok(hasScope("snippet", directive) && hasScope("args", directive), "snippet and args of <render>");
  assert.ok(hasScope("render", "entity.name.tag.html") && hasScope("snippet", "entity.name.tag.html"), "<render> and <snippet> tags");
  assert.ok(hasScope("params", "entity.other.attribute-name.html"), "params of <snippet> is a plain attribute");
  assert.ok(tokens.some((token) => token.text === "outlet" && token.scopes.includes("meta.embedded.inline.typescript")), "<render snippet> is TypeScript");
  assert.ok(tokens.some((token) => token.text === "1" && token.scopes.includes("constant.numeric.ts")), "<render args> is TypeScript");
  assert.ok(hasScope("html", directive), "html directive on an element");
  assert.ok(hasScope("data-html", "entity.other.attribute-name.html") && !hasScope("data-html", directive), "data-html stays an HTML attribute");
  assert.equal(tokens.filter((token) => token.text === "outlet" && token.scopes.includes("meta.embedded.inline.typescript")).length, 3, "html value is TypeScript");
  assert.ok(hasScope("my-widget", "entity.name.tag.html") && !hasScope("my-widget", component), "custom elements stay HTML tags");
  assert.ok(hasScope("component", "entity.name.tag.html"), "<component> stays an HTML-style tag");
  // Colors: control flow reads as a keyword, events as functions, Meeko's tags as built-ins.
  assert.ok(hasScope("on:click", "entity.name.function.event.meeko") && hasScope("on:save", "entity.name.function.event.meeko"), "events");
  assert.ok(["if:when", "each:of", "each:as"].every((name) => hasScope(name, "keyword.control.flow.meeko")), "control flow directives");
  assert.ok(!hasScope("model:open", "entity.name.function.event.meeko") && !hasScope("model:open", "keyword.control.flow.meeko"), "bindings stay attributes");
  assert.equal(tokens.filter((token) => token.text === "snippet" && token.scopes.includes("entity.name.function.builtin.meeko")).length, 2, "<snippet> and </snippet> are built-ins");
  assert.ok(hasScope("render", "entity.name.function.builtin.meeko") && hasScope("component", "entity.name.function.builtin.meeko"), "<render> and <component> are built-ins");
  assert.ok(!hasScope("AppButton", "entity.name.function.builtin.meeko") && !hasScope("my-widget", "entity.name.function.builtin.meeko"), "other tags keep their color");
  // The HTML grammar marked these closing tags as unrecognized: Meeko's own grammar names them.
  for (const tag of ["component", "snippet", "my-widget", "article"]) {
    assert.equal(tokens.filter((token) => token.text === tag && token.scopes.includes("entity.name.tag.html")).length, 2, `opening and closing <${tag}>`);
  }
  assert.ok(tokens.some((token) => token.text === "count" && token.scopes.includes("meta.embedded.inline.typescript") && token.scopes.includes("variable.other.readwrite.ts")), "TypeScript inside attribute and interpolation");
  assert.ok(tokens.some((token) => token.text === "id" && token.scopes.includes("meta.embedded.inline.typescript") && token.scopes.includes("variable.other.readwrite.ts")), "nested object literal keeps TypeScript scope");
  assert.ok(hasScope("color", "support.type.property-name.css"), "CSS scope survives");
  assert.ok(!tokens.some((token) => token.text === "plain" && token.scopes.includes("meta.embedded.inline.typescript")), "plain HTML values must not use TypeScript scope");
});

test("a nested <template> does not close the template section", async () => {
  const require = createRequire(import.meta.url);
  await loadWASM(readFileSync(require.resolve("vscode-oniguruma/release/onig.wasm")));
  const registry = new Registry({
    onigLib: Promise.resolve({ createOnigScanner, createOnigString }),
    loadGrammar: async (scope) => scope === "source.meeko"
      ? parseRawGrammar(readFileSync(grammarFile, "utf8"), grammarFile)
      : fixtureGrammars.get(scope) ?? null,
  });
  const grammar = await registry.loadGrammarWithConfiguration("source.meeko", 1, {
    embeddedLanguages: { "meta.embedded.inline.typescript": 2, "meta.embedded.block.html": 3, "meta.embedded.block.css": 4 },
  });
  assert.ok(grammar);
  const lines = [
    "<template>",
    "<template",
    '  each:of="value"',
    '  each:as="id"',
    ">",
    "<template if:when=\"count\"><b>{id}</b></template>",
    "</template>",
    '<button on:click="count">{count}</button>',
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
    tokens.push(...result.tokens.map((token) => ({ text: line.slice(token.startIndex, token.endIndex), scopes: token.scopes })));
  }
  const html = "meta.embedded.block.html";
  assert.ok(tokens.some((token) => token.text === "each:of" && token.scopes.includes("keyword.control.flow.meeko")), "directives of a multi-line nested <template>");
  assert.ok(tokens.some((token) => token.text === "id" && token.scopes.includes("meta.embedded.inline.typescript")), "interpolation inside the nested template");
  // After the nested </template>, the markup is still in the template section.
  assert.ok(tokens.some((token) => token.text === "on:click" && token.scopes.includes("entity.name.function.event.meeko") && token.scopes.includes(html)), "markup after a nested </template>");
  assert.ok(tokens.some((token) => token.text === "count" && token.scopes.includes("meta.embedded.inline.typescript") && token.scopes.includes(html)), "expressions after a nested </template>");
  assert.ok(tokens.some((token) => token.text === "color" && token.scopes.includes("support.type.property-name.css")), "the style section follows the template section");
  assert.equal(tokens.filter((token) => token.text === "template" && token.scopes.includes("entity.name.tag.meeko")).length, 2, "only the section tags are section tags");
});

test("generic on <script> is a TypeScript type parameter list, also with > in its value", async () => {
  const require = createRequire(import.meta.url);
  await loadWASM(readFileSync(require.resolve("vscode-oniguruma/release/onig.wasm")));
  const registry = new Registry({
    onigLib: Promise.resolve({ createOnigScanner, createOnigString }),
    loadGrammar: async (scope) => scope === "source.meeko"
      ? parseRawGrammar(readFileSync(grammarFile, "utf8"), grammarFile)
      : fixtureGrammars.get(scope) ?? null,
  });
  const grammar = await registry.loadGrammarWithConfiguration("source.meeko", 1, {
    embeddedLanguages: { "meta.embedded.block.typescript": 2, "meta.embedded.inline.typescript": 2 },
  });
  assert.ok(grammar);
  const lines = ['<script lang="ts" generic="T extends Record<string, number>, K = string">', "const count = 1;", "</script>"];
  let state = null;
  const tokens: Array<{ text: string; scopes: string[] }> = [];
  for (const line of lines) {
    const result = grammar.tokenizeLine(line, state);
    state = result.ruleStack;
    tokens.push(...result.tokens.map((token) => ({ text: line.slice(token.startIndex, token.endIndex), scopes: token.scopes })));
  }
  const inGeneric = (text: string, scope: string) => tokens.some((token) => token.text.trim() === text && token.scopes.includes("meta.embedded.inline.typescript") && token.scopes.includes(scope));
  assert.ok(tokens.some((token) => token.text === "generic" && token.scopes.includes("entity.other.attribute-name.meeko")), "generic attribute name");
  assert.ok(inGeneric("extends", "storage.modifier.ts"), "extends of a constraint");
  assert.ok(inGeneric("string", "support.type.primitive.ts") && inGeneric("number", "support.type.primitive.ts"), "types of the list");
  assert.ok(inGeneric("=", "keyword.operator.assignment.ts"), "default of a parameter");
  // The `>` inside the value does not close the tag: the script body is still TypeScript.
  assert.ok(tokens.some((token) => token.text === "count" && token.scopes.includes("meta.embedded.block.typescript") && token.scopes.includes("variable.other.readwrite.ts")), "script body after generic");
});

test("html, model and model:name on a custom element are plain HTML attributes", async () => {
  const require = createRequire(import.meta.url);
  await loadWASM(readFileSync(require.resolve("vscode-oniguruma/release/onig.wasm")));
  const registry = new Registry({
    onigLib: Promise.resolve({ createOnigScanner, createOnigString }),
    loadGrammar: async (scope) => scope === "source.meeko"
      ? parseRawGrammar(readFileSync(grammarFile, "utf8"), grammarFile)
      : fixtureGrammars.get(scope) ?? null,
  });
  const grammar = await registry.loadGrammarWithConfiguration("source.meeko", 1, {
    embeddedLanguages: { "meta.embedded.inline.typescript": 2, "meta.embedded.block.html": 3 },
  });
  assert.ok(grammar);
  const tokenize = (line: string) => grammar.tokenizeLine(`<template>${line}</template>`, null).tokens.map((token) => ({
    text: `<template>${line}</template>`.slice(token.startIndex, token.endIndex),
    scopes: token.scopes,
  }));
  const directive = "entity.other.attribute-name.directive.meeko";
  const typescript = "meta.embedded.inline.typescript";
  const custom = tokenize('<x-markdown html="intro" model="query" model:open="count" on:ready="count" ref:box>');
  for (const name of ["html", "model", "model:open"]) {
    assert.ok(custom.some((token) => token.text === name && token.scopes.includes("entity.other.attribute-name.html") && !token.scopes.includes(directive)), `${name} is an HTML attribute`);
  }
  assert.ok(custom.some((token) => token.text === "intro" && token.scopes.includes("string.quoted.double.html") && !token.scopes.includes(typescript)), "html value is text");
  assert.ok(custom.some((token) => token.text === "query" && token.scopes.includes("string.quoted.double.html") && !token.scopes.includes(typescript)), "model value is text");
  assert.ok(custom.some((token) => token.text === "x-markdown" && token.scopes.includes("entity.name.tag.html")), "custom element tag");
  // Other directives keep their meaning on a custom element.
  assert.ok(custom.some((token) => token.text === "on:ready" && token.scopes.includes(directive)), "on: directive");
  assert.ok(custom.some((token) => token.text === "count" && token.scopes.includes(typescript)), "on: value is TypeScript");
  assert.ok(custom.some((token) => token.text === "ref:box" && token.scopes.includes(directive)), "ref: directive");
  // A standard element, and the SVG and MathML names with a hyphen, keep the directives.
  for (const line of ['<div html="count"></div>', '<font-face html="count"></font-face>', '<Annotation-Xml html="count"></Annotation-Xml>']) {
    const tokens = tokenize(line);
    assert.ok(tokens.some((token) => token.text === "html" && token.scopes.includes(directive)), `html directive in ${line}`);
    assert.ok(tokens.some((token) => token.text === "count" && token.scopes.includes(typescript)), `html value is TypeScript in ${line}`);
  }
  assert.ok(tokenize('<input model="count">').some((token) => token.text === "model" && token.scopes.includes(directive)), "model on a form control");
});

test("if:when on a <snippet> is control flow with a TypeScript value", async () => {
  const require = createRequire(import.meta.url);
  await loadWASM(readFileSync(require.resolve("vscode-oniguruma/release/onig.wasm")));
  const registry = new Registry({
    onigLib: Promise.resolve({ createOnigScanner, createOnigString }),
    loadGrammar: async (scope) => scope === "source.meeko"
      ? parseRawGrammar(readFileSync(grammarFile, "utf8"), grammarFile)
      : fixtureGrammars.get(scope) ?? null,
  });
  const grammar = await registry.loadGrammarWithConfiguration("source.meeko", 1, {
    embeddedLanguages: { "meta.embedded.inline.typescript": 2, "meta.embedded.block.html": 3 },
  });
  assert.ok(grammar);
  const line = '<template><AppCard><snippet name="footer" params="close" if:when="count"><render snippet="props.outlet" args="close" /></snippet></AppCard></template>';
  const tokens = grammar.tokenizeLine(line, null).tokens.map((token) => ({ text: line.slice(token.startIndex, token.endIndex), scopes: token.scopes }));
  const typescript = "meta.embedded.inline.typescript";
  assert.ok(tokens.some((token) => token.text === "if:when" && token.scopes.includes("keyword.control.flow.meeko")), "if:when of <snippet>");
  assert.ok(tokens.some((token) => token.text === "count" && token.scopes.includes(typescript) && token.scopes.includes("variable.other.readwrite.ts")), "its value is TypeScript");
  assert.ok(tokens.some((token) => token.text === "name" && token.scopes.includes("entity.other.attribute-name.html")), "name stays a plain attribute");
  assert.equal(tokens.filter((token) => token.text === "snippet" && token.scopes.includes("entity.name.function.builtin.meeko")).length, 2, "<snippet> and </snippet> are built-ins");
});

test("<MeekoThemeToggle> is a built-in tag, also when it closes, and a longer name is not", async () => {
  const require = createRequire(import.meta.url);
  await loadWASM(readFileSync(require.resolve("vscode-oniguruma/release/onig.wasm")));
  const registry = new Registry({
    onigLib: Promise.resolve({ createOnigScanner, createOnigString }),
    loadGrammar: async (scope) => scope === "source.meeko"
      ? parseRawGrammar(readFileSync(grammarFile, "utf8"), grammarFile)
      : fixtureGrammars.get(scope) ?? null,
  });
  const grammar = await registry.loadGrammarWithConfiguration("source.meeko", 1, {
    embeddedLanguages: { "meta.embedded.inline.typescript": 2, "meta.embedded.block.html": 3 },
  });
  assert.ok(grammar);
  const line = '<template><MeekoThemeToggle mode="select" bind:themes="value"><snippet name="dark">x</snippet></MeekoThemeToggle><MeekoThemeToggles /></template>';
  const tokens = grammar.tokenizeLine(line, null).tokens.map((token) => ({ text: line.slice(token.startIndex, token.endIndex), scopes: token.scopes }));
  const builtin = "entity.name.function.builtin.meeko";
  assert.equal(tokens.filter((token) => token.text === "MeekoThemeToggle" && token.scopes.includes(builtin)).length, 2, "<MeekoThemeToggle> and </MeekoThemeToggle> are built-ins");
  assert.ok(!tokens.some((token) => token.text.startsWith("MeekoThemeToggles") && token.scopes.includes(builtin)), "a longer name keeps the component color");
  assert.ok(tokens.some((token) => token.text === "value" && token.scopes.includes("meta.embedded.inline.typescript")), "bind:themes is TypeScript");
});

test("match of <MeekoLink> is a plain attribute with a string value, and bind:match is TypeScript", async () => {
  const require = createRequire(import.meta.url);
  await loadWASM(readFileSync(require.resolve("vscode-oniguruma/release/onig.wasm")));
  const registry = new Registry({
    onigLib: Promise.resolve({ createOnigScanner, createOnigString }),
    loadGrammar: async (scope) => scope === "source.meeko"
      ? parseRawGrammar(readFileSync(grammarFile, "utf8"), grammarFile)
      : fixtureGrammars.get(scope) ?? null,
  });
  const grammar = await registry.loadGrammarWithConfiguration("source.meeko", 1, {
    embeddedLanguages: { "meta.embedded.inline.typescript": 2, "meta.embedded.block.html": 3 },
  });
  assert.ok(grammar);
  const line = '<template><MeekoLink to="/dashboard" match="prefix">Panel</MeekoLink><MeekoLink to="/" bind:match="value">Inicio</MeekoLink></template>';
  const tokens = grammar.tokenizeLine(line, null).tokens.map((token) => ({ text: line.slice(token.startIndex, token.endIndex), scopes: token.scopes }));
  const typescript = "meta.embedded.inline.typescript";
  assert.equal(tokens.filter((token) => token.text === "MeekoLink" && token.scopes.includes("entity.name.function.builtin.meeko")).length, 4, "<MeekoLink> and </MeekoLink> are built-ins");
  assert.ok(tokens.some((token) => token.text === "match" && token.scopes.includes("entity.other.attribute-name.html")), "match is a plain attribute");
  assert.ok(tokens.some((token) => token.text === "prefix" && !token.scopes.includes(typescript)), "its value is a string, not TypeScript");
  assert.ok(tokens.some((token) => token.text === "value" && token.scopes.includes(typescript)), "bind:match is TypeScript");
});

test("<MeekoAwait> is a built-in tag whose for is TypeScript, and for stays an attribute elsewhere", async () => {
  const require = createRequire(import.meta.url);
  await loadWASM(readFileSync(require.resolve("vscode-oniguruma/release/onig.wasm")));
  const registry = new Registry({
    onigLib: Promise.resolve({ createOnigScanner, createOnigString }),
    loadGrammar: async (scope) => scope === "source.meeko"
      ? parseRawGrammar(readFileSync(grammarFile, "utf8"), grammarFile)
      : fixtureGrammars.get(scope) ?? null,
  });
  const grammar = await registry.loadGrammarWithConfiguration("source.meeko", 1, {
    embeddedLanguages: { "meta.embedded.inline.typescript": 2, "meta.embedded.block.html": 3 },
  });
  assert.ok(grammar);
  const line = '<template><MeekoAwait for="items" reserve><snippet name="pending">x</snippet><p>{count}</p></MeekoAwait><AppField for="email" /><MeekoAwaits /></template>';
  const tokens = grammar.tokenizeLine(line, null).tokens.map((token) => ({ text: line.slice(token.startIndex, token.endIndex), scopes: token.scopes }));
  const builtin = "entity.name.function.builtin.meeko";
  const typescript = "meta.embedded.inline.typescript";
  assert.equal(tokens.filter((token) => token.text === "MeekoAwait" && token.scopes.includes(builtin)).length, 2, "<MeekoAwait> and </MeekoAwait> are built-ins");
  assert.ok(tokens.some((token) => token.text === "items" && token.scopes.includes(typescript)), "for is TypeScript");
  assert.ok(tokens.some((token) => token.text === "for" && token.scopes.includes("entity.other.attribute-name.directive.meeko")), "for reads as a directive");
  assert.ok(!tokens.some((token) => token.text.includes("email") && token.scopes.includes(typescript)), "for of another component is text");
  assert.ok(!tokens.some((token) => token.text.startsWith("MeekoAwaits") && token.scopes.includes(builtin)), "a longer name keeps the component color");
});

test("<MeekoTeleport> is a built-in tag whose bind:disabled is TypeScript", async () => {
  const require = createRequire(import.meta.url);
  await loadWASM(readFileSync(require.resolve("vscode-oniguruma/release/onig.wasm")));
  const registry = new Registry({
    onigLib: Promise.resolve({ createOnigScanner, createOnigString }),
    loadGrammar: async (scope) => scope === "source.meeko"
      ? parseRawGrammar(readFileSync(grammarFile, "utf8"), grammarFile)
      : fixtureGrammars.get(scope) ?? null,
  });
  const grammar = await registry.loadGrammarWithConfiguration("source.meeko", 1, {
    embeddedLanguages: { "meta.embedded.inline.typescript": 2, "meta.embedded.block.html": 3 },
  });
  assert.ok(grammar);
  const line = '<template><MeekoTeleport to="#toolbar" bind:disabled="count"><AppButton on:click="value" /></MeekoTeleport><MeekoTeleports /></template>';
  const tokens = grammar.tokenizeLine(line, null).tokens.map((token) => ({ text: line.slice(token.startIndex, token.endIndex), scopes: token.scopes }));
  const builtin = "entity.name.function.builtin.meeko";
  assert.equal(tokens.filter((token) => token.text === "MeekoTeleport" && token.scopes.includes(builtin)).length, 2, "<MeekoTeleport> and </MeekoTeleport> are built-ins");
  assert.ok(!tokens.some((token) => token.text === "MeekoTeleports" && token.scopes.includes(builtin)), "a longer name is a component");
  assert.ok(tokens.some((token) => token.text === "#toolbar" && token.scopes.includes("string.quoted.double.html") && !token.scopes.includes("meta.embedded.inline.typescript")), "to is text");
  assert.ok(tokens.some((token) => token.text === "count" && token.scopes.includes("meta.embedded.inline.typescript") && token.scopes.includes("variable.other.readwrite.ts")), "bind:disabled is TypeScript");
  assert.ok(tokens.some((token) => token.text === "AppButton" && !token.scopes.includes(builtin)), "its content keeps its own tags");
});

test("bind without a name is a directive with a TypeScript value, except on a custom element", async () => {
  const require = createRequire(import.meta.url);
  await loadWASM(readFileSync(require.resolve("vscode-oniguruma/release/onig.wasm")));
  const registry = new Registry({
    onigLib: Promise.resolve({ createOnigScanner, createOnigString }),
    loadGrammar: async (scope) => scope === "source.meeko"
      ? parseRawGrammar(readFileSync(grammarFile, "utf8"), grammarFile)
      : fixtureGrammars.get(scope) ?? null,
  });
  const grammar = await registry.loadGrammarWithConfiguration("source.meeko", 1, {
    embeddedLanguages: { "meta.embedded.inline.typescript": 2, "meta.embedded.block.html": 3 },
  });
  assert.ok(grammar);
  const tokenize = (line: string) => grammar.tokenizeLine(`<template>${line}</template>`, null).tokens.map((token) => ({
    text: `<template>${line}</template>`.slice(token.startIndex, token.endIndex),
    scopes: token.scopes,
  }));
  const directive = "entity.other.attribute-name.directive.meeko";
  const typescript = "meta.embedded.inline.typescript";
  for (const line of [
    '<p class="plain" bind="state" data-bind="plain">x</p>',
    '<AppCard bind="state" />',
    "<component is=\"href ? 'a' : 'button'\" bind=\"state\"></component>",
  ]) {
    const tokens = tokenize(line);
    assert.ok(tokens.some((token) => token.text === "bind" && token.scopes.includes(directive)), `bind directive in ${line}`);
    assert.ok(tokens.some((token) => token.text === "state" && token.scopes.includes(typescript)), `bind value is TypeScript in ${line}`);
  }
  const plain = tokenize('<p data-bind="plain">x</p>');
  assert.ok(plain.some((token) => token.text === "data-bind" && !token.scopes.includes(directive)), "data-bind is an HTML attribute");
  const custom = tokenize('<x-card bind="state"></x-card>');
  assert.ok(custom.some((token) => token.text === "bind" && !token.scopes.includes(directive)), "bind on a custom element is an HTML attribute");
  assert.ok(custom.some((token) => token.text === "state" && !token.scopes.includes(typescript)), "its value is text");
  const tag = tokenize("<component is=\"count ? 'a' : 'button'\"></component>");
  assert.ok(tag.some((token) => token.text.includes("'a'") && token.scopes.includes(typescript)), "the tags of is are TypeScript");
});

test("<MeekoPopover> and <MeekoSelect> are built-in tags, also when they close, and longer names are not", async () => {
  const require = createRequire(import.meta.url);
  await loadWASM(readFileSync(require.resolve("vscode-oniguruma/release/onig.wasm")));
  const registry = new Registry({
    onigLib: Promise.resolve({ createOnigScanner, createOnigString }),
    loadGrammar: async (scope) => scope === "source.meeko"
      ? parseRawGrammar(readFileSync(grammarFile, "utf8"), grammarFile)
      : fixtureGrammars.get(scope) ?? null,
  });
  const grammar = await registry.loadGrammarWithConfiguration("source.meeko", 1, {
    embeddedLanguages: { "meta.embedded.inline.typescript": 2, "meta.embedded.block.html": 3 },
  });
  assert.ok(grammar);
  const line = '<template><MeekoPopover role="menu"><snippet name="trigger">x</snippet></MeekoPopover><MeekoSelect model="color" bind:options="colors" /><MeekoSelects /></template>';
  const tokens = grammar.tokenizeLine(line, null).tokens.map((token) => ({ text: line.slice(token.startIndex, token.endIndex), scopes: token.scopes }));
  const builtin = "entity.name.function.builtin.meeko";
  assert.equal(tokens.filter((token) => token.text === "MeekoPopover" && token.scopes.includes(builtin)).length, 2, "<MeekoPopover> and </MeekoPopover> are built-ins");
  assert.equal(tokens.filter((token) => token.text === "MeekoSelect" && token.scopes.includes(builtin)).length, 1, "<MeekoSelect /> is a built-in");
  assert.ok(!tokens.some((token) => token.text.startsWith("MeekoSelects") && token.scopes.includes(builtin)), "a longer name keeps the component color");
  assert.ok(tokens.some((token) => token.text === "colors" && token.scopes.includes("meta.embedded.inline.typescript")), "bind:options is TypeScript");
});
