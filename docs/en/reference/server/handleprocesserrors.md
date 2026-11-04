---
title: handleProcessErrors
group: server
since: 1.3.0
description: Applies server/runtime.ts processErrors policy to a custom host for unhandled rejections and uncaught exceptions outside a request.
symbols:
  - "@meekojs/meeko/server#handleProcessErrors"
types:
  - "@meekojs/meeko/server#ProcessErrorOptions"
  - "@meekojs/meeko/server#ProcessErrorPolicy"
related:
  - "@meekojs/meeko/server#defineServerRuntime"
  - "@meekojs/meeko/node#serveNode"
  - "@meekojs/meeko/deno#serveDeno"
  - "@meekojs/meeko/bun#createBunServer"
  - docs/framework.md#fallos-fuera-de-una-petición
  - docs/framework.md#errores
source-hash: ddc6a3c9a811952c506cd3347d5ebf4ac360c179fccc1aa964bd8985d56183c8
---

An unawaited promise, a throwing `setTimeout` or a library callback lies outside the request's `try`. Without a policy, Node, Bun and Deno terminate the process on the first such failure, without going through `onError` or shutting down gracefully. `handleProcessErrors(app, options)` installs listeners applying the `processErrors` policy from `server/runtime.ts`:

| Failure              | Default                                                                                                                                                           | Other options                                                                            |
| -------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------- |
| `unhandledRejection` | `"report"`: reaches `onError` and the server keeps serving.                                                                                                       | `"shutdown"`: also shuts down gracefully with exit code 1. `"off"`: the runtime decides. |
| `uncaughtException`  | `"shutdown"`: reaches `onError`, the server stops accepting connections, waits for responses and `waitUntil` tasks, closes the application and exits with code 1. | `"off"`: the runtime decides.                                                            |

`meeko dev`, `meeko build` outputs, and `serveNode` and `serveDeno` with `handleSignals` already apply it. Call it in a custom host, such as `Bun.serve` with `createBunServer`.

## Usage

<!-- no-check -->

```ts
// server.ts for a custom Bun host
import { createServerApp, handleProcessErrors } from "@meekojs/meeko/server";
import { createBunServer } from "@meekojs/meeko/bun";

const app = await createServerApp({ manifest, load, runtime, production: true });
const server = Bun.serve({ port: 3000, ...createBunServer(app) });
handleProcessErrors(app, { close: async () => { await server.stop(); await app.close(); } });
```

## Parameters

`handleProcessErrors(app, options?)`:

| Parameter                 | Type                                | Default                         | Description                                                                                                                     |
| ------------------------- | ----------------------------------- | ------------------------------- | ------------------------------------------------------------------------------------------------------------------------------- |
| `app`                     | `ServerApp`                         | required                        | The application from `createServerApp`; provides the `processErrors` policy.                                                    |
| `options.close`           | `() => Promise<void>`               | `app.close()`                   | Graceful host shutdown: stop accepting connections, wait for responses and close the application. Meeko then exits with code 1. |
| `options.onError`         | `(error, requestId, info?) => void` | `server/runtime.ts`'s `onError` | The observer. Without one, Meeko writes the full error to the console.                                                          |
| `options.shutdownTimeout` | `number`                            | `15000`                         | Milliseconds allowed for `close` before exiting with code 1 anyway.                                                             |

Declare the policy in `server/runtime.ts` (`processErrors: { unhandledRejection?, uncaughtException? }`, or `false` to disable both cases).

## Return value

The function that removes listeners: `() => void`. Since `1.7`, each call with the same `app` returns its own function and listeners are removed once all have been called; calling the same function twice does not count twice.

The observer receives the error, a `requestId` and, as the third argument, `{ kind, inRequest }` (`ServerErrorInfo`). If failure occurs in a request's asynchronous work and the runtime retains that context, `requestId` matches the response's (`x-request-id`) and `inRequest` is `true`.

## Examples

### Also shut down on rejection

```ts
// server/runtime.ts
import { defineServerRuntime } from "@meekojs/meeko/server";

export default defineServerRuntime(() => ({
  processErrors: { unhandledRejection: "shutdown" },
  onError(error, requestId, info) {
    if (info) console.error(JSON.stringify({ level: "fatal", kind: info.kind, inRequest: info.inRequest, requestId }), error);
    else console.error(JSON.stringify({ level: "error", requestId }), error);
  },
}));
```

With an orchestrator that restarts the process (Docker with `restart: unless-stopped`, systemd, Kubernetes), exiting with code 1 is preferable to continuing with unreliable state.

### A custom Node host with its HTTP server

<!-- no-check -->

```ts
import { createServer } from "node:http";
import { handleProcessErrors } from "@meekojs/meeko/server";
import { toNodeListener } from "@meekojs/meeko/node";

const server = createServer(toNodeListener((request) => app.fetch(request)));
server.listen(3000);
const release = handleProcessErrors(app, {
  close: () => new Promise<void>((done) => server.close(() => done())).then(() => app.close()),
  shutdownTimeout: 20_000,
});
// In tests: release() removes the listeners.
```

### Leave the decision to the application

<!-- no-check -->

```ts
process.on("unhandledRejection", (reason) => metrics.increment("unhandled_rejection"));
handleProcessErrors(app);
```

If the application has already registered its own `process.on("uncaughtException" | "unhandledRejection")`, Meeko reports to `onError` and lets it decide: it does not shut down the process.

## Common mistakes

### An invalid timeout

```ts bad
handleProcessErrors(app, { shutdownTimeout: -1 });
```

`RangeError: Invalid shutdownTimeout: -1`. Use milliseconds between `0` and `2147483647`.

<!-- no-check -->

```ts good
handleProcessErrors(app, { shutdownTimeout: 15_000 });
```

### Call it twice alongside `serveNode`

```ts bad
const node = await serveNode(app, { handleSignals: true });
handleProcessErrors(app, { close: node.close });
```

`serveNode` and `serveDeno` with `handleSignals` already install the policy. Since `1.7`, it is installed only once per application: a second call adds neither listeners nor another shutdown, so its `close`, `onError` and `shutdownTimeout` are ignored and `serveNode`'s values apply; if they differ, Meeko warns in the console. Through `1.6`, each failure was reported twice and two shutdowns competed. Use one of the two.

<!-- no-check -->

```ts good
await serveNode(app, { handleSignals: true });
```

### A `close` that does not stop the server

```ts bad
handleProcessErrors(app, { close: () => app.close() }); // Bun.serve keeps accepting connections
```

There is no error, but shutdown is not graceful: the server accepts requests while the application closes. Stop the server first.

<!-- no-check -->

```ts good
handleProcessErrors(app, { close: async () => { await server.stop(); await app.close(); } });
```

## Notes

- **Per runtime.** Node and Bun use `process` events; Deno uses `globalThis`'s `unhandledrejection` and `error`. Cloudflare Workers has no process: isolate rejections reach `onError` and an exception only fails the request or `waitUntil` task that threw it.
- **Request context.** Node retains `requestId` for rejections and exceptions; Deno and workerd for rejections; Bun only for exceptions.
- **Development.** In `meeko dev`, an application rejection does not stop the development server.
- **Privacy.** The observer receives the full error: do not send it unchanged to a third-party service without filtering personal data.
