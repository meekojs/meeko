import type { DefineEslintOptions, DefineEslintRules } from '@meekojs/eslint-plugin'
import type { Linter } from 'eslint'

import { defineEslint } from '@meekojs/eslint-plugin'

const rules = {
	'no-debugger': 'error',
	eqeqeq: ['error', 'always'],
	'@typescript-eslint/no-unused-vars': ['warn', { args: 'all', argsIgnorePattern: '^_' }],
	'@typescript-eslint/no-explicit-any': ['error', { ignoreRestArgs: true }],
	'meeko/button-has-type': ['error'],
	'meeko/no-autofocus': 0,
	'meeko/attributes-order': ['warn', { order: ['ref', 'list', 'conditional', 'definition', 'attributes', 'model', 'bindings', 'spread', 'events', 'content'], alphabetical: true }],
	'meeko/order-macros': ['error', { order: ['defineProps', 'defineEmits', 'defineModel', 'defineSnippets', 'useElementRef', 'defineExpose'] }],
	'meeko/padding-line-between-macros': 'error',
	'meeko/order-sections': ['warn', { order: ['server', 'script', 'template', 'style'] }],
	'meeko/prefer-static-bindings': 'warn',
	'meeko/html-self-closing': ['warn', { html: { normal: 'always', void: 'any' }, component: 'always', svg: 'never', math: 'always', ignoreWhitespace: true }],
} satisfies DefineEslintRules
const options: DefineEslintOptions = { ignores: ['**/build/**'], rules }
const config: Linter.Config[] = defineEslint(options, { files: ['**/*.js'], rules: { 'no-debugger': 'off' } })
void config
defineEslint({ typescript: false, meeko: true })
defineEslint({
	perfectionist: true,
	unusedImports: true,
	rules: {
		'perfectionist/sort-imports': ['error', { type: 'natural', order: 'asc', sortSideEffects: false }],
		'perfectionist/sort-named-imports': ['error', { type: 'natural', order: 'asc' }],
		'unused-imports/no-unused-imports': 'error',
		'unused-imports/no-unused-vars': ['error', { argsIgnorePattern: '^_', varsIgnorePattern: '^_' }],
	},
})

// @ts-expect-error Unknown core rule names are rejected.
defineEslint({ rules: { 'no-debbuger': 'error' } })
// @ts-expect-error Meeko rule does not accept options.
defineEslint({ rules: { 'meeko/button-has-type': ['error', { allow: true }] } })
// @ts-expect-error Meeko rule severity is checked.
defineEslint({ rules: { 'meeko/no-autofocus': 'fatal' } })
// @ts-expect-error Macro names are checked.
defineEslint({ rules: { 'meeko/order-macros': ['error', { order: ['defineProp'] }] } })
// @ts-expect-error Attribute groups are checked.
defineEslint({ rules: { 'meeko/attributes-order': ['error', { order: ['unknown'] }] } })
// @ts-expect-error Attribute sorting options are checked.
defineEslint({ rules: { 'meeko/attributes-order': ['error', { alphabetical: 'yes' }] } })
// @ts-expect-error Self-closing modes are checked.
defineEslint({ rules: { 'meeko/html-self-closing': ['error', { html: { normal: 'sometimes' } }] } })
// @ts-expect-error Self-closing categories are checked.
defineEslint({ rules: { 'meeko/html-self-closing': ['error', { elements: 'always' }] } })
// @ts-expect-error Section names are checked.
defineEslint({ rules: { 'meeko/order-sections': ['error', { order: ['client'] }] } })
// @ts-expect-error Unknown style options are rejected.
defineEslint({ rules: { 'meeko/order-macros': ['error', { sort: true }] } })
// @ts-expect-error Static binding rule has no options.
defineEslint({ rules: { 'meeko/prefer-static-bindings': ['error', { unsafe: true }] } })
// @ts-expect-error Macro padding has no options.
defineEslint({ rules: { 'meeko/padding-line-between-macros': ['error', { blankLine: 'never' }] } })
// @ts-expect-error Core rule options use official ESLint types.
defineEslint({ rules: { eqeqeq: ['error', 'sometimes'] } })
// @ts-expect-error TypeScript-ESLint rule names are finite.
defineEslint({ rules: { '@typescript-eslint/no-unknown-rule': 'error' } })
// @ts-expect-error TypeScript-ESLint option enum is inferred from the public schema.
defineEslint({ rules: { '@typescript-eslint/no-unused-vars': ['error', { args: 'sometimes' }] } })
// @ts-expect-error TypeScript-ESLint option keys are checked.
defineEslint({ rules: { '@typescript-eslint/no-explicit-any': ['error', { unexpected: true }] } })
const unknownMixed = { 'no-debugger': 'error', 'no-unknown-rule': 'error' } as const
// @ts-expect-error Unknown keys are rejected even on a predeclared variable.
defineEslint({ rules: unknownMixed })
// @ts-expect-error Options are checked.
defineEslint({ javascript: 'yes' })
// @ts-expect-error Perfectionist rule names are finite.
defineEslint({ perfectionist: true, rules: { 'perfectionist/unknown-rule': 'error' } })
// @ts-expect-error Perfectionist options come from the public exported option types.
defineEslint({ perfectionist: true, rules: { 'perfectionist/sort-imports': ['error', { order: 'up' }] } })
// @ts-expect-error Perfectionist option keys are checked.
defineEslint({ perfectionist: true, rules: { 'perfectionist/sort-named-imports': ['error', { typo: true }] } })
// @ts-expect-error Unused imports rule names are finite.
defineEslint({ unusedImports: true, rules: { 'unused-imports/unknown-rule': 'error' } })
// @ts-expect-error Unused imports options match its public schema.
defineEslint({ unusedImports: true, rules: { 'unused-imports/no-unused-vars': ['error', { args: 'sometimes' }] } })

// Perfectionist is enabled without an explicit option and accepts severity-only overrides.
defineEslint({ rules: { 'perfectionist/sort-imports': 'error', 'perfectionist/sort-named-imports': ['warn', { type: 'natural', order: 'asc' }] } })
defineEslint({ perfectionist: false })
// @ts-expect-error Perfectionist activation must be boolean.
defineEslint({ perfectionist: 'yes' })
// @ts-expect-error Natural sorting options are checked without explicit activation.
defineEslint({ rules: { 'perfectionist/sort-named-imports': ['warn', { type: 'numeric' }] } })
