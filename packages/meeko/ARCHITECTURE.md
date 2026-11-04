# Source ownership and dependency rules

This document defines ownership and dependency rules for `src/`. Public package entrypoints and generated paths remain compatibility contracts.

## Runtime layers

The dependency direction is `core -> shared -> app -> server` when read from lowest to highest layer. Imports may point only to the same or a lower layer. `core` contains environment independent primitives such as signals, ownership, serialization, and IDs; it cannot import app, server, compiler, or tooling. `shared` contains contracts and logic that work without a browser or request context. `app` owns component setup, rendering, hydration, navigation, and state scoped to an app or render. `server` owns request context, API/RPC/socket dispatch, middleware, sessions, and server adapters. Server rendering may call the app renderer; the app renderer cannot call server services. SSR does not make an app composable a server composable.

Within `app`, a browser-only module may depend on an isomorphic app module, but the reverse is forbidden. A composable's location follows the context and dependencies it requires; there is a single `app/composables` owner for render-scoped composables, including those used in both SSR and hydration. Only request-scoped composables live under `server/composables`. Pure, context-free helpers belong to `shared`, not a second app `shared` tree.

## Build-time layers

`compiler` owns parsing, code generation, and orchestration. Each component macro's compile-time analyzer, transformation, type contract, and editor documentation have one canonical owner under `app/definitions`; they never require a runtime macro function. The compiler imports those definitions, while runtime code never imports the compiler. Server definition helpers live with their API/RPC/socket ownership. `compiler/css` owns CSS processing and the PostCSS plugin; Vite consumes this processor. `autoimports`, `formatters`, the language server, CLI, and Vite are tooling and may depend on contracts and compiler services; runtime layers cannot depend on tooling. Extensible features live under `modules` only when implemented.

Public entrypoint barrels (`index.ts`, `framework.ts`, `framework-server.ts`, `postcss.ts`, `prettier.ts`, and existing package subpaths) may reexport owners. Internal reexport-only files are removed once callers are redirected. No runtime or build-time cycle may be introduced by those entrypoints. A type-only import of `framework.ts` for a generated, consumer-augmented interface is an explicit exception: its declaration must remain at the public module specifier to preserve existing `declare module "@meekojs/meeko/framework"` augmentations, and it emits no runtime dependency.

## Verification

`tests/architecture-boundaries.test.ts` checks layer direction, relative imports, and runtime import cycles. Changes to an owner must also preserve package exports, binaries, autoimports, Vite, `.meeko` compilation, SSR, hydration, and the installed package consumer. Unit tests stay beside their owner when moved; integration tests stay in `tests/`.
