---
source-hash: b0c2402a0e4425c46abe25c065161cbe37b9ad05859c1b73b64ab9dd96bf9dcc
---

# Meeko API

This page describes the component engine's public contract, exercised by the examples and tests. The [stability policy](stability.md) specifies what SemVer covers in the 1.x series.

This guide covers the standalone component engine. Conventions for `app/`, routes, middleware, API, RPC, Socket and sessions are in the [framework guide](framework.md).

## `.meeko` components

A component contains a `<template>` (without it, `MEEK007`) and, normally, a `<script lang="ts">`; `<style scoped>` is optional. Since `1.1`, `<script lang="ts">` is also optional: a component with only `<template>`, or a page with `<script server>` and `<template>`, compiles with an empty setup and `Record<string, never>` props. `MEEK005`, which required the script, is no longer emitted. An `app/pages` page can add a `<script server lang="ts">` with its server code and route options, which never becomes part of the component; since `1.1`, its `export const` declarations reach `<script>` and the template as typed data (see [framework](framework.md#page-server-code)).

The top level of `<script>` is the component's setup and only allows these statements:

- `import` and `export type`, `interface` and `type`;
- `const`/`let` with **one** declaration per statement (`MEEK014`). Since `1.2`, the declaration can destructure an object or array, with defaults, renaming and rest, such as `const { toasts, dismiss } = useToasts()` (see [Destructuring in the script](#destructuring-in-the-script));
- named `function` declarations;
- any expression statement: calls such as `onCleanup(...)`, `onMounted(...)` or `effect(...)` and, since `1.2`, also assignments and other expressions, such as `count.value = props.initial`, `label ??= "Sin título"`, `items.value.push(item)` or `void Child`;
- since `1.2`, control flow: `if`, `for`, `for...of`, `for...in`, `while`, `do...while`, `try`, `switch`, `{ ... }` blocks, labeled statements on them (`outer: for (...)`) and empty statements (the extra `;` after a function);
- `await` on composables supporting it, as a complete statement or initializer (see [Top-level composables and `await`](#top-level-composables-and-await)).

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
	const { title = 'Sin título', ...rest } = props.options
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
- **Macros and refs.** `defineProps` and `useElementRef` need a simple name: `const { title } = defineProps<Props>()` or `const { value } = useElementRef("input")` produce `MEEK015`; read `props.title` or `input.value`. `defineEmits`, `defineModel` and `defineSnippets` still require their own `const` declaration with a simple name (`MEEK045`, `MEEK063`, `MEEK059`).
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
	bind:label="'Nombre'"
	bind:error="form.errors.value.name"
/>
```

If `form.errors.value.name` changes while the user types, the `<p>` appears or disappears and `aria-invalid` changes, but the `<input>` remains the same and keeps focus and the entered text.

- **What is reactive.** `props` is a read-only view of the current props. Every read of `props.x` in the template, a `computed`, an `effect` or the input function of `useApi` or `useRpcQuery` follows the prop, including in children to which the component passes it. `"x" in props`, `Object.keys(props)` and `{ ...props }` see props the parent adds or stops passing.
- **What is not.** Setup runs once per instance, so a value copying a prop keeps the initial value, as in Vue: `const { label } = props` (destructuring the `props` object; destructuring `defineProps` is reactive, see [Destructure props](#destructure-props)), `const title = props.title.toUpperCase()`, `signal(props.initial)` or `useApi(ruta, { query: { q: props.q } })`. To follow the prop, read it where used (`{props.label}`), derive with `computed(() => props.title.toUpperCase())` or pass a function to data composables (`useApi(ruta, () => ({ query: { q: props.q } }))`).
- **Warning `MEEK101`.** `meeko check`, `meeko build` and the editor warn for every `props` read that executes only once: destructuring or spreading `props` and reading `props.x` at setup's top level, or directly inside `onMounted` (which does not repeat either: read it in an `effect` to follow it). It is a warning, not an error: it does not fail the check. Reads inside other functions (handlers, `computed`, `effect`), calls to function props (`props.onReady?.()`), `signal(props.x)` and `untrack(() => props.x)`, which declare that only the initial value matters (for example, an unchanging key), and components with a top-level data `await`, which remount, do not warn.
- **Default values.** They apply on every read: a prop becoming `undefined` returns to its default.
- **Read-only.** Assigning, deleting or defining a `props` property in the browser throws `TypeError`. To change a parent's value, emit an event (`defineEmits`) or use a model (`defineModel`).
- **When remounting occurs.** The range is rebuilt, preserving writable signals by name, when the component in `<component is>` changes, when the parent passes another signal in a `model`, and in components with a top-level data `await` (`await useApi(...)` or `await useRpcQuery(...)`): their requests were built with the props they rendered with, so new props remount them when their data is ready (see [Components that mount later](framework.md#components-that-mount-later)). A snippet the parent starts or stops passing (`<snippet if:when>`, see [Conditional snippets](#snippets-with-definesnippets)) reaches the mounted child as a new prop; only children without reactive props are rebuilt: those with that data `await` and those compiled before `1.2`.
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

The template accepts text `{expression}`, events `on:event="handler"`, dynamic attributes `bind:name="expression"`, conditions `if:when="expression"`, references `ref:name`, models `model="signal"` (see [Form controls with `model`](#form-controls-with-model)), unescaped HTML `html="expression"` (see [Unescaped HTML with `html`](#unescaped-html-with-html)) and lists with `each:of`, `each:as` and, optionally, `each:key`. `each:index` names the index and defaults to `index`. Keys are strings or finite numbers and must be unique among siblings. Boolean attributes are added or removed according to the expression's value. In form controls, `bind:value` (on `input`, `textarea` and `select`), `bind:checked` (on `input`) and `bind:selected` (on `option`) also update the element's property, because the browser stops reading the attribute as soon as the user edits the control. The control always reflects the signal, so the `input` handler must save the text as is (`value.value = event.currentTarget.value`) and convert it where used. A `select multiple` does not synchronize with `bind:value`.

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
- **Unions.** A discriminated union narrows in the script and template: inside `if:when="to !== undefined"`, `params` has that branch's parameters, as in [A button that is a route, link or button](#a-button-that-is-a-route-link-or-button). Each destructured name must exist in every variant; otherwise, `meeko check` produces `TS2344` on it.
- **Read-only.** Assigning a destructured name (`label = 'x'`, `count++`, including in a template handler) is error `MEEK125`: it is a prop. For your own value starting with the prop, use `signal(label)`.
- **What is read once.** Copying a name at setup's top level (`const copy = label`) or directly in `onMounted` keeps the first value: `meeko check` gives warning `MEEK101`, as with `props.label`. The same applies to spreading or destructuring `rest` in setup.
- **Unsupported forms.** Nested destructuring (`const { user: { name } } = defineProps<Props>()`) would copy the inner value without following the prop: it is `MEEK015`; destructure `user` and read `user.name` where used. An array, a computed key and `let` are also `MEEK015`.
- **SSR, hydration and HMR.** Unchanged: signal state is preserved just as with `const props = defineProps<Props>()`.

### Conditions with `if:when` and types

Since `1.2`, `if:when` narrows types inside its element, as `v-if` does in Vue: its attributes, props, events and content are checked knowing the condition holds, in `meeko check` and VS Code. No `!` is needed:

```html
<p if:when="user.value">{user.value.name}</p>
<WorkspaceHeader
	if:when="session.data.value.staff"
	bind:staff="session.data.value.staff"
/>
```

- TypeScript narrows the same reference checked by the condition: `if:when="user.value"` narrows `user.value.name`, but not another expression returning the same value.
- It extends to nested conditions and lists and a component tag's content (its snippets). A `<snippet>`'s `if:when` also narrows its content (see [Conditional snippets](#snippets-with-definesnippets)). An `each:as`, `each:index` or snippet parameter with the same name as a condition variable shadows it, and it is not narrowed there.
- Inside an arrow function written in the template, such as `on:click="() => save(user.value.id)"`, TypeScript does not preserve property narrowing; extract the handler to a script function or check the value inside the function.
- Only type checking changes: at runtime, content is never evaluated when the condition is false.

A text expression can contain JavaScript's own braces: object literals (`{ { total: count.value }.total }`), template literals with `${...}`, strings containing `{` or `}`, comments and regular expressions. The expression ends at the brace balancing the opening one; if none exists, the compiler reports `MEEK010` at the opening brace. Directive values can be unquoted when HTML allows it, for example `on:click=increment` or `each:of=items`; the CLI and VS Code locate them just like quoted values.

### Form controls with `model`

Since `1.1`, `model="signal"` binds a form control to a signal in both directions: the control shows the signal's value and every user edit writes to it.

```html
<script lang="ts">
	const name = signal('')
	const accepted = signal(false)
	const plan = signal<string | null>('free')
	const tags = signal<string[]>([])
</script>
<template>
	<input model="name" />
	<input
		type="checkbox"
		model="accepted"
	/>
	<input
		type="radio"
		value="free"
		model="plan"
	/>
	<input
		type="radio"
		value="pro"
		model="plan"
	/>
	<select
		multiple
		model="tags"
	>
		<option value="a">A</option>
		<option value="b">B</option>
	</select>
</template>
```

| Control                                                                           | Property and event                                                   | Signal type                   |
| --------------------------------------------------------------------------------- | -------------------------------------------------------------------- | ----------------------------- |
| Text `<input>` (any `type` except the following, or `bind:type`) and `<textarea>` | `value`, on `input`                                                  | `string`                      |
| `<input type="checkbox">`                                                         | `checked`, on `change`                                               | `boolean`                     |
| `<input type="radio">`                                                            | checked if the signal equals its `value`; `change` writes that value | `string \| null \| undefined` |
| `<select>`                                                                        | `value`, on `change`                                                 | `string`                      |
| `<select multiple>`                                                               | selected options, on `change`                                        | `string[]`                    |

- **Numbers.** An `<input type="number">` also delivers text: store a `string` and convert it where used.
- **Writable signal.** The expression must be a writable signal of the type in the table. A `computed`, a read-only signal or a plain value is a type error, and throws a `TypeError` at runtime.
- **Synchronization.** Assigning the signal from code updates the control's live property, like `bind:value` since `1.0.1`. In SSR, the HTML carries the signal's value (`value`, `checked`, `<textarea>` content or each `<option>`'s `selected`). If the user edits the control before the page hydrates (or the browser restores its value), what they typed is preserved and copied to the signal when hydration ends, before `onMounted` callbacks: `if:`, `each:`, `<render>` regions and parents reading the signal hydrate first with the SSR value and then react to the restored value.
- **Radio.** Requires `value="..."` or `bind:value="expression"`.
- **Dynamic `type`.** Since `1.2`, `model` allows `bind:type` on `<input>` and always treats the control as text: `value`, on `input`, with a `string` signal, even when the type changes. For example, this works for a password field revealing its text:

  ```html
  <script lang="ts">
  	const password = signal('')
  	const revealed = signal(false)
  </script>
  <template>
  	<input
  		bind:type="revealed.value ? 'text' : 'password'"
  		model="password"
  		autocomplete="current-password"
  	/>
  	<button
  		type="button"
  		on:click="() => revealed.value = !revealed.value"
  	>
  		Mostrar
  	</button>
  </template>
  ```

  `bind:type` can only produce text types (`text`, `password`, `email`, `search`, `number`…). With `checkbox`, `radio`, `file`, `submit`, `reset`, `button` or `image`, which have no text value, the model changes neither the signal nor the control: if the control already has that type on hydration, hydration throws a `TypeError`; if it takes that type later, each model read or write delivers a `TypeError` to the nearest error observer (see `provideErrorHandler`). For a checkbox or radio, use another `<input>` with a static `type`.

`MEEK065` flags unsupported uses: `model` on an element other than `<input>`, `<textarea>` or `<select>`; on `<input type="file">`, `submit`, `reset`, `button` or `image`; with both `bind:type` and `type="..."` on the same `<input>`; with `bind:multiple` instead of static `multiple`; with content in `<textarea model>`; alongside `value`, `bind:value` or `on:input` on a text control (or `checked`, `bind:checked` or `on:change` on a checkable control, and `value`, `bind:value` or `on:change` on a `<select>`); a second `model` or `model:nombre`, which is only for components. Other `on:` events are allowed.

### `<select>` with rich content

Since `1.8`, a `<select>` keeps the content current browsers accept: `<button>`, `<selectedcontent>`, `<legend>`, `<div>` and options with `<span>` or `<svg>`. With `appearance: base-select` on the `<select>` and on its `::picker(select)`, the browser paints that content in its own dropdown:

```html
<script lang="ts">
	const plan = signal('pro')
	const plans = [
		{ id: 'free', name: 'Free' },
		{ id: 'pro', name: 'Pro' },
	]
</script>
<template>
	<select model="plan">
		<button type="button"><selectedcontent></selectedcontent></button>
		<option
			each:of="plans"
			each:as="item"
			each:key="item.id"
			bind:value="item.id"
		>
			<span class="dot"></span>
			<span>{item.name}</span>
		</option>
	</select>
</template>
```

- **Hydration.** The browser copies the chosen option into `<selectedcontent>`, with its attributes. Bindings (`bind:`, `on:`, `{text}`) always belong to the real option, never to the copy. Do not put an `id` inside an option, because the copy duplicates it.
- **The copy is not reactive.** If the content of the chosen option changes, the copy stays the same until another one is chosen. `select.selectedIndex = select.selectedIndex` rebuilds it.
- **`<input>` and another `<select>`.** The browser closes the `<select>` when it finds them and moves what follows out of it, so inside a `<select>` they are `MEEK008`. Place them outside.
- **Inner button.** The `<button>` of a `<select>` is inert: clicks reach the `<select>`. A button that clears the selection goes outside.
- **Other browsers.** Firefox keeps this content, but without `base-select` it shows the native dropdown and `<selectedcontent>` stays empty. Check support on [MDN](https://developer.mozilla.org/en-US/docs/Learn_web_development/Extensions/Forms/Customizable_select).

### Unescaped HTML with `html`

Since `1.1`, `html="expression"` on an element fills it with the expression's HTML, **without escaping**. The expression is a `string`; `null` and `undefined` leave the element empty. Since `1.3`, that `string` must be marked as trusted with `trustHtml` (type `TrustedHtml`) or `meeko check` warns with `MEEK107`; see [Trusted HTML](#trusted-html-trustedhtml-and-trusthtml).

```html
<script lang="ts">
	import { trustHtml } from '@meekojs/meeko'
	const article = signal(trustHtml('<p>Contenido <strong>generado</strong> en el servidor.</p>'))
</script>
<template>
	<article
		class="prose"
		html="article.value"
	></article>
</template>
```

- **SSR.** The expression's HTML is normalized for the element before writing, so parsing the document cannot move any node outside it (or imitate Meeko markers outside it): unclosed tags, comments and text elements (`<style>`, `<textarea>`…) are closed (`"<b>Hola"` gives `<b>Hola</b>`), closing tags not matching anything open in the value are discarded (a `</div>` does not close the element), and implicit closing tags are written explicitly. Text and attributes are written as is. If the browser would move some content outside the element, SSR leaves the element empty and the browser fills it on hydration with `innerHTML`, which keeps it inside; without JavaScript that content is invisible. This occurs with a `<div>` or other block inside a `<p>` or an inline element (`<span>`, `<a>`, `<em>`, `<label>`…, which could be inside a `<p>`), a standalone `<li>`, a heading inside another, cells or rows outside their table, loose text in a `<table>`, `<tbody>` or `<tr>`, content other than `<option>` in a `<select>`, an HTML block inside `<svg>` and `<noscript>` and `<plaintext>` elements. Use an element accepting the content (`<div html>`, `<ul html>` for a list of `<li>`, `<tbody html>` for rows). Normalization does not know the element's ancestors: do not nest links, buttons or forms across the template and content.
- **Hydration.** If the element's content matches the expression's HTML (parsed in the element's context, so `<br/>` and `<br>` match), the DOM is left untouched; if it differs, `innerHTML` is replaced.
- **Reactivity.** Every value change replaces `innerHTML`. Inserted content is not part of the template: it has no directives, and hydration never looks for Meeko markers inside it.
- **Events.** To react to clicks inside inserted HTML, listen on the element itself (`on:click`) and use `event.target.closest(...)`.

**It is unsafe with untrusted content.** HTML from users or third parties can execute scripts on the page (XSS): sanitize it before insertion or use `{expression}`, which escapes text. Meeko never executes the content's `<script>` elements when inserting it in the browser, just like `innerHTML`: neither when hydrating different content, changing the value, in a region mounting later (`if:`, `each:`, a component) nor when navigating to another page. Those in the initial document's HTML do execute, because the browser parses them like any page script. `html` is not a mechanism for loading scripts.

The element does not allow children, not even comments or `{expression}`; only whitespace. `MEEK095` also flags `html` on a void element (`<img>`, `<input>`…), a text element (`<textarea>`, `<title>`, `<script>`, `<style>`…), `<template>`, alongside `model` or with an empty value. On a component tag, `html` is not a prop (`MEEK032`). `bind:html` remains an HTML attribute named `html`.

**Custom elements.** `html` and `model` are directives only on standard HTML elements, where they are not valid HTML attributes. On a custom element (a hyphenated tag, such as `<x-markdown html="intro">` or `<my-input model="query">`), they remain literal HTML attributes, as in `1.0`, and the element allows children.

#### Trusted HTML: `TrustedHtml` and `trustHtml`

Since `1.3`, the type of the `html` expression declares where the HTML comes from. `TrustedHtml` is a `string` with a brand existing only in types, and `trustHtml(html)` adds it: at runtime it returns the same `string`, without copying or checking it. Both are imported from `@meekojs/meeko`; they are not auto-imports, so the trust declaration is always a visible import and works the same outside the framework.

**`trustHtml` does not sanitize: it only declares.** Use it where HTML originates, not just before the template:

```ts
// server/content/articles.ts
import DOMPurify from 'isomorphic-dompurify'
import { trustHtml } from '@meekojs/meeko'
import type { TrustedHtml } from '@meekojs/meeko'

// HTML de usuarios o de terceros: se sanea primero y después se declara de confianza.
export function commentHtml(input: string): TrustedHtml {
	return trustHtml(DOMPurify.sanitize(input))
}

// HTML propio, como el Markdown del repositorio renderizado en el build: basta con declararlo.
export function articleHtml(markdownDeConfianza: string): TrustedHtml {
	return trustHtml(markdownDeConfianza)
}
```

For user HTML, [DOMPurify](https://github.com/cure53/DOMPurify) is recommended (in SSR, `isomorphic-dompurify`, which runs it on jsdom). To show text, `{expression}` escapes it and needs none of this.

`meeko check`, `meeko build` and the editor warn with **`MEEK107`** when the expression's type is not assignable to `TrustedHtml | null | undefined`:

- **They warn for** `string`, `string | undefined`, a concatenation or template with a `string` (`'<b>' + name + '</b>'`, whose type is `string` or a pattern such as `` `<b>${string}</b>` ``) and `any`, which says nothing about the origin (for example, the result of `JSON.parse` or `response.json()`).
- **They do not warn for** `TrustedHtml` (including with `null` or `undefined`), text literal types and their unions, written by the author in code (`html="'<br>'"`, `html="open.value ? '<b>sí</b>' : '<i>no</i>'"` or a variable with a declared literal type), and `null` or `undefined`.
- `unknown`, `number` and other non-text types remain a type error (`TS2345`), without an additional warning.
- An unannotated `<script>` constant, such as `const icon = "<svg>…</svg>"`, reaches the template as `string`, because setup returns its bindings in an object and TypeScript widens the literal: write `as const` (`const icon = "<svg>…</svg>" as const`) or mark it with `trustHtml`.

Server data retains the brand: a `<script server>` export or `load` result of type `TrustedHtml` reaches the template with that type (`ServerData<T>` and the page contract preserve it), because the payload is JSON and the brand exists only in types. Mark HTML in the server module producing it and declare `TrustedHtml` in its shared types.

`MEEK107` is a warning: it appears but does not fail `meeko check` or `meeko build`, nor change SSR, hydration or generated code; everything that compiled in `1.2` still compiles and works the same. Inserting an unmarked `string` is deprecated: in `2.0`, the warning becomes an error (see [Deprecation](stability.md#deprecated-apis)).

### Lists with and without `each:key`

Since `1.1`, `each:key` is optional (previously, an unkeyed list produced `MEEK023`, now retired). Without a key, each row's key is its index: row `i` keeps its nodes and receives item `i`, and rows are only added or removed at the end. When inserting, deleting or reordering in the middle of the list, each row shows the item now occupying its position.

```html
<li
	each:of="tags.value"
	each:as="tag"
>
	{tag}
</li>
<li
	each:of="todos.value"
	each:as="todo"
	each:key="todo.id"
>
	<TodoItem bind:todo="todo" />
</li>
```

Use `each:key` when the list changes order or receives items in the middle and each row has its own state that must follow its item: a child component with signals, a form control being edited, focus or an animation. With a key, Meeko moves existing rows instead of reassigning them. For lists that are only displayed or only grow at the end, the index is enough.

### Component styles: `<style>` and `<style scoped>`

A `.meeko` allows one style block, with or without `scoped`. Both pass through the same PostCSS as `app/styles/main.css` (`postcss.config.*`, Tailwind, `@utilities`) and Vite bundles them with the component: SSR links the CSS of the page's components and client navigation loads each route's CSS on entry.

|                                   | `<style scoped>`                                                                        | `<style>`                                                      |
| --------------------------------- | --------------------------------------------------------------------------------------- | -------------------------------------------------------------- |
| Scope                             | Only elements in the component's template, through the `data-meeko-s-<hash>` attribute. | **The entire page**, like `app/styles/main.css`.               |
| Children and `html="..."` content | No, except with `:global(...)`.                                                         | Yes.                                                           |
| `:global(...)`                    | Unwraps the selector without the attribute.                                             | Not transformed: do not use it.                                |
| Risk                              | No leakage.                                                                             | One component's `.card` affects any other component's `.card`. |

A `<style>` without `scoped` is global CSS living alongside the component that needs it. It is not limited to when the component is mounted: once loaded, it keeps applying when navigating to other routes, and its order relative to other stylesheets depends on when it loaded. Use it for intentional global styles, such as those of third-party content wrapped by the component:

```html
<!-- MarkdownView.meeko -->
<template>
	<article
		class="markdown-view"
		html="props.content"
	></article>
</template>

<style>
	/* Global a propósito: el prefijo .markdown-view evita afectar al resto de la página. */
	.markdown-view p {
		margin-block: 0.75em;
	}
	.markdown-view pre {
		overflow-x: auto;
	}
</style>
```

For almost everything else, `<style scoped>` is the default choice, and `:global(...)` reaches children or `html` content without losing scope: `.markdown-view :global(p)` gives `.markdown-view[data-meeko-s-…] p`. Application-wide styles (reset, tokens, typography) belong in `app/styles/main.css` or a file it imports, where their order is explicit.

### Scoped styles and `:global(...)`

`<style scoped>` adds the `data-meeko-s-<hash>` attribute to each selector's last compound, before a pseudo-element if present (`.card::before` becomes `.card[data-meeko-s-…]::before`). `:global(<selector>)` emits the inner selector without the scope attribute:

| Source                 | Result                                 |
| ---------------------- | -------------------------------------- |
| `.card :global(.icon)` | `.card[data-meeko-s-…] .icon`          |
| `:global(body) .card`  | `body .card[data-meeko-s-…]`           |
| `:global(html.dark)`   | `html.dark`, without a scope attribute |

A compound containing `:global(...)` is not scoped; the attribute is added to the selector's last local compound, and a fully global selector does not receive it. `:global` without parentheses or empty, a selector list inside `:global(...)` and a `:global(...)` nested in another pseudo-class, such as `:not(...)`, fail with `MEEK019` at their position. Rules inside `@keyframes` are not modified.

#### Which elements receive the attribute

By default, `data-meeko-s-<hash>` goes on every element in the component's template. Since `1.2`, the `css.scopeAttribute: "matched"` option in `meeko.config.ts` adds it only to elements some scoped selector can select, reducing HTML size:

```ts
// meeko.config.ts
import { defineMeekoConfig } from '@meekojs/meeko/framework'

export default defineMeekoConfig({
	css: { scopeAttribute: 'matched' }, // "all" por defecto en 1.x
})
```

The option applies to everything the project compiles: the Vite plugin (`meeko dev`, `meeko build` and prerendering; outside the framework, the plugin reads `meeko.config.ts` from the Vite root) and `meeko compile`, which reads configuration from the nearest `package.json` folder. Callers of `compile()` directly pass `{ scopeAttribute: "matched" }` in their options. `meeko check` and the editor do not depend on it: it only changes rendered HTML, not types or diagnostics. Like any `meeko.config.ts` change, changing it requires restarting `meeko dev`.

In `1.x`, the default is `"all"`, because `"matched"` can change the result of a previously working case: a class or attribute added by the script through the DOM API to an element left without the attribute (see the end of this section). In `2.0`, `"matched"` becomes the default; see [Stability](stability.md#planned-changes-for-20).

With `"matched"`, rules apply to the same elements as with `"all"`. Only the compound carrying the attribute counts in each selector: the other compounds (ancestors, siblings and `:global(...)`) select any element on the page, with or without the attribute, so an element appearing only as an ancestor, such as `.card` in `.card .title`, does not need it. An element receives the attribute when that compound can match it:

- A tag matches elements of that tag; a class, ID or attribute selector (`[href^="/"]`) matches elements having them in the template. Matching is case-insensitive.
- `*`, pseudo-classes (`:hover`, `:focus-visible`, `:nth-child(...)`, `:not(...)`, `:has(...)`) and pseudo-elements do not restrict matching: `:hover` alone puts the attribute on every element and `a:hover` on every `<a>`.
- `:is(...)` and `:where(...)` match when any argument matches; `&` in nested CSS matches when the enclosing rule's selector matches.

An attribute that can change after rendering counts as present with any value:

- `bind:class` can produce any class; `bind:id`, any ID; `bind:nombre`, the `nombre` attribute (`bind:aria-current` and `[aria-current="page"]`).
- `model` gives its control `value` and `checked`, and a `<select model>` gives its `<option>` elements `selected`.
- An element with `ref:` or an `on:evento` is controlled by the script, through the reference or `event.currentTarget`, and a custom element (`<x-chip>`) manages its own attributes: on them only the tag counts, and any selector class or attribute can match.
- The browser adds `open` to `<details>` and `<dialog>`.

```html
<template>
	<section class="card">
		<h2 class="title">Título</h2>
		<p>Texto</p>
		<span bind:class="state.value">Estado</span>
		<em>Nota</em>
	</section>
</template>

<style scoped>
	.card .title {
		font-weight: 700;
	} /* el <h2>; .card es sólo un ancestro */
	p:hover {
		color: teal;
	} /* el <p> */
	.active {
		color: green;
	} /* el <span>, por bind:class */
</style>
```

With `"matched"`, `<section>` and `<em>` here render without the attribute. The content of `html="..."` and a child component's elements do not receive the parent's attribute, as before (select them with `:global(...)`, for example `.content :global(p)`), and snippet content receives that of the component writing it. A component without `<style scoped>` never emits the attribute and, with `"matched"`, neither does one whose selectors are all global. SSR, hydration and `if:when` and `each:of` regions share the compiled template, so the attribute matches in server HTML and browser-rendered HTML.

Before enabling `"matched"`, review code changing classes or attributes with the DOM API (`classList`, `setAttribute`, `toggleAttribute`). On an element without `ref:` or `on:`, such as a descendant reached by the script with `querySelector`, `closest` or `event.target`, or one modified by an external library, the class receives scoped styles only if that element already had the attribute. Use `bind:class` or `bind:nombre`, put a `ref:` on that element or write the selector with `:global(...)`. With `"all"`, all template elements have the attribute and this case does not occur.

The CLI and VS Code check the type of the event received by `on:event` and that `each:key` returns `string | number`; both locate diagnostics in the template expression. Since `1.2`, on an HTML element the event has its name's `HTMLElementEventMap` type (`SVGElementEventMap` inside `<svg>`), such as `KeyboardEvent` for `on:keydown` or `PointerEvent` for `on:pointerdown`, and `Event` if the name is not in the map (previously only `click`, `input`, `change`, `submit`, `keydown`, `keyup`, `focus` and `blur` were typed). Also, `event.currentTarget` has the tag's element type, the same as `ref:` (`HTMLInputElement` for `<input>`, `HTMLSelectElement` for `<select>`, `HTMLElement` for a custom element), so `on:input="(event) => query.value = event.currentTarget.value"` and `on:change="(event) => accepted.value = event.currentTarget.checked"` are checked without casts; a property the element does not have remains an error. `event.target` keeps the type `EventTarget | null`, because it can be a descendant. On a component tag, `on:evento` is a callback prop and receives the arguments from its `defineEmits`. The VS Code virtual document applies the same strict options for indexed access, exact optional props and type imports as `meeko check`.

`each:index` has type `number` both in the compiled component and the VS Code virtual document; it is not inferred as the initial literal `0`.

`on:event` handlers can be asynchronous. Meeko observes their promise and delivers synchronous failures or rejections to the nearest observer, without leaving an unhandled rejection or stopping other listeners. Component cleanup removes its listeners. If there is no observer, Meeko logs the failure to the console.

Inside a component script, `provideErrorHandler((error, source) => { ... })` registers an observer for its events and its children's, and also for rejections from an `effect` or `onCleanup` that mistakenly returned a promise. It is auto-imported as a real ESM function; `error` has type `unknown`, so it must be narrowed before reading its properties, and `source` is an `ErrorSource` (`"event"`, `"effect"`, `"cleanup"`, `"mounted"`, `"navigation"`, `"socket"` and, since `1.3`, `"uncaught"` and `"rejection"` for global page failures in a mounted application; see [Errors](framework.md#errors)). The union may gain members in a minor: an exhaustive `switch` needs a default branch. `"mounted"` (since `1.1`) identifies failures in an `onMounted` callback and in the browser continuation of a setup with `await` (see [Lifecycle](#lifecycle)). A descendant component can register another observer for its own branch. Context is isolated per root; an asynchronous observer that rejects is logged alongside the original error. In a mounted application, navigation and Socket channels created within the application also use the active observer; their explicit `onNavigationError` and `onError` options take priority. The server uses its own observer with `requestId`.

```html
<script lang="ts">
	provideErrorHandler((error) => {
		console.error('Component failed', error)
	})
	function save(): void {
		// Handle the action here.
	}
</script>
<template><button on:click="save">Save</button></template>
```

To compose components, import the child module in the script and use `<component is="Child" bind:label="expression"></component>`. `is` accepts a module expression and each `bind:` defines a typed prop (also see [static props](#static-props)). The CLI and VS Code check required props, names and value types against the child's declared props; the editor offers completion and locates diagnostics in the original expression. Since `1.1`, names are also checked when the tag passes other valid props: previously an unknown prop alongside a known one did not produce an error. A missing required prop is flagged on the tag. `<component>` closes with `</component>` or itself (`<component is="..." />`); since `1.5`, its content is the component's snippets, as on its tag (see [Snippets](#snippets-with-definesnippets)), and `is` also accepts HTML tags (see [HTML tags in `<component is>`](#html-tags-in-component-is)). SSR HTML marks a comment range to hydrate the child without a wrapper element; children can appear in conditions and lists.

`is` also accepts an expression returning a component module. This allows passing content as a `Component<Props>` prop and rendering it inside another component with props checked by TypeScript:

```html
<!-- Card.meeko -->
<script lang="ts">
	import type { Component } from '@meekojs/meeko'
	const props = defineProps<{ content: Component<{ label: string }>; label: string }>()
</script>
<template>
	<section>
		<component
			is="props.content"
			bind:label="props.label"
		></component>
	</section>
</template>
```

The parent can use `<component is="Card" bind:content="Content" bind:label="'Hola'"></component>`, where `Content` is an imported `.meeko` module. If the `is` expression changes reactively, Meeko disposes of the previous instance and renders and hydrates the new one inside the same markers. Content is created as an independent component, with its own state and cleanup. To pass inline content, write it between the tags: up to `1.4`, `<component is>` did not allow content (`MEEK031`); since `1.5`, loose content fills the `default` snippet and each `<snippet name>` fills its own, just like on a component tag. A component typed only as `Component<Props>` declares no snippets, so passing it content is a type error; type the prop with the module (`typeof Card`) to pass it content.

`<component is>` requires `Component<Props>`: its `renderWithState` function is required to transfer the child's SSR state. `ComponentModule<Props>` retains that function as optional for low-level uses rendering without transfer. The outlet in `app/app.meeko` and layouts is also declared as `Component<Record<string, unknown>>`. The CLI and VS Code diagnose a module that does not satisfy this contract.

If hydration of a reactive replacement fails, Meeko restores the previous content and rehydrates it. If restoration also fails, it delivers both causes in `AggregateError` and stops that binding. Lists prepare new rows before removing old ones: a render, hydration or move failure attempts to restore the previous order and instances. Cleanup errors are preserved alongside the original failure.

Scripts accept `import type`, `export interface`, `export type` and type re-exports. For example, `import type { ComputedRef } from "./contract.js"; export interface CardProps { label: string }; const props = defineProps<CardProps & ComputedRef<string>>();` preserves the intersection in `ComponentProps` and the `.d.meeko.ts` declaration. The consumer must provide all its fields; the name `ComputedRef` alone does not turn a prop into a reactive signal.

### Elements without content (`<div />`)

Since `1.8`, any non-void HTML element can close with `/>` when it has no content, as in Vue: `<div class="spacer" />` is equivalent to `<div class="spacer"></div>`, as are `<span />`, `<textarea name="nota" />`, `<td />`, `<option value="" />`, `<iframe src="…" />` or a custom element such as `<my-element />`. Previously this was `MEEK001`, because the HTML parser opens `<div/>` and puts everything following inside it.

```html
<template>
	<ul>
		<li
			each:of="items.value"
			each:as="item"
			each:key="item.id"
			bind:data-id="item.id"
		/>
	</ul>
	<span
		if:when="loading.value"
		class="spinner"
	/>
	<p>Los nodos que siguen a <code>&lt;span /&gt;</code> son sus hermanos.</p>
</template>
```

- Nodes following a self-closing element are its siblings, not its content. It allows attributes, `bind:`, `on:`, `ref:`, `if:when` and `each:of` like the closing-tag form, and compiles exactly the same.
- SSR writes valid HTML (`<div></div>`, never `<div/>`), and hydration, updates and disposal work as with the closing tag.
- Void elements (`<input />`, `<br />`, `<img />`) do not change, and SVG and MathML already closed with `/>` (`<path d="…" />`, `<mi />`).
- `<template>`, `<script>`, `<style>`, `<html>`, `<head>`, `<body>` and unknown names (`<foo />`) still require their closing tag: `MEEK001`.
- `<td />`, `<th />`, `<tr />`, `<option />` and other table and list elements retain their names for the parser, so their own closing tag afterward (`<td /></td>`) produces `MEEK008`.
- The language server, `meeko check`, ESLint parser and Prettier understand both forms. Prettier preserves them as written; the optional [`meeko/html-self-closing`](../../packages/eslint-plugin/docs/rules/html-self-closing.md) rule standardizes the style with autofix.

### Component tags (`<AppButton />`)

Since `1.1`, a tag whose name starts with an uppercase letter is a component: `<AppButton bind:label="'Guardar'" />` is equivalent to `<component is="AppButton" bind:label="'Guardar'"></component>`. The name is a script identifier, whether an import (`import * as AppButton from "./AppButton.meeko"`) or an auto-import from `app/components`. It allows the same `bind:` and static props, `on:` events, `model:` models and `ref:` as `<component>`, is checked the same in the CLI and VS Code and can go inside `if:when` and `each:of`.

- It can close itself (`<AppButton />`) or with its closing tag (`<AppButton></AppButton>`). Nodes following a self-closing tag are its siblings, not its content.
- Its content is the child's snippets (see [Snippets](#snippets-with-definesnippets)). Passing content to a component without `defineSnippets` is a type error. `MEEK049`, which rejected any content, is no longer emitted.
- A `</AppButton>` without an opening tag produces `MEEK008`, and a component tag outside `<template>`, `<script>` and `<style>` produces `MEEK002`.
- Uppercase names are not confused with HTML elements: `<Table>`, `<Input>` or `<Title>` are components.
- Since `1.2`, an optional child prop (`error?: string`) also accepts `undefined` on the tag, such as `bind:error="failed.value ? 'Obligatorio' : undefined"`, even if the project uses `exactOptionalPropertyTypes`: for Meeko, passing `undefined` is equivalent to not passing the prop, and if the prop has a default in `defineProps`, the child receives the default. Required props still reject `undefined` and an unknown prop remains an error.

Use `<component is="expression">` when the component is selected by an expression, such as `props.outlet` or `props.content`; for a fixed component, the tag is shorter. The editor completes names after `<` and navigates from the tag to the `.meeko` file.

### HTML tags in `<component is>`

Since `1.5`, `is` also accepts an HTML tag: a text literal (`'a'`), an expression whose type is a tag union (`props.href ? 'a' : 'button'`, or a prop `as: "section" | "article"`), a component or a union of tags and components. With a tag, `<component is>` is that element, with its attributes, `on:` events, `ref:`, `html` and `bind="obj"`, and its **content**: children, `if:when`, `each:of`, `<render>` and components. With a component, the content is its snippets, as on a component tag.

A button that becomes a link when it receives `href`, with a single template:

```html
<!-- Button.meeko -->
<script lang="ts">
	import { computed } from '@meekojs/meeko'
	const props = defineProps<{ href?: string; target?: string; type?: 'button' | 'submit' | 'reset'; disabled?: boolean; loading?: boolean }>()
	const emit = defineEmits<{ click: [event: MouseEvent] }>()
	const snippets = defineSnippets<{ default?: []; leading?: []; trailing?: [] }>()
	const inactive = computed(() => Boolean(props.disabled || props.loading))
	const rel = computed(() => (props.target === '_blank' ? 'noopener noreferrer' : undefined))
	const state = computed(() => ({ 'data-loading': props.loading ? '' : undefined, 'aria-disabled': inactive.value ? 'true' : undefined }))
	function onClick(event: MouseEvent): void {
		if (inactive.value) {
			event.preventDefault()
			return
		}
		emit('click', event)
	}
</script>
<template>
	<component
		is="props.href ? 'a' : 'button'"
		class="button"
		bind="state.value"
		on:click="onClick"
		bind:href="inactive.value ? undefined : props.href"
		bind:target="props.target"
		bind:rel="rel.value"
		bind:type="props.type"
		bind:disabled="props.disabled"
	>
		<span
			if:when="props.loading"
			class="button__spinner"
			aria-hidden="true"
		></span>
		<span class="button__label">
			<render snippet="snippets.leading" />
			<render snippet="snippets.default" />
			<render snippet="snippets.trailing" />
		</span>
	</component>
</template>
```

Without `href`, it renders `<button class="button" type="button" data-meeko="0">…</button>`; with `href`, `<a class="button" href="/docs" target="_blank" rel="noopener noreferrer" data-meeko="0">…</a>`. `type` and `disabled` are not written on `<a>`, nor `href`, `target` and `rel` on `<button>` (see [Attributes by tag](#attributes-by-tag)).

- **Types.** Meeko infers the tag union from the type of `is`. An `on:` event's `event.currentTarget` is the union of its elements (`HTMLAnchorElement | HTMLButtonElement`, with `1.2`'s events typed per element), as is a `ref:`'s `useElementRef`. An `is` value that is neither an allowed tag nor a component is a type error (`MEEK112`), as is an arbitrary `string`: type the tag as a literal union or use the `TagName` type. A void tag (`img`, `input`, `hr`…) with content produces `MEEK031`.
- **Allowed tags.** Those in Meeko's HTML data (the MDN data used by the editor), except `script`, `style`, `iframe`, `object`, `embed`, `template`, `slot`, `textarea`, `title`, `base`, `link`, `meta`, `head`, `html`, `body`, `noscript`, `param` and `fencedframe`. The public `TagName` type is that union. A disallowed literal is compile error `MEEK112`; a disallowed value arriving at runtime (with `as any`, for example) throws `TypeError` with `MEEK112` in SSR and the browser before writing HTML: the tag name never injects markup. Custom elements (`x-card`) and SVG tags are not allowed as `is` values; inside `<svg>`, `is` only allows components.
- **SSR and hydration.** Meeko reads the outcomes of `is` from its syntax (`?:` branches, without `as` or parentheses). If all are literals, SSR writes the element as is, without markers. If all are PascalCase identifiers or imports from a `.meeko` (`is="open ? Dialog : Sheet"`), it is a component, as before `1.5` (a constant holding a tag must have a lowercase name). Since `1.8`, a PascalCase literal (`'MeekoLink'`, `'UICard'`) names a component resolved by the compiler (see [Component names in `is`](#component-names-in-is)). In other cases (`props.as`, `view()`), the type decides at runtime: the element goes between component range comments and its content in a snippet range.
- **Tag changes.** If the tag changes in the browser, a new element replaces the previous one: children are **moved** into it with their nodes, so they preserve their reactive state, their components' state, control values and focus; if focus was on the element, it moves to the new one. The element's attributes, events, `ref:`, `html` and `bind` are rebound on the new one. When switching from a tag to a component or vice versa, the range is emptied and content mounts again.
- **Tag or component.** With a union of both, each attribute is checked against what accepts it: `aria-label`, `html` or `data-*` are valid only if `is` is a tag, and `model`, `model:x` or `<snippet name>` only if it is a component (`MEEK112` in `meeko check` and the editor when the `is` type allows the other kind).
- **`'MeekoLink'` in `is`.** `<MeekoLink>` is a compiler tag, not a value: `is="internal ? MeekoLink : 'a'"` remains `TS2304: Cannot find name 'MeekoLink'`. Since `1.8`, write it as a literal, `is="internal ? 'MeekoLink' : 'a'"`, just like a project component (see [Component names in `is`](#component-names-in-is)).
- **Limits.** Content must be valid inside every possible tag (the browser moves a `<div>` out of `<p>` and hydration does not match), and `<component is>` inside `<table>` follows that container's rules. `model` on a `<component is>` whose outcomes are tags produces `MEEK112`: use a form control.

### Component names in `is`

Since `1.8`, a **PascalCase** text literal inside `is` names a component known at compile time: `'MeekoLink'`, a component imported from a `.meeko` or an auto-imported one, such as those from `app/components` or `UI*` from `@meekojs/ui`. It combines with HTML tags in `?:` branches, so a button that is a route, external link or `<button>` fits in a single template:

```html
<component
	is="to !== undefined ? 'MeekoLink' : href !== undefined ? 'a' : 'button'"
	bind:to="to"
	bind:params="params"
	bind:href="href"
	bind:type="type"
	class="button"
>
	Abrir
</component>
```

- **Uppercase or lowercase.** HTML tags are written in lowercase and components in PascalCase: `'button'` is the element and `'Button'` a project component named `Button`. A PascalCase literal that is neither `'MeekoLink'` nor a component imported, auto-imported or declared in the script is `MEEK132` on the literal. `'MeekoOutlet'` and `'MeekoTeleport'` are not allowed.
- **Static resolution.** The compiler imports each name as its tag (`<MeekoLink>`, `<UICard>`), without `import()` or promises, so it works the same in SSR, hydration and navigation. Each name is an `if:when` region whose condition is the `?:` path to its literal (`to !== undefined` for `'MeekoLink'`), and HTML tags form another, an element whose tag changes. When switching branches, the previous one is disposed and the new one mounts, as with `if:when`; between `'a'` and `'button'`, the element is replaced and children move, as always.
- **Attributes per branch.** Each attribute goes only to branches accepting it: `to`, `params`, `search` and `match` to `'MeekoLink'`, which builds its typed `href` and `aria-current` like the tag, along with its `<a>`'s other attributes except `href`; each HTML attribute to tags accepting it, such as `href` on `<a>` and `type` or `disabled` on `<button>` (see [Attributes by tag](#attributes-by-tag)); and props, events, models and `bind="obj"` to components. A component receives all the tag's props and only reads those it declares. `<snippet name>` blocks belong to components; elements render loose content.
- **Types.** `meeko check` and the editor check each branch after its condition, which narrows it: inside `'MeekoLink'`, `to` is a route and its `params` are that route's. Each component is checked against its props (one of its props with a value of another type is an error), but a prop it does not declare is not an excess property, because it may belong to another branch. An attribute accepted by **no** branch, neither tags nor component props, is `MEEK112` (`colour no se aplica a ninguna rama de is`, meaning colour does not apply to any is branch). The editor completes names inside `is` and shows the component or `<MeekoLink>` in the literal's hover.
- **Limits.** With names, all `is` outcomes are literals: a value (`x ? 'MeekoLink' : props.as`) is `MEEK132`. `ref:` is valid only with a single name (`MEEK052`); with several branches, each is a different element or component. `?:` conditions are evaluated in every branch traversing them, so they must be expressions without side effects.
- **Runtime names.** A name arriving at runtime (from a URL, a database) is not resolved at compile time: load it with [`resolveComponent(name)`](reference/components/componentregistry.md), which returns a promise with the module, and pass the module to `is`. Use the literal in `is` when the name is known while writing the template, and `resolveComponent` when chosen at runtime or the component must load lazily.

### A button that is a route, link or button

A single component rendering `<MeekoLink>` if it receives `to`, an `<a>` if it receives `href` and a `<button>` if it receives neither, each with its props and the HTML attributes passed by the parent. Since `1.8`, it fits in one template with `'MeekoLink'` in `is` (see [Component names in `is`](#component-names-in-is)). This is the pattern verified with `meeko check`, SSR, hydration and client navigation:

```html
<!-- app/components/AppButton.meeko -->
<script lang="ts">
import { computed } from '@meekojs/meeko'
import type { ElementAttributes } from '@meekojs/meeko'

/** Los params de la ruta K: `{ id: string }` en `/users/[id]`, `{}` en una ruta estática. */
type RouteParamsOf<K extends RouteId> = NonNullable<MeekoLinkProps<K>['params']>
/** Una ruta con sus params correlacionados: obligatorios si la ruta los tiene, prohibidos si no. */
type LinkTarget = {
	[K in RouteId]: { to: K; search?: MeekoLinkProps['search'] } & (keyof RouteParamsOf<K> extends never ? { params?: never } : { params: RouteParamsOf<K> })
}[RouteId]
type LinkProps = LinkTarget & { href?: never; target?: never; rel?: never; download?: never; type?: never; disabled?: never }
type AnchorProps = {
	href: string
	target?: '_self' | '_blank' | '_parent' | '_top'
	rel?: string
	download?: string | boolean
	to?: never
	params?: never
	search?: never
	type?: never
	disabled?: never
}
type ButtonProps = {
	type?: 'button' | 'submit' | 'reset'
	disabled?: boolean
	to?: never
	params?: never
	search?: never
	href?: never
	target?: never
	rel?: never
	download?: never
}
/** Atributos que se reenvían tal cual, comunes a `<a>` y `<button>`: `id`, `title`, `aria-*`, `data-*`… */
type SharedAttributes = Pick<ElementAttributes<'a'>, keyof ElementAttributes<'a'> & keyof ElementAttributes<'button'>>
type ForwardedAttributes = Omit<SharedAttributes, 'class' | 'type'>

const props = defineProps<(LinkProps | AnchorProps | ButtonProps) & ForwardedAttributes & { label?: string; class?: string }>()
const emit = defineEmits<{ click: [event: MouseEvent] }>()
const snippets = defineSnippets<{ default?: [] }>()

const linkRel = computed(() => props.rel ?? (props.target === '_blank' ? 'noopener noreferrer' : undefined))
/** Las props propias van a su rama; el resto (`id`, `title`, `aria-*`, `data-*`…) se reenvía con `bind`. */
const attributes = computed((): ForwardedAttributes => {
	const { to, params, search, href, target, rel, download, type, disabled, label, class: className, ...rest } = props
	return rest
})
</script>
<template>
	<component
		is="props.to !== undefined ? 'MeekoLink' : props.href !== undefined ? 'a' : 'button'"
		bind:to="props.to"
		bind:params="props.params"
		bind:search="props.search"
		bind:class="props.class"
		bind="attributes.value"
		bind:href="props.href"
		bind:target="props.target"
		bind:rel="linkRel.value"
		bind:download="props.download"
		bind:type="props.type ?? 'button'"
		bind:disabled="props.disabled"
		on:click="(event) => emit('click', event)"
	>
		<render snippet="snippets.default" />{props.label ?? ''}
	</component>
</template>
```

`to`, `params` and `search` only reach the `'MeekoLink'` branch; `href`, `target`, `rel` and `download` reach the second branch's `<a>` (and `target`, `rel` and `download` also reach `<MeekoLink>`'s `<a>`, which builds its `href`); `type` and `disabled` only reach `<button>`. Before `1.8`, or if you prefer explicit branches, the same template is written with two `if:when` conditions, which also narrow `props`:

```html
<template>
	<MeekoLink
		if:when="props.to !== undefined"
		bind:to="props.to"
		bind:params="props.params"
		bind:search="props.search"
		bind:class="props.class"
		bind="attributes.value"
		on:click="(event) => emit('click', event)"
	>
		<render snippet="snippets.default" />{props.label ?? ''}
	</MeekoLink>
	<component
		if:when="props.to === undefined"
		is="props.href !== undefined ? 'a' : 'button'"
		bind:class="props.class"
		bind="attributes.value"
		bind:href="props.href"
		bind:target="props.target"
		bind:rel="linkRel.value"
		bind:download="props.download"
		bind:type="props.type ?? 'button'"
		bind:disabled="props.disabled"
		on:click="(event) => emit('click', event)"
	>
		<render snippet="snippets.default" />{props.label ?? ''}
	</component>
</template>
```

The parent uses it with each branch's props; `aria-*`, `data-*`, `id` and `title` reach the element:

```html
<AppButton to="/about" label="Acerca" />
<AppButton to="/users/[id]" bind:params="{ id: user.id }" bind:search="{ tab: 'actividad' }" aria-label="Perfil">Perfil</AppButton>
<AppButton href="https://example.com" target="_blank" label="Documentación" />
<AppButton href="/informe.pdf" download="informe.pdf" label="Descargar" />
<AppButton type="submit" bind:aria-busy="saving.value" label="Guardar" />
<AppButton bind:disabled="!valid.value" on:click="reset" data-testid="reset">Reiniciar</AppButton>
```

With `id: "7"`, SSR writes, in this order, an `<a>` with `href="/about"`; another with `aria-label="Perfil"` and `href="/users/7?tab=actividad"`; an `<a>` with `target="_blank"` and `rel="noopener noreferrer"`; one with `download="informe.pdf"`; a `<button type="submit">` and a `<button>` with `data-testid="reset"`, `type="button"` and `disabled`. Hydration preserves those elements, `on:click` reaches the parent through `emit` and forwarded attributes update when they change.

- **Three mutually exclusive branches.** Each branch declares the others' props as `never`, so `to` with `href`, `to` or `href` with `type` or `disabled`, and `type` with `target` are type errors in the parent (`TS2345` or `TS2322`). Without `to` or `href`, it is a button, with `type="button"` by default.
- **Routes with their parameters.** `MeekoLinkProps['params']` does not relate parameters to the route: with `to: RouteId` and `params?: MeekoLinkProps['params']`, the parent could omit `params` for `/users/[id]`. `LinkTarget` iterates over `RouteId` and creates a variant per route, so `meeko check` requires `params` for `/users/[id]` (`TS2345`), rejects a nonexistent key (`TS2353`) and forbids `params` on a static route. A nonexistent route is `TS2322` on `to`.
- **`<MeekoLink>` with a route union.** Inside the component, `bind:to="props.to"` is a route union and `bind:params="props.params"` a parameter union TypeScript cannot relate in that expression. Since `1.8`, `<MeekoLink>` then accepts `params` from one of the routes, or none, and optional `search`; previously it produced `TS2412`. The props type correlates the route and its parameters, which the parent does check.
- **One template or two branches.** With `'MeekoLink'` in `is`, each branch is checked after the `?:` condition leading to it, just as `if:when` narrows `props` in each branch (see [Conditions with `if:when` and types](#conditions-with-ifwhen-and-types)): `props.to` is a route inside `'MeekoLink'`. `<component is>` only writes `href`, `target`, `rel` and `download` on `<a>` and `type` and `disabled` on `<button>` (see [Attributes by tag](#attributes-by-tag)). Both forms render the same elements and `meeko check` checks the same rules in the parent.
- **Parent attributes.** Since `1.8`, `aria-*` and `data-*` (static or with `bind:`) pass to a component as props with that name, like `id` or `title`; the component declares them, here with `ElementAttributes`, and one it does not declare is `TS2353` on the attribute (see [Static props](#static-props)). `ForwardedAttributes` are attributes common to `<a>` and `<button>`: `bind` on `<MeekoLink>` is checked against `<a>` attributes (`MEEK113`), so an attribute specific to `<button>`, such as `autocomplete`, is not valid in all three branches.
- **The rest, with `bind`.** Own props are separated with destructuring inside a `computed`, which follows the props, and the rest goes to `bind`. Since `1.8`, `props` does not include `defineEmits` handlers (`onClick`) among its keys, so rest does not carry them along; previously, `bind` threw `MEEK113` with the `onClick` key (see [Component events](#component-events-defineemits-and-on)).
- **Default `rel`.** `linkRel` puts `noopener noreferrer` on a `target="_blank"` without `rel`; an explicit `rel` wins.
- **Optional text.** `{props.label ?? ''}`: `{expresión}` writes its value's text, including `undefined`.

With destructured props (since `1.8`), the same component's script and template are shorter; types do not change and `meeko check` checks the same rules in the parent:

```html
<script lang="ts">
// …los mismos imports y tipos…
const { to, params, search, href, target, rel, download, type = 'button', disabled = false, label = '', class: className, ...rest } = defineProps<(LinkProps | AnchorProps | ButtonProps) & ForwardedAttributes & { label?: string; class?: string }>()
const emit = defineEmits<{ click: [event: MouseEvent] }>()
const snippets = defineSnippets<{ default?: [] }>()

const linkRel = computed(() => rel ?? (target === '_blank' ? 'noopener noreferrer' : undefined))
</script>
<template>
	<MeekoLink
		if:when="to !== undefined"
		bind:to="to"
		bind:params="params"
		bind:search="search"
		bind:class="className"
		bind="rest"
		on:click="(event) => emit('click', event)"
	>
		<render snippet="snippets.default" />{label}
	</MeekoLink>
	<component
		if:when="to === undefined"
		is="href !== undefined ? 'a' : 'button'"
		bind:class="className"
		bind="rest"
		bind:href="href"
		bind:target="target"
		bind:rel="linkRel.value"
		bind:download="download"
		bind:type="type"
		bind:disabled="disabled"
		on:click="(event) => emit('click', event)"
	>
		<render snippet="snippets.default" />{label}
	</component>
</template>
```

`rest` replaces the `attributes` `computed`, `if:when="to !== undefined"` narrows `params` like `props.to`, and pattern defaults (`type = 'button'`) remain exclusive to their branch: `to` with `type` remains an error in the parent. See [Destructure props](#destructure-props).

### Attributes by tag

In a `<component is>` with tags, Meeko writes each attribute only while the current tag accepts it according to its HTML data, without ternaries: `bind:href`, `target` and `rel` only on `<a>`, `bind:type` and `disabled` only on `<button>`. Global attributes (`class`, `id`, `style`, `title`, `hidden`, `tabindex`, `role`, `lang`, `dir`, `aria-*`, `data-*`…) and `on:` events are always written; `aria-disabled` is global, so it is valid for a disabled link. `type` does not count as an attribute of `<a>` or `<area>`, where it is only a MIME type hint. Nothing changes on ordinary elements.

`meeko check` and the editor give error `MEEK112` on an attribute accepted by **none** of the possible tags (`bind:colspan` on `'a' | 'button'`): Meeko would never write it. Since `1.8`, with component names in `is`, the rule applies to all branches: `'MeekoLink'` is an `<a>` without `href`, and a component accepts its props (see [Component names in `is`](#component-names-in-is)). When `is` writes its tags as literals, the editor completes their attributes and indicates which tags each applies to, and the `component` hover shows the possible elements.

### Attribute values

Since `1.8`, Meeko knows the values the HTML standard allows for each attribute from its HTML data (generated from WHATWG, WAI-ARIA and `@mdn/browser-compat-data`): `<button>`'s `type` is `"submit" | "reset" | "button"`, `hidden` is `"" | "hidden" | "until-found"`, `<dialog>`'s `closedby` is `"any" | "closerequest" | "none"` and `aria-pressed` is `"true" | "false" | "mixed" | "undefined"`.

- **Types.** `AttributeValues<Tag, Name>` is the union of those values (`never` for a free-text, hint or space-separated token attribute, such as `href`, `rel` or `class`). `AttributeValueOf<Tag, Name>` is that union plus any attribute value (`string`, `number`, `boolean`, `null`, `undefined`), so the editor suggests values without rejecting others; it is the type of each `ElementAttributes<Tag>` key, which retains its keys.
- **Warning `MEEK122`.** `meeko check`, `meeko build` and the editor warn when the value is a text literal not among the standard's values, compared case-insensitively as in HTML: `<button type="sumbit">`, `bind:type="'sumbit'"` or an expression whose type is a literal union with no valid value. A `string` value, number, boolean or attribute without a closed value set never warns. This applies to HTML elements and `<component is>` with tags, with values from any of them; not custom elements or SVG. It is a warning: it does not fail `meeko check` or change generated code. In `2.0`, it becomes an error (see [Deprecated APIs](stability.md#deprecated-apis)).
- **`hidden`.** No longer just boolean: `hidden="until-found"` and `bind:hidden="'until-found'"` write `hidden="until-found"`, hiding content until page search finds it. `bind:hidden` with `true` writes `hidden=""` and with `false`, `null`, `undefined`, `0` or `""` removes it, as before; only nonempty text changes: previously it wrote `hidden=""`.
- **Booleans.** Standard boolean attributes (`disabled`, `open`, `inert`, `itemscope`…) are written empty with a truthy value and removed with a falsy one, in SSR and the browser. Since `1.8`, the list comes from the same HTML data; additions since `1.7` are `alpha`, `headingreset`, `itemscope`, `scoped`, `seamless`, `typemustmatch` and `<template>`'s `shadowroot*`: with `bind:` and text, they now write the empty attribute instead of the text.

```html
<script lang="ts">
	import type { AttributeValues } from '@meekojs/meeko'
	const props = defineProps<{ kind?: AttributeValues<'button', 'type'> }>()
</script>
<template>
	<button bind:type="props.kind ?? 'button'">Enviar</button>
	<details hidden="until-found">…</details>
</template>
```

### `class` and `style` alongside `bind:class` and `bind:style`

Since `1.8`, an element can carry both static `class` and `bind:class`, or `style` and `bind:style`, and Meeko writes a single attribute with both, identically in SSR, hydration and updates. Dynamic classes follow static ones, and dynamic `style` declarations follow static ones, so they win. If the dynamic value is `undefined`, `null`, `false` or an empty string, the static text remains as is. This also applies to a `<component is>` that can only be a tag; on a component, `class` and `bind:class` pass the same prop (`MEEK090`).

```html
<article
	class="card"
	bind:class="open.value ? 'is-open' : undefined"
>
	...
</article>
```

Before `1.8`, SSR wrote `class` twice (`class="card" class="is-open"`): the browser kept the first and hydration failed with a mismatch.

### Bulk attributes with `bind`

Since `1.5`, `bind="obj"` writes an object's keys as attributes of an element, of `<component is>` or, on a component tag, as its props:

```html
<script lang="ts">
	import { computed } from '@meekojs/meeko'
	import type { ElementAttributes } from '@meekojs/meeko'
	const props = defineProps<{ busy: boolean; id: string }>()
	const attrs = computed((): ElementAttributes<'section'> => ({ id: props.id, 'aria-busy': props.busy, hidden: false }))
</script>
<template>
	<section
		class="panel"
		bind="attrs.value"
	>
		...
	</section>
</template>
```

- **Types.** The object is checked against the tag's attributes (or those of any `<component is>` tag), or the component's props: a key that is not one produces `MEEK113`. `ElementAttributes<Tag>` types the object. On a custom element (`<x-card bind="...">`), `bind` remains an HTML attribute, like `html` and `model`.
- **Values.** Keys with `undefined`, `null` or `false` are not written, as with `bind:x`; `true` writes the empty attribute. On a component, an `undefined` key is an absent prop.
- **Order.** An explicit `bind:x` or static attribute wins over the same object key. `class` and `style` are **combined** in any order, including `class`, `bind:class` and `bind` together: explicit and object classes are joined, and the object's `style` declarations precede explicit ones, which win. On a component they are not combined: the explicit prop wins.
- **The same attribute as text and with `bind:`.** Except for `class` and `style`, `id="a" bind:id="b"` produces the `MEEK133` warning: only `bind:id` applies, in any order, and the text is ignored. Keep one of the two.
- **No handlers.** A key starting with `on` is a type error (`MEEK113`) and a runtime `TypeError`: event handlers are not created from data; use `on:evento`. `data-meeko*` keys, reserved for Meeko, are not allowed either. As in HTML, names are compared case-insensitively: `Data-Meeko` is also rejected, and an `ID` key alongside `bind:id` does not write a second `id`.
- **Reactive.** If the object changes, Meeko writes the new attributes and removes those no longer present; a component receives new props in place. `bind=""` or valueless `bind` produces `MEEK113`, as does using it on `<template>`.

### Static props

Since `1.1`, an unprefixed attribute on a component tag or `<component is>` passes a static prop, as on an HTML element:

```html
<AppButton
	variant="primary"
	disabled
	bind:label="title.value"
/>
```

- **Value.** Attribute text arrives as a text literal (`"primary"`, with its literal type) and a valueless attribute arrives as `true`. Both are type-checked against child props, like `bind:`: `variant="tertiary"` against `variant: "primary" | "secondary"` is an error on the attribute.
- **Reserved names.** `is`, `ref` and `html` are not static props, nor is `bind`, which passes bulk props since `1.5` (see [Bulk attributes with `bind`](#bulk-attributes-with-bind)), nor hyphenated names other than `aria-*` and `data-*` (`x-label`) or names containing `:` without being a directive (`bind:`, `on:`, `model:`, `ref:`, `if:when`, `each:*`): all produce `MEEK032`. To pass a prop named `ref`, use `bind:ref`.
- **`aria-*` and `data-*`.** Since `1.8`, `aria-label="Cerrar"`, `data-state="open"` and their `bind:aria-busy="saving.value"` and `bind:data-count="n"` forms pass a prop with that name, on component tags and `<component is>` with a component; previously they produced `MEEK032`. The child declares them like any prop, for example with `defineProps<Props & ElementAttributes<'button'>>()`, and writes them on its element with `bind` (see [A button that is a route, link or button](#a-button-that-is-a-route-link-or-button)); if not declared, `meeko check` produces `TS2353` on the attribute. They are lowercase, as in HTML (`Aria-Label` produces `MEEK032`), and `data-meeko*` is reserved. On a `<component is>` that can be a tag or component, they remain tag attributes (see [HTML tags in `<component is>`](#html-tags-in-component-is)).
- **Conflicts.** The same prop as static text and with `bind:` or `on:` (`variant="primary" bind:variant="x"`) produces `MEEK090`. `on:save` alongside `bind:onSave` remains `MEEK048`.

### Component events: `defineEmits` and `on:`

A component declares its events with the `defineEmits<T>()` macro, where each key of `T` is an event and its value is the argument tuple. It returns a typed `emit(evento, ...argumentos)` function:

```html
<!-- TodoItem.meeko -->
<script lang="ts">
	const props = defineProps<{ id: number; title: string }>()
	const emit = defineEmits<{ save: [id: number]; close: [] }>()
</script>
<template>
	<p>{props.title}</p>
	<button on:click="() => emit('save', props.id)">Guardar</button>
	<button on:click="() => emit('close')">Cerrar</button>
</template>
```

The parent listens with `on:evento` on the child tag, equally on `<TodoItem>` and `<component is>`:

```html
<TodoItem
	bind:id="todo.id"
	bind:title="todo.title"
	on:save="save"
	on:close="() => open.value = false"
/>
```

There is no separate event channel: each `save` event is the child's optional `onSave` callback prop, and `emit("save", id)` calls whichever the parent currently passes. Thus `on:save="save"` is equivalent to `bind:onSave="save"`, which keeps working as in `1.0`, and an `emit` without a listener does nothing. TypeScript checks `emit` arguments in the child and the handler signature in the parent; an event the child does not declare is a type error.

- `defineEmits` must appear only once, in its own top-level `const` declaration with a simple name (`MEEK045`), with a type argument (`MEEK046`) and no runtime arguments (`MEEK047`).
- Props declared by `defineEmits` (`onSave`) cannot also be declared in `defineProps`: this is a type error.
- Since `1.8`, `props` does not enumerate those props: `Object.keys(props)`, `'onSave' in props`, `{ ...props }` and the rest in `const { id, ...rest } = props` exclude `onSave`, like its type, so `bind="rest"` does not receive handlers (previously it threw `MEEK113`). `props.onSave` can still be read and `emit` calls the callback as always. This applies when the script writes the events: a literal type (`defineEmits<{ save: [] }>()`) or local `interface` or `type` without `extends` or parameters; with an imported or derived type, `props` enumerates them as before.
- On a component, the event name is an identifier (`on:save`, `on:saveDraft`); `on:save-draft` produces `MEEK011`. Writing `on:save` and `bind:onSave` on the same tag produces `MEEK048`.
- On an HTML element, `on:click` remains a DOM listener.

A callback declared directly in `defineProps` (`onSave: (id: number) => void`, called by the child with `props.onSave(id)`) remains valid; `defineEmits` avoids declaring it manually and makes it optional.

### Component models: `defineModel` and `model`

Since `1.1`, a component uses the `defineModel<T>()` macro to declare a value the parent shares with it in both directions. It returns a writable `Signal<T>`:

```html
<!-- AppInput.meeko -->
<script lang="ts">
	const value = defineModel<string>() // modelo por defecto
	const open = defineModel<boolean>('open', { default: false }) // modelo con nombre, opcional
	// Para que el modelo por defecto sea opcional: defineModel<string>({ default: "" })
</script>
<template>
	<input model="value" />
	<button on:click="() => open.value = !open.value">Opciones</button>
</template>
```

The parent passes its signals with `model` (the default model) and `model:nombre`, equally on a component tag and `<component is>`:

```html
<AppInput
	model="name"
	model:open="settingsOpen"
/>
```

- **The parent's signal.** If the parent passes a signal, `defineModel` returns that same signal: reading and writing in the child reads and writes the parent's signal. The parent owns it, so the signal is not part of the child's SSR-transferred or HMR-preserved state.
- **Required or optional.** A model without `default` is required: omitting it in the parent is a type error and throws a `TypeError` at runtime. With `{ default: valor }`, it is optional; if the parent does not pass it, the child uses a local signal with that initial value.
- **Optional default model.** Options go without a name for the default model: `defineModel<string>({ default: "" })` makes it optional, like `defineModel<string>("default", { default: "" })`, the same declaration with the name written out. With `defineModel<string>()`, however, a parent that does not pass `model` (for example, because the field receives a `FormField` in `bind:field`) produces `TS2741` (“Property '"default"' is missing in type '{}' but required in type 'ComponentModels'”). There is no ambiguity between the two forms: the name is always a text literal and options an object literal.
- **Writable signal.** The parent's expression must be a writable `Signal<T>`. A `computed`, read-only signal or plain value is a type error and a runtime `TypeError`.
- **Not props.** Models do not appear in `ComponentProps`; the compiled module exports their type in `ComponentModels`. SSR reads the signal's value and hydration connects the same signal.

`defineModel` goes in its own top-level `const` declaration, with a simple name, and each model name appears once (`MEEK063`). It receives a type argument, an optional name as a text literal and options accepting only `default` (`MEEK064`). In the parent, a model name that is not an identifier, the same model twice, a valueless `model` or `model:x` alongside `bind:x` produce `MEEK066`.

### Snippets with `defineSnippets`

Since `1.1`, a component receives parent content in named snippets, declared with the `defineSnippets<T>()` macro. Each key of `T` is a snippet, its value is the parameter tuple and `?` makes it optional:

```html
<!-- AppDialog.meeko -->
<script lang="ts">
	const snippets = defineSnippets<{ default: []; title?: []; actions?: [close: () => void] }>()
	const open = signal(true)
	function close(): void {
		open.value = false
	}
</script>
<template>
	<section if:when="open.value">
		<h2 if:when="snippets.title"><render snippet="snippets.title" /></h2>
		<render snippet="snippets.default" />
		<footer>
			<render
				snippet="snippets.actions"
				args="close"
			/>
		</footer>
	</section>
</template>
```

```html
<AppDialog>
	<p>{message.value}</p>
	<snippet name="title">Confirmar</snippet>
	<snippet
		name="actions"
		params="close"
	>
		<button on:click="close">Cerrar</button>
	</snippet>
</AppDialog>
```

- **In the parent.** Loose tag content fills `default`. `<snippet name="x" params="a, b">` fills snippet `x`; `params` names its comma-separated parameters, with the types of the child's tuple. Content uses the parent's scope (its signals and functions) and remains reactive, including to argument changes.
- **In the child.** `<render snippet="expresión" args="a, b" />` renders a snippet with those arguments; `args` is an expression list. `if:when="snippets.title"` checks whether the parent passed an optional snippet, and a `<render>` of an absent optional snippet renders nothing.
- **Types.** Not passing a required snippet, passing one the child does not declare or using parameters not matching its tuple are type errors in the parent. Snippets are not props: they do not appear in `ComponentProps`, and the compiled module exports their type in `ComponentSnippets`. Each snippet is a `Snippet<Args>`, a type exported by `@meekojs/meeko`.
- **SSR and hydration.** The snippet renders within the child's DOM, between comment markers, but belongs to the parent's reactive scope: it is disposed when the parent or child is disposed.
- **Forwarding.** A component can pass a received snippet to another: `<Inner><snippet name="x" params="a"><render snippet="snippets.x" args="a" /></snippet></Inner>`.
- **Conditional snippets.** Since `1.4`, `<snippet name="x" if:when="expresión">` passes the snippet only while the expression is true. With a false condition, the snippet does not exist for the child: `snippets.x` is `undefined`, its `if:when="snippets.x"` is false and a `<render>` renders nothing. This allows forwarding an optional snippet; without `if:when`, this example's card would always receive `footer` and its `<footer if:when="snippets.footer">` would render an empty container when the panel receives no `actions`:

  ```html
  <!-- AppPanel.meeko: defineSnippets<{ default: []; actions?: [close: () => void] }>() -->
  <AppCard>
  	<render snippet="snippets.default" />
  	<snippet
  		name="footer"
  		if:when="snippets.actions"
  	>
  		<render
  			snippet="snippets.actions"
  			args="close"
  		/>
  	</snippet>
  </AppCard>
  ```

  The condition is evaluated in the parent's scope (it cannot see the snippet's own `params`), identically on the server and on hydration, and is reactive: when it changes, the child stays mounted, with its DOM, state and focus, and only bindings reading `snippets.x` update (children without reactive props remount; see [Reactive props](#reactive-props)). While it remains true, the child retains the same snippet. As with props, a value copied from `snippets.x` by the child's setup (`const hasFooter = Boolean(snippets.footer)`) keeps the initial value: read it in the template or a `computed`. This only applies to a snippet the child declares optional (`x?:`): on a required one it is type error `MEEK110`. Like `if:when` on an element, it narrows types inside snippet content. It also applies to `<snippet name="default">`; loose content, which fills `default` without a tag, does not allow a condition.

- **Reuse another component's snippets.** Since `1.4`, a `T` key's value can also be a `Snippet<Args>`, treated as its `Args` tuple. Thus `T` can start from another component's snippet map, `AppCardSnippets` (the named type of each auto-imported component; see [Types for each component](framework.md#component-types)) or its module's `ComponentSnippets`, and trim or extend it with `Omit`, `Pick` or `&`. Each snippet preserves its parameters and `?`: a modal wrapping a card declares the card's snippets except `footer`, adds `actions` and forwards them with `<snippet if:when>`:

  ```html
  <!-- app/components/App/Card.meeko -->
  <script lang="ts">
  	const snippets = defineSnippets<{ header?: []; default: []; footer?: [] }>()
  </script>

  <!-- app/components/App/Modal.meeko -->
  <script lang="ts">
  	const open = defineModel<boolean>()
  	const snippets = defineSnippets<Omit<AppCardSnippets, 'footer'> & { actions?: [close: () => void] }>()
  	function close(): void {
  		open.value = false
  	}
  </script>
  <template>
  	<AppCard>
  		<snippet
  			name="header"
  			if:when="snippets.header"
  		>
  			<render snippet="snippets.header" />
  		</snippet>
  		<render snippet="snippets.default" />
  		<snippet
  			name="footer"
  			if:when="snippets.actions"
  		>
  			<render
  				snippet="snippets.actions"
  				args="close"
  			/>
  		</snippet>
  	</AppCard>
  </template>
  ```

  For `<AppModal>` consumers, `header` and `actions` are optional, `default` is required, `footer` does not exist and `actions` delivers `close`: `meeko check` and the editor check this on their tags as on any other component, including a generic one (`Pick<ListSnippets<T>, "row">`). Existing tuples do not change: `defineSnippets<{ item: [name: string] }>()` has the same type as before and can mix with `Snippet` entries. A value that is neither a tuple nor a `Snippet` remains error `TS2344`.

- **Snippet names.** A `<snippet>`'s `name` is an identifier (`title`) or, since `1.8`, segments of identifier characters joined by hyphens (`cell-email`, `header-created-at`, `cell-2024`): the rule is `/^[A-Za-z_$][\w$]*(?:-[\w$]+)*$/`, without trailing or double hyphens. In the child, a hyphenated name is read as a bracket property: `snippets['cell-email']`.
- **Dynamic snippets typed by a generic.** Since `1.8`, `T` keys can come from a type parameter with a mapped type and template literal, like `#name-cell` slots in other libraries. The parent writes a snippet for each row key, and `meeko check` and the editor check it against the type inferred from its props: `value` has that column's type, a key the row does not have is an error (`TS2353`), as are extra `params`. The editor completes possible names (with known `bind:rows`, concrete keys; otherwise, the prefix, such as `cell-`) and shows their signature in hover:

  ```html
  <!-- AppGrid.meeko -->
  <script
  	lang="ts"
  	generic="Row extends object"
  >
  	import type { Snippet } from '@meekojs/meeko'

  	type Column<R extends object> = { key: Extract<keyof R, string>; label: string }
  	const props = defineProps<{ rows: readonly Row[]; columns: readonly Column<Row>[] }>()
  	const snippets = defineSnippets<
  		{ [K in Extract<keyof Row, string> as `cell-${K}`]?: [row: Row, value: Row[K]] } & {
  			[K in Extract<keyof Row, string> as `header-${K}`]?: [column: Column<Row>]
  		} & { cell?: [row: Row, column: Column<Row>, value: unknown] }
  	>()
  	// Sobre Row, TypeScript no lee un nombre calculado: el hijo lo lee de una vista.
  	const byName = snippets as { readonly [name: string]: Snippet<never> | undefined }
  	function cellOf(column: Column<Row>): Snippet<[row: Row, value: unknown]> | undefined {
  		return byName[`cell-${column.key}`] as Snippet<[row: Row, value: unknown]> | undefined
  	}
  </script>
  <template>
  	<p each:of="props.rows" each:as="row">
  		<span each:of="props.columns" each:as="column">
  			<render
  				if:when="cellOf(column)"
  				snippet="cellOf(column)"
  				args="row, row[column.key]"
  			/>
  			<render
  				if:when="!cellOf(column)"
  				snippet="snippets.cell"
  				args="row, column, row[column.key]"
  			/>
  		</span>
  	</p>
  </template>

  <!-- En el padre: value es string, el tipo de User['email']. -->
  <AppGrid
  	bind:rows="users"
  	bind:columns="columns"
  >
  	<snippet
  		name="cell-email"
  		params="row, value"
  	>
  		<a bind:href="'mailto:' + value">{value}</a>
  	</snippet>
  </AppGrid>
  ```

  In the child, an intersection with a mapped type is read member by member: `snippets.cell` retains its tuple alongside mapped snippets. What TypeScript cannot type over a type parameter is a computed name (``snippets[`cell-${column.key}`]``): it works at runtime, but the child reads it from a cast view, such as `byName` above. `UITable` uses this pattern for `cell-<clave>` and `header-<clave>`.

`defineSnippets` appears only once, in its own top-level `const` declaration with a simple name (`MEEK059`), with a type argument and no runtime arguments (`MEEK060`). `MEEK061` flags a `<snippet>` that is not a direct child of a component tag, has no `name` or a name not following the snippet naming rule, has non-identifier parameters, is repeated, has attributes other than `name`, `params` and `if:when`, has an empty or valueless `if:when`, or a `<snippet name="default">` alongside loose content. `MEEK110`, a type error from `meeko check` and the editor, flags `if:when` on a `<snippet>` filling a required child snippet. `MEEK062` flags a `<render>` without `snippet`, with content or attributes other than `snippet` and `args`. A `ref:` inside `<snippet>` content produces `MEEK052`, because the child may render it several times. `<snippet>` and `<render>` can be self-closing.

### Expose values: `defineExpose`

`defineExpose(value)` publishes a child value to the parent naming it with `ref:` (see the next section). It is a top-level statement appearing once (`MEEK050`) and receives one argument and at most one type argument (`MEEK051`):

```html
<!-- SearchBox.meeko -->
<script lang="ts">
	const query = signal('')
	function clear(): void {
		query.value = ''
	}
	defineExpose({ query, clear })
</script>
<template>
	<input
		bind:value="query.value"
		on:input="(event) => query.value = event.currentTarget.value"
	/>
</template>
```

The parent receives that value with its type; a component without `defineExpose` exposes `null`. The compiled module exports the `ComponentExposed` type, and the function returned by `hydrateScope` carries the value in `exposed`. The exposed value is not part of the state transferred from server to browser.

The `.d.meeko.ts` declarations generated by `meeko types` lose precision in a component with `defineExpose`: TypeScript cannot infer the exposed value's entire type there and writes `any` for what it cannot infer. `meeko check` and the language server compile the component and have the exact type.

### Element references: `ref:` and `useElementRef`

The valueless `ref:nombre` directive names an element or component in the template. `useElementRef("nombre")` reads it from the script:

```html
<script lang="ts">
	const title = useElementRef('title')
	const box = useElementRef('box')
	onMounted(() => {
		title.value?.scrollIntoView()
	})
	function reset(): void {
		box.value?.clear()
	}
</script>
<template>
	<h2 ref:title>Buscar</h2>
	<SearchBox ref:box />
	<button on:click="reset">Limpiar</button>
</template>
```

- **Type.** Comes from the template: on an HTML or SVG element, its `HTMLElementTagNameMap` or `SVGElementTagNameMap` type (`HTMLHeadingElement` for `<h2>`); on a component, its `defineExpose` type.
- **Without `await`.** `useElementRef` returns a read-only signal that is `null` in SSR, before hydration, while an `if:` hides the target and after disposal. When `onMounted` runs, every visible ref already has its value.
- **With `await`.** `const title = await useElementRef("title")` returns the element, never `null`, and waits until it exists, including under an `if:` that is still false. The rest of setup continues only in the browser (see the next section).
- **Lists.** Inside `each:of`, one directive names all rows and `useElementRef` returns a signal with a read-only array in document order. A list ref cannot be awaited with `await` (`MEEK056`).

`useElementRef` receives a text literal naming a template `ref:`; another argument or a nonexistent name produces `MEEK056`. A `ref:` with a value, a non-identifier name, on `<template>` or repeated on the same element produces `MEEK052`; the same name at two template locations produces `MEEK053`. The editor completes names inside `useElementRef("…")`.

`ref="x"` and `bind:ref` are not directives: they behave as in `1.0`, as an HTML attribute on an element and, on a component, `ref="x"` produces `MEEK032` and `bind:ref` passes a `ref` prop.

### Generic components (`generic`)

Since `1.1`, the `<script lang="ts">` `generic` attribute declares the component's type parameters. Its value is a TypeScript type parameter list, with constraints (`extends`), defaults and parameters depending on others (`generic="T extends object, K extends keyof T"`):

```html
<!-- DataTable.meeko -->
<script
	lang="ts"
	generic="T extends { id: string }"
>
	const props = defineProps<{ rows: T[] }>()
	const emit = defineEmits<{ select: [row: T] }>()
	const snippets = defineSnippets<{ row: [row: T] }>()
	const current = defineModel<T | null>('current', { default: null })
	defineExpose({ first: (): T | undefined => props.rows[0] })
</script>
<template>
	<ul>
		<li
			each:of="props.rows"
			each:as="row"
			each:key="row.id"
			on:click="() => emit('select', row)"
		>
			<render
				snippet="snippets.row"
				args="row"
			/>
		</li>
	</ul>
</template>
```

**Scope.** Parameters exist throughout `<script>`: in the type arguments of `defineProps`, `defineEmits`, `defineModel` and `defineSnippets`, in the `defineExpose` value and in variable and function annotations. Script `interface` and `type` declarations, however, are declared at module level, where parameters do not exist: one using `T` produces `MEEK100`. Write the type in the macro argument (`defineProps<{ rows: T[] }>()`) or declare it generic and pass the parameter (`type Rows<T> = T[]` and `defineProps<{ rows: Rows<T> }>()`).

**Inference in the parent.** The parent does not write type arguments: each tag infers them once from its props.

```html
<DataTable
	bind:rows="users.value"
	on:select="(user) => open(user.email)"
	model:current="selected"
>
	<snippet
		name="row"
		params="user"
	>
		<span>{user.email}</span>
	</snippet>
</DataTable>
```

With `users` of type `Signal<User[]>`, `T` is `User`. That `T` checks the rest of the tag and what the parent receives: the `on:select` handler receives a `User`, `model:current` must be a `Signal<User | null>`, the snippet's `user` parameter is a `User` and `useElementRef` for a `ref:` on the tag returns the exposed value with `T = User`. Props must satisfy the constraint: rows without `id` are a type error on `bind:rows`. `on:` handlers are also props (`onSelect`), so one with annotated parameters participates in inference; an unannotated one receives the inferred `T`. A static prop preserves its literal: with `generic="T extends string"`, `<Chip value="draft" />` infers `T = "draft"`.

**Types.** The compiled module exports `ComponentProps<T>`, `ComponentModels<T>`, `ComponentSnippets<T>` and `ComponentExposed<T>` with the same parameters, constraints and defaults, and its `renderWithState`, `renderToString`, `hydrate` and `hydrateScope` functions are generic. From TypeScript, `ComponentProps<User>` gives the props of a user table. `meeko types`' `.d.meeko.ts` declarations preserve type parameters.

**Limits.**

- `T` is inferred only from props. Models, snippets and refs do not participate: they are checked with the `T` supplied by props, and if no prop determines it, TypeScript uses the constraint (or `unknown`).
- A `ref:` on a tag inside `each:of` types each row's exposed value with `T`'s constraint, not the inferred `T`.
- Since `1.5`, `<component is>` allows content as snippets, just like the tag: a generic component with required snippets can use either. Up to `1.4`, it did not allow it (`MEEK031`), so only its tag could be used.
- Pages, layouts, `app/app.meeko` and `app/error.meeko` cannot be generic because Meeko passes them their props (see [framework](framework.md#routing-layouts-and-ssr)). A `<script server>` does not carry `generic` either.

`MEEK100` flags an empty `generic` or one that is not a valid type parameter list (including closing the list early, such as `generic="T> = string; type X<U"`), a parameter with modifiers (`const`, `in`, `out`), with a name starting with `__` or repeated, `generic` on `<script server>` or on a page, layout, `app.meeko` or `error.meeko`, and a script type declaration using a parameter.

### Top-level composables and `await`

`useElementRef`, `useApi`, `useRpcQuery` and `useRpcMutation` are only called at the top level of `<script>`; inside a function, handler, `effect` or `onMounted` they produce `MEEK054`. `useState`, `useSocket`, `useSocketClient` and `useNavigation` retain their `1.0` behavior and can also be called from nested code, like `useRoute` (see [Current route](framework.md#current-route)), provided it runs with the component: a composable called by the script, a `computed`, an `effect` or `onMounted`. An event handler, timer or promise callback has no active root: `useState` and `useRoute` throw `Missing Meeko context` or their own error, `useSocket` and `useSocketClient` throw `onCleanup() requires an active component root` and `useNavigation` returns a fixed state with `pending` set to `false`. Call them in the script and use the result in the handler. `useForm` (since `1.2`) does not produce `MEEK054` either, although its place is the script's top level, like any component state (see [Forms: `useForm`](framework.md#forms-useform)). `useHead` and `useSeoMeta` (since `1.2`) do not produce `MEEK054` and can be called inside a composable invoked by the script; outside a mounted component's script they do nothing (see [Document head](framework.md#document-head-document-usehead-and-useseometa)). `useApi`, `useRpcQuery` and `useRpcMutation` belong to the framework and are described in [framework.md](framework.md#data-in-components-useapi-userpcquery-and-userpcmutation).

Since `1.2`, `useApiMutation` and `useStorage` require the component script to be executing (outside it they throw an `Error`), but the compiler does not include them in `MEEK054`, to avoid rejecting custom functions with the same name in existing projects. Call `useApiMutation` at the top level, like `useRpcMutation`; `useStorage` can also be called inside a composable invoked by the script. `await useApiMutation(...)` produces `MEEK055`. They are described in [Mutations](framework.md#mutations) and [Persistent state](framework.md#persistent-state-usestorage).

Setup remains synchronous, with one exception: it allows top-level `await` only on these composables, in two categories.

| `await`                                                                          | Where it resolves                                      | Result                               |
| -------------------------------------------------------------------------------- | ------------------------------------------------------ | ------------------------------------ |
| `await useApi(...)`, `await useRpcQuery(...)`                                    | In the framework render: SSR, hydration and navigation | Loaded data, with non-null `data`    |
| `await useElementRef(...)`, `await useSocket(...)`, `await useSocketClient(...)` | Only in the browser, after mounting                    | The element, or the socket once open |

The `await` must be the complete statement or the complete initializer of a declaration (`const notes = await useApi(...)`), with one per statement. Any other top-level `await`, `await useRpcMutation(...)`, `for await` and `await using` produce `MEEK055`; move that work into a function or `onMounted`.

Without `await`, `useApi` and `useRpcQuery` return the resource immediately, with `data` set to `null` until the request, which starts in the browser on mounting, finishes. Its region is empty in server HTML and grows when data arrives; since `1.5`, `<MeekoAwait for="recurso" reserve>` wraps it with its states and reserves its height (see [Avoid height shifts](framework.md#prevent-layout-shifts-cls)).

The first browser `await` splits setup:

- Previous statements are normal setup, executed in SSR and on hydration. The template can only use names declared there: a name declared afterward produces `MEEK057`.
- From that `await`, the rest is a continuation executing only in the browser, once the component is mounted and what it awaits is ready. It belongs to the component: its `effect`, `onCleanup` and composables are disposed on unmount, and if unmounted while waiting, the continuation does not resume. A failure reaches the error observer with source `"mounted"`.
- `defineProps`, `defineEmits`, `defineExpose`, `defineModel` and `defineSnippets` must go before that `await` (`MEEK058`).
- A subsequent `await useApi(...)` or `await useRpcQuery(...)` also executes only in the browser, like an ordinary request.
- The continuation is an async function and allows the same statements as synchronous setup: simple `const`/`let` declarations and functions, any expression statement (assignments such as `count.value = 1`, not just calls), `if`, `for`, `for...of`, `for...in`, `while`, `do...while`, `try`, `switch`, blocks, labeled statements and empty statements. `useElementRef`, `useApi`, `useRpcQuery` and `useRpcMutation` inside one of those control statements would execute conditionally or repeatedly and produce `MEEK054`. Any other statement (a class, `export const`…) produces `MEEK018`.

`await useElementRef("x")` awaits the `defineExpose` value of the component named by `ref:x`. If that component has no `defineExpose`, there is nothing to await: `meeko check` flags it with `MEEK080` (the editor shows it as an `await` type error) and, at runtime, the promise rejects with an `MEEK080` error when the component hydrates. Add `defineExpose` to the component or read `useElementRef("x").value` without `await`.

```html
<script lang="ts">
	const messages = signal<string[]>([])
	const chat = await useSocket('chat', { roomId: 'general' })
	// Desde aquí, sólo en el navegador y con el socket abierto.
	chat.on('message', (message) => {
		messages.value = [...messages.value, message.text]
	})
</script>
<template>
	<p
		each:of="messages.value"
		each:as="text"
	>
		{text}
	</p>
</template>
```

## Generated module

Each `.meeko` exports `ComponentProps`, `ComponentExposed` (since `1.1`; `null` without `defineExpose`), the `ComponentModels` and `ComponentSnippets` types (since `1.1`; `null` without `defineModel` or `defineSnippets`), `css`, `renderWithState(props)`, `renderToString(props)`, `hydrate(root, props, state?)` and `hydrateScope(scope, props, state?)`; on a component with `generic`, these types and functions carry its type parameters (see [Generic components](#generic-components-generic)). With `defineEmits`, `ComponentProps` includes optional callback props for each event (`onSave`). The application supplies the same serializable props to server and browser. `renderWithState` returns HTML and a writable signal snapshot validated as JSON; `hydrate` restores those values before claiming existing HTML. Children carry their own state within their comment markers. The compiler uses `hydrateScope` for those children. The cleanup function disposes observers and events. A difference in initial HTML produces a hydration error.

```ts
import { hydrate, renderWithState } from './Counter.meeko'
import { serializeJson } from '@meekojs/meeko'

const props = { initial: 1 }
const { html, state } = renderWithState(props)
const payload = serializeJson({ props, state })
// El servidor inserta html en la raíz y payload en un script JSON seguro.
const release = hydrate(document.querySelector('#counter')!, props, state)
// Llamar release() cuando la raíz deje de usarse.
```

Since `1.4`, each auto-imported component also has those four types with its tag name, without an import: `<AppCard>` (`app/components/App/Card.meeko`) gives `AppCardProps`, `AppCardSnippets`, `AppCardModels` and `AppCardExposed`, which are exactly its `ComponentProps`, `ComponentSnippets`, `ComponentModels` and `ComponentExposed`, including `null` (see [Types for each component](framework.md#component-types)). The `.meeko` module does not export them with that name, because the name depends on where the project auto-imports it (folder and module prefix), not the component: from an explicit import they remain `import type { ComponentSnippets as CardSnippets } from "./Card.meeko"`.

Since `1.5`, a script signal whose value is `undefined` travels in `renderWithState` state (under the `"meeko:undefined"` key, listing their names) and hydrates as `undefined`, even if the browser script creates it with another value. A value JSON does not faithfully represent (a date, a `Map`, a class instance or an `undefined` inside an object) fails with the component and signal, and a hint: `app/pages/agenda.meeko: the signal "when" cannot be sent to the browser with the SSR state (Non-plain object at $.when)`. Only top-level writable script signals travel: a `computed`, constant or signal stored inside an object is not part of state.

To transfer props or state in a `<script>` tag, use `serializeJson(value)`; it checks that data can be faithfully represented in JSON and escapes characters that could close the tag. `renderToString` remains available when initial state is deterministically derived from props and no explicit snapshot is needed. `renderToString` and `renderWithState` are synchronous: outside the framework render they cannot await an `await useApi(...)` or `await useRpcQuery(...)`, and a component needing it throws an error with code `MEEKO_SUSPENDED`. Use the component from a framework page or use the composable without `await`. Inside the framework, a component mounting in the browser after the page waits for its data with an empty region instead of throwing that error (see [Components that mount later](framework.md#components-that-mount-later)). Compiled modules also export `hasDataAwait` and `__meekoChildren`, markers read by the framework to skip navigation preloading, `__meekoReactiveProps` (since `1.2`), telling the parent it can update child props without remounting, and `__meekoChannels` and `__meekoTag`, which only type parent tags; none is part of the contract. When child props change, Meeko updates bindings reading them in place (see [Reactive props](#reactive-props)); when the child remounts, it preserves writable signals by name.

## Reactivity

`signal(initial)` creates a writable value with `.value`. `computed(() => expression)` creates a read-only computed value. `effect(() => ...)` observes signals read and returns a function canceling the observer. `batch(() => ...)` batches updates; `untrack(() => ...)` reads without subscribing the current observer. `createRoot(dispose => ...)` groups effects to dispose of them when an instance unmounts. If an observer fails, Meeko continues other pending observers and propagates errors; multiple failures are delivered in an `AggregateError`. If the `batch` callback also fails, both causes are preserved.

The `effect` callback must be synchronous: reads after an `await` cannot be registered as dependencies of that execution. TypeScript rejects a callback returning a promise and the runtime rejects the same case in JavaScript; if that promise also rejects, Meeko reports the rejection so it does not remain unhandled. Start async work from a synchronous effect and explicitly manage its cancellation and errors.

`onCleanup(() => ...)` registers resource disposal in the active root and also requires a synchronous callback. TypeScript rejects functions that can return `PromiseLike`; the runtime protects JavaScript and callbacks changing behavior, observes any rejection and delivers a `TypeError` during disposal. All cleanups continue executing and simultaneous failures are aggregated. To close an async resource, explicitly start and observe that operation before unmounting or use a host that can await its own shutdown lifecycle.

If rendering or hydration fails, Meeko disposes all effects and resources already registered. When both work and some cleanup fail, it delivers an `AggregateError` preserving both causes.

### Lifecycle

`onMounted(fn)` (since `1.1`) executes `fn` once in the browser after the component hydrates or mounts and its bindings and refs exist. It never runs in SSR. Call it while the component script executes; outside it, it throws an error. It is exported from the root and auto-imported in framework applications.

```html
<script lang="ts">
	const width = signal(0)
	onMounted(() => {
		const update = (): void => {
			width.value = window.innerWidth
		}
		update()
		window.addEventListener('resize', update)
		return () => window.removeEventListener('resize', update)
	})
</script>
<template><p>{width.value}px</p></template>
```

- **Order.** Callbacks execute at the end of the current hydration or mount, when everything that operation created exists: the component, its later siblings and its parent's bindings. Within it, children run their `onMounted` before the parent. A component mounting later (under an `if:`, in a new `each:` row or when committing navigation) follows the same rule within its own mount. Multiple callbacks in a component execute in registration order, without subscribing to signals they read. If hydration or mounting fails, their callbacks do not run, nor do those of a component disposed before completion.
- **Cleanup.** If `fn` returns a function, Meeko registers it as `onCleanup` and executes it when the component unmounts.
- **Async.** `fn` can be `async`, but then cannot return a cleanup: call `onCleanup` before its first `await`.
- **Errors.** A synchronous failure or rejected promise reaches the nearest observer with source `"mounted"`, does not stop other callbacks and does not undo hydration.

There is no `onUpdated`: use `effect` to react to changes.

| Phase                                             | When it runs                                       | Where                               |
| ------------------------------------------------- | -------------------------------------------------- | ----------------------------------- |
| Setup (top level of `<script>`)                   | On rendering and on hydration or mounting          | Server and browser                  |
| `effect`                                          | During setup and whenever a signal it read changes | Server (first run only) and browser |
| `onMounted`                                       | Once, after hydration or mounting                  | Browser only                        |
| `onCleanup` (and cleanup returned by `onMounted`) | On unmounting or disposing the component           | Where it was registered             |

`createContext<T>()` creates a unique typed key. `provide(key, value)` publishes a value in the active instance; `inject(key)` finds the nearest provider and fails explicitly if missing. Independent roots do not share values. If the value is a signal, descendants can read it reactively.

Observers created during `hydrate` belong to that instance. During Vite HMR, writable script signals are preserved by name; computed values are recalculated. This in-memory HMR state is independent of JSON transfer between server and browser.

The `@meekojs/meeko` root exports exactly `signal`, `computed`, `effect`, `batch`, `untrack`, `createRoot`, `onCleanup`, `onMounted`, `createContext`, `provide`, `inject`, `provideErrorHandler`, `serializeJson`, since `1.3`, `trustHtml` and, since `1.5`, `useId`, plus signal, context, component, `HotState`, DevTools and, since `1.3`, `TrustedHtml` types. This engine also documents `@meekojs/meeko/vite` and `@meekojs/meeko/devtools-ui`. Framework and adapter subpaths (`/framework`, `/server`, `/node`, `/bun`, `/deno`, `/cloudflare` and `/build`) are described in the [framework guide](framework.md). The compiler imports its DOM, HMR and DevTools registration functions from `@meekojs/meeko/internal`. That path is a contract between the compiler and its runtime of the **exact same version**, and is not intended for manual imports. A generated module must be compiled with the same package version that executes it, so it must be recompiled when updating Meeko.

### Stable IDs: `useId`

Since `1.5`, `useId()` returns an ID for attributes linking elements (`id`, `for`, `aria-describedby`, `aria-controls`, `aria-labelledby`): the same in server HTML and on hydration, and different in each component instance. It is exported from the root and auto-imported in framework applications; a project's own export with the same name takes priority.

```html
<!-- app/components/AppSwitch.meeko -->
<script lang="ts">
	const props = defineProps<{ label: string; hint?: string }>()
	const on = defineModel<boolean>()
	const id = useId()
</script>
<template>
	<input
		type="checkbox"
		role="switch"
		bind:id="id"
		bind:aria-describedby="props.hint ? `${id}-hint` : null"
		model="on"
	/>
	<label bind:for="id">{props.label}</label>
	<p
		if:when="props.hint"
		bind:id="`${id}-hint`"
	>
		{props.hint}
	</p>
</template>
```

- **Deterministic.** The ID does not travel in state: it comes from the instance's tree position (its containing component, its row's key in an `each:` and the `if:` or snippet rendering it) and the call order in its script. Server and browser traverse the same positions, so hydration finds the same `id` in every attribute.
- **Unique.** Two instances never share an ID, including list rows or content rendered later in the browser by an `if:` or snippet. A row with `each:key` keeps its ID when the list reorders, and a component recreated by an `if:` recovers its previous one.
- **Where to call it.** At the script's top level, like `onMounted`, and before any `await`. Every call gives a new ID (`id` and `hint`, not one for everything); for several elements of the same field, derive suffixes from one: `` `${id}-hint` ``. Outside a component script (in an event handler or test), it returns a unique ID that does not match between server and browser.
- **Format.** Application prefix, `-`, position and counter: `m-0`, `m-2_f0n3-1`; a position with long text keys or other characters is summarized in a hash (`m-h1x2y3…-0`). It only contains letters, numbers, `-` and `_`, so it also works in a CSS selector. Do not depend on its shape, which can change between versions.
- **Prefix.** `document.idPrefix` in `meeko.config.ts` (a letter followed by letters, numbers, `-` or `_`; `m` by default) changes it on server and browser together. Use distinct prefixes when two Meeko applications share a page. A custom host passes the same value in `DocumentOptions.config` and `mountClientApp({ document })`.
- **Standalone roots.** With `hydrate` or `renderWithState` without the framework, each root starts at the empty position: two independent roots on the same page would repeat their IDs.

`useForm` uses it for [`form.field`](framework.md#field-components-formfield) IDs.

## Built-in components

Since `1.5`, Meeko includes two accessible components, `<MeekoPopover>` and `<MeekoSelect>`, as built-in tags: they are not imported and work the same in the standalone engine and framework. They have no visual styles; they expose state through `data-*` and ARIA attributes for the application to style.

- **Size.** Each tag is its own module (`@meekojs/meeko/builtins/popover` and `@meekojs/meeko/builtins/select`), imported by the compiler only in components using it. An application that does not write them does not load their code, and `<MeekoSelect>` brings `<MeekoPopover>` with it. These paths, like `@meekojs/meeko/internal`, are a contract between the compiler and its same-version runtime: do not import them manually.
- **SSR and hydration.** Server HTML includes the trigger (with the selected value in a select) and content hidden by its `popover` attribute, without flicker. IDs linking trigger, content and options come from [`useId`](#stable-ids-useid): they are the same on hydration.
- **CSP.** Nothing goes in `style="…"` attributes. Anchoring uses a constructed stylesheet (`adoptedStyleSheets`) in the `meeko` cascade layer, shared by all, and each instance passes its values in custom properties through CSSOM; a CSP without `'unsafe-inline'` is sufficient. Because it is in a layer, any application rule takes priority.
- **Names.** A project component named `MeekoPopover` or `MeekoSelect` takes priority over the tag, with warning `MEEK106`. Their prop types, `MeekoPopoverProps` and `MeekoSelectProps`, are exported from `@meekojs/meeko/framework` and auto-imported in `app/`.

### Popover: `<MeekoPopover>`

> **Deprecated since 1.8; removal in 2.0.** `<MeekoPopover>` keeps working in 1.x and emits `MEEK121`. Use `<UIPopover>` from `@meekojs/ui` 0.2 with its module active. It preserves props, snippets and `data-meeko-*` markup. See [Migration to 1.8](migration-1.8.md).

Content in the browser's top layer (the `popover` API), anchored to its trigger with _CSS anchor positioning_:

```html
<script lang="ts">
	const open = signal(false)
</script>
<template>
	<MeekoPopover
		placement="bottom-start"
		bind:offset="8"
		model="open"
		role="menu"
		on:toggle="(event) => console.log(event.open)"
	>
		<snippet name="trigger">Opciones ▾</snippet>
		<button
			role="menuitem"
			on:click="rename"
		>
			Renombrar
		</button>
		<button
			role="menuitem"
			on:click="duplicate"
		>
			Duplicar
		</button>
		<button
			role="menuitem"
			on:click="remove"
		>
			Eliminar
		</button>
	</MeekoPopover>
</template>
```

Meeko renders a `<button>` with `popovertarget`, `aria-expanded`, `aria-controls` and `aria-haspopup` (according to `role`), whose content is the `trigger` snippet, and loose content inside an element with `popover` and `data-meeko-popover`. With `popovertarget`, the button opens and closes content even before hydration.

| Prop                    | Default          | What it does                                                                                                                        |
| ----------------------- | ---------------- | ----------------------------------------------------------------------------------------------------------------------------------- |
| `mode`                  | `"auto"`         | `"auto"` closes on an outside click and `Esc`; `"manual"` only from the trigger, `Esc` or the model; `"hint"` is a tooltip (below). |
| `placement`             | `"bottom-start"` | `top`, `bottom`, `left` or `right`, with `-start` or `-end` to align with a trigger edge.                                           |
| `offset`                | `0`              | Gap from the trigger in pixels.                                                                                                     |
| `role`                  | —                | `"menu"`, `"dialog"` or `"tooltip"` (default with `mode="hint"`): the content's ARIA pattern.                                       |
| `label`                 | —                | Content `aria-label`; without it, a menu or dialog is named by the trigger (`aria-labelledby`).                                     |
| `class`, `triggerClass` | —                | Content and button classes.                                                                                                         |
| `triggerId`             | `useId`          | Trigger `id`; with a custom trigger, its `id`.                                                                                      |
| `matchWidth`            | `false`          | Content is at least as wide as the trigger (`anchor-size(width)`).                                                                  |
| `delay`, `closeDelay`   | `300`, `150`     | With `mode="hint"`, milliseconds before opening and closing with the pointer.                                                       |

`model` (the default model) is the open signal: assigning it opens or closes content, and the user changes it by opening or closing. `on:toggle` emits `{ open }` (type `PopoverToggleEvent`) on every change. A `ref:` receives `show()`, `hide()` and `toggle()`.

**Keyboard and focus.**

- `Esc` closes and returns focus to the trigger. Clicking outside closes a `mode="auto"` without moving focus.
- With `role="menu"`, content follows the menu pattern: `Enter`, `Space` or `↓` on the trigger open the menu with focus on the first `menuitem` (`↑`, on the last); arrows move it (wrapping), `Home` and `End` go to the ends and initial letters search for an item. Items with `disabled` or `aria-disabled="true"` are skipped. Choosing a `role="menuitem"` closes the menu and returns focus; a `menuitemcheckbox` or `menuitemradio` leaves it open. `Tab` closes the menu. Mark items with `role="menuitem"`: Meeko does not change its content's role.
- With `role="dialog"`, focus enters the first control (or the element with `autofocus`) on opening.

**Tooltip.** `mode="hint"` uses `popover="hint"`: it opens on pointer hover (after `delay`) or trigger focus, stays open while the pointer is over it or the content, closes with `Esc` or on losing focus and never takes focus. The trigger has `aria-describedby` pointing to the content, which is `role="tooltip"`.

```html
<MeekoPopover mode="hint">
	<snippet name="trigger">?</snippet>
	El código está en el reverso de la tarjeta.
</MeekoPopover>
```

**Position.** Content uses `position-anchor`, `position-area` and `position-try-fallbacks: flip-block, flip-inline`, so it moves to the other side if it does not fit. In a browser without anchor positioning, Meeko marks it with `data-meeko-popover-fallback` and calculates its position in JavaScript on opening and each `resize` or `scroll`: it also flips and never leaves the viewport, and the chosen side is stored in `data-side`. Open content carries `data-open`.

**Custom trigger.** The `anchor` snippet replaces the button: it receives in `trigger` (type `PopoverTrigger`) the attributes the trigger must carry, with each attribute's name as a key, so [`bind="trigger"`](#bulk-attributes-with-bind) is enough. `<MeekoPopover>` finds the element by its `id` on mounting and adds keyboard behavior and anchoring:

```html
<MeekoPopover role="menu">
	<snippet
		name="anchor"
		params="trigger"
	>
		<button
			type="button"
			class="avatar"
			bind="trigger"
		>
			<img
				src="/me.png"
				alt="Mi cuenta"
			/>
		</button>
	</snippet>
	<a
		role="menuitem"
		href="/perfil"
	>
		Perfil
	</a>
</MeekoPopover>
```

With a custom component, `<AppButton bind="trigger">` passes those keys as props: the component must declare them (for example, `defineProps<Partial<PopoverTrigger> & { variant?: "ghost" }>()`) and put them on its `<button>`, the element carrying the `id`.

A trigger that is not a `<button>` (without `popovertarget`) opens content with the model: `on:click="() => open.value = !open.value"`.

### Select: `<MeekoSelect>`

> **Deprecated since 1.8; removal in 2.0.** `<MeekoSelect>` keeps working in 1.x and emits `MEEK121`. Use `<UICombobox>` from `@meekojs/ui` 0.2 with its module active, which keeps props, snippets and `data-meeko-*` markup, or `<UISelect>`, a native `<select>`, if you do not need `multiple`, `searchable`, `filter` or `max`. See [Migration to 1.8](migration-1.8.md).

An accessible select built on `<MeekoPopover>`. `model` is the value and its type comes from `options`:

```html
<script lang="ts">
	interface User {
		id: number
		name: string
		team: string
	}
	const colors = ['Rojo', 'Verde', 'Azul']
	const color = signal<string | null>(null)
	const users = signal<User[]>([])
	const user = signal<User | null>(null)
	const tags = signal<string[]>([])
</script>
<template>
	<label for="color">Color</label>
	<MeekoSelect
		id="color"
		model="color"
		bind:options="colors"
		placeholder="Elige un color"
		name="color"
	/>

	<MeekoSelect
		model="user"
		bind:options="users.value"
		by="id"
		label="Responsable"
	>
		<snippet
			name="option"
			params="user, state"
		>
			{user.name}
			<span if:when="state.selected">✓</span>
		</snippet>
		<snippet
			name="value"
			params="user"
		>
			{user.name}
		</snippet>
	</MeekoSelect>

	<MeekoSelect
		model="tags"
		multiple
		searchable
		bind:options="colors"
		bind:max="2"
		name="tags"
	/>
</template>
```

| Prop                                        | What it does                                                                                                                                                   |
| ------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `options`                                   | Options, primitives or objects. Reactive.                                                                                                                      |
| `multiple`                                  | The model is an array and each option is toggled.                                                                                                              |
| `by`                                        | How an option is compared to the value: a key (`by="id"`) or a function `(a, b) => boolean`. Defaults to `Object.is`.                                          |
| `labelBy`, `disabledBy`, `groupBy`          | Each option's label (by default, primitive text or the object's `label`/`name`), whether disabled (by default, `disabled: true`) and group: a key or function. |
| `placeholder`                               | Text when no value is selected.                                                                                                                                |
| `name`                                      | `name` of the `<input type="hidden">` elements submitted with the `<form>`.                                                                                    |
| `required`, `disabled`                      | As in a native control.                                                                                                                                        |
| `searchable`                                | The trigger is an `<input>` filtering options.                                                                                                                 |
| `filter`                                    | Custom search, synchronous or asynchronous.                                                                                                                    |
| `max`                                       | With `multiple`, the maximum number of options that can be selected.                                                                                           |
| `field`                                     | The `useForm` field: `bind:field="form.field('color')"`.                                                                                                       |
| `id`, `label`, `describedBy`, `invalid`     | Trigger `id` (for `<label for>`), its `aria-label`, `aria-describedby` and `aria-invalid`.                                                                     |
| `class`, `listClass`, `placement`, `offset` | Root and list classes, and list position.                                                                                                                      |

`on:change` emits the new value on every user selection. Snippets are `option` (`[option, state]`, with `state.selected`, `state.active` and `state.disabled`), `value` (how each selected value appears in the trigger; without it, comma-separated labels), `group` (a group heading), `empty` (no options; defaults to “Sin resultados”, meaning no results) and `loading` (while an async search loads).

**Types.** `meeko check` and the editor infer the option type (`T`) and whether it is multiple from the tag: a single select's model is a `Signal<T | null>` and a multiple select's is `Signal<T[]>`; `by`, `labelBy` and `groupBy` only accept keys of `T`, and snippet parameters have type `T`. The `SelectModel<T, Multiple>` type describes the value.

**ARIA and keyboard.** The trigger is a `role="combobox"` (a `<button>` or, with `searchable`, an `<input>` with `aria-autocomplete="list"`) with `aria-expanded`, `aria-controls`, `aria-haspopup="listbox"` and `aria-activedescendant`: focus never leaves it. The list is a `role="listbox"` (with `aria-multiselectable` in a multiple select) of `role="option"` elements with `aria-selected` and `aria-disabled`, grouped in `role="group"` with `groupBy`. An external `<label for>` names the trigger by its `id`.

- `↓`, `↑`, `Enter` or `Space` open the list at the selected option (or the first); `Home` and `End` open at an end; letters open and search.
- With the list open, arrows, `Home`, `End`, `PageUp` and `PageDown` move the active option (without wrapping, skipping disabled options) and scroll it into view; letters search by the start of the label, ignoring accents.
- `Enter` selects the active option; so does `Space`, except with `searchable`, where it types a space. In a single select, selection closes the list; in a multiple select, it toggles the option and the list stays open. `Alt+↑` selects and closes.
- `Esc` closes without changing the value and `Tab` closes. Clicking outside or moving focus outside also closes.
- With the mouse, clicking an option selects it; hovering activates it. Clicking the list does not remove focus from the trigger.

With `max`, as soon as `max` options are selected, the others become `aria-disabled="true"` and `data-disabled` until one is removed.

**State attributes.** Options carry `data-active`, `data-selected` and `data-disabled`, and the root (`data-meeko-select`) carries `data-open`, `data-multiple`, `data-disabled` and `data-loading`. The list is at least as wide as the trigger (`anchor-size(width)` or, without anchor positioning, the calculated width), has a maximum height and scrolls; both rules are in the `meeko` layer, so your CSS overrides them:

```css
[data-meeko-select] [role='option'][data-active] {
	background: var(--hover);
}
[data-meeko-select] [role='option'][data-selected]::after {
	content: ' ✓';
}
[data-meeko-select] [data-meeko-popover] {
	max-height: 16rem;
}
```

**Search.** With `searchable`, typing filters options whose label contains the text, ignoring case and accents (“amb” finds “Ámbar”). `filter(query, { options, signal })` replaces that filter: it returns displayed options or a promise of them for server-side search. While the promise is unresolved, the root carries `data-loading`, the list `aria-busy="true"` and the `loading` snippet is shown; a new search aborts the previous one (`signal`) and discards its response. With an empty search, `options` are shown without calling `filter`, so search never executes on the server.

```html
<script lang="ts">
	interface City {
		code: string
		name: string
	}
	const city = signal<City | null>(null)
	const search = (query: string, { signal }: { signal: AbortSignal }): Promise<City[]> => fetch(`/api/cities?q=${encodeURIComponent(query)}`, { signal }).then((response) => response.json())
</script>
<template>
	<MeekoSelect
		model="city"
		bind:options="[]"
		by="code"
		searchable
		bind:filter="search"
		placeholder="Busca una ciudad"
	>
		<snippet name="loading">Buscando…</snippet>
		<snippet name="empty">Ninguna ciudad con ese nombre</snippet>
	</MeekoSelect>
</template>
```

**Forms.** With `name`, the select submits an `<input type="hidden">` per value (one empty in a single select without a value, none in an empty multiple select), like a native `<select>`; with `disabled`, it submits nothing. Each option's value is its `by` key, the primitive itself or its label. `required` prevents submitting the `<form>` without a value: the trigger receives focus and `aria-invalid="true"` until an option is selected. With `useForm`, `model="form.fields.color"` works like on any control, and `bind:field="form.field('color')"` also provides the value, field `id` (for its `<label for>`), `name`, `aria-invalid` and `aria-describedby` with the error message; `focusInvalid` focuses the select when validation fails. A field's initial value `""` counts as “no value” (unless an option is `""`).

```html
<form
	on:submit="form.submit"
	novalidate
>
	<label bind:for="form.field('country').id">País</label>
	<MeekoSelect
		bind:field="form.field('country')"
		bind:options="countries"
		placeholder="Elige un país"
	/>
	<p
		if:when="form.errors.value.country"
		bind:id="form.field('country').errorId"
	>
		{form.errors.value.country}
	</p>
	<button>Guardar</button>
</form>
```

**Long lists.** `<MeekoSelect>` renders every option (also in server HTML). For thousands of options, use `searchable` with a `filter` returning only the first matches; a virtual list rendering only visible options (`virtual`) is not available in `1.5`.

**Native alternative.** For a simple case, without search or options with custom content, a native `<select>` with `model` remains the lightest choice. In supporting browsers, `appearance: base-select` lets you fully style it while retaining the browser's keyboard behavior, accessibility and form submission:

```css
select,
::picker(select) {
	appearance: base-select;
}
```

## Tools

`meeko check archivo.meeko` checks syntax and types; `--json` delivers structured diagnostics. `meeko compile entrada.meeko salida.ts` generates the typed module and does not write a file if there are errors. `meeko types archivo.meeko` emits `Archivo.d.meeko.ts` declarations for that component and imported children under `.meeko/types/`, mirroring their project-relative path; it does not write declarations alongside sources. In a framework application, generation records its outputs in `.meeko/manifests/component-types.json` and removes only managed declarations whose component no longer exists. The first run after upgrading recognizes only orphaned generated declarations from older versions through the AST, while preserving unrelated files and regenerating current components. To resolve those imports with precise props, TypeScript needs `allowArbitraryExtensions` and `rootDirs` overlaying the source tree with `.meeko/types/`. `meeko init` writes that configuration; a manually configured consumer must incorporate it. The `@meekojs/meeko/vite` plugin compiles `.meeko` imports in the client and SSR and adds HMR and CSS during development. `meeko lsp --stdio` (also available as the `meeko-language-server` binary) starts the language server used by the [VS Code extension](../../packages/vscode/README.md) and [other editors](editors.md) to offer the same checks in the editor.

`@meekojs/meeko/prettier` is the Prettier plugin for `.meeko`. With `{ "plugins": ["@meekojs/meeko/prettier"] }` in Prettier configuration, `prettier --write "**/*.meeko"` formats script, `<script server>`, template and style; the `meekoIndentSections` option (default `false`) indents all section content by one level, and `meekoPreserveArrayBreaks` (default `true`) keeps an array with a newline after `[` expanded throughout all JavaScript and TypeScript Prettier formats, like `objectWrap: "preserve"` for objects. The language server uses the same plugin, so the editor and CI agree (see [editors](editors.md#formatting-with-prettier)).

## Compatibility and limits

- Node.js 24 or later and TypeScript 7.0.2 for the CLI, build, Vite and language server. Supported runtimes and browsers are listed in the [stability policy](stability.md#supported-environments).
- The public API follows SemVer during the 1.x series: breaking changes require a major version and deprecations are announced in a minor (see the [stability policy](stability.md)). The package is distributed as `@meekojs/meeko` under the MIT license.
- The parser accepts the TypeScript and HTML subset described above; it reports unsupported constructs through diagnostics.
- Hydration requires server and browser to obtain the same initial values and list order.
- No compatibility guarantees are provided for Vue plugins. Streaming SSR (`render: "stream"` with `defer` from `@meekojs/meeko/framework`) is described in [framework.md](framework.md).

## Package verification

`pnpm run package:smoke` installs the tarball in a consumer outside the monorepo and checks the CLI, SSR, types and Vite. `tests/package-boundaries.test.ts` fixes the exact list of root exports. The VS Code extension is packaged and tested in an isolated host with an external consumer project. The steps for each publication are in [releasing.md](releasing.md).
