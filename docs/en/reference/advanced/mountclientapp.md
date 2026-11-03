---
title: mountClientApp
group: advanced
since: 1.0.0
description: Hydrates server-rendered HTML in the browser and manages client navigation, with history, links, route middleware, data payloads and cleanup.
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
source-hash: 1c0e728a84f11fb377f8ff297c533ac38ff3ef60406be51c0752033d26bc7199
---

`mountClientApp` starts a Meeko application in the browser. It reads the payload left by the server in `#meeko-payload`, checks that the route and parameters match SSR, runs plugins and route middleware, and **hydrates** existing HTML (does not render it again). It then intercepts same-origin link clicks and history: on each navigation it requests page data from the server (`Accept: application/meeko+json`) or runs a `render: "client"` route's loader, replacing only the first changed outlet and retaining shared layouts with their state.

Navigation is transactional: if it fails, the previous page remains visible. It is called by Meeko's generated client entry point (`.meeko/generated/entry-client.ts`); use it manually with a custom host rendering with [`createFrameworkHandler`](/en/docs/reference/createframeworkhandler).

## Usage

<!-- no-check -->

```ts
// entry-client.ts, bundled with Vite and meeko()
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

## Options

| Option                         | Type                                 | Default   | Description                                                                                                                                                                                                                                                                                                                 |
| ------------------------------ | ------------------------------------ | --------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `routes`                       | `RouteRecord[]`                      | required  | Route manifest, the same as the server's.                                                                                                                                                                                                                                                                                   |
| `root`                         | `Element`                            | required  | The element containing SSR HTML (`#app`).                                                                                                                                                                                                                                                                                   |
| `payload`                      | JSON text or object                  | required  | The content of `#meeko-payload`.                                                                                                                                                                                                                                                                                            |
| `loadPage`                     | `(file) => Promise<ClientComponent>` | required  | Loads a page's or layout's compiled module.                                                                                                                                                                                                                                                                                 |
| `serverData`                   | `boolean` \| `"static"`              | `false`   | `true`: on navigation, requests data from the same URL with `Accept: application/meeko+json`. `"static"` (since `1.3`): reads `<ruta>/index.meeko.json`, for static hosting. Only applies without `loadRoute`: with `loadRoute`, route data comes from browser loaders. `render: "client"` routes always use their sidecar. |
| `errorPage`                    | `ErrorPageRecord`                    | none      | Since `1.1`. `app/error.meeko`: hydrates a server `404` page and backs up `"client"` routes without `+error.meeko`.                                                                                                                                                                                                         |
| `loadRoute`, `loadClientRoute` | `(file) => Promise<ClientRoute>`     | none      | Load public route options from a sidecar; `loadClientRoute` loads those of `render: "client"` routes.                                                                                                                                                                                                                       |
| `loadMiddleware`               | `() => Promise<RouteMiddleware[]>`   | none      | Global route middleware, before each navigation.                                                                                                                                                                                                                                                                            |
| `loadNamedMiddleware`          | `(file) => Promise<RouteMiddleware>` | none      | Since `1.6`. Named middleware, the first time navigating to a route declaring it.                                                                                                                                                                                                                                           |
| `plugins`                      | `PluginRegistration[]`               | none      | Since `1.2`. Application plugins, before hydration.                                                                                                                                                                                                                                                                         |
| `document`                     | `DocumentConfig`                     | none      | Since `1.2`. The `document` from `meeko.config.ts`, the same as the server used, for `titleTemplate` and `<head>` tags.                                                                                                                                                                                                     |
| `onError`                      | `(error, source) => void`            | console   | Navigation, Socket and effect failures and, since `1.3`, global page exceptions and rejections.                                                                                                                                                                                                                             |
| `onNavigationError`            | `(error) => void`                    | `onError` | Only navigation failures from clicks or history.                                                                                                                                                                                                                                                                            |
| `fetch`, `browser`             |                                      | globals   | Navigation `fetch` and the window; for tests.                                                                                                                                                                                                                                                                               |

