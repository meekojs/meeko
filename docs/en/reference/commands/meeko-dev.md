---
title: meeko dev
group: commands
since: 1.0.0
description: Development server for a full-stack application, preparing .meeko/ types and serving the application with Vite, SSR and HMR.
symbols:
  - "cli:dev"
related:
  - "cli:check"
  - "cli:build"
  - "cli:clean"
  - "config:dev"
  - "@meekojs/meeko/vite#meeko"
  - docs/framework.md#configuración
  - docs/framework.md#logs-del-servidor-en-la-consola-del-navegador
  - docs/devtools.md#puente-del-editor
source-hash: e611983970f6de03f2422d7f6d9e388e969b052d727900331f397148d755e3e7
---

`meeko dev` starts the application in the specified directory (current directory by default) in development mode. It first reads the project's `.env`, loads `meeko.config.ts` and its modules and generates Vite entry points, route, contract and auto-import types and, since `1.7`, `.meeko/types/services.d.ts` in `.meeko/`. It then creates a Node HTTP server with Vite in middleware mode: SSR with uncompiled `app/` and `server/` modules, component and CSS HMR, and server logs in the browser console.

It does not check types: that is [`meeko check`](/en/docs/reference/meeko-check). It does not serve the production build either: that is [`meeko start`](/en/docs/reference/meeko-start).

## Usage

```sh
# en la raíz del proyecto, la que tiene meeko.config.ts
meeko dev
```

```text
http://localhost:4173
```

The [`meeko init-framework`](/en/docs/reference/meeko-init-framework) starter declares it as `"dev": "meeko dev ."`, so you usually run `npm run dev` or `pnpm dev`.

## Options

| Option                   | Type   | Default                     | Description                                                                                                                                                      |
| ------------------------ | ------ | --------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `[directorio]`           | path   | `.`                         | Project root. Also the folder whose `.env` is read.                                                                                                              |
| `MEEKO_PORT` (or `PORT`) | number | first available from `4173` | HTTP port. Overrides `server.port` from `meeko.config.ts` (only with `adapter: "node"`). An explicitly specified port is used as-is: if occupied, startup fails. |
| `MEEKO_HOST`             | text   | `127.0.0.1`                 | Listening address. Overrides `server.host`. With `0.0.0.0`, accepts connections from other machines. `HOST` remains valid, with a warning, until `2.0`.          |
| `MEEKO_PUBLIC_ORIGIN`    | origin | none                        | Public origin for HTTP and Socket `Origin` checks behind a proxy or tunnel.                                                                                      |
| `MEEKO_HMR_PORT`         | number | derived from HTTP port      | Vite HMR WebSocket port, listening only on `127.0.0.1`.                                                                                                          |
| `MEEKO_EDITOR_BRIDGE=0`  | `0`    | enabled                     | Disables the editor bridge (extension live values). Since `1.7.1`, `meeko dev` reports this after the URL and the extension shows it in the status bar.          |
| `MEEKO_LINK_WATCH=0`     | `0`    | enabled                     | With linked `@meekojs/meeko` (`link:`, `npm link`, a workspace), does not restart the server when the package rebuilds: only warns.                              |

Accepts no flags: `meeko dev --port 3000` exits with `Opción desconocida para dev: --port`. Set ports and address through environment variables, in the shell or `.env`.

## Result

- **Standard output**, the URL to open, such as `http://localhost:4173`: since `1.7.1`, a loopback (`127.0.0.1`, `::1`) or all-interface address (`0.0.0.0`, `::`) is displayed as `localhost`, though the server still listens on the configured address. With `0.0.0.0` or `::`, adds a `Red: http://<IP>:4173` line per network address; with a specific host, displays that host. The first line is always the local URL alone. If no port was specified and `4173` is occupied, it first warns: `[meeko] El puerto 4173 está en uso; meeko dev usa el 4174`.
- **Standard error**, without an editor bridge, since `1.7.1`, a line after the URL with the reason: `Valores en vivo del editor desactivados (MEEKO_EDITOR_BRIDGE=0)` or, if listening on a specific non-loopback address, `Valores en vivo del editor desactivados (meeko dev escucha en 192.168.1.5, fuera de loopback)`.
- **In `.meeko/`**, `generated/` entry points, manifests, `types/` declarations and the editor's `tsconfig.*.json`, like `meeko check` but without running TypeScript. Generated at startup: types are not regenerated while the process remains alive (run `meeko check`).
- **In `.meeko/dev/`**, the editor bridge descriptor `editor-bridge-<puerto>.json`, deleted on `Ctrl+C`, and `server.json`, the serving process record (`pid` and `startedAt`), also deleted on exit. Without the bridge, since `1.7.1`, that record adds `editorBridge: false` and `editorBridgeReason` so the editor can explain it.
- **The process** runs until `SIGINT` or `SIGTERM`, closing the bridge, Socket, HTTP, application and Vite in that order. A startup error exits with code `1` and the message on standard error.

While running, creating or deleting a page, layout, middleware or `server/api`, `server/rpc` or `server/socket` module rediscovers routes and recreates the application without restarting the process. Changing `meeko.config.ts`, a module's `setup` or an existing Socket channel requires restarting.

## Examples

### Another port, using the project's `.env`

```sh
# .env
MEEKO_PORT=3000
```

```sh
meeko dev
# http://localhost:3000
```

A shell variable overrides `.env`: `MEEKO_PORT=3100 meeko dev` uses `3100` even if `.env` says otherwise.

### Two applications at once

Without a specified port, the second `meeko dev` takes the next available one instead of failing, and its HMR uses another derived port:

