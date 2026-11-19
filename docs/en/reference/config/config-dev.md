---
title: dev
group: config
since: 1.3.0
description: Options for meeko dev, such as forwarding server code output to the browser console while handling a request or the hosts it can be opened from (proxies and tunnels).
symbols:
  - "config:dev"
related:
  - "cli:dev"
  - docs/framework.md#logs-del-servidor-en-la-consola-del-navegador
  - docs/framework.md#configuración
source-hash: c47c00eeeadaece904dc08e44db863606bf7a8ae23eb69273b90940d2c5f3327
---

`dev` groups the options for `meeko dev`; they do not affect `meeko build`, `meeko start` or any production output. It has two: `serverLogs`, which enables or disables server logs in the browser console, and, since `1.10`, `allowedHosts`, the hosts `meeko dev` can be opened from (a proxy, a tunnel or a local network name).

With `serverLogs` enabled (the default), anything server code writes with `console.log`, `info`, `warn`, `error` or `debug` while handling a request also appears in the browser console, grouped by request, like Nuxt's `features.devLogs`. The terminal still displays it as usual.

## Usage

```ts
// meeko.config.ts
import { defineMeekoConfig } from "@meekojs/meeko/framework";

export default defineMeekoConfig({ dev: { serverLogs: false } });
```

## Options

