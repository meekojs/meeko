---
title: createFrameworkHandler
group: advanced
since: 1.0.0
description: Crea un handler Fetch que renderiza las páginas de la aplicación (middleware de ruta, validación, loader, SSR, payload de navegación y páginas de error) para un host propio.
symbols:
  - "@meekojs/meeko/server#createFrameworkHandler"
types:
  - "@meekojs/meeko/server#FrameworkHandlerOptions"
  - "@meekojs/meeko/server#DocumentOptions"
related:
  - "@meekojs/meeko/server#createServerApp"
  - "@meekojs/meeko/server#createServerDispatcher"
  - "@meekojs/meeko/server#createRequestContext"
  - "@meekojs/meeko/framework#mountClientApp"
  - "@meekojs/meeko/build#prerenderRoutes"
  - docs/framework.md#routing-layouts-y-ssr
  - docs/framework.md#plugins-de-aplicación
---

`createFrameworkHandler` es la parte de páginas de [`createServerApp`](/docs/reference/createserverapp), separada para hosts propios: recibe el manifiesto de rutas y los cargadores de módulos y devuelve un handler `(request) => Promise<Response>` que hace todo lo que necesita una página: middleware de ruta (isomórfico y de servidor), validación de `params` y `search`, el loader o el `<script server>`, el render SSR (también `"stream"` y `"client"`), el payload de navegación (`Accept: application/meeko+json`), los layouts y las páginas de error.

No atiende API, RPC, Socket ni archivos, no ejecuta el middleware de `server/middleware` ni crea sesiones: eso es del host o de `createServerApp`.

## Uso

```ts
import { createFrameworkHandler } from "@meekojs/meeko/server";
import type { PageModule } from "@meekojs/meeko/server";

const hello: PageModule = {
  renderWithState: (props) => ({ html: `<h1>Hola, ${String((props.params as Record<string, string>).name)}</h1>`, state: {} }),
};

const handlePage = createFrameworkHandler({
  routes: [{ id: "/hello/[name]", file: "app/pages/hello/[name].meeko", layouts: [] }],
  loadPage: async () => hello,
  clientEntry: "/assets/entry-client.js",
});

const response = await handlePage(new Request("http://localhost/hello/ada", { headers: { accept: "text/html" } }));
console.log(response.status, response.headers.get("content-type")); // 200 text/html; charset=utf-8
```

## Opciones

| Opción | Tipo | Por defecto | Descripción |
| --- | --- | --- | --- |
| `routes` | `RouteRecord[]` | obligatorio | El manifiesto de rutas, el mismo que recibe `mountClientApp`. |
| `loadPage` | `(file) => Promise<PageModule>` | obligatorio | Carga el módulo compilado de una página, un layout o una página de error por su archivo. |
| `loadRoute` | `(file) => Promise<PageRoute>` | ninguno | Carga las opciones de ruta (`definePage`) de un sidecar o de un `<script server>`. |
| `errorPage` | `ErrorPageRecord` | ninguno | Desde `1.1`. `app/error.meeko` y sus layouts: una URL sin ruta se renderiza con estado `404`, y una ruta sin `+error.meeko` que falla la usa. |
| `loadMiddleware` | `() => Promise<RouteMiddleware[]>` | ninguno | Middleware de ruta global, antes del loader en todas las rutas. |
| `loadNamedMiddleware` | `(file) => Promise<RouteMiddleware>` | ninguno | Desde `1.6`. Middleware con nombre de `RouteRecord.middleware`. Una ruta que lo declara y no tiene cargador falla. |
| `loadServerMiddleware` | `(file) => Promise<ServerRouteMiddleware>` | ninguno | Desde `1.6`. Middleware de ruta de servidor de `RouteRecord.serverMiddleware`. Igual: sin cargador, la ruta falla. |
| `createContext` | `(request) => RequestContext` | ninguno | Contexto de cada petición (sesión, servicios, plataforma) para `usePage().context` y los loaders. |
| `serverFetch` | `ServerFetch` | ninguno | Despachador local de las llamadas `api.*` y `rpc.*` durante el SSR, como `createLocalServerFetch`. |
| `clientEntry` | URL | ninguna | Entrada del cliente que enlaza el documento. Sin ella, la página no hidrata. |
| `document` | `DocumentOptions` | ninguno | HTML de confianza para `<head>` y `</body>`, el nonce y el `document` de la configuración. |
| `plugins` | `PluginRegistration[]` | ninguno | Desde `1.2`. Plugins de aplicación, una vez por petición de página antes del render. |
| `onError` | `(error, requestId) => void` | consola | Fallos internos de las páginas; nunca llegan al navegador. |

## Valor devuelto

`(request: Request) => Promise<Response>`. Según la petición y la ruta:

