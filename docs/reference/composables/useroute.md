---
title: useRoute
group: composables
since: 1.2.0
description: Lee la ruta confirmada que renderiza el componente (url, path, id, params y search) como señales, y comprueba si una ruta está activa.
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
---

`useRoute()` da al componente la ruta que está pintando: la de la petición en SSR y la de la última navegación **confirmada** en el navegador. Cada valor es una señal de sólo lectura, así que una plantilla, un `computed` o un `effect` que la lee se actualiza al navegar, también en un layout que el navegador conserva entre páginas. `isActive(to, options)` aplica la misma regla que [`<MeekoLink match>`](/docs/reference/meekolink) a enlaces y componentes propios.

Funciona en páginas, layouts, `app/app.meeko`, `app/error.meeko` y cualquier componente que pinten. Se autoimporta en las aplicaciones (un export propio llamado `useRoute` en una carpeta de autoimports tiene prioridad) y puede llamarse también desde código que se ejecuta con el componente (un composable, un `computed`, un `effect`). En un manejador de eventos no hay raíz activa y lanza: pídelo en el script y usa el resultado en el manejador.

## Uso

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

`isActive` devuelve `"page"` en la ruta exacta y `false` en las demás; `bind:` quita el atributo con `false`.

## Parámetros

`useRoute()` no recibe parámetros. El método `isActive(to, options)` del resultado recibe:

| Opción | Tipo | Por defecto | Descripción |
| --- | --- | --- | --- |
| `to` | `RouteId` | obligatorio | ID de una ruta que existe, como `"/users/[id]"`. Una ruta inexistente es un error de tipos. |
| `params` | `RouteParams` de `to` | ninguno | Los segmentos dinámicos, como en `href()`. Obligatorio en una ruta dinámica, prohibido en las demás. |
| `prefix` | `boolean` | `false` | Cuenta también las rutas por debajo de `to`, con `"true"`. `"/"` sólo coincide exacta. |

## Valor devuelto

Un `RouteState`, el mismo objeto para todo el árbol de la aplicación:

| Propiedad | Tipo | Descripción |
| --- | --- | --- |
| `url` | `ReadonlySignal<string>` | URL relativa al origen: `pathname`, `search` y, en el navegador, el fragmento (`/users/42?tab=a#bio`). En SSR nunca lleva fragmento, porque el navegador no lo envía. |
| `path` | `ReadonlySignal<string>` | `pathname`, codificado como en `location.pathname` (`/users/42`). |
| `id` | `ReadonlySignal<string \| null>` | ID de la ruta en el manifiesto (`"/users/[id]"`), o `null` en la página `404` de `app/error.meeko` para una URL sin ruta. |
| `params` | `ReadonlySignal<Readonly<Record<string, unknown>>>` | Parámetros de la ruta, con la forma que recibe la página (validados por su schema). |
| `search` | `ReadonlySignal<Readonly<Record<string, unknown>>>` | Parámetros de búsqueda, con la forma que recibe la página; en la `404`, la query string con las claves repetidas en arrays. |
| `isActive(to, options?)` | `"page" \| "true" \| false` | Desde `1.5`. Una función, no una señal. `"page"` si la ruta confirmada es `to` (con sus `params`); con `prefix: true`, `"true"` si está por debajo por segmentos completos; si no, `false`. |

`useRoute()` no recibe argumentos. Fuera de una aplicación de Meeko (un render del framework o `mountClientApp`) lanza `Error: useRoute() necesita una aplicación de Meeko en ejecución…`.

## Ejemplos

### Una barra lateral con la sección activa

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

En `/settings/profile`, «Ajustes» lleva `aria-current="true"`; en `/settings`, `aria-current="page"`.

### Una ruta dinámica

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

### Reaccionar a cada navegación

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

El efecto se ejecuta al hidratar y con cada navegación confirmada, también al volver atrás o al cambiar sólo el fragmento.

### Leer la query string tipada

`search` tiene la forma que recibe la página. Sin schema, cada valor es `unknown`: compruébalo antes de usarlo.

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

## Errores comunes

### Comparar la señal en lugar de su valor

```html bad
<p if:when="route.path === '/about'">Acerca de</p>
```

`meeko check` da `TS2367: This comparison appears to be unintentional because the types 'ReadonlySignal<string>' and 'string' have no overlap`.

```html good
<p if:when="route.path.value === '/about'">Acerca de</p>
```

### Una ruta que no existe, o sin sus `params`

```html bad
<a bind:aria-current="route.isActive('/nowhere')">Perdido</a>
<a bind:aria-current="route.isActive('/users/[id]')">Perfil</a>
```

`meeko check` da `TS2345: Argument of type '"/nowhere"' is not assignable to parameter of type '"/" | "/about" | "/users/[id]"'` en la primera y `TS2554: Expected 2 arguments, but got 1` en la segunda, porque la ruta dinámica exige `params`.

```html good
<a bind:aria-current="route.isActive('/users/[id]', { params: { id: '7' } })">Perfil</a>
```

### Usar `params` sin comprobar su tipo

```ts bad
const id = route.params.value.id.toUpperCase();
```

`meeko check` da `TS18046: 'route.params.value.id' is of type 'unknown'`: `useRoute` sirve para cualquier ruta, así que no conoce el schema de ésta. En la página, usa sus props `params`, tipadas por `definePage`; en un componente, comprueba el tipo:

<!-- no-check -->
```ts good
const id = computed(() => {
  const value = route.params.value.id;
  return typeof value === "string" ? value : "";
});
```

### Llamarlo en una prueba unitaria

```ts bad
const html = renderToString({}); // el componente llama a useRoute()
```

Lanza `Error: useRoute() necesita una aplicación de Meeko en ejecución: sólo funciona en componentes que renderiza el servidor del framework o que monta mountClientApp. En una prueba unitaria, pasa la ruta al componente como prop.` Haz lo que dice el mensaje:

<!-- no-check -->
```ts good
const html = renderToString({ path: "/about" }); // el componente recibe la ruta como prop
```

## Notas

- **SSR.** Los valores son los de la petición, también en las rutas `"prerender"` y `"stream"` y en los layouts de una ruta `"client"`.
- **Hidratación.** El navegador hidrata con los mismos valores que el SSR, también en un HTML renderizado para otra URL (el `404.html` del adaptador `static`, una página prerenderizada servida con otra query string). Justo después, `url` y `path` pasan a ser los de la barra de direcciones, con su fragmento.
- **Navegación.** Los valores cambian sólo cuando la navegación se confirma, a la vez que el contenido, nunca mientras [`useNavigation().pending`](/docs/reference/usenavigation) vale `true`. La página anterior se libera antes de que se actualicen los efectos que leen la ruta.
- **`isActive` es reactivo.** Lee `path`, así que la plantilla o el `computed` que lo usan se actualizan al navegar. En SSR y al hidratar devuelve lo mismo.
- **Codificación.** `isActive` compara las rutas codificadas como `href()`, sin query ni fragmento: `/categorías` y `/categor%C3%ADas` son la misma.
- **Datos de la página.** Para los `params` y `search` validados de la página, sus props son más precisas. En `<script server>`, la petición completa está en [`usePage()`](/docs/reference/usepage).
