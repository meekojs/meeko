---
title: useRoute
group: composables
since: 1.2.0
description: Reads the committed route rendered by the component (url, path, id, params and search) as signals, and checks whether a route is active.
symbols:
  - "@meekojs/meeko/framework#useRoute"
types:
  - "@meekojs/meeko/framework#RouteState"
related:
  - "syntax:meekolink"
  - "@meekojs/meeko/framework#href"
  - "@meekojs/meeko/framework#useNavigation"
  - "@meekojs/meeko/framework#usePage"
  - docs/framework.md#ruta-actual
  - docs/framework.md#enlaces-anclas-y-scroll
source-hash: c97ac0c1dbde72db275a3a0c04b38beee9a995c43acca35ebdec6e888c55bf04
---

`useRoute()` gives the component the route it is rendering: the request's route in SSR and the last **committed** navigation's route in the browser. Each value is a read-only signal, so a template, `computed` or `effect` reading it updates on navigation, including in a layout retained between pages. `isActive(to, options)` applies the same rule as [`<MeekoLink match>`](/en/docs/reference/meekolink) to custom links and components.

Works in pages, layouts, `app/app.meeko`, `app/error.meeko` and any components they render. It is auto-imported in applications (your own export named `useRoute` in an auto-import folder takes priority) and can also be called from code running with the component (a composable, `computed`, `effect`). In an event handler there is no active root and it throws: request it in the script and use the result in the handler.

## Usage

```html
<!-- app/layouts/default.meeko -->
<script lang="ts">
const route = useRoute();
</script>

<template>
  <nav>
    <a href="/" bind:aria-current="route.isActive('/')">Inicio</a>
    <a href="/about" bind:aria-current="route.isActive('/about')">Acerca de</a>
  </nav>
  <p class="path">Estás en {route.path.value}</p>
  <main><MeekoOutlet /></main>
</template>
```

`isActive` returns `"page"` on the exact route and `false` elsewhere; `bind:` removes the attribute for `false`.

## Parameters

`useRoute()` takes no parameters. The result's `isActive(to, options)` method takes:

| Option   | Type                 | Default  | Description                                                                          |
| -------- | -------------------- | -------- | ------------------------------------------------------------------------------------ |
| `to`     | `RouteId`            | required | An existing route ID, such as `"/users/[id]"`. A nonexistent route is a type error.  |
| `params` | `to`'s `RouteParams` | none     | Dynamic segments, as in `href()`. Required for a dynamic route, forbidden otherwise. |
| `prefix` | `boolean`            | `false`  | Also matches routes below `to`, with `"true"`. `"/"` only matches exactly.           |

## Return value

A `RouteState`, the same object throughout the application tree:

| Property                 | Type                                                | Description                                                                                                                                                                         |
| ------------------------ | --------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `url`                    | `ReadonlySignal<string>`                            | Origin-relative URL: `pathname`, `search` and, in the browser, fragment (`/users/42?tab=a#bio`). In SSR it never contains a fragment because the browser does not send it.          |
| `path`                   | `ReadonlySignal<string>`                            | `pathname`, encoded as in `location.pathname` (`/users/42`).                                                                                                                        |
| `id`                     | `ReadonlySignal<string \| null>`                    | Route ID in the manifest (`"/users/[id]"`), or `null` in the `app/error.meeko` `404` page for a URL without a route.                                                                |
| `params`                 | `ReadonlySignal<Readonly<Record<string, unknown>>>` | Route parameters as received by the page (validated by its schema).                                                                                                                 |
| `search`                 | `ReadonlySignal<Readonly<Record<string, unknown>>>` | Search parameters as received by the page; in the `404`, the query string with repeated keys as arrays.                                                                             |
| `isActive(to, options?)` | `"page" \| "true" \| false`                         | Since `1.5`. A function, not a signal. `"page"` if the committed route is `to` (with its `params`); with `prefix: true`, `"true"` if below it by whole segments; otherwise `false`. |

`useRoute()` takes no arguments. Outside a Meeko application (a framework render or `mountClientApp`), it throws `Error: useRoute() necesita una aplicación de Meeko en ejecución…`.

## Examples

### A sidebar with the active section

