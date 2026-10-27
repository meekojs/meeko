import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import test from "node:test";
import { pathToFileURL } from "node:url";
import { Window } from "happy-dom";
import { checkSource } from "../src/check.ts";
import { compile } from "../src/compiler.ts";

// Three nested lists whose innermost bindings read the items of every list around them. Each
// list's hydration callback used to name its item `__meeko_item`, so the inner callback shadowed
// the outer one and `group` read the option (and `option` the label).
const source = `<script lang="ts">
import { signal } from "@meekojs/meeko";
interface Group { key: number; name: string; options: { itemId: string }[] }
const groups = signal<Group[]>([{ key: 1, name: "Bebida", options: [{ itemId: "soda" }, { itemId: "juice" }] }]);
const labels = signal([{ value: "L" }]);
function rename(): void {
  groups.value = groups.value.map((group) => ({ ...group, name: "Postre", options: group.options.map((option) => ({ itemId: option.itemId.toUpperCase() })) }));
}
</script>
<template>
  <div each:of="groups.value" each:as="group" each:key="group.key">
    <p each:of="group.options" each:as="option" each:index="position">
      <span each:of="labels.value" each:as="label" each:key="label.value">{label.value}:{option.itemId}:{group.name}:{position}</span>
    </p>
    <b>{group.name}</b>
  </div>
  <button on:click="rename">rename</button>
</template>`;

test("nested lists type each item with its own list", async () => {
  const directory = await mkdtemp(join(tmpdir(), "meeko-nested-"));
  try {
    const diagnostics = await checkSource(source, join(directory, "Nested.meeko"));
    assert.deepEqual(diagnostics.filter((diagnostic) => diagnostic.code.startsWith("TS2339")), []);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("nested lists keep reading the outer items after hydration", async () => {
  const directory = await mkdtemp(join(tmpdir(), "meeko-nested-"));
  const runtime = (path: string): string => JSON.stringify(pathToFileURL(resolve(path)).href);
  const window = new Window();
  try {
    const code = compile(source, join(directory, "Nested.meeko")).code
      .replace(`from "@meekojs/meeko/internal"`, `from ${runtime("src/internal.ts")}`)
      .replace(`from "@meekojs/meeko"`, `from ${runtime("src/index.ts")}`);
    await writeFile(join(directory, "Nested.ts"), code);
    const component = await import(pathToFileURL(join(directory, "Nested.ts")).href) as {
      renderToString(props: Record<string, never>): string;
      hydrate(root: Element, props: Record<string, never>): () => void;
    };
    const root = window.document.createElement("main");
    root.innerHTML = component.renderToString({});
    const spans = (): string[] => [...root.querySelectorAll("span")].map((span) => span.textContent ?? "");
    assert.deepEqual(spans(), ["L:soda:Bebida:0", "L:juice:Bebida:1"]);
    const release = component.hydrate(root as unknown as Element, {});
    (root.querySelector("button") as unknown as HTMLButtonElement).click();
    assert.deepEqual(spans(), ["L:SODA:Postre:0", "L:JUICE:Postre:1"]);
    assert.equal(root.querySelector("b")?.textContent, "Postre");
    release();
  } finally {
    await window.happyDOM.close();
    await rm(directory, { recursive: true, force: true });
  }
});
