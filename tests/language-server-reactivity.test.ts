import assert from "node:assert/strict";
import { after, before, describe, test } from "node:test";
import type { CodeLens, Location, MarkupContent } from "vscode-languageserver/node";
import { hover, semanticTokens, semanticTokensLegend } from "../src/language-server/features.ts";
import { codeLenses, showReferencesCommand } from "../src/language-server/lenses.ts";
import { analyzeReactivity } from "../src/language-server/reactivity.ts";
import { decodeTokens, languageProject } from "./language-server-workspace.ts";
import type { LanguageProject, OpenedComponent } from "./language-server-workspace.ts";

const counter = `<script lang="ts">
import { computed, effect, signal } from "@meekojs/meeko";
import { useState } from "@meekojs/meeko/framework";
const count = signal(0);
const label = "static";
const doubled = computed(() => count.value * 2);
effect(() => { console.log(doubled.value); });
function reset(): void { count.value = 0; }
const name = useState("name", () => "Ada");
const open = defineModel<boolean>("open", { default: false });
const field = useElementRef("field");
</script>
<template>
  <button on:click="() => count.value++">{count.value}</button>
  <p>{label}</p>
  <p bind:title="doubled.value">{name.value}</p>
  <input ref:field model="name" />
  <button on:click="reset">{open.value}</button>
</template>
`;

const continuation = `<script lang="ts">
import { signal } from "@meekojs/meeko";
const before = signal(1);
const input = await useElementRef("field");
const after = signal(input.value);
</script>
<template><input ref:field />{before.value}{after.value}</template>
`;

const plainValues = `<script lang="ts">export interface Props { label: string; value: string } const props = defineProps<Props>()
import { signal } from "@meekojs/meeko";
const count = signal(0);
const el = undefined as unknown as HTMLInputElement;
let draft = "";
</script>
<template><span>{props.label}</span><strong>{props.value}</strong><em>{count.value}</em><i>{el.value}</i>
<input on:input="(event) => { draft = event.currentTarget.value; }" /></template>
`;

