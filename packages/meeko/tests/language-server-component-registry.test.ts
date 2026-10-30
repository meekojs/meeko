import assert from "node:assert/strict";
import { mkdir, rename, writeFile } from "node:fs/promises";
import { join } from "node:path";
import test from "node:test";
import { generateAppTypes } from "../src/framework/check-app.ts";
import { generateComponentRegistryTypes } from "../src/framework/type-declarations.ts";
import { MeekoProject } from "../src/language-server/project.ts";
import { linkRepositoryPackages, tempProject } from "./helpers/temp-project.ts";

test("editor program completes registry names and refreshes diagnostics after a rename", { timeout: 120_000 }, async (context) => {
  const root = await tempProject(context, "lsp-component-registry");
  await linkRepositoryPackages(root);
  await writeFile(join(root, "package.json"), '{"private":true,"type":"module"}\n');
  await mkdir(join(root, "app", "components"), { recursive: true });
  await mkdir(join(root, "app", "pages"), { recursive: true });
  const oldFile = join(root, "app", "components", "Button.meeko");
  const nextFile = join(root, "app", "components", "Card.meeko");
  const page = join(root, "app", "pages", "index.meeko");
  const component = "<template><button>Go</button></template>\n";
  const source = `<script lang="ts">
import type { ComponentName } from "@meekojs/meeko";
const selected: ComponentName = "";
</script>
<template><p>Ready</p></template>
`;
  await writeFile(oldFile, component);
  await writeFile(page, source);
  await generateAppTypes(root);
  const declaration = await generateComponentRegistryTypes(root);
  const project = new MeekoProject(root, { trusted: true });
  context.after(() => project.dispose());
  await project.ready();

  const completions = (): string[] => {
    const virtual = project.setDocument(page, source);
    assert.ok(virtual);
    const at = virtual.code.indexOf('selected: ComponentName = ""');
    assert.ok(at >= 0);
    const cursor = at + 'selected: ComponentName = "'.length;
    return project.service.getCompletionsAtPosition(virtual.virtualFilename, cursor, {})?.entries.map((entry) => entry.name) ?? [];
  };
  assert.ok(completions().includes("Button"));
  await rename(oldFile, nextFile);
  await generateAppTypes(root);
  await generateComponentRegistryTypes(root);
  project.filesChanged([oldFile, nextFile, declaration]);
  await project.ready();
  const names = completions();
  assert.ok(names.includes("Card"));
  assert.ok(!names.includes("Button"));
  const invalid = source.replace('ComponentName = ""', 'ComponentName = "Button"');
  const virtual = project.setDocument(page, invalid);
  assert.ok(virtual);
  assert.ok(project.service.getSemanticDiagnostics(virtual.virtualFilename).some((diagnostic) => diagnostic.code === 2322));
});
