---
title: defineServerRouteMiddleware
group: macros
since: 1.6.0
description: Declara un middleware de ruta que sólo se ejecuta en el servidor, con la sesión de la petición, antes del código de servidor de la página.
symbols:
  - "@meekojs/meeko/framework#defineServerRouteMiddleware"
types:
  - "@meekojs/meeko/framework#ServerRouteMiddlewareContext"
related:
  - "@meekojs/meeko/framework#defineRouteMiddleware"
  - "@meekojs/meeko/framework#defineGroup"
  - "@meekojs/meeko/framework#redirect"
  - "@meekojs/meeko/framework#notFound"
  - "@meekojs/meeko/server#defineServerMiddleware"
  - docs/framework.md#middleware-de-ruta-de-servidor
---

`defineServerRouteMiddleware` declara el middleware de ruta que exporta por defecto un archivo `app/middleware/*.server.ts`. Sólo se ejecuta en el servidor, con la sesión de la petición, y nunca llega al bundle del navegador: puede importar `server/`, leer secretos y consultar la base de datos.

Es la forma de expresar «este grupo de páginas exige sesión» sin repetir la comprobación en el `<script server>` de cada una. Sin opciones es global; con `{ global: false }` es un middleware con nombre (`auth.server.ts` es `"auth"`) que las rutas piden con `middleware`. Se autoimporta en los `*.server.ts` y en `server/`.

## Uso

```ts
// app/middleware/auth.server.ts
import { defineServerRouteMiddleware, redirect } from "@meekojs/meeko/framework";

export default defineServerRouteMiddleware(({ session, url }) => {
  if (!session.current) redirect(`/login?next=${encodeURIComponent(url.pathname)}`);
}, { global: false });
```

```ts
// app/pages/(dashboard)/+group.ts
import { defineGroup } from "@meekojs/meeko/framework";

export default defineGroup({ layout: "dashboard", middleware: ["auth"] });
```

Cada página de `(dashboard)` redirige a `/login` sin sesión, en la carga del documento y en cada navegación del navegador.

## Parámetros

| Parámetro | Tipo | Por defecto | Descripción |
| --- | --- | --- | --- |
| `middleware` | `(context: ServerRouteMiddlewareContext) => void \| Response \| Promise<void \| Response>` | obligatorio | La función. Recibe el contexto de `usePage()` (`url`, `params`, `search`, `request`, `signal`, `context`) y, a mano, `session`, `services`, `platform`, `requestId` y `match`. |
| `options` | `{ global?: boolean }` | global | `{ global: false }` lo hace con nombre. **Debe ser un objeto literal.** |

`params` y `search` son los de la URL, todavía sin validar con los schemas de la página. `defineServerRouteMiddleware<Services>` tipa `services`; desde `1.7`, sin argumento de tipo, `services` toma el tipo que Meeko infiere de `server/runtime.ts`.

## Valor devuelto

El mismo middleware, para exportarlo por defecto. Corta la ruta igual que el `<script server>`:

- `redirect(url, status?)` o `notFound()`, que lanzan;
- devolver un `Response`;
- lanzar un error (un `ApiError` con su estado, o cualquier otro como `500`).

Devolver `undefined` continúa.

## Ejemplos

### Un rol, con los servicios de la aplicación

```ts
// app/middleware/admin.server.ts
import { defineServerRouteMiddleware, notFound } from "@meekojs/meeko/framework";

interface Services { readonly roles: { of(userId: string): Promise<string[]> } }

export default defineServerRouteMiddleware<Services>(async ({ session, services }) => {
  const userId = (session.current?.data as { userId?: string } | undefined)?.userId;
  if (!userId || !(await services.roles.of(userId)).includes("admin")) notFound();
}, { global: false });
```

Responder `404` en lugar de `403` no revela que la página existe.

### Global: un registro de cada página

Sin opciones, se ejecuta en todas las rutas con datos del servidor:

```ts
// app/middleware/10-audit.server.ts
import { defineServerRouteMiddleware } from "@meekojs/meeko/framework";

export default defineServerRouteMiddleware(({ requestId, url, context }) => {
  console.info(`[${requestId}] ${url.pathname} desde ${context.clientAddress ?? "desconocida"}`);
});
```

### Junto a uno isomórfico

