---
title: href
group: utils
since: 1.1.0
description: Construye la URL de una ruta de la aplicación a partir de su ID, con los parámetros codificados y la query string, comprobada por TypeScript.
symbols:
  - "@meekojs/meeko/framework#href"
types:
  - "@meekojs/meeko/framework#RouteId"
related:
  - "syntax:meekolink"
  - "@meekojs/meeko/framework#useRoute"
  - "@meekojs/meeko/framework#redirect"
  - docs/framework.md#configuración
  - docs/framework.md#meekooutlet--y-meekolink
---

`href(id, { params, search })` construye la URL de una página de `app/pages` a partir de su ID, como `"/users/[id]"`. TypeScript sólo admite IDs de rutas que existen, exige `params` en una ruta dinámica (con sus claves exactas) y lo prohíbe en una estática: una ruta renombrada o un parámetro olvidado son errores de `meeko check`, no enlaces rotos.

Funciona en el servidor (SSR, loaders, `head`, prerender, API, RPC y middleware de servidor) con el manifiesto de la petición en curso, y en el navegador con el de la aplicación montada. Se autoimporta. Es lo que usa `<MeekoLink>` por dentro.

## Uso

```html
<!-- app/components/UserCard.meeko -->
<script lang="ts">
const props = defineProps<{ id: string; name: string }>();
</script>

<template>
  <a bind:href="href('/users/[id]', { params: { id: props.id }, search: { tab: 'perfil' } })">{props.name}</a>
</template>
```

Con `id: "42"`, el enlace es `/users/42?tab=perfil`.

## Parámetros

| Parámetro | Tipo | Por defecto | Descripción |
| --- | --- | --- | --- |
| `id` | `RouteId` | obligatorio | El ID de la ruta: la ruta de su archivo en `app/pages`, sin grupos `(…)`, como `"/"`, `"/about"`, `"/users/[id]"` o `"/docs/[...slug]"`. Sin query ni fragmento. |
| `options.params` | `{ [segmento]: string }` | ninguno | Los segmentos dinámicos. Obligatorio en una ruta dinámica y prohibido en una estática. Los valores son texto no vacío; un `[...slug]` admite `/`. |
| `options.search` | `Record<string, string \| number \| boolean \| null \| undefined>` | ninguno | La query string. Omite las claves con `null` o `undefined`. |

Fuera de una aplicación (una prueba unitaria, un script), la otra forma recibe el manifiesto: `href(routes, id, options)`.

## Valor devuelto

La ruta como texto, con cada parámetro codificado con `encodeURIComponent` y la query string al final:

```ts
// href("/users/[id]", { params: { id: "a b ñ" }, search: { tab: "perfil", page: 2, empty: null, flag: true } })
// "/users/a%20b%20%C3%B1?tab=perfil&page=2&flag=true"
```

Es una ruta del mismo origen, sin esquema ni host. Para una URL absoluta (un correo, un sitemap), combínala con el origen público: `new URL(href(…), "https://example.com")`.

## Ejemplos

### Redirigir a una ruta tipada

```html
<!-- app/pages/orders/new.meeko -->
<script server lang="ts">
const { context } = usePage();
if (!context.session.current) redirect(href("/login", { search: { next: "/orders/new" } }));
export const ready = true;
</script>

<template><h1>Nuevo pedido</h1></template>
```

### Copiar un enlace absoluto

`href` da una ruta del mismo origen; para compartirla, combínala con el origen de la página:

```html
<script lang="ts">
const props = defineProps<{ id: string }>();
async function copyLink(): Promise<void> {
  const url = new URL(href("/users/[id]", { params: { id: props.id } }), location.origin);
  await navigator.clipboard.writeText(url.href);
}
</script>

<template><button type="button" on:click="copyLink">Copiar enlace</button></template>
```

### En una prueba unitaria, con el manifiesto

```ts
import { createRouteManifest, href } from "@meekojs/meeko/framework";

const routes = createRouteManifest([
  { id: "/users/[id]", file: "app/pages/users/[id].meeko", layouts: [] },
  { id: "/docs/[...slug]", file: "app/pages/docs/[...slug].meeko", layouts: [] },
]);

href(routes, "/users/[id]", { params: { id: "42" } }); // "/users/42"
href(routes, "/docs/[...slug]", { params: { slug: "guia/inicio" } }); // "/docs/guia/inicio"
```

## Errores comunes

### Una ruta que no existe, o con query en el ID

```ts bad
href("/nowhere");
href("/users/[id]?tab=1", { params: { id: "7" } });
```

`meeko check` da `TS2345: Argument of type '"/nowhere"' is not assignable to parameter of type '"/" | "/users/[id]"'.`, con la lista de rutas de la aplicación. Con query en el ID, `TS2769: No overload matches this call.`

<!-- no-check -->
```ts good
href("/users/[id]", { params: { id: "7" }, search: { tab: "1" } });
```

### Olvidar los parámetros, o pasar números

```ts bad
href("/users/[id]");
href("/users/[id]", { params: { id: 7 } });
```

`meeko check` da `TS2554: Expected 2 arguments, but got 1.` y `TS2769: No overload matches this call.` Sin tipos (un ID que llega como `string`), la ejecución lanza `Error: Missing route parameter: id`, también con `id: ""`.

<!-- no-check -->
```ts good
href("/users/[id]", { params: { id: String(user.id) } });
```

### Un `/` en un parámetro simple

Un segmento `[id]` es un solo segmento de la URL: no puede contener `/`.

```ts bad
href("/users/[id]", { params: { id: "equipo/ana" } });
```

En ejecución, `Error: Invalid route parameter: id`. Para rutas con barras, usa un segmento `[...slug]`.

<!-- no-check -->
```ts good
href("/docs/[...slug]", { params: { slug: "equipo/ana" } });
```

### Llamarlo fuera de una aplicación

```ts bad
// scripts/sitemap.ts, ejecutado con node
const url = href("/users/[id]", { params: { id: "1" } });
```

`Error: href(id) needs a running Meeko application (a server request or a mounted browser app); outside one, pass the manifest: href(routes, id)`.

<!-- no-check -->
```ts good
const url = href(routes, "/users/[id]", { params: { id: "1" } });
```

## Notas

- **Tipos.** `RouteId` es la unión de las rutas de `.meeko/types/routes.d.ts`, que generan `meeko check`, `meeko dev` y `meeko routes`; sin esas declaraciones es `string` y la comprobación no ocurre. Una página nueva necesita uno de esos comandos para que su ID sea válido.
- **SSR e hidratación.** El servidor y el navegador construyen la misma URL a partir del mismo manifiesto, así que un `bind:href="href(…)"` hidrata sin diferencias.
- **Seguridad.** Los parámetros se codifican, así que un valor de usuario no puede cambiar la ruta ni añadir una query. Los valores de `search` también se codifican.
- **Enlaces.** Para un `<a>` con `aria-current`, usa `<MeekoLink>`, que llama a `href` y marca la página actual.
