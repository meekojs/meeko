---
title: defineModel
group: macros
since: 1.1.0
description: Declares a component model, a writable signal shared by the parent through model or model:nombre, or passed as a prop and an event, with an optional default value.
symbols:
  - "syntax:definemodel"
related:
  - "syntax:model"
  - "syntax:defineprops"
  - "syntax:defineemits"
  - "@meekojs/meeko#Signal"
  - "@meekojs/meeko/framework#useForm"
  - docs/api.md#modelos-de-componente-definemodel-y-model
source-hash: 62b423ecfa48547e291f3f88b64ab90a227fb8bfa179bbc00ecc8d5de1dde0d7
---

`defineModel<T>()` declares a value shared bidirectionally between the parent and component, and returns a writable `Signal<T>`. The parent passes its signal with `model="señal"` (the default model) or `model:nombre="señal"`; reading and writing in the child reads and writes the parent's signal. It is a compiler macro: you do not import it.

Use it to write your own form field, toggle or dialog with `open` without writing a prop + event pair by hand. Since `1.8` the parent can also use that pair, with no change in the child: `bind:modelValue` and `on:update:modelValue`. See [By prop and event](#by-prop-and-event).

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

- Without `default`, the model is required: the parent passes `model` or `bind:modelValue`. Omitting both is a type error and, at runtime, a `TypeError`; `on:update:modelValue` alone is not enough.
- The child always receives a `Signal<T>` and does not know which form the parent used. The signal goes in `ComponentModels`; the prop and the event, in `ComponentProps`, and `<Name>Props` and `<Name>Emits` know them.

## By prop and event

Since `1.8`, a component with `defineModel` accepts the value as a prop, also inside `bind="object"`, and its change as an event. The unnamed model is called `modelValue`; a named one goes by that name:

```html
<AppInput model="name" />
<AppInput bind:modelValue="name.value" on:update:modelValue="(next) => (name.value = next)" />
<AppInput bind:modelValue="'hola'" />
<AppInput bind="option.props" />
<!-- option.props = { modelValue: "hola", placeholder: "…" } -->
<AppInput model="name" bind:touched="touched.value" on:update:touched="(next) => (touched.value = next)" />
```

| The parent passes                            | The child's value                   | When the child writes                                                                     |
| -------------------------------------------- | ----------------------------------- | ----------------------------------------------------------------------------------------- |
| `model="signal"`                             | The parent's signal                 | Writes that signal                                                                        |
| `bind:modelValue` and `on:update:modelValue` | Follows the prop                    | Calls the event; the value only changes if the parent changes the prop, else it goes back |
| Only `bind:modelValue`, or inside `bind`     | Initial value, and follows the prop | Stays in the child until the prop changes                                                 |
| Only `on:update:modelValue`                  | `default`, in a local signal        | Stays in the child and calls the event                                                    |
| Nothing                                      | `default`, in a local signal        | Stays in the child                                                                        |

- **An `undefined` prop.** An `undefined` prop takes the `default`, as in `defineProps`; with `bind:modelValue` and the event written, the parent still decides each write.
- **Writing the same value** does not call the event.
- **SSR.** The HTML carries the value of the prop, and the signal that follows it does not travel in the child's state: the parent already has it. HMR does not keep it either, nor does rebuilding a child with a data `await`: a local write from the third row then goes back to the value of the prop.
- **`model` and the prop together** are `MEEK066`. With `model`, the child writes the signal and would never emit the event: to observe changes, use an `effect` on the signal. At runtime, if a `bind="object"` brings `modelValue` next to `model`, `model` wins.
- **`bind:default` and `on:update:default` do not exist:** `default` is the internal name of the unnamed model.
- **The prop and the event belong to the model.** They do not appear in `Object.keys(props)` or `...rest`, so `bind="rest"` does not carry them to an element. Also declaring them in `defineProps` or `defineEmits` is `MEEK063`, except through an imported type: a wrapper can use `defineProps<UIInputProps>()` and declare its own model.
- **The event does not go in a `bind`:** `onUpdate:modelValue` is an `on*` key (`MEEK113`). Write `on:update:modelValue`.

### A parent that saves with `await`

If the handler of `on:update:modelValue` returns a promise, what was written stays while it is pending: no text is lost and the caret does not jump. Each new write calls the handler again.

```html good
<AppInput bind:modelValue="name.value" on:update:modelValue="async (next) => { await save(next); name.value = next; }" />
```

- **When the last write ends,** the child follows the prop again. If the parent did not change it, the control goes back to its value.
- **If it rejects,** the same happens, and the error reaches the application's error handler (`provideErrorHandler`) instead of staying as an uncaught rejection.
- **If the prop changes while a write is pending,** what was written stays until that write ends, and then the prop decides. It is not applied earlier because the child cannot tell that change from the save of an earlier write, which would erase what was written afterwards.
- **If an earlier write ends after the last one,** the child keeps the value. The parent's signal does take what its code writes, so if order matters, the parent must discard old responses.
- **On unmount,** a pending write no longer changes the model. If it rejects then, the error only goes to the console: its component is gone.

A synchronous handler does not change: the control goes back to the prop as soon as it ends, if the parent did not update it.

### Coming from Vue

`defineModel` behaves like Vue's with `bind:modelValue` and `on:update:modelValue`, which correspond to `:modelValue` and `@update:modelValue`. `model="signal"` corresponds to `v-model`, with one difference: it receives the signal, not its value, so you write `model="name"` and not `model="name.value"`, and the child writes it directly instead of emitting. That is why `model` does not combine with `on:update:modelValue`, which Vue does allow next to `v-model`. Another difference: if a synchronous handler does not accept the value, the control goes back to the prop's, also on an `<input>`. A parent with `await` works as in Vue: the `<input>` keeps what was written while it saves. Besides, here `value.value` also gives what was written during that time and the caret does not jump when it ends.

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

`meeko check` and the editor report `TS2741: Falta el modelo obligatorio de este componente: pásalo con model="señal" o bind:modelValue="valor"`. Pass the signal or the value, or make the model optional with `defineModel<string>({ default: "" })`. A value that admits `undefined` is not enough for a required model.

```html good
<AppInput label="Name" model="name" />
<AppInput label="Name" bind:modelValue="name.value" />
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

### An undeclared model, or one passed both ways

```html bad
<AppInput label="Name" model="name" model:opened="open" />
<AppInput label="Name" model="name" model:touched="touched" bind:touched="touched.value" />
```

`meeko check` reports `TS2353: Object literal may only specify known properties, and '"opened"' does not exist in type 'ComponentModels'.` and `MEEK066: model:touched y bind:touched pasan los dos el modelo touched; deja model:touched, que comparte la señal, o bind:touched, que pasa el valor`.

```html good
<AppInput label="Name" model="name" model:touched="touched" />
```

### Also declaring its prop

```html bad
<script lang="ts">
const props = defineProps<{ modelValue: string }>();
const value = defineModel<string>();
</script>
```

`MEEK063: modelValue ya es de defineModel<T>(): el padre pasa bind:modelValue y on:update:modelValue, y el hijo lee y escribe el modelo; quítalo de defineProps`.

```html good
<script lang="ts">
const value = defineModel<string>();
</script>
```

## Notes

- **State and SSR.** The parent's signal belongs to the parent: it is not part of the state the child transfers in SSR or preserves through HMR. SSR reads its value and hydration connects the same signal. A local signal created with `default` is child state; one that follows a prop is not.
- **Changing signals.** If the parent passes another signal in a `model`, the child remounts, preserving its editable signals by name.
- **Placement.** In its own top-level `const` declaration with a simple name, once per model name (`MEEK063`), before the first browser `await` (`MEEK058`).
- **Reading a prop in `default`.** `defineModel<string>({ default: props.initial ?? "" })` reads the prop once on purpose, so it does not give `MEEK101`.
- **Forms.** Inside the child, bind the model to a control with `model="value"`; the parent does not need to listen for any events.
