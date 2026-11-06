---
source-hash: c1406d76530d3d3c2537696d1b444388cf08c7834cfe7b597c07b31a1a802991
---

# ESLint

`@meekojs/eslint-plugin` analyzes complete `.meeko` components with ESLint 10 and Flat Config. It reuses Meeko's public parser for the sections and the template, and TypeScript-ESLint for scripts and expressions. It does not execute the configuration or generate project files.

## Installation and configuration

`meeko/rules-of-composables` defaults to `error` in every enabled language. It recognizes any `useX()` name (uppercase letter, digit or `_` after `use`), including custom composables. Calls belong at the root of a `.meeko` script or in another composable's main body, before suspension or early return and outside callbacks, conditions and loops. Import aliases and static member calls are recognized; dynamic aliases and the caller's runtime context are not verified. Use [`createId()`](reference/utils/create-id.md) for identifiers created inside ordinary functions or handlers. This rule can be configured even with `meeko: false`.

```sh
pnpm add -D eslint jiti @meekojs/eslint-plugin
```

```ts
// eslint.config.ts
import { defineEslint } from '@meekojs/eslint-plugin'

export default defineEslint({
	ignores: ['**/coverage/**'],
	rules: {
		'meeko/button-has-type': 'error',
		'@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_' }],
	},
})
```

In Node, ESLint loads `eslint.config.ts` with `jiti` 2.2 or later installed in the consumer. The helper returns a standard Flat Config array: it does not generate files, does not load `meeko.config.ts` and does not need a composer. `meeko init` does not create this configuration: the file is yours.

## defineEslint options

The three language options are enabled by default:

