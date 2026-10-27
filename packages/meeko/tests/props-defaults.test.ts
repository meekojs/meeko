import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdtemp, mkdir, readFile, rm, symlink, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import test from "node:test";
import { promisify } from "node:util";
import { Window } from "happy-dom";
import { createServer } from "vite";
import { checkSource } from "../src/check.ts";
import { compile } from "../src/compiler.ts";
import { generateTypes } from "../src/types.ts";
import { meeko } from "../src/vite.ts";

const run = promisify(execFile);
const fixture = resolve("tests/fixtures/PropsDefaults.meeko");

test("defineProps defaults are isolated and agree between SSR and hydration", { timeout: 35_000 }, async () => {
  const source = await readFile(fixture, "utf8");
  assert.deepEqual((await checkSource(source, fixture)).filter((diagnostic) => diagnostic.severity !== "warning"), []);
  const server = await createServer({ configFile: false, plugins: [meeko()], server: { middlewareMode: true, hmr: false } });
  const browser = new Window();
  try {
    const component = await server.ssrLoadModule(fixture) as {
      renderWithState(props: { required: string; count?: number; label?: string | undefined; tags?: string[] }): { html: string; state: Record<string, unknown> };
      hydrate(root: Element, props: { required: string }, state?: Record<string, unknown>): () => void;
    };
    const rendered = component.renderWithState({ required: "First" });
    const first = browser.document.createElement("main");
    first.innerHTML = rendered.html;
    assert.match(first.textContent, /First:.*Default.*\(1\).*0/s);
    const release = component.hydrate(first as unknown as Element, { required: "First" }, rendered.state);
    first.querySelector("button")!.click();
    assert.match(first.textContent, /First:.*Default.*\(1\).*1/);

    const second = browser.document.createElement("main");
    const secondRendered = component.renderWithState({ required: "Second", label: undefined });
    second.innerHTML = secondRendered.html;
    const releaseSecond = component.hydrate(second as unknown as Element, { required: "Second" }, secondRendered.state);
    assert.match(second.textContent, /Second:.*Default.*\(1\).*0/);
    releaseSecond();
    release();
    const third = browser.document.createElement("main");
    third.innerHTML = component.renderWithState({ required: "Third", count: 4, label: "Custom" }).html;
    assert.match(third.textContent, /Third:.*Custom.*\(4\)/s);
  } finally {
    browser.happyDOM.abort();
    await server.close();
  }
});

