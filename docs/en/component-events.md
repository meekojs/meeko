---
source-hash: 3fcb685c53245286345906e8c72297f3fcb7abd360ef34a02868c49ea20c5e7b
---

# Events, models and snippets

## Component events: `defineEmits` and `on:`

A component declares its events with the `defineEmits<T>()` macro, where each key of `T` is an event and its value is the argument tuple. It returns a typed `emit(evento, ...argumentos)` function:

```html
<!-- TodoItem.meeko -->
<script lang="ts">
	const props = defineProps<{ id: number; title: string }>()
	const emit = defineEmits<{ save: [id: number]; close: [] }>()
</script>
<template>
	<p>{props.title}</p>
	<button on:click="() => emit('save', props.id)">Save</button>
	<button on:click="() => emit('close')">Close</button>
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

## Component models: `defineModel` and `model`

Since `1.1`, a component uses the `defineModel<T>()` macro to declare a value the parent shares with it in both directions. It returns a writable `Signal<T>`:

```html
<!-- AppInput.meeko -->
<script lang="ts">
	const value = defineModel<string>() // default model
	const open = defineModel<boolean>('open', { default: false }) // optional named model
	// To make the default model optional: defineModel<string>({ default: "" })
</script>
<template>
	<input model="value" />
	<button on:click="() => open.value = !open.value">Options</button>
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
- **Required or optional.** A model without `default` is required: the parent passes `model` or `bind:modelValue`, and omitting both is a type error and throws a `TypeError` at runtime. With `{ default: valor }`, it is optional; if the parent does not pass it, the child uses a local signal with that initial value.
- **Optional default model.** Options go without a name for the default model: `defineModel<string>({ default: "" })` makes it optional, like `defineModel<string>("default", { default: "" })`, the same declaration with the name written out. With `defineModel<string>()`, however, a parent that does not pass `model` (for example, because the field receives a `FormField` in `bind:field`) produces `TS2741` (“Falta el modelo obligatorio de este componente: pásalo con model="señal" o bind:modelValue="valor"”). There is no ambiguity between the two forms: the name is always a text literal and options an object literal.
- **Writable signal.** The parent's expression must be a writable `Signal<T>`. A `computed`, read-only signal or plain value is a type error and a runtime `TypeError`.
- **The signal is not a prop.** The signal goes in `ComponentModels`. SSR reads its value and hydration connects the same signal.
- **Also by prop and event.** Since `1.8`, the parent can pass the value with `bind:modelValue` (`bind:name` on a named model), also inside `bind="object"`, and listen to `on:update:modelValue` (`on:update:name`). `ComponentProps`, `<Name>Props` and `<Name>Emits` know them, and `next` has the model's type.

| The parent passes                            | The child's value                   | When the child writes                                                                     |
| -------------------------------------------- | ----------------------------------- | ----------------------------------------------------------------------------------------- |
| `model="signal"`                             | The parent's signal                 | Writes that signal                                                                        |
| `bind:modelValue` and `on:update:modelValue` | Follows the prop                    | Calls the event; the value only changes if the parent changes the prop, else it goes back |
| Only `bind:modelValue`, or inside `bind`     | Initial value, and follows the prop | Stays in the child until the prop changes                                                 |
| Only `on:update:modelValue`                  | `default`, in a local signal        | Stays in the child and calls the event                                                    |
| Nothing                                      | `default`, in a local signal        | Stays in the child                                                                        |

If the handler returns a promise, what was written stays until the last one ends and its rejection reaches the error handler. With these forms the child still receives a `Signal<T>` and does not know which one the parent used. The server's HTML carries the value of the prop, which does not travel in the child's state. The prop and the event do not appear in `Object.keys(props)` or `...rest`. See [`defineModel`](reference/macros/definemodel.md#by-prop-and-event).

`defineModel` goes in its own top-level `const` declaration, with a simple name, and each model name appears once (`MEEK063`); its prop and its event are not also declared in the script (`MEEK063`). It receives a type argument, an optional name as a text literal and options accepting only `default` (`MEEK064`). In the parent, a model name that is not an identifier, the same model twice, a valueless `model` or `model:x` alongside `bind:x` or `on:update:x` produce `MEEK066`.

## Snippets with `defineSnippets`

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
	<snippet name="title">Confirm</snippet>
	<snippet
		name="actions"
		params="close"
	>
		<button on:click="close">Close</button>
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

  The condition is evaluated in the parent's scope (it cannot see the snippet's own `params`), identically on the server and on hydration, and is reactive: when it changes, the child stays mounted, with its DOM, state and focus, and only bindings reading `snippets.x` update (children without reactive props remount; see [Reactive props](component-basics.md#reactive-props)). While it remains true, the child retains the same snippet. As with props, a value copied from `snippets.x` by the child's setup (`const hasFooter = Boolean(snippets.footer)`) keeps the initial value: read it in the template or a `computed`. This only applies to a snippet the child declares optional (`x?:`): on a required one it is type error `MEEK110`. Like `if:when` on an element, it narrows types inside snippet content. It also applies to `<snippet name="default">`; loose content, which fills `default` without a tag, does not allow a condition.

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
  	// For Row, TypeScript cannot read a computed name: the child reads it through a view.
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

  <!-- In the parent: value is string, the type of User['email']. -->
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
