---
title: defineRouteMiddleware
group: macros
since: 1.0.0
description: Declara un middleware de ruta de app/middleware, global o con nombre, que se ejecuta antes de la página en SSR y en cada navegación del navegador.
symbols:
  - "@meekojs/meeko/framework#defineRouteMiddleware"
types:
  - "@meekojs/meeko/framework#RouteMiddlewareContext"
  - "@meekojs/meeko/framework#RouteMiddlewareOptions"
related:
  - "@meekojs/meeko/framework#defineServerRouteMiddleware"
  - "@meekojs/meeko/framework#defineGroup"
  - "@meekojs/meeko/framework#definePage"
  - "@meekojs/meeko/server#defineServerMiddleware"
  - docs/framework.md#middleware-de-rutas-y-servidor
  - docs/framework.md#middleware-con-nombre
---

`defineRouteMiddleware` declara el middleware de ruta que exporta por defecto un archivo de `app/middleware/`. Se ejecuta antes de las opciones de ruta y del loader de la página: en el servidor durante el SSR y en el navegador en cada navegación, con el mismo código. Devolver `undefined` continúa; devolver un `Response` (una redirección, normalmente) detiene la ruta.

Hay dos clases:

- **Global** (sin opciones): se ejecuta en todas las rutas, por orden de nombre de archivo.
- **Con nombre** (desde `1.6`, `{ global: false }`): sólo en las rutas que lo piden con `middleware` en `definePage` o en un `+group.ts`. El nombre es el del archivo sin `.ts` ni prefijo numérico: `10-auth.ts` es `"auth"`.

Se autoimporta. Es **isomórfico**: también llega al bundle del navegador.

## Uso

```ts
// app/middleware/auth.ts
import { defineRouteMiddleware } from "@meekojs/meeko/framework";

export default defineRouteMiddleware(({ url, phase, request }) => {
  // Una cookie pública que indica la sesión: la cookie de sesión de Meeko es HttpOnly.
  const cookies = phase === "server" ? request?.headers.get("cookie") ?? "" : document.cookie;
  if (!cookies.includes("signed-in=1")) {
    const login = new URL("/login", url);
    login.searchParams.set("next", url.pathname);
    return Response.redirect(login);
  }
}, { global: false });
```

Las páginas que lo piden con `definePage({ middleware: ["auth"] })` o un `+group.ts` redirigen a `/login` sin la cookie.

## Parámetros

| Parámetro | Tipo | Por defecto | Descripción |
| --- | --- | --- | --- |
| `middleware` | `(context: RouteMiddlewareContext) => void \| Response \| Promise<void \| Response>` | obligatorio | La función. Recibe `url`, `match` (la ruta y sus `params`), `signal` (se aborta si la navegación se cancela), `phase` (`"server"` o `"client"`) y `request`, que sólo existe en el servidor. |
| `options` | `{ global?: boolean }` | global | Desde `1.6`. `{ global: false }` lo hace con nombre. **Debe ser un objeto literal**: Meeko lo lee sin ejecutar el archivo. |

## Valor devuelto

El mismo middleware, para exportarlo por defecto. Lo que hace cada resultado:

| Resultado | En el servidor | En el navegador |
| --- | --- | --- |
| `undefined` | Continúa con el siguiente middleware y la página | Igual |
| `Response.redirect(url)` | Responde con la redirección | `location.assign` con la URL: una carga de página nueva |
| Otro `Response` | Lo responde | Cancela la navegación y la entrega a `onNavigationError` |
| Un error | Página de error | Cancela la navegación |

## Ejemplos

### Global, limitado a una ruta

Un middleware global puede decidir por la ruta con `match.route.id`:

```ts
// app/middleware/10-locale.ts
import { defineRouteMiddleware } from "@meekojs/meeko/framework";

export default defineRouteMiddleware(({ url, match }) => {
  if (match.route.id !== "/dashboard") return;
  if (!url.searchParams.has("locale")) {
    const target = new URL(url);
    target.searchParams.set("locale", "es");
    return Response.redirect(target);
  }
});
```

### Pedirlo desde un grupo y desde una página

```ts
// app/pages/(dashboard)/+group.ts
import { defineGroup } from "@meekojs/meeko/framework";

export default defineGroup({ layout: "dashboard", middleware: ["auth"] });
```

```html
<!-- app/pages/(dashboard)/admin/users.meeko -->
<script server lang="ts">
export const route = definePage({ middleware: ["admin"] });
</script>
<template><h1>Usuarios</h1></template>
```

