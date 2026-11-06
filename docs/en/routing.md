---
source-hash: 0b732e4ebb909d25217935940529db78798a6152b1b0e5970a9e1cdb85af9069
---

# Routing

Meeko creates routes from `app/pages` and uses the same manifest for SSR and browser navigation. This index collects the topic guides; each has its own section index on the site.

## Where to start

1. Follow the [router tutorial](router.md) to build pages, load data and navigate between them.
2. Read [Pages and parameters](routing-pages.md) for file conventions, dynamic segments and groups.
3. Choose the [Data and rendering](routing-data.md) options each page needs.

## Guides by topic

| Topic                                     | Contents                                                        |
| ----------------------------------------- | --------------------------------------------------------------- |
| [Pages and parameters](routing-pages.md)  | Route files, precedence, parameters and per-folder options.     |
| [Data and rendering](routing-data.md)     | Server code, loading, errors, SSR, streaming and caching.       |
| [Layouts](routing-layouts.md)             | Named layouts, nesting and props.                               |
| [Navigation](routing-navigation.md)       | `MeekoLink`, `useRoute`, state, scrolling and View Transitions. |
| [Route middleware](routing-middleware.md) | Global, named and server-only middleware.                       |

## API reference

The guides link to technical details when needed: [data](routing-data-reference.md), [layouts](routing-layouts-reference.md), [navigation](routing-navigation-reference.md) and [middleware](routing-middleware-reference.md). The [reference by category](/docs/reference) has API signatures and examples. For general HTTP middleware that also covers API and RPC, see [Server middleware](framework.md#server-middleware).
