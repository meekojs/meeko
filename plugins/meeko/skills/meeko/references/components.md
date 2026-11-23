# Meeko components (`.meeko` SFC)

Reference for writing `.meeko` single-file components: structure, macros, template syntax and the
mistakes agents coming from Vue, Svelte or React make. Targets `@meekojs/meeko` 1.9.

## File structure

```html
<script lang="ts">
	import { signal, computed } from '@meekojs/meeko'

	interface Props {
		label: string
		initial?: number
	}
	const props = defineProps<Props>({ initial: 0 })
	const count = signal(props.initial)
	const double = computed(() => count.value * 2)
	function increment(): void {
		count.value++
	}
</script>

<template>
	<button
		type="button"
		on:click="increment"
	>
		{props.label}: {count.value} ({double.value})
	</button>
</template>

<style scoped>
	button {
		font-weight: 600;
	}
</style>
```

| Block                        | Rules                                                                                                                                                                            |
| ---------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `<template>`                 | Required (`MEEK007`). Multiple root nodes are fine.                                                                                                                              |
| `<script lang="ts">`         | Optional. `lang="ts"` is mandatory (`MEEK006`). At most one. Top level = setup, runs **once per instance** (SSR, then again on hydration).                                       |
| `<script server lang="ts">`  | Only in framework pages (`app/pages`), never in components or layouts (`MEEK044`). Server-only code; its `export const` values reach the script/template as read-only JSON data. |
| `<style>` / `<style scoped>` | At most **one** style block (`MEEK004`). `scoped` limits rules to the component; `:global(sel)` escapes the scope (only inside `scoped`). Plain `<style>` is global.             |

Allowed top-level statements in `<script>`: `import`, `export type`/`export interface`, `type`, `interface`,
`const`/`let` with **one declarator per statement** (`MEEK014`; destructuring OK), named `function`
declarations, expression statements (`onMounted(...)`, `effect(...)`, assignments), control flow
(`if`, `for`, `try`, `switch`…) and `await` on supported composables. Forbidden (`MEEK018`): value exports
(`export const`, `export function`, `export default`), `class`, `enum`, `namespace`. Move classes/enums to
a `.ts` module.

Runtime APIs (`signal`, `computed`, `effect`, `onMounted`, `onCleanup`, `untrack`, `batch`,
`provideErrorHandler`, `trustHtml`) come from `@meekojs/meeko` (auto-imported inside a Meeko framework
app). **Macros are never imported**: `defineProps`, `defineEmits`, `defineModel`, `defineSnippets`,
`defineExpose`, `useElementRef`.

## Using other components

A tag starting with an uppercase letter is a component (`<Table>`, `<Input>` are components, not HTML).

```html
<script lang="ts">
	import * as UserCard from './UserCard.meeko' // namespace import; there is no default export
</script>
<template>
	<UserCard
		bind:user="user.value"
		on:select="open"
	/>
</template>
```

- In a framework app, files under `app/components` are auto-imported with their folder as prefix:
  `app/components/App/Card.meeko` → `<AppCard>`, `Button/Index.meeko` → `<Button>`. Each also gets global
  types `AppCardProps`, `AppCardEmits`, `AppCardSnippets`, `AppCardModels`, `AppCardExposed`.
- A compiled `.meeko` module exports the types `ComponentProps`, `ComponentEmits`, `ComponentModels`,
  `ComponentSnippets`, `ComponentExposed` and the functions `renderToString`, `renderWithState`, `hydrate`.
- Dynamic: `<component is="cond ? A : B">`, or HTML tags `is="props.href ? 'a' : 'button'"`, or
  PascalCase literals `is="to ? 'MeekoLink' : 'a'"`.

## Props: `defineProps`

```ts
interface Props {
	title: string
	size?: 'sm' | 'md'
	tags?: string[]
}
const props = defineProps<Props>({ size: 'md', tags: [] }) // defaults: object literal, no withDefaults
// or destructured (reactive, since 1.8):
const { title, size = 'md', class: className, ...rest } = defineProps<Props>()
```

- Name the local interface `Props` (warning `MEEK120` otherwise). Type argument required (`MEEK017`). Once,
  in its own `const` (`MEEK016`).
