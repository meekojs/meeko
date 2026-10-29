---
title: matchRoute
group: advanced
since: 1.0.0
description: Busca la ruta de una URL en el manifiesto de rutas, con los mismos criterios que el SSR y la navegación de cliente, y devuelve sus parámetros decodificados.
symbols:
  - "@meekojs/meeko/framework#matchRoute"
types:
  - "@meekojs/meeko/framework#RouteMatch"
  - "@meekojs/meeko/framework#RouteRecord"
related:
  - "@meekojs/meeko/framework#createRouteManifest"
  - "@meekojs/meeko/framework#createNavigator"
  - "@meekojs/meeko/framework#href"
  - "@meekojs/meeko/framework#useRoute"
  - docs/framework.md#routing-layouts-y-ssr
---

`matchRoute` es el enrutador de Meeko como función pura: recibe el manifiesto de rutas y el `pathname` de una URL y devuelve la ruta que la atiende con sus parámetros, o `undefined`. Es la misma resolución que usan `createFrameworkHandler` en el servidor y `mountClientApp` al navegar, así que sirve para saber, fuera de ellos, qué página atendería una URL: en un middleware propio, un service worker, un script de migración de enlaces o una prueba.

## Uso

```ts
import { createRouteManifest, matchRoute } from "@meekojs/meeko/framework";

const routes = createRouteManifest([
  { id: "/", file: "app/pages/index.meeko", layouts: [] },
  { id: "/users/[id]", file: "app/pages/users/[id].meeko", layouts: [] },
  { id: "/users/new", file: "app/pages/users/new.meeko", layouts: [] },
  { id: "/docs/[...path]", file: "app/pages/docs/[...path].meeko", layouts: [] },
]);

matchRoute(routes, "/users/42");         // { route: { id: "/users/[id]", … }, params: { id: "42" } }
matchRoute(routes, "/users/new");        // { route: { id: "/users/new", … }, params: {} }
matchRoute(routes, "/docs/guide/intro"); // { route: { id: "/docs/[...path]", … }, params: { path: "guide/intro" } }
matchRoute(routes, "/nope");             // undefined
```

## Parámetros

| Parámetro | Tipo | Por defecto | Descripción |
| --- | --- | --- | --- |
| `routes` | `RouteRecord[]` | obligatorio | El manifiesto de rutas. Con `createRouteManifest` queda ordenado (estáticas, después dinámicas y al final catch-all) y sin colisiones. |
| `pathname` | texto | obligatorio | La ruta de la URL, que empieza por `/`, sin query ni fragmento (`new URL(request.url).pathname`). |

## Valor devuelto

Un `RouteMatch` `{ route, params }`, o `undefined` si ninguna ruta coincide.

- `route` es el `RouteRecord` del manifiesto: `id`, `file`, `layouts`, y `render`, `sidecar`, `layout`, `middleware`… si los tiene.
- `params` tiene cada segmento dinámico decodificado (`/users/caf%C3%A9` da `{ id: "café" }`); un catch-all une sus segmentos con `/`.

## Ejemplos

### Qué coincide y qué no

```ts
import { createRouteManifest, matchRoute } from "@meekojs/meeko/framework";

const routes = createRouteManifest([
  { id: "/users/[id]", file: "app/pages/users/[id].meeko", layouts: [] },
  { id: "/docs/[...path]", file: "app/pages/docs/[...path].meeko", layouts: [] },
]);

matchRoute(routes, "/users/42/")?.params;  // { id: "42" }: la barra final no cuenta
matchRoute(routes, "/users/a%2Fb");        // undefined: un segmento no puede contener "/"
matchRoute(routes, "/users/..");           // undefined: ni "." ni ".."
matchRoute(routes, "/docs");               // undefined: el catch-all necesita al menos un segmento
```

### Un host propio que sabe a qué página va cada petición

<!-- no-check -->
```ts
// server.mjs, junto al build de Node
import { createServer } from "node:http";
import { matchRoute } from "@meekojs/meeko/framework";
import { toNodeListener } from "@meekojs/meeko/node";
import { createNodeApp, manifest } from "./.meeko/output/node/index.mjs";

const app = await createNodeApp();
createServer(toNodeListener(async (request) => {
  const match = matchRoute(manifest.routes, new URL(request.url).pathname);
  const started = performance.now();
  const response = await app.fetch(request);
  console.log(match?.route.id ?? "(sin ruta)", response.status, `${Math.round(performance.now() - started)} ms`);
  return response;
})).listen(3000);
```

El build de Node exporta su `manifest`: las métricas o los logs pueden agruparse por la ruta (`/users/[id]`) en lugar de por la URL concreta.

## Errores comunes

### Pasar la URL completa

```ts bad
matchRoute(routes, request.url);
```

`"http://localhost/users/42"` no empieza por `/`: ninguna ruta coincide y el resultado es `undefined`.

<!-- no-check -->
```ts good
matchRoute(routes, new URL(request.url).pathname);
```

### Un array sin `createRouteManifest`, con el orden equivocado

```ts bad
const routes = [
  { id: "/users/[id]", file: "a", layouts: [] },
  { id: "/users/new", file: "b", layouts: [] },
];
matchRoute(routes, "/users/new"); // puede devolver /users/[id]
```

`matchRoute` recorre la lista en orden. `createRouteManifest` ordena las estáticas antes que las dinámicas y detecta colisiones (`Route collision: a and b both resolve to …`).

<!-- no-check -->
```ts good
const routes = createRouteManifest([
  { id: "/users/[id]", file: "a", layouts: [] },
  { id: "/users/new", file: "b", layouts: [] },
]);
```

### Un ID de ruta sin `/` inicial

```ts bad
createRouteManifest([{ id: "users", file: "app/pages/users.meeko", layouts: [] }]);
```

`TypeError: Route must start with /: users`.

<!-- no-check -->
```ts good
createRouteManifest([{ id: "/users", file: "app/pages/users.meeko", layouts: [] }]);
```

## Notas

- **Servidor y navegador.** Es una función pura, sin DOM ni E/S: funciona en cualquier runtime.
- **Seguridad.** Rechaza los segmentos que, decodificados, contienen `/`, `\`, `.` o `..`, así que un parámetro nunca sale de su segmento ni sube de carpeta aunque se use para leer un archivo. Aun así, valida los parámetros con el schema de `definePage`.
- **Mayúsculas.** La comparación de los segmentos estáticos distingue mayúsculas: `/Users/42` no coincide con `/users/[id]`.
- **Rendimiento.** Recorre la lista una vez por llamada; para aplicaciones con miles de rutas, guarda el resultado si lo consultas muchas veces por petición.
