---
title: defineModel
group: macros
since: 1.1.0
description: Declares a component model, a writable signal shared by the parent through model or model:nombre, with an optional default value.
symbols:
  - "syntax:definemodel"
related:
  - "syntax:model"
  - "syntax:defineprops"
  - "syntax:defineemits"
  - "@meekojs/meeko#Signal"
  - "@meekojs/meeko/framework#useForm"
  - docs/api.md#modelos-de-componente-definemodel-y-model
source-hash: 9aade298be72a4521c0726fe394959159bf18eb3350b39a95d30a877a9cea2d7
---

`defineModel<T>()` declares a value shared bidirectionally between the parent and component, and returns a writable `Signal<T>`. The parent passes its signal with `model="señal"` (the default model) or `model:nombre="señal"`; reading and writing in the child reads and writes the parent's signal. It is a compiler macro: you do not import it.

Use it to write your own form field, toggle or dialog with `open` without a prop + event pair.

## Usage

```html
<!-- app/components/AppInput.meeko -->
<script lang="ts">
const props = defineProps<{ label: string }>();
const value = defineModel<string>();                              // required default model
const touched = defineModel<boolean>("touched", { default: false }); // optional named model
</script>

<template>
  <label>{props.label} <input model="value" on:blur="() => touched.value = true"></label>
</template>
```

```html
<!-- in the parent, with const name = signal("") and const nameTouched = signal(false) -->
<AppInput label="Name" model="name" model:touched="nameTouched" />
```

## Parameters

| Parameter           | Type             | Default     | Description                                                                                                                                            |
| ------------------- | ---------------- | ----------- | ------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `T` (type argument) | any type         | required    | The value's type. Without it, `MEEK064`.                                                                                                               |
| `name`              | string literal   | `"default"` | Model name, an identifier used by the parent in `model:nombre`. Must be a literal (`MEEK064`).                                                         |
| `options`           | `{ default: T }` | none        | `default` makes the model optional: if the parent does not pass it, the child uses a local signal with that value. Only accepts `default` (`MEEK064`). |

Valid forms are `defineModel<T>()`, `defineModel<T>({ default })`, `defineModel<T>("nombre")` and `defineModel<T>("nombre", { default })`.

## Return value

`Signal<T>`: the signal passed by the parent or, if not passed and there is a `default`, a local signal with that initial value.

- Without `default`, the model is required: omitting it in the parent is a type error and, at runtime, a `TypeError`.
- Models are not props: they do not appear in `ComponentProps`; the compiled module exports their type in `ComponentModels`.

## Examples

### A toggle with an optional default model

With `{ default }`, the component also works without `model`, with its own state:

```html
<!-- app/components/AppSwitch.meeko -->
<script lang="ts">
const props = defineProps<{ label: string }>();
const on = defineModel<boolean>({ default: false });
</script>

<template>
  <button type="button" role="switch" bind:aria-checked="on.value ? 'true' : 'false'" on:click="() => on.value = !on.value">{props.label}</button>
</template>
```

```html
<AppSwitch label="Notificaciones" model="notify" />
<AppSwitch label="Modo compacto" />
```

### A dialog with `open`

The parent opens the dialog and the child closes it by writing to the same signal:

```html
<!-- app/components/AppDialog.meeko -->
<script lang="ts">
const open = defineModel<boolean>("open");
const snippets = defineSnippets<{ default: [] }>();
</script>

<template>
  <div if:when="open.value" role="dialog" aria-modal="true">
    <render snippet="snippets.default" />
    <button type="button" on:click="() => open.value = false">Close</button>
  </div>
</template>
```

```html
<button type="button" on:click="() => dialogOpen.value = true">Open</button>
<AppDialog model:open="dialogOpen"><p>Are you sure?</p></AppDialog>
```

### A `useForm` field

`form.fields.x` is a writable signal, so it can be passed directly to the model:

```html
<script lang="ts">
const form = useForm({ initial: { name: "" }, submit: async (values) => values });
</script>

<template>
  <form on:submit="form.submit">
    <AppInput label="Name" model="form.fields.name" />
  </form>
</template>
```

## Common mistakes

### Options other than `default`

```html bad
<script lang="ts">
const value = defineModel<string>({ default: "", required: true });
</script>
```

`MEEK064: Las opciones de defineModel sólo admiten default: { default: value }`. A model is required when it has no `default`.

```html good
<script lang="ts">
const value = defineModel<string>();
</script>
```

### A computed name

```html bad
<script lang="ts">
const name = "open";
const open = defineModel<boolean>(name, { default: false });
</script>
```

`MEEK064: El nombre de modelo de defineModel debe ser un literal de texto, como defineModel<boolean>("open")`. Without a type argument, the error is `MEEK064: defineModel necesita un argumento de tipo, como defineModel<string>()`.

```html good
<script lang="ts">
const open = defineModel<boolean>("open", { default: false });
</script>
```

### Not passing a required model

```html bad
<AppInput label="Name" />
```

`meeko check` reports `TS2741: Property '"default"' is missing in type '{}' but required in type 'ComponentModels'.` Pass the signal, or make the model optional with `defineModel<string>({ default: "" })`.

```html good
<AppInput label="Name" model="name" />
```

### Passing a value or a `computed`

```html bad
<AppInput label="Name" model="name.value" />
<AppInput label="Name" model="upper" />
```

`meeko check` reports `TS2322: Type 'string' is not assignable to type 'Signal<string>'.` and, with `const upper = computed(…)`, `TS2345` with `"a model needs a writable signal; computed and readonly signals cannot be written"`. A signal of another type reports `TS2322: Type 'Signal<number>' is not assignable to type 'Signal<string>'.`

```html good
<AppInput label="Name" model="name" />
```

### An undeclared model, or one passed as a prop

```html bad
<AppInput label="Name" model="name" model:opened="open" />
<AppInput label="Name" model="name" model:touched="touched" bind:touched="touched.value" />
```

`meeko check` reports `TS2353: Object literal may only specify known properties, and '"opened"' does not exist in type 'ComponentModels'.` and `MEEK066: model:touched y bind:touched pasan los dos touched; un modelo no es una prop, deja sólo model:touched`.

```html good
<AppInput label="Name" model="name" model:touched="touched" />
```

## Notes

- **State and SSR.** The parent's signal belongs to the parent: it is not part of the state the child transfers in SSR or preserves through HMR. SSR reads its value and hydration connects the same signal. A local signal created with `default` is child state.
- **Changing signals.** If the parent passes another signal in a `model`, the child remounts, preserving its editable signals by name.
- **Placement.** In its own top-level `const` declaration with a simple name, once per model name (`MEEK063`), before the first browser `await` (`MEEK058`).
- **Forms.** Inside the child, bind the model to a control with `model="value"`; the parent does not need to listen for any events.
