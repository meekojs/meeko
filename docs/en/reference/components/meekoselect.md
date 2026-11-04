---
title: <MeekoSelect>
group: components
since: 1.5.0
description: Unstyled accessible select built on MeekoPopover, with options of any type, multiple selection, search, groups and form submission.
symbols:
  - 'syntax:meekoselect'
types:
  - '@meekojs/meeko/framework#MeekoSelectProps'
  - '@meekojs/meeko/framework#SelectModel'
  - '@meekojs/meeko/framework#SelectSnippets'
related:
  - 'syntax:meekopopover'
  - '@meekojs/meeko/framework#useForm'
  - 'syntax:model'
  - '@meekojs/meeko#useId'
  - docs/api.md#select-meekoselect
  - docs/api.md#componentes-integrados
source-hash: ad27b9291eade1094fd56db034cb1301823fac0195f1cef7f46d7835264537d6
---

> **Deprecated since 1.8; removed in 2.0.** `<MeekoSelect>` still works in 1.x and emits `MEEK121`. Use `<UICombobox>` from `@meekojs/ui` 0.2 with its module active, which keeps props, snippets and `data-meeko-*` markup, or `<UISelect>`, a native `<select>`, if you do not need `multiple`, `searchable`, `filter` or `max`. See [Migrating to 1.8](../../migration-1.8.md).

A native `<select>` does not support options with custom content, search or styled groups. `<MeekoSelect>` is a select built on [`<MeekoPopover>`](/en/docs/reference/meekopopover) using the ARIA _combobox_ and _listbox_ pattern: focus stays on the trigger and `aria-activedescendant` marks the active option. `model` is the value and its type comes from `options`, which can be primitives or objects.

It has no visual styles: options have `data-active`, `data-selected` and `data-disabled`, and the root has `data-open`. Do not import it; only components using it load its code.

## Usage

```html
<!-- app/components/AssigneePicker.meeko -->
<script lang="ts">
	interface User {
		id: number
		name: string
		team: string
	}
	const props = defineProps<{ users: User[] }>()
	const assignee = signal<User | null>(null)
</script>

<template>
	<label for="assignee">Assignee</label>
	<MeekoSelect
		id="assignee"
		model="assignee"
		bind:options="props.users"
		by="id"
		placeholder="Elige a alguien"
	>
		<snippet
			name="option"
			params="user, state"
		>
			{user.name}
			<span if:when="state.selected">✓</span>
		</snippet>
	</MeekoSelect>
</template>
```

`by="id"` compares options with the value by `id`; `meeko check` only accepts `User` keys.

## Props

| Attribute                                        | Type                                                  | Default                                           | Description                                                                            |
| ------------------------------------------------ | ----------------------------------------------------- | ------------------------------------------------- | -------------------------------------------------------------------------------------- |
| `bind:options`                                   | `readonly T[]`                                        | required                                          | Options. Reactive: a new list updates the open list.                                   |
| `model`                                          | `Signal<T \| null>`, or `Signal<T[]>` with `multiple` | none                                              | Selected value.                                                                        |
| `multiple`                                       | `boolean`                                             | `false`                                           | The model is an array and each option toggles.                                         |
| `by`                                             | a key of `T` or `(a, b) => boolean`                   | `Object.is`                                       | How an option is compared with the value.                                              |
| `labelBy`, `disabledBy`, `groupBy`               | a key of `T` or function                              | text, `label`/`name`; `disabled: true`; no groups | Each option's label, disabled state and group.                                         |
| `placeholder`                                    | `string`                                              | none                                              | Text when no value is selected.                                                        |
| `name`                                           | `string`                                              | none                                              | `name` of `<input type="hidden">` elements submitted with the `<form>`.                |
| `required`, `disabled`                           | `boolean`                                             | `false`                                           | As in a native control.                                                                |
| `searchable`                                     | `boolean`                                             | `false`                                           | The trigger is an `<input>` filtering options without case or accent sensitivity.      |
| `bind:filter`                                    | `(query, { options, signal }) => T[] \| Promise<T[]>` | label filter                                      | Custom search, including asynchronous search.                                          |
| `bind:max`                                       | `number`                                              | unlimited                                         | With `multiple`, how many options can be selected.                                     |
| `bind:field`                                     | `useForm`'s `form.field('x')`                         | none                                              | Provides the field's value, `id`, `name`, `aria-invalid` and `aria-describedby`.       |
| `id`, `label`, `describedBy`, `invalid`          |                                                       |                                                   | Trigger `id` (for `<label for>`), `aria-label`, `aria-describedby` and `aria-invalid`. |
| `class`, `listClass`, `placement`, `bind:offset` |                                                       |                                                   | Root and list classes, and list position.                                              |
| `on:change`                                      | `(value) => void`                                     | none                                              | Emitted for each user selection.                                                       |

Snippets: `option` (`[option, state]`, with `state.selected`, `state.active` and `state.disabled`), `value` (how each selected value appears in the trigger), `group` (a group heading), `empty` (no options; defaults to “Sin resultados”) and `loading` (while an asynchronous search loads).

