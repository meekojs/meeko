import assert from "node:assert/strict";
import test from "node:test";
import type { CompletionItem } from "vscode-languageserver/node";
import { completion } from "../src/language-server/features.ts";
import { languageProject } from "./language-server-workspace.ts";

/** The tsconfig of `languageProject` with the types of Node, as a project with a server has them. */
const tsconfig = {
  compilerOptions: {
    strict: true, module: "esnext", moduleResolution: "bundler", target: "es2023", types: ["node"], noEmit: true, allowArbitraryExtensions: true,
    paths: {
      "@meekojs/meeko/framework": ["../../src/framework.ts"],
      "@meekojs/meeko/server": ["../../src/framework-server.ts"],
      "@meekojs/meeko/internal": ["../../src/internal.ts"],
      "@meekojs/meeko": ["../../src/index.ts"],
    },
  },
  include: ["**/*.ts"],
};

const page = `<script server lang="ts">
const file = ;
</script>
<script lang="ts">
const value = ;
</script>
<template><p>{value}</p></template>
`;

test("a component's <script> offers neither Node-only names nor the module the compiler makes of it; <script server> keeps Node", { timeout: 60_000 }, async () => {
  const workspace = await languageProject("lsp-browser-scope-", { "tsconfig.json": `${JSON.stringify(tsconfig)}\n`, "app/pages/index.meeko": page });
  try {
    const opened = await workspace.open("app/pages/index.meeko");
    const labels = (items: CompletionItem[] | undefined): Map<string, number> => {
      const counts = new Map<string, number>();
      for (const item of items ?? []) counts.set(item.label, (counts.get(item.label) ?? 0) + 1);
      return counts;
    };
    const browser = labels(completion(opened, opened.at("const value = ", 14)));
    // Globals of @types/node and auto-imports of Node's modules (`userInfo` of os and node:os) do
    // not exist in the browser, where the script and the template also run.
    for (const name of ["__dirname", "__filename", "require", "process", "Buffer", "global", "setImmediate", "userInfo", "readFileSync"]) {
      assert.ok(!browser.has(name), `${name} in the browser script`);
    }
    // The compiled component's own exports are its API for the parent and the runtime.
    for (const name of ["renderToString", "renderWithState", "hydrate", "hydrateScope", "css"]) {
      assert.ok(!browser.has(name), `${name} in the browser script`);
    }
    // What both declare (the DOM library and Node) stays, and so do the script's macros.
    for (const name of ["setTimeout", "fetch", "console", "document", "URL", "defineProps"]) {
      assert.ok(browser.has(name), `${name} missing from the browser script`);
    }
    // `<script server>` runs in Node: its globals and modules stay.
    const server = labels(completion(opened, opened.at("const file = ", 13)));
    for (const name of ["process", "Buffer", "__dirname", "userInfo"]) assert.ok(server.has(name), `${name} missing from <script server>`);
  } finally {
    await workspace.dispose();
  }
});
