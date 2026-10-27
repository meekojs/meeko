import assert from "node:assert/strict";
import test from "node:test";
import { compile } from "../src/compiler.ts";

/** MEEK101 warnings of a component whose script is `script`, as `{ text, message }`. */
function warnings(script: string, template = "<p>{props.label}</p>"): Array<{ text: string; message: string }> {
  const source = `<script lang="ts">\n${script}\n</script>\n<template>${template}</template>`;
  return (compile(source, "Probe.meeko").warnings ?? []).map((warning) => {
    assert.equal(warning.code, "MEEK101");
    assert.equal(warning.severity, "warning");
    return { text: source.slice(warning.location.offset, warning.location.offset + 5), message: warning.message };
  });
}

const props = `const props = defineProps<{ label: string; items: string[]; onReady?: () => void }>();`;

test("reads of props that run once in the setup are warnings", () => {
  const found = warnings(`${props}
const { label } = props;
const first = props.items[0];
const copy = { ...props };
const upper = props.label.toUpperCase();`);
  assert.equal(found.length, 4);
  assert.match(found[0]!.message, /^Desestructurar props copia sus valores/);
  assert.match(found[1]!.message, /^props\.items se lee una sola vez porque el setup se ejecuta una sola vez/);
  assert.match(found[2]!.message, /^Expandir props/);
  assert.match(found[3]!.message, /props\.label se lee una sola vez.*signal\(props\.label\) o untrack\(\(\) => props\.label\)/);
  assert.ok(found.every((warning) => warning.text === "props"), "each warning points at the props identifier");
});

test("onMounted reads its props once; nested functions and effects read them again", () => {
  const found = warnings(`import { onMounted, effect } from "@meekojs/meeko";
${props}
onMounted(() => {
  const headings = props.items.map((id) => document.getElementById(id));
  effect(() => console.log(props.label));
  window.addEventListener("resize", () => props.items.length);
});`);
  assert.equal(found.length, 1);
  assert.match(found[0]!.message, /^props\.items se lee una sola vez porque onMounted se ejecuta una sola vez: .*effect/);
});

test("functions, computed, function props, signal initial values and the template stay quiet", () => {
  assert.deepEqual(warnings(`import { computed, signal, untrack } from "@meekojs/meeko";
${props}
const upper = computed(() => props.label.toUpperCase());
const draft = signal(props.label);
const key = untrack(() => props.label);
function save(): string { return props.label; }
props.onReady?.();
const view = props;
type Label = typeof props.label;`, "<p>{props.label} {props.items.length}</p>"), []);
});

test("components with a top-level data await are mounted again, so their reads stay fresh", () => {
  const source = `<script lang="ts">
const props = defineProps<{ id: string }>();
const id = props.id;
const user = await useApi("/api/users/[id]", { params: { id } });
</script>
<template><p>{user.value}</p></template>`;
  assert.equal(compile(source, "User.meeko").warnings, undefined);
});
