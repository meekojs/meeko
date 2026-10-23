import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
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
  const declaration = await readFile(resolve("examples/nested/Child.d.meeko.ts"), "utf8");
  assert.match(declaration, /export type ComponentProps = \{\s*label: string;/);
  await execFileAsync(process.execPath, [resolve("node_modules/typescript/bin/tsc"), "-p", resolve("examples/nested/tsconfig.json"), "--noEmit"]);
});
