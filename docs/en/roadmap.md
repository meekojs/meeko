---
source-hash: 00a50a3012e2e78eb6a566fc6743e2dbe311c0416c7bd44fbb5d1f74ae8e070f
---

# Development roadmap

Meeko 1.0 completes the scope planned for the first stable release. From there, the [stability policy](stability.md) governs what can change in each release. This roadmap summarizes what has shipped and lists planned additions for the 1.x series. None has a committed date. Details of each release are in the [CHANGELOG](../../packages/meeko/CHANGELOG.md), and release preparation is covered in [releasing.md](releasing.md).

## Shipped in 1.0

- **Component engine**:
  - parser with its own AST and diagnostics located in the `.meeko` file;
  - attributes, conditions, keyed lists and nested components;
  - `<style scoped>` with `:global(...)`;
  - SSR, hydration with state transfer and signals;
  - Vite plugin with HMR.

  The package root only exposes the documented public API.

- **Editor.** The language server (`meeko lsp --stdio`, `meeko-language-server`) provides the same diagnostics as `meeko check`, plus completion, navigation, cross-file renaming, formatting and quick fixes. The VS Code 1.0.0 extension is its client, and [editors.md](editors.md) documents Neovim, Helix, Zed, JetBrains and Sublime Text.
- **DevTools.** Protocol 1 is shared by the built-in panel and the Chrome 1.0.0 extension. You can edit signals and see where each one is read and written in the timeline ([devtools.md](devtools.md)).
- **Full-stack framework**:
  - file-based routing, layouts, middleware and auto-imports;
  - typed API, RPC and Socket with Standard Schema;
  - per-request state, sealed after rendering.
- **Rendering modes.** `"ssr"`, `"stream"` (streaming SSR with `defer`), `"prerender"` and `"client"`, with transactional navigation between them.
- **Portable server.** `@meekojs/meeko/server` only uses Web APIs. It comes with Node, Bun, Deno and Cloudflare Workers adapters, standalone build output for each adapter and a shared conformance suite that runs in CI.
- **Distributed sessions and Socket.** Revocation aborts in-flight requests and closes the family's sockets. Broadcasts are distributed with Redis or Durable Objects, with bounded queues per peer.
- **Publishing.** The package is published to npm with provenance (OIDC), and prereleases use the `next` dist-tag. There are workflows for Visual Studio Marketplace, Open VSX and Chrome Web Store.

## After 1.0

All these additions are additive. They can ship in a minor release without breaking existing applications.

- **Send HTML before the loader.** Currently a `"stream"` page waits for the critical loader before the first byte. This addition would send the beginning of the document (`<head>`, styles and client entry point) earlier.
- **Purely static SPA shell.** An application whose pages are all `render: "client"` could be served as static files, without a server running middleware or layouts.
- **List hydration performance.** The [comparison with Vue](benchmarks.md#extended-scenarios-tree-list-and-navigation) shows list hydration taking longer than Vue, and full view mounting also needs to become faster. This is performance work: it does not change the API.
- **Layer middleware.** Currently discovery of `app/middleware` and `server/middleware` is limited to the root project; since `1.2`, a module can add server middleware with `meeko.addServerMiddleware`.
- **Inline content in `<component>`.** A syntax for passing content inside the tag, as an alternative to a `Component<Props>` prop.
- **Extensions in stores.** The accounts and secrets needed by the prepared workflows still need to be set up ([releasing.md](releasing.md#publishing-to-extension-stores)).

## Earlier stages

Versions `0.0.1` through `0.1.0` built this scope in stages:

1. parser and diagnostics;
2. complete templates;
3. robust SSR and hydration;
4. typing and editor;
5. Vite integration and benchmarks;
6. DevTools;
7. full-stack framework.

The [CHANGELOG](../../packages/meeko/CHANGELOG.md) and the per-version sections of [releasing.md](releasing.md) record what each included and how it was verified.