- Defaults: object literal with named keys only (`MEEK041`); values may use literals, imports and top-level
  constants built from literals/imports — not signals, calls or `let` (`MEEK123`). Put defaults in the
  destructuring **or** the argument, never both (`MEEK124`). No nested destructuring (`MEEK015`).
- `props` is a **read-only reactive view**. Assigning throws (`TS2540`/`MEEK125`). To change parent state,
  emit an event or use a model.
- Setup runs once: `const upper = props.title.toUpperCase()` freezes the initial value (warning `MEEK101`).
  Read `props.x` in the template, `computed(() => …)`, `effect` or a function. `signal(props.initial)` is the
  intentional "initial value only" form.
- Passing props from the parent: `bind:prop="expr"` (typed expression), `prop="text"` (static string
  literal), `prop` alone (`true`). `aria-*`/`data-*` pass props of that name. Optional props accept
  `undefined` (= not passed).

## Events: `defineEmits` + `on:`

```html
<!-- TodoItem.meeko -->
<script lang="ts">
	const props = defineProps<{ id: number }>()
	const emit = defineEmits<{ save: [id: number]; close: [] }>()
</script>
<template>
	<button on:click="() => emit('save', props.id)">Save</button>
	<button on:click="() => emit('close')">Close</button>
</template>

<!-- parent -->
<TodoItem
	bind:id="todo.id"
	on:save="(id) => save(id)"
	on:close="() => (open.value = false)"
/>
```

- Each event `save` is just the optional callback prop `onSave`; `emit` calls it synchronously, no-op if
  absent. Don't also declare `onSave` in `defineProps` (type error); `on:save` + `bind:onSave` on one tag is `MEEK048`.
- Type argument only, no runtime array (`MEEK046`/`MEEK047`); own `const`, simple name (`MEEK045`).
- Component event names are identifiers: `on:saveDraft`, never `on:save-draft` (`MEEK011`).

## Two-way models: `defineModel` + `model`

```html
<!-- AppInput.meeko -->
<script lang="ts">
	const value = defineModel<string>() // default model, required
	const open = defineModel<boolean>('open', { default: false }) // named, optional
</script>
<template>
	<input model="value" />
	<button on:click="() => (open.value = !open.value)">Options</button>
</template>

<!-- parent: pass the SIGNAL, not .value -->
<AppInput
	model="name"
	model:open="settingsOpen"
/>
<!-- or prop + event (since 1.8) -->
<AppInput
	bind:modelValue="name.value"
	on:update:modelValue="(next) => (name.value = next)"
/>
```

- Valid forms: `defineModel<T>()`, `defineModel<T>({ default })`, `defineModel<T>('name')`,
  `defineModel<T>('name', { default })`. Name must be a string literal; options only `default` (`MEEK064`).
- Without `default` the model is required (`TS2741` in the parent). The parent's expression must be a
  **writable** signal (not `computed`, not `.value`).
- `model:x` together with `bind:x` or `on:update:x` is `MEEK066`. Don't declare `modelValue` in
  `defineProps` (`MEEK063`).

## Content: `defineSnippets`, `<snippet>`, `<render>`

There is no `<slot>` (it would be a literal HTML element) and no `children` prop.

```html
<!-- AppDialog.meeko -->
<script lang="ts">
	const snippets = defineSnippets<{ default: []; title?: []; actions?: [close: () => void] }>()
	function close(): void {}
</script>
<template>
	<h2 if:when="snippets.title"><render snippet="snippets.title" /></h2>
	<render snippet="snippets.default" />
	<footer if:when="snippets.actions">
		<render
			snippet="snippets.actions"
			args="close"
		/>
	</footer>
</template>

<!-- parent -->
<AppDialog>
	<p>Loose content fills `default`.</p>
	<snippet name="title">Confirm</snippet>
	<snippet
		name="actions"
		params="close"
	>
		<button on:click="close">Close</button>
	</snippet>
</AppDialog>
```

- Each key is a snippet, value = parameter tuple, `?` = optional. Passing content to a component without
  `defineSnippets` is a type error.
