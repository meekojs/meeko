---
title: bind:nombre
group: syntax
since: 1.0.0
description: Sets an element attribute or component prop to an expression's value and updates it when its signals change.
symbols:
  - "syntax:bind"
related:
  - docs/como-elegir.md
  - "syntax:model"
  - "syntax:on"
  - "syntax:component-tag"
  - "syntax:interpolation"
  - "@meekojs/meeko#ElementAttributes"
  - docs/api.md#componentes-meeko
  - docs/api.md#atributos-en-bloque-con-bind
  - docs/api.md#props-estáticas
source-hash: 425c3d2bc6b6f50357cbdafc6d180acd49e1a56b32bf2a6102855e9110485fad
---

`bind:nombre="expresión"` sets attribute `nombre` to a TypeScript expression's value and keeps it up to date when the signals it reads change. On a component tag or `<component is>`, `bind:prop` passes a typed prop to the child.

An attribute without `bind:` is literal text: `title="{x}"` writes `{x}`. For a computed value, always use `bind:`.

## Usage

```html
<!-- app/components/SaveButton.meeko -->
<script lang="ts">
const saving = signal(false);
const count = signal(3);
</script>

<template>
  <button bind:disabled="saving.value" bind:title="`${count.value} changes`" bind:aria-busy="saving.value ? 'true' : null">
    Save
  </button>
</template>
```

With `saving.value` set to `false`, the button has neither `disabled` nor `aria-busy`; when it becomes `true`, Meeko adds both.

## Attributes

| Attribute                       | Type                              | Default | Description                                                                                                                                                                                                                        |
| ------------------------------- | --------------------------------- | ------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `bind:<atributo>` on an element | any value                         | none    | The attribute with `String(valor)`. `null`, `undefined` and `false` remove it. For HTML boolean attributes (`disabled`, `checked`, `hidden`, `required`, `open`…), any truthy value sets it to empty and a falsy value removes it. |
| `bind:<prop>` on a component    | the prop's type                   | none    | The child's prop, checked against its `defineProps`. An optional prop accepts `undefined`, equivalent to not passing it.                                                                                                           |
| `bind="objeto"`                 | `ElementAttributes<Tag>` or props | none    | Since `1.5`. Multiple attributes or props from an object. Explicit keys take precedence; `class` and `style` are merged.                                                                                                           |

## Result

- **Attributes.** In SSR, the attribute with its escaped value, or nothing if the value removes it. In the browser, `setAttribute` or `removeAttribute` on each change.
- **Control properties.** `bind:value` on `<input>`, `<textarea>` and `<select>`, `bind:checked` on `<input>` and `bind:selected` on `<option>` also update the element's property, because the browser stops reading the attribute once the user edits the control.
- **Props.** The child receives the new value without remounting: only bindings reading that prop update.

## Examples

### Computed classes and styles

`bind:class` takes the full class string. To combine fixed and conditional classes, construct the string:

```html
<script lang="ts">
const props = defineProps<{ active: boolean; size: "sm" | "lg" }>();
const classes = computed(() => ["chip", `chip--${props.size}`, props.active ? "chip--active" : ""].filter(Boolean).join(" "));
</script>

<template>
  <span bind:class="classes.value" bind:style="props.active ? 'outline: 2px solid currentColor' : null">Label</span>
</template>
```

### ARIA and `data-*` attributes

An attribute that must contain `"true"` or `"false"` as text (`aria-*` attributes are not HTML booleans) is written as text:

```html
<script lang="ts">
const open = signal(false);
</script>

<template>
  <button type="button" aria-controls="menu" bind:aria-expanded="open.value ? 'true' : 'false'" on:click="() => open.value = !open.value">Menu</button>
  <ul id="menu" bind:hidden="!open.value" bind:data-state="open.value ? 'open' : 'closed'">
    <li>Profile</li>
  </ul>
</template>
```

### Component props

`bind:` checks each prop against the child; an unprefixed attribute passes a static prop as a literal:

```html
<!-- app/components/AppBadge.meeko -->
<script lang="ts">
const props = defineProps<{ label: string; tone?: "info" | "danger"; count?: number }>({ tone: "info" });
</script>

<template><span bind:class="`badge badge--${props.tone}`">{props.label} <b if:when="props.count">{props.count}</b></span></template>
```

```html
<AppBadge label="Errores" tone="danger" bind:count="errors.value.length" />
<AppBadge bind:label="user.value.name" bind:count="unread.value > 0 ? unread.value : undefined" />
```

### Bulk attributes

Since `1.5`, `bind="objeto"` writes multiple keys at once, typed with `ElementAttributes`:

```html
<script lang="ts">
import type { ElementAttributes } from "@meekojs/meeko";

const props = defineProps<{ busy: boolean; id: string }>();
const attrs = computed((): ElementAttributes<"section"> => ({ id: props.id, "aria-busy": props.busy, hidden: false }));
</script>

<template><section class="panel" bind="attrs.value">…</section></template>
```

## Common mistakes

### Using braces in an attribute without `bind:`

```html bad
<img src="{photo.value.url}" alt="{photo.value.caption}">
```

This is not a compilation error: the attribute contains the literal text `{photo.value.url}`.

```html good
<img bind:src="photo.value.url" bind:alt="photo.value.caption">
```

### Passing the signal instead of its value

A signal is an object, and an object is truthy: `bind:disabled="saving"` always disables the button, without any error.

```html bad
<button bind:disabled="saving">Save</button>
```

```html good
<button bind:disabled="saving.value">Save</button>
```

### An object in `bind:class`

`bind:class` does not interpret objects or arrays like Vue: it writes `String(valor)`, that is, `class="[object Object]"`, without any error.

```html bad
<p bind:class="{ active: selected.value }">Option</p>
```

```html good
<p bind:class="selected.value ? 'active' : null">Option</p>
```

### An event handler as an attribute

```html bad
<button bind:onclick="() => save()">Save</button>
```

`MEEK012: Atributo dinámico no válido: onclick`. Events use `on:`.

```html good
<button on:click="save">Save</button>
```

### A prop passed statically and with `bind:` at the same time

```html bad
<AppBadge label="Errores" bind:label="title.value" />
```

`MEEK090: label y bind:label pasan los dos la prop label; deja sólo el texto estático o sólo bind:label`.

```html good
<AppBadge bind:label="title.value" />
```

### A prop the child does not declare, or with a different type

```html bad
<AppBadge label="Errores" bind:size="3" bind:count="'3'" />
```

`meeko check` reports `TS2353: Object literal may only specify known properties, and '"size"' does not exist in type …` and `TS2322: Type 'string' is not assignable to type 'number'.`

```html good
<AppBadge label="Errores" bind:count="3" />
```

## Notes

- **SSR and hydration.** The server writes the escaped attribute and hydration checks that the HTML value matches the browser's computed value; if it differs, it throws `Hydration mismatch` with the component and line. Compute browser-dependent values on the server, or change them in `onMounted`.
- **Security.** The value is always escaped, so it cannot close the attribute. A `bind:href` with a user-provided URL can be `javascript:…`: validate the scheme first. `on*` handlers are not allowed with `bind:` (`MEEK012`) or in `bind="obj"` (`MEEK113`).
- **`bind:html` and `bind:ref`.** They are not the `html` or `ref:` directives: on an element, `bind:html` writes an HTML attribute called `html`; on a component, `bind:ref` passes a prop called `ref`.
- **`select multiple`.** `bind:value` does not synchronize selection in a `<select multiple>`: use `model` with a `string[]` signal.
- **Unquoted values.** As in HTML, an expression without spaces can be written without quotes: `bind:disabled=saving.value`.