test("generated ComponentProps makes only defaulted fields optional to TypeScript", async () => {
  const root = await mkdtemp(resolve(".meeko/props-types-"));
  try {
    const sourceFile = join(root, "src", "Card.meeko");
    await mkdir(join(root, "src"), { recursive: true });
    await writeFile(join(root, "package.json"), '{"private":true,"type":"module"}');
    await mkdir(join(root, "node_modules", "@meekojs"), { recursive: true });
    await symlink(resolve("."), join(root, "node_modules", "@meekojs", "meeko"), "junction");
    const source = await readFile(fixture, "utf8");
    await writeFile(sourceFile, source);
    await generateTypes(source, sourceFile);
    const unionFile = join(root, "src", "Union.meeko");
    const unionSource = `<script lang="ts">type Props = ({ kind: "a"; a: number } | { kind: "b"; b: string }) & { count: number }; const props = defineProps<Props>({ count: 0 });</script><template>{props.count}</template>`;
    await writeFile(unionFile, unionSource);
    await generateTypes(unionSource, unionFile);
    const parent = `<script lang="ts">import * as Card from "./Card.meeko";</script><template><component is="Card" bind:required="'yes'"></component></template>`;
    assert.deepEqual((await checkSource(parent, join(root, "src", "Parent.meeko"))).filter((diagnostic) => diagnostic.severity !== "warning"), []);
    const wrongChild = `<script lang="ts">import * as Card from "./Card.meeko";</script><template><component is="Card" bind:required="'yes'" bind:count="'wrong'"></component></template>`;
    const wrongChildDiagnostics = await checkSource(wrongChild, join(root, "src", "WrongChild.meeko"));
    assert.ok(wrongChildDiagnostics.some((entry) => entry.code === "TS2322" && entry.location.offset >= wrongChild.indexOf("bind:count")), JSON.stringify(wrongChildDiagnostics));
    const missingChild = `<script lang="ts">import * as Card from "./Card.meeko";</script><template><component is="Card"></component></template>`;
    const missingChildDiagnostics = await checkSource(missingChild, join(root, "src", "MissingChild.meeko"));
    // The tag check of the component reports the missing prop on the tag.
    assert.ok(missingChildDiagnostics.some((entry) => entry.code === "TS2345" &&
      entry.filename === join(root, "src", "MissingChild.meeko") &&
      entry.location.offset >= missingChild.indexOf("<component") &&
      /required/.test(entry.message)), JSON.stringify(missingChildDiagnostics));
    await writeFile(join(root, "src", "consumer.ts"), `import type { ComponentProps } from "./Card.meeko";
import type { ComponentProps as UnionProps } from "./Union.meeko";
const valid: ComponentProps = { required: "yes" };
const overridden: ComponentProps = { required: "yes", count: 2, label: "Other" };
const undefinedInput: ComponentProps = { required: "yes", label: undefined };
// @ts-expect-error a default must preserve readonly props
undefinedInput.count = 3;
// @ts-expect-error required remains required
const missing: ComponentProps = {};
// @ts-expect-error count keeps its declared type
const wrong: ComponentProps = { required: "yes", count: "two" };
const variantA: UnionProps = { kind: "a", a: 1 };
const variantB: UnionProps = { kind: "b", b: "yes" };
// @ts-expect-error variant a requires its own field
const invalidVariant: UnionProps = { kind: "a", b: "yes" };
void valid; void overridden; void undefinedInput; void missing; void wrong;
void variantA; void variantB; void invalidVariant;
`);
    await writeFile(join(root, "tsconfig.json"), JSON.stringify({ compilerOptions: {
      target: "ES2022", module: "NodeNext", moduleResolution: "NodeNext", strict: true, noEmit: true,
      skipLibCheck: true, allowArbitraryExtensions: true, rootDirs: ["src", ".meeko/types/src"],
    }, include: ["src/**/*.ts", ".meeko/types/**/*.ts"] }));
    await run(process.execPath, [resolve("node_modules/typescript/bin/tsc"), "-p", join(root, "tsconfig.json")]);
  } finally { await rm(root, { recursive: true, force: true }); }
});

test("defineProps rejects invalid defaults with source diagnostics", async () => {
  const source = `<script lang="ts">\nconst props = defineProps<{ count: number }>({ count: "wrong" });\n</script><template>{props.count}</template>`;
  const diagnostics = await checkSource(source, "BadDefaults.meeko");
  assert.ok(diagnostics.some((entry) => entry.code === "TS2322" && entry.location.line === 2), JSON.stringify(diagnostics));
  const undefinedDefault = `<script lang="ts">const props = defineProps<{ label?: string }>({ label: undefined });</script><template>{props.label}</template>`;
  const undefinedDiagnostics = await checkSource(undefinedDefault, "UndefinedDefault.meeko");
  assert.ok(undefinedDiagnostics.some((entry) => entry.code === "TS2322"), JSON.stringify(undefinedDiagnostics));
  const unknownDefault = `<script lang="ts">const props = defineProps<{ count: number }>({ other: 1 });</script><template>{props.count}</template>`;
  const unknownDiagnostics = await checkSource(unknownDefault, "UnknownDefault.meeko");
  assert.ok(unknownDiagnostics.some((entry) => ["TS2322", "TS2353"].includes(entry.code) && entry.location.offset === unknownDefault.indexOf("other")), JSON.stringify(unknownDiagnostics));
  const branchDefault = `<script lang="ts">type Props = { kind: "a"; a: number } | { kind: "b"; b: string }; const props = defineProps<Props>({ a: 1 });</script><template>{props.kind}</template>`;
  const branchDiagnostics = await checkSource(branchDefault, "BranchDefault.meeko");
  assert.ok(branchDiagnostics.some((entry) => entry.code === "TS2322" && entry.location.offset === branchDefault.indexOf("a: 1")), JSON.stringify(branchDiagnostics));
  for (const [argument, code] of [
    ["getDefaults()", "MEEK040"],
    ["{ ...defaults }", "MEEK041"],
    ["{ count: 1, count: 2 }", "MEEK042"],
  ] as const) {
    const invalid = `<script lang="ts">const props = defineProps<{ count: number }>(${argument});</script><template>{props.count}</template>`;
    assert.throws(() => compile(invalid, "InvalidDefaults.meeko"), (error: unknown) =>
      error instanceof Error && "diagnostic" in error && (error.diagnostic as { code?: string }).code === code);
  }
});
