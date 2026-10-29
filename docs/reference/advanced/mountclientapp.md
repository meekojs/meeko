---
title: mountClientApp
group: advanced
since: 1.0.0
description: Hidrata en el navegador el HTML que renderizó el servidor y gestiona la navegación de cliente, con historial, enlaces, middleware de ruta, payloads de datos y limpieza.
symbols:
  - "@meekojs/meeko/framework#mountClientApp"
types:
  - "@meekojs/meeko/framework#ClientAppOptions"
  - "@meekojs/meeko/framework#ClientApp"
related:
  - "@meekojs/meeko/server#createFrameworkHandler"
  - "@meekojs/meeko/framework#createNavigator"
  - "@meekojs/meeko/framework#StateStore"
  - "@meekojs/meeko/framework#useNavigation"
  - "@meekojs/meeko/framework#definePlugin"
  - docs/framework.md#routing-layouts-y-ssr
  - docs/framework.md#errores
---

`mountClientApp` es el arranque del navegador de una aplicación Meeko. Lee el payload que el servidor dejó en `#meeko-payload`, comprueba que la ruta y los parámetros son los mismos que en el SSR, ejecuta los plugins y el middleware de ruta, y **hidrata** el HTML existente (no lo vuelve a pintar). Desde ahí intercepta los clics en enlaces del mismo origen y el historial: en cada navegación pide los datos de la página al servidor (`Accept: application/meeko+json`) o ejecuta el loader de una ruta `render: "client"`, y sustituye sólo el primer outlet que cambia, conservando los layouts comunes con su estado.

La navegación es transaccional: si falla, la página anterior sigue visible. Lo llama la entrada del cliente que genera Meeko (`.meeko/generated/entry-client.ts`); se usa a mano con un host propio que renderiza con [`createFrameworkHandler`](/docs/reference/createframeworkhandler).

## Uso

<!-- no-check -->
```ts
// entry-client.ts, empaquetado con Vite y meeko()
import { mountClientApp } from "@meekojs/meeko/framework";
import type { ClientComponent } from "@meekojs/meeko/framework";
import { modules as pages } from "virtual:meeko-client-pages";
import { errorPage, routes } from "virtual:meeko-manifest/client";

const root = document.getElementById("app");
const payload = document.getElementById("meeko-payload")?.textContent;
if (!root || !payload) throw new Error("Missing Meeko SSR data");

const app = await mountClientApp({
  root,
  payload,
  routes,
  errorPage,
  serverData: true,
  loadPage: async (file) => await pages[file]!() as ClientComponent,
});
```

## Opciones

| Opción | Tipo | Por defecto | Descripción |
| --- | --- | --- | --- |
| `routes` | `RouteRecord[]` | obligatorio | El manifiesto de rutas, el mismo del servidor. |
| `root` | `Element` | obligatorio | El elemento con el HTML del SSR (`#app`). |
| `payload` | texto JSON u objeto | obligatorio | El contenido de `#meeko-payload`. |
| `loadPage` | `(file) => Promise<ClientComponent>` | obligatorio | Carga el módulo compilado de una página o un layout. |
| `serverData` | `boolean` \| `"static"` | `false` | `true`: al navegar, pide los datos a la misma URL con `Accept: application/meeko+json`. `"static"` (desde `1.3`): lee `<ruta>/index.meeko.json`, para un hosting estático. Sólo actúa sin `loadRoute`: con `loadRoute`, los datos de las rutas salen de los loaders del navegador. Las rutas `render: "client"` siempre usan su sidecar. |
| `errorPage` | `ErrorPageRecord` | ninguno | Desde `1.1`. `app/error.meeko`: hidrata una página `404` del servidor y respalda las rutas `"client"` sin `+error.meeko`. |
| `loadRoute`, `loadClientRoute` | `(file) => Promise<ClientRoute>` | ninguno | Cargan las opciones de ruta públicas de un sidecar; `loadClientRoute` las de las rutas `render: "client"`. |
| `loadMiddleware` | `() => Promise<RouteMiddleware[]>` | ninguno | Middleware de ruta global, antes de cada navegación. |
| `loadNamedMiddleware` | `(file) => Promise<RouteMiddleware>` | ninguno | Desde `1.6`. Middleware con nombre, la primera vez que se navega a una ruta que lo declara. |
| `plugins` | `PluginRegistration[]` | ninguno | Desde `1.2`. Plugins de aplicación, antes de hidratar. |
| `document` | `DocumentConfig` | ninguno | Desde `1.2`. El `document` de `meeko.config.ts`, el mismo que usó el servidor, para `titleTemplate` y las etiquetas de `<head>`. |
| `onError` | `(error, source) => void` | consola | Fallos de navegación, de Socket, de efectos y, desde `1.3`, las excepciones y rechazos globales de la página. |
| `onNavigationError` | `(error) => void` | `onError` | Sólo los fallos de navegación por clic o historial. |
| `fetch`, `browser` | | globales | El `fetch` de las navegaciones y la ventana; para pruebas. |

