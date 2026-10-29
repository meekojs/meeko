---
title: handleProcessErrors
group: server
since: 1.3.0
description: Aplica a un host propio la política processErrors de server/runtime.ts para los rechazos sin manejar y las excepciones no capturadas fuera de una petición.
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
---

Una promesa que nadie espera, un `setTimeout` que lanza o el callback de una librería quedan fuera del `try` de la petición. Sin una política, Node, Bun y Deno terminan el proceso con el primer fallo así, sin pasar por `onError` ni cerrar el servidor de forma ordenada. `handleProcessErrors(app, options)` instala los listeners que aplican la política `processErrors` de `server/runtime.ts`:

| Fallo | Por defecto | Otras opciones |
| --- | --- | --- |
| `unhandledRejection` | `"report"`: llega a `onError` y el servidor sigue atendiendo. | `"shutdown"`: además, cierre ordenado con código 1. `"off"`: decide el runtime. |
| `uncaughtException` | `"shutdown"`: llega a `onError`, el servidor deja de aceptar conexiones, espera las respuestas y las tareas de `waitUntil`, cierra la aplicación y sale con código 1. | `"off"`: decide el runtime. |

`meeko dev`, las salidas de `meeko build` y `serveNode` y `serveDeno` con `handleSignals` ya la aplican. Llámela en un host propio, como `Bun.serve` con `createBunServer`.

## Uso

<!-- no-check -->
```ts
// server.ts de un host propio en Bun
import { createServerApp, handleProcessErrors } from "@meekojs/meeko/server";
import { createBunServer } from "@meekojs/meeko/bun";

const app = await createServerApp({ manifest, load, runtime, production: true });
const server = Bun.serve({ port: 3000, ...createBunServer(app) });
handleProcessErrors(app, { close: async () => { await server.stop(); await app.close(); } });
```

## Parámetros

`handleProcessErrors(app, options?)`:

| Parámetro | Tipo | Por defecto | Descripción |
| --- | --- | --- | --- |
| `app` | `ServerApp` | obligatorio | La aplicación de `createServerApp`; de ella sale la política `processErrors`. |
| `options.close` | `() => Promise<void>` | `app.close()` | El cierre ordenado del host: dejar de aceptar conexiones, esperar las respuestas y cerrar la aplicación. Después, Meeko sale con código 1. |
| `options.onError` | `(error, requestId, info?) => void` | el `onError` de `server/runtime.ts` | El observador. Sin ninguno, Meeko escribe el error completo en la consola. |
| `options.shutdownTimeout` | `number` | `15000` | Milisegundos que puede durar `close` antes de salir igualmente con código 1. |

La política se declara en `server/runtime.ts` (`processErrors: { unhandledRejection?, uncaughtException? }`, o `false` para desactivar los dos casos).

## Valor devuelto

La función que retira los listeners: `() => void`. Desde `1.7`, cada llamada con la misma `app` devuelve su propia función y los listeners se retiran cuando se han llamado todas; llamar dos veces a la misma función no cuenta dos veces.

El observador recibe el error, un `requestId` y, como tercer argumento, `{ kind, inRequest }` (`ServerErrorInfo`). Si el fallo ocurre en el trabajo asíncrono de una petición y el runtime conserva ese contexto, `requestId` es el de la respuesta (`x-request-id`) e `inRequest` es `true`.

## Ejemplos

### Cerrar también ante un rechazo

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

Con un orquestador que reinicia el proceso (Docker con `restart: unless-stopped`, systemd, Kubernetes), salir con código 1 es preferible a seguir con un estado no fiable.

### Un host Node propio con su servidor HTTP

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
// En las pruebas: release() retira los listeners.
```

### Dejar la decisión a la aplicación

<!-- no-check -->
```ts
process.on("unhandledRejection", (reason) => metrics.increment("unhandled_rejection"));
handleProcessErrors(app);
```

Si la aplicación ya registró sus propios `process.on("uncaughtException" | "unhandledRejection")`, Meeko informa a `onError` y deja que ella decida: no cierra el proceso.

## Errores comunes

### Un plazo no válido

```ts bad
handleProcessErrors(app, { shutdownTimeout: -1 });
```

`RangeError: Invalid shutdownTimeout: -1`. Use milisegundos entre `0` y `2147483647`.

<!-- no-check -->
```ts good
handleProcessErrors(app, { shutdownTimeout: 15_000 });
```

### Llamarla dos veces junto a `serveNode`

```ts bad
const node = await serveNode(app, { handleSignals: true });
handleProcessErrors(app, { close: node.close });
```

`serveNode` y `serveDeno` con `handleSignals` ya instalan la política. Desde `1.7` se instala una sola vez por aplicación: la segunda llamada no añade listeners ni otro cierre, así que su `close`, su `onError` y su `shutdownTimeout` se ignoran y valen los de `serveNode`; si son distintos, Meeko lo avisa en la consola. Hasta `1.6`, cada fallo se informaba dos veces y dos cierres competían. Use una de las dos.

<!-- no-check -->
```ts good
await serveNode(app, { handleSignals: true });
```

### Un `close` que no detiene el servidor

```ts bad
handleProcessErrors(app, { close: () => app.close() }); // Bun.serve sigue aceptando conexiones
```

No hay error, pero el cierre no es ordenado: el servidor acepta peticiones mientras la aplicación se cierra. Detenga primero el servidor.

<!-- no-check -->
```ts good
handleProcessErrors(app, { close: async () => { await server.stop(); await app.close(); } });
```

## Notas

- **Por runtime.** Node y Bun usan los eventos de `process`; Deno, `unhandledrejection` y `error` de `globalThis`. En Cloudflare Workers no hay proceso: los rechazos del aislado llegan a `onError` y una excepción sólo hace fallar la petición o la tarea de `waitUntil` que la lanzó.
- **Contexto de la petición.** Node conserva el `requestId` para rechazos y excepciones; Deno y workerd, para los rechazos; Bun, sólo para las excepciones.
- **Desarrollo.** En `meeko dev`, un rechazo de la aplicación no detiene el servidor de desarrollo.
- **Privacidad.** El observador recibe el error completo: no lo envíe tal cual a un servicio de terceros sin filtrar datos personales.
