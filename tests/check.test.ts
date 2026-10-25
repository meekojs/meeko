import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { join, relative, resolve } from "node:path";
import test from "node:test";
import { promisify } from "node:util";
import { checkSource } from "../src/check.ts";
import { generateTypes } from "../src/types.ts";

const execFileAsync = promisify(execFile);
const exampleDirectory = resolve("examples/counter");

test("types rechaza entradas que podrían sobrescribir el archivo fuente", async () => {
  await assert.rejects(generateTypes("", "Component.ts"), /requires a \.meeko input file/);
});

test("checkSource sitúa errores de tipos de script y plantilla en .meeko", async () => {
  const cases = [
    { source: `<script lang="ts">\nconst value: number = "bad";\n</script>\n<template>{value}</template>`, code: "TS2322", line: 2 },
    { source: `<script lang="ts">const value = 1;</script>\n<template><p>{missing}</p></template>`, code: "TS2304", line: 2 },
    { source: `<script lang="ts">const value = 1;</script>\n<template><p bind:title="missing">{value}</p></template>`, code: "TS2304", line: 2 },
    { source: `<script lang="ts">const value = 1;</script>\n<template><button on:click="42">{value}</button></template>`, code: "TS2345", line: 2 },
    { source: `<script lang="ts">const items = [{ id: "a" }];</script>\n<template><p each:of="items" each:as="item" each:key="item.id">{item.missing}</p></template>`, code: "TS2339", line: 2 },
    { source: `<script lang="ts">const items = [{ id: "a" }];</script>\n<template><p each:of="items" each:as="item" each:key="item.id">{index.toUpperCase()}</p></template>`, code: "TS2339", line: 2 },
    { source: `<script lang="ts">const items = [{ id: "a" }];</script>\n<template><p each:of="items" each:as="item" each:key="item">{item.id}</p></template>`, code: "TS2322", line: 2 },
    { source: `<script lang="ts">const props = defineProps<{ initial: number }>();\nconst value = props.initial.toUpperCase();</script>\n<template>{value}</template>`, code: "TS2339", line: 2 },
    { source: `<script lang="ts">const props = defineProps<{ initial: number }>();\nconst value: string = props.initial;</script>\n<template>{value}</template>`, code: "TS2322", line: 2 },
    { source: `<script lang="ts">const handler = (event: KeyboardEvent): void => { void event.key; };</script>\n<template><button on:click="handler">Click</button></template>`, code: "TS2345", line: 2 },
  ];
  for (const [index, item] of cases.entries()) {
    const diagnostics = await checkSource(item.source, join(exampleDirectory, `TypeCase${index}.meeko`));
    const error = diagnostics.find((diagnostic) => diagnostic.code === item.code);
    assert.ok(error, `Expected ${item.code}: ${JSON.stringify(diagnostics)}`);
    assert.equal(error.filename, join(exampleDirectory, `TypeCase${index}.meeko`));
    assert.equal(error.location.line, item.line, `Case ${index}: ${JSON.stringify(diagnostics)}`);
    assert.ok(error.location.column > 1);
    assert.doesNotMatch(error.message, /Generated TypeScript/);
    if (item.code === "TS2304") assert.equal(error.location.offset, item.source.indexOf("missing"));
  }
});

test("checkSource conserva errores sintácticos y no deja archivos temporales", async () => {
  const source = `<script lang="ts">const value = ;</script><template>{value}</template>`;
  const diagnostics = await checkSource(source, join(exampleDirectory, "SyntaxCase.meeko"));
  assert.equal(diagnostics.length, 1);
  assert.equal(diagnostics[0]?.code, "MEEK013");
  const names = await readdir(exampleDirectory);
  assert.equal(names.some((name) => name.includes("__meeko_check_")), false);
});

