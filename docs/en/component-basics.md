---
source-hash: 8b4098bdc456e1946578d2de4d7a4ab1eb5d9709b74217d2b6eec2f9ba64e2f6
---

# Components and props

## `.meeko` components

A component contains a `<template>` (without it, `MEEK007`) and, normally, a `<script lang="ts">`; `<style scoped>` is optional. Since `1.1`, `<script lang="ts">` is also optional: a component with only `<template>`, or a page with `<script server>` and `<template>`, compiles with an empty setup and `Record<string, never>` props. `MEEK005`, which required the script, is no longer emitted. An `app/pages` page can add a `<script server lang="ts">` with its server code and route options, which never becomes part of the component; since `1.1`, its `export const` declarations reach `<script>` and the template as typed data (see [framework](framework.md#page-server-code)).

The top level of `<script>` is the component's setup and only allows these statements:

- `import` and `export type`, `interface` and `type`;
- `const`/`let` with **one** declaration per statement (`MEEK014`). Since `1.2`, the declaration can destructure an object or array, with defaults, renaming and rest, such as `const { toasts, dismiss } = useToasts()` (see [Destructuring in the script](#destructuring-in-the-script));
- named `function` declarations;
- any expression statement: calls such as `onCleanup(...)`, `onMounted(...)` or `effect(...)` and, since `1.2`, also assignments and other expressions, such as `count.value = props.initial`, `label ??= "Sin título"`, `items.value.push(item)` or `void Child`;
- since `1.2`, control flow: `if`, `for`, `for...of`, `for...in`, `while`, `do...while`, `try`, `switch`, `{ ... }` blocks, labeled statements on them (`outer: for (...)`) and empty statements (the extra `;` after a function);
- `await` on composables supporting it, as a complete statement or initializer (see [Top-level composables and `await`](component-advanced.md#top-level-composables-and-await)).

Expression and control statements execute in order, just like calls: during SSR and again on hydration, before the template reads setup names. A write such as `count.value = props.initial` does not break hydration, because the server and browser repeat it with the same props, and transferred state (or state preserved by hot updates) is restored after setup. Like any top-level code, it repeats on every pass of a render awaiting data (see [Navigation and `render: "client"`](framework.md#navigation-and-render-client)): external writes or requests belong in `onMounted` or a handler. Declarations inside a block, loop or `case` are local: the template only sees top-level declarations. `useElementRef`, `useApi`, `useRpcQuery` and `useRpcMutation` inside a control statement or block would execute conditionally or repeatedly and produce `MEEK054`; `defineProps` outside its own `const` declaration produces `MEEK016`.

Any other top-level statement produces `MEEK018`, with a hint about what to write instead: value `export` declarations (`export const`, `export function`, `export { ... }`, `export default`; the script only exports types, and page data is exported from `<script server>`), classes, `enum`, `namespace`, `import x = require(...)`, and standalone `return`, `throw`, `break` or `continue` (allowed inside an `if` or loop). Move a class or `enum` to a `.ts` module and import it. `defineProps<Props>()` is a compile-time macro: it declares the props received by `renderToString` and `hydrate`; it needs no runtime implementation. `defineEmits`, `defineExpose`, `defineModel`, `defineSnippets` and `useElementRef` are also compile-time macros and are not imported.

```html
<script lang="ts">
	import { signal } from '@meekojs/meeko'

	interface Props {
		initial: number
	}
	const props = defineProps<Props>()
	const count = signal(props.initial)
	function increment(): void {
		count.value++
	}
</script>

<template>
	<button
		on:click="increment"
		bind:title="String(count.value)"
	>
		{count.value}
	</button>
</template>
```

### Destructuring in the script

Since `1.2`, a top-level declaration can destructure an object or array. Each name is a setup binding like any other: it is visible to the template, `meeko check` and the editor.

```html
<script lang="ts">
	const { toasts, dismiss } = useToasts()
	const { title = 'Untitled', ...rest } = props.options
	let [first, , ...others] = pair()
</script>

<template>
	<p
		each:of="toasts.value"
		each:as="toast"
		each:index="index"
	>
		{toast.text}
		<button on:click="() => dismiss(index)">×</button>
	</p>
</template>
```

- **State.** A destructured signal remains a signal, but is not included in component state capture: neither SSR transfer (`renderWithState`) nor HMR preservation. It belongs to the composable or store that returned it, which may share it between components or hold non-JSON values. If a signal is the component's own state, declare it with a simple name (`const count = signal(0)`), which is captured.
- **Macros and refs.** Since `1.8`, `defineProps` accepts simple reactive destructuring (`const { title } = defineProps<Props>()`; see [Destructuring props](#destructure-props)). Nested or array destructuring, computed keys, and `let` produce `MEEK015`. `useElementRef` still needs a simple name: `const { value } = useElementRef("input")` produces `MEEK015`; read `input.value`. `defineEmits`, `defineModel` and `defineSnippets` still require their own `const` declaration with a simple name (`MEEK045`, `MEEK063`, `MEEK059`).
- **Data with `await`.** The result of `await useApi(...)` or `await useRpcQuery(...)` can be destructured: `const { data, refresh } = await useApi("/api/users")`. `data` remains the resource's signal, whose data the framework already sends in the payload.
- **After the first browser `await`.** Names destructured after `await useElementRef(...)` or `await useSocket(...)` only exist in the browser, like the others; the template cannot read them (`MEEK057`).

### Reactive props

Since `1.2`, when the parent changes a prop, the child stays mounted: Meeko delivers the new value and updates only bindings reading that prop, as in Vue or Svelte. The child's DOM, including focus, cursor and composition (IME) in an `<input>` the user is typing in, its state, the snippets it received and its own children are preserved. Up to `1.1`, Meeko rerendered the child's range and only preserved its writable signals by name: the field being edited was replaced.

```html
<!-- UiTextField.meeko -->
<script lang="ts">
	const props = defineProps<{ label: string; error?: string; hint?: string }>({ hint: '' })
	const value = defineModel<string>('value')
	const invalid = computed(() => Boolean(props.error))
</script>

<template>
	<label>
		{props.label}
		<input
			model="value"
			bind:aria-invalid="invalid.value ? 'true' : 'false'"
		/>
	</label>
	<p if:when="props.error">{props.error}</p>
	<small>{props.hint}</small>
</template>
```

```html
<UiTextField
	model:value="form.fields.name"
	bind:label="'Name'"
	bind:error="form.errors.value.name"
/>
```

If `form.errors.value.name` changes while the user types, the `<p>` appears or disappears and `aria-invalid` changes, but the `<input>` remains the same and keeps focus and the entered text.

- **What is reactive.** `props` is a read-only view of the current props. Every read of `props.x` in the template, a `computed`, an `effect` or the input function of `useApi` or `useRpcQuery` follows the prop, including in children to which the component passes it. `"x" in props`, `Object.keys(props)` and `{ ...props }` see props the parent adds or stops passing.
- **What is not.** Setup runs once per instance, so a value copying a prop keeps the initial value, as in Vue: `const { label } = props` (destructuring the `props` object; destructuring `defineProps` is reactive, see [Destructure props](#destructure-props)), `const title = props.title.toUpperCase()`, `signal(props.initial)` or `useApi(ruta, { query: { q: props.q } })`. To follow the prop, read it where used (`{props.label}`), derive with `computed(() => props.title.toUpperCase())` or pass a function to data composables (`useApi(ruta, () => ({ query: { q: props.q } }))`).
- **Warning `MEEK101`.** `meeko check`, `meeko build` and the editor warn for every `props` read that executes only once: destructuring or spreading `props` and reading `props.x` at setup's top level, or directly inside `onMounted` (which does not repeat either: read it in an `effect` to follow it). It is a warning, not an error: it does not fail the check. Reads inside other functions (handlers, `computed`, `effect`), calls to function props (`props.onReady?.()`), `signal(props.x)` and `untrack(() => props.x)`, which declare that only the initial value matters (for example, an unchanging key), and components with a top-level data `await`, which remount, do not warn.
- **Default values.** They apply on every read: a prop becoming `undefined` returns to its default.
- **Read-only.** Assigning, deleting or defining a `props` property in the browser throws `TypeError`. To change a parent's value, emit an event (`defineEmits`) or use a model (`defineModel`).
- **When remounting occurs.** The range is rebuilt, preserving writable signals by name, when the component in `<component is>` changes, when the parent passes another signal in a `model`, and in components with a top-level data `await` (`await useApi(...)` or `await useRpcQuery(...)`): their requests were built with the props they rendered with, so new props remount them when their data is ready (see [Components that mount later](framework.md#components-that-mount-later)). A snippet the parent starts or stops passing (`<snippet if:when>`, see [Conditional snippets](component-events.md#snippets-with-definesnippets)) reaches the mounted child as a new prop; only children without reactive props are rebuilt: those with that data `await` and those compiled before `1.2`.
- **Snippets.** A snippet's content belongs to the parent: it follows the parent's signals and the arguments (`args`) passed by the child without rerendering, and is not rebuilt when other child props change.
- **SSR, hydration and root.** Unchanged: the server renders with the props object and hydration connects the same HTML. A root component's `hydrate(root, props)` and `hydrateScope` receive the object as is; only a Meeko parent delivers the reactive view to its children.
- **HMR and DevTools.** A hot update to the child keeps reading props updated by the parent, and the DevTools panel shows the new props.

### Default values in `defineProps`

Defaults are built into the same macro; `withDefaults` is not needed:

```html
<script lang="ts">
	interface Props {
		title: string
		count: number
		tags?: string[]
	}

	const props = defineProps<Props>({ count: 0, tags: [] })
</script>

<template><p>{props.title}: {props.count} ({props.tags.length})</p></template>
```

For component consumers, `count` and `tags` become optional in `ComponentProps`; `title` remains required. Since `1.8`, the editor shows the default value in the hover for the tag and each prop in the parent, and in completion details (`count?: number = 0`); the compiled module and its `.d.meeko.ts` declarations carry it in the `ComponentDefaults` type. Inside the component, all three values have defined types. An explicit prop overrides its default; if it arrives as `undefined`, the default applies. The object literal is evaluated for each render or hydration: values created inside it, such as `tags: []`, are new per instance; an object imported as a default retains the module's shared identity. SSR and hydration must obtain the same initial value: avoid nondeterministic defaults such as `Date.now()` or `Math.random()` unless you pass the value as an explicit prop.

The argument must be an **object literal with named properties**. Values can use literals, imported symbols and, since `1.8`, top-level `<script>` constants that do not depend on setup (see [Constants in default values](#constants-in-default-values)); not other setup variables. Meeko checks that each key exists in `Props` and its value has the declared type; it rejects duplicate keys, spreads, computed names, an `undefined` default and keys not present in every variant of a props union. `ComponentProps` preserves `readonly` modifiers and variant-specific fields. `defineProps<Props>()` remains valid and preserves all props as declared.

The template accepts text `{expression}`, events `on:event="handler"`, dynamic attributes `bind:name="expression"`, conditions `if:when="expression"`, references `ref:name`, models `model="signal"` (see [Form controls with `model`](component-template.md#form-controls-with-model)), unescaped HTML `html="expression"` (see [Unescaped HTML with `html`](component-template.md#unescaped-html-with-html)) and lists with `each:of`, `each:as` and, optionally, `each:key`. `each:index` names the index and defaults to `index`. Keys are strings or finite numbers and must be unique among siblings. Boolean attributes are added or removed according to the expression's value. In form controls, `bind:value` (on `input`, `textarea` and `select`), `bind:checked` (on `input`) and `bind:selected` (on `option`) also update the element's property, because the browser stops reading the attribute as soon as the user edits the control. The control always reflects the signal, so the `input` handler must save the text as is (`value.value = event.currentTarget.value`) and convert it where used. A `select multiple` does not synchronize with `bind:value`.

### Constants in default values

Default values are evaluated before setup, once per render or hydration. Since `1.8`, they can read top-level `<script>` constants whose value uses only literals, imports and other such constants; Meeko reevaluates them with the defaults, so an object or array is still new per instance:

```html
<script lang="ts">
	import { sizes } from '~/utils/sizes'

	const LIMITS = { min: 1, max: 10 } as const
	const START = LIMITS.min * 2
	const LABEL = `Hasta ${LIMITS.max}`

	const props = defineProps<{ count?: number; label?: string; size?: string }>({ count: START, label: LABEL, size: sizes[0] })
</script>
```

A constant depending on setup is error `MEEK123`, naming the prop, variable and reason: a signal or a call's value (`const start = signal(1)`, `const now = Date.now()`), a `let` or `var` variable, a script function, a prop or another macro's name. Up to `1.7`, any script variable produced `TS2304: Cannot find name`.

### Destructure props

Since `1.8`, `defineProps` can be destructured, as in Vue 3.5. Each name reads its prop wherever used, so it remains reactive in the template, a `computed`, an `effect`, handlers and any function:

```html
<script lang="ts">
	interface Props {
		label: string
		size?: 'sm' | 'md' | 'lg'
		tags?: string[]
		class?: string
		title?: string
	}

	const { label, size = 'md', tags = [], class: className, ...rest } = defineProps<Props>()
	const upper = computed(() => label.toUpperCase())
</script>

<template>
	<p
		bind:class="className"
		bind="rest"
	>
		{upper.value} · {size} · {tags.length}
	</p>
</template>
```

- **Reactive reads.** The compiler writes every read of `label` as `props.label`, in the script and template. A parameter, local variable, `each:as` or snippet parameter with the same name is another variable and does not change. In the editor, `label` hover and completion show its type, `meeko check` marks errors on the name and renaming `label` changes only the local variable (`{ label: text }`), not the prop; the prop is renamed from its type.
- **Default values.** `size = 'md'` is equivalent to `defineProps<Props>({ size: 'md' })`: the prop is optional for the parent and never `undefined` inside; a prop becoming `undefined` returns to its default. An object or array (`tags = []`) is created per instance, and [constants](#constants-in-default-values) can be used. Defaults belong in the destructuring or the argument, not both (`MEEK124`).
- **Renaming.** `class: className` reads the `class` prop under another name, useful for reserved words; also `'aria-label': ariaLabel`.
- **Rest.** `...rest` is a read-only view of the remaining props, following the parent like `props`: `bind="rest"` writes the attributes it currently has. It excludes destructured props and `defineEmits` handlers (`onClick`).
- **Unions.** A discriminated union narrows in the script and template: inside `if:when="to !== undefined"`, `params` has that branch's parameters, as in [A button that is a route, link or button](component-dynamic.md#a-button-that-is-a-route-link-or-button). Each destructured name must exist in every variant; otherwise, `meeko check` produces `TS2344` on it.
- **Read-only.** Assigning a destructured name (`label = 'x'`, `count++`, including in a template handler) is error `MEEK125`: it is a prop. For your own value starting with the prop, use `signal(label)`.
- **What is read once.** Copying a name at setup's top level (`const copy = label`) or directly in `onMounted` keeps the first value: `meeko check` gives warning `MEEK101`, as with `props.label`. The same applies to spreading or destructuring `rest` in setup.
- **Unsupported forms.** Nested destructuring (`const { user: { name } } = defineProps<Props>()`) would copy the inner value without following the prop: it is `MEEK015`; destructure `user` and read `user.name` where used. An array, a computed key and `let` are also `MEEK015`.
- **SSR, hydration and HMR.** Unchanged: signal state is preserved just as with `const props = defineProps<Props>()`.
