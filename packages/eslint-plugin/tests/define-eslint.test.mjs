import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {readFile} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
import test from 'node:test';
import {Linter} from 'eslint';
import {defineEslint} from '../dist/index.js';
import {generatedTypes, schemaHash} from '../scripts/generate-rule-types.mjs';
import {typeScriptRuleSchemaHash} from '../dist/typescript-rules.generated.js';

const messages = (source, filename, config = defineEslint()) => new Linter().verify(source, config, {filename});

test('defineEslint enables JS, syntax-only TS and Meeko defaults with separate scopes', () => {
  assert.ok(messages('const unused = 1;', 'app.js').some((message) => message.ruleId === 'no-unused-vars'));
  assert.ok(messages('const unused: number = 1;', 'app.ts').some((message) => message.ruleId === '@typescript-eslint/no-unused-vars'));
  assert.ok(messages('<template><button>Save</button></template>', 'App.meeko').some((message) => message.ruleId === 'meeko/button-has-type'));
  assert.ok(messages('<script lang="ts">debugger;</script><template></template>', 'App.meeko').some((message) => message.ruleId === 'no-debugger'));
  assert.deepEqual(messages('<script lang="ts">const title = "Hi";</script><template>{title}</template>', 'App.meeko'), []);
});

test('rule namespaces are applied only to languages with registered plugins', () => {
  const config = defineEslint({rules:{'meeko/button-has-type':'error','@typescript-eslint/no-explicit-any':'off','no-debugger':'off'}});
  assert.deepEqual(messages('debugger;', 'app.js', config), []);
  assert.deepEqual(messages('const value: any = 1; export {value};', 'app.ts', config), []);
  assert.equal(messages('<template><button>Save</button></template>', 'App.meeko', config)[0].severity, 2);
  assert.deepEqual(messages('<script lang="ts">debugger;</script><template></template>', 'App.meeko', config), []);
});

test('options disable independent language presets and reject invalid namespace combinations', () => {
  const meekoOnly = defineEslint({javascript:false,typescript:false,rules:{'@typescript-eslint/no-unused-vars':'error'}});
  assert.deepEqual(messages('<template><p>Hi</p></template>', 'App.meeko', meekoOnly), []);
  const jsOnly = defineEslint({typescript:false,meeko:false});
  assert.ok(messages('const unused = 1;', 'app.js', jsOnly).some((message) => message.ruleId === 'no-unused-vars'));
  assert.throws(() => defineEslint({javascript:false,typescript:false,meeko:false}), /at least one/);
  assert.throws(() => defineEslint({meeko:false,rules:{'meeko/button-has-type':'off'}}), /requires meeko/);
  assert.throws(() => defineEslint({typescript:false,meeko:false,rules:{'@typescript-eslint/no-unused-vars':'off'}}), /requires typescript or meeko/);
  assert.throws(() => defineEslint({javascript:'yes'}), /boolean/);
  assert.throws(() => defineEslint({ignores:'dist'}), /array of strings/);
  assert.throws(() => defineEslint({rules:{'meeko/unknown':'error'}}), /unknown rule/);
  assert.throws(() => defineEslint({rules:{'other/rule':'error'}}), /additional plugins in an override/);
  assert.throws(() => defineEslint({rules:{'@typescript-eslint/no-floating-promises':'error'}}), /requires type information/);
  assert.doesNotThrow(() => defineEslint({rules:{'@typescript-eslint/no-floating-promises':'off'}}));
  assert.doesNotThrow(() => defineEslint({rules:{'@typescript-eslint/no-floating-promises':[0]}}));
});

test('default and additional ignores are global, and trailing overrides win', () => {
  const config = defineEslint({ignores:['**/custom/**'],rules:{'no-debugger':'error'}}, {files:['**/*.js'],rules:{'no-debugger':'off'}});
  for (const path of ['node_modules/a.js','dist/a.js','.meeko/a.js','custom/a.js']) {
    assert.ok(messages('debugger;', path, config).every((message) => message.ruleId === null));
  }
  assert.deepEqual(messages('debugger;', 'app.js', config), []);
  assert.ok(Array.isArray(config));
  assert.equal(config.at(-1).rules['no-debugger'], 'off');
});

test('generated TypeScript rule options match the pinned public schemas', async () => {
  assert.equal(typeScriptRuleSchemaHash, schemaHash);
  assert.equal(await readFile(new URL('../src/typescript-rules.generated.ts',import.meta.url),'utf8'), generatedTypes());
});

test('consumer type checks known rule options and rejects typos and invalid tuples', () => {
  const tsc = fileURLToPath(new URL('../bin/tsc6', import.meta.resolve('typescript')));
  execFileSync(process.execPath,[tsc,'--ignoreConfig','--noEmit','--strict','--skipLibCheck','--module','nodenext','--target','es2022',fileURLToPath(new URL('./types/consumer.ts',import.meta.url))],{stdio:'pipe'});
});
