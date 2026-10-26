import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import test from "node:test";
import { pathToFileURL } from "node:url";
import { Window } from "happy-dom";
import { checkSource } from "../src/check.ts";
import { compile } from "../src/compiler.ts";

/** Setup bindings named like the code that the compiler generates around them. */
const source = `<script lang="ts">
import { signal } from "@meekojs/meeko";
const html = signal("<b>");
const state = signal("a");
const dispose = signal(0);
const release = signal("r");
const root = signal("root");
const event = signal("e");
const cleanups = signal(1);
const error = signal("none");
function update(): void { state.value = "b"; dispose.value++; event.value = "clicked"; }
</script>
<template><p class="out">{html.value}|{state.value}|{dispose.value}|{release.value}|{root.value}|{event.value}|{cleanups.value}|{error.value}</p><button type="button" on:click="() => update()">u</button><input on:input="() => event.value = 'input'" /></template>`;

test("setup bindings named html, state, dispose, release, root or event do not collide with generated code", async () => {
  const { code } = compile(source, "Names.meeko");
  const hot = compile(source, "Names.meeko", { hot: true }).code;
  for (const name of ["html", "state", "dispose", "cleanups", "event", "error"]) {
    // Only the script declares these names; the generated code uses __meeko_ ones.
    const generated = new RegExp(`\\(${name}\\)|\\(${name}: Event\\)|catch \\(${name}\\)|, ${name}\\);`);
    assert.doesNotMatch(code, generated, name);
    assert.doesNotMatch(hot, generated, name);
    assert.equal(code.match(new RegExp(`const ${name} =`, "g"))?.length, 1, name);
  }
  await mkdir(resolve(".meeko"), { recursive: true });
  const directory = await mkdtemp(join(resolve(".meeko"), "generated-names-"));
  const window = new Window();
  try {
    await writeFile(join(directory, "package.json"), '{"private":true,"type":"module"}\n');
    await writeFile(join(directory, "tsconfig.json"), `${JSON.stringify({ compilerOptions: { types: ["node"], paths: { "@meekojs/meeko/internal": ["../../src/internal.ts"], "@meekojs/meeko": ["../../src/index.ts"] } } })}\n`);
    const diagnostics = await checkSource(source, join(directory, "Names.meeko"));
    assert.deepEqual(diagnostics, [], JSON.stringify(diagnostics));
    const runtime = (path: string): string => JSON.stringify(pathToFileURL(resolve(path)).href);
    const compiled = code
      .replace(`from "@meekojs/meeko/internal"`, `from ${runtime("src/internal.ts")}`)
      .replace(`from "@meekojs/meeko"`, `from ${runtime("src/index.ts")}`);
    await writeFile(join(directory, "Names.ts"), compiled);
    const component = await import(pathToFileURL(join(directory, "Names.ts")).href) as {
      renderWithState(props: Record<string, never>): { html: string; state: Record<string, unknown> };
      hydrate(root: Element, props: Record<string, never>, state?: Record<string, unknown>): () => void;
    };
    const rendered = component.renderWithState({});
    assert.equal(rendered.state["state"], "a");
    const element = window.document.createElement("main");
    element.innerHTML = rendered.html;
    const text = (): string => element.querySelector(".out")?.textContent ?? "";
    assert.equal(text(), "<b>|a|0|r|root|e|1|none");
    const release = component.hydrate(element as unknown as Element, {}, rendered.state);
    (element.querySelector("button") as unknown as HTMLButtonElement).click();
    assert.equal(text(), "<b>|b|1|r|root|clicked|1|none");
    element.querySelector("input")!.dispatchEvent(new window.Event("input", { bubbles: true }));
    assert.equal(text(), "<b>|b|1|r|root|input|1|none");
    release();
  } finally {
    window.happyDOM.abort();
    await rm(directory, { recursive: true, force: true });
  }
});