- `<snippet>` must be a direct child of a component tag (`MEEK061`); attributes only `name`, `params`,
  `if:when` (`if:when` only on optional snippets: `MEEK110`). Don't mix loose content with
  `<snippet name="default">`.
- `<render snippet="expr" args="a, b" />` has no content (no fallback inside; use `if:when="!snippets.x"`)
  and only `snippet`/`args` (`MEEK062`). Rendering an absent optional snippet renders nothing.
- Snippet content runs in the **parent's** scope; child data reaches it only via `args` → `params`.
- Hyphenated names allowed (`name="cell-email"`), read in the child as `snippets['cell-email']`.
- No `ref:` inside snippet/component content (`MEEK052`).

## Exposing and refs: `defineExpose`, `ref:`, `useElementRef`

```html
<script lang="ts">
	const input = useElementRef('input') // ReadonlySignal<HTMLInputElement | null>
	const box = useElementRef('box') // ReadonlySignal<SearchBox exposed | null>
	onMounted(() => input.value?.focus())
	defineExpose({ focus: () => input.value?.focus() })
</script>
<template>
	<input ref:input />
	<SearchBox ref:box />
</template>
```

- `ref:name` has **no value** (`ref:x="y"` is `MEEK052`; `ref="x"` is a plain HTML attribute). Name is an
  identifier, unique per template (`MEEK053`). Not on `<template>`.
- `useElementRef('name')`: string literal matching a `ref:` (`MEEK056`), top level only, unconditional
  (`MEEK054`), simple name, no destructuring (`MEEK015`). `null` in SSR and until mounted; inside `each:of`
  it is a `readonly Element[]`.
- `await useElementRef('x')` returns the mounted element; everything after it runs **only in the browser**
  and the template cannot read names declared after it (`MEEK057`); macros must come before it (`MEEK058`).
- `defineExpose({...})`: one bare top-level statement, not assigned (`MEEK050`), with an argument (`MEEK051`).
  Without it the ref value is `null`.

## Generic components

```html
<script
	lang="ts"
	generic="T extends { id: string }"
>
	const props = defineProps<{ rows: T[] }>()
	const emit = defineEmits<{ select: [row: T] }>()
</script>
```

`T` is inferred by the parent from props. A local `interface`/`type` cannot reference `T` (`MEEK100`):
inline it in the macro (`defineProps<{ rows: T[] }>()`) or make the alias generic (`type Rows<U> = U[]`).
No `const`/`in`/`out` modifiers. Pages, layouts and `<script server>` cannot be generic.

## Template syntax

### Interpolation `{expr}`

```html
<p>{user.value?.name ?? 'guest'} has {count.value} items</p>
```

Escaped text, only in element content (never in attributes). Expressions only, no statements. `null` /
`undefined` print literally as `null`/`undefined` — use `?? ''`. A signal without `.value` prints
`[object Object]`. Literal braces: `{'{'}`.

### Conditionals: `if:when`

```html
<p if:when="loading.value">Loading…</p>
<p if:when="!loading.value && user.value">Hi {user.value.name}</p>
<template if:when="ready.value"><h2>A</h2><p>B</p></template>
```

- Narrows TypeScript types inside the element (no `!` needed), but not inside arrow functions in the
  template: move such handlers to a script function.
- False → region is destroyed (state, listeners, children disposed). To keep state, use `bind:hidden="!open.value"`.
- **1.9.0 has no else**: write the negated condition. `if:else` is `MEEK024`. Releases after 1.9.0 add
  `if="…"` (with `if:when` as alias), `else-if="…"` and valueless `else` on consecutive siblings
  (`MEEK138` for orphans); use them only if the installed version supports them.
- Never on the same element as `each:of` (`MEEK021`): filter with `computed` or nest via `<template each:of>`.

### Lists: `each:of`, `each:as`, `each:key`, `each:index`

```html
<li
	each:of="todos.value"
	each:as="todo"
	each:key="todo.id"
	each:index="i"
>
	{i + 1}. {todo.title}
</li>
```

