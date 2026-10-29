import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { applyAutoImports, discoverAutoImports } from "../src/autoimports.ts";
import { checkSource } from "../src/check.ts";
import { compile } from "../src/compiler.ts";
import { PageInputError } from "../src/framework/page.ts";
import { computed, createRoot, signal } from "../src/reactivity.ts";

// Gaps that the authors of the 1.7 reference found while documenting each symbol.

test("useNavigation and createRoot are autoimported like their siblings; a project export still wins", async () => {
  const root = await mkdtemp(join(tmpdir(), "meeko-gaps-"));
  try {
    await writeFile(join(root, "package.json"), '{"private":true,"type":"module"}');
    const page = join(root, "app", "pages", "index.meeko");
    const registry = await discoverAutoImports(root);
    const code = applyAutoImports("const navigation = useNavigation();\nconst dispose = createRoot((d) => d);", page, registry, "client");
    assert.match(code, /import \{ useNavigation as useNavigation \} from "@meekojs\/meeko\/framework"/);
    assert.match(code, /import \{ createRoot as createRoot \} from "@meekojs\/meeko"/);
    // An app composable that already exported the name keeps it, instead of an ambiguous autoimport.
    await mkdir(join(root, "app", "composables"), { recursive: true });
    await writeFile(join(root, "app", "composables", "navigation.ts"), "export function useNavigation() { return { busy: false }; }\n");
    const own = applyAutoImports("const navigation = useNavigation();", page, await discoverAutoImports(root), "client");
    assert.match(own, /from "\.\.\/composables\/navigation\.js"/);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("defer is autoimported in server code, also inside the route options, and never in the browser", async () => {
  const root = await mkdtemp(join(tmpdir(), "meeko-gaps-"));
  try {
    await writeFile(join(root, "package.json"), '{"private":true,"type":"module"}');
    const registry = await discoverAutoImports(root);
    const page = join(root, "app", "pages", "index.meeko");
    const block = applyAutoImports("export const route = definePage({ load: async () => ({ c: defer(Promise.resolve(1)) }) });", page, registry, "server");
    assert.match(block, /import \{ defer as defer \} from "@meekojs\/meeko\/framework"/);
    const sidecar = applyAutoImports("export const route = definePage({ render: \"stream\", load: () => ({ c: defer(() => 1) }) });", join(root, "app", "pages", "a.route.ts"), registry, "server");
    assert.match(sidecar, /import \{ defer as defer \}/);
    assert.throws(() => applyAutoImports("const x = defer(1);", page, registry, "client"), /defer/);
    // redirect and notFound stay out of plain server modules (MEEK073 at run time in an API).
    assert.doesNotMatch(applyAutoImports("redirect(\"/\");", join(root, "app", "middleware", "auth.server.ts"), registry, "server"), /import/);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("an expression of a prop as the initial value of a signal is not MEEK101", () => {
  const source = (line: string) => `<script lang="ts">
import { signal } from "@meekojs/meeko";
const props = defineProps<{ count?: number; items: string[] }>();
${line}
</script>
<template><p>{props.count}</p></template>`;
  for (const line of ["const count = signal(props.count ?? 0);", "const size = signal(props.items.length + 1);", "const copy = signal([...props.items]);"]) {
    assert.deepEqual(compile(source(line), "Probe.meeko").warnings ?? [], [], line);
  }
  // Only the first argument is an initial value; a read beside the call is still a copy.
  const outside = compile(source("const count = signal(0) && props.count;"), "Probe.meeko").warnings ?? [];
  assert.deepEqual(outside.map((warning) => warning.code), ["MEEK101"]);
});

test("PageInputError names itself like ClientError and ApiError", () => {
  const error = new PageInputError("INVALID_PARAMS");
  assert.equal(error.name, "PageInputError");
  assert.equal(error.message, "INVALID_PARAMS");
  assert.match(String(error), /^PageInputError: INVALID_PARAMS$/);
});

test("writing a computed throws instead of keeping the value until the next recomputation", () => {
  createRoot((dispose) => {
    const count = signal(1);
    const doubled = computed(() => count.value * 2);
    assert.throws(() => { (doubled as { value: number }).value = 10; }, /Meeko computed values are read-only/);
    assert.equal(doubled.value, 2);
    count.value = 2;
    assert.equal(doubled.value, 4);
    dispose();
  });
});

test("an each:* or if:* attribute that no directive reads is the MEEK119 warning", () => {
  const source = '<script lang="ts">const items = [{ id: 1 }];</script><template><ul><li each:of="items" each:as="item" each:by="item.id">{item.id}</li></ul><p if:when="items.length" if:else="x">a</p></template>';
  const result = compile(source, "Probe.meeko");
  const warnings = (result.warnings ?? []).map((warning) => [warning.code, warning.severity, source.slice(warning.location.offset, warning.location.offset + 7)]);
  assert.deepEqual(warnings, [["MEEK119", "warning", "each:by"], ["MEEK119", "warning", "if:else"]]);
  assert.match(result.warnings![0]!.message, /each:by no es una directiva de each:of/);
  // The known directives stay quiet.
  assert.deepEqual(compile('<script lang="ts">const items = [1];</script><template><li each:of="items" each:as="item" each:key="item" each:index="i">{item}</li></template>', "Probe.meeko").warnings ?? [], []);
});

test("a prop assignment and an event handler in htmlAttrs or bodyAttrs are type errors", async () => {
  const filename = join(process.cwd(), "examples", "counter", "GapsCheck.meeko");
  const assigned = await checkSource('<script lang="ts">const props = defineProps<{ label: string }>();\nfunction rename() { props.label = "x"; }\n</script><template><button on:click="rename">{props.label}</button></template>', filename);
  assert.deepEqual(assigned.map((diagnostic) => diagnostic.code), ["TS2540"], JSON.stringify(assigned));
  // Reading, passing and spreading the props still compiles.
  const valid = await checkSource('<script lang="ts">const props = defineProps<{ label: string; items: string[] }>();\nfunction take(value: { label: string }): string { return value.label; }\nconst size = () => props.items.length + take(props).length;\n</script><template><p>{size()}</p></template>', filename);
  assert.deepEqual(valid, []);
  const head = await checkSource('<script lang="ts">\nimport { useHead } from "@meekojs/meeko/framework";\nconst attrs: Record<string, string> = { lang: "es" };\nuseHead({ htmlAttrs: attrs, bodyAttrs: { onload: "init()" } });\nuseHead({ htmlAttrs: { onclick: "x()", "data-x": "1" } });\n</script><template><p>x</p></template>', filename);
  assert.deepEqual(head.map((diagnostic) => diagnostic.code), ["TS2322", "TS2322"], JSON.stringify(head));
});
