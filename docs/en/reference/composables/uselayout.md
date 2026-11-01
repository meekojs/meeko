---
title: useLayout
group: composables
since: 1.5.0
description: Reads and changes the props of the page's enclosing named layout, with types and reactivity, from the page.
symbols:
  - "@meekojs/meeko/framework#useLayout"
types:
  - "@meekojs/meeko/framework#LayoutHandle"
  - "@meekojs/meeko/framework#LayoutProps"
related:
  - "@meekojs/meeko/framework#definePage"
  - "@meekojs/meeko/framework#defineGroup"
  - "syntax:meekooutlet"
  - "syntax:meekoteleport"
  - docs/framework.md#props-del-layout-desde-la-página
  - docs/framework.md#layouts-con-nombre
source-hash: da043b0a861c9758c7a75fe00f97dbce157e9605a5f6983227f03653f510a823
---

A named layout (`app/layouts/dashboard.meeko`) declares ordinary props: a title, whether it shows an alert, which tab it marks. The page passes them in two ways: static or calculated from its data in [`definePage`](/en/docs/reference/definepage)'s `layoutProps`, or from its `<script>` with `useLayout()` for values depending on browser state. `layout.set(patch)` changes the named props and the layout updates only what reads them, without remounting.

In a page, the type follows the layout chosen by its `definePage` or `+group.ts` files, so an undeclared layout prop is a type error. It is auto-imported in applications.

## Usage

```html
<!-- app/layouts/dashboard.meeko -->
<script lang="ts">
export interface Props { title?: string; showAlert?: boolean }
const props = defineProps<Props>({ showAlert: false });
</script>

<template>
  <header>{props.title}</header>
  <p if:when="props.showAlert" role="alert">Hay un problema con la conexión.</p>
  <main><MeekoOutlet /></main>
</template>
```

```html
<!-- app/pages/connections.meeko -->
<script server lang="ts">
export const route = definePage({ layout: "dashboard", layoutProps: { title: "Conexiones" } });
</script>

<script lang="ts">
const layout = useLayout();                 // LayoutHandle de "dashboard"
const failing = signal(false);
effect(() => layout.set({ showAlert: failing.value }));
</script>

<template>
  <p>Título actual: {layout.props.title}</p>
  <button type="button" on:click="() => failing.value = !failing.value">Probar conexión</button>
</template>
```

## Parameters

| Parameter | Type           | Default           | Description                                                                                                         |
| --------- | -------------- | ----------------- | ------------------------------------------------------------------------------------------------------------------- |
| `L`       | type parameter | the page's layout | Layout name. Meeko supplies it in a page; in a component other than the page, write it: `useLayout<"dashboard">()`. |

## Return value

A frozen `LayoutHandle`:

| Property     | Type                                | Description                                                                                                                                                                                                                  |
| ------------ | ----------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `name`       | `string \| undefined`               | Page layout name, or `undefined` with `layout: false`.                                                                                                                                                                       |
| `props`      | `Readonly<Partial<LayoutProps<L>>>` | Props currently received by the layout, without `outlet`: those from `layoutProps` and `+group.ts`, overridden by the page's writes. Reads are reactive.                                                                     |
| `set(patch)` | `void`                              | Changes props named by `patch` and keeps the rest. An undeclared layout prop or one with another type is a type error. A non-object value throws `TypeError: useLayout().set() necesita un objeto con las props del layout`. |

Outside a Meeko-rendered page it throws `Error: useLayout() necesita una página que renderiza Meeko: sólo funciona en las páginas, en sus componentes y en sus +layout.meeko…`. In a page with `layout: false`, it returns a no-op handle.

## Examples

### A title depending on user actions

```html
<!-- app/pages/editor.meeko -->
<script server lang="ts">
export const route = definePage({ layout: "dashboard" });
</script>

<script lang="ts">
const layout = useLayout();
const draft = signal("");
effect(() => layout.set({ title: draft.value ? `Editando: ${draft.value}` : "Nuevo documento" }));
</script>

<template><input model="draft" placeholder="Título"></template>
```

### From a page component

A component other than the page does not know its enclosing layout: name it in the type parameter.

```html
<!-- app/components/ConnectionTest.meeko -->
<script lang="ts">
const layout = useLayout<"dashboard">();
async function test(): Promise<void> {
  const ok = await fetch("/api/ping").then((response) => response.ok, () => false);
  layout.set({ showAlert: !ok });
}
</script>

<template><button type="button" on:click="test">Probar</button></template>
```

### Props per folder and page

Static values belong in route options, present in server HTML from the first byte; use `useLayout` only for what changes in the browser:

<!-- no-check -->

```ts
// app/pages/(dashboard)/+group.ts
export default defineGroup({ layout: "dashboard", layoutProps: { showAlert: false } });
```

<!-- no-check -->

```ts
// app/pages/(dashboard)/reports.route.ts
export const route = definePage({ layoutProps: { title: "Informes" } });
```

## Common mistakes

### A prop the layout does not declare, or with another type

```ts bad
const layout = useLayout(); // la página usa layout: "dashboard"
layout.set({ showAlert: "yes" });
layout.set({ subtitle: "x" });
```

`meeko check` reports `TS2322: Type 'string' is not assignable to type 'boolean | undefined'` for the first and `TS2353: Object literal may only specify known properties, and 'subtitle' does not exist in type 'Partial<{ title?: string; showAlert?: boolean | undefined; }> & {}'` for the second.

<!-- no-check -->

```ts good
layout.set({ showAlert: true });
```

### Use it with a `default` layout without props

```ts bad
const layout = useLayout<"default">();
layout.set({ title: "x" });
```

If `app/layouts/default.meeko` declares no props, `meeko check` reports `TS2322: Type 'string' is not assignable to type 'never'`. Declare the layout prop (optional or with a default value) before writing it.

```html good
<!-- app/layouts/default.meeko -->
<script lang="ts">
const props = defineProps<{ title?: string }>();
</script>
```

### Use props for markup

```ts bad
layout.set({ actionsHtml: "<button>Guardar</button>" });
```

Props are data: passing HTML as text forces the layout to render it with `html` and loses page events and scope. To put page content in a layout area, use [`<MeekoTeleport>`](/en/docs/reference/meekoteleport):

```html good
<MeekoTeleport to="#toolbar"><button type="button" on:click="save">Guardar</button></MeekoTeleport>
```

### Call it in a unit test

```ts bad
renderToString({}); // la página llama a useLayout()
```

Throws `Error: useLayout() necesita una página que renderiza Meeko… En una prueba unitaria, pasa los valores al componente como props.`

<!-- no-check -->

```ts good
renderToString({ title: "Informes" }); // el componente recibe el valor como prop
```

## Notes

- **SSR without mismatches.** The layout renders before the page. What page setup writes with `set` during rendering reaches HTML through a second server render of the page, and the payload carries those props: the browser hydrates exactly that HTML. A render writing different values every time stops on the third pass.
- **Browser.** What the page writes while rendering and hydrating is applied when mounting finishes; afterwards, each `set` applies immediately.
- **Nothing lingers.** On navigation to another page, the layout receives the new page's props (its `layoutProps`, its `+group.ts` props and defaults), even if the layout is preserved. A page that has left cannot write.
- **Serialization.** Props travel in the payload: they must be representable in JSON. An `undefined` leaves the prop unset and the layout uses its default value.
- **Optional props.** Meeko renders the layout without props not passed by a page, so a named layout's props must be optional or have defaults; `meeko check` verifies this (`MEEK_LAYOUT_PROPS`).