El isomórfico (`app/middleware/signed-in-hint.ts`) redirige en el navegador sin pedir nada; el de servidor (`auth.server.ts`) protege los datos. Un grupo puede pedir los dos; el isomórfico siempre se ejecuta antes:

```ts
// app/pages/(dashboard)/+group.ts
import { defineGroup } from "@meekojs/meeko/framework";

export default defineGroup({ middleware: ["signed-in-hint", "auth"] });
```

## Errores comunes

### Olvidar importar `redirect`

`redirect` y `notFound` se usan sin import en `<script server>`, pero no en `app/middleware/*.server.ts`. No es un descuido: los tipos de los autoimports son declaraciones globales de todo el proyecto `server` de TypeScript, que incluye `server/api`. Declararlos para el middleware los declararía también en las API, donde no hay página en curso y fallarían en ejecución con `MEEK073` en lugar de dar este error de tipos.

```ts bad
// app/middleware/auth.server.ts
export default defineServerRouteMiddleware(({ session }) => {
  if (!session.current) redirect("/login");
}, { global: false });
```

`meeko check` da `TS2304: Cannot find name 'redirect'.`

<!-- no-check -->
```ts good
// app/middleware/auth.server.ts
import { redirect } from "@meekojs/meeko/framework";

export default defineServerRouteMiddleware(({ session }) => {
  if (!session.current) redirect("/login");
}, { global: false });
```

### Usarlo en un archivo sin `.server`

```ts bad
// app/middleware/auth.ts
export default defineServerRouteMiddleware(() => {}, { global: false });
```

`defineServerRouteMiddleware sólo se admite en un archivo *.server.ts de app/middleware, que nunca llega al navegador; renombra el archivo a auth.server.ts`.

<!-- no-check -->
```ts good
// app/middleware/auth.server.ts
export default defineServerRouteMiddleware(() => {}, { global: false });
```

### Un helper en `app/middleware/*.server.ts`

Desde `1.6`, todo `*.server.ts` de `app/middleware` es middleware de servidor.

```ts bad
// app/middleware/cookies.server.ts
export function parseCookies(header: string) { return header.split("; "); }
```

`un middleware de ruta de servidor debe exportar por defecto defineServerRouteMiddleware(...); desde 1.6, los archivos *.server.ts de app/middleware son middleware de ruta de servidor, así que mueve los helpers a server/utils`.

```ts good
// server/utils/cookies.ts
export function parseCookies(header: string): string[] { return header.split("; "); }
```

### Pedirlo en una página prerenderizada o `"client"`

Esas páginas no piden sus datos al servidor en cada visita: no hay sesión que comprobar.

```ts bad
export const route = definePage({ render: "prerender", middleware: ["auth"] });
```

`el middleware de servidor "auth" (…/auth.server.ts) necesita una página con datos del servidor, pero …/reports.meeko usa render: "prerender" y se renderiza al hacer el build, sin la petición ni la sesión de cada visitante. Usa render: "ssr" o "stream", o quítalo de esa página con middleware: false`.

<!-- no-check -->
```ts good
export const route = definePage({ render: "ssr", middleware: ["auth"] });
```

## Notas

- **Cuándo se ejecuta.** En la petición del documento y, al navegar, en la petición de datos de la página, antes del `<script server>` o el `load`; en `render: "stream"`, antes del primer byte. Una redirección llega al navegador como la de un `redirect()` de la página.
- **Orden.** Primero el middleware isomórfico (globales y con nombre) y después el de servidor (globales y con nombre, en el orden declarado). El primero que corta detiene la ruta.
- **Páginas sin servidor.** No se ejecuta en `render: "client"` ni `"prerender"`; los globales de servidor tampoco, ni en su primera carga. El adaptador `static` avisa de que no los ejecuta.
- **Seguridad.** Nunca llega al navegador: el plugin de Vite rechaza cualquier `*.server.*` en su grafo. Pero sólo protege páginas: `server/api` y el RPC necesitan sus propias guardas (`auth: "required"`), aunque sólo los llamen páginas protegidas.
- **Caché.** Con `cache` en `definePage` (desde `1.7`), el middleware se ejecuta siempre antes del `304` o de la copia en memoria.
- **Nombres.** `auth.ts` y `auth.server.ts` con nombre a la vez son un nombre duplicado y detienen el descubrimiento.