```html
<!-- app/layouts/default.meeko -->
<script lang="ts">
const route = useRoute();
const links = [
  { to: "/", label: "Inicio" },
  { to: "/users", label: "Usuarios" },
  { to: "/settings", label: "Ajustes" },
] as const;
const inSettings = computed(() => route.isActive("/settings", { prefix: true }) !== false);
</script>

<template>
  <aside>
    <a each:of="links" each:as="link" each:key="link.to" bind:href="href(link.to)" bind:aria-current="route.isActive(link.to, { prefix: true })">{link.label}</a>
    <p if:when="inSettings.value">Los cambios se guardan al salir.</p>
  </aside>
  <main><MeekoOutlet /></main>
</template>
```

On `/settings/profile`, “Settings” has `aria-current="true"`; on `/settings`, `aria-current="page"`.

### A dynamic route

```html
<script lang="ts">
const route = useRoute();
const props = defineProps<{ userId: string }>();
</script>

<template>
  <a bind:href="href('/users/[id]', { params: { id: props.userId } })"
     bind:aria-current="route.isActive('/users/[id]', { params: { id: props.userId } })">Perfil</a>
</template>
```

### React to each navigation

```ts
import { effect } from "@meekojs/meeko";
import { useRoute } from "@meekojs/meeko/framework";

// En el <script> de app/app.meeko: una vista de página por navegación confirmada.
const route = useRoute();
effect(() => {
  const url = route.url.value;
  if (typeof window !== "undefined") navigator.sendBeacon?.("/api/views", url);
});
```

The effect runs during hydration and each committed navigation, including going back or changing only the fragment.

### Read the typed query string

`search` has the shape received by the page. Without a schema, each value is `unknown`: check it before use.

```html
<script lang="ts">
const route = useRoute();
const tab = computed(() => {
  const value = route.search.value.tab;
  return typeof value === "string" ? value : "perfil";
});
</script>

<template><p>Pestaña: {tab.value}</p></template>
```

## Common mistakes

### Compare the signal instead of its value

```html bad
<p if:when="route.path === '/about'">Acerca de</p>
```

`meeko check` reports `TS2367: This comparison appears to be unintentional because the types 'ReadonlySignal<string>' and 'string' have no overlap`.

```html good
<p if:when="route.path.value === '/about'">Acerca de</p>
```

### A nonexistent route, or one without its `params`

```html bad
<a bind:aria-current="route.isActive('/nowhere')">Perdido</a>
<a bind:aria-current="route.isActive('/users/[id]')">Perfil</a>
```

`meeko check` reports `TS2345: Argument of type '"/nowhere"' is not assignable to parameter of type '"/" | "/about" | "/users/[id]"'` for the first and `TS2554: Expected 2 arguments, but got 1` for the second, because the dynamic route requires `params`.

```html good
<a bind:aria-current="route.isActive('/users/[id]', { params: { id: '7' } })">Perfil</a>
```

### Use `params` without checking its type

```ts bad
const id = route.params.value.id.toUpperCase();
```

`meeko check` reports `TS18046: 'route.params.value.id' is of type 'unknown'`: `useRoute` works for any route, so it does not know this route's schema. In the page, use its `params` props, typed by `definePage`; in a component, check the type:

<!-- no-check -->

```ts good
const id = computed(() => {
  const value = route.params.value.id;
  return typeof value === "string" ? value : "";
});
```

### Call it in a unit test

```ts bad
const html = renderToString({}); // el componente llama a useRoute()
```

Throws `Error: useRoute() necesita una aplicación de Meeko en ejecución: sólo funciona en componentes que renderiza el servidor del framework o que monta mountClientApp. En una prueba unitaria, pasa la ruta al componente como prop.` Follow the message's advice:

<!-- no-check -->

```ts good
const html = renderToString({ path: "/about" }); // el componente recibe la ruta como prop
```

## Notes

- **SSR.** Values are those of the request, including `"prerender"` and `"stream"` routes and layouts of a `"client"` route.
- **Hydration.** The browser hydrates with the same values as SSR, even for HTML rendered for another URL (the `static` adapter's `404.html`, a prerendered page served with another query string). Immediately afterward, `url` and `path` become those of the address bar, with its fragment.
- **Navigation.** Values change only when navigation commits, together with content, never while [`useNavigation().pending`](/en/docs/reference/usenavigation) is `true`. The previous page is disposed of before effects reading the route update.
- **`isActive` is reactive.** It reads `path`, so the template or `computed` using it updates on navigation. It returns the same result in SSR and hydration.
- **Encoding.** `isActive` compares paths encoded like `href()`, without query or fragment: `/categorías` and `/categor%C3%ADas` are the same.
- **Page data.** For the page's validated `params` and `search`, its props are more precise. In `<script server>`, the full request is in [`usePage()`](/en/docs/reference/usepage).
