---
source-hash: 85fe356f15fddbb21cb27774741ed9e7ff0b21b57bab0d488e1738ac135a48d9
---

# Meeko DevTools

DevTools lets you inspect and edit each hydrated instance during development with Vite. There are two interfaces over the same runtime: an in-page panel and a Chrome DevTools panel. Both consume the `window.__MEEKO_DEVTOOLS__` hook, which only exists in development.

## In-page panel

Since `1.8`, the recommended approach is to enable it in `meeko.config.ts`, like `devtools: true` in Nuxt:

```ts
// meeko.config.ts
import { defineMeekoConfig } from "@meekojs/meeko/framework";

export default defineMeekoConfig({ devtools: true });
```

With this option, `meeko dev` mounts the panel on every page without application code. `meeko build`, `meeko start`, `meeko preview` and prerendered pages never add it: the production bundle does not contain `@meekojs/meeko/devtools-ui`. It defaults to `false` in `1.x`, so upgrading does not introduce a new panel without asking. `{ position: "bottom-left" }` places it in another corner (`"bottom-right"`, the default, `"bottom-left"`, `"top-right"` or `"top-left"`), and `{ panel: false }` disables it without deleting the options. An invalid value stops `meeko dev`, `build` and `check` with a message naming the option; see the [`devtools` reference](reference/config/config-devtools.md). The [Chrome extension](#chrome-devtools-panel) and [editor bridge](#editor-bridge) work with or without this option, because they read the same hook.

Alternatively, an application can mount it itself, for example in another container; do not combine both approaches, or you may get two panels:

```ts
if (import.meta.env.DEV) {
  const { mountDevtoolsPanel } = await import("@meekojs/meeko/devtools-ui");
  const panel = mountDevtoolsPanel({ position: "top-right" });
  // panel.unmount() releases the interface when it is no longer used.
}
```

The repository's Vite example mounts it this way in development mode (`pnpm run build` and `pnpm run vite:dev`).

### Appearance, minimizing and moving

- **Meeko colors.** The panel uses Meeko site tokens (blue accent, neutral surfaces and Inter if the page has it, with a `system-ui` fallback). It follows the system's dark or light theme; if `<html>` has `data-theme="light"` or `"dark"` (the [`theme`](framework.md#lightdark-theme-without-flashing) option), it follows the page and changes with it. Tokens live inside its Shadow DOM: application CSS does not alter it, and the panel does not alter the application.
- **Minimize.** The **Minimizar** button (or `Alt+Shift+M` anywhere on the page) collapses the panel to a pill with the logo and, in pink, the number of new events since it was collapsed. Clicking the pill or using the same shortcut restores it. Focus moves to the pill or button, and screen readers announce “Restaurar Meeko DevTools · N eventos nuevos” (restore Meeko DevTools, N new events).
- **Move.** The header handle (the six dots) moves the panel to the nearest corner when released; with the handle focused, arrow keys move it between corners. You can also drag the pill.
- **Persistence.** The collapsed state and selected corner are saved in the application's origin `localStorage` (`meeko:devtools-panel`) and survive reloads. If `position` changes in configuration, the new value takes precedence. Without `localStorage` (private mode, blocked storage), the panel works the same way without persistence.

The panel offers:

- an instance tree;
- props and signal details;
- a signal editor;
- a filterable timeline;
- navigation and data preparation with duration and source, without copying their values;
- DOM highlighting;
- a breakpoint per instance.

Each event retains the component's name and `.meeko` file and a safe copy of the new value. Selecting an event from an active instance opens its details. Styles live in Shadow DOM so they do not alter application styles.

## Navigation and data

The **Navegación y datos** (navigation and data) filter in both panels shows application operations, separate from signals and component lifecycle:

| Event                         | Phases                                  | What it measures                                                                      |
| ----------------------------- | --------------------------------------- | ------------------------------------------------------------------------------------- |
| `navigation`                  | `start` → `commit`, `cancel` or `error` | From the start of a client navigation until its view is committed, canceled or fails. |
| `data`                        | `start` → `ready`, `cancel` or `error`  | Module and data preparation before committing the view.                               |
| `data` with `source: "cache"` | `ready`                                 | A read fulfilled by the local resource cache, without repeating the request.          |

Each operation has an `operationId` linking its start and end, the declared route pattern (for example, `/users/[id]`) and `durationMs` on completion. The data source is `server`, `client` or `static` depending on the route transport; local resource reads are identified as `cache`. A navigation's duration does not wait for the visual end of a View Transition.

These events do not include the resolved URL, query, fragment, parameters, headers, error messages or loader results. Cache events also exclude resource keys and values. Props and signals remain inspectable through their existing mechanisms: this limitation refers to navigation and data metadata. Without a development runtime installing the hook, these operations are not recorded. The shared limit of the latest 100 events is retained.

## Chrome DevTools panel

1. Open `chrome://extensions`, enable developer mode and load the repository's `packages/devtools` folder as an unpacked extension.
2. Open a Meeko application served by Vite in development, then Chrome's developer tools.
3. In the **Meeko** tab:
   - select an instance to see its props, signals and timeline;
   - filter by signals or instance, and click an event to return to its active component;
   - edit a signal through **Editar señal** (edit signal);
   - use **Resaltar** to locate the instance on the page;
   - enable the breakpoint and trigger a signal update.

The extension queries the inspected page's hook. It needs no account, remote service, host permissions or content scripts. It uses the same colors as the in-page panel and follows Chrome DevTools' light or dark theme. Its version (`1.0.0`) is independent of the npm package version; installation, packaging and tests are described in [`packages/devtools/README.md`](../../packages/devtools/README.md).

## Protocol

The hook and every snapshot declare `protocolVersion: 1`. Public types are exported from `@meekojs/meeko`:

- `DevtoolsHook`, `DevtoolsSnapshot`, `DevtoolsInstance`, `DevtoolsEvent`, `DevtoolsEventKind` and `DevtoolsValue`;
- `DevtoolsActivity`, for optional navigation and data metadata;
- `DevtoolsReadSite` and `DevtoolsReadKind`, for reads;
- `DevtoolsWriteSite`, `DevtoolsAssignmentSite` and `DevtoolsEditSite`, for writes;
- `DevtoolsCommandResult` and `DevtoolsProtocolVersion`;
- `DevtoolsSignalSite` (since `1.1`), for a signal's declaration.

Since `1.1`, each `DevtoolsInstance` in a snapshot can carry the optional `signalSites` field: an object mapping each signal name in `signals` to its declaration in the `.meeko` (`{ file, line, column }`, with 1-based line and column). It appears only when the development compilation knows that position; a protocol client must treat it as optional.

The hook exposes:

| Method                               | Effect                                                                                   |
| ------------------------------------ | ---------------------------------------------------------------------------------------- |
| `snapshot()`                         | Serializable snapshot of instances, recent events and selection.                         |
| `subscribe(listener)`                | Notifies of each change; returns the unsubscribe function.                               |
| `select(id)` / `highlight(id)`       | Selects or highlights an instance; `null` clears them.                                   |
| `setBreakpoint(id, enabled)`         | Enables or disables an instance's breakpoint.                                            |
| `setSignal(instanceId, name, value)` | Replaces a writable signal's value and returns `{ ok: true }` or `{ ok: false, error }`. |

The version changes only for incompatibilities and, according to the [stability policy](stability.md#devtools-and-editor), only in a Meeko major release. New fields or event types may appear within protocol 1. Both panels reject a hook or snapshot with a different version or none (runtimes before 1.0), and display a message stating the found and supported versions. They never read data from an unknown protocol. The integrated panel ships in the same package as the runtime. The Chrome extension requires an `@meekojs/meeko` implementing protocol 1.

`packages/meeko/src/devtools-protocol.ts` is the single source of types. The extension uses a generated copy in `packages/devtools/types/protocol.d.ts`, which its `tsc` with `checkJs` checks against `protocol.js` and `panel.js`. To regenerate it after changing the protocol:

```powershell
pnpm run devtools:types
```

`pnpm run devtools:check` fails if the copy is outdated.

## Edit signals

Both panels show an **Editar señal** (edit signal) form for the selected instance. It works as follows:

1. Choose a writable signal from the instance. `computed` values and non-signals are not listed.
2. Enter the new value as JSON and click **Aplicar**.
3. The panel validates the JSON before sending it and displays an error beside the button if it is invalid.
4. The runtime validates the value again and assigns it with `signal.value = value`. Effects, the template and the breakpoint react as they do to any other write.

Rules:

- It only exists in development, because the hook is not created in SSR or production.
- The value replaces the signal's entire value; it is not merged with the previous one.
- The value must be strict JSON: `null`, booleans, strings, finite numbers, arrays and plain objects, without cycles or accessors.
- The editor's initial text is the bounded copy displayed by the panel, not necessarily the complete original value. If the real value was deeper or longer than the copy, applying that text unchanged replaces it with the truncated version.
- `setSignal` returns `{ ok: false, error }` if the instance is no longer active, the name is not an own writable signal or the value is not valid JSON.
- If an observer throws while propagating the change, the value has already been written and the response is `{ ok: false }` with the error.
- The resulting event is marked “Escrita desde DevTools” (written from DevTools) (`write: { kind: "devtools" }`).

## Editor bridge

Since `1.1`, `meeko dev` publishes signal values from open pages for a local editor, which displays them beside the code and can edit them (see the [VS Code extension](../../packages/vscode/README.md#valores-en-vivo)). The bridge exists only in development and its protocol is not part of the public contract (see the [stability policy](stability.md#outside-the-contract)).

### How it works

1. When listening on loopback, `meeko dev` generates a random per-session token and writes a descriptor specific to its port, `.meeko/dev/editor-bridge-<puerto>.json` (with `0600` permissions where the system supports them):

   ```json
   { "protocol": 1, "url": "http://127.0.0.1:4173/__meeko/editor-bridge", "token": "…", "pid": 12345, "root": "/ruta/al/proyecto", "startedAt": "2026-10-26T10:00:00.000Z" }
   ```

   Multiple `meeko dev` servers for the same project on different ports coexist without overwriting each other's descriptor, and the editor connects to all of them. On shutdown, each server deletes its own descriptor if it still belongs to its session. On startup, it deletes orphaned descriptors for processes that no longer exist (for example, a forcibly terminated `meeko dev`), including the single `.meeko/dev/editor-bridge.json` from earlier development versions. The port is the one `meeko dev` actually uses: if `4173` was busy and it took `4174`, the descriptor is `editor-bridge-4174.json`. When `meeko dev` restarts because a linked `@meekojs/meeko` changed, the new server listens on the same port and writes a descriptor with a different session and token; the editor reconnects with it.

2. The editor reads the descriptors and opens `GET <url>/events` on each, an SSE stream with `hello` (`protocol`, `session`, `root`), `snapshot` (all signals) and `update` events (new or changed signals and those disappearing in `removed`). If no other editor was connected, open tabs were not sending values: the server requests their state and waits for all of them to respond, or at most about 300 ms, before sending `snapshot`; without tabs, it sends it immediately. Anything arriving during that wait goes into the snapshot itself, not an `update`.
3. To edit a signal, the editor sends `POST <url>/command` with `{ "type": "setSignal", "id", "value" }`. The server forwards the command to the tab holding the instance and responds with its result, `{ ok: true }` or `{ ok: false, error }`, like the hook's `setSignal`.
4. Between the browser and `meeko dev`, messages travel over Vite's HMR WebSocket. The browser only sends values while at least one editor is connected.

Each signal carries an `id` stable for the instance's lifetime (`pestaña/instancia/nombre`), the component, `.meeko` file, declaration line and column (from `signalSites`) and JSON value, copied with the same limits as DevTools. If the signal is the same object as another in the tab, such as a model a child receives from its parent with `defineModel`, it also carries `alias` with the primary signal (`id`, `instanceId`, `component`, `name`, `file` and its line and column). The primary is the one declaring the signal, not the one borrowing it, or the first registered. The editor displays the alias beside the primary and sends edits to it. A value over 4096 characters is trimmed and marked `truncated`; that text is no longer valid JSON. The browser batches changes every 100 ms and limits each message to about 128 KB. A command body allows at most 1 MB, and a command the tab does not answer within 5 s fails.

### Security

Every request to the bridge must meet all these conditions; otherwise, it responds with `403` or `401` without processing it:

- **Loopback.** The connection comes from a loopback address (`127.0.0.0/8` or `::1`).
- **`Host`.** The `Host` header names a loopback host (`localhost`, `127.x.x.x` or `[::1]`), blocking DNS rebinding attacks.
- **No `Origin`.** A request with an `Origin` header is rejected, even from loopback. Editors are local processes and do not send it; a page open in the browser always sends it, so none can use the bridge. In addition, the Vite plugin adds `**/.meeko/dev/**` to `server.fs.deny`, so no page can read the descriptor or its token.
- **Token.** The `Authorization: Bearer <token>` header carries the descriptor token, compared in constant time.

`meeko dev` only starts the bridge when the server listens on loopback or all interfaces (`0.0.0.0` or `::`); in that case, the descriptor points to `127.0.0.1`. There is no bridge with another address. To disable it, start with `MEEKO_EDITOR_BRIDGE=0`; since `1.7.1`, when there is no bridge, `meeko dev` says so after the URL and records it in `.meeko/dev/server.json` (`editorBridge: false` and `editorBridgeReason`), and the VS Code extension displays it in its status bar:

```powershell
$env:MEEKO_EDITOR_BRIDGE = "0"; npm run dev
```

If the bridge cannot start, `meeko dev` reports it in the console and the application keeps working without live values.

## Timeline locations

Locations are generated only in development, when the compiler works with `hot`. In production, compiled code includes no instrumentation and SSR HTML is identical.

### Reads

Each signal event can be expanded to see expressions that depended on it in that instance, with file, line, column and read kind:

| Kind        | Source                                                         |
| ----------- | -------------------------------------------------------------- |
| `text`      | Template interpolation `{...}`.                                |
| `attribute` | Bound attribute (`bind:`).                                     |
| `computed`  | Function passed to `computed(...)` in the `.meeko` script.     |
| `if`        | `if:when` condition.                                           |
| `each`      | `each:of` list.                                                |
| `prop`      | Prop passed to a child component (`name` identifies the prop). |

Tracking uses each instance's active dependencies, so a branch that no longer reads the signal stops appearing. A read indicates **where the signal is used**, not who wrote it.

### Writes

Each signal event also indicates what wrote the new value, when known:

- **Written at `archivo:línea:columna`**: an assignment to `.value` in the `.meeko` file. This covers `=`, `??=`, `||=` and `&&=`, compound assignments (`+=`, `-=`, …) and `++`/`--`. It applies both in the script and in template `on:` expressions.
- **Written from DevTools**: an edit made with `setSignal`.

Attribution lasts until the end of the current synchronous task and only applies if the value matches the written one. A signal changing in a cascade from another does not inherit its source.

## Scope and limits

- The hook appears only when hydrating components compiled by Vite in development. It is not created during SSR or in the production build.
- An instance appears with the “Hidratado” (hydrated) state after completing hydration. On unmount, it disappears from the tree and leaves an unmount event.
- Displayed values are bounded, serializable copies, so both panels can transport them without executing application code:
  - depth 4, 50 items or keys per level and 500 characters per string;
  - functions, DOM nodes and accessors are summarized;
  - the timeline keeps the 100 most recent events.
- Some writes have no location:
  - those made outside a `.meeko` file, for example in an imported `.ts` module;
  - those without a stable target, such as `make().value = 1` or `items[0].value = 1` (only identifiers, `this` and dotted property chains are instrumented);
  - compound assignments and `++`/`--` containing a direct `await` or `yield`. Simple assignments with `await` do get locations.
- A read is located as `computed` only when the `computed` identifier is called with a function literal as its argument. An alias or a function passed by reference receives no location.
- The breakpoint triggers on changes to the selected component's writable signals. Keep developer tools open for the browser to pause.
- DevTools does not step through every template expression.
