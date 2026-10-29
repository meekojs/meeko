---
title: useRequestState
group: composables
since: 1.0.0
description: Guarda un valor en el estado de una petición del servidor y lo crea la primera vez, para compartirlo entre middleware, loaders y handlers de esa petición.
symbols:
  - "@meekojs/meeko/server#useRequestState"
types:
  - "@meekojs/meeko/server#RequestContext"
related:
  - "@meekojs/meeko/framework#usePage"
  - "@meekojs/meeko/framework#useState"
  - "@meekojs/meeko/server#defineServerMiddleware"
  - "@meekojs/meeko/server#defineRpc"
  - "@meekojs/meeko/server#defineApiRoute"
  - docs/framework.md#valores-por-petición-locals
  - docs/framework.md#runtime-de-servidor
---

Una petición pasa por varias piezas de servidor: el middleware de ruta, el código de `<script server>` o el `load` de la página, y las llamadas a `api.*` y `rpc.*` que hace el SSR, que se despachan localmente con el mismo contexto. `useRequestState(context, key, factory)` guarda un valor en `context.state`, el `Map` de esa petición: la primera pieza que pide `key` lo crea con `factory()` y las demás reciben el mismo valor. Sirve para una caché por petición (no consultar dos veces el mismo usuario), un cargador por lotes o un contador.

Al terminar la petición, el valor desaparece con ella: nunca se comparte entre usuarios. Es código de servidor: se importa de `@meekojs/meeko/server`.

## Uso

<!-- no-check -->
```ts
// server/rpc/users/get.ts
import { defineRpc, useRequestState } from "@meekojs/meeko/server";
import { userParams, userSchema } from "../../../shared/schemas/users.js";

export default defineRpc({
  input: userParams,
  output: userSchema,
  handler: async ({ input, context }) => {
    const cache = useRequestState(context, "users:byId", () => new Map<string, Promise<{ id: string; name: string }>>());
    let user = cache.get(input.id);
    if (!user) {
      user = context.services.db.users.findById(input.id);
      cache.set(input.id, user);
    }
    return user;
  },
});
```

Si una página pide el mismo usuario en dos componentes durante el SSR, la base de datos sólo recibe una consulta.

## Parámetros

| Parámetro | Tipo | Por defecto | Descripción |
| --- | --- | --- | --- |
| `context` | `RequestContext` | obligatorio | El contexto de la petición: el `context` de un handler, de `load`, del middleware o de `usePage()`. |
| `key` | `string` | obligatorio | Clave del valor dentro de la petición. Usa un prefijo propio (`"users:byId"`) para no chocar con otras piezas. |
| `factory` | `() => T` | obligatorio | Crea el valor si la clave no existe todavía en esta petición. |

## Valor devuelto

El valor `T` de esa clave en la petición. No es una señal ni viaja al navegador.

## Ejemplos

### Compartir con la página lo que calculó el middleware

<!-- no-check -->
```ts
// app/middleware/01-tenant.server.ts
import { useRequestState } from "@meekojs/meeko/server";

export default defineServerRouteMiddleware(async ({ context, url }) => {
  const host = url.hostname;
  const tenant = await context.services.db.tenants.byHost(host);
  useRequestState(context, "tenant", () => tenant);
});
```

```html
<!-- app/pages/index.meeko -->
<script server lang="ts">
import { useRequestState } from "@meekojs/meeko/server";
const { context } = usePage();
const tenant = useRequestState(context, "tenant", () => null as { id: string; name: string } | null);
export const brand = tenant?.name ?? "Mi tienda";
</script>

<template><h1>{brand}</h1></template>
```

### Un helper tipado

Repetir la clave y el tipo en cada llamada es frágil. Un helper los fija en un solo sitio:

```ts
// server/utils/request-cache.ts
import { useRequestState } from "@meekojs/meeko/server";
import type { RequestContext } from "@meekojs/meeko/server";

export function requestCache<T>(context: RequestContext, name: string): Map<string, T> {
  return useRequestState(context, `cache:${name}`, () => new Map<string, T>());
}
```

### Contar consultas en desarrollo

```ts
import { useRequestState } from "@meekojs/meeko/server";
import type { RequestContext } from "@meekojs/meeko/server";

export function countQuery(context: RequestContext): number {
  const counter = useRequestState(context, "debug:queries", () => ({ value: 0 }));
  return ++counter.value;
}
```

Como `factory` devuelve un objeto, cada llamada recibe el mismo y puede modificarlo.

## Errores comunes

### Usarlo en el `<script>` del componente

```html bad
<script lang="ts">
import { useRequestState } from "@meekojs/meeko/server";
</script>
```

`meeko check` da `MEEK108: @meekojs/meeko/server sólo existe en el servidor y no se puede cargar en el navegador: el <script> y la plantilla de un componente también se ejecutan en el navegador. Mueve ese código a <script server> o a server/; para usar sus tipos, impórtalos con import type`. Para estado del componente que viaja al navegador, usa [`useState`](/docs/reference/usestate); para datos del servidor, expórtalos desde `<script server>`:

```html good
<script server lang="ts">
import { useRequestState } from "@meekojs/meeko/server";
const { context } = usePage();
export const tenantName = useRequestState(context, "tenant", () => ({ name: "Mi tienda" })).name;
</script>
```

### Una variable de módulo como caché

```ts bad
// server/utils/users.ts
const cache = new Map<string, User>();
export const findUser = (id: string) => cache.get(id) ?? loadUser(id);
```

No hay error, pero el `Map` vive en el proceso: lo comparten todas las peticiones y todos los usuarios, crece sin límite y puede devolver a un usuario datos de otro. Guarda la caché en la petición:

<!-- no-check -->
```ts good
export const findUser = (context: RequestContext, id: string) =>
  useRequestState(context, "users", () => new Map<string, Promise<User>>()).get(id) ?? loadUser(id);
```

### La misma clave con tipos distintos

```ts bad
useRequestState(context, "user", () => session.userId);         // string
const user = useRequestState(context, "user", () => loadUser()); // espera un User
```

`useRequestState` no conoce el tipo guardado: la segunda llamada recibe el texto que guardó la primera, con el tipo `User`, y falla más adelante. Usa claves distintas, o un helper con la clave y el tipo fijos como el de arriba.

<!-- no-check -->
```ts good
useRequestState(context, "user:id", () => session.userId);
```

## Notas

- **Una petición.** El estado vive en `context.state`, un `Map` nuevo por petición. Las llamadas locales de `api.*` y `rpc.*` durante el SSR de esa página usan el mismo contexto, así que comparten el estado; una petición HTTP posterior del navegador tiene el suyo.
- **No viaja.** Nada de lo que guardas llega al navegador. Para estado de la página que el navegador necesita, exporta un dato desde `<script server>` o usa `useState`.
- **Sólo servidor.** Se importa de `@meekojs/meeko/server`; en el `<script>` y la plantilla de un componente es `MEEK108`.
- **Promesas.** Guarda la promesa, no el resultado, si dos piezas pueden pedir el mismo valor a la vez: la segunda espera a la primera en lugar de lanzar otra consulta.
