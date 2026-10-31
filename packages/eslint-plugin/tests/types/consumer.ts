import {defineEslint} from '@meekojs/eslint-plugin';
import type {DefineEslintRules, DefineEslintOptions} from '@meekojs/eslint-plugin';
import type {Linter} from 'eslint';

const rules = {
  'no-debugger': 'error',
  eqeqeq: ['error', 'always'],
  '@typescript-eslint/no-unused-vars': ['warn', {args:'all', argsIgnorePattern:'^_'}],
  '@typescript-eslint/no-explicit-any': ['error', {ignoreRestArgs:true}],
  'meeko/button-has-type': ['error'],
  'meeko/no-autofocus': 0,
} satisfies DefineEslintRules;
const options: DefineEslintOptions = {ignores:['**/build/**'],rules};
const config: Linter.Config[] = defineEslint(options,{files:['**/*.js'],rules:{'no-debugger':'off'}});
void config;
defineEslint({typescript:false,meeko:true});
defineEslint({
  perfectionist:true,
  unusedImports:true,
  rules:{
    'perfectionist/sort-imports':['error',{type:'natural',order:'asc',sortSideEffects:false}],
    'perfectionist/sort-named-imports':['error',{type:'natural',order:'asc'}],
    'unused-imports/no-unused-imports':'error',
    'unused-imports/no-unused-vars':['error',{argsIgnorePattern:'^_',varsIgnorePattern:'^_'}],
  },
});

// @ts-expect-error Unknown core rule names are rejected.
defineEslint({rules:{'no-debbuger':'error'}});
// @ts-expect-error Meeko rule does not accept options.
defineEslint({rules:{'meeko/button-has-type':['error',{allow:true}]}});
// @ts-expect-error Meeko rule severity is checked.
defineEslint({rules:{'meeko/no-autofocus':'fatal'}});
// @ts-expect-error Core rule options use official ESLint types.
defineEslint({rules:{eqeqeq:['error','sometimes']}});
// @ts-expect-error TypeScript-ESLint rule names are finite.
defineEslint({rules:{'@typescript-eslint/no-unknown-rule':'error'}});
// @ts-expect-error TypeScript-ESLint option enum is inferred from the public schema.
defineEslint({rules:{'@typescript-eslint/no-unused-vars':['error',{args:'sometimes'}]}});
// @ts-expect-error TypeScript-ESLint option keys are checked.
defineEslint({rules:{'@typescript-eslint/no-explicit-any':['error',{unexpected:true}]}});
const unknownMixed = {'no-debugger':'error','no-unknown-rule':'error'} as const;
// @ts-expect-error Unknown keys are rejected even on a predeclared variable.
defineEslint({rules:unknownMixed});
// @ts-expect-error Options are checked.
defineEslint({javascript:'yes'});
// @ts-expect-error Perfectionist rule names are finite.
defineEslint({perfectionist:true,rules:{'perfectionist/unknown-rule':'error'}});
// @ts-expect-error Perfectionist options come from the public exported option types.
defineEslint({perfectionist:true,rules:{'perfectionist/sort-imports':['error',{order:'up'}]}});
// @ts-expect-error Perfectionist option keys are checked.
defineEslint({perfectionist:true,rules:{'perfectionist/sort-named-imports':['error',{typo:true}]}});
// @ts-expect-error Unused imports rule names are finite.
defineEslint({unusedImports:true,rules:{'unused-imports/unknown-rule':'error'}});
// @ts-expect-error Unused imports options match its public schema.
defineEslint({unusedImports:true,rules:{'unused-imports/no-unused-vars':['error',{args:'sometimes'}]}});
