import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { generateModuleTypes } from "../src/framework/module-types.ts";

test("module types reconcile generated files and preserve unowned declarations", async () => {
  const root = await mkdtemp(join(tmpdir(), "meeko-module-types-"));
  try {
    const templates = new Map([["example/messages.d.ts", "export interface Messages {}"]]);
    const [index, declaration] = await generateModuleTypes(root, templates);
    assert.match(await readFile(index!, "utf8"), /reference path/);
    assert.match(await readFile(declaration!, "utf8"), /Messages/);
    const manual = join(root, ".meeko/types/modules/example/manual.d.ts");
    await writeFile(manual, "export interface Manual {}");
    await generateModuleTypes(root, new Map());
    await assert.rejects(readFile(declaration!), { code: "ENOENT" });
    assert.match(await readFile(manual, "utf8"), /Manual/);
    await assert.rejects(generateModuleTypes(root, new Map([["example/manual.d.ts", "export {}"]])), /not owned/);
    await assert.rejects(generateModuleTypes(root, new Map([["../escape.d.ts", "export {}"]])), /Invalid/);
  } finally { await rm(root, { recursive: true, force: true }); }
});

test("module types refuse a directory symlink outside the project", async () => {
  const root = await mkdtemp(join(tmpdir(), "meeko-module-link-"));
  const outside = await mkdtemp(join(tmpdir(), "meeko-module-outside-"));
  try {
    await mkdir(join(root, ".meeko", "types"), { recursive: true });
    await symlink(outside, join(root, ".meeko", "types", "modules"), "junction");
    await assert.rejects(generateModuleTypes(root, new Map([["example/messages.d.ts", "export {}"]])), /escape/);
  } finally { await rm(root, { recursive: true, force: true }); await rm(outside, { recursive: true, force: true }); }
});