| Petición | Respuesta |
| --- | --- |
| `Accept: text/html` a una ruta | `200` con el documento: `<head>`, `#app` con el HTML y `#meeko-payload` con el JSON de hidratación. |
| `Accept: application/meeko+json` a una ruta | `200` con el payload de navegación en `application/meeko+json` (con `"stream"`, un stream NDJSON). |
| Una URL sin ruta | `404 Not Found` en texto, o la página de `errorPage` con estado `404` si se pasó. |
| `params` o `search` inválidos | `400`, antes del loader. |
| Un loader que lanza `ApiError`, `notFound()` o `redirect()` | La página de error más cercana con su estado, o la redirección. |

## Ejemplos

### Páginas con layouts, un sidecar y el payload de navegación

```ts
import { createFrameworkHandler } from "@meekojs/meeko/server";
import type { PageModule, PageRoute } from "@meekojs/meeko/server";

const page = (html: string): PageModule => ({ renderWithState: () => ({ html, state: {} }) });
const pages: Record<string, PageModule> = { "app/pages/index.meeko": page("<h1>Inicio</h1>") };
const sidecars: Record<string, PageRoute> = { "app/pages/index.route.ts": { head: () => ({ title: "Inicio" }) } };

const handlePage = createFrameworkHandler({
  routes: [{ id: "/", file: "app/pages/index.meeko", layouts: [], sidecar: "app/pages/index.route.ts" }],
  loadPage: async (file) => pages[file]!,
  loadRoute: async (file) => sidecars[file]!,
  clientEntry: "/assets/entry-client.js",
});

const data = await handlePage(new Request("http://localhost/", { headers: { accept: "application/meeko+json" } }));
console.log(data.headers.get("content-type")); // application/meeko+json; charset=utf-8
```

### Con sesión y servicios

<!-- no-check -->
```ts
import { createFrameworkHandler, createLocalServerFetch, createRequestContext } from "@meekojs/meeko/server";

const handlePage = createFrameworkHandler({
  routes, errorPage, loadPage, loadRoute,
  createContext: async (request) => createRequestContext(request, { db }, await sessions.load(request)),
  serverFetch: createLocalServerFetch({ manifest: serverManifest, sessions, services: { db }, load }),
  clientEntry: "/assets/entry-client.js",
});
```

`serverFetch` hace que `await api.users.list()` dentro de una página no salga a la red durante el SSR.

## Errores comunes

### Una ruta con middleware con nombre sin su cargador

```ts bad
createFrameworkHandler({ routes, loadPage });   // una ruta declara middleware: ["auth"]
```

La petición a esa ruta falla en lugar de saltarse el middleware, porque un middleware que protege una ruta nunca se ignora en silencio: responde `500 Internal Server Error` y `onError` recibe `Route / has named middleware (/app/middleware/auth.ts) but no loadNamedMiddleware to load it`.

<!-- no-check -->
```ts good
createFrameworkHandler({ routes, loadPage, loadNamedMiddleware: async (file) => (await import(file)).default });
```

### Esperar que atienda la API

```ts bad
const response = await handlePage(new Request("http://localhost/api/users"));
```

`/api/users` no es una ruta de página: la respuesta es `404 Not Found`. La API y el RPC los atiende `createServerDispatcher` (o `createServerApp`, que lo combina todo).

<!-- no-check -->
```ts good
const url = new URL(request.url);
const response = url.pathname.startsWith("/api/") || url.pathname.startsWith("/_meeko/rpc/") ? await dispatch(request) : await handlePage(request);
```

### Olvidar `clientEntry`

```ts bad
createFrameworkHandler({ routes, loadPage });
```

El HTML se renderiza, pero el documento no enlaza ningún script: la página no hidrata y los enlaces hacen navegaciones completas.

<!-- no-check -->
```ts good
createFrameworkHandler({ routes, loadPage, clientEntry: "/assets/entry-client.js" });
```

## Notas

- **Servidor.** Se ejecuta en cualquier runtime con Fetch; no lee el disco ni importa nada que no le den los cargadores.
- **Hidratación.** El navegador debe montar con [`mountClientApp`](/docs/reference/mountclientapp) y el mismo `routes`; el payload comprueba que la ruta y los parámetros coinciden.
- **Middleware de servidor.** No ejecuta `server/middleware` (`defineServerMiddleware`): envuelve el handler con `composeServerMiddleware` si lo necesitas.
- **Seguridad.** Los errores internos se informan a `onError` con un `requestId` y el navegador sólo recibe el estado y el mensaje público. Escapa todo lo que pongas en `document.head` y `bodyEnd`: es HTML de confianza.
- **Prerender.** `prerenderRoutes` acepta este handler como `handler` para escribir HTML estático.
