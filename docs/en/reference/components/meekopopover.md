---
title: <MeekoPopover>
group: components
since: 1.5.0
description: Accessible popover anchored to its trigger, using the native popover API and CSS anchor positioning, for menus, lightweight dialogs and tooltips.
symbols:
  - 'syntax:meekopopover'
types:
  - '@meekojs/meeko/framework#MeekoPopoverProps'
  - '@meekojs/meeko/framework#PopoverSnippets'
  - '@meekojs/meeko/framework#PopoverTrigger'
  - '@meekojs/meeko/framework#PopoverExposed'
related:
  - 'syntax:meekoselect'
  - 'syntax:meekoteleport'
  - '@meekojs/meeko#useId'
  - 'syntax:model'
  - docs/api.md#popover-meekopopover
  - docs/api.md#componentes-integrados
source-hash: c1ba856954bbe472cfda5bb2458361457640428f163ae93322a40ec4e27a3776
---

> **Deprecated since 1.8; removal in 2.0.** `<MeekoPopover>` still works in 1.x and emits `MEEK121`. Use `<UIPopover>` from `@meekojs/ui` 0.2 with its module enabled. It preserves props, snippets and `data-meeko-*` markup. See [Migration to 1.8](../../migration-1.8.md).

`<MeekoPopover>` renders a trigger `<button>` and content in the browser's _top layer_ (the `popover` attribute), positioned beside the trigger using _CSS anchor positioning_. It handles what is hard to implement correctly by hand: `aria-expanded`, `aria-controls` and `aria-haspopup`, `Esc` to close and restore focus, menu keyboard patterns, tooltips that do not steal focus, and positioning that flips when space is insufficient. In browsers without anchor positioning, a JavaScript calculation positions it and keeps it inside the window.

It has no visual styles: it exposes state through `data-*` and ARIA attributes. Do not import it; the compiler recognizes it and imports its module only in components that use it.

## Usage

```html
<!-- app/components/RowActions.meeko -->
<script lang="ts">
	const emit = defineEmits<{ rename: []; remove: [] }>()
</script>

<template>
	<MeekoPopover
		placement="bottom-end"
		bind:offset="4"
		role="menu"
	>
		<snippet name="trigger">Acciones ▾</snippet>
		<button
			role="menuitem"
			on:click="() => emit('rename')"
		>
			Renombrar
		</button>
		<button
			role="menuitem"
			on:click="() => emit('remove')"
		>
			Eliminar
		</button>
	</MeekoPopover>
</template>
```

With `role="menu"`, arrow keys move focus among `menuitem` elements, letters search for an item, and selecting one closes the menu and restores focus to the trigger.

## Props

| Attribute                       | Type                                                        | Default                        | Description                                                                                                                                                  |
| ------------------------------- | ----------------------------------------------------------- | ------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `mode`                          | `"auto" \| "manual" \| "hint"`                              | `"auto"`                       | `"auto"` closes on outside clicks and `Esc`; `"manual"`, only through the trigger, `Esc` or the model; `"hint"` is a tooltip opened by the pointer or focus. |
| `placement`                     | `top`, `bottom`, `left` or `right`, with `-start` or `-end` | `"bottom-start"`               | Side of the trigger and alignment with its edge.                                                                                                             |
| `bind:offset`                   | `number`                                                    | `0`                            | Distance from the trigger in pixels.                                                                                                                         |
| `role`                          | `"menu" \| "dialog" \| "tooltip"`                           | `"tooltip"` with `mode="hint"` | ARIA pattern for the content.                                                                                                                                |
| `label`                         | `string`                                                    | none                           | Content `aria-label`; without it, a menu or dialog is named by the trigger.                                                                                  |
| `class`, `triggerClass`         | `string`                                                    | none                           | Classes for the content and trigger `<button>`.                                                                                                              |
| `triggerId`                     | `string`                                                    | one from `useId`               | Trigger `id`; with a custom trigger, the `id` it carries.                                                                                                    |
| `matchWidth`                    | `boolean`                                                   | `false`                        | Content is at least as wide as the trigger.                                                                                                                  |
| `bind:delay`, `bind:closeDelay` | `number`                                                    | `300`, `150`                   | With `mode="hint"`, milliseconds before opening and closing with the pointer.                                                                                |
| `model`                         | `Signal<boolean>`                                           | none                           | Open state signal: assigning it opens or closes the popover, and user interaction updates it on opening or closing.                                          |
| `on:toggle`                     | `(event: { open: boolean }) => void`                        | none                           | Emitted on every open and close.                                                                                                                             |

Snippets: `trigger` (button content), unwrapped content (`default`) and `anchor`, which replaces the button with a custom trigger and receives its attributes in a `PopoverTrigger`. A `ref:` receives `show()`, `hide()` and `toggle()`.

## Result

- A `<button>` with `popovertarget`, `aria-expanded`, `aria-controls` and `aria-haspopup` (depending on `role`), containing the `trigger` snippet. With `popovertarget`, the button opens and closes the content even before hydration.
- Content inside an element with `popover` and `data-meeko-popover`, hidden from the server HTML onward. When open, it carries `data-open`; with JavaScript positioning, `data-meeko-popover-fallback` and `data-side` with the selected side.

