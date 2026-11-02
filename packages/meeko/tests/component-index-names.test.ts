import assert from "node:assert/strict";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import test from "node:test";
import { pathToFileURL } from "node:url";
import { TextDocument } from "vscode-languageserver-textdocument";

import type { FeatureContext } from "../src/language-server/features.ts";

import { generateComponentRegistry } from "../src/autoimports/components.ts";
import { discoverAutoImports, discoverComponents, discoverComponentsSync } from "../src/autoimports/registry.ts";
import { checkFrameworkProject } from "../src/framework/check-project.ts";
import { generateComponentRegistryTypes } from "../src/framework/type-declarations.ts";
import { componentDiagnostics } from "../src/language-server/diagnostics.ts";
import { componentNameCompletion, definition, hover } from "../src/language-server/features.ts";
import { MeekoProject } from "../src/language-server/project.ts";
import { linkRepositoryPackages, tempProject } from "./helpers/temp-project.ts";

async function put(root: string, path: string, source: string): Promise<void> {
  const file = join(root, path);
  await mkdir(dirname(file), { recursive: true });
  await writeFile(file, source);
}

const button = `<script lang="ts">
const props = defineProps<{ label: string }>();
const emit = defineEmits<{ press: [] }>();
const snippets = defineSnippets<{ default: [] }>();
defineExpose({ focus: (): void => {} });
</script>
<template><button type="button" on:click="() => emit('press')">{props.label}<render snippet="snippets.default" /></button></template>
`;

const names = async (root: string): Promise<Array<[string, string | undefined]>> => (await discoverComponents(root)).map((entry) => [entry.name, entry.deprecatedFor]);

test("Carpeta/Index.meeko takes the name of its folder, and the old name stays as a deprecated alias", async (context) => {
  const root = await tempProject(context, "index-names");
  await put(root, "package.json", '{"private":true,"type":"module"}\n');
  await put(root, "meeko.config.mjs", "export default {};\n");
  await put(root, "app/components/Button/Index.meeko", "<template><p>x</p></template>");
  await put(root, "app/components/Form/Card/index.meeko", "<template><p>x</p></template>");
  // A root Index has no folder to take a name from; a nested one only loses the last segment.
  await put(root, "app/components/Index.meeko", "<template><p>x</p></template>");
  await put(root, "app/components/Deep/Index/Index.meeko", "<template><p>x</p></template>");
  // Only a file that is called index: not one that contains it.
  await put(root, "app/components/List/IndexItem.meeko", "<template><p>x</p></template>");
  const expected: Array<[string, string | undefined]> = [
    ["Button", undefined],
    ["ButtonIndex", "Button"],
    ["DeepIndex", undefined],
    ["DeepIndexIndex", "DeepIndex"],
    ["FormCard", undefined],
    ["FormCardIndex", "FormCard"],
    ["Index", undefined],
    ["ListIndexItem", undefined],
  ];
  assert.deepEqual(await names(root), expected);
  assert.deepEqual(discoverComponentsSync(root).map((entry) => [entry.name, entry.deprecatedFor]), expected);
  // Each type of the alias points to the type of the new name.
  const registry = await discoverAutoImports(root);
  for (const suffix of ["", "Props", "Emits", "Snippets", "Models", "Exposed"]) {
    assert.equal(registry.find((entry) => entry.name === `ButtonIndex${suffix}`)?.deprecatedFor, `Button${suffix}`, suffix);
    assert.equal(registry.find((entry) => entry.name === `Button${suffix}`)?.deprecatedFor, undefined, suffix);
  }
});