```sh
# terminal 1, en ./tienda
meeko dev
# http://localhost:4173

# terminal 2, en ./panel
meeko dev
# [meeko] El puerto 4173 está en uso; meeko dev usa el 4174
# http://localhost:4174
```

### Test from a phone on the local network

```sh
MEEKO_HOST=0.0.0.0 meeko dev
# http://localhost:4173
# Red: http://192.168.1.20:4173
```

In PowerShell:

```powershell
$env:MEEKO_HOST = "0.0.0.0"; meeko dev
```

The phone opens the URL in the `Red:` line. The HMR WebSocket and server logs still listen only on `127.0.0.1`: the phone's browser receives neither HMR nor logs in its console.

### Behind an HTTPS tunnel or proxy

```sh
MEEKO_PUBLIC_ORIGIN=https://mi-tunel.example.com meeko dev
```

Without it, mutations (API and RPC `POST`) and sockets arriving with `Origin: https://mi-tunel.example.com` are rejected because they do not match the local origin.

### Another monorepo project

```sh
meeko dev apps/meeko
```

The path is the project root, not a file: `.env`, `meeko.config.ts`, `app/` and `.meeko/` are read and written inside `apps/meeko`.

## Common mistakes

### Pass the port as a flag

```sh bad
meeko dev --port 3000
```

The CLI responds with `Opción desconocida para dev: --port`, prints usage and exits with code `1`. `meeko dev` has no flags; since `1.7`, `meeko dev --help` prints help.

```sh good
MEEKO_PORT=3000 meeko dev
```

### A specified port already in use

With `MEEKO_PORT`, `PORT` or `server.port`, `meeko dev` does not look for another port: whoever sets it expects that URL.

```sh bad
# otro meeko dev (u otro programa) ya escucha en el 4391
MEEKO_PORT=4391 meeko dev
```

```text
El puerto 4391 de 127.0.0.1 ya está en uso; usa MEEKO_PORT=<otro puerto> o cierra el otro meeko dev
```

The process exits with code `1`. If you specify no port and all 20 from `4173` are occupied, the message is `Los puertos 4173–4192 de 127.0.0.1 ya están en uso; usa MEEKO_PORT=<puerto> o cierra otro meeko dev`.

```sh good
MEEKO_PORT=4392 meeko dev
# o, sin puerto con nombre, que elija el primero libre
meeko dev
```

### Run outside the project root

```sh bad
cd apps/meeko/app
meeko dev
```

`meeko dev` looks for `app/pages` inside the given directory and fails with `ENOENT: no such file or directory, scandir '…\apps\meeko\app\app\pages'`. It would also read the wrong `.env`.

```sh good
meeko dev apps/meeko
```

### `MEEKO_LINK_WATCH=0` and a changing linked Meeko

With `@meekojs/meeko` linked to its repository, `meeko dev` supervises itself and restarts the server when the package's `dist/` changes (`[meeko] Meeko enlazado cambió; reiniciando meeko dev…`). With `MEEKO_LINK_WATCH=0`, it does not:

```sh bad
MEEKO_LINK_WATCH=0 meeko dev
# después, pnpm -F @meekojs/meeko run build en el otro repositorio
```

```text
[meeko] Meeko enlazado cambió (…\packages\meeko\dist), pero este meeko dev no se reinicia solo (MEEKO_LINK_WATCH=0): el servidor sigue con el código anterior y el navegador recibe el nuevo. Reinicia meeko dev.
```

SSR continues with the old runtime and the browser hydrates with the new one: resulting hydration errors are not application errors.

```sh good
meeko dev
```

Use `MEEKO_LINK_WATCH=0` only if the process must not restart (for example, with a debugger attached), and restart it manually after each package build.

### Expect `meeko dev` to check types

```sh bad
# CI
meeko dev & sleep 10 && curl -f http://127.0.0.1:4173/
```

`meeko dev` serves a page even if another has a type error: Vite strips types without checking them. A TypeScript error only appears in `meeko check`, `meeko build` and the editor.

```sh good
meeko check
```

## Notes

- **Development only.** Serves unbundled source modules, with CSP disabled (Vite injects scripts without a nonce) and server logs in the browser. Do not publish it on the Internet; use `meeko build` and `meeko start` in production.
- **`.env`.** `dev`, `build`, `start`, `preview` and `check` read `<directorio>/.env` first, including `MEEKO_PORT` or `MEEKO_LINK_WATCH`. An existing environment variable is never replaced. Changing `.env` while running restarts Vite and recreates the application; in-memory sessions are lost.
- **Ports.** Without a specified port, tries `4173` through `4192` and takes the first whose derived HMR port is also available. HMR uses a port derived from HTTP so two projects do not share Vite's `24678`.
- **Two processes in the same project.** Each startup rewrites `.meeko/generated/`; a second `meeko dev` in the same directory makes the first reload its SSR entry points. Since `1.7`, each `meeko dev` records its PID in `.meeko/dev/server.json` and the second warns at startup: `[meeko] Otro meeko dev (PID …) ya sirve este proyecto: …`. It only warns and continues; use one process per project.
- **Windows and POSIX.** On Windows, `Ctrl+C` closes the server and deletes `.meeko/dev/editor-bridge-<puerto>.json`; killing the process from Task Manager (or with `taskkill /F`) skips shutdown and leaves the descriptor in `.meeko/dev/` (`meeko clean` removes it). On POSIX, `kill` (SIGTERM) shuts down gracefully.
- **Performance.** Startup discovers routes, contracts and auto-imports and writes types before listening, but does not run TypeScript, the slow part of `meeko check`. Editing an existing page, layout or handler restarts nothing: Vite reloads that module on request.
- **Process errors.** An unhandled rejection in application code is logged and the server continues; an uncaught exception closes the server with code `1`.
