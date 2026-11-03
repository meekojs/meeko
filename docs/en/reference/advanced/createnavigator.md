---
title: createNavigator
group: advanced
since: 1.0.0
description: Low-level client navigator for a custom host, resolving routes, updating history and handling popstate while delegating rendering to a callback.
symbols:
  - "@meekojs/meeko/framework#createNavigator"
types:
  - "@meekojs/meeko/framework#Navigator"
  - "@meekojs/meeko/framework#NavigationContext"
related:
  - "@meekojs/meeko/framework#mountClientApp"
  - "@meekojs/meeko/framework#matchRoute"
  - "@meekojs/meeko/framework#createRouteManifest"
  - "@meekojs/meeko/framework#useNavigation"
  - docs/framework.md#estado-de-navegación
source-hash: f434e379d0f40d1a4e7ace24f014d50c630df9a6c51e46f0cec4ed2ee8a59901
---

`createNavigator` is the history layer used by [`mountClientApp`](/en/docs/reference/mountclientapp), without anything else: it resolves the target URL against the route manifest, calls your render callback with the route, its parameters, an `AbortSignal` and the number of retained layouts, and updates history if rendering succeeds. It also handles `popstate` (back and forward). It does not intercept links, request data or hydrate: the host decides how to render.

Use it to integrate Meeko routing into an application that renders pages differently (server HTML fragments, another framework) or for routing tests.

## Usage

```ts
import { createNavigator, createRouteManifest } from "@meekojs/meeko/framework";

const routes = createRouteManifest([
  { id: "/", file: "app/pages/index.meeko", layouts: [] },
  { id: "/users/[id]", file: "app/pages/users/[id].meeko", layouts: [] },
]);

const navigator = createNavigator(routes, async ({ match, signal }) => {
  const html = await (await fetch(`/fragments${match.route.id}?id=${match.params.id ?? ""}`, { signal })).text();
  if (signal.aborted) return false;
  document.querySelector("#outlet")!.innerHTML = html;
}, window, (error) => console.error("navigation failed", error));

await navigator.navigate("/users/42");
```

## Parameters

| Parameter | Type                                         | Default  | Description                                                                           |
| --------- | -------------------------------------------- | -------- | ------------------------------------------------------------------------------------- |
| `routes`  | `RouteRecord[]`                              | required | Route manifest, ideally created with `createRouteManifest`.                           |
| `render`  | `(context) => void \| boolean \| Promise<…>` | required | Renders each navigation. Returning `false` cancels it without changing history.       |
| `browser` | `Window`                                     | `window` | The window whose `history` and `location` are used.                                   |
| `onError` | `(error) => void`                            | console  | Failures of history navigation (back and forward), which have no caller to reject to. |

The callback receives a `NavigationContext`: `url` (the target URL), `match` (`{ route, params }`), `signal` (aborted if another navigation replaces this one) and `retainedLayouts` (the length of the layout prefix shared with the previous route, which the host can retain).

## Return value

A `Navigator`:

| Member                       | Description                                                                                                                                                                                                                                                       |
| ---------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `navigate(to, { replace? })` | Navigates to `to` within the same origin. Resolves to `true` if navigation occurred, `false` if the URL has no route or navigation was canceled, and rejects if rendering fails or the URL belongs to another origin. With `replace`, replaces the history entry. |
| `dispose()`                  | Stops listening to `popstate`.                                                                                                                                                                                                                                    |

## Examples

### Retain shared layouts

<!-- no-check -->

```ts
const mounted: Array<{ dispose(): void }> = [];
const navigator = createNavigator(routes, async ({ match, retainedLayouts }) => {
  // Release departing layouts; the first `retainedLayouts` remain on screen.
  for (const layout of mounted.splice(retainedLayouts)) layout.dispose();
  for (const file of match.route.layouts.slice(retainedLayouts)) mounted.push(await mountLayout(file));
  await renderPage(match.route.file, match.params);
});
```

### Intercept links yourself

<!-- no-check -->

```ts
document.addEventListener("click", (event) => {
  const anchor = (event.target as Element).closest("a");
  if (!anchor || anchor.origin !== location.origin || event.metaKey || event.ctrlKey) return;
  event.preventDefault();
  void navigator.navigate(anchor.href).then((navigated) => { if (!navigated) location.assign(anchor.href); });
});
```

`createNavigator` does not listen to clicks: a URL without a route (`navigate` resolves to `false`) is left to the browser.

## Common mistakes

### Navigate to another origin

```ts bad
await navigator.navigate("https://otro.example/users/42");
```

Rejects with `TypeError: External navigation is not a Meeko route`: `createNavigator` only changes the URL within the same origin, like `history.pushState`. An external link is browser navigation. After `dispose()`, `navigate` rejects with `Navigator disposed`.

<!-- no-check -->

```ts good
location.assign("https://otro.example/users/42");
```

### Ignore `signal` in a slow render

```ts bad
createNavigator(routes, async ({ match }) => {
  const html = await (await fetch(`/fragments${match.route.id}`)).text();
  document.querySelector("#outlet")!.innerHTML = html;
});
```

If the user clicks two links in succession, the slow response from the first navigation may arrive later and render over the second.

<!-- no-check -->

```ts good
createNavigator(routes, async ({ match, signal }) => {
  const html = await (await fetch(`/fragments${match.route.id}`, { signal })).text();
  if (signal.aborted) return false;
  document.querySelector("#outlet")!.innerHTML = html;
});
```

### Expect hydration or data requests

```ts bad
createNavigator(routes, () => {});
```

History changes, but the page does not: only the callback renders. For full Meeko navigation (data, layouts, hydration, middleware), use `mountClientApp`.

<!-- no-check -->

```ts good
const app = await mountClientApp({ root, payload, routes, loadPage, serverData: true });
```

## Notes

- **Browser only.** Uses `window.history` and `popstate`.
- **Transactional.** History only changes when rendering succeeds; if it fails, `navigate` rejects and the URL remains unchanged.
- **Fragments.** A URL that only changes the current page's `#fragmento` does not call `render`: it adds a history entry and scrolls to the anchor.
- **Routes.** Resolution follows [`matchRoute`](/en/docs/reference/matchroute): static before dynamic, segments decoded and rejected if they contain `/`, `\`, `.` or `..`.
- **Cleanup.** Call `dispose()` when unmounting the host; otherwise the `popstate` listener remains active.
