import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import test from "node:test";
import { pathToFileURL } from "node:url";
import { Window } from "happy-dom";
import { compile } from "../src/compiler.ts";

// A region updates before the bindings inside it: `if:when="v.value"` guarding `v.value!.n` must
// hide its content before that content reads the null that hid it. The region hydrates its content
// before creating its own effect, so the scheduler used to run the content first.
const runtime = (path: string): string => JSON.stringify(pathToFileURL(resolve(path)).href);

async function load(directory: string, name: string, source: string): Promise<{ renderToString(props: object): string; hydrate(root: Element, props: object): () => void }> {
  const code = compile(source, join(directory, `${name}.meeko`)).code
    .replace(`from "@meekojs/meeko/internal"`, `from ${runtime("src/internal.ts")}`)
    .replace(`from "@meekojs/meeko"`, `from ${runtime("src/index.ts")}`)
    .replace(`from "./Child.meeko"`, `from "./Child.ts"`);
  await writeFile(join(directory, `${name}.ts`), code);
  return import(pathToFileURL(join(directory, `${name}.ts`)).href);
}

const cases = [
  ["text", `<p if:when="v.value">{v.value!.n}</p>`],
  ["attribute", `<p if:when="v.value" bind:title="String(v.value!.n)">x</p>`],
  ["component prop", `<Child if:when="v.value" bind:n="v.value!.n" />`],
  ["list row", `<ul><li each:of="v.value ? [1, 2] : []" each:as="row">{row}:{v.value!.n}</li></ul>`],
  ["nested condition", `<div if:when="v.value"><p if:when="v.value!.n > 0">{v.value!.n}</p></div>`],
] as const;

for (const [label, template] of cases) {
  test(`a region hides before its ${label} reads the value that hid it`, async () => {
    const directory = await mkdtemp(join(tmpdir(), "meeko-order-"));
    const window = new Window();
    const logged: unknown[] = [];
    const original = console.error;
    console.error = (...args: unknown[]) => { logged.push(args); };
    try {
      await load(directory, "Child", `<script lang="ts">const props = defineProps<{ n: number }>();</script><template><b>{props.n}</b></template>`);
      const component = await load(directory, "Parent", `<script lang="ts">
import { signal } from "@meekojs/meeko";
import * as Child from "./Child.meeko";
const v = signal<{ n: number } | null>({ n: 1 });
</script><template>${template}<button on:click="() => v.value = v.value ? null : { n: 2 }">x</button></template>`);
      const root = window.document.createElement("main");
      root.innerHTML = component.renderToString({});
      const release = component.hydrate(root as unknown as Element, {});
      const button = root.querySelector("button") as unknown as HTMLButtonElement;
      button.click();
      assert.equal(root.querySelector("p, b, li"), null);
      button.click();
      assert.match(root.innerHTML, /2/);
      release();
      assert.deepEqual(logged, []);
    } finally {
      console.error = original;
      await window.happyDOM.close();
      await rm(directory, { recursive: true, force: true });
    }
  });
}
