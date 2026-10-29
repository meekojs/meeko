---
title: redirect
group: utils
since: 1.1.0
description: Detiene el código de servidor de la página o un middleware de ruta de servidor y responde con una redirección, que la navegación del cliente sigue igual.
symbols:
  - "@meekojs/meeko/framework#redirect"
related:
  - "@meekojs/meeko/framework#notFound"
  - "@meekojs/meeko/framework#usePage"
  - "@meekojs/meeko/framework#href"
  - "@meekojs/meeko/framework#defineServerRouteMiddleware"
  - "syntax:script-server"
  - docs/framework.md#código-de-nivel-superior-y-datos-exportados
  - docs/framework.md#middleware-de-ruta-de-servidor
---

`redirect(url, status?)` detiene el código de nivel superior del `<script server>` de una página y responde con una redirección. Desde `1.6`, también corta un middleware de ruta de servidor (`app/middleware/*.server.ts`). En SSR es una respuesta `302` (por defecto) con `Location`; en la navegación del cliente, el navegador la sigue igual que la de un loader.

Funciona lanzando: el código que sigue a `redirect()` no se ejecuta, y su tipo de retorno es `never`, así que TypeScript estrecha los tipos después de la llamada. Dentro de `<script server>` se usa sin import.

## Uso

```html
<!-- app/pages/account.meeko -->
<script server lang="ts">
const { context, url } = usePage();
const session = context.session.current;
if (!session) redirect(`/login?next=${encodeURIComponent(url.pathname)}`);
export const account = { id: session.id };
</script>

<template><h1>Cuenta {account.id}</h1></template>
```

Después del `if`, `session` ya no es `undefined`.

## Parámetros

| Parámetro | Tipo | Por defecto | Descripción |
| --- | --- | --- | --- |
| `url` | `string \| URL` | obligatorio | El destino: una ruta (`"/login"`) o una URL absoluta. |
| `status` | `301 \| 302 \| 303 \| 307 \| 308` | `302` | El estado HTTP. `301` y `308` son permanentes (el navegador y las cachés los recuerdan); `303` cambia el método a `GET`; `307` y `308` lo conservan. |

## Valor devuelto

Nunca devuelve (`never`): lanza una respuesta con `Location` y `cache-control: no-store`, que el servidor envía tal cual. Lanza otros errores en dos casos:

- fuera de su sitio, `Error: MEEK073: redirect() sólo está disponible mientras se ejecuta el código de nivel superior del <script server> de una página o, desde 1.6, un middleware de ruta de servidor`;
- con otro estado, `RangeError: redirect status must be 301, 302, 303, 307 or 308, not 404`.

## Ejemplos

### Una URL antigua, con redirección permanente

```html
<!-- app/pages/blog/[slug].meeko -->
<script server lang="ts">
const renamed: Record<string, string> = { "hola-mundo": "hola-meeko" };
const { params } = usePage();
const target = renamed[params.slug];
if (target) redirect(href("/blog/[slug]", { params: { slug: target } }), 301);
export const post = { slug: params.slug };
</script>

<template><h1>{post.slug}</h1></template>
```

### Desde un middleware de ruta de servidor

En `app/middleware/*.server.ts`, `redirect` se importa:

```ts
// app/middleware/auth.server.ts
import { defineServerRouteMiddleware, redirect } from "@meekojs/meeko/framework";

export default defineServerRouteMiddleware(({ session, url }) => {
  if (!session.current) redirect(`/login?next=${encodeURIComponent(url.pathname)}`);
}, { global: false });
```

### Desde un loader, devolviendo un `Response`

`redirect()` no funciona dentro de `load`, que es una opción de ruta. Allí se devuelve un `Response`:

<!-- no-check -->
```ts
// app/pages/legacy.route.ts
import { definePage } from "@meekojs/meeko/framework";

export const route = definePage({
  load: ({ url }) => Response.redirect(new URL("/nuevo", url), 301),
});
```

## Errores comunes

### Llamarlo en el `<script>` del componente

```html bad
<script lang="ts">
const go = () => redirect("/login");
</script>
```

`MEEK073: redirect() sólo funciona en el código de nivel superior del <script server> de una página: el <script> y la plantilla de un componente también se ejecutan en el navegador`. En el componente, navega con un enlace o con `location.assign`.

```html good
<script server lang="ts">
const { context } = usePage();
if (!context.session.current) redirect("/login");
export const ok = true;
</script>
```

### Llamarlo dentro de `load` u otra opción de ruta

```ts bad
export const route = definePage({ load: ({ params }) => { if (!params.id) redirect("/"); return { id: params.id }; } });
```

`MEEK073: redirect() sólo funciona en el código de nivel superior de <script server>, que se ejecuta en cada petición; llámala fuera de cualquier función y fuera de las opciones de ruta`.

<!-- no-check -->
```ts good
export const route = definePage({ load: ({ params, url }) => params.id ? { id: params.id } : Response.redirect(new URL("/", url)) });
```

### Un estado que no es de redirección

```ts bad
redirect("/login", 404);
```

`meeko check` del proyecto da `TS2345: Argument of type '404' is not assignable to parameter of type '301 | 302 | 303 | 307 | 308 | undefined'.` En ejecución, `RangeError: redirect status must be 301, 302, 303, 307 or 308, not 404`. Para un `404`, usa `notFound()`.

<!-- no-check -->
```ts good
redirect("/login", 303);
```

### Envolverlo en `try`

`redirect` funciona lanzando: un `catch` que no vuelve a lanzar se traga la redirección, sin ningún error.

```ts bad
try {
  if (!session) redirect("/login");
  data = await load();
} catch {
  data = null;
}
```

<!-- no-check -->
```ts good
if (!session) redirect("/login");
try {
  data = await load();
} catch {
  data = null;
}
```

## Notas

- **Seguridad.** No redirijas a una URL que llega en la petición sin comprobarla (`?next=https://otro.example`): es una redirección abierta. Comprueba que empieza por `/` y no por `//`, o construye el destino con `href`.
- **Caché.** La respuesta lleva `cache-control: no-store`: una redirección que depende de la sesión nunca se guarda en una caché compartida.
- **Navegación.** En el navegador, la petición de datos de la página recibe la redirección y la navegación la sigue sin recargar, como la de un loader.
- **`render: "client"` y `"prerender"`.** No hay código de nivel superior en el servidor en esas páginas; usa el middleware de ruta isomórfico, que devuelve `Response.redirect(…)`.
