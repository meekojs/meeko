---
title: dev
group: config
since: 1.3.0
description: Options for meeko dev, such as forwarding server code output to the browser console while handling a request.
symbols:
  - "config:dev"
related:
  - "cli:dev"
  - docs/framework.md#logs-del-servidor-en-la-consola-del-navegador
  - docs/framework.md#configuración
source-hash: 3e6a934159cffae6ecf76c15931eeac216dd821848dfb65c4bddf626878f1d99
---

`dev` groups the options for `meeko dev`; they do not affect `meeko build`, `meeko start` or any production output. It currently has one: `serverLogs`, which enables or disables server logs in the browser console.

With `serverLogs` enabled (the default), anything server code writes with `console.log`, `info`, `warn`, `error` or `debug` while handling a request also appears in the browser console, grouped by request, like Nuxt's `features.devLogs`. The terminal still displays it as usual.

## Usage

```ts
// meeko.config.ts
import { defineMeekoConfig } from "@meekojs/meeko/framework";

export default defineMeekoConfig({ dev: { serverLogs: false } });
```

## Options

| Option       | Type      | Default | Description                                                                |
| ------------ | --------- | ------- | -------------------------------------------------------------------------- |
| `serverLogs` | `boolean` | `true`  | Forwards each request's server logs to the browser console in `meeko dev`. |

## Result

With `serverLogs: true`:

- **What is forwarded.** Anything executed for a request: middleware, loaders, `<script server>`, `*.server.ts` plugins, rendering, SSR `api.*` and `rpc.*` clients, API and RPC handlers and their asynchronous work. Startup, `server/runtime.ts` and Socket callbacks only go to the terminal.
- **How it arrives.** In the HTML document, in the `"stream"` stream, in a client navigation payload or, for API and RPC, over Vite's HMR WebSocket.
- **How it appears.** One group per request with the `server` badge, method, path and `requestId`; objects expand as they do on the server.

With `serverLogs: false`, none of this happens: the terminal still displays the logs.

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
- **Development.** Changing `meeko.config.ts` requires restarting `meeko dev`.
