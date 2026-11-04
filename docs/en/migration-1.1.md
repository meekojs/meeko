---
source-hash: 4cfc4ecc6f3979f7d50632583f1323cc61dae12d82d91e987960520159d3acdc
---

# Upgrade from 1.0 to 1.1

`1.1` is a minor release: code written for `1.0` still works and new features (component tags, events, models, snippets, refs, `<script server>`, data composables, generic components…) are optional. Still, some changes are noticeable when upgrading. This guide collects them and what you should review for each. The complete list of additions and fixes is in the [CHANGELOG](../../packages/meeko/CHANGELOG.md); compatibility commitments are in the [stability policy](stability.md).

## Recommended order

1. Update `@meekojs/meeko` to exact version `1.1.0` and recompile or rebuild: generated code and runtime must have the same version. If you use the VS Code extension or Meeko DevTools, update them too.
2. Run `meeko check`. The most likely new errors are extra component props (see [Stricter component props](#stricter-component-props)) and reserved template names.
3. Review top-level setup code in pages and layouts with data or dynamic components (see [Navigation's preliminary render](#navigations-preliminary-render)).
4. Replace the `useSocket` import from `@meekojs/meeko/framework` with `useSocketClient`. If you have a custom WebSocket client or Socket adapter, review the new handshake closes (see [Socket: `4401` and `4403` handshake closes](#socket-4401-and-4403-handshake-closes)).
5. If a tool reads CLI or `meeko check` output, make it use codes rather than message text.

## Type checking

### Stricter component props

`meeko check` and the editor check each tag's props (`<Etiqueta>` or `<component is>`) only against those declared by the child:

- An unknown prop is an error even alongside valid ones on the same tag. In `1.0` it passed checking and was ignored at runtime.
- `bind:variant="'secondary'"` retains its literal type against a union (`"primary" | "secondary"`) instead of widening to `string`.
- A missing required prop is flagged on the tag with `TS2345` instead of `TS2769`.

An extra prop did not fail at runtime, so this change is an [approved exception](stability.md#approved-exceptions) to stability policy. To fix it, remove the prop or declare it in the child's `defineProps`:

```html
<!-- Before: "size" is not in Card's props and 1.0 accepted it -->
<component is="Card" bind:title="title" bind:size="'lg'"></component>

<!-- After -->
<component is="Card" bind:title="title"></component>
```

If a tool filtered diagnostics by `TS2769`, add `TS2345`.

### `meeko check` checks imported `.ts` files with their auto-imports

The `.ts` files imported by a `.meeko` are checked with their scope's auto-imports and generated routes, as in `.meeko/`'s `tsconfig.*` projects. You may see new errors already shown by the editor, such as `href("/ruta-inexistente")`. False `TS2304` errors for auto-imported composables, stores or utilities in those files disappear.

### `ErrorSource` includes `"mounted"`

Failures in an `onMounted` callback and a setup's browser continuation after `await` reach `provideErrorHandler` and the application's `onError` with source `"mounted"`. An exhaustive `switch` on `ErrorSource` without a `default` branch stops compiling: add a `"mounted"` branch or a default.

## Template

### `ref`, `model` and `html` are directives

- `ref:nombre` is a directive. `ref="x"` and `bind:ref` behave as in `1.0`.
- On a custom element (a hyphenated tag, such as `<x-markdown html="intro">` or `<my-input model="query">`), `html` and `model` remain literal HTML attributes, as in `1.0`: no changes needed. The following applies to standard HTML elements, where `html` and `model` are not valid attributes.
- `model="..."` on an element no longer writes the `model` HTML attribute: it binds a signal to a form control (see [Form controls with `model`](api.md#form-controls-with-model)). On an unsupported element, it produces `MEEK065`.
- `html="..."` on an element no longer writes the `html` HTML attribute: it inserts the value as unescaped HTML (see [Unescaped HTML with `html`](api.md#unescaped-html-with-html)). On an unsupported element, it produces `MEEK095`.

If you need the literal attribute, write it with `bind:model` or `bind:html`, which still write the attribute:

```html
<!-- Before: atributo HTML model="draft" -->
<div model="draft"></div>

<!-- After -->
<div bind:model="'draft'"></div>
```

On a component tag, `is`, `ref` and `html` are not static props (`MEEK032`).

### Retired diagnostics

`MEEK005` (missing `<script lang="ts">`), `MEEK023` (missing `each:key`) and `MEEK049` (content inside a component tag) are no longer emitted because that code is now valid. A tool expecting them will no longer receive them.

## Lifecycle and navigation

### Navigation's preliminary render

Before committing navigation, the browser renders the new page without displaying it to load its awaited data, with `useNavigation().pending` as `true`. This is a dry run: it runs neither `effect`, `onMounted` nor the browser continuation, and `useSocket` does not connect.

What does run again is the page's and new layouts' **top-level setup code**, with provisional state that is discarded. Thus, in pages whose tree contains awaited data or a runtime-selected component (`<component is>` with a variable, an `each:` item or snippet parameter), that code runs twice per navigation. If the tree cannot await data, the pass is skipped and setup runs only once, as in `1.0`.

Review top-level setup in those pages and layouts: an `api.*` request, external store write or counter increment there repeats. Move them to `onMounted`, a handler or an `effect`:

```html
<script lang="ts">
// Before: also runs in the render before each navigation
void api.analytics.post({ body: { page: "users" } });

// After: only in the browser, once the page is mounted
onMounted(() => {
  void api.analytics.post({ body: { page: "users" } });
});
</script>
```

See [Navigation and `render: "client"`](framework.md#navigation-and-render-client).

### `onMounted` ordering

`onMounted` is new in `1.1`. When replacing an `effect` or `queueMicrotask` waiting for the DOM, consider its order: callbacks run at the end of the current hydration or mount operation, when later siblings and parent bindings already exist, and children run theirs before the parent. It never runs in SSR or navigation's preliminary render. See [Lifecycle](api.md#lifecycle).

### Navigation error pages and the `Error` title

- A client navigation whose data request responds with `404` (through `notFound()` or a loader `404` `ApiError`) displays the nearest `+error.meeko`, or `app/error.meeko`, with `{ status: 404, message }`, like the SSR document. In `1.0`, navigation failed with an error.
- Error pages use the `Error` title in SSR and navigation, including `app/error.meeko`'s `404` for a URL without a route. Update tests expecting another `document.title` on those pages.
- When navigating to a page without `title`, `document.title` returns to the host title or no title, like SSR; previously it retained the previous page's title.
- A new navigation starts at the top or its fragment's element; previously it retained the previous page's scroll position. A link to a fragment of the current page no longer rerenders it.

### Layer and module pages inside the project shell

`app/app.meeko` and the project's root layout now wrap `extends` and `modules` pages, with the layer's `+layout.meeko` nested inside. If the project has `app.meeko` or a root layout, they replace the layer's. Previously those pages rendered alone in `#app`. Review layer pages' appearance if your root layout assumed it did not wrap them.

## Framework and CLI

### `useSocket` from `@meekojs/meeko/framework` becomes `useSocketClient`

`useSocket(url, contract, options)` from `@meekojs/meeko/framework` is deprecated and will be removed in `2.0`. It is the same function as `useSocketClient`, with the same signature and types, so simply change the import:

```ts
// Before
import { useSocket } from "@meekojs/meeko/framework";
const chat = useSocket("wss://example.com/_meeko/socket/chat", chatContract);

// After
import { useSocketClient } from "@meekojs/meeko/framework";
const chat = useSocketClient("wss://example.com/_meeko/socket/chat", chatContract);
```

The editor strikes through alias uses. Generated clients' `useSocket("canal", opciones)` auto-import is unchanged and not deprecated.

### Socket: `4401` and `4403` handshake closes

In `1.0`, a Socket handshake without a session on an `auth: "required"` channel received HTTP `401`, and one rejected by `authorize` received `403`, without upgrading. The browser's `WebSocket` does not expose that status, so the client saw it as a network failure and retried endlessly. Since `1.1`, Node, Bun, Deno and Cloudflare adapters complete the upgrade and immediately close with `4401` (“Autenticación requerida”) or `4403` (“Acceso denegado”), without calling handlers or delivering messages. The Meeko client then enters terminal `"unauthorized"` state. A hub reauthorizing an accepted connection, such as a room's Durable Object on wake, also closes with `4401` or `4403`, no longer `1008` (“Unauthorized”).

Other rejections are unchanged: disallowed Origin (`403` `INVALID_ORIGIN`), nonexistent channel (`404`), invalid name or request (`400`) and limits still respond over HTTP.

What to review:

- **Custom WebSocket client** (another library, a native app or tests expecting `401`/`403` during handshake, for example through `ws`'s `unexpected-response` event): the handshake now opens and closes immediately. Treat `4401` and `4403` closes as final rejection and do not retry.
- **Custom adapter over `createSocketUpgradeHandler`**: still works unchanged, responding with HTTP `status`, like `1.0`. To provide new behavior, handle the `reject` action's `close` field: upgrade and close with `close.code` and `close.reason` without calling `open`.

```ts
const upgrade = await handleUpgrade(request);
if (upgrade.action === "pass") return app.fetch(request);
if (upgrade.action === "reject" && !upgrade.close) return new Response(null, { status: upgrade.status });
const { socket, response } = Deno.upgradeWebSocket(request);
socket.onopen = () => {
  // Deno drops the connection without a close frame if it reads a message while closing: close after one tick.
  if (upgrade.action === "reject") { setTimeout(() => socket.close(upgrade.close?.code, upgrade.close?.reason), 0); return; }
  const session = upgrade.open({ send: (message) => socket.send(message), close: (code, reason) => socket.close(code, reason) });
  socket.onmessage = (event) => session.receive(event.data);
  socket.onclose = () => session.closed();
};
return response;
```

- **`createNodeSocketUpgradeHandler` with custom `reject`**: those two rejections no longer reach `reject`, but `upgrade` followed by closing. Disallowed Origin and other rejections still reach `reject`.

### Spanish messages

CLI text (help, success, errors and `meeko clean` output), Meeko diagnostics from the compiler, `meeko check` and framework, and the language server's own hovers, logs and diagnostics are in Spanish. Codes (`MEEK0xx`, `MEEK1xx`, `MEEK_*`) do not change. A tool reading output must use the code rather than text, which is not part of the contract.

An unknown CLI command or option now identifies the problem (`Comando desconocido: …`, `Opción desconocida para dev: --port`) before usage, still printed to `stderr` with exit code `1`.

### `meeko dev` registers new files without restarting

Creating or deleting pages, layouts, `app/app.meeko`, `app/error.meeko`, middleware or `server/api`, `server/rpc` and `server/socket` modules rediscovers routes and recreates the application. Recreation closes Socket connections and calls `server/runtime.ts` again, so in-memory store sessions are lost.

### Build outputs

- `meeko build` no longer copies `public/` to the server output root (`.meeko/output/node/`, Bun and Deno), where nothing served it: it exists only in `client/`. If a deployment script read those files from the root, read them from `client/`.
- SSR and prerendered documents include CSS for every component they render in `<head>`, not only the page and layouts.