describe("language server: reactive declarations", () => {
  let workspace: LanguageProject;
  let component: OpenedComponent;

  before(async () => {
    workspace = await languageProject("lsp-reactivity-", { "Counter.meeko": counter, "Later.meeko": continuation, "Plain.meeko": plainValues });
    component = await workspace.open("Counter.meeko");
  });

  after(async () => {
    await workspace?.dispose();
  });

  test("the analysis finds signals, computed values and their reads and writes in script and template", () => {
    const analysis = analyzeReactivity(workspace.project.service, component.component);
    const byName = new Map(analysis.declarations.map((declaration) => [declaration.name, declaration]));
    assert.deepEqual([...byName.keys()], ["count", "doubled", "name", "open", "field"]);
    assert.deepEqual([byName.get("count")!.kind, byName.get("count")!.origin], ["signal", "signal"]);
    assert.deepEqual([byName.get("doubled")!.kind, byName.get("doubled")!.origin], ["computed", "computed"]);
    assert.deepEqual([byName.get("name")!.origin, byName.get("name")!.stateKey], ["useState", "name"]);
    assert.deepEqual([byName.get("open")!.origin, byName.get("open")!.modelName], ["defineModel", "open"]);
    assert.equal(byName.get("field")!.origin, "useElementRef");
    const count = byName.get("count")!;
    const describe = (access: (typeof count.accesses)[number]) => `${access.where}:${access.read ? "r" : ""}${access.write ? "w" : ""}`;
    assert.deepEqual(count.accesses.map(describe), ["computed:r", "function reset:w", "on:click:rw", "{…}:r"]);
    // `model="name"` binds the signal both ways.
    assert.deepEqual(byName.get("name")!.accesses.map(describe), ["{…}:r", "model:rw"]);
    assert.ok(analysis.reactiveExpressions.length >= 4);
    const label = component.offset("{label}") + 1;
    assert.ok(!analysis.reactiveExpressions.some(([start, end]) => label >= start && label < end), "a constant is a static expression");
  });

  test("semantic tokens mark reactive names, writes of .value and reactive template expressions", () => {
    const tokens = decodeTokens(semanticTokens(component).data, semanticTokensLegend);
    const tokenAt = (offset: number) => {
      const position = component.document.positionAt(offset);
      const token = tokens.find((item) => item.line === position.line && item.character <= position.character && position.character < item.character + item.length);
      assert.ok(token, `token at ${counter.slice(offset, offset + 12)}`);
      return token;
    };
    assert.ok(semanticTokensLegend.tokenModifiers.includes("modification"));
    const declaration = tokenAt(component.offset("const count") + 6);
    assert.equal(declaration.type, "variable");
    assert.ok(declaration.modifiers.includes("signal"), JSON.stringify(declaration));
    assert.ok(tokenAt(component.offset("doubled =")).modifiers.includes("computed"));
    assert.ok(tokenAt(component.offset("count.value * 2")).modifiers.includes("signal"));
    // A write of `.value` is a modification; a read is not.
    assert.ok(tokenAt(component.offset("value = 0")).modifiers.includes("modification"));
    assert.ok(tokenAt(component.offset("value++")).modifiers.includes("modification"));
    assert.ok(!tokenAt(component.offset("value * 2")).modifiers.includes("modification"));
    const templateCount = tokenAt(component.offset("{count.value}") + 1);
    assert.deepEqual([templateCount.type, templateCount.modifiers.includes("signal"), templateCount.modifiers.includes("reactive")], ["variable", true, true]);
    assert.ok(tokenAt(component.offset("value}", 0, "{count.value}")).modifiers.includes("reactive"));
    // `model="name"` appears twice in the virtual code; both copies carry the modifiers.
    assert.ok(tokenAt(component.offset("model=\"name\"") + 7).modifiers.includes("signal"));
    const label = tokenAt(component.offset("{label}") + 1);
    assert.ok(!label.modifiers.includes("reactive") && !label.modifiers.includes("signal"), JSON.stringify(label));
  });

  test("the hover of a signal lists its type, reads and writes with links and how it crosses to the client", () => {
    const text = (hover(component, component.at("count = signal"))?.contents as MarkupContent).value;
    assert.match(text, /const count: Signal<number>/);
    assert.match(text, /\*\*señal\*\* `count` de `signal`: `Signal<number>`/);
    assert.match(text, /\*\*Lecturas \(3\)\*\*/);
    assert.match(text, /\*\*Escrituras \(2\)\*\*/);
    const line = component.at("count.value++").line + 1;
    assert.ok(text.includes(`[línea ${line}](${component.document.uri}#L${line},`), text);
    assert.match(text, /plantilla `on:click`/);
    assert.match(text, /función reset/);
    assert.match(text, /Pasa al cliente/);
    const fromTemplate = (hover(component, component.at("count.value}", 1))?.contents as MarkupContent).value;
    assert.match(fromTemplate, /\*\*señal\*\* `count`/);
    assert.match((hover(component, component.at("name = useState"))?.contents as MarkupContent).value, /estado de la aplicación con la clave `name`/);
    assert.match((hover(component, component.at("open = define"))?.contents as MarkupContent).value, /Modelo `open` del padre/);
    assert.match((hover(component, component.at("doubled = "))?.contents as MarkupContent).value, /\*\*valor derivado\*\*[\s\S]*No pasa al cliente/);
    assert.match((hover(component, component.at("field = "))?.contents as MarkupContent).value, /Sólo navegador: una referencia a un elemento/);
  });

  test("a code lens on each reactive declaration counts reads and writes and shows the references", () => {
    const lenses = codeLenses(component) as CodeLens[];
    const lens = lenses.find((item) => item.range.start.line === component.at("const count").line);
    assert.ok(lens?.command, JSON.stringify(lenses));
    assert.equal(lens.command.title, "3 lecturas · 2 escrituras · en la plantilla");
    assert.equal(lens.command.command, showReferencesCommand);
    const [uri, position, locations] = lens.command.arguments as [string, { line: number }, Location[]];
    assert.equal(uri, component.document.uri);
    assert.equal(position.line, component.at("const count").line);
    assert.equal(locations.length, 4);
    const doubled = lenses.find((item) => item.range.start.line === component.at("const doubled").line);
    assert.equal(doubled?.command?.title, "2 lecturas · 0 escrituras · en la plantilla");
  });

  test("a .value is reactive by the type of its object, not by its name", async () => {
    const plain = await workspace.open("Plain.meeko");
    const tokens = decodeTokens(semanticTokens(plain).data, semanticTokensLegend);
    const reactiveNames = ["signal", "computed", "resource", "reactive", "modification"];
    // A name without a semantic token has no modifiers either.
    const modifiersAt = (needle: string, delta = 0, from?: string, required = true): string[] => {
      const position = plain.document.positionAt(plain.offset(needle, delta, from));
      const token = tokens.find((item) => item.line === position.line && item.character <= position.character && position.character < item.character + item.length);
      if (required) assert.ok(token, `token at ${needle}`);
      return token?.modifiers.filter((modifier) => reactiveNames.includes(modifier)) ?? [];
    };
    // `props` is a plain object: `props.value` is like `props.label`.
    assert.deepEqual(modifiersAt("props.label}", 1), []);
    assert.deepEqual(modifiersAt("props.value}", 1), []);
    assert.deepEqual(modifiersAt("value}", 0, "{props.value}"), []);
    // A real signal is reactive.
    assert.ok(modifiersAt("count.value}", 1).includes("signal"));
    assert.ok(modifiersAt("value}", 0, "{count.value}").includes("reactive"));
    // `.value` of a DOM element or of the event target is not a signal.
    assert.deepEqual(modifiersAt("el.value}", 1), []);
    assert.deepEqual(modifiersAt("value}", 0, "{el.value}"), []);
    assert.deepEqual(modifiersAt("value;", 0, "currentTarget", false), []);
    assert.deepEqual(modifiersAt("event.currentTarget", 0, undefined, false), []);
    const analysis = analyzeReactivity(workspace.project.service, plain.component);
    assert.deepEqual(analysis.declarations.map((declaration) => declaration.name), ["count"]);
    const inside = (needle: string) => {
      const offset = plain.offset(needle);
      return analysis.reactiveExpressions.some(([start, end]) => offset >= start && offset < end);
    };
    assert.deepEqual([inside("props.value}"), inside("count.value}"), inside("el.value}"), inside("(event) =>")], [false, true, false, false]);
    // The hover and the lens count only the signal.
    const propsHover = (hover(plain, plain.at("props.value}", 7))?.contents as MarkupContent | undefined)?.value ?? "";
    assert.doesNotMatch(propsHover, /\*\*Lecturas/);
    const lenses = (codeLenses(plain) as CodeLens[]).map((lens) => lens.command?.title);
    assert.deepEqual(lenses, ["1 lectura · 0 escrituras · en la plantilla"]);
  });

  test("a signal declared after the first browser await is browser only", async () => {
    const later = await workspace.open("Later.meeko");
    const analysis = analyzeReactivity(workspace.project.service, later.component);
    assert.deepEqual(analysis.declarations.map((declaration) => [declaration.name, declaration.browserOnly]), [["before", false], ["after", true]]);
    assert.match((hover(later, later.at("after = "))?.contents as MarkupContent).value, /Sólo navegador: se declara después del primer `await` de navegador/);
    // An awaited element ref is the element, not a signal.
    assert.ok(!analysis.declarations.some((declaration) => declaration.name === "input"));
  });
});
