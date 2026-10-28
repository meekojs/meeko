import assert from "node:assert/strict";
import test from "node:test";
import { TextDocument } from "vscode-languageserver-textdocument";
import { classCompletion, classDefinition } from "../src/language-server/classes.ts";
import {
  cssCompletion, cssHover, documentColors, hoverText, htmlCompletion, htmlHover, linkedEditingRanges, styleClasses, styleDiagnostics, tagCompletion,
} from "../src/language-server/embedded.ts";

/** A component and the position of `|` in it. */
function at(text: string): { document: TextDocument; position: ReturnType<TextDocument["positionAt"]> } {
  const offset = text.indexOf("|");
  const document = TextDocument.create("file:///Card.meeko", "meeko", 1, text.replace("|", ""));
  return { document, position: document.positionAt(offset) };
}

const component = (template: string, style = ".card { color: red; }", styleAttributes = " scoped"): string =>
  `<script lang="ts">\nconst open = signal(false);\n</script>\n<template>\n${template}\n</template>\n<style${styleAttributes}>\n${style}\n</style>\n`;

test("the template completes HTML tag names and attribute values, not expressions or components", () => {
  const tags = at(component(`<div><butt|</div>`));
  assert.ok(htmlCompletion(tags.document, tags.position)?.items.some((item) => item.label === "button"));
  const values = at(component(`<input type="|">`));
  assert.ok(htmlCompletion(values.document, values.position)?.items.some((item) => item.label === "checkbox"));
  const expression = at(component(`<p bind:title="op|"></p>`));
  assert.equal(htmlCompletion(expression.document, expression.position), undefined);
  const interpolation = at(component(`<p>{op|}</p>`));
  assert.equal(htmlCompletion(interpolation.document, interpolation.position), undefined);
  const insideComponent = at(component(`<AppCard |></AppCard>`));
  assert.equal(htmlCompletion(insideComponent.document, insideComponent.position), undefined);
  const script = at(`<script lang="ts">\nconst x = 1;|\n</script>\n<template><p></p></template>`);
  assert.equal(htmlCompletion(script.document, script.position), undefined);
});

test("<sn right inside a component tag offers <snippet name>, also in <MeekoThemeToggle>, not in <MeekoLink> or an element", () => {
  const snippetItem = (template: string) => {
    const { document, position } = at(component(template));
    return htmlCompletion(document, position)?.items.find((item) => item.label === "snippet");
  };
  for (const template of ["<AppCard><sn|</AppCard>", "<AppCard>\n  <snippet name=\"header\">H</snippet>\n  <|\n</AppCard>", "<MeekoThemeToggle><sn|</MeekoThemeToggle>"]) {
    const item = snippetItem(template);
    assert.ok(item, template);
    assert.equal((item.textEdit as { newText: string }).newText, 'snippet name="$1">$0</snippet>');
    // The names of the child's snippets come right after.
    assert.equal(item.command?.command, "editor.action.triggerSuggest");
  }
  // `<snippet>` must be a direct child of a component tag (MEEK061); <MeekoLink> renders an <a>.
  for (const template of ["<MeekoLink to=\"/\"><sn|</MeekoLink>", "<div><sn|</div>", "<AppCard><p><sn|</p></AppCard>", "<sn|", "<AppCard><di|</AppCard>"]) {
    assert.equal(snippetItem(template), undefined, template);
  }
});

test("HTML tags and attributes have their MDN hover", () => {
  const tag = at(component(`<but|ton type="button"></button>`));
  assert.match(hoverText(htmlHover(tag.document, tag.position)), /button/i);
  const attribute = at(component(`<button ty|pe="button"></button>`));
  assert.match(hoverText(htmlHover(attribute.document, attribute.position)), /type/i);
});

test("opening and closing tags are edited together and > completes the closing tag", () => {
  const linked = at(component(`<sec|tion><p>x</p></section>`));
  const ranges = linkedEditingRanges(linked.document, linked.position)!;
  assert.deepEqual(ranges.map((range) => linked.document.getText(range)), ["section", "section"]);
  const closing = at(component(`<section>|`));
  assert.equal(tagCompletion(closing.document, closing.position), "$0</section>");
});

test("<style> has CSS completion, hover and colors", () => {
  const property = at(component(`<p class="card"></p>`, `.card { colo|: red; }`));
  assert.ok(cssCompletion(property.document, property.position)?.items.some((item) => item.label === "color"));
  const hover = at(component(`<p class="card"></p>`, `.card { dis|play: grid; }`));
  assert.match(hoverText(cssHover(hover.document, hover.position)), /display/);
  const { document } = at(component(`<p class="card">|</p>`, `.card { color: #ff0000; background: rgb(0 0 255); }`));
  assert.equal(documentColors(document).length, 2);
  const outside = at(component(`<p class="card">|</p>`));
  assert.equal(cssCompletion(outside.document, outside.position), undefined);
});

test("the classes of <style> complete in class=\"…\" and lead to their selectors", () => {
  const source = component(`<p class="card |"></p>`, `.card { color: red; }\n.card-title, .badge:hover { font-weight: 700; }\n:global(.external) { margin: 0; }`);
  assert.deepEqual(styleClasses(source.replace("|", "")).map((entry) => [entry.name, entry.global]), [["card", false], ["card-title", false], ["badge", false], ["external", true]]);
  const completion = at(source);
  assert.deepEqual(classCompletion(completion.document, completion.position)!.map((item) => item.label), ["card-title", "badge", "external"]);
  const definition = at(component(`<p class="ba|dge"></p>`, `.card { color: red; }\n.badge:hover { font-weight: 700; }`));
  const targets = classDefinition(definition.document, definition.position)!;
  assert.deepEqual(targets.map((target) => definition.document.getText(target.range)), [".badge"]);
  const notClass = at(component(`<p id="ba|dge"></p>`, `.badge { color: red; }`));
  assert.equal(classDefinition(notClass.document, notClass.position), undefined);
});

test("<style scoped> reports CSS errors and classes that neither the template nor the script names", () => {
  const { document } = at(`<script lang="ts">
const tone = signal("info");
const open = signal(false);
const classes = computed(() => ["chip", open.value ? "chip--wide" : ""].join(" "));
</script>
<template>
<p class="card" bind:class="open.value ? 'is-open' : ''"><span bind:class="\`badge badge--\${tone.value}\`">|</span></p>
</template>
<style scoped>
.card { color: red; }
.is-open { color: blue; }
.badge--info { color: navy; }
.chip--wide { width: 100%; }
.stale { color: green; }
:global(.external) { margin: 0; }
.broken { color: ; }
</style>
`);
  const found = styleDiagnostics(document);
  assert.deepEqual(found.filter((item) => item.code === "MEEK_UNUSED_CLASS").map((item) => document.getText(item.range)), [".stale", ".broken"]);
  assert.ok(found.some((item) => item.code !== "MEEK_UNUSED_CLASS" && /expected/i.test(String(item.message))), JSON.stringify(found));
  assert.ok(!found.some((item) => /global/.test(String(item.message))), "`:global(…)` is not an unknown pseudo-class");
  // Without `scoped` the styles may reach other components: no class is reported.
  const global = at(component(`<p>|</p>`, `.stale { color: green; }`, ""));
  assert.deepEqual(styleDiagnostics(global.document), []);
});
