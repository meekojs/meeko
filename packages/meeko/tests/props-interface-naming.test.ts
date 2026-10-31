import assert from "node:assert/strict";
import { join } from "node:path";
import test from "node:test";

import { checkSource } from "../src/check.ts";
import { compile } from "../src/compiler.ts";

const filename = join(process.cwd(), "PropsNaming.meeko");
const component = (script: string): string => `<script lang="ts">\n${script}\n</script>\n<template><p>ok</p></template>`;

test("a local props interface with another name receives a nonbreaking warning", async () => {
  const source = component("interface UserProps { name: string }\nconst props = defineProps<UserProps>();");
  const warnings = compile(source, filename).warnings ?? [];
  assert.deepEqual(warnings.map(({ code, severity }) => [code, severity]), [["MEEK120", "warning"]]);
  assert.equal(source.slice(warnings[0]!.location.offset, warnings[0]!.location.offset + "UserProps".length), "UserProps");
  assert.match(warnings[0]!.message, /usa interface Props/);
  const diagnostics = await checkSource(source, filename);
  assert.deepEqual(diagnostics.map(({ code, severity }) => [code, severity]), [["MEEK120", "warning"]]);
  const exported = component("export interface UserProps { name: string }\nconst props = defineProps<UserProps>();");
  assert.deepEqual((compile(exported, filename).warnings ?? []).map(({ code }) => code), ["MEEK120"]);
});

test("Props, inline types, local aliases and imported interfaces keep their existing contracts", () => {
  const scripts = [
    "interface Props { name: string }\nconst props = defineProps<Props>();",
    "const props = defineProps<{ name: string }>();",
    "type UserProps = { name: string };\nconst props = defineProps<UserProps>();",
    'import type { UserProps } from "./types.js";\nconst props = defineProps<UserProps>();',
  ];
  for (const script of scripts) {
    assert.deepEqual((compile(component(script), filename).warnings ?? []).filter(({ code }) => code === "MEEK120"), [], script);
  }
});