| Option          | Effect                                                                                                                                                                             |
| --------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `javascript`    | Enables ESLint's recommended preset for `.js`, `.mjs` and `.cjs`.                                                                                                                  |
| `typescript`    | Enables TypeScript-ESLint's recommended preset, without types, for `.ts`, `.tsx`, `.mts` and `.cts`.                                                                               |
| `meeko`         | Enables the parser and the plugin's recommended rules for `.meeko`. It is independent of `typescript`.                                                                             |
| `perfectionist` | Without the option, sorts only imports. `true` sorts almost everything except classes and modules. `false` sorts nothing. See [Sort with Perfectionist](#sort-with-perfectionist). |
| `unusedImports` | Optional, `false` by default. Removes unused imports and centralizes the unused-variable warning.                                                                                  |
| `ignores`       | Adds global exclusion patterns.                                                                                                                                                    |
| `rules`         | Customizes known core, TypeScript-ESLint and Meeko rules with typed options.                                                                                                       |

The recommended JavaScript base also applies to the scripts of the enabled languages: for example, it detects `debugger` inside `.meeko`. The exceptions of each language are applied afterwards. Node or browser globals are configured explicitly in the overrides; the helper does not assume the application's runtime.

`**/node_modules/**`, `**/dist/**`, `**/.meeko/**`, `**/*.d.meeko.ts` and `**/*.generated.ts` are excluded by default. `ignores` adds patterns to that list. `*.meeko` components are not ignored.

Custom rules apply by scope: core rules to the enabled languages, `@typescript-eslint/*` rules to TS and/or Meeko, and `meeko/*` rules to components, except `meeko/rules-of-composables`, which applies to every enabled language. The `perfectionist/*` namespace is accepted except with `perfectionist: false`, and `unused-imports/*` requires `unusedImports: true`; both apply to the enabled languages. Selecting a rule from a disabled namespace is an error; disabling every language is also an error. `typescript: false` lets you bring your own TypeScript preset while keeping Meeko.

Rule names and options are typed: an unknown rule, an invalid level or `['error', { allow: true }]` on a Meeko rule without options fail when checking `eslint.config.ts`. Core types come from ESLint's public API. TypeScript-ESLint types are a reproducible snapshot of the public `meta.schema` of the pinned version, generated with `pnpm types:generate`. They represent the shape, keys and enums of the schema; numeric limits, regular expressions and semantic combinations are validated by ESLint at run time. Perfectionist publishes precise option types from its public entry point and the helper reuses them directly. The unused-imports options reuse the `no-unused-vars` snapshot; the tests check that both public schemas remain identical. The generator is not part of the code the consumer loads.

The arguments after the options are normal Flat Config overrides and win at the end:

```ts
export default defineEslint({ rules: { 'meeko/button-has-type': 'error' } }, { files: ['tests/**/*.ts'], rules: { '@typescript-eslint/no-explicit-any': 'off' } })
```

Configure additional plugins and their rules inside those overrides, where the complete Flat Config API is preserved. The helper refuses to enable TypeScript-ESLint rules that need type information, such as `no-floating-promises`, from `options.rules`; it does allow turning them off with `off` or `0`. TS overrides can configure their own typed analysis and rules. The `.meeko` parser remains syntactic and rejects `project`, `projectService` and `programs`.

## Sort with Perfectionist

Perfectionist comes as a dependency of the helper. All its rules emit `warn`, with `type: 'natural'` and `order: 'asc'`: natural order places `item2` before `item10`.

| `perfectionist`    | What it sorts                                                                                                     |
| ------------------ | ----------------------------------------------------------------------------------------------------------------- |
| Without the option | Only imports: `sort-imports` and `sort-named-imports`.                                                            |
| `true`             | Also the rest of the `recommended-natural` set Perfectionist publishes, except `sort-classes` and `sort-modules`. |
| `false`            | Nothing: the plugin is not registered, and declaring a `perfectionist/*` rule in `rules` is an error.             |

Without the option, `eslint --fix` only moves imports. In import declarations `sortSideEffects: false` is set and experimental dependency detection is disabled. tsconfig resolution is not enabled. Side-effect imports without bindings keep their order; imports with bindings can change position according to the chosen order.

`perfectionist: true` does not copy Perfectionist's list, so a new rule arrives with its version: exports, objects, interfaces, types, unions and intersections, enums, `switch`, `Set`, `Map`, `includes`, variables, decorators, `implements` clauses and import attributes. They apply to `.js`, `.ts` and the `<script>` of a `.meeko`, including the expressions of its template. In a `<script server>`, `sort-exports` and `sort-named-exports` do not report, because the parser turns that block into a function scope and its exports are not part of the tree; the others do. `sort-jsx-props` only has an effect in `.tsx`, because a Meeko template is not JSX. Perfectionist does not sort template attributes: that is [`meeko/attributes-order`](../../packages/eslint-plugin/docs/rules/attributes-order.md).

`sort-arrays` and `sort-constructor-parameters` are not part of the set, because Perfectionist requires `useConfigurationIf` on them to say what they apply to; if you enable them with that option, `settings.perfectionist` gives them the same order.

To customize an order, use the public options of the rules: as in Flat Config, replacing a rule replaces its options, it does not deep-merge them. To turn off one rule, set it to `off` in `rules` or in an override; to exempt a single case in a script, use a `// eslint-disable-next-line perfectionist/sort-objects` comment, which a template does not support. `sort-imports` and `sort-named-imports` will become `error` in 2.0; to require them earlier, override only the severity, which keeps the natural options:

```ts
export default defineEslint({
	perfectionist: true,
	rules: {
		'perfectionist/sort-objects': 'off',
		'perfectionist/sort-imports': 'error',
		'perfectionist/sort-named-imports': 'error',
	},
})
```

`eslint --fix` corrects these warnings; a run with `--max-warnings 0` also fails if warnings remain. The Meeko monorepo does not declare the option, so it only sorts imports, and it requires its two rules as `error`: the complete set gave 21766 warnings there, and each rule needs its own review before a fix.

### sort-classes and sort-modules

`perfectionist: true` does not enable them, because their `--fix` breaks valid code without the rule being able to detect it:

| Rule           | Before the fix                                                                                                           | After the fix                                                                                                                             |
| -------------- | ------------------------------------------------------------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------- |
| `sort-classes` | `class K { z = 1; a = this.calc(); calc() { return this.z + 1 } }` gives `a === 2`: the dependency goes through a method | Gives `NaN`; fields with effects also change order                                                                                        |
| `sort-modules` | `class Z {}`, `function getZ() { return Z }`, `class A { static v = getZ() }` works                                      | Throws `ReferenceError`, because `A` is evaluated before `Z`; registration decorators and `static` members with effects also change order |

If you want them, enable them in `rules` or in an override. They inherit the natural order from `settings.perfectionist`, also without the option:

```ts
export default defineEslint({
	perfectionist: true,
	rules: {
		'perfectionist/sort-classes': 'warn',
		'perfectionist/sort-modules': 'warn',
	},
})
```

`sort-modules` does not report in a `<script server>` either, for the same reason as `sort-exports`. Review the diff of its fix like that of the others.

### Review the --fix diff

With `perfectionist: true` the other rules are not excluded, because it is an explicit option, but sorting is only safe when the order is not observed, and these rules cannot know when it is. They respect direct dependencies (`a = this.z + 1`), `case` clauses that fall through to the next one, `switch (true)`, enums with implicit values and the boundaries of a spread, but these cases change behavior when fixed:

| Rule                                                                    | Before the fix                                                                                                                          | After the fix                                                                              |
| ----------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------ |
| `sort-objects`                                                          | `Object.keys({ z: 1, a: 2 })` gives `z, a`, and an `each:of` renders in that order                                                      | Gives `a, z`, and `JSON.stringify` changes too                                             |
| `sort-objects`                                                          | `{ z: next(), a: next() }` evaluates `z` first                                                                                          | Evaluates `a` first; the same goes for computed keys and default values when destructuring |
| `sort-objects`                                                          | `{ [key]: 'calculada', a: 'literal' }`, with `key === 'a'`, keeps `'literal'`                                                           | Keeps `'calculada'`                                                                        |
| `sort-maps`, `sort-sets`                                                | Iteration follows the written order: a table `new Map([['/z/x', 1], ['/a', 2], ['/z', 3]])` that looks for the first match finds `/z/x` | Finds `/z`                                                                                 |
| `sort-exports`                                                          | `export { z } from './z'` evaluates `./z` before `./a`                                                                                  | Evaluates `./a` first                                                                      |
| `sort-decorators`                                                       | `@z @a class K {}` applies `a` and then `z`                                                                                             | Applies `z` and then `a`                                                                   |
| `sort-variable-declarations`, `sort-array-includes`, `sort-switch-case` | `let z = next(), a = next()` evaluates `z` first; likewise the elements of an array and `case` clauses with calls                       | Evaluates `a` first                                                                        |

Only types change, with no effect at run time, for `sort-interfaces`, `sort-object-types`, `sort-union-types`, `sort-intersection-types` and `sort-heritage-clauses`. If an order matters, exempt it with the comment or turn the rule off.

#### Validation schemas

`sort-objects` also sorts the keys of a schema, and that order is observable. Valibot walks the keys in the schema's order, so `issues` and the keys of the API's JSON come out in alphabetical order instead of the form's: a `v.object` written as `name, email, message, consent` becomes `consent, email, message, name`. An error summary that walks `errors` would appear in that order.

[`useForm`](reference/composables/useform.md) documents no order for `errors`, so do not rely on one: if the summary must follow the form, walk the fields in that order yourself. `focusInvalid` is not affected, because it looks for the first control with an error in document order.

To keep the schema's order, `// eslint-disable-next-line perfectionist/sort-objects` works if the object takes a single line. On several lines it is not enough: the warning is reported on each key, so above `v.object({` it has no effect, and above each key `--fix` deletes the unused comments and leaves another order. Wrap it in a block:

```ts
/* eslint-disable perfectionist/sort-objects */
export const contactInput = v.object({
	name,
	email,
	message,
	consent,
})
/* eslint-enable perfectionist/sort-objects */
```

### What changes in a component's HTML

In a `.meeko`, those rules reach the `<script>`, the `<script server>` and the template expressions, and the fix shows in the rendered HTML. This component:

```html
<script lang="ts">
const labels = { z: 'Zeta', a: 'Alfa' }
const attrs = { title: 'x', id: 'y' }
const box = { 'padding-left': '4px', padding: '0' }
const boxStyle = Object.entries(box)
	.map(([name, value]) => `${name}:${value}`)
	.join(';')
</script>

<template>
	<ul>
		<li
			each:of="Object.values(labels)"
			each:as="label"
			each:key="label"
		>
			{label}
		</li>
	</ul>
	<div bind="attrs" />
	<p bind:style="boxStyle" />
</template>
```

changes like this after `eslint --fix`, with no error:

| Source                                                        | HTML before the fix                  | HTML after the fix                   |
| ------------------------------------------------------------- | ------------------------------------ | ------------------------------------ |
| `Object.values(labels)`, likewise `new Set(['zeta', 'alfa'])` | `Zeta`, `Alfa`                       | `Alfa`, `Zeta`                       |
| `bind="attrs"`                                                | `<div title="x" id="y">`             | `<div id="y" title="x">`             |
| `Object.entries(box)`                                         | `style="padding-left:4px;padding:0"` | `style="padding:0;padding-left:4px"` |

In the last case the fix also changes what is seen: before, `padding` overrode `padding-left`, and afterwards `padding-left` wins. The same goes for an object written inside the template, such as `each:of="Object.keys({ z: 1, a: 2 })"`, and for the data of a `<script server>`: `export const data = { z: 1, a: 2 }` becomes `{ a: 2, z: 1 }`, and an `Object.keys(data)` in the template walks them in the new order. If an object defines a presentation order, use an array, which `sort-objects` does not touch, or exempt that object with the comment.

## Clean unused imports

The plugin comes as a dependency of the helper and is enabled with its option:

```ts
import { defineEslint } from '@meekojs/eslint-plugin'

export default defineEslint({
	unusedImports: true,
	rules: {
		'unused-imports/no-unused-vars': [
			'error',
			{
				vars: 'all',
				varsIgnorePattern: '^_',
				args: 'after-used',
				argsIgnorePattern: '^_',
			},
		],
	},
})
```

`unusedImports: true` enables `unused-imports/no-unused-imports: 'error'` and `unused-imports/no-unused-vars: 'error'`. The second allows variables and arguments prefixed with `_`. The original `no-unused-vars` and `@typescript-eslint/no-unused-vars` warnings are disabled to avoid duplicates. Re-enabling them in `options.rules` is an explicit error that tells you to use `unused-imports/no-unused-vars`; the final overrides keep the normal control of Flat Config.

`eslint --fix` can then sort imports and remove the ones really unused in the selected files. Those used only in the template, component tags, types or generic constraints are kept. The `<script>` and `<script server>` blocks have their own token boundaries: sorting and removing imports does not cross those boundaries or consume `</script>` or `<template>`. The tests cover sole/final imports, adjacent blocks in both orders, comments, CRLF and the idempotence of both fixes together. Cleaning variables that are not imports remains an error report, with no removal autofix by default.

## Component order and type imports

The component style rules are optional and have typed options in `defineEslint`:

```ts
export default defineEslint({
	unusedImports: true,
	rules: {
		'meeko/order-macros': [
			'error',
			{
				order: ['defineProps', 'defineEmits', 'defineModel', 'defineSnippets', 'useElementRef', 'defineExpose'],
			},
		],
		'meeko/padding-line-between-macros': 'error',
		'meeko/order-sections': [
			'error',
			{
				order: ['server', 'script', 'template', 'style'],
			},
		],
		'meeko/prefer-static-bindings': 'warn',
		'meeko/attributes-order': ['warn', { alphabetical: false }],
		'@typescript-eslint/consistent-type-imports': [
			'error',
			{
				prefer: 'type-imports',
				fixStyle: 'separate-type-imports',
			},
		],
	},
})
```

Those orders are the defaults: you can also just use `'error'`. These `meeko/*` rules only apply to `.meeko`; type imports are checked both in TypeScript and in component scripts.

`padding-line-between-macros` requires at least one blank line after each macro when there is another declaration or statement below: macros, variables, functions or types. It also handles multiline macros or macros of the same kind. Its autofix preserves comments, indentation and LF/CRLF; it works together with macro ordering. It adds no separation at the end of the script if there is no more code. It takes no options. See the [macro padding rule](../../packages/eslint-plugin/docs/rules/padding-line-between-macros.md).

`order-macros` detects the order of component macros. Its autofix is limited to safe consecutive blocks: dependencies, calls with possible side effects and comments prevent declarations from being moved automatically. `defineExpose` is reviewed manually to preserve the declarations it needs. `order-sections` checks the position of the SFC sections. `prefer-static-bindings` simplifies literal bindings only when it can preserve their semantics, for example `bind:title="'Guardar'"` to `title="Guardar"`. Dynamic cases remain bindings.

In `.meeko`, the `consistent-type-imports` integration keeps independent state per script. Two imports of the same module in server and client are not merged across sections, even when fixing mixed value and type imports.

These rules are not part of `recommended`; they are enabled explicitly in the repository's configuration. To fix a selected file:

```sh
pnpm exec eslint app/components/Example.meeko --fix
```

## Using the plugin directly

The optional [`meeko/attributes-order`](../../packages/eslint-plugin/docs/rules/attributes-order.md) rule sorts by groups: `ref:`, `each:*`, conditionals, definition, plain attributes, models, `bind:`, spread, events and content. It accepts `order` and `alphabetical`; its autofix only changes the order of expressions without effects and avoids collisions; if one can have effects, it offers a suggestion. It is not enabled by default in `defineEslint` or `recommended`.

The optional [`meeko/html-self-closing`](../../packages/eslint-plugin/docs/rules/html-self-closing.md) rule closes elements and components with no child node with `/>` (`<div></div>` becomes `<div />`), with `'always'`, `'never'` or `'any'` options for `html.normal`, `html.void`, `component`, `svg` and `math`, and `ignoreWhitespace` to treat content made only of line breaks and indentation as empty. It is not enabled in `recommended` in `1.x`, so as not to generate diffs in existing projects.

The default export and the existing configurations remain available:

```js
import meeko from '@meekojs/eslint-plugin'

export default [...meeko.configs.recommended]
```

The plugin's `recommended` configuration only applies to `**/*.meeko`: it registers the parser, the built-in macros and tags, and enables `@typescript-eslint/no-unused-vars` and the two template rules. It disables the core `no-unused-vars` and `no-undef`, as befits TypeScript code and its auto-imports. Arguments and variables prefixed with `_` are allowed as deliberately ignored.

`configs.base` registers only the parser, plugin and globals. You can combine `recommended` with your usual JS/TS configuration. Remove any global `**/*.meeko` exclusion from the existing configuration: globally ignored files do not reach the parser.

```sh
pnpm exec eslint 'app/**/*.meeko'
```

The package includes its own TypeScript 6 compiler API for TypeScript-ESLint. The application can keep using TypeScript 7 with `meeko check`.

## What it understands

- The `<script lang="ts">` and `<script server lang="ts">` blocks, including imports and data exported from the server.
- References from interpolations, `bind`, `on:*`, `model` and `html` directives, conditions, list keys and dynamic components.
- Imported components used as tags, including replacements of built-in tags.
- Scopes of `each:as`, `each:index`, snippet parameters and callbacks: a list variable does not mark another script variable with the same name as used.
- Snippet conditions evaluated outside their parameters.
- Generic names of the component and references to their constraints.
- UTF-16 positions over the original file, including CRLF, Unicode characters and HTML entities in attributes.

The imports and locals of the server block stay in their scope. A reference exclusive to the server does not make a variable of the component script count as used. Declarations exported by the server count as published; their data can be read in the template.

## Own rules

| Rule                                                                                                | Recommended level | Fix                                         |
| --------------------------------------------------------------------------------------------------- | ----------------- | ------------------------------------------- |
| [`meeko/button-has-type`](../../packages/eslint-plugin/docs/rules/button-has-type.md)               | warning           | Suggestions to choose `button` or `submit`. |
| [`meeko/html-self-closing`](../../packages/eslint-plugin/docs/rules/html-self-closing.md)           | optional          | Autofix from `<div></div>` to `<div />`.    |
| [`meeko/no-autofocus`](../../packages/eslint-plugin/docs/rules/no-autofocus.md)                     | warning           | Suggestion to remove the attribute.         |
| [`meeko/order-macros`](../../packages/eslint-plugin/docs/rules/order-macros.md)                     | optional          | Conservative autofix of consecutive macros. |
| [`meeko/order-sections`](../../packages/eslint-plugin/docs/rules/order-sections.md)                 | optional          | Order of the component's sections.          |
| [`meeko/prefer-static-bindings`](../../packages/eslint-plugin/docs/rules/prefer-static-bindings.md) | optional          | Simplifies equivalent literal bindings.     |
| [`meeko/prefer-ui-components`](../../packages/eslint-plugin/docs/rules/prefer-ui-components.md)     | optional          | No fix: it names the UI component.          |

The suggestions of `button-has-type` and `no-autofocus` require an explicit choice: they do not change the behavior of a form or the focus through `eslint --fix`.

## Parser and services

```js
import parser from '@meekojs/eslint-plugin/parser'

export default [
	{
		files: ['**/*.meeko'],
		languageOptions: { parser },
	},
]
```

The parser returns a TypeScript-ESLint AST with `MeekoScope` nodes for template scopes. These nodes are traversed through `visitorKeys.children`; their expressions keep TypeScript nodes and references. The tokens correspond exclusively to text of the original file, including `MeekoScriptBoundary` tokens for the opening/closing tags of each script. These boundaries let rules that use `getTokenAfter` or `getTokensBetween` tell the SFC blocks apart. `context.sourceCode.parserServices` offers `isMeeko: true` and `templateBody`, the template AST of the public `@meekojs/meeko/parse` API. It also keeps TypeScript-ESLint's syntactic services, without a type program; this allows using `consistent-type-imports` without enabling typed analysis.

The synthetic infrastructure is only used to build scopes. It is not executed or presented as code written by the user. The tests check fixes of existing rules both in scripts and in attribute expressions, and their idempotence.

## Limits of this first base

- It is syntactic analysis. `parserOptions.project`, `projectService` and `programs` are explicitly rejected; use `meeko check` for types, props, models, routes and compiler errors.
- It does not replace Prettier or implement an HTML/CSS formatting AST. Formatting rules designed for a complete JavaScript file can assume delimiters that a template does not have; use Meeko's Prettier plugin for formatting.
- It does not promise compatibility with any third-party rule that assumes a JavaScript-only AST. The own rules, `no-unused-vars`, `prefer-const`, `no-unneeded-ternary`, `consistent-type-imports`, the Perfectionist rules that `perfectionist: true` enables, `sort-classes`, `sort-modules` and the two unused-imports rules have specific tests. `sort-arrays` and `sort-constructor-parameters` have typed options and can be configured explicitly, but they are not part of the defaults or of this validation matrix.
- Default exports and re-exports of the server block are rejected with an explicit parsing error. Exports of named declarations and lists of local names are covered.
- The accessibility checks are partial: `no-autofocus` covers static HTML attributes and skips components and custom elements. It is not equivalent to a complete accessibility audit.
- Before publishing, the minimum version of the Meeko peer must be the first published version that includes `@meekojs/meeko/parse`. This delivery is validated with the current workspace.

## Development

Build the Meeko core first. Then:

```sh
pnpm -F @meekojs/eslint-plugin run check
pnpm -F @meekojs/eslint-plugin run test
```

The tests use real ESLint and RuleTester: template references, list/snippet/server scopes, locations, suggestions, explicit limits, consumer type checks and safe fixes of existing rules and optional plugins.