`/admin/users` ejecuta los globales, después `auth` (del grupo) y después `admin` (de la página). `middleware: false` quita los heredados.

### Mantenimiento programado

Un middleware global puede cortar todas las rutas salvo una:

```ts
// app/middleware/00-maintenance.ts
import { defineRouteMiddleware } from "@meekojs/meeko/framework";

const until = Date.parse("2026-11-01T06:00:00Z");

export default defineRouteMiddleware(({ url, match }) => {
  if (Date.now() < until && match.route.id !== "/maintenance") return Response.redirect(new URL("/maintenance", url));
});
```

## Errores comunes

### Pedir un middleware que no existe

```ts bad
export const route = definePage({ middleware: ["auth", "admn"] });
```

`meeko check`, `meeko dev` y `meeko build` se detienen con `el middleware "admn" no existe; crea app/middleware/admn.ts con defineRouteMiddleware(..., { global: false }) (middleware con nombre disponibles: "admin", "auth"), o app/middleware/admn.server.ts con defineServerRouteMiddleware para uno que sólo se ejecuta en el servidor`.

<!-- no-check -->
```ts good
export const route = definePage({ middleware: ["auth", "admin"] });
```

### Pedir por nombre un middleware global

```ts bad
// app/middleware/10-locale.ts, sin opciones
export default defineRouteMiddleware(() => {});
// app/pages/(dashboard)/+group.ts
export default defineGroup({ middleware: ["locale"] });
```

`el middleware "locale" (…/10-locale.ts) es global y ya se ejecuta en todas las rutas; quítalo de middleware o decláralo con defineRouteMiddleware(..., { global: false })`.

<!-- no-check -->
```ts good
export default defineRouteMiddleware(() => {}, { global: false });
```

### Usarlo en un `*.server.ts`

```ts bad
// app/middleware/auth.server.ts
export default defineRouteMiddleware(() => {}, { global: false });
```

`un archivo *.server.ts de app/middleware es middleware de ruta de servidor; decláralo con defineServerRouteMiddleware en lugar de defineRouteMiddleware`.

<!-- no-check -->
```ts good
// app/middleware/auth.server.ts
import { redirect } from "@meekojs/meeko/framework";

export default defineServerRouteMiddleware(({ session }) => {
  if (!session.current) redirect("/login");
}, { global: false });
```

### Confiar en él como autorización

El middleware de ruta isomórfico viaja al navegador y no lee la sesión (su cookie es HttpOnly). Un usuario puede saltárselo pidiendo los datos a la API: no hay ningún error que lo señale.

```ts bad
// app/middleware/admin.ts: la única comprobación del rol
export default defineRouteMiddleware(({ url }) => {
  if (!document.cookie.includes("role=admin")) return Response.redirect(new URL("/", url));
}, { global: false });
```

<!-- no-check -->
```ts good
// app/middleware/admin.server.ts: en el servidor, con la sesión
export default defineServerRouteMiddleware(({ session, url }) => {
  if ((session.current?.data as { role?: string } | undefined)?.role !== "admin") return Response.redirect(new URL("/", url));
}, { global: false });
```

Y en la API, `auth: "required"` y la comprobación del rol en el handler.

## Notas

- **Servidor y navegador.** El mismo archivo se ejecuta en el SSR (`phase: "server"`, con `request`) y en la navegación del cliente (`phase: "client"`, sin `request`). No importes `server/` ni secretos: viajan en el bundle. La hidratación no lo ejecuta: el servidor ya lo hizo.
- **Orden.** Primero los globales, por nombre de archivo; después los con nombre de la ruta, en el orden declarado (grupos de fuera hacia dentro y la página); y después los de servidor (`*.server.ts`). El primero que devuelve un `Response` detiene la ruta.
- **Bundle.** Los globales van con la entrada del navegador; cada middleware con nombre es un chunk que se carga la primera vez que se navega a una de sus rutas.
- **Seguridad.** Mejora la navegación (redirige sin pedir nada), pero nunca sustituye a la autorización del loader, la API o el RPC. Para proteger una página con la sesión, usa `defineServerRouteMiddleware`.
- **Exclusiones.** Los `*.test.ts`, `*.spec.ts`, `*.d.ts` y `*.client.ts` de `app/middleware` no son middleware. Sólo cuenta `app/middleware` del proyecto, no el de los layers.