test("the names of a layer and of a module directory with a prefix collapse too, and the first source still wins", async (context) => {
  const root = await tempProject(context, "index-names-sources");
  await put(root, "package.json", '{"private":true,"type":"module"}\n');
  await put(root, "meeko.config.mjs", 'import kit from "./modules/kit/index.mjs";\nexport default { extends: ["./base"], modules: [kit] };\n');
  await put(root, "modules/kit/index.mjs", `import { defineMeekoModule } from "@meekojs/meeko/framework";
export default defineMeekoModule({ meta: { name: "kit" }, setup(_options, meeko) { meeko.addComponentsDir("./modules/kit/components", { prefix: "Kit" }); } });
`);
  await linkRepositoryPackages(root);
  await put(root, "modules/kit/components/Button/index.meeko", "<template><p>x</p></template>");
  await put(root, "modules/kit/components/Index.meeko", "<template><p>x</p></template>");
  await put(root, "base/app/pages/layer.meeko", "<template><p>layer</p></template>");
  await put(root, "base/app/components/Panel/Index.meeko", "<template><p>layer</p></template>");
  await put(root, "base/app/components/Card/Index.meeko", "<template><p>layer</p></template>");
  // The project's Card keeps its name, and the layer's Index the only one it has.
  await put(root, "app/components/Card.meeko", "<template><p>project</p></template>");
  const found = await discoverComponents(root);
  assert.deepEqual(found.map((entry) => [entry.name, entry.deprecatedFor]), [
    ["Card", undefined],
    ["CardIndex", undefined],
    ["KitButton", undefined],
    ["KitButtonIndex", "KitButton"],
    ["KitIndex", undefined],
    ["Panel", undefined],
    ["PanelIndex", "Panel"],
  ]);
  assert.match(found.find((entry) => entry.name === "Card")!.file, /[\\/]app[\\/]components[\\/]Card\.meeko$/);
  assert.match(found.find((entry) => entry.name === "CardIndex")!.file, /[\\/]base[\\/]app[\\/]components[\\/]Card[\\/]Index\.meeko$/);
});

test("Button.meeko keeps <Button> and Button/Index.meeko keeps <ButtonIndex>, not deprecated, in one source and across sources", async (context) => {
  const entry = async (root: string, name: string) => (await discoverComponents(root)).find((component) => component.name === name)!;
  const root = await tempProject(context, "index-names-duplicate");
  await put(root, "package.json", '{"private":true,"type":"module"}\n');
  await put(root, "meeko.config.mjs", "export default {};\n");
  await put(root, "app/components/Button.meeko", "<template><p>x</p></template>");
  await put(root, "app/components/Button/Index.meeko", "<template><p>x</p></template>");
  assert.deepEqual(await names(root), [["Button", undefined], ["ButtonIndex", undefined]]);
  assert.deepEqual(discoverComponentsSync(root).map((component) => [component.name, component.deprecatedFor]), [["Button", undefined], ["ButtonIndex", undefined]]);
  assert.match((await entry(root, "Button")).file, /Button\.meeko$/);
  assert.equal((await entry(root, "Button")).conflictsWith, undefined);
  assert.match((await entry(root, "ButtonIndex")).conflictsWith!.file, /Button\.meeko$/);
  // Its types are not deprecated either, and each one is of its own file.
  const registry = await discoverAutoImports(root);
  for (const suffix of ["", "Props", "Emits", "Snippets", "Models", "Exposed"]) assert.equal(registry.find((item) => item.name === `ButtonIndex${suffix}`)?.deprecatedFor, undefined, suffix);
  assert.match(registry.find((item) => item.name === "ButtonProps")!.file, /Button\.meeko$/);
  assert.match(registry.find((item) => item.name === "ButtonIndexProps")!.file, /Index\.meeko$/);

  // A real name wins across sources in either direction: <Button> never changes file.
  const layered = await tempProject(context, "index-names-layer");
  await put(layered, "package.json", '{"private":true,"type":"module"}\n');
  await put(layered, "meeko.config.mjs", 'export default { extends: ["./base"] };\n');
  await put(layered, "base/app/pages/layer.meeko", "<template><p>layer</p></template>");
  await put(layered, "base/app/components/Button.meeko", "<template><p>layer</p></template>");
  await put(layered, "app/components/Button/Index.meeko", "<template><p>project</p></template>");
  assert.deepEqual(await names(layered), [["Button", undefined], ["ButtonIndex", undefined]]);
  assert.match((await entry(layered, "Button")).file, /[\\/]base[\\/]app[\\/]components[\\/]Button\.meeko$/);
  assert.match((await entry(layered, "ButtonIndex")).conflictsWith!.file, /[\\/]base[\\/]/);

  // The same with a prefix: a module whose folder has both.
  const moduled = await tempProject(context, "index-names-module");
  await linkRepositoryPackages(moduled);
  await put(moduled, "package.json", '{"private":true,"type":"module"}\n');
  await put(moduled, "meeko.config.mjs", 'export default { modules: ["./modules/kit"] };\n');
  await put(moduled, "modules/kit/index.mjs", `import { defineMeekoModule } from "@meekojs/meeko/framework";
export default defineMeekoModule({ meta: { name: "kit" }, setup(_options, meeko) { meeko.addComponentsDir("./modules/kit/components", { prefix: "Kit" }); } });
`);
  await put(moduled, "modules/kit/components/Button.meeko", "<template><p>x</p></template>");
  await put(moduled, "modules/kit/components/Button/index.meeko", "<template><p>x</p></template>");
  assert.deepEqual(await names(moduled), [["KitButton", undefined], ["KitButtonIndex", undefined]]);

  // With a real ButtonIndex as well, the old name has two files: the duplicate error of today.
  await put(root, "app/components/ButtonIndex.meeko", "<template><p>x</p></template>");
  await assert.rejects(discoverComponents(root), /Nombre de componente duplicado ButtonIndex/);

  // Without Button.meeko, a real ButtonIndex keeps its name and there is no conflict.
  const other = await tempProject(context, "index-names-real");
  await put(other, "package.json", '{"private":true,"type":"module"}\n');
  await put(other, "meeko.config.mjs", "export default {};\n");
  await put(other, "app/components/Button/Index.meeko", "<template><p>x</p></template>");
  await put(other, "app/components/ButtonIndex.meeko", "<template><p>real</p></template>");
  assert.deepEqual(await names(other), [["Button", undefined], ["ButtonIndex", undefined]]);
});

