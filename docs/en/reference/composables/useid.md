---
title: useId
group: composables
since: 1.5.0
description: Returns an ID unique to each instance and call, identical in server HTML and during hydration, to link labels, controls and help text.
symbols:
  - "@meekojs/meeko#useId"
related:
  - "@meekojs/meeko/framework#useForm"
  - "syntax:meekoselect"
  - "syntax:meekopopover"
  - "syntax:bind"
  - docs/api.md#ids-estables-useid
  - docs/framework.md#componentes-de-campo-formfield
source-hash: dd27c06e68b90823e5cc91906ae597a3ff968bb3519b9c6bc470df59645b8e29
---

Attributes that link elements (`id` with `for`, `aria-describedby`, `aria-controls`, `aria-labelledby`) need an ID that is not repeated on the page. A fixed one does not work in a reusable component, and a random one would change between server and browser and break hydration. `useId()` returns an ID derived from the **instance's position** in the tree and the order of the call in its script: different for every instance, identical in SSR and hydration, without being transferred in the payload.

It is exported from `@meekojs/meeko` and auto-imported in framework applications; a project export with the same name takes precedence.

## Usage

```html
<!-- app/components/AppSwitch.meeko -->
<script lang="ts">
const props = defineProps<{ label: string; hint?: string }>();
const on = defineModel<boolean>();
const id = useId();
</script>

<template>
  <input type="checkbox" role="switch" bind:id="id" bind:aria-describedby="props.hint ? `${id}-hint` : null" model="on">
  <label bind:for="id">{props.label}</label>
  <p if:when="props.hint" bind:id="`${id}-hint`">{props.hint}</p>
</template>
```

Two `<AppSwitch>` instances on the same page have different IDs, and each ID is the same in the server HTML and after hydration.

## Parameters

`useId()` takes no parameters.

## Return value

A `string` with the application's prefix, `-`, the position and a counter: `m-0`, `m-2_f0n3-1` or, for long positions or those with other characters, a hash (`m-h1x2y3…-0`). It only contains letters, numbers, `-` and `_`, so it also works in a CSS selector. Do not depend on its format, which may change between versions.

Outside a component's script, it returns an ID unique within the process or page (`m-u0`, `m-u1`…) that does **not** match between server and browser.

## Examples

### Multiple elements in the same field

Each call produces a new ID. For multiple elements in the same field, derive suffixes from a single one:

```html
<!-- app/components/AppTextField.meeko -->
<script lang="ts">
const props = defineProps<{ label: string; error?: string }>();
const value = defineModel<string>();
const id = useId();
</script>

<template>
  <label bind:for="id">{props.label}</label>
  <input bind:id="id" model="value" bind:aria-invalid="props.error ? 'true' : null" bind:aria-describedby="props.error ? `${id}-error` : null">
  <p if:when="props.error" bind:id="`${id}-error`" role="alert">{props.error}</p>
</template>
```

### An accessible disclosure

```html
<!-- app/components/AppDisclosure.meeko -->
<script lang="ts">
const props = defineProps<{ title: string }>();
const snippets = defineSnippets<{ default: [] }>();
const open = signal(false);
const panelId = useId();
</script>

<template>
  <button type="button" bind:aria-expanded="String(open.value)" bind:aria-controls="panelId" on:click="() => open.value = !open.value">{props.title}</button>
  <div bind:id="panelId" bind:hidden="!open.value"><render snippet="snippets.default" /></div>
</template>
```

### Inside a list

Each `each:of` row has its own position, so the same component has a different ID in every row. With `each:key`, the row keeps its ID even when the list is reordered:

```html
<ul>
  <li each:of="tasks.value" each:as="task" each:key="task.id"><AppSwitch bind:label="task.title" /></li>
</ul>
```

### A custom prefix

Two Meeko applications on the same page would repeat their IDs. `document.idPrefix` changes the prefix on both the server and browser at once:

```ts
// meeko.config.ts
import { defineMeekoConfig } from "@meekojs/meeko/framework";

export default defineMeekoConfig({ document: { idPrefix: "shop" } });
```

## Common mistakes

### Calling it in a handler or the template

Outside the script, the ID is not derived from the instance's position.

```html bad
<script lang="ts">
const fieldId = (): string => useId();
</script>
<template><label bind:for="fieldId()">Name</label><input bind:id="fieldId()"></template>
```

There is no compilation error, but every call produces a different ID (the label and field are no longer linked), and because it runs during rendering, the server and browser IDs do not match. Call it once at the top level of the script:

```html good
<script lang="ts">
const fieldId = useId();
</script>
<template><label bind:for="fieldId">Name</label><input bind:id="fieldId"></template>
```

### Writing `for` without `bind:`

```html bad
<label for="id">Name</label>
```

`meeko check` accepts it, but the attribute is the literal text `"id"`, not the variable's value: the label is not linked.

```html good
<label bind:for="id">Name</label>
```

### Calling it after a browser `await`

Anything after `await useElementRef(...)` or `await useSocket(...)` only runs in the browser, so its ID does not exist in the server HTML.

```ts bad
const panel = await useElementRef("panel");
const titleId = useId();
```

The template also cannot use `titleId`: `meeko check` reports `MEEK057`. Call `useId` before the first `await`:

<!-- no-check -->

```ts good
const titleId = useId();
const panel = await useElementRef("panel");
```

## Notes

- **Deterministic.** The ID comes from the component containing the instance, its `each:of` row key, the `if:when` or snippet rendering it, and the call order. Server and browser traverse the same positions.
- **Unique.** Two instances never share an ID, including list rows or content an `if:when` renders later in the browser. A component recreated by an `if:when` recovers its previous ID.
- **Not transferred.** The ID is not part of payload state: it does not increase page size.
- **Standalone roots.** With `hydrate` or `renderWithState` without the framework, each root starts at the empty position: two independent roots would repeat their IDs.
- **Forms.** [`useForm`](/en/docs/reference/useform) uses it for `form.field` IDs, and `<MeekoPopover>` and `<MeekoSelect>` use it to link triggers, content and options.
