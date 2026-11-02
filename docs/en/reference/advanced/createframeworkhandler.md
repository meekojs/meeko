---
title: createFrameworkHandler
group: advanced
since: 1.0.0
description: Creates a Fetch handler rendering application pages (route middleware, validation, loader, SSR, navigation payload and error pages) for a custom host.
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
source-hash: 47ff8295f865ab23bcdd78556667c09a61549a2620c9a47a563661faeb11f84b
---

`createFrameworkHandler` is the page part of [`createServerApp`](/en/docs/reference/createserverapp), separated for custom hosts: it takes the route manifest and module loaders and returns a `(request) => Promise<Response>` handler doing everything a page needs: route middleware (isomorphic and server), `params` and `search` validation, the loader or `<script server>`, SSR rendering (including `"stream"` and `"client"`), the navigation payload (`Accept: application/meeko+json`), layouts and error pages.

It does not handle API, RPC, Socket or files, run `server/middleware` middleware or create sessions: those belong to the host or `createServerApp`.

## Usage

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

## Options

| Option                 | Type                                       | Default  | Description                                                                                                                                     |
| ---------------------- | ------------------------------------------ | -------- | ----------------------------------------------------------------------------------------------------------------------------------------------- |
| `routes`               | `RouteRecord[]`                            | required | The route manifest, the same one received by `mountClientApp`.                                                                                  |
| `loadPage`             | `(file) => Promise<PageModule>`            | required | Loads a page, layout or error page's compiled module by file.                                                                                   |
| `loadRoute`            | `(file) => Promise<PageRoute>`             | none     | Loads route options (`definePage`) from a sidecar or `<script server>`.                                                                         |
| `errorPage`            | `ErrorPageRecord`                          | none     | Since `1.1`. `app/error.meeko` and its layouts: an unmatched URL renders with status `404`, and a failing route without `+error.meeko` uses it. |
| `loadMiddleware`       | `() => Promise<RouteMiddleware[]>`         | none     | Global route middleware, before the loader on all routes.                                                                                       |
| `loadNamedMiddleware`  | `(file) => Promise<RouteMiddleware>`       | none     | Since `1.6`. Named middleware from `RouteRecord.middleware`. A route declaring it without a loader fails.                                       |
| `loadServerMiddleware` | `(file) => Promise<ServerRouteMiddleware>` | none     | Since `1.6`. Server route middleware from `RouteRecord.serverMiddleware`. Likewise, the route fails without a loader.                           |
| `createContext`        | `(request) => RequestContext`              | none     | Each request's context (session, services, platform) for `usePage().context` and loaders.                                                       |
| `serverFetch`          | `ServerFetch`                              | none     | Local dispatcher for `api.*` and `rpc.*` calls during SSR, such as `createLocalServerFetch`.                                                    |
| `clientEntry`          | URL                                        | none     | Client entry point linked by the document. Without it, the page does not hydrate.                                                               |
| `document`             | `DocumentOptions`                          | none     | Trusted HTML for `<head>` and `</body>`, the nonce and the configuration's `document`.                                                          |
| `plugins`              | `PluginRegistration[]`                     | none     | Since `1.2`. Application plugins, once per page request before rendering.                                                                       |
| `onError`              | `(error, requestId) => void`               | console  | Internal page failures; never reach the browser.                                                                                                |

## Return value

`(request: Request) => Promise<Response>`. Depending on the request and route:

| Request                                                    | Response                                                                                           |
| ---------------------------------------------------------- | -------------------------------------------------------------------------------------------------- |
| `Accept: text/html` to a route                             | `200` with the document: `<head>`, `#app` with HTML and `#meeko-payload` with hydration JSON.      |
| `Accept: application/meeko+json` to a route                | `200` with the navigation payload in `application/meeko+json` (with `"stream"`, an NDJSON stream). |
| An unmatched URL                                           | Plain-text `404 Not Found`, or the `errorPage` page with status `404` if provided.                 |
| Invalid `params` or `search`                               | `400`, before the loader.                                                                          |
| A loader throwing `ApiError`, `notFound()` or `redirect()` | The nearest error page with its status, or the redirect.                                           |

## Examples

### Pages with layouts, a sidecar and the navigation payload

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

### With a session and services

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

`serverFetch` keeps `await api.users.list()` inside a page off the network during SSR.

## Common mistakes

### A route with named middleware but no loader

```ts bad
createFrameworkHandler({ routes, loadPage });   // una ruta declara middleware: ["auth"]
```

The request to that route fails instead of skipping middleware, because middleware protecting a route is never silently ignored: it responds with `500 Internal Server Error` and `onError` receives `Route / has named middleware (/app/middleware/auth.ts) but no loadNamedMiddleware to load it`.

<!-- no-check -->

```ts good
createFrameworkHandler({ routes, loadPage, loadNamedMiddleware: async (file) => (await import(file)).default });
```

### Expect it to handle the API

```ts bad
const response = await handlePage(new Request("http://localhost/api/users"));
```

`/api/users` is not a page route: the response is `404 Not Found`. API and RPC are handled by `createServerDispatcher` (or `createServerApp`, which combines everything).

<!-- no-check -->

```ts good
const url = new URL(request.url);
const response = url.pathname.startsWith("/api/") || url.pathname.startsWith("/_meeko/rpc/") ? await dispatch(request) : await handlePage(request);
```

### Forget `clientEntry`

```ts bad
createFrameworkHandler({ routes, loadPage });
```

HTML renders, but the document links no script: the page does not hydrate and links cause full navigations.

<!-- no-check -->

```ts good
createFrameworkHandler({ routes, loadPage, clientEntry: "/assets/entry-client.js" });
```

## Notes

- **Server.** Runs in any runtime with Fetch; it does not read disk or import anything not supplied by the loaders.
- **Hydration.** The browser must mount with [`mountClientApp`](/en/docs/reference/mountclientapp) and the same `routes`; the payload checks that route and parameters match.
- **Server middleware.** Does not run `server/middleware` (`defineServerMiddleware`): wrap the handler with `composeServerMiddleware` if needed.
- **Security.** Internal errors are reported to `onError` with a `requestId` and the browser only receives the status and public message. Escape everything you put in `document.head` and `bodyEnd`: it is trusted HTML.
- **Prerendering.** `prerenderRoutes` accepts this handler as `handler` to write static HTML.
