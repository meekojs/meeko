---
title: model
group: syntax
since: 1.1.0
description: Creates a two-way binding between a form control or component model and a writable signal.
symbols:
  - "syntax:model"
related:
  - docs/como-elegir.md
  - "syntax:definemodel"
  - "syntax:bind"
  - "syntax:on"
  - "@meekojs/meeko#signal"
  - "@meekojs/meeko/framework#useForm"
  - docs/api.md#controles-de-formulario-con-model
  - docs/api.md#modelos-de-componente-definemodel-y-model
source-hash: 1f5c51ea1ed6bd1ea2b453e182b1d0a53458ab92634ce14f06c74a4d8f943a3d
---

`model="señal"` binds a form control to a signal in both directions: the control displays the signal's value and every user edit writes to it. It replaces the `bind:value` + `on:input` pair.

On a component tag, `model` passes the signal for the child's default model, and `model:nombre` passes that of a named model; the child declares them with `defineModel`.

## Usage

```html
<!-- app/components/SignupForm.meeko -->
<script lang="ts">
const email = signal("");
const accepted = signal(false);
const plan = signal<string | null>("free");
</script>

<template>
  <label>Email <input type="email" model="email"></label>
  <label><input type="checkbox" model="accepted"> I accept the terms</label>
  <label><input type="radio" value="free" model="plan"> Free</label>
  <label><input type="radio" value="pro" model="plan"> Pro</label>
  <p>{email.value} · {accepted.value ? "accepted" : "pending"} · {plan.value}</p>
</template>
```

## Attributes

| Control                                                                         | Property and event                                                   | Signal type                                                                                                                             |
| ------------------------------------------------------------------------------- | -------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------- |
| Text `<input>` (any `type` except those below, or `bind:type`) and `<textarea>` | `value`, on `input`                                                  | `Signal<string>`                                                                                                                        |
| `<input type="range">` (since `1.8`)                                            | `value`, on `input`                                                  | `Signal<number>`, which gets numbers, or `Signal<string>`                                                                               |
| `<input type="checkbox">`                                                       | `checked`, on `change`                                               | `Signal<boolean>` or, since `1.7.1`, `Signal<boolean \| undefined>`: `undefined` renders unchecked and `change` always writes a boolean |
| `<input type="radio">`                                                          | checked if the signal equals its `value`; `change` writes that value | `Signal<string \| null \| undefined>`                                                                                                   |
| `<select>`                                                                      | `value`, on `change`                                                 | `Signal<string>`                                                                                                                        |
| `<select multiple>`                                                             | selected options, on `change`                                        | `Signal<string[]>`                                                                                                                      |
| Component tag: `model`                                                          | child's default model                                                | `Signal<T>` from its `defineModel<T>()`                                                                                                 |
| Component tag: `model:nombre`                                                   | child's `nombre` model                                               | `Signal<T>` from its `defineModel<T>("nombre")`                                                                                         |

The expression must be a **writable signal**: not its `.value` or a `computed`.

## Result

- **SSR.** HTML includes the signal value: `value` on an `<input>`, `checked` on a checkbox or radio, `<textarea>` content and `selected` on each `<option>`. A checkbox whose signal is `undefined` has no `checked`.
- **Browser.** Assigning the signal from code updates the control's live property; each user edit writes to the signal.
- **Before hydration.** If the user types before the page hydrates (or the browser restores a value on back navigation), the input is preserved and copied to the signal when hydration ends, before `onMounted` callbacks.
- **Component.** The child receives the same signal: reading and writing in the child reads and writes the parent's signal.

## Examples

### A `<select>` and a `<select multiple>`

```html
<script lang="ts">
const country = signal("es");
const tags = signal<string[]>([]);
</script>

<template>
  <select model="country" aria-label="Country">
    <option value="es">Spain</option>
    <option value="mx">Mexico</option>
  </select>
  <select multiple model="tags" aria-label="Etiquetas">
    <option value="urgente">Urgent</option>
    <option value="cliente">Client</option>
  </select>
  <p>{country.value}: {tags.value.join(", ")}</p>
</template>
```

### A number stored as text

An `<input type="number">` also provides text. Store text in the signal and convert it where you use it:

```html
<script lang="ts">
const quantity = signal("1");
const total = computed(() => {
  const value = Number(quantity.value);
  return Number.isFinite(value) ? value * 3.5 : 0;
});
</script>

<template>
  <label>Quantity <input type="number" min="1" model="quantity"></label>
  <p>Total: {total.value.toFixed(2)} €</p>
</template>
```

An `<input type="range">` always has a number: since `1.8`, a signal that holds a number receives it as a number, with no conversion.

### Show the password with `bind:type`

Since `1.2`, `model` supports `bind:type` and always treats the control as text:

