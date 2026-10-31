import assert from 'node:assert/strict';
import test from 'node:test';
import {Linter} from 'eslint';
import perfectionist from 'eslint-plugin-perfectionist';
import unusedImports from 'eslint-plugin-unused-imports';
import typescript from '@typescript-eslint/eslint-plugin';
import {defineEslint} from '../dist/index.js';

const config = defineEslint({perfectionist:true,unusedImports:true});
function fix(source, filename = 'App.meeko', selected = config) {
  const result = new Linter().verifyAndFix(source,selected,{filename});
  assert.deepEqual(result.messages, []);
  assert.equal(new Linter().verifyAndFix(result.output,selected,{filename}).fixed,false);
  return result.output;
}

test('optional plugins remain off by default and reject invalid option/namespace combinations', () => {
  const source = `import unused from 'unused';`;
  assert.equal(new Linter().verifyAndFix(source,defineEslint(),{filename:'app.ts'}).output,source);
  assert.throws(() => defineEslint({perfectionist:'yes'}),/boolean/);
  assert.throws(() => defineEslint({unusedImports:'yes'}),/boolean/);
  assert.throws(() => defineEslint({rules:{'perfectionist/sort-imports':'error'}}),/requires perfectionist/);
  assert.throws(() => defineEslint({rules:{'unused-imports/no-unused-vars':'error'}}),/requires unusedImports/);
  assert.throws(() => defineEslint({perfectionist:true,rules:{'perfectionist/unknown':'error'}}),/unknown rule/);
  assert.throws(() => defineEslint({unusedImports:true,rules:{'unused-imports/unknown':'error'}}),/unknown rule/);
  for(const name of ['no-unused-vars','@typescript-eslint/no-unused-vars']) {
    assert.throws(() => defineEslint({unusedImports:true,rules:{[name]:'warn'}}),/conflicts with unusedImports/);
    assert.doesNotThrow(() => defineEslint({unusedImports:true,rules:{[name]:'off'}}));
  }
});

test('unused-imports reports each unused binding once and accepts underscore locals', () => {
  const messages = new Linter().verify(`import unused from 'unused'; const missing = 1; const _intentional = 2;`,config,{filename:'app.ts'});
  assert.deepEqual(messages.map((message) => message.ruleId).sort(),['unused-imports/no-unused-imports','unused-imports/no-unused-vars']);
  assert.deepEqual(new Linter().verify(`const run = (_input) => 1; export {run};`,config,{filename:'app.js'}),[]);
  assert.equal(fix(`import unused from 'unused';`,'app.js',defineEslint({typescript:false,meeko:false,unusedImports:true})), '');
});

test('template-only, component-only, type-only and generic-constraint imports survive cleanup', () => {
  const source = `<script lang="ts" generic="T extends Entity">
import type {Entity} from './types.js';
import Card from './Card.meeko';
import {format, unused} from './format.js';
import type {User} from './user.js';
const props = defineProps<{user:User; item:T}>();
</script><template><Card>{format(props.user.name)}{props.item}</Card></template>`;
  const output = fix(source);
  assert.match(output,/import Card from/);
  assert.match(output,/import type \{Entity\}/);
  assert.match(output,/import type \{User\}/);
  assert.match(output,/import \{format\}/);
  assert.doesNotMatch(output,/unused/);
  assert.equal(output.match(/<\/script>/g).length,1);
  assert.equal(output.slice(output.indexOf('<template>')),source.slice(source.indexOf('<template>')));
});

test('removing a sole/final import never consumes script or template delimiters', () => {
  for(const source of [
    `<script lang="ts">import unused from 'unused';</script><template>{1}</template>`,
    `<script lang="ts">\r\nimport unused from 'unused';\r\n</script>\r\n<template>{1}</template>`,
    `<script lang="ts">import {used} from 'used'; import unused from 'unused';</script><template>{used}</template>`,
    `<script server lang="ts">import unused from 'unused';</script><template>{1}</template>`,
    `<script server lang="ts">import {used} from 'used'; import unused from 'unused'; export const data = used();</script><template>{data}</template>`,
  ]) {
    const output = fix(source);
    assert.doesNotMatch(output,/from 'unused'/);
    assert.match(output,/<\/script>/);
    assert.equal(output.slice(output.indexOf('<template>')),source.slice(source.indexOf('<template>')));
  }
});