- `each:of` takes an iterable (array, `Set`, `Map` → `[k, v]`): pass `todos.value`, not the signal.
- `each:as` required; `each:index` defaults to `index`; both distinct identifiers (`MEEK022`).
- `each:key` optional (index by default) but use it when rows reorder/insert and hold state; must be a
  unique `string | number`, never the object or `Math.random()`. Misspelled `each:*` is warning `MEEK119`.
- Signals notice reassignment only: `todos.value = [...todos.value, item]`, not `todos.value.push(item)`.

### Attributes and props: `bind:name`, `bind="obj"`

```html
<button
	class="btn"
	bind:class="active.value ? 'btn--on' : undefined"
	bind:disabled="saving.value"
	bind:aria-expanded="open.value ? 'true' : 'false'"
	bind:style="{ '--gap': 8, backgroundColor: color.value }"
	bind="extraAttrs.value"
/>
```

- Plain attribute = literal text (`title="{x}"` writes `{x}`). Computed values always need `bind:`.
- `null`, `undefined`, `false` remove the attribute; HTML booleans (`disabled`, `hidden`, `open`…) are
  present/absent by truthiness. `aria-*` are not booleans: pass `'true'`/`'false'` strings.
- `bind:class` takes a **string** (objects/arrays print `[object Object]`); static `class` + `bind:class` on
  an element are merged. `bind:style` accepts a string or an object. On a component, `class` and
  `bind:class` together are `MEEK090` (same for any prop given static and bound).
- `bind="obj"` spreads keys as attributes/props (typed with `ElementAttributes<'tag'>`); no `on*` keys
  (`MEEK113`). Explicit attributes win.
- `bind:onclick` is `MEEK012`; `bind:html` / `bind:ref` are literal attribute/prop names, not directives.

### Events: `on:event`

```html
<button on:click="increment">+1</button>
<button on:click="() => add(5)">+5</button>
<input on:input="(event) => (query.value = event.currentTarget.value)" />
<form on:submit="save">…</form>
```

- The value is an expression **returning a function** (name or arrow). `on:click="increment()"` calls it at
  render (`TS2345`).
- **No modifiers**: `on:submit.prevent`, `.stop`, `.once` → `MEEK011`. Call `event.preventDefault()` /
  `event.stopPropagation()` in the handler.
- `event` and `event.currentTarget` are typed per element (`KeyboardEvent` on `on:keydown`,
  `HTMLInputElement` on `<input>`). Use `currentTarget`, not `target`, to read values.
- Listeners exist only in the browser and are removed automatically. Async handler rejections go to
  `provideErrorHandler`. For `window`/`document`, add in `onMounted` and remove with `onCleanup`.

### Form controls: `model`

```html
<input model="name" />
<input type="checkbox" model="accepted" />
<input type="radio" value="pro" model="plan" />
<select multiple model="tags"><option value="a">A</option></select>
<textarea model="notes"></textarea>
```

- Pass the writable **signal** (`model="name"`), never `name.value` or a `computed`.
- Signal types: text inputs/`textarea`/`select` → `string`; checkbox → `boolean`; radio →
  `string | null | undefined` (needs `value`); `select multiple` → `string[]`. `type="number"` still gives
  `string` (`type="range"` gives a number if the signal holds one).
- Only on `<input>`, `<textarea>`, `<select>` (`MEEK065`); not with `value`/`bind:value`/`on:input` on text
  controls (or `on:change` on checkbox/select); `<textarea model>` must be empty. Use `on:change` or an
  `effect` to react.
- On a hyphenated custom element (`<my-input model="q">`), `model` and `html` are literal attributes.

### Raw HTML: `html`

```html
<script lang="ts">
	import { trustHtml } from '@meekojs/meeko'
	const body = signal(trustHtml('<p>Hi</p>'))
</script>
<template><article html="body.value"></article></template>
```

Unescaped. Value should be `TrustedHtml` (via `trustHtml`, which does **not** sanitize — sanitize user
HTML first) or warning `MEEK107`. Element must be empty, not void/text elements (`MEEK095`). Inserted HTML
has no directives; delegate events from the container with `event.target.closest(...)`.

### Self-closing and unquoted values

