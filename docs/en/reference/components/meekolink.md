---
title: <MeekoLink>
group: components
since: 1.2.0
description: Typed link to an application page that builds its href with href() and marks the current page or section with aria-current.
symbols:
  - "syntax:meekolink"
types:
  - "@meekojs/meeko/framework#MeekoLinkProps"
  - "@meekojs/meeko/framework#RouteId"
related:
  - "@meekojs/meeko/framework#href"
  - "@meekojs/meeko/framework#useRoute"
  - "syntax:meekooutlet"
  - "@meekojs/meeko/framework#useNavigation"
  - docs/framework.md#meekooutlet--y-meekolink
  - docs/framework.md#enlaces-anclas-y-scroll
source-hash: f694d8e12feccb2b774614de84115398e2a8b8472ac490b5413797766f4db0c0
---

`<MeekoLink>` renders an `<a>` whose `href` is built by [`href()`](/en/docs/reference/href) from the ID of an `app/pages` route. `to` only accepts existing routes, a dynamic route requires its parameters, and `meeko check` flags errors on the attribute itself. On the current page it adds `aria-current="page"`, and client navigation keeps it up to date, including in layouts the browser preserves between pages.

Do not import it: the compiler recognizes the tag in any application template.

## Usage

```html
<!-- app/layouts/default.meeko -->
<template>
  <header>
    <MeekoLink to="/" class="brand">Home</MeekoLink>
    <MeekoLink to="/users/[id]" bind:params="{ id: session.userId }">My profile</MeekoLink>
  </header>
  <main><MeekoOutlet /></main>
</template>
```

With `/users/[id]` and `id: "7"`, the second link is `<a href="/users/7">`; on `/users/7`, it also has `aria-current="page"`.

## Props

| Attribute               | Type                                                                         | Default   | Description                                                                                                                                                                                                                                                                                                                                                                                                                                       |
| ----------------------- | ---------------------------------------------------------------------------- | --------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `to` or `bind:to`       | `RouteId`                                                                    | required  | Destination route ID, such as `to="/users/[id]"`: its file path in `app/pages`, without query or fragment. `bind:to` accepts an expression typed as a route or union of routes; with a union, `bind:params` accepts the parameters of any one of them (since `1.8`).                                                                                                                                                                              |
| `bind:params`           | `RouteParams<K>`                                                             | none      | Dynamic route segments, such as `bind:params="{ id: user.id }"`. Required for a route with dynamic segments and forbidden otherwise. Values are `string`. Without generated routes (`RouteId` is `string`: a library such as `@meekojs/ui` or a project before `meeko check`), no route declares its parameters: `bind:params` is optional and accepts `Record<string, string>` or `undefined` (since `1.8`; previously required `params ?? {}`). |
| `bind:search`           | `Readonly<Record<string, string \| number \| boolean \| null \| undefined>>` | none      | Query string, such as `bind:search="{ tab: 'perfil' }"`. Omits keys with `null` or `undefined`.                                                                                                                                                                                                                                                                                                                                                   |
| `match` or `bind:match` | `"exact" \| "prefix"`                                                        | `"exact"` | Since `1.5`. `"exact"` marks the link only on its route; `"prefix"` also marks it on routes below it.                                                                                                                                                                                                                                                                                                                                             |
| any other               | `<a>` attributes                                                             |           | `class`, `target`, `rel`, `aria-*`, `data-*`, `on:click` and children pass through to the `<a>` unchanged.                                                                                                                                                                                                                                                                                                                                        |

`href`, `bind:href` and static forms `params="…"` and `search="…"` are not supported (`MEEK105`).

## Result

An `<a>` with the constructed `href`. `aria-current` indicates the user's location:

| Current route                                | `match="exact"`       | `match="prefix"`      |
| -------------------------------------------- | --------------------- | --------------------- |
| The same route, excluding query and fragment | `aria-current="page"` | `aria-current="page"` |
| A route below it, by complete segments       | no attribute          | `aria-current="true"` |
| Any other                                    | no attribute          | no attribute          |

`aria-current="true"` means “the current item in a set”: the section containing the page. `to="/"` only matches exactly, even with `match="prefix"`, because otherwise it would mark every page. Comparison uses encoded paths as written by `href()`, so `/categorías` and `/categor%C3%ADas` are the same.

Since `1.8`, an `aria-current` of its own wins over the route, on the server, during hydration and on every update, whether written, with `bind:aria-current` or in `bind`:

| Own value                             | Result                                  |
| ------------------------------------- | --------------------------------------- |
| A text, such as `aria-current="step"` | That value, whatever the route          |
| `false`                               | No attribute, even on the active route  |
| `null` or `undefined`                 | The route decides, as with no attribute |

