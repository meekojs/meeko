---
title: <MeekoOutlet>
group: components
since: 1.2.0
description: Renders the inner layout or page in app/app.meeko and layouts, with the browser preserving the layout between routes.
symbols:
  - "syntax:meekooutlet"
types:
  - "@meekojs/meeko/framework#MeekoOutletProps"
related:
  - "syntax:meekolink"
  - "syntax:component-tag"
  - "syntax:meekoteleport"
  - "@meekojs/meeko/framework#useLayout"
  - "@meekojs/meeko/framework#definePage"
  - docs/framework.md#meekooutlet--y-meekolink
  - docs/framework.md#routing-layouts-y-ssr
  - docs/framework.md#layouts-con-nombre
source-hash: 595246f13d37ccc3379308adf3db56bb6b46db030a50a4474364451b9157c0a9
---

A Meeko application is a chain of wrappers: `app/app.meeko` wraps the named layout, which wraps folder `+layout.meeko` files, and the last one wraps the page. `<MeekoOutlet />` marks where the next one goes in each wrapper. It reads the `outlet` prop Meeko passes to each layout, so the layout does not need to declare it.

On navigation, the browser preserves layouts shared by the outgoing and incoming pages (their DOM, focus, state and sidebar scroll) and only changes the outlet's contents. Do not import it: the compiler recognizes the tag.

## Usage

```html
<!-- app/layouts/default.meeko -->
<template>
  <header><MeekoLink to="/">Inicio</MeekoLink></header>
  <main><MeekoOutlet /></main>
  <footer>© Mi sitio</footer>
</template>
```

```html
<!-- app/app.meeko -->
<template>
  <div class="site-root"><MeekoOutlet /></div>
</template>
```

## Props

`<MeekoOutlet />` has no props or content. Any attribute or content between its tags is error `MEEK104`.

## Result

The inner layout or page's HTML at that location, between a child component's comment markers. It is equivalent to `<component is="props.outlet">`: the layout adds no surrounding element, so you provide the wrapper (`<main>`, `<div>`).

Since `1.5`, a layout with `<MeekoOutlet />` declares only its own props (`defineProps<{ title?: string }>()`), and Meeko adds `outlet` to its `ComponentProps`. Through `1.4`, if it declared props, `outlet` had to be among them.

## Examples

### A named layout and its props

```html
<!-- app/layouts/dashboard.meeko -->
<script lang="ts">
export interface Props { title?: string; showAlert?: boolean }
const props = defineProps<Props>({ showAlert: false });
</script>

<template>
  <aside><DashboardNav /></aside>
  <section>
    <h1>{props.title}</h1>
    <p if:when="props.showAlert" role="alert">Hay un aviso pendiente.</p>
    <MeekoOutlet />
  </section>
</template>
```

Pages select it with `definePage({ layout: "dashboard" })` and pass props with `layoutProps` or [`useLayout`](/en/docs/reference/uselayout).

### A layout area filled by the page

Props are for data. To place page markup in another layout area, provide a target and use [`<MeekoTeleport>`](/en/docs/reference/meekoteleport):

```html
<!-- app/layouts/default.meeko -->
<template>
  <header class="bar"><div id="toolbar"></div></header>
  <main><MeekoOutlet /></main>
</template>
```

### Nested layouts

A `+layout.meeko` alongside pages nests inside the named layout, and its `<MeekoOutlet />` renders the page:

```text
app/app.meeko                          → <MeekoOutlet /> pinta el layout con nombre
└─ app/layouts/dashboard.meeko         → <MeekoOutlet /> pinta +layout.meeko
   └─ app/pages/(dashboard)/+layout.meeko  → <MeekoOutlet /> pinta la página
      └─ app/pages/(dashboard)/reports.meeko
```

## Common mistakes

### Using it in a component

```html bad
<!-- app/components/Card.meeko -->
<template><div class="card"><MeekoOutlet /></div></template>
```

`meeko check` reports `MEEK104: <MeekoOutlet /> sólo se usa en app/app.meeko y en los layouts (app/layouts/*.meeko o +layout.meeko): pinta el layout o la página que van dentro`. To let a component receive content, declare a snippet:

```html good
<!-- app/components/Card.meeko -->
<script lang="ts">
const snippets = defineSnippets<{ default: [] }>();
</script>
<template><div class="card"><render snippet="snippets.default" /></div></template>
```

### Giving it attributes or content

```html bad
<MeekoOutlet class="page" />
```

`meeko check` reports `MEEK104: <MeekoOutlet /> no admite atributos ni contenido: escríbelo como <MeekoOutlet />`. The outlet renders no element to apply the class to: wrap it.

```html good
<main class="page"><MeekoOutlet /></main>
```

### A custom component called `MeekoOutlet`

```html bad
<!-- app/components/MeekoOutlet.meeko existe en el proyecto -->
<main><MeekoOutlet /></main>
```

To avoid breaking projects from before `1.2`, the project component takes precedence over the tag, and `meeko check`, `meeko build` and the editor warn with `MEEK106: <MeekoOutlet> es el componente MeekoOutlet del proyecto, no la etiqueta propia de Meeko (la página o el layout de dentro); renombra el componente para usar la de Meeko`.

```html good
<!-- app/components/AppOutletFrame.meeko -->
<main><MeekoOutlet /></main>
```

## Notes

- **Navigation.** The browser preserves layouts shared by the outgoing and incoming pages and disposes of the outgoing page before mounting the new one. If the named layout changes, the previous one is disposed of and the new one mounted.
- **SSR and hydration.** The server renders the complete chain into a single HTML document, each level with its state, and hydration claims it without changing the DOM.
- **Error page.** A page that fails in the browser shows its `+error.meeko` or `app/error.meeko` inside its own layouts, through the same outlet.
- **Accessibility.** Place the outlet inside a layout's `<main>`, once per page, so screen readers can find the main content.
- **Contracts.** `meeko check` checks that `app/app.meeko` and layouts accept the `outlet` Meeko passes, and that named layout props are optional or have defaults.