## Return value

A promise of `ClientApp`, once the page has hydrated:

| Member                       | Description                                                                                                                                               |
| ---------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `navigate(to, { replace? })` | Navigates within the application. Resolves to `false` if the URL has no route or navigation was canceled, and rejects with the original error on failure. |
| `state`                      | The `StateStore` used by `useState`, shared by the whole application.                                                                                     |
| `dispose()`                  | Disposes of pages, layouts, history listeners and Socket connections.                                                                                     |

Rejects with `TypeError` if the payload is invalid (`Invalid Meeko hydration payload`) or from another build (`Unsupported Meeko payload version …; the server and browser bundles must come from the same build`), and with `Error` if the route differs from SSR (`Meeko route hydration mismatch`) or its parameters do (`Meeko route parameters do not match SSR`).

## Examples

### Navigate from code

<!-- no-check -->

```ts
const app = await mountClientApp(options);
await app.navigate("/users/42");
await app.navigate("/users/42?tab=perfil", { replace: true });
```

In a component, typically use `useNavigation().navigate(…)` or a `<MeekoLink>`; `app.navigate` is for code outside components, such as a global keyboard shortcut.

### A static site

<!-- no-check -->

```ts
await mountClientApp({ root, payload, routes, errorPage, serverData: "static", loadPage });
```

This is what `meeko build --adapter static` generates: navigation reads `/docs/api/index.meeko.json` instead of negotiating `Accept`, because static hosting does not support that.

### Observe application failures

<!-- no-check -->

```ts
await mountClientApp({
  ...options,
  onError: (error, source) => reportToMonitoring(error, { source }),
  onNavigationError: (error) => showToast("Could not open the page"),
});
```

### A test with happy-dom

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

## Common mistakes

### Routes different from the server's

```ts bad
await mountClientApp({ root, payload, routes: [{ id: "/", file: "app/pages/index.meeko", layouts: [] }], loadPage });
```

If the server rendered `/users/[id]` and the browser lacks that route, `mountClientApp` rejects with `Meeko route hydration mismatch` and the page retains server HTML without interactivity.

<!-- no-check -->

```ts good
import { routes } from "virtual:meeko-manifest/client";
await mountClientApp({ root, payload, routes, loadPage });
```

### A client bundle from another build

```text bad
dist/ served with HTML from one build and entry-client.js from another
```

`TypeError: Unsupported Meeko payload version …; the server and browser bundles must come from the same build`. This happens when deploying the server and assets separately, or with a CDN serving an old `entry-client`.

```text good
.meeko/output/node/ deployed in full: index.mjs, chunks/ and client/ from the same meeko build
```

### Forget `serverData`

```ts bad
await mountClientApp({ root, payload, routes, loadPage });
```

Hydration works, but navigating to a page with a server loader or `<script server>` does not request its data from the server: the browser renders the page without it. The same happens when passing `loadRoute` alongside `serverData`, which is then unused.

<!-- no-check -->

```ts good
await mountClientApp({ root, payload, routes, loadPage, serverData: true });
```

## Notes

- **Browser only.** Requires `document` and `history`; in SSR, the server renders the page.
- **Hydration.** Does not render HTML again: connects signals and events to the existing DOM. HTML and payload must come from the same render.
- **Links.** Intercepts same-origin `<a>` links to an application route, even before a component marks them; a link to a fragment of the current page only scrolls. Links with `target`, `download`, another origin or a modifier key remain browser navigation.
- **Performance.** Each page and named middleware is a chunk loaded on the first navigation to its route; common layouts retain their state between pages.
- **Global errors.** Since `1.3`, while the application is mounted, `onError` also receives page exceptions (`"uncaught"`) and unhandled rejections (`"rejection"`), and the browser no longer repeats them in the console.