`aria-current` and `bind:aria-current` win over the `aria-current` key of `bind`. Writing both on the same link is `MEEK105`.

## Examples

### A section menu

Each link marks its section on all its pages and marks the exact page differently. CSS distinguishes the two values, which screen readers also read:

```html
<!-- app/layouts/default.meeko -->
<template>
  <nav aria-label="Secciones">
    <MeekoLink to="/" match="prefix">Home</MeekoLink>
    <MeekoLink to="/dashboard" match="prefix">Dashboard</MeekoLink>
    <MeekoLink to="/settings" match="prefix">Settings</MeekoLink>
  </nav>
  <main><MeekoOutlet /></main>
</template>

<style scoped>
nav a[aria-current="true"] { border-bottom: 2px solid currentColor; }
nav a[aria-current="page"] { border-bottom: 2px solid currentColor; font-weight: 700; }
</style>
```

On `/dashboard/stats`, “Panel” has `aria-current="true"`; on `/dashboard`, `aria-current="page"`; on `/dashboards`, neither.

### Parameters and query string

```html
<ul>
  <li each:of="users" each:as="user" each:key="user.id">
    <MeekoLink to="/users/[id]" bind:params="{ id: user.id }" bind:search="{ tab: 'actividad', page: 2 }">{user.name}</MeekoLink>
  </li>
</ul>
```

For user `"42"`, the link is `/users/42?tab=actividad&page=2`. On a dynamic route with `match="prefix"`, the section follows its `params`: `to="/users/[id]"` with `id: "7"` covers `/users/7/posts`, but not `/users/8/posts`.

### A list of links with `bind:to`

`bind:to` takes the route from an expression. With `as const`, each `to` is typed as a union of existing routes, and `meeko check` checks it in the same way:

```html
<script lang="ts">
const links = [
  { to: "/", label: "Home" },
  { to: "/settings", label: "Settings" },
] as const;
</script>

<template>
  <nav>
    <MeekoLink each:of="links" each:as="link" each:key="link.to" bind:to="link.to">{link.label}</MeekoLink>
  </nav>
</template>
```

### A component that receives a route

`MeekoLinkProps` and `RouteId` are auto-imported. Typing the prop with `MeekoLinkProps["to"]` also prevents the parent from passing a nonexistent route:

```html
<!-- app/components/NavItem.meeko -->
<script lang="ts">
const props = defineProps<{ to: MeekoLinkProps["to"]; label: string }>();
</script>

<template>
  <a class="nav-item" bind:href="href(props.to)">{props.label}</a>
</template>
```

For a custom link, `useRoute().isActive(to, { params, prefix })` applies the same rule as `match`.

### A component that receives any route with its parameters

`MeekoLinkProps["params"]` does not relate parameters to the route. To let the parent pass any route and have `meeko check` require the chosen route's `params`, create one variant per route:

```html
<!-- app/components/NavLink.meeko -->
<script lang="ts">
type RouteParamsOf<K extends RouteId> = NonNullable<MeekoLinkProps<K>["params"]>;
type LinkTarget = {
  [K in RouteId]: { to: K; search?: MeekoLinkProps["search"] }
    & (keyof RouteParamsOf<K> extends never ? { params?: never } : { params: RouteParamsOf<K> })
}[RouteId];
const props = defineProps<LinkTarget & { label: string }>();
</script>

<template>
  <MeekoLink bind:to="props.to" bind:params="props.params" bind:search="props.search">{props.label}</MeekoLink>
</template>
```