| Option         | Type               | Default | Description                                                                                                                                                                               |
| -------------- | ------------------ | ------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `serverLogs`   | `boolean`          | `true`  | Forwards each request's server logs to the browser console in `meeko dev`.                                                                                                                |
| `allowedHosts` | `string[] \| true` | none    | Since `1.10`. Hosts, `.domain` suffixes or full origins `meeko dev` can be opened from; `true`, any. See [Opening meeko dev from another device](#opening-meeko-dev-from-another-device). |

## Result

With `serverLogs: true`:

- **What is forwarded.** Anything executed for a request: middleware, loaders, `<script server>`, `*.server.ts` plugins, rendering, SSR `api.*` and `rpc.*` clients, API and RPC handlers and their asynchronous work. Startup, `server/runtime.ts` and Socket callbacks only go to the terminal.
- **How it arrives.** In the HTML document, in the `"stream"` stream, in a client navigation payload or, for API and RPC, over Vite's HMR WebSocket.
- **How it appears.** One group per request with the `server` badge, method, path and `requestId`; objects expand as they do on the server.

With `serverLogs: false`, none of this happens: the terminal still displays the logs.

## Opening meeko dev from another device

`allowedHosts` (since `1.10`) lets you open `meeko dev` through a proxy or a tunnel (`tailscale serve`, ngrok, cloudflared) or with a local network name (`my-pc.local`). Without it, such a request is blocked twice: first the host, which Vite only accepts for `localhost`, `*.localhost` and IP addresses, and then the `Origin` of API, RPC, form, `session.create` and Socket mutations, because a tunnel that terminates TLS sends `https://<host>` while Meeko sees `http://<host>`.

```ts
// meeko.config.ts
import { defineMeekoConfig } from "@meekojs/meeko/framework";

export default defineMeekoConfig({
  dev: { allowedHosts: ["my-pc.tailnet.ts.net", ".ngrok-free.app"] },
});
```

Each entry can be:

| Entry                            | Host served                                  | `Origin` accepted                                    |
| -------------------------------- | -------------------------------------------- | ---------------------------------------------------- |
| `"my-pc.tailnet.ts.net"`         | that name, on any port                       | `https://` and `http://` of that name, on any port   |
| `".ngrok-free.app"`              | `ngrok-free.app` and its subdomains          | `https://` and `http://` of those names              |
| `"https://dev.example.com:8443"` | `dev.example.com`                            | only `https://dev.example.com:8443`                  |
| `true`                           | any, like Vite's `server.allowedHosts: true` | one with the same host as the request, http or https |

The `MEEKO_ALLOWED_HOSTS` variable adds entries without touching the file, separated by commas, or `true`; it is also read from the project's `.env`:

```sh
MEEKO_ALLOWED_HOSTS=my-pc.tailnet.ts.net,.ngrok-free.app meeko dev
```

A module with `extendViteConfig` for `server.allowedHosts` is no longer needed: Meeko passes Vite these entries, the host of `MEEKO_HOST` (or `server.host`) and that of `MEEKO_PUBLIC_ORIGIN`. Whatever a module adds to `server.allowedHosts` still counts.

When `meeko dev` refuses a request, it says what to configure:

- **Host.** It answers `403` with `[meeko] meeko dev bloqueó una petición con el host "my-pc.local". … añádalo a dev.allowedHosts en meeko.config.ts (…) o a la variable MEEKO_ALLOWED_HOSTS`, and writes it once to the terminal.
- **Origin.** The response is still `403 INVALID_ORIGIN`, and the terminal (and, with `serverLogs`, the browser console) warns once per origin: `[meeko] meeko dev rechazó una petición con Origin "https://my-pc.local" (403 INVALID_ORIGIN). Si abre la aplicación a través de un proxy o un túnel, añada "my-pc.local" a dev.allowedHosts …`.

`allowedHosts` does not exist outside `meeko dev`: `meeko build`, `meeko start`, `meeko preview` and adapter outputs do not read it, and a `SessionManager` with `production: true` ignores it even when given. In production, an extra origin is declared in `SessionManager`'s `allowedOrigins` (or `socket.allowedOrigins`), and that of a proxy with `MEEKO_PUBLIC_ORIGIN`.

## Examples

### Disabling it with a variable

```ts
import { defineMeekoConfig } from "@meekojs/meeko/framework";

export default defineMeekoConfig({ dev: { serverLogs: process.env.MEEKO_DEV_LOGS !== "0" } });
```

```sh
MEEKO_DEV_LOGS=0 npm run dev
```

## Common mistakes

### A value that is not boolean

```ts bad
export default defineMeekoConfig({ dev: { serverLogs: "no" } as never });
```

`meeko dev`, `meeko build`, `meeko check` and `meeko routes` stop with `…/meeko.config.ts: dev.serverLogs debe ser un booleano`.

```ts good
import { defineMeekoConfig } from "@meekojs/meeko/framework";
export default defineMeekoConfig({ dev: { serverLogs: false } });
```

### A host with a scheme, port or path

```ts bad
export default defineMeekoConfig({ dev: { allowedHosts: ["my-pc.local:4173"] } });
```

Loading stops with `…/meeko.config.ts: dev.allowedHosts[0] "my-pc.local:4173" debe ser un nombre de host (sin esquema, puerto ni ruta) o un origen completo como https://my-pc.local`. A host is valid on any port; to limit the `Origin` to one port, write the full origin.

```ts good
import { defineMeekoConfig } from "@meekojs/meeko/framework";
export default defineMeekoConfig({ dev: { allowedHosts: ["my-pc.local"] } });
```

### Exposing the HMR port through a tunnel

```sh bad
cloudflared tunnel --url http://127.0.0.1:$MEEKO_HMR_PORT   # Meeko's HMR WebSocket
```

Anyone who connects to the HMR WebSocket receives logs for all requests, like a local tab. Expose only the application port, or disable `serverLogs`.

```sh good
cloudflared tunnel --url http://127.0.0.1:4173
```

## Notes

- **Development only.** Neither `console` capture nor its code exists in `meeko build`, `meeko start` or `meeko preview`.
- **Only for the developer's browser.** Responses only carry logs if the request arrives from loopback, with a loopback `Host` and without proxy headers (`Forwarded`, `X-Forwarded-*`, `CF-Connecting-IP`…): visitors through a tunnel do not receive them.
- **Secrets.** Logs may contain sensitive data; disable them in a shared demo.
- **HMR from another device.** `allowedHosts` opens the application port; Vite's HMR WebSocket still listens only on `127.0.0.1`, so on another device the page works but does not reload by itself on edits.
- **Development.** Changing `meeko.config.ts` or `MEEKO_ALLOWED_HOSTS` requires restarting `meeko dev`.