test("a conflict is MEEK135 on the Index file, in meeko check and the editor, and both components work everywhere without MEEK134", { timeout: 240_000 }, async (context) => {
  const root = await tempProject(context, "index-names-conflict");
  await linkRepositoryPackages(root);
  await put(root, "package.json", '{"private":true,"type":"module"}\n');
  await put(root, "meeko.config.mjs", "export default {};\n");
  await put(root, "app/components/Button.meeko", '<script lang="ts">\nconst props = defineProps<{ plain: string }>();\n</script>\n<template><p>{props.plain}</p></template>\n');
  await put(root, "app/components/Button/Index.meeko", button);
  const page = `<script lang="ts">
import { signal } from "@meekojs/meeko";
const plain: ButtonProps = { plain: "a" };
const own: ButtonIndexProps = { label: "a" };
const events: ButtonIndexEmits = { press: [] };
const all: ComponentProps<"ButtonIndex"> = { label: "a", onPress: () => {} };
const first = resolveComponent("Button");
const second = resolveComponent("ButtonIndex");
const on = signal(true);
void plain; void own; void events; void all; void first; void second;
</script>
<template><main><Button plain="a" /><ButtonIndex label="b">x</ButtonIndex><component is="on.value ? 'ButtonIndex' : 'section'" label="c">y</component></main></template>
`;
  await put(root, "app/pages/index.meeko", page);
  const found = await checkFrameworkProject(root);
  assert.deepEqual(found.filter((item) => item.severity !== "warning"), []);
  assert.deepEqual(found.filter((item) => item.code === "MEEK134"), [], "ButtonIndex is its only name");
  const conflicts = found.filter((item) => item.code === "MEEK135");
  assert.equal(conflicts.length, 1, JSON.stringify(found));
  assert.match(conflicts[0]!.filename, /Button[\\/]Index\.meeko$/);
  assert.equal(conflicts[0]!.message, "app/components/Button/Index.meeko se llamaría <Button>, pero ese nombre es de app/components/Button.meeko: sigue siendo <ButtonIndex>. En Meeko 2.0 será un error; renombra o mueve uno de los dos");
  const types = await readFile(await generateComponentRegistryTypes(root), "utf8");
  assert.doesNotMatch(types, /@deprecated/);
  const loader = await readFile(await generateComponentRegistry(root), "utf8");
  assert.match(loader, /"Button": \(\) => import\("[^"]*Button\.meeko"\)/);
  assert.match(loader, /"ButtonIndex": \(\) => import\("[^"]*Index\.meeko"\)/);

  const project = new MeekoProject(root, { trusted: false });
  try {
    await project.ready();
    const indexFile = join(root, "app", "components", "Button", "Index.meeko");
    assert.ok(project.setDocument(indexFile, button), String(project.componentError(indexFile)));
    const onIndex = await componentDiagnostics(project, TextDocument.create(pathToFileURL(indexFile).href, "meeko", 1, button), indexFile, () => undefined);
    assert.deepEqual(onIndex.map((item) => item.code), ["MEEK135"]);

    const file = join(root, "app", "pages", "index.meeko");
    assert.ok(project.setDocument(file, page), String(project.componentError(file)));
    const document = TextDocument.create(pathToFileURL(file).href, "meeko", 1, page);
    assert.deepEqual(await componentDiagnostics(project, document, file, () => undefined), []);

    const typing = TextDocument.create(pathToFileURL(file).href, "meeko", 1, "<template><But</template>\n");
    const offered = componentNameCompletion(project, typing, file, typing.positionAt("<template><But".length))!.map((item) => item.label);
    assert.ok(offered.includes("Button") && offered.includes("ButtonIndex"), offered.join());

    const located = (path: string) => ({ uri: pathToFileURL(path).href, document: TextDocument.create(pathToFileURL(path).href, "meeko", 1, button) });
    const feature: FeatureContext = { project, component: project.component(file)!, document, locate: located };
    const at = (text: string) => document.positionAt(page.indexOf(text) + 2);
    assert.ok(definition(feature, at("<ButtonIndex label"))!.some((target) => /Button\/Index\.meeko$/.test(target.uri)));
    assert.ok(definition(feature, at('<Button plain'))!.some((target) => /components\/Button\.meeko$/.test(target.uri)));
    // The card names each component as it is called, and its own file.
    const card = JSON.stringify(hover(feature, at("<ButtonIndex label"))?.contents ?? null);
    assert.match(card, /ButtonIndex/);
    assert.match(card, /Button\/Index\.meeko/);
    assert.match(JSON.stringify(hover(feature, at("<Button plain"))?.contents ?? null), /plain/);
  } finally {
    project.service.dispose();
  }
});

test("meeko check does not warn about an old name outside a .meeko: ButtonIndexProps in a .ts compiles", { timeout: 240_000 }, async (context) => {
  // Written in the docs as it is: MEEK134 comes from compiling a .meeko.
  const root = await tempProject(context, "index-names-ts");
  await linkRepositoryPackages(root);
  await put(root, "package.json", '{"private":true,"type":"module"}\n');
  await put(root, "meeko.config.mjs", "export default {};\n");
  await put(root, "app/components/Button/Index.meeko", button);
  await put(root, "app/utils/legacy.ts", 'export const legacy: ButtonIndexProps = { label: "a" };\n');
  await put(root, "app/pages/index.meeko", "<template><p>x</p></template>\n");
  assert.deepEqual(await checkFrameworkProject(root), []);
  // The declaration carries the mark that an editor shows in that file.
  assert.match(await readFile(join(root, ".meeko", "types", "autoimports", "client.d.ts"), "utf8"), /@deprecated Usa ButtonProps:[^\n]*\n\s*export import ButtonIndexProps/);
});

test("<Button>, its types, resolveComponent and is work with the new name; the old one works with MEEK134, in meeko check and the editor", { timeout: 240_000 }, async (context) => {
  const root = await tempProject(context, "index-names-project");
  await linkRepositoryPackages(root);
  await put(root, "package.json", '{"private":true,"type":"module"}\n');
  await put(root, "meeko.config.mjs", "export default {};\n");
  await put(root, "app/components/Button/Index.meeko", button);
  const current = `<script lang="ts">
import { signal } from "@meekojs/meeko";
const props: ButtonProps = { label: "a" };
const events: ButtonEmits = { press: [] };
const snippets: ButtonSnippets = { default: undefined as never };
const exposed: ButtonExposed | null = null;
const loaded = resolveComponent("Button");
const all: ComponentProps<"Button"> = { label: "a", onPress: () => {} };
const on = signal(true);
void props; void events; void snippets; void exposed; void loaded; void all;
</script>
<template><main><Button label="a" on:press="() => {}">x</Button><component is="on.value ? 'Button' : 'section'" label="b">y</component></main></template>
`;
  await put(root, "app/pages/index.meeko", current);
  assert.deepEqual(await checkFrameworkProject(root), []);
  const generated = await readFile(await generateComponentRegistry(root), "utf8");
  assert.match(generated, /"Button": \(\) => import\(/);
  assert.match(generated, /"ButtonIndex": \(\) => import\(/);
  assert.match(await readFile(await generateComponentRegistryTypes(root), "utf8"), /@deprecated Usa Button:[^\n]*\n\s*readonly "ButtonIndex"/);

  // The old names still compile, each with one warning, at the place where it is used.
  const legacy = `<script lang="ts">
import { signal } from "@meekojs/meeko";
const props: ButtonIndexProps = { label: "a" };
const loaded = resolveComponent("ButtonIndex");
const on = signal(true);
void props; void loaded; void on;
</script>
<template><main><ButtonIndex label="a">x</ButtonIndex><ButtonIndex label="b">y</ButtonIndex></main></template>
`;
  await put(root, "app/pages/index.meeko", legacy);
  const found = await checkFrameworkProject(root);
  assert.deepEqual(found.filter((item) => item.severity !== "warning"), []);
  const warnings = found.filter((item) => item.code === "MEEK134");
  assert.deepEqual(warnings.map((item) => [legacy.slice(item.location.offset).match(/^\w+/)?.[0], item.message.split(" está")[0]]), [
    ["ButtonIndexProps", "ButtonIndexProps"],
    ["ButtonIndex", "<ButtonIndex>"],
  ]);
  assert.match(warnings[1]!.message, /<ButtonIndex> está obsoleto desde Meeko 1\.8 y se retira en 2\.0: app\/components\/Button\/Index\.meeko se llama ahora <Button>, como su carpeta/);

  // `is` with the old name, and resolveComponent alone.
  const named = `<script lang="ts">
import { signal } from "@meekojs/meeko";
const on = signal(true);
const loaded = resolveComponent("ButtonIndex");
void loaded;
</script>
<template><component is="on.value ? 'ButtonIndex' : 'section'" label="b">y</component></template>
`;
  await put(root, "app/pages/index.meeko", named);
  assert.deepEqual((await checkFrameworkProject(root)).filter((item) => item.code === "MEEK134").length, 1);
  await put(root, "app/pages/index.meeko", `<script lang="ts">\nconst loaded = resolveComponent("ButtonIndex");\nvoid loaded;\n</script>\n<template><p>x</p></template>\n`);
  assert.deepEqual((await checkFrameworkProject(root)).filter((item) => item.code === "MEEK134").map((item) => item.location.line), [2]);

  // The editor: the same warning, the new name is what it offers, and hover and definition follow both.
  await put(root, "app/pages/index.meeko", current);
  const project = new MeekoProject(root, { trusted: false });
  try {
    await project.ready();
    const page = join(root, "app", "pages", "legacy.meeko");
    const source = legacy;
    assert.ok(project.setDocument(page, source), String(project.componentError(page)));
    const document = TextDocument.create(pathToFileURL(page).href, "meeko", 1, source);
    const diagnostics = await componentDiagnostics(project, document, page, () => undefined);
    assert.deepEqual(diagnostics.filter((item) => item.code === "MEEK134").length, 2, JSON.stringify(diagnostics));

    const typing = "<template><But|</template>\n";
    const offset = typing.indexOf("|");
    const text = typing.replace("|", "");
    const completionDocument = TextDocument.create(pathToFileURL(page).href, "meeko", 1, text);
    const offered = componentNameCompletion(project, completionDocument, page, completionDocument.positionAt(offset))!.map((item) => item.label);
    assert.ok(offered.includes("Button"), offered.join());
    assert.ok(!offered.includes("ButtonIndex"), offered.join());

    const located = (file: string) => ({ uri: pathToFileURL(file).href, document: TextDocument.create(pathToFileURL(file).href, "meeko", 1, button) });
    const context_: FeatureContext = { project, component: project.component(page)!, document, locate: located };
    const tag = (text_: string): string => {
      const shown = hover(context_, document.positionAt(source.indexOf(text_) + 2));
      return JSON.stringify(shown?.contents ?? null);
    };
    // The card of the old tag shows the name it has now, and its file.
    assert.match(tag("<ButtonIndex label=\"a\""), /Button/);
    assert.match(tag("<ButtonIndex label=\"a\""), /Button\/Index\.meeko/);
    // Definition goes to the same file from the old tag.
    const targets = definition(context_, document.positionAt(source.indexOf("<ButtonIndex label=\"a\"") + 2)) ?? [];
    assert.ok(targets.some((target) => /Button\/Index\.meeko$/.test(target.uri)), JSON.stringify(targets));
  } finally {
    project.service.dispose();
  }
});
