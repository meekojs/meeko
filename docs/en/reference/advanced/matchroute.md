---
title: matchRoute
group: advanced
since: 1.0.0
description: Finds a URL's route in the route manifest, using the same criteria as SSR and client navigation, and returns its decoded parameters.
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
source-hash: 9f49da22cd303fb9f45b7458420eba9e1b0602690f210e46889cd62a5f4bd539
---

`matchRoute` is Meeko's router as a pure function: it takes the route manifest and a URL's `pathname` and returns the route that handles it with its parameters, or `undefined`. It uses the same resolution as `createFrameworkHandler` on the server and `mountClientApp` when navigating, so you can determine which page would handle a URL outside them: in your own middleware, a service worker, a link migration script or a test.

## Usage

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

## Parameters

| Parameter  | Type            | Default  | Description                                                                                                              |
| ---------- | --------------- | -------- | ------------------------------------------------------------------------------------------------------------------------ |
| `routes`   | `RouteRecord[]` | required | The route manifest. `createRouteManifest` sorts it (static, then dynamic, then catch-all routes) and removes collisions. |
| `pathname` | string          | required | The URL path, starting with `/`, without a query or fragment (`new URL(request.url).pathname`).                          |

## Return value

A `RouteMatch` `{ route, params }`, or `undefined` if no route matches.

- `route` is the manifest's `RouteRecord`: `id`, `file`, `layouts`, and `render`, `sidecar`, `layout`, `middleware`… if present.
- `params` contains each decoded dynamic segment (`/users/caf%C3%A9` gives `{ id: "café" }`); a catch-all joins its segments with `/`.

## Examples

### What matches and what does not

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

### Your own host that knows which page each request targets

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

The Node build exports its `manifest`: metrics or logs can be grouped by route (`/users/[id]`) rather than by the specific URL.

## Common mistakes

### Passing the full URL

```ts bad
matchRoute(routes, request.url);
```

`"http://localhost/users/42"` does not start with `/`: no route matches and the result is `undefined`.

<!-- no-check -->

```ts good
matchRoute(routes, new URL(request.url).pathname);
```

### An array without `createRouteManifest`, in the wrong order

```ts bad
const routes = [
  { id: "/users/[id]", file: "a", layouts: [] },
  { id: "/users/new", file: "b", layouts: [] },
];
matchRoute(routes, "/users/new"); // puede devolver /users/[id]
```

`matchRoute` traverses the list in order. `createRouteManifest` sorts static routes before dynamic ones and detects collisions (`Route collision: a and b both resolve to …`).

<!-- no-check -->

```ts good
const routes = createRouteManifest([
  { id: "/users/[id]", file: "a", layouts: [] },
  { id: "/users/new", file: "b", layouts: [] },
]);
```

### A route ID without a leading `/`

```ts bad
createRouteManifest([{ id: "users", file: "app/pages/users.meeko", layouts: [] }]);
```

`TypeError: Route must start with /: users`.

<!-- no-check -->

```ts good
createRouteManifest([{ id: "/users", file: "app/pages/users.meeko", layouts: [] }]);
```

## Notes

- **Server and browser.** A pure function without DOM or I/O: works in any runtime.
- **Security.** Rejects segments that, once decoded, contain `/`, `\`, `.` or `..`, so a parameter never escapes its segment or goes up a directory even when used to read a file. Still, validate parameters with the `definePage` schema.
- **Case sensitivity.** Static segment comparisons are case-sensitive: `/Users/42` does not match `/users/[id]`.
- **Performance.** Traverses the list once per call; for applications with thousands of routes, cache the result if you query it many times per request.