## Examples

### A tooltip

```html
<label for="code">Código</label>
<input id="code" />
<MeekoPopover mode="hint">
	<snippet name="trigger">?</snippet>
	El código está en el reverso de la tarjeta.
</MeekoPopover>
```

It opens on pointer hover (after `delay`) or when focusing the `↑`, closes with `Esc` or on blur and never takes focus. The trigger has `aria-describedby` referencing the content, which has `role="tooltip"`.

### Opening from state

```html
<script lang="ts">
	const open = signal(false)
</script>

<template>
	<MeekoPopover
		model="open"
		role="dialog"
		label="Filtros"
		mode="manual"
		on:toggle="(event) => console.log(event.open)"
	>
		<snippet name="trigger">Filtros</snippet>
		<form>
			<label>
				<input type="checkbox" />
				Sólo activos
			</label>
		</form>
		<button
			type="button"
			on:click="() => open.value = false"
		>
			Aplicar
		</button>
	</MeekoPopover>
</template>
```

With `role="dialog"`, focus enters the first control on opening.

### A custom trigger

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
	<a
		role="menuitem"
		href="/salir"
	>
		Salir
	</a>
</MeekoPopover>
```

`bind="trigger"` sets `id`, `popovertarget`, `aria-controls`, `aria-expanded` and `aria-haspopup` on the button.

### Styles

```css
[data-meeko-popover] {
	border: 1px solid #ddd;
	border-radius: 0.5rem;
	background: Canvas;
	padding: 0.5rem;
}
[data-meeko-popover] [role='menuitem']:focus-visible {
	outline: 2px solid Highlight;
}
```

Meeko's anchoring rules are in the `meeko` cascade layer, so any application rule takes precedence.

## Common mistakes

### A `placement` that does not exist

```html bad
<MeekoPopover placement="bottom-left">
	<snippet name="trigger">Abrir</snippet>
	…
</MeekoPopover>
```

`meeko check` reports `TS2322: Type '"bottom-left"' is not assignable to type 'PopoverPlacement | undefined'`. Use `-start` or `-end`:

```html good
<MeekoPopover placement="bottom-start">
	<snippet name="trigger">Abrir</snippet>
	…
</MeekoPopover>
```

### An unsupported `role` or `mode`

```html bad
<MeekoPopover
	role="listbox"
	mode="click"
>
	<snippet name="trigger">A</snippet>
	…
</MeekoPopover>
```

`meeko check` reports `TS2322: Type '"listbox"' is not assignable to type 'PopoverRole | undefined'` and `TS2322: Type '"click"' is not assignable to type 'PopoverMode | undefined'`. For a list of options, use [`<MeekoSelect>`](/en/docs/reference/meekoselect).

```html good
<MeekoPopover
	role="menu"
	mode="auto"
>
	<snippet name="trigger">A</snippet>
	…
</MeekoPopover>
```

### A model that is not boolean

```html bad
<script lang="ts">
	const open = signal('no')
</script>
<template>
	<MeekoPopover model="open">
		<snippet name="trigger">Abrir</snippet>
		…
	</MeekoPopover>
</template>
```

`meeko check` reports `TS2322: Type 'Signal<string>' is not assignable to type 'Signal<boolean>'`.

```html good
<script lang="ts">
	const open = signal(false)
</script>
<template>
	<MeekoPopover model="open">
		<snippet name="trigger">Abrir</snippet>
		…
	</MeekoPopover>
</template>
```

### Menu items without `role="menuitem"`

```html bad
<MeekoPopover role="menu">
	<snippet name="trigger">Acciones</snippet>
	<button>Borrar</button>
</MeekoPopover>
```

There is no error, but Meeko does not change the content's role: without `role="menuitem"`, arrow keys do not find the item and screen readers do not announce a menu.

```html good
<MeekoPopover role="menu">
	<snippet name="trigger">Acciones</snippet>
	<button role="menuitem">Borrar</button>
</MeekoPopover>
```

## Notes

- **SSR and hydration.** HTML includes the trigger and content hidden by its `popover` attribute, without flicker. IDs linking the trigger and content come from `useId`: they are the same during hydration.
- **CSP.** Nothing goes in `style` attributes: anchoring uses a constructed stylesheet (`adoptedStyleSheets`), and each instance passes its values through CSSOM. A CSP without `'unsafe-inline'` is sufficient.
- **Size.** The `@meekojs/meeko/builtins/popover` module only loads in components using the tag. Do not import it manually: it is a contract between the compiler and its runtime of the same version.
- **Keyboard.** `Esc` closes and restores focus to the trigger; an outside click closes `mode="auto"` without moving focus. With `role="menu"`: `Enter`, `Space` or `↓` opens with focus on the first `menuitem` (`↑`, on the last), arrow keys move focus with wrapping, `Home` and `End` go to the ends, `Tab` closes, and items with `disabled` or `aria-disabled="true"` are skipped.
- **Custom name.** A project component called `MeekoPopover` takes precedence over the tag, with warning `MEEK106`.