```html
<script lang="ts">
const password = signal("");
const revealed = signal(false);
</script>

<template>
  <input bind:type="revealed.value ? 'text' : 'password'" model="password" autocomplete="current-password" aria-label="Password">
  <button type="button" bind:aria-pressed="revealed.value ? 'true' : 'false'" on:click="() => revealed.value = !revealed.value">Show</button>
</template>
```

### Component models

The child declares models with `defineModel`; the parent passes its signals with `model` and `model:nombre`:

```html
<!-- app/components/AppSearch.meeko -->
<script lang="ts">
const query = defineModel<string>();
const open = defineModel<boolean>("open", { default: false });
</script>

<template>
  <input type="search" model="query" aria-label="Search" on:focus="() => open.value = true">
</template>
```

```html
<AppSearch model="search" model:open="panelOpen" />
```

### `useForm` fields

`form.fields.x` are writable signals, so they go directly in `model`:

```html
<script lang="ts">
const form = useForm({ initial: { name: "", newsletter: false }, submit: async (values) => values });
</script>

<template>
  <form on:submit="form.submit">
    <input model="form.fields.name" aria-label="Name">
    <label><input type="checkbox" model="form.fields.newsletter"> Newsletter</label>
  </form>
</template>
```

## Common mistakes

### Pass `.value`

```html bad
<input model="name.value">
```

`meeko check` reports `TS2322: Type 'string' is not assignable to type '{ value: string; }'`, and at runtime the binding throws `TypeError: Meeko model expects a writable signal, not a computed signal or a plain value`.

```html good
<input model="name">
```

### A `computed`

A `computed` cannot be written.

```html bad
<input model="upper">
```

With `const upper = computed(() => name.value.toUpperCase())`, `meeko check` reports `TS2345: Argument of type 'ReadonlySignal<string>' is not assignable to parameter of type 'ReadonlySignal<string> & { readonly "a model needs a writable signal; computed and readonly signals cannot be written": never; }'.`

```html good
<input model="name">
<p>{upper.value}</p>
```

### A signal of the wrong type

```html bad
<input type="number" model="age">
<input type="checkbox" model="accepted">
```

With `signal(0)` and `signal("no")`, `meeko check` reports `TS2322: Type 'Signal<number>' is not assignable to type '{ value: string; }'` and `TS2322: Type 'Signal<string>' is not assignable to type '{ value: boolean | undefined; }'`.

```html good
<input type="number" model="ageText">
<input type="checkbox" model="accepted">
```

With `const ageText = signal("0")` and `const accepted = signal(false)`.

### `model` alongside the event it already listens to

```html bad
<input model="query" on:input="search">
```

`MEEK065: model asigna value y escucha input; quita on:input`. To react to changes, use an `effect` or `computed` on the signal, or another event such as `on:change`.

```html good
<input model="query" on:change="search">
```

### `model` on an element that is not a control

```html bad
<div model="name"></div>
```

`MEEK065: model se admite en <input>, <textarea> y <select>, no en <div>`. Other `MEEK065` cases: `<input type="file">` (`model no se admite en <input type="file">`), a radio without `value` (`Un radio con model necesita value="..." o bind:value="expression"`) and a `<textarea model>` with content.

```html good
<textarea model="name"></textarea>
```

### `model:x` and `bind:x` on a component

```html bad
<AppSearch model="search" model:open="panelOpen" bind:open="panelOpen.value" />
```

`MEEK066: model:open y bind:open pasan los dos el modelo open; deja model:open, que comparte la señal, o bind:open, que pasa el valor`. The same goes for `on:update:open` next to `model:open`: with `model:open` the child writes the signal and does not emit the event.

```html good
<AppSearch model="search" model:open="panelOpen" />
```

## Notes

- **Hydration.** `model` does not break hydration when the user types early: `if:`, `each:` and `<render>` regions reading the signal hydrate with its SSR value and then react to the restored value.
- **Numbers and dates.** Controls provide text. Store text in the signal and convert it where used, or let the `useForm` schema do it (`v.transform(Number)`).
- **Component state.** A top-level script signal travels in SSR state and is restored during hydration; a signal passed by the parent through `model` belongs to the parent and is not part of the child's state.
- **Prop and event.** Since `1.8`, a component also accepts its model with `bind:modelValue` and `on:update:modelValue`. `<input model="value">` inside the child works the same with either form. See [`defineModel`](../macros/definemodel.md#by-prop-and-event). On a native control, `model` does not change.
- **Custom elements.** On a hyphenated tag (`<my-input model="query">`), `model` is a literal HTML attribute, not the directive.
- **Accessibility.** `model` does not name the control: wrap it in a `<label>` or use `aria-label`.