## Valor devuelto

Una promesa de `ClientApp`, cuando la página ya está hidratada:

| Miembro | Descripción |
| --- | --- |
| `navigate(to, { replace? })` | Navega dentro de la aplicación. Resuelve `false` si la URL no tiene ruta o se canceló, y rechaza con el error original si falla. |
| `state` | El `StateStore` de `useState`, compartido por toda la aplicación. |
| `dispose()` | Libera páginas, layouts, listeners del historial y conexiones Socket. |

Rechaza con `TypeError` si el payload no es válido (`Invalid Meeko hydration payload`) o viene de otro build (`Unsupported Meeko payload version …; the server and browser bundles must come from the same build`), y con `Error` si la ruta no coincide con la del SSR (`Meeko route hydration mismatch`) o sus parámetros tampoco (`Meeko route parameters do not match SSR`).

## Ejemplos

### Navegar desde código

<!-- no-check -->
```ts
const app = await mountClientApp(options);
await app.navigate("/users/42");
await app.navigate("/users/42?tab=perfil", { replace: true });
```

En un componente, la forma habitual es `useNavigation().navigate(…)` o un `<MeekoLink>`; `app.navigate` es para código fuera de los componentes, como un atajo de teclado global.

### Un sitio estático

<!-- no-check -->
```ts
await mountClientApp({ root, payload, routes, errorPage, serverData: "static", loadPage });
```

Es lo que genera `meeko build --adapter static`: la navegación lee `/docs/api/index.meeko.json` en lugar de negociar `Accept`, porque un hosting estático no lo hace.

### Observar los fallos de la aplicación

<!-- no-check -->
```ts
await mountClientApp({
  ...options,
  onError: (error, source) => reportToMonitoring(error, { source }),
  onNavigationError: (error) => showToast("No se pudo abrir la página"),
});
```

### Una prueba con happy-dom

<!-- no-check -->
```ts
const html = await (await handlePage(new Request("https://example.test/a"))).text();
const browser = new Window({ url: "https://example.test/a" });
browser.document.write(html);
const root = browser.document.getElementById("app")!;
const payload = browser.document.getElementById("meeko-payload")!.textContent!;
const app = await mountClientApp({ routes, root, payload, loadPage: async (file) => modules[file]!, browser: browser as unknown as Window });
assert.equal(await app.navigate("/b"), true);
app.dispose();
```

## Errores comunes

### Rutas distintas de las del servidor

```ts bad
await mountClientApp({ root, payload, routes: [{ id: "/", file: "app/pages/index.meeko", layouts: [] }], loadPage });
```

Si el servidor renderizó `/users/[id]` y el navegador no tiene esa ruta, `mountClientApp` rechaza con `Meeko route hydration mismatch` y la página se queda con el HTML del servidor, sin interactividad.

<!-- no-check -->
```ts good
import { routes } from "virtual:meeko-manifest/client";
await mountClientApp({ root, payload, routes, loadPage });
```

### Un bundle del cliente de otro build

```text bad
dist/ servido con el HTML de un build y el entry-client.js de otro
```

`TypeError: Unsupported Meeko payload version …; the server and browser bundles must come from the same build`. Pasa al desplegar el servidor y los assets por separado, o con una CDN que sirve un `entry-client` antiguo.

```text good
.meeko/output/node/ desplegado entero: index.mjs, chunks/ y client/ del mismo meeko build
```

### Olvidar `serverData`

```ts bad
await mountClientApp({ root, payload, routes, loadPage });
```

La hidratación funciona, pero al navegar a una página con loader de servidor o `<script server>` no se piden sus datos al servidor: la página se renderiza en el navegador sin ellos. Lo mismo pasa si se pasa `loadRoute` junto a `serverData`, que entonces no se usa.

<!-- no-check -->
```ts good
await mountClientApp({ root, payload, routes, loadPage, serverData: true });
```

## Notas

- **Sólo en el navegador.** Necesita `document` y `history`; en SSR la página la renderiza el servidor.
- **Hidratación.** No vuelve a pintar el HTML: enlaza señales y eventos con el DOM existente. El HTML y el payload deben venir del mismo render.
- **Enlaces.** Intercepta los `<a>` del mismo origen a una ruta de la aplicación, también antes de que un componente los marque; un enlace a un fragmento de la página actual sólo desplaza. Los enlaces con `target`, `download`, otro origen o una tecla modificadora siguen siendo del navegador.
- **Rendimiento.** Cada página y cada middleware con nombre es un chunk que se carga al navegar a su ruta por primera vez; los layouts comunes se conservan, con su estado, entre páginas.
- **Errores globales.** Desde `1.3`, mientras la aplicación está montada, `onError` recibe también las excepciones (`"uncaught"`) y los rechazos sin manejar (`"rejection"`) de la página, y el navegador ya no los repite en la consola.
