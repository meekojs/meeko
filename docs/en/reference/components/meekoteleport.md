---
title: <MeekoTeleport>
group: components
since: 1.5.0
description: Renders content elsewhere in the document (the end of body or an element with an id) while keeping it in the declaring component.
symbols:
  - "syntax:meekoteleport"
types:
  - "@meekojs/meeko/framework#MeekoTeleportProps"
  - "@meekojs/meeko/framework#MeekoTeleportTarget"
related:
  - "syntax:meekooutlet"
  - "syntax:meekopopover"
  - "@meekojs/meeko/framework#useLayout"
  - "@meekojs/meeko#provide"
  - docs/framework.md#meekoteleport
source-hash: 5a671ab1748afea981fcb232d56005e30e5ddb9ef0c7ab6fb1a9eb2dd659590a
---

Sometimes a component's markup must appear elsewhere on the page: a page's buttons in its layout's toolbar, breadcrumbs in the header, an alert at the end of `<body>`. `<MeekoTeleport to="…">` renders its content at that target, but the content **still belongs to the declaring component**: it reads its signals, its events call its functions, it receives its `provide`/`inject` and error handlers, and keeps its `<style scoped>` attribute. It is disposed of with the component, leaving no nodes in the target.

The server HTML already contains the content at its target and hydration does not change the DOM. No import is needed: the compiler recognizes the tag.

## Usage

```html
<!-- app/layouts/default.meeko -->
<template>
  <header class="bar">
    <MeekoLink to="/">Home</MeekoLink>
    <div id="toolbar"></div>
  </header>
  <main><MeekoOutlet /></main>
</template>
```

```html
<!-- app/pages/notes/[id].meeko -->
<script lang="ts">
async function save(): Promise<void> { /* … */ }
</script>

<template>
  <MeekoTeleport to="#toolbar">
    <button type="button" on:click="save">Save</button>
  </MeekoTeleport>
  <article>…</article>
</template>
```

The button appears in the layout's toolbar, and disappears from it when you navigate to another page.

## Props

| Attribute                     | Type                  | Default  | Description                                                                                                                                                                                                                                           |
| ----------------------------- | --------------------- | -------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `to`                          | `"body"` or `"#id"`   | required | `"body"` appends content to `<body>`; `"#id"` inserts it inside the element with that `id`, after its existing content. The `id` is a letter followed by ASCII letters, digits, `-` or `_`; looked up with `getElementById`, never as a CSS selector. |
| `bind:to`                     | `MeekoTeleportTarget` |          | Computed target, `"body"` or a string starting with `#`; validated when rendering.                                                                                                                                                                    |
| `disabled` or `bind:disabled` | `boolean`             | `false`  | While true, content renders in place. Changing it moves the same nodes, preserving their state.                                                                                                                                                       |
| `if:when`, `each:of`          |                       |          | Work as on any tag.                                                                                                                                                                                                                                   |

Any other attribute is `MEEK114`.

## Result

The content at the target, between comment markers (`<!--meeko:portal:…-->`); only a marker remains at its original location. Multiple teleports to the same target preserve their order on the page. In SSR, `to="body"` content goes after the application and before Meeko scripts, and `to="#id"` content goes inside that element, whether it renders before or after the teleport.

## Examples

### An alert at the end of `<body>`

```html
<script lang="ts">
const saved = signal(false);
</script>

<template>
  <button type="button" on:click="() => saved.value = true">Save</button>
  <MeekoTeleport to="body">
    <div if:when="saved.value" class="toast" role="status">Saved.</div>
  </MeekoTeleport>
</template>
```

### In place on small screens

```html
<script lang="ts">
const narrow = signal(false);
onMounted(() => {
  const query = window.matchMedia("(max-width: 40rem)");
  const update = (): void => { narrow.value = query.matches; };
  update();
  query.addEventListener("change", update);
  return () => query.removeEventListener("change", update);
});
</script>

<template>
  <MeekoTeleport to="#toolbar" bind:disabled="narrow.value">
    <AppButton on:click="save">Save</AppButton>
  </MeekoTeleport>
</template>
```

When `narrow` changes, the same nodes move from the toolbar to their original location, without rendering again.

### Breadcrumbs from each page

```html
<!-- app/pages/docs/[slug].meeko -->
<template>
  <MeekoTeleport to="#breadcrumbs">
    <MeekoLink to="/docs">Documentation</MeekoLink> › <span>{page.title}</span>
  </MeekoTeleport>
  <article html="page.body"></article>
</template>
```

## Common mistakes

### A CSS selector in `to`

```html bad
<MeekoTeleport to="header .bar"><p>Hello</p></MeekoTeleport>
```

`meeko check` reports `MEEK114: to de <MeekoTeleport> admite "body" o "#id" (una letra y luego letras, dígitos, - o _), como to="#toolbar", no "header .bar"`. Give the target an `id`:

```html good
<MeekoTeleport to="#toolbar"><p>Hello</p></MeekoTeleport>
```

### An unsupported attribute

```html bad
<MeekoTeleport to="#toolbar" class="actions"><button>Save</button></MeekoTeleport>
```

`meeko check` reports `MEEK114: <MeekoTeleport> admite to, bind:to, disabled, bind:disabled, if:when y each:of; class no se admite`. The tag renders no element of its own: put the class on the content.

```html good
<MeekoTeleport to="#toolbar"><div class="actions"><button>Save</button></div></MeekoTeleport>
```

### A `bind:to` of type `string`

```html bad
<script lang="ts">
const target = signal("#toolbar");
</script>
<template><MeekoTeleport bind:to="target.value"><p>Hello</p></MeekoTeleport></template>
```

`meeko check` reports `TS2322: Type 'string' is not assignable to type 'MeekoTeleportTarget'`. Declare the signal with the target type, imported from `@meekojs/meeko/framework`:

```html good
<script lang="ts">
import type { MeekoTeleportTarget } from "@meekojs/meeko/framework";
const target = signal<MeekoTeleportTarget>("#toolbar");
</script>
<template><MeekoTeleport bind:to="target.value"><p>Hello</p></MeekoTeleport></template>
```

### A nonexistent target

```html bad
<!-- no layout or component renders id="sidebar" -->
<MeekoTeleport to="#sidebar"><nav>…</nav></MeekoTeleport>
```

`meeko check` does not detect it. In development, rendering fails with `Error: <MeekoTeleport to="#sidebar">: the page renders no element with id "sidebar"; render it in the page, a layout or app.meeko, or use to="body"`; in production, content renders in place and the server warns once with the same text in `console.warn`. The target must live at least as long as the teleport: for a page, an element in the layout or `app/app.meeko`.

```html good
<!-- app/layouts/default.meeko renders <aside id="sidebar"></aside> -->
<MeekoTeleport to="#sidebar"><nav>…</nav></MeekoTeleport>
```

## Notes

- **Modals and menus.** No teleport is needed: `<dialog>` with `showModal()` and the `popover` attribute (or [`<MeekoPopover>`](/en/docs/reference/meekopopover)) already use the browser's _top layer_, without `z-index` or `overflow` issues.
- **Browser.** Content rendered later by the browser (navigation, an appearing `if:when`, a new row) first renders in place and moves to the target when that mount finishes, before the next paint.
- **Focus.** Changing `disabled` moves nodes: the focused element loses focus, as with any DOM move.
- **Security.** `to` is never interpreted as HTML or a selector: only `"body"` or an `id` with safe characters.
- **Accessibility.** Document order changes: teleported content is read where it is in the DOM, not where you declared it. Use it for content that makes sense to read at the target.
