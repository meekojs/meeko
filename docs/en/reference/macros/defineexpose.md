---
title: defineExpose
group: macros
since: 1.1.0
description: Exposes a component value, such as methods or signals, to the parent that names it with ref: and reads it with useElementRef.
symbols:
  - "syntax:defineexpose"
related:
  - "syntax:useelementref"
  - "syntax:ref"
  - "syntax:defineemits"
  - "syntax:definemodel"
  - docs/api.md#exponer-valores-defineexpose
source-hash: 16f2d7cc44591b431c829baf9da5bbf42422b7df28b7d5c094cd57eb99315087
---

`defineExpose(valor)` exposes a component value to the parent that names it with `ref:nombre` and reads it with `useElementRef("nombre")`. The parent receives the value with its exact type. Without `defineExpose`, the component exposes `null`. It is a compiler macro: you do not import it.

Use it for imperative actions that do not fit props and events: focusing, clearing, scrolling or opening a dialog.

## Usage

```html
<!-- app/components/SearchBox.meeko -->
<script lang="ts">
const query = signal("");
const input = useElementRef("input");
function clear(): void {
  query.value = "";
  input.value?.focus();
}
defineExpose({ query, clear });
</script>

<template><input ref:input type="search" model="query" aria-label="Search"></template>
```

```html
<!-- app/components/Toolbar.meeko -->
<script lang="ts">
const box = useElementRef("box");
</script>

<template>
  <SearchBox ref:box />
  <button type="button" on:click="() => box.value?.clear()">Clear</button>
  <p>Searching: {box.value?.query.value ?? ""}</p>
</template>
```

## Parameters

| Parameter           | Type     | Default  | Description                                                                                                     |
| ------------------- | -------- | -------- | --------------------------------------------------------------------------------------------------------------- |
| `exposed`           | `T`      | required | The value received by the parent: usually an object with functions and signals. No argument produces `MEEK051`. |
| `T` (type argument) | any type | inferred | Optional, to annotate the exposed type. At most one (`MEEK051`).                                                |

## Return value

The same `exposed`. The parent receives it in `useElementRef("nombre")`:

- without `await`, a `ReadonlySignal<T | null>`, `null` in SSR and until the child mounts;
- with `await`, the value, once the child exists in the browser.

The compiled module exports its type as `ComponentExposed` (and each auto-imported component as `<Nombre>Exposed`), and the function returned by `hydrateScope` carries the value in `exposed`.

## Examples

### A native dialog opened by the parent

```html
<!-- app/components/ConfirmDialog.meeko -->
<script lang="ts">
const dialog = useElementRef("dialog");
const snippets = defineSnippets<{ default: [] }>();
defineExpose({
  open: (): void => dialog.value?.showModal(),
  close: (): void => dialog.value?.close(),
});
</script>

<template>
  <dialog ref:dialog>
    <render snippet="snippets.default" />
    <form method="dialog"><button>Close</button></form>
  </dialog>
</template>
```

```html
<script lang="ts">
const confirm = useElementRef("confirm");
</script>

<template>
  <button type="button" on:click="() => confirm.value?.open()">Delete</button>
  <ConfirmDialog ref:confirm><p>Delete the note?</p></ConfirmDialog>
</template>
```

### Wait for the child with `await`

With `await`, the parent receives the exposed value already mounted, without `null`. What follows `await` only executes in the browser:

```html
<script lang="ts">
const ready = signal(false);
const box = await useElementRef("box");
box.query.value = "meeko";
ready.value = true;
</script>

<template><SearchBox ref:box /></template>
```

## Common mistakes

### Calling it twice, or assigning its result

```html bad
<script lang="ts">
const api = defineExpose({ clear });
defineExpose({ focus });
</script>
```

`MEEK050: defineExpose debe aparecer una sola vez, como sentencia propia de nivel superior: defineExpose({ ... })`. Combine everything in one object.

```html good
<script lang="ts">
defineExpose({ clear, focus });
</script>
```

### Without an argument

```html bad
<script lang="ts">
defineExpose();
</script>
```

`MEEK051: defineExpose necesita un argumento: el valor que recibe el padre a través de ref`.

```html good
<script lang="ts">
defineExpose({ clear });
</script>
```

### Waiting for a component that exposes nothing

```html bad
<script lang="ts">
const box = await useElementRef("box");
</script>
<template><NoExpose ref:box /></template>
```

`MEEK080: await useElementRef("box") espera el valor del defineExpose de un componente, pero el componente de ref:box no lo tiene. Añade defineExpose a ese componente o lee useElementRef("box").value`. At runtime, the promise rejects with a `MEEK080` error when the component hydrates.

```html good
<script lang="ts">
const box = await useElementRef("box");
</script>
<template><SearchBox ref:box /></template>
```

### Using the exposed value to pass data

Reading the child's state from the parent through `ref:` couples them and does not work in SSR (`null`). For flowing data, use props, events or a model.

```html bad
<p>{box.value?.query.value}</p>
```

```html good
<SearchBox model="query" />
<p>{query.value}</p>
```

With `const query = defineModel<string>()` in the child and `const query = signal("")` in the parent.

## Notes

- **SSR.** The exposed value is not transferred in SSR state and `ref:` is `null` on the server: anything that depends on it must run in the browser, in a handler or in `onMounted`.
- **Placement.** A top-level statement, before the first browser `await` (`MEEK058`).
- **Types.** `meeko check` and the editor have the exact type. The `.d.meeko.ts` declarations from `meeko types` lose precision and use `any` where TypeScript cannot infer a type there.
- **Design.** Expose small actions (`open`, `focus`, `clear`) rather than all state: the component keeps ownership of its data.
