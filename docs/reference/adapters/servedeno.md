---
title: serveDeno
group: adapters
since: 1.0.0
description: Sirve una aplicación de Meeko con Deno.serve, con Socket sobre Deno.upgradeWebSocket, cierre ordenado ante señales y la política de fallos del proceso.
symbols:
  - "@meekojs/meeko/deno#serveDeno"
types:
  - "@meekojs/meeko/deno#ServeDenoOptions"
  - "@meekojs/meeko/deno#DenoServer"
related:
  - "@meekojs/meeko/deno#createDenoAssetReader"
  - "@meekojs/meeko/server#handleProcessErrors"
  - "@meekojs/meeko/server#createServerApp"
  - "@meekojs/meeko/node#serveNode"
  - "config:server"
  - docs/framework.md#deno
  - docs/framework.md#conformidad-entre-adaptadores
---

`serveDeno(app, options)` pone en marcha `Deno.serve` para una aplicación de `createServerApp`: atiende HTTP con `app.fetch`, hace el upgrade de los canales Socket con `Deno.upgradeWebSocket` y registra la IP de cada conexión (`remoteAddr`). Con `handleSignals`, cierra de forma ordenada ante `SIGINT` y `SIGTERM` (`SIGINT` y `SIGBREAK` en Windows) y, desde `1.3`, aplica `processErrors`.

Es lo que ejecuta la salida de `meeko build --adapter deno` (`.meeko/output/deno/main.js`).

## Uso

<!-- no-check -->
```ts
import { createServerApp } from "@meekojs/meeko/server";
import { createDenoAssetReader, serveDeno } from "@meekojs/meeko/deno";

const app = await createServerApp({
  manifest, load, runtime, production: true,
  assets: createDenoAssetReader({ root: new URL("./client/", import.meta.url), assets: manifest.assets ?? {} }),
});
const server = await serveDeno(app, { host: "0.0.0.0", port: 8000, handleSignals: true });
console.log(server.url);
```

## Parámetros

`serveDeno(app, options?)`:

| Opción | Tipo | Por defecto | Descripción |
| --- | --- | --- | --- |
| `host` | `string` | `"127.0.0.1"` | Interfaz; `"0.0.0.0"` acepta tráfico remoto. |
| `port` | `number` | `4173` | Puerto; `0` elige uno libre. |
| `publicOrigin` | `string` | el de la aplicación, o la URL en la que escucha | Origen de las URL y de la comprobación de `Origin`. |
| `platform` | `ServerPlatform` | Deno con `Deno.env.toObject()` | La plataforma de cada petición. |
| `onError` | `(error, requestId) => void` | el de la aplicación | Observador de los fallos del transporte. |
| `maxMessageBytes` | `number` | `socket.maxMessageBytes` de la aplicación, o `65536` | Mensaje de Socket entrante más grande; los mayores cierran el peer con `1009`. |
| `idleTimeout` | `number` | `60` | Segundos sin `pong` antes de que Deno cierre un peer; los pings se envían a la mitad. |
| `handleSignals` | `boolean` | `false` | Cierre ordenado ante las señales y, desde `1.3`, `processErrors`. |

## Valor devuelto

Una promesa con un `DenoServer`:

| Miembro | Descripción |
| --- | --- |
| `url` | La URL local, como `http://127.0.0.1:4173`. |
| `finished` | Se resuelve cuando el servidor HTTP se ha detenido. |
| `close()` | Cierra los peers de Socket con `1001`, detiene HTTP, espera las tareas de `waitUntil` y cierra la aplicación, por ese orden. Durante el cierre, las peticiones nuevas reciben `503`. |

## Ejemplos

### Construir y ejecutar con los permisos mínimos

```sh
npx meeko build --adapter deno
deno run --allow-net --allow-env --allow-read=.meeko/output/deno .meeko/output/deno/main.js
```

`main.js` incluye todas las dependencias del servidor. `--allow-env` es necesario porque el runtime recibe `Deno.env.toObject()`; `meeko preview --adapter deno` concede `-A`.

### Un contenedor

```dockerfile
FROM denoland/deno:2.9.8
WORKDIR /app
COPY .meeko/output/deno ./
ENV MEEKO_HOST=0.0.0.0 MEEKO_PORT=8000 MEEKO_PUBLIC_ORIGIN=https://tienda.example.com
EXPOSE 8000
CMD ["run", "--allow-net", "--allow-env", "--allow-read=.", "main.js"]
```

`server.host` y `server.port` de `meeko.config.ts` sólo se aplican a Node; aquí valen `MEEKO_HOST` y `MEEKO_PORT` (o `PORT`).

### Pruebas con un puerto libre

<!-- no-check -->
```ts
const server = await serveDeno(app, { port: 0 });
const response = await fetch(`${server.url}/api/health`);
await response.body?.cancel();
await server.close();
await server.finished;
```

## Errores comunes

### Ejecutar la salida sin permisos

```sh bad
deno run .meeko/output/deno/main.js
```

Deno pide acceso a la red, al entorno y a la lectura del build (o lo deniega si no hay una terminal), y sin esos permisos el arranque falla.

```sh good
deno run --allow-net --allow-env --allow-read=.meeko/output/deno .meeko/output/deno/main.js
```

### Llamarlo fuera de Deno

```ts bad
// node server.mjs
await serveDeno(app);
```

`Error: The Meeko Deno adapter requires the Deno runtime`.

```sh good
deno run --allow-net --allow-env --allow-read=. main.js
```

### Un puerto o un límite no válidos

```ts bad
await serveDeno(app, { port: 70000, maxMessageBytes: 0 });
```

`RangeError: Invalid port: 70000`; con un puerto válido, `RangeError: Invalid maxMessageBytes` (o `Invalid idleTimeout`).

<!-- no-check -->
```ts good
await serveDeno(app, { port: 8000, maxMessageBytes: 16 * 1024 });
```

## Notas

- **Socket en Deno.** `Deno.upgradeWebSocket` no tiene límite de frame: el adaptador mide cada mensaje y cierra con `1009` los mayores, pero Deno ya lo reensambló en memoria. Limite el tamaño de las peticiones en el proxy si necesita un tope anterior. Los binarios se cierran con `1003`; el búfer saliente se controla con `bufferedAmount`.
- **Rechazos de sesión.** Se hace el upgrade y se cierra con `4401` o `4403` una vuelta del bucle después de abrir, para que el cierre llegue al cliente aunque éste ya haya enviado un mensaje.
- **Fallos del proceso.** Deno usa `unhandledrejection` y `error` de `globalThis`; conserva el `requestId` en los rechazos.
- **IP.** `remoteAddr` de la conexión; tras un proxy, `MEEKO_TRUST_PROXY`. Una variable no válida detiene el arranque.
- **CSP y cabeceras (desde 1.7).** `server.contentSecurityPolicy` y `server.headers` se aplican igual que en Node.
