---
title: getRequestContext
group: composables
since: 1.10.0
description: Devuelve el contexto de la petición en curso desde cualquier función de servidor, sin recibirlo como argumento.
symbols:
  - "@meekojs/meeko/server#getRequestContext"
types:
  - "@meekojs/meeko/server#RequestContext"
related:
  - "@meekojs/meeko/server#useRequestState"
  - "@meekojs/meeko/framework#usePage"
  - "@meekojs/meeko/server#defineRpc"
  - "@meekojs/meeko/server#defineApiRoute"
  - docs/framework-auth.md#cookies-de-la-petición
---

Las páginas, los loaders, el middleware de ruta y los handlers de `defineRpc` y `defineApiRoute` reciben el `context` de la petición. Una función que vive varias capas más abajo (el repositorio que crea el cliente de la base de datos con las cookies del usuario, o el helper que exige una sesión) también lo necesita, y pasarlo a mano por cada llamada ensucia todas las firmas. `getRequestContext()` devuelve ese mismo `context` desde cualquier punto del código de servidor de la petición, también después de un `await`.

Es la misma idea que `getRequestEvent()` de SvelteKit o `useRequestEvent()` de Nuxt, sin funciones especiales: `context.cookies`, `context.services` o `context.session`, como en un handler. Se importa de `@meekojs/meeko/server`.

## Uso

<!-- no-check -->

```ts
// server/utils/session.ts
import { getRequestContext, redirect, useRequestState } from "@meekojs/meeko/server";

/** El usuario de la petición, leído una sola vez aunque lo pidan la página y sus RPC. */
export function currentUser(): Promise<User | null> {
  const context = getRequestContext();
  return useRequestState(context, "session:user", () => context.services.auth.getUser());
}

export async function requireUser(): Promise<User> {
  const user = await currentUser();
  if (!user) redirect("/login");
  return user;
}
```

Cualquier loader, handler o middleware de ruta puede llamar a `requireUser()` sin recibir ni pasar el `context`.

## Parámetros

`getRequestContext()` no recibe parámetros.

## Valor devuelto

El `RequestContext` de la petición en curso: el mismo objeto que recibe como `context` la pieza que se está ejecutando. Las llamadas locales a `api.*` y `rpc.*` durante el SSR ven el contexto de esa llamada, que comparte estado, sesión, cookies y `requestId` con el de la página.

## Ejemplos

### Un cliente de base de datos con las cookies del usuario

<!-- no-check -->

```ts
// server/utils/db.ts
import { getRequestContext } from "@meekojs/meeko/server";

export function createDb() {
  const { cookies, services } = getRequestContext();
  return services.database.forSession(cookies.get("session"));
}
```

Cualquier repositorio llama a `createDb()` sin recibir el `context`, y cada petición obtiene el cliente de su propio usuario.

## Errores comunes

### Llamarlo tras la respuesta

Un `setTimeout` o un `waitUntil` sigue ejecutándose cuando la petición ya terminó, y ahí no hay contexto.

<!-- no-check -->

```ts bad
export async function notify(): Promise<void> {
  setTimeout(() => {
    const context = getRequestContext();
    void context.services.mail.send(context.session);
  }, 1000);
}
```

`getRequestContext()` lanza dentro del temporizador. Lee lo que necesites mientras la petición sigue viva y captura sólo esos datos:

<!-- no-check -->

```ts good
export async function notify(): Promise<void> {
  const { services, session } = getRequestContext();
  setTimeout(() => void services.mail.send(session), 1000);
}
```

## Notas

- **Dónde funciona.** En el `<script server>` y el `load` de una página, en el middleware de ruta (`defineServerRouteMiddleware`) y en los handlers, `authorize`, `locals` y `rateLimit.key` de `defineRpc` y `defineApiRoute`.
- **Dónde lanza.** Al cargar un módulo, en `defineServerMiddleware` (corre antes de que exista el contexto), en el `services` de `server/runtime.ts` (que lo construye) y en trabajo que sigue después de la respuesta, como un `setTimeout` o un `waitUntil`: guarda los datos que necesites antes de soltar la petición.
- **Concurrencia.** Cada petición tiene el suyo, aunque varias se atiendan a la vez en el mismo proceso. Se basa en `AsyncLocalStorage`, disponible en Node, Bun, Deno y Cloudflare Workers con `nodejs_compat`.
- **Sólo servidor.** En el `<script>` o la plantilla de un componente es `MEEK108`.
- **Explícito cuando se pueda.** Si la función ya recibe `context`, úsalo; `getRequestContext()` es para el código profundo que no debería conocer el framework.