test("CLI check ofrece JSON y compile no emite código con errores de tipos", async () => {
  const directory = await mkdtemp(join(exampleDirectory, ".meeko-check-test-"));
  const input = join(directory, "Broken.meeko");
  const output = join(directory, "Broken.generated.ts");
  await writeFile(input, `<script lang="ts">const value: number = "bad";</script><template>{value}</template>`);
  try {
    await assert.rejects(execFileAsync(process.execPath, [resolve("dist/cli.js"), "compile", input, output]), (error: unknown) => {
      assert.match(String(error), /TS2322/);
      return true;
    });
    await assert.rejects(readFile(output, "utf8"), { code: "ENOENT" });
    await assert.rejects(execFileAsync(process.execPath, [resolve("dist/cli.js"), "check", input, "--json"]), (error: unknown) => {
      const failure = error as Error & { stdout?: string };
      const diagnostics = JSON.parse(failure.stdout ?? "") as Array<{ code: string; location: { line: number } }>;
      assert.equal(diagnostics[0]?.code, "TS2322");
      assert.equal(diagnostics[0]?.location.line, 1);
      return true;
    });
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("checkSource resuelve imports .meeko anidados y comprueba props del hijo", async () => {
  const directory = resolve("examples/nested");
  const badValue = `<script lang="ts">import * as Child from "./Child.meeko";</script>\n<template><component is="Child" bind:label="42"></component></template>`;
  const wrongType = await checkSource(badValue, join(directory, "WrongProps.meeko"));
  assert.ok(wrongType.some((diagnostic) => /^TS\d+$/.test(diagnostic.code) && diagnostic.location.line === 2 && !diagnostic.message.startsWith("Generated TypeScript")), JSON.stringify(wrongType));
  const missingProp = `<script lang="ts">import * as Child from "./Child.meeko";</script>\n<template><component is="Child"></component></template>`;
  const missing = await checkSource(missingProp, join(directory, "MissingProps.meeko"));
  assert.ok(missing.some((diagnostic) => /^TS\d+$/.test(diagnostic.code) && diagnostic.location.line === 2), JSON.stringify(missing));
  const names = await readdir(directory);
  assert.equal(names.some((name) => name.includes("__meeko_check_")), false);
});

test("CLI types genera declaraciones de imports .meeko para un consumidor TS7", async () => {
  const parent = resolve("examples/nested/Parent.meeko");
  const { stdout } = await execFileAsync(process.execPath, [resolve("dist/cli.js"), "types", parent]);
  assert.match(stdout, /Parent\.d\.meeko\.ts/);
  assert.match(stdout, /Child\.d\.meeko\.ts/);
  assert.match(stdout, /Grandchild\.d\.meeko\.ts/);
  const declaration = await readFile(resolve(".meeko/types/examples/nested/Child.d.meeko.ts"), "utf8");
  assert.match(declaration, /export type ComponentProps = \{\s*label: string;/);
  await execFileAsync(process.execPath, [resolve("node_modules/typescript/bin/tsc"), "-p", resolve("examples/nested/tsconfig.json"), "--noEmit"]);
});

test("tipos externos y reexportados conservan las props estrictas entre componentes", async () => {
  const directory = await mkdtemp(join(exampleDirectory, ".meeko-types-test-"));
  const contract = join(directory, "contract.ts");
  const child = join(directory, "Child.meeko");
  const parent = join(directory, "Parent.meeko");
  const childSource = `<script lang="ts">
import type { ComputedRef, ExternalProps } from "./contract.js";
export type { ExternalProps } from "./contract.js";
export interface CardProps extends ExternalProps { label: string }
const props = defineProps<CardProps & ComputedRef<string>>();
</script><template><span>{props.label}: {props.value}</span></template>`;
  const parentSource = `<script lang="ts">
import * as Child from "./Child.meeko";
import type { CardProps } from "./Child.meeko";
const card: CardProps = { id: 1, label: "ok" };
</script><template><component is="Child" bind:id="card.id" bind:label="card.label" bind:value="'computed'"></component></template>`;
  await writeFile(contract, "export interface ExternalProps { id: number }\nexport interface ComputedRef<T> { readonly value: T }\n");
  await writeFile(child, childSource);
  await writeFile(parent, parentSource);
  try {
    assert.deepEqual(await checkSource(childSource, child), []);
    assert.deepEqual(await checkSource(parentSource, parent), []);
    const outputs = await generateTypes(parentSource, parent);
    assert.equal(outputs.length, 2);
    const declaration = await readFile(resolve(".meeko/types", relative(resolve("."), directory), "Child.d.meeko.ts"), "utf8");
    assert.match(declaration, /export type \{ ExternalProps \} from "[^"]+\/contract\.js"/);
    assert.match(declaration, /export interface CardProps extends ExternalProps/);
    assert.match(declaration, /CardProps & ComputedRef<string>/);
    const consumer = join(directory, "consumer.ts");
    await writeFile(consumer, `import type { CardProps, ComponentProps, ExternalProps } from "./Child.meeko";
const external: ExternalProps = { id: 1 };
const card: CardProps = { ...external, label: "ok" };
const props: ComponentProps = { ...card, value: "computed" };
void props;
`);
    const config = join(directory, "tsconfig.json");
    await writeFile(config, JSON.stringify({ compilerOptions: {
      noEmit: true, strict: true, skipLibCheck: true, module: "nodenext", moduleResolution: "nodenext",
      target: "es2022", allowArbitraryExtensions: true,
      rootDirs: [resolve("."), resolve(".meeko/types")],
    }, files: [consumer] }));
    await execFileAsync(process.execPath, [resolve("node_modules/typescript/bin/tsc"), "-p", config]);
    const bad = parentSource.replace("bind:value=\"'computed'\"", "bind:value=\"42\"");
    const errors = await checkSource(bad, parent);
    assert.ok(errors.some((diagnostic) => diagnostic.code === "TS2322" && diagnostic.filename === parent), JSON.stringify(errors));
  } finally {
    await rm(directory, { recursive: true, force: true });
    await rm(resolve(".meeko/types", relative(resolve("."), directory)), { recursive: true, force: true });
  }
});

test("un componente recibido como contenido conserva las props de su outlet", async () => {
  const directory = await mkdtemp(join(exampleDirectory, ".meeko-outlet-test-"));
  const content = join(directory, "Content.meeko");
  const host = join(directory, "Host.meeko");
  const parent = join(directory, "Parent.meeko");
  const hostSource = `<script lang="ts">
import type { Component } from "@meekojs/meeko";
const props = defineProps<{ content: Component<{ label: string }>; label: string }>();
</script><template><section><component is="props.content" bind:label="props.label"></component></section></template>`;
  const parentSource = `<script lang="ts">
import * as Content from "./Content.meeko";
import * as Host from "./Host.meeko";
</script><template><component is="Host" bind:content="Content" bind:label="'ok'"></component></template>`;
  await writeFile(content, `<script lang="ts">const props = defineProps<{ label: string }>();</script><template><strong>{props.label}</strong></template>`);
  await writeFile(host, hostSource);
  await writeFile(parent, parentSource);
  try {
    assert.deepEqual(await checkSource(parentSource, parent), []);
    const wrong = parentSource.replace("bind:content=\"Content\"", "bind:content=\"42\"");
    const errors = await checkSource(wrong, parent);
    assert.ok(errors.some((diagnostic) => diagnostic.code === "TS2322" && diagnostic.filename === parent), JSON.stringify(errors));
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("a nested component requires the SSR state transfer contract", async () => {
  const filename = join(exampleDirectory, "TransferContract.meeko");
  const source = `<script lang="ts">
import type { ComponentModule } from "@meekojs/meeko";
const props = defineProps<{ child: ComponentModule<{ label: string }> }>();
</script><template><component is="props.child" bind:label="'ok'"></component></template>`;
  const diagnostics = await checkSource(source, filename);
  assert.ok(diagnostics.some((diagnostic) => diagnostic.filename === filename &&
    /renderWithState/.test(diagnostic.message)), JSON.stringify(diagnostics));
  const valid = source.replaceAll("ComponentModule", "Component");
  assert.deepEqual(await checkSource(valid, filename), []);
});

test("un componente requerido no satisface un outlet que omite sus props", async () => {
  const directory = await mkdtemp(join(exampleDirectory, ".meeko-outlet-variance-test-"));
  const content = join(directory, "Content.meeko");
  const host = join(directory, "Host.meeko");
  const parent = join(directory, "Parent.meeko");
  const hostSource = `<script lang="ts">
import type { Component } from "@meekojs/meeko";
const props = defineProps<{ content: Component<{ label?: string }> }>();
</script><template><component is="props.content"></component></template>`;
  const parentSource = `<script lang="ts">
import * as Content from "./Content.meeko";
import * as Host from "./Host.meeko";
</script><template><component is="Host" bind:content="Content"></component></template>`;
  await writeFile(content, `<script lang="ts">const props = defineProps<{ label: string }>();</script><template><strong>{props.label}</strong></template>`);
  await writeFile(host, hostSource);
  await writeFile(parent, parentSource);
  try {
    const errors = await checkSource(parentSource, parent);
    assert.ok(errors.some((diagnostic) => diagnostic.code === "TS2322" && diagnostic.filename === parent &&
      diagnostic.location.offset >= parentSource.indexOf("bind:content")), JSON.stringify(errors));
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("callbacks de componente comprueban parámetros en ambos lados", async () => {
  const directory = await mkdtemp(join(exampleDirectory, ".meeko-callback-test-"));
  const child = join(directory, "Child.meeko");
  const parent = join(directory, "Parent.meeko");
  const childSource = `<script lang="ts">
export interface ChildProps { onSave: (id: number) => void }
const props = defineProps<ChildProps>();
</script><template><button on:click="() => props.onSave(1)">Save</button></template>`;
  const parentSource = `<script lang="ts">
import * as Child from "./Child.meeko";
const save = (id: number): void => { void id; };
</script><template><component is="Child" bind:onSave="save"></component></template>`;
  await writeFile(child, childSource);
  await writeFile(parent, parentSource);
  try {
    assert.deepEqual(await checkSource(parentSource, parent), []);
    const wrong = parentSource.replace("(id: number)", "(id: string)");
    assert.ok((await checkSource(wrong, parent)).some((diagnostic) => diagnostic.code === "TS2322"));
    const wrongEmit = childSource.replace("props.onSave(1)", "props.onSave('wrong')");
    assert.ok((await checkSource(wrongEmit, child)).some((diagnostic) => diagnostic.code === "TS2345"));
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("checkSource atribuye errores de un módulo TypeScript importado a ese archivo", async () => {
  const directory = await mkdtemp(join(exampleDirectory, ".meeko-import-diagnostic-test-"));
  const helper = join(directory, "helper.ts");
  const component = join(directory, "Importing.meeko");
  const source = `<script lang="ts">import { value } from "./helper.js";</script><template>{value}</template>`;
  const helperSource = 'export const okay = 1;\nexport const value: number = "wrong";\n';
  await writeFile(helper, helperSource);
  await writeFile(component, source);
  try {
    const diagnostics = await checkSource(source, component);
    const error = diagnostics.find((diagnostic) => diagnostic.code === "TS2322");
    assert.ok(error, JSON.stringify(diagnostics));
    assert.equal(error.filename, helper);
    assert.equal(error.location.line, 2);
    assert.ok(error.location.column > 1);
    assert.equal(error.location.offset, helperSource.indexOf("value"));
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