## Result

- The root, with `data-meeko-select` and `data-open`, `data-multiple`, `data-disabled` and `data-loading`.
- The trigger: a `role="combobox"` (a `<button>` or, with `searchable`, an `<input>` with `aria-autocomplete="list"`) with `aria-expanded`, `aria-controls`, `aria-haspopup="listbox"` and `aria-activedescendant`.
- The list: a `role="listbox"` (with `aria-multiselectable` for multiple selection) of `role="option"` elements with `aria-selected` and `aria-disabled`, grouped in `role="group"` with `groupBy`.
- With `name`, one `<input type="hidden">` per value (one empty input for a single select without a value). Each option's value is its `by` key, primitive or label.

Server HTML includes all options and the selected value in the trigger.

## Examples

### Multiple selection with search and groups

```html
<script lang="ts">
	interface Tag {
		slug: string
		name: string
		category: string
	}
	const props = defineProps<{ tags: Tag[] }>()
	const chosen = signal<Tag[]>([])
</script>

<template>
	<MeekoSelect
		model="chosen"
		multiple
		searchable
		bind:options="props.tags"
		by="slug"
		labelBy="name"
		groupBy="category"
		bind:max="3"
		name="tags"
		label="Etiquetas"
	/>
</template>
```

Once 3 are selected, other options have `aria-disabled="true"` and `data-disabled` until one is removed.

### Server search

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
		placeholder="Search for a city"
	>
		<snippet name="loading">Searching…</snippet>
		<snippet name="empty">No city with that name</snippet>
	</MeekoSelect>
</template>
```

A new search aborts the previous one (`signal`) and discards its response. An empty search displays `options` without calling `filter`.

### In a `useForm` form

```html
<script lang="ts">
	const countries = ['Spain', 'Mexico', 'Argentina']
	const form = useForm({ initial: { country: '' }, submit: (values) => api.profile.put({ body: values }) })
</script>

<template>
	<form
		on:submit="form.submit"
		novalidate
	>
		<label bind:for="form.field('country').id">Country</label>
		<MeekoSelect
			bind:field="form.field('country')"
			bind:options="countries"
			placeholder="Choose a country"
		/>
		<p
			if:when="form.errors.value.country"
			bind:id="form.field('country').errorId"
		>
			{form.errors.value.country}
		</p>
		<button>Save</button>
	</form>
</template>
```

The initial `""` value counts as “no value”. With `focusInvalid`, focus goes to the select when validation fails.

### Styles

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

## Common mistakes

### A single-value model in a multiple select

```html bad
<script lang="ts">
	const tags = signal<string | null>(null)
</script>
<template>
	<MeekoSelect
		model="tags"
		multiple
		bind:options="['a', 'b']"
	/>
</template>
```

`meeko check` reports `TS2322: Type 'Signal<string | null>' is not assignable to type 'Signal<string[]>'`: with `multiple`, the model is an array.

```html good
<script lang="ts">
	const tags = signal<string[]>([])
</script>
<template>
	<MeekoSelect
		model="tags"
		multiple
		bind:options="['a', 'b']"
	/>
</template>
```

### A nonexistent `by` key

```html bad
<MeekoSelect
	model="user"
	bind:options="users.value"
	by="uuid"
/>
```

`meeko check` reports `TS2322: Type '"uuid"' is not assignable to type '"id" | "name" | ((a: User, b: User) => boolean) | undefined'`: `by`, `labelBy` and `groupBy` only accept option keys.

```html good
<MeekoSelect
	model="user"
	bind:options="users.value"
	by="id"
/>
```

### Thousands of options

```html bad
<MeekoSelect
	model="product"
	bind:options="allProducts"
/>
```

There is no error, but `<MeekoSelect>` renders all options, including in server HTML: with thousands, the page is heavy and keyboard interaction is slow. Use `searchable` with a `filter` returning only the first matches:

```html good
<MeekoSelect
	model="product"
	bind:options="[]"
	searchable
	bind:filter="searchProducts"
/>
```

## Notes

- **Native alternative.** For a simple case without search or custom option content, a `<select>` with `model` is lighter. In supporting browsers, `appearance: base-select` allows full styling.
- **Keyboard.** `↓`, `↑`, `Enter` or `Space` open on the selected option; arrows, `Home`, `End`, `PageUp` and `PageDown` move the active option without wrapping; letters search the beginning of the label. `Enter` selects; in a single select, selecting closes the list; `Alt+↑` selects and closes; `Esc` closes without changing the value.
- **Forms.** With `name`, the select submits values like a native `<select>`; with `disabled`, submits nothing. `required` prevents submitting the `<form>` without a value and marks the trigger with `aria-invalid="true"`.
- **SSR and hydration.** Trigger, list and option IDs come from `useId`. Search never runs on the server.
- **Custom name.** A project component named `MeekoSelect` takes priority over the tag, with warning `MEEK106`.