test('server and component imports stay in their own sections in either source order', () => {
  const app = `<script lang="ts">import Z from 'z'; import A from 'a';</script>`;
  const server = `<script server lang="ts">import Z from 'server-z'; import A from 'server-a'; export const data = [Z,A];</script>`;
  const template = `<template>{A}{Z}{data}</template>`;
  for(const source of [app+server+template,server+app+template]) {
    const output = fix(source);
    assert.match(output,/<script lang="ts">import A from 'a'; import Z from 'z';<\/script>/);
    assert.match(output,/<script server lang="ts">import A from 'server-a'; import Z from 'server-z'; export const data = \[Z,A\];<\/script>/);
    assert.equal(output.indexOf('<script server'),source.indexOf('<script server'));
    assert.equal(output.slice(output.indexOf('<template>')),template);
  }
});

test('inline unused imports between adjacent sections preserve all tags and the next import', () => {
  const source = `<script lang="ts">import unused from 'unused';</script><script server lang="ts">import {load} from 'server'; export const data = load();</script><template>{data}</template>`;
  assert.equal(fix(source),source.replace(`import unused from 'unused';`,''));
});

test('natural ascending ordering sorts only import declarations/specifiers by default', () => {
  const source = `<script lang="ts">
import {z, a} from './item10.js';
import Item2 from './item2.js';
const value = {z,a};
const array = [10,2];
</script><template>{value}{array}<Item2 /></template>`;
  const output = fix(source);
  assert.ok(output.indexOf("from './item2.js'") < output.indexOf("from './item10.js'"));
  assert.match(output,/import \{a, z\}/);
  assert.match(output,/const value = \{z,a\}/);
  assert.match(output,/const array = \[10,2\]/);
});

test('bare side-effect imports keep their order and remain in the source', () => {
  const source = `<script lang="ts">import Z from 'z'; import 'side-z'; import 'side-a'; import A from 'a';</script><template>{Z}{A}</template>`;
  const output = fix(source);
  assert.ok(output.indexOf("import 'side-z'") < output.indexOf("import 'side-a'"));
  assert.match(output,/import A from 'a'/);
  assert.match(output,/import Z from 'z'/);
  assert.equal((output.match(/import 'side-/g)??[]).length,2);
});

test('import comments survive sorting and removing the final unused import', () => {
  const source = `<script lang="ts">
// Comment for Z
import Z from 'z';
// Comment for A
import A from 'a';
import unused from 'unused'; // keep trailing explanation
</script><template>{A}{Z}</template>`;
  const output = fix(source);
  for(const comment of ['Comment for Z','Comment for A','keep trailing explanation']) assert.ok(output.includes(comment));
  assert.match(output,/<\/script><template>/);
});

test('unused import option types track the reproducible public TS no-unused-vars schema', () => {
  for(const name of ['no-unused-imports','no-unused-vars']) assert.deepEqual(unusedImports.rules[name].meta.schema,typescript.rules['no-unused-vars'].meta.schema);
  assert.deepEqual(Object.keys(perfectionist.rules).sort(),[
    'sort-array-includes','sort-arrays','sort-classes','sort-constructor-parameters','sort-decorators','sort-enums','sort-export-attributes','sort-exports',
    'sort-heritage-clauses','sort-import-attributes','sort-imports','sort-interfaces','sort-intersection-types','sort-jsx-props','sort-maps','sort-modules',
    'sort-named-exports','sort-named-imports','sort-object-types','sort-objects','sort-sets','sort-switch-case','sort-union-types','sort-variable-declarations',
  ].sort());
});