Non-void elements may self-close (`<div class="spacer" />`, `<AppButton />`); following nodes are siblings.
`<template>`, `<script>`, `<style>` still need closing tags. Directive values may be unquoted when HTML
allows (`on:click=increment`).

## Common mistakes

| Habit from…                            | Wrong                                                  | Meeko                                                                    |
| -------------------------------------- | ------------------------------------------------------ | ------------------------------------------------------------------------ |
| Vue `v-if` / Svelte `{#if}`            | `<p v-if="x">`, `{#if x}`                              | `<p if:when="x">` (`v-if` silently becomes an attribute)                 |
| Vue `v-else`                           | `<p v-else>`, `<p if:else>`                            | `<p if:when="!x">` (1.9.0)                                               |
| Vue `v-for` / Svelte `{#each}`         | `v-for="t in todos"`                                   | `each:of="todos.value" each:as="t" each:key="t.id"`                      |
| Vue `:attr` / React `{}` in attributes | `:title="x"` (`MEEK012`), `title="{x}"`                | `bind:title="x"`                                                         |
| Vue `@click` / React `onClick={}`      | `@click="f"`, `onclick="f()"`                          | `on:click="f"` (`@click`/`onclick` stay literal attributes)              |
| Vue modifiers                          | `on:submit.prevent="f"`                                | `on:submit="f"` + `event.preventDefault()`                               |
| Calling the handler                    | `on:click="save()"`                                    | `on:click="save"` or `on:click="() => save(id)"`                         |
| Vue class object / Svelte `class:`     | `bind:class="{ on: x }"`, `class:on={x}`               | `bind:class="x ? 'on' : undefined"`                                      |
| `v-model="name"` with `.value`         | `model="name.value"`                                   | `model="name"` (the signal)                                              |
| Forgetting `.value`                    | `{count}`, `bind:disabled="saving"`, `each:of="todos"` | `{count.value}`, `bind:disabled="saving.value"`, `each:of="todos.value"` |
| Mutating arrays                        | `todos.value.push(x)`                                  | `todos.value = [...todos.value, x]`                                      |
| Vue `ref="x"` / React `useRef`         | `<input ref="el">`, `ref:el="x"`                       | `<input ref:el>` + `const el = useElementRef('el')`                      |
| `<slot>` / `children`                  | `<slot name="title" />`                                | `defineSnippets` + `<render snippet="snippets.title" />`                 |
| `v-html` / `dangerouslySetInnerHTML`   | `html="userString"`                                    | `html="trustHtml(sanitize(s))"` or `{s}` for text                        |
| Copying props in setup                 | `const t = props.title.trim()`                         | `computed(() => props.title.trim())`                                     |
| Mutating props                         | `props.open = false`                                   | `emit('close')` or `defineModel`                                         |
| Importing macros                       | `import { defineProps } from …`                        | Use macros without import                                                |
| Default import of a component          | `import Card from './Card.meeko'`                      | `import * as Card from './Card.meeko'` (or auto-import)                  |
| `withDefaults` / runtime props options | `withDefaults(defineProps<P>(), {...})`                | `defineProps<P>({ ... })`                                                |
| Multiple declarators                   | `const a = 1, b = 2`                                   | one `const` per statement (`MEEK014`)                                    |
| Exporting values from `<script>`       | `export const x = 1`                                   | only types; page data goes in `<script server>` (`MEEK018`)              |
| `if` + `each` on one tag               | `<li each:of="xs" each:as="x" if:when="x.on">`         | filter with `computed`, or nest under `<template each:of>`               |
| Kebab-case component events            | `on:save-draft`                                        | `on:saveDraft` (`MEEK011`)                                               |
| Browser-only values in render          | `{Date.now()}`, `window.innerWidth` in template        | compute on server / set signal in `onMounted` (hydration mismatch)       |
| `<script>` without `lang`              | `<script>`                                             | `<script lang="ts">` (`MEEK006`)                                         |
| Two style blocks                       | `<style scoped>` + `<style>`                           | one `<style scoped>` using `:global(...)` (`MEEK004`)                    |
| `useElementRef` in a callback          | `onMounted(() => useElementRef('x'))`                  | top-level `const x = useElementRef('x')` (`MEEK054`)                     |
