---
source-hash: 1106c69d0c83cc73e2bd59109490dd571fb7340c278b1ec8026c3e1cf3ea1a92
---

# Pages and parameters

Each `.meeko` file under `app/pages` defines a route. Follow the [router tutorial](router.md) to build an application, and use the [Routing index](routing.md) to explore the other topics.

## File conventions

| File under `app/pages`  | Example URL           | Parameters                  |
| ----------------------- | --------------------- | --------------------------- |
| `index.meeko`           | `/`                   | None                        |
| `users/index.meeko`     | `/users`              | None                        |
| `users/new.meeko`       | `/users/new`          | None                        |
| `users/[id].meeko`      | `/users/42`           | `{ id: '42' }`              |
| `docs/[...slug].meeko`  | `/docs/guide/install` | `{ slug: 'guide/install' }` |
| `(admin)/reports.meeko` | `/reports`            | None                        |

`[id]` captures one segment. `[...slug]` captures one or more and must be last. Parenthesized groups organize files without adding a URL segment. Static routes take precedence over dynamic routes; two pages with the same URL shape collide.

## Options and validated parameters

Declare page options with `definePage()` inside its `<script server>` or in a companion `*.route.ts` file. `definePage({ params, search })` accepts Standard Schema schemas to validate and transform parameters before loading data. `usePage()` provides request values on the server. See [definePage](reference/macros/definepage.md), [usePage](reference/composables/usepage.md) and [Data and rendering](routing-data.md#page-server-code).

For typed links, use `<MeekoLink to="/users/[id]" bind:params="{ id: '42' }" />` or `href('/users/[id]', { params: { id: '42' } })`. The route ID matches the file, rather than the filled-in URL. [Navigation](routing-navigation.md#meekooutlet--and-meekolink) explains link behavior.

## Per-folder options

A `+group.ts` applies options to pages in its folder and descendants without changing the URL:

```ts
// app/pages/(dashboard)/+group.ts
export default defineGroup({ layout: 'dashboard', middleware: ['auth'] })
```

Outer groups apply before inner groups, and the page can specify its own options. For `middleware` inheritance, see [Route middleware](routing-middleware.md#named-middleware); for named and nested layouts, see [Layouts](routing-layouts.md#named-layouts).

## Related reference

`app/pages` also supports `+error.meeko`. Shared layouts live in `app/layouts`, while `+layout.meeko` nests them alongside pages. Error handling and SSR modes are in [Data and rendering](routing-data.md).
