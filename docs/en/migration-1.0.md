---
source-hash: 2ecd886ba5f4d77160800491a15769c18c2a539d6d6ab2e59e2851bf2c68bb33
---

# Migrate from 0.1.0 to 1.0

This guide collects breaking changes between `0.1.0` and `1.0`. The full list, including additions and fixes, is in the [CHANGELOG](../../packages/meeko/CHANGELOG.md). The [stability policy](stability.md) applies from 1.0 onward.

## Recommended order

1. Update `@meekojs/meeko` to the exact target version. If you use Meeko DevTools or the VS Code extension, update them to `1.0.0` too.
2. If `server/session.ts` exists, replace it with `server/runtime.ts` (see [Server and runtime](#server-and-runtime)). While that file exists, `meeko check`, `meeko dev` and `meeko build` stop.
3. Fix subpath imports and run `meeko check` to regenerate `.meeko/` and see type errors.
4. Run `meeko build` and update deployment scripts for the new output directory.
5. Review the sessions, Socket and rendering sections that affect your application.

## Package and subpaths

### The root only exports the public API

`@meekojs/meeko` exports exactly:

- `signal`, `computed`, `effect`, `batch`, `untrack`, `createRoot` and `onCleanup`;
- `createContext`, `provide` and `inject`;
- `provideErrorHandler` and `serializeJson`;
- their types.

DOM, SSR, HMR and DevTools helpers are only available in `@meekojs/meeko/internal`:

- `bind*`, `render*`, `keyToken`, `withStateSnapshot`, `escapeHtml`, `attributeValue` and `renderAttribute`;
- `enableHotModule`, `registerHot*`, `replaceHot*`, `restoreSignals` and `snapshotSignals`;
- `registerDevtoolsInstance`.

```ts
// Antes
import { escapeHtml, signal } from "@meekojs/meeko";

// Después
import { signal } from "@meekojs/meeko";
// escapeHtml ya no es público: use una función propia o, aceptando que sólo funciona
// con la misma versión exacta del paquete, impórtela desde "@meekojs/meeko/internal".
```

Compiler-generated modules have imported `@meekojs/meeko/internal` since `0.0.2`. Recompile any manually compiled and versioned `.meeko` modules (`meeko compile`) with the new version.

### `ComponentErrorHandler` receives the error source

The `provideErrorHandler` observer receives a second argument `source: ErrorSource` (`"event"`, `"effect"`, `"cleanup"`, `"navigation"` or `"socket"`). Single-parameter handlers remain valid. Only code that **calls** a `ComponentErrorHandler` itself changes, for example in a test:

```ts
// Antes
handler(new Error("boom"));

// Después
handler(new Error("boom"), "event");
```

### `@meekojs/meeko/server` is portable: build and Node are separated

`@meekojs/meeko/server` only uses Web APIs and `node:async_hooks`. Build tools and Node transport move to their own subpaths:

| Symbols                                                                                                                                                                                                   | Before                  | After                  |
| --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------- | ---------------------- |
| `discoverRoutes`, `discoverConfiguredRoutes`, `composeFrameworkRoutes`, `loadMeekoConfig`, `readMeekoConfigSync`, `resolveConfigSources`, `discoverServerManifest`, `prerenderRoutes`, `prerenderProject` | `@meekojs/meeko/server` | `@meekojs/meeko/build` |
| `toNodeListener`, `attachNodeWebSocketServer`, `createNodeSocketUpgradeHandler`                                                                                                                           | `@meekojs/meeko/server` | `@meekojs/meeko/node`  |

```ts
// Antes
import { createServerDispatcher, discoverServerManifest, prerenderProject, toNodeListener } from "@meekojs/meeko/server";

// Después
import { createServerDispatcher } from "@meekojs/meeko/server";
import { discoverServerManifest, prerenderProject } from "@meekojs/meeko/build";
import { toNodeListener } from "@meekojs/meeko/node";
```

`buildProject` is also in `@meekojs/meeko/build`, and `serveNode` and `createNodeAssetReader` are new in `@meekojs/meeko/node`.

### Explicit module loader

`createServerDispatcher`, `createLocalCalls`, `generateOpenApi` and `loadSocketChannels` no longer import routes from disk: they require a `load` loader.

```ts
// Antes
const dispatch = createServerDispatcher({ manifest, sessions, services });
const channels = await loadSocketChannels(manifest);

// Después (Node)
import { pathToFileURL } from "node:url";

const load = (file: string) => import(pathToFileURL(file).href);
const dispatch = createServerDispatcher({ manifest, sessions, services, load });
const channels = await loadSocketChannels(manifest, load);
```

## Server and runtime

### `server/session.ts` becomes `server/runtime.ts`

Meeko no longer loads `server/session.ts`. Move the `SessionManager` to the default export of `server/runtime.ts` and delete the old file:

```ts
// Antes: server/session.ts
import { MemorySessionStore, SessionManager } from "@meekojs/meeko/server";

export function createSessionManager(production: boolean) {
  if (production) throw new Error("Configure a persistent SessionStore in server/session.ts before production startup");
  return new SessionManager({ store: new MemorySessionStore(), production: false });
}
```

```ts
// Después: server/runtime.ts
import { defineServerRuntime, SessionManager } from "@meekojs/meeko/server";

export default defineServerRuntime(({ env, production, prerendering }) => ({
  sessions: new SessionManager({ store: createStore(env, production && !prerendering), production: production && !prerendering }),
  services: (request) => ({ /* servicios por petición */ }),
}));
```

The factory receives `{ env, production, platform, prerendering }` and can also return `services`, `socket`, `publicOrigin`, `onError` and `close`; see [Server runtime](framework.md#server-runtime). `meeko build` calls it with `prerendering: true` to render prerendered pages. There is no client traffic at this stage, so an in-memory store is enough.

### New build output

`meeko build` writes a standalone build per adapter. Node is the default adapter:

| Before                          | After                                                                                    |
| ------------------------------- | ---------------------------------------------------------------------------------------- |
| `.meeko/output/server/entry.js` | `.meeko/output/node/index.mjs`, with `chunks/` and `client/`                             |
| `.meeko/output/prerender/`      | `.meeko/output/node/prerender/`, with a `{ version: 1, pages }` index in `manifest.json` |

```sh
# Antes: el despliegue dependía de la salida anterior y de las fuentes
meeko start

# Después: la carpeta no lee app/, server/ ni meeko.config.ts
meeko build
node .meeko/output/node/index.mjs   # o meeko start
```

The server listens on `MEEKO_HOST`/`MEEKO_PORT` (`HOST`/`PORT` before `1.2`; or `server.host`/`server.port` in `meeko.config.ts`), defaulting to `127.0.0.1:4173`. The Node build needs dependencies from `node_modules`. For Bun, Deno or Cloudflare Workers, use `meeko build --adapter <bun|deno|cloudflare>`; see [Build, deployment and verification](framework.md#build-deployment-and-verification).

`prerenderRoutes` requires each document to contain `<head>` and also writes the navigation payload.

### Public files only from the manifest

Only public files listed in the build manifest are served. An unlisted file, including one added to `public/` after the build, is treated like any application route (usually `404`, previously `403`). Rebuild after adding public files.

### Entry points and virtual modules

- **Client routes.** HTML no longer includes `<script id="meeko-routes">`: the client entry point imports routes from `virtual:meeko-manifest/client`.
- **Server.** `virtual:meeko-server-pages` and `virtual:meeko-server-routes` are replaced by `virtual:meeko-server-app`.
- **Client pages.** The generated client entry point imports `virtual:meeko-client-routes`, declared by `.meeko/types/virtual-pages.d.ts`. If your project has its own entry point, regenerate types with `meeko check`.

These modules are not public API. A custom entry point importing them must pin the exact Meeko version (see [Outside the contract](stability.md#outside-the-contract)).

## Pages and rendering

### No `renderLayout`

`FrameworkHandlerOptions.renderLayout` is removed. Layouts are always composed with the outlet:

```ts
// Antes
createFrameworkHandler({ /* ... */ renderLayout: (file, children, context) => wrapInShell(children) });
```

```html
<!-- Después: app/layouts/default.meeko -->
<script lang="ts">
import type { Component } from "@meekojs/meeko";

export interface Props {
  outlet: Component<Record<string, unknown>>;
}

const props = defineProps<Props>();
</script>

<template>
  <main><component is="props.outlet"></component></main>
</template>
```

### `render` must be a literal

`meeko build` reads `render` from the sidecar without executing it. It must be a string literal in `definePage({ ... })`, in an exported object or in a local constant in the same file. A computed value, computed key, spread without a subsequent explicit `render`, or re-export stops the build.

```ts
// Antes
const mode = process.env.STATIC ? "prerender" : "ssr";
export const route = definePage({ render: mode });

// Después
export const route = definePage({ render: "prerender" });
```

### New page modes and types

- **`PageRender`.** Now includes `"stream"` and `"client"`, so an exhaustive `switch` must cover them or have a default branch.
- **`PageDefinition.render`.** Accepts `"ssr"`, `"stream"` and `"prerender"`.
- **Client pages.** Use `ClientPageDefinition`: its `load` receives `ClientPageLoadContext` (`url`, `params`, `search`, `signal`, `state`), without `request` or `context`.

```ts
// Antes
switch (render) { case "ssr": /* ... */ break; case "prerender": /* ... */ break; }

// Después
switch (render) {
  case "ssr": case "stream": /* ... */ break;
  case "prerender": /* ... */ break;
  case "client": /* ... */ break;
}
```

### The server checks the build's `render`

The server compares the sidecar's `render` with the manifest's, even if the sidecar omits it. A manifest with `render: "prerender"` and a sidecar without `render`, or with another value, returns an error until rebuilt. Run `meeko build` (or restart `meeko dev`) whenever you change a route's mode.

### State is sealed after rendering

Each request's `StateStore` is sealed after synchronous rendering and `head`, in every rendering mode. From then on, `useState` with a new key, `seed` or a write throws `STATE_SEALED`. A detached promise writing state rejects; if nobody catches it, Node terminates the process under its default configuration.

```ts
// Antes: la promesa escribe estado después del render
load: ({ state }) => {
  void loadStats().then((stats) => { state.get("stats", () => 0).value = stats; });
  return {};
},
```

```ts
// Después: espérela en el loader...
load: async ({ state }) => {
  state.get("stats", () => 0).value = await loadStats();
  return {};
},

// ...o devuélvala como valor diferido
load: () => ({ stats: defer(loadStats()) }),
```

### Loader `signal` and prerendering with `defer`

- **`PageRequestContext.signal`.** No longer `request.signal`. Also aborted by session revocation, stream cancellation, `HEAD` or a request error. If your code distinguished client disconnection by reading this signal, check `signal.reason`.
- **`defer` with `render: "prerender"`.** A rejected value fails the request with `500`, and `meeko build` stops with the affected route, instead of storing the error in HTML.
- **`prerenderRoutes`.** Takes the navigation payload from the document itself (`#meeko-payload`).

## Sessions and Socket

### `RequestContext.signal` includes revocation

`RequestContext.signal` combines the request signal with session revocation. It can abort with `SessionRevokedError` (`SESSION_REVOKED`, `401`) even if the client remains connected. Pass it to `fetch` and queries, and call `await context.session.verify()` before an irreversible effect.

```ts
handler: async ({ context }) => {
  await context.session.verify();
  return payments.charge(order, { signal: context.signal });
},
```

### Session changes in a stream

In a `"stream"` response whose headers have already been sent, `SessionHandle.create`, `rotate` and `revoke` reject with `SESSION_LOCKED` (`500`) without touching the store. Make session changes in the critical loader, not deferred work.

### Broadcast contract

`hub.broadcast()` resolves when the broker accepts the message and no longer rejects for delivery failures. It only rejects in these cases:

- the event does not exist;
- the payload fails its schema;
- the message, serialized with `serializeJson`, exceeds `maxMessageBytes` (`SOCKET_LIMIT_EXCEEDED`, `413`);
- the broker does not accept publication.

When a peer fails, Meeko closes it with `1008`, `1009`, `1011` or `1013` and sends the error to `onDeliveryError`. An `authorizeSend` returning `false` skips that peer without closing it. `LocalSocketPubSub.publish` sends listener errors to `onListenerError` instead of aggregating them.

```ts
// Antes: el rechazo de broadcast informaba de peers fallidos
try {
  await hub.broadcast("chat", "general", "message", payload);
} catch (error) {
  log(error);
}
```

```ts
// Después: server/runtime.ts observa las entregas
export default defineServerRuntime(() => ({
  sessions,
  socket: { onDeliveryError: (error, { channel, room, event }) => log(error, channel, room, event) },
}));
```

Without `socket.onDeliveryError`, delivery failures reach the runtime's `onError`.

### `SocketPubSub.subscribe` can be asynchronous

`subscribe` can return `Unsubscribe | Promise<Unsubscribe>`, and `Unsubscribe` can return a promise. Your own broker can adopt that signature, and code calling `subscribe` directly must await the result:

```ts
// Antes
const unsubscribe = pubsub.subscribe("chat", "general", listener);
unsubscribe();

// Después
const unsubscribe = await pubsub.subscribe("chat", "general", listener);
await unsubscribe();
```

## Protocol

The hydration and navigation payload moves to `v: 2`, with these changes:

- adds `render`, `head` and the `deferred` list, with `null` at each deferred `path`;
- `"stream"` routes respond to navigation with `application/meeko+ndjson`;
- the client explicitly rejects a payload without a version or with a different one (including `v: 1`).

Server and browser must come from the same build. Regenerate prerendered `index.meeko.json` files with `meeko build` and invalidate the CDN cache on deployment if they are cached there.

## DevTools

The DevTools protocol moves to version 1:

- **`DevtoolsHook` and `DevtoolsSnapshot`.** Both require `protocolVersion`, and the hook also requires `setSignal`. A manually constructed hook or snapshot, for example in tests, must add them:

  ```ts
  const hook: DevtoolsHook = {
    protocolVersion: 1,
    snapshot: () => ({ protocolVersion: 1, instances: [], events: [], selectedId: null }),
    subscribe: () => () => {},
    select() {},
    highlight() {},
    setBreakpoint() {},
    setSignal: () => ({ ok: false, error: "Not supported in this test" }),
  };
  ```

- **`DevtoolsReadSite.kind`.** Also accepts `computed`, `if`, `each` and `prop`. An exhaustive `switch` over `text`/`attribute` must cover them.
- **Panels.** The built-in panel and Chrome extension 1.0.0 reject runtimes without `protocolVersion`. Use extension 1.0.0 with Meeko 1.0, and the previous extension with earlier runtimes.

## Editor

- **VS Code.** The `meeko-language` extension 1.0.0 is a language server client. It uses the project's `@meekojs/meeko` server when installed (`meeko.languageServer.preferWorkspace`), and its bundled server as a fallback or in restricted mode. Install extension 1.0.0 and add `@meekojs/meeko` as a project dependency so the editor and CLI use the same version.
- **Other editors.** Can use the same server with `meeko lsp --stdio` or `meeko-language-server --stdio`; [editors.md](editors.md) explains configuration for Neovim, Helix, Zed, JetBrains and Sublime Text.
- **Module resolution.** `meeko check` now applies module resolution options from the package root's `tsconfig.json` (`paths`, `baseUrl`, `types`, `typeRoots`, `customConditions`, `resolveJsonModule`, `allowImportingTsExtensions`), just like the editor. An alias that previously failed with `TS2307` in the CLI now resolves, and type diagnostics hidden by that error may appear.