`<NavLink to="/users/[id]" label="Perfil" />` without `bind:params` is `TS2345`; `bind:params="{ userId: '1' }"` is `TS2353`; and `params` on `/about` is `TS2345`. Since `1.8`, `<MeekoLink>` accepts `bind:to` with a union of routes and `params` for any one of them; previously, `bind:params="props.params"` gave `TS2412`. For a button that can also be an external link or a `<button>`, see [A button that is a route, link or button](../../api.md#a-button-that-is-a-route-link-or-button).

### `'MeekoLink'` in `<component is>` (since 1.8)

`<MeekoLink>` is not a script value, but `is` names it with a literal, alongside HTML tags and other components:

```html
<component is="props.to !== undefined ? 'MeekoLink' : 'button'" bind:to="props.to" bind:params="props.params" type="button">Open</component>
```

The `'MeekoLink'` branch is this tag: it receives `to`, `params`, `search` and `match` and the other attributes of its `<a>`, but not `href`, and `meeko check` checks the route and parameters after the `?:` condition narrows `props.to`. See [Component names in `is`](../../api.md#component-names-in-is).

## Common mistakes

### Writing `href`

`<MeekoLink>` builds its own `href`. Passing it manually bypasses route checking.

```html bad
<MeekoLink href="/about">About</MeekoLink>
```

The compiler rejects it with `MEEK105: <MeekoLink> construye su href: indica la ruta con to="/users/[id]" y sus parámetros con bind:params`. Without `to`, the error is `MEEK105: <MeekoLink> necesita to con la ruta`.

```html good
<MeekoLink to="/about">About</MeekoLink>
```

### A nonexistent route, or a query in `to`

`to` is a route ID, not a URL: the query string goes in `bind:search`.

```html bad
<MeekoLink to="/nowhere">Lost</MeekoLink>
<MeekoLink to="/about?tab=1">About</MeekoLink>
```

`meeko check` reports `TS2345: Argument of type '"/about?tab=1"' is not assignable to parameter of type '"/" | "/about" | "/users/[id]"'` on the attribute, with the application's route list.

```html good
<MeekoLink to="/about" bind:search="{ tab: '1' }">About</MeekoLink>
```

For an external link, another origin or a file, use `<a href>`: it is not an application route.

### Forgetting a dynamic route's parameters

```html bad
<MeekoLink to="/users/[id]">Profile</MeekoLink>
```

`meeko check` reports `TS2345: Argument of type '{}' is not assignable to parameter of type '__MeekoLinkOptions<"/users/[id]">'`, with `Property 'params' is missing`. An incorrect key (`{ userId: '1' }`) gives `TS2353`, and a number (`{ id: 7 }`) gives `TS2322: Type 'number' is not assignable to type 'string'`.

```html good
<MeekoLink to="/users/[id]" bind:params="{ id: String(user.id) }">Profile</MeekoLink>
```

### `params` or `search` without `bind:`

Without `bind:`, the attribute value would be text, not an object.

```html bad
<MeekoLink to="/users/[id]" params="{ id: '1' }">Profile</MeekoLink>
```

The compiler reports `MEEK105: params de <MeekoLink> es un objeto: escríbelo como bind:params="{ … }"`.

```html good
<MeekoLink to="/users/[id]" bind:params="{ id: '1' }">Profile</MeekoLink>
```

### A `match` that does not exist

```html bad
<MeekoLink to="/dashboard" match="partial">Dashboard</MeekoLink>
```

`MEEK105: match de <MeekoLink> es "exact" (por defecto) o "prefix"`. With `bind:match`, a value other than `"exact" | "prefix"` is a type error.

```html good
<MeekoLink to="/dashboard" match="prefix">Dashboard</MeekoLink>
```

### A custom component called `MeekoLink`

A component at `app/components/MeekoLink.meeko` (or imported with that name) takes precedence over Meeko's tag, with its own props, to avoid breaking projects from before `1.2`.

```html bad
<!-- app/components/MeekoLink.meeko exists in the project -->
<MeekoLink to="/about">About</MeekoLink>
```

`meeko check`, `meeko build` and the editor warn with `MEEK106: <MeekoLink> es el componente MeekoLink del proyecto, no la etiqueta propia de Meeko`. Rename the component (for example, to `AppLink.meeko`), and the tag becomes Meeko's again.

```html good
<!-- app/components/AppLink.meeko -->
<MeekoLink to="/about">About</MeekoLink>
```

## Notes

- **Client navigation.** The `<a>` is a regular link that also works before hydration and without JavaScript. With the application hydrated, `mountClientApp` turns the click into client navigation, like any same-origin link to an application route; a link to a fragment of the current page only scrolls it.
- **SSR and hydration.** The server writes `href` and `aria-current` into the HTML; hydration does not change them, and every navigation updates `aria-current`, including in layouts the browser preserves. An `aria-current` of its own and the route write a single attribute, with the same rule on both sides.
- **Route types.** `RouteId` is the union of routes declared in `.meeko/types/routes.d.ts`, generated by `meeko check`, `meeko dev` and `meeko routes`; without those declarations it is `string`, and `to` is not checked. A new page needs one of those commands for its route to be valid.
- **Editor.** `to="` suggests project routes, and Ctrl+click opens their pages.
- **Not an `is` value.** `<MeekoLink>` is a compiler tag: `<component is="x ? MeekoLink : 'button'">` gives `TS2304`. Use two branches with `if:when`.
- **Styles.** A component's scoped styles apply to the `<a>`, which is an element of its template: `a[aria-current="page"]` in `<style scoped>` works.
