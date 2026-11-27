---
source-hash: c55562d290b052af8b447f981643610aa4b3b9ab9fc3e3588cf407d34b128089
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

Set `viewTransitions: true` in `meeko.config.ts` to animate page changes in supporting browsers. Disable a particular navigation with `data-meeko-view-transition="false"` on a link. Reduced-motion preference takes priority. [See CSS and browser limits](routing-navigation-reference.md#native-view-transitions). If a named element exists on only one of the two pages and you disable its group's animation, give it a fade of its own: [see the `:only-child` pattern](routing-navigation-reference.md#elements-present-on-only-one-of-the-two-pages). If a named element exists on only one of the two pages and you turn off its group animation, give it a fade of its own: [see the `:only-child` pattern](routing-navigation-reference.md#elements-present-on-only-one-of-the-two-pages).

## Navigation state

`useNavigation().pending` reports that the next page is loading. In SSR it is `false`. `useNavigation()` exposes state only. [See when it changes](routing-navigation-reference.md#navigation-state).

## Navigating from code

Since `1.10`, `navigate({ to: '/users/[id]', params: { id }, search, hash })` navigates from a component or a composable through the same router as `<MeekoLink>`, with the same typed destination; it also accepts a URL as text and the `replace` and `viewTransition` options. It returns `Promise<boolean>`. It only works in the browser: on the server, use `redirect()`. [See the complete rules](routing-navigation-reference.md#programmatic-navigation).

`useSearchParam('tab', 'perfil')` returns a signal bound to a query parameter: reading it gives the URL's value (validated by an optional `schema`, or `initial`), and writing it navigates to the URL with the parameter changed and reloads the page's data. [See search parameters as state](routing-navigation-reference.md#search-parameters-as-state).

Since `1.10`, during that time `<html>` carries `data-navigating`, and the clicked link (`<MeekoLink>` or internal `<a>`), `data-pending`, so a progress bar or a dimmed link is written with CSS alone (`html[data-navigating]`, `a[data-pending]`). They never appear in the server HTML. [See the attributes](routing-navigation-reference.md#data-navigating-and-data-pending-attributes).

## Current route

`useRoute()` provides `url`, `path`, `id`, `params` and `search` signals, plus `isActive()`. It represents the **confirmed** route; while navigation is pending it keeps the previous one. Get the composable in the component script and use its result in event handlers. [See types, SSR and hydration](routing-navigation-reference.md#current-route).
