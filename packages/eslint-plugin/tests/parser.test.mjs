import assert from "node:assert/strict";
import test from "node:test";
import { Linter } from "eslint";
import plugin from "../dist/index.js";
import parser from "../dist/parser.js";

const lint = (source, rules = {}) => new Linter().verify(source, [...plugin.configs.recommended, { files: ["**/*.meeko"], rules }], { filename: "App.meeko" });
const unused = (source) => lint(source).filter((message) => message.ruleId === "@typescript-eslint/no-unused-vars");

test("script variables, imported components and type-only imports are read by the template", () => {
  const messages = lint(`<script lang="ts">
import Card from './Card.meeko';
import type { User } from './types.js';
const props = defineProps<{ user: User }>();
const unused = 1;
</script><template><Card bind:user="props.user">{props.user.name}</Card></template>`);
  assert.equal(messages.length, 1);
  assert.match(messages[0].message, /'unused'/);
  assert.equal(messages[0].line, 5);
});

test("each locals shadow outer variables and do not leak to siblings", () => {
  const source = `<script lang="ts">const rows = [{name:'A'}]; const row = 'unused';</script>
<template><p each:of="rows" each:as="row" each:index="i" each:key="row.name">{i}: {row.name}</p><p>{row}</p></template>`;
  assert.deepEqual(lint(source), []);
  const messages = unused(source.replace('<p>{row}</p>', ''));
  assert.equal(messages.length, 1);
  assert.match(messages[0].message, /'row'/);
});

test("snippet parameters and callback parameters have nested scopes", () => {
  const messages = lint(`<script lang="ts">const item = 1; const total = 3; const click = (event: MouseEvent) => console.log(event.type);</script>
<template><MeekoSelect bind:options="[1]"><snippet name="option" params="item, state">{item + total} {state.selected}</snippet></MeekoSelect><button type="button" on:click="click"></button></template>`);
  assert.equal(messages.length, 1);
  assert.match(messages[0].message, /'item'/);
});

test("server locals and component locals remain isolated; exported data reaches the template", () => {
  const source = `<script server lang="ts">const serverOnly = 1; export const data = await Promise.resolve('ok');</script>
<script lang="ts">const appOnly = 1;</script><template>{data}</template>`;
  const messages = unused(source);
  assert.equal(messages.length, 2);
  assert.ok(messages.some((message) => message.message.includes("serverOnly")));
  assert.ok(messages.some((message) => message.message.includes("appOnly")));
  const parsed = parser.parseForESLint(source.replace('const serverOnly = 1;', 'console.log(appOnly);'));
  assert.ok(parsed.scopeManager.globalScope.through.some((reference) => reference.identifier.name === 'appOnly'));
  assert.equal(unused(source.replace('const serverOnly = 1;', 'console.log(appOnly);')).length, 1);
});

test("server imports use their own scope and preserve disable comments", () => {
  assert.deepEqual(lint(`<script server lang="ts">import {load} from './data.js';
// eslint-disable-next-line @typescript-eslint/no-unused-vars
const ignored = 1;
export const data = await load();</script>
<script lang="ts">const load = 'unused';</script><template>{data}</template>`).map((message) => message.messageId), ['unusedVar']);
});

test("directives, models, render arguments and custom Meeko-prefixed components count as references", () => {
  assert.deepEqual(lint(`<script lang="ts">
import MeekoCard from './Card.meeko';
const show = true; const value = signal(''); const snippets = defineSnippets<{default: [string]}>();
</script><template><MeekoCard if:when="show"><input model="value"><render snippet="snippets.default" args="value.value" /></MeekoCard></template>`), []);
});

test("generic constraints read imports and generic names resolve in the script", () => {
  assert.deepEqual(lint(`<script lang="ts" generic="T extends Entity">import type {Entity} from './types.js'; const props = defineProps<{item:T}>();</script><template>{props.item}</template>`), []);
});

test("comments and CRLF/unicode locations remain in the original file", () => {
  const source = '<script lang="ts">\r\n// ejemplo ñ\r\nconst visible = "ok";\r\nconst unused = 1;\r\n</script>\r\n<template>{visible}</template>';
  const [message] = unused(source);
  assert.equal(message.line, 4);
  assert.equal(message.column, 7);
  assert.equal(source.split('\r\n')[message.line - 1].slice(message.column - 1, message.endColumn - 1), 'unused');
});

test("HTML entities in directive expressions retain source ranges", () => {
  assert.deepEqual(lint(`<script lang="ts">const a = true; const b = true;</script><template><p if:when="a &amp;&amp; b">ok</p></template>`), []);
});

test("spread bindings and overridden built-ins count as reads; custom element html/model are literals", () => {
  const messages = unused(`<script lang="ts">import MeekoSelect from './Select.meeko'; const attrs = {}; const literal = 1;</script><template><MeekoSelect bind="attrs" /><x-editor html="literal" model="literal"></x-editor></template>`);
  assert.equal(messages.length, 1);
  assert.match(messages[0].message, /literal/);
});

test("conditional snippets evaluate their condition outside the parameter scope", () => {
  assert.deepEqual(lint(`<script lang="ts">const state = true;</script><template><MeekoSelect><snippet name="option" if:when="state" params="state">{state}</snippet></MeekoSelect></template>`), []);
});

test("unused template locals report the actual attribute location", () => {
  const source = '<template><p each:of="[1]" each:as="item" each:index="index">{item}</p></template>';
  const [message] = unused(source);
  assert.equal(source.slice(message.column - 1, message.endColumn - 1), 'index');
});

test("existing safe script fixes address source text and are idempotent", () => {
  const source = '<script lang="ts">let title = "Hi";</script><template>{title}</template>';
  const config = [...plugin.configs.recommended, { files: ['**/*.meeko'], rules: {'prefer-const': 'error'} }];
  const result = new Linter().verifyAndFix(source, config, {filename: 'App.meeko'});
  assert.equal(result.output, source.replace('let title', 'const title'));
  assert.deepEqual(result.messages, []);
  assert.equal(new Linter().verifyAndFix(result.output, config, {filename: 'App.meeko'}).fixed, false);
});

test("existing expression fixes affect only their original directive range", () => {
  const source = '<script lang="ts">const show = true;</script><template><p if:when="show ? true : false">ok</p></template>';
  const config = [...plugin.configs.recommended, {files:['**/*.meeko'], rules:{'no-unneeded-ternary':'error'}}];
  const result = new Linter().verifyAndFix(source, config, {filename:'App.meeko'});
  assert.equal(result.output, source.replace('show ? true : false', '!!show'));
  assert.deepEqual(result.messages, []);
});

test("typed lint is rejected explicitly; malformed SFC reports original location", () => {
  assert.throws(() => parser.parseForESLint('<template />', { projectService: true }), /syntax-only/);
  const [message] = lint('<template><Card></Wrong></template>');
  assert.equal(message.fatal, true);
  assert.equal(message.line, 1);
});
