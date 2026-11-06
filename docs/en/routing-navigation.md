---
source-hash: e34497b2163bec86b007d30dc7a45ca8d9135078c4fdda7cdf8887210245dc49
---

# Navigation

Meeko connects pages through real URLs, keeps shared layouts mounted and updates route state when navigation commits. For visual nesting, see [Layouts](routing-layouts.md).

## `<MeekoOutlet />` and `<MeekoLink>`

`<MeekoOutlet />` renders the nested layout or page. For a known URL, use a native `<a>`: Meeko also navigates without a reload when you click a same-origin internal link.

`<MeekoLink>` is optional. Use it when you want to build the URL from a typed route ID, pass parameters, or mark the active page automatically:

```html
<MeekoLink to="/users/[id]" bind:params="{ id: '42' }" match="prefix">User</MeekoLink>
```

Both render an `<a>` and share the same navigation. `to` is the route ID; `params` fills its segments. `match="prefix"` also marks an active section with `aria-current`. Pass the query through `bind:search`. With `@meekojs/ui`, `<UILink href="/path">` styles a normal link and `<UILink to="/path">` uses Meeko's typed route. [See props and link resolvers](routing-navigation-reference.md#meekooutlet--and-meekolink).

## Links, anchors and scrolling

An ordinary internal `<a href>` can also navigate without a reload. Modified clicks, downloads and external links keep browser behavior. A fragment-only change does not reload data; back and forward restore scroll. [See the full rules](routing-navigation-reference.md#links-anchors-and-scrolling).

## Native View Transitions

Set `viewTransitions: true` in `meeko.config.ts` to animate page changes in supporting browsers. Disable a particular navigation with `data-meeko-view-transition="false"` on a link. Reduced-motion preference takes priority. [See CSS and browser limits](routing-navigation-reference.md#native-view-transitions).

## Navigation state

`useNavigation().pending` reports that the next page is loading. In SSR it is `false`. To navigate from a custom host, use `app.navigate()`; `useNavigation()` exposes state only. [See when it changes](routing-navigation-reference.md#navigation-state).

## Current route

`useRoute()` provides `url`, `path`, `id`, `params` and `search` signals, plus `isActive()`. It represents the **confirmed** route; while navigation is pending it keeps the previous one. Get the composable in the component script and use its result in event handlers. [See types, SSR and hydration](routing-navigation-reference.md#current-route).
