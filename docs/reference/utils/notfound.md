---
title: notFound
group: utils
since: 1.1.0
description: Detiene el código de servidor de la página o un middleware de ruta de servidor y muestra la página de error más cercana con estado 404.
symbols:
  - "@meekojs/meeko/framework#notFound"
related:
  - "@meekojs/meeko/framework#redirect"
  - "@meekojs/meeko/framework#usePage"
  - "@meekojs/meeko/server#ApiError"
  - "syntax:script-server"
  - docs/framework.md#código-de-nivel-superior-y-datos-exportados
  - docs/framework.md#página-de-error-de-la-aplicación-apperrormeeko
---

`notFound()` detiene el código de nivel superior del `<script server>` de una página y responde `404` con la página de error más cercana (`+error.meeko` de la carpeta, o `app/error.meeko`), que recibe `{ status: 404, message: "NOT_FOUND" }`. Desde `1.6`, también corta un middleware de ruta de servidor.

Funciona lanzando y su tipo de retorno es `never`: después de `if (!row) notFound()`, TypeScript sabe que `row` existe. Dentro de `<script server>` se usa sin import.

## Uso

```html
<!-- app/pages/users/[id].meeko -->
<script server lang="ts">
const { params } = usePage();
const row = await findUser(params.id);
if (!row) notFound();
export const user = { id: row.id, name: row.name };
</script>

<template><h1>{user.name}</h1></template>
```

## Parámetros

No recibe parámetros.

## Valor devuelto

Nunca devuelve (`never`). Lanza un error que el servidor trata como un `ApiError("NOT_FOUND", 404)`:

- en SSR, la respuesta es `404` con la página de error más cercana;
- en una navegación del cliente, la petición de datos responde `404` y el navegador muestra el `+error.meeko` más cercano, o `app/error.meeko`, dentro de los layouts de la página.

Fuera de su sitio lanza `Error: MEEK073: notFound() sólo está disponible mientras se ejecuta el código de nivel superior del <script server> de una página o, desde 1.6, un middleware de ruta de servidor`.

## Ejemplos

### Ocultar una página a quien no tiene permiso

Responder `404` en lugar de `403` no revela que el recurso existe:

```html
<!-- app/pages/projects/[id].meeko -->
<script server lang="ts">
const { params, context } = usePage();
const project = await findUser(params.id);
if (!project || !context.session.current) notFound();
export const summary = { id: project.id, name: project.name };
</script>

<template><h1>{summary.name}</h1></template>
```

### Una página de error para una sección

```html
<!-- app/pages/users/+error.meeko -->
<script lang="ts">
const props = defineProps<{ status: number; message: string }>();
</script>

<template>
  <h1 if:when="props.status === 404">Ese usuario no existe</h1>
  <h1 if:when="props.status !== 404">Algo ha fallado ({props.message})</h1>
  <MeekoLink to="/">Volver al inicio</MeekoLink>
</template>
```

### Desde un loader

`notFound()` no funciona dentro de `load`. Allí se lanza un `ApiError` con el mismo efecto:

<!-- no-check -->
```ts
// app/pages/products/[slug].route.ts
import { definePage } from "@meekojs/meeko/framework";
import { ApiError } from "@meekojs/meeko/server";

export const route = definePage({
  load: async ({ params }) => {
    const product = await catalog.find(params.slug);
    if (!product) throw new ApiError("NOT_FOUND", 404);
    return { name: product.name };
  },
});
```

## Errores comunes

### Llamarlo dentro de `load`

```ts bad
export const route = definePage({ load: ({ params }) => { if (!params.id) notFound(); return { id: 1 }; } });
```

`MEEK073: notFound() sólo funciona en el código de nivel superior de <script server>, que se ejecuta en cada petición; llámala fuera de cualquier función y fuera de las opciones de ruta`.

<!-- no-check -->
```ts good
export const route = definePage({ load: ({ params }) => { if (!params.id) throw new ApiError("NOT_FOUND", 404); return { id: 1 }; } });
```

### Llamarlo en el `<script>` del componente

```html bad
<script lang="ts">
if (!props.user) notFound();
</script>
```

`MEEK073: notFound() sólo funciona en el código de nivel superior del <script server> de una página: el <script> y la plantilla de un componente también se ejecutan en el navegador`. Decide el `404` en el servidor, antes de renderizar.

```html good
<script server lang="ts">
const row = await findUser(usePage().params.id);
if (!row) notFound();
export const user = { id: row.id, name: row.name };
</script>
```

### Devolver `null` en lugar de responder `404`

Una página que pinta «No encontrado» con estado `200` es una página válida para los buscadores y las cachés, sin ningún error.

```html bad
<script server lang="ts">
const row = await findUser(usePage().params.id);
export const user = row ? { id: row.id, name: row.name } : null;
</script>
```

```html good
<script server lang="ts">
const row = await findUser(usePage().params.id);
if (!row) notFound();
export const user = { id: row.id, name: row.name };
</script>
```

## Notas

- **Página de error.** Se usa el `+error.meeko` más cercano a la página o, si no hay, `app/error.meeko`. Ambos reciben `status` y `message`; `meeko check` comprueba que los aceptan.
- **SEO.** El estado `404` evita que los buscadores indexen la URL y que una caché la guarde como una página normal.
- **`try`.** Como `redirect`, funciona lanzando: no lo envuelvas en un `try` que se trague el error.
- **API y RPC.** En un endpoint, el equivalente es `throw new ApiError("NOT_FOUND", 404)`, que el cliente recibe como `ClientError` con `status` `404`.
