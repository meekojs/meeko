---
source-hash: f691b56c33fdb407c88cec7ccef126e8a79b268a9aa15ec05e56379fc4de8430
---

# Built-in components

## Built-in components

Since `1.5`, Meeko includes two accessible components, `<MeekoPopover>` and `<MeekoSelect>`, as built-in tags: they are not imported and work the same in the standalone engine and framework. They have no visual styles; they expose state through `data-*` and ARIA attributes for the application to style.

- **Size.** Each tag is its own module (`@meekojs/meeko/builtins/popover` and `@meekojs/meeko/builtins/select`), imported by the compiler only in components using it. An application that does not write them does not load their code, and `<MeekoSelect>` brings `<MeekoPopover>` with it. These paths, like `@meekojs/meeko/internal`, are a contract between the compiler and its same-version runtime: do not import them manually.
- **SSR and hydration.** Server HTML includes the trigger (with the selected value in a select) and content hidden by its `popover` attribute, without flicker. IDs linking trigger, content and options come from [`useId`](language-reactivity.md#stable-ids-useid): they are the same on hydration.
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
		<snippet name="trigger">Options ▾</snippet>
		<button
			role="menuitem"
			on:click="rename"
		>
			Rename
		</button>
		<button
			role="menuitem"
			on:click="duplicate"
		>
			Duplicate
		</button>
		<button
			role="menuitem"
			on:click="remove"
		>
			Delete
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
	The code is on the back of the card.
</MeekoPopover>
```

**Position.** Content uses `position-anchor`, `position-area` and `position-try-fallbacks: flip-block, flip-inline`, so it moves to the other side if it does not fit. In a browser without anchor positioning, Meeko marks it with `data-meeko-popover-fallback` and calculates its position in JavaScript on opening and each `resize` or `scroll`: it also flips and never leaves the viewport, and the chosen side is stored in `data-side`. Open content carries `data-open`.

**Custom trigger.** The `anchor` snippet replaces the button: it receives in `trigger` (type `PopoverTrigger`) the attributes the trigger must carry, with each attribute's name as a key, so [`bind="trigger"`](component-attributes.md#bulk-attributes-with-bind) is enough. `<MeekoPopover>` finds the element by its `id` on mounting and adds keyboard behavior and anchoring:

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
				alt="My account"
			/>
		</button>
	</snippet>
	<a
		role="menuitem"
		href="/perfil"
	>
		Profile
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
		placeholder="Choose a color"
		name="color"
	/>

	<MeekoSelect
		model="user"
		bind:options="users.value"
		by="id"
		label="Assignee"
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
		placeholder="Search for a city"
	>
		<snippet name="loading">Searching…</snippet>
		<snippet name="empty">No city with that name</snippet>
	</MeekoSelect>
</template>
```

**Forms.** With `name`, the select submits an `<input type="hidden">` per value (one empty in a single select without a value, none in an empty multiple select), like a native `<select>`; with `disabled`, it submits nothing. Each option's value is its `by` key, the primitive itself or its label. `required` prevents submitting the `<form>` without a value: the trigger receives focus and `aria-invalid="true"` until an option is selected. With `useForm`, `model="form.fields.color"` works like on any control, and `bind:field="form.field('color')"` also provides the value, field `id` (for its `<label for>`), `name`, `aria-invalid` and `aria-describedby` with the error message; `focusInvalid` focuses the select when validation fails. A field's initial value `""` counts as “no value” (unless an option is `""`).

```html
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
```

**Long lists.** `<MeekoSelect>` renders every option (also in server HTML). For thousands of options, use `searchable` with a `filter` returning only the first matches; a virtual list rendering only visible options (`virtual`) is not available in `1.5`.

**Native alternative.** For a simple case, without search or options with custom content, a native `<select>` with `model` remains the lightest choice. In supporting browsers, `appearance: base-select` lets you fully style it while retaining the browser's keyboard behavior, accessibility and form submission:

```css
select,
::picker(select) {
	appearance: base-select;
}
```
