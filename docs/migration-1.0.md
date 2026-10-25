# Migrar de 0.1.0 a 1.0

Esta guía reúne los cambios incompatibles entre `0.1.0` y `1.0`. Su lista completa, con lo añadido y corregido, está en el [CHANGELOG](../CHANGELOG.md). A partir de 1.0 rige la [política de estabilidad](stability.md).

## Orden recomendado

1. Actualice `@meekojs/meeko` a la versión exacta de destino. Si usa Meeko DevTools o la extensión de VS Code, actualícelas también a la `1.0.0`.
2. Si existe `server/session.ts`, sustitúyalo por `server/runtime.ts` (véase [Servidor y runtime](#servidor-y-runtime)). Mientras ese archivo exista, `meeko check`, `meeko dev` y `meeko build` se detienen.
3. Corrija los imports de subrutas y ejecute `meeko check` para regenerar `.meeko/` y ver los errores de tipos.
4. Ejecute `meeko build` y actualice los scripts de despliegue a la nueva carpeta de salida.
5. Revise los apartados de sesiones, Socket y render que afecten a su aplicación.

## Paquete y subrutas

### La raíz sólo exporta la API pública

`@meekojs/meeko` exporta exactamente:

- `signal`, `computed`, `effect`, `batch`, `untrack`, `createRoot` y `onCleanup`;
- `createContext`, `provide` e `inject`;
- `provideErrorHandler` y `serializeJson`;
- sus tipos.

Los helpers de DOM, SSR, HMR y DevTools quedan sólo en `@meekojs/meeko/internal`:

- `bind*`, `render*`, `keyToken`, `withStateSnapshot`, `escapeHtml`, `attributeValue` y `renderAttribute`;
- `enableHotModule`, `registerHot*`, `replaceHot*`, `restoreSignals` y `snapshotSignals`;
- `registerDevtoolsInstance`.

```ts
// Antes
import { escapeHtml, signal } from "@meekojs/meeko";

// Después
import { signal } from "@meekojs/meeko";
// escapeHtml ya no es público: use una función propia o, aceptando que sólo funciona
// con la misma versión exacta del paquete, impórtela desde "@meekojs/meeko/internal".
```

Los módulos generados por el compilador ya importan `@meekojs/meeko/internal` desde `0.0.2`. Vuelva a compilar con la versión nueva cualquier módulo `.meeko` compilado y versionado a mano (`meeko compile`).

### `ComponentErrorHandler` recibe el origen del error

El observador de `provideErrorHandler` recibe un segundo argumento `source: ErrorSource` (`"event"`, `"effect"`, `"cleanup"`, `"navigation"` o `"socket"`). Los handlers de un parámetro siguen siendo válidos. Sólo cambia el código que **llama** a un `ComponentErrorHandler` por su cuenta, por ejemplo en una prueba:

```ts
// Antes
handler(new Error("boom"));

// Después
handler(new Error("boom"), "event");
```

### `@meekojs/meeko/server` es portable: build y Node se separan

`@meekojs/meeko/server` sólo usa Web APIs y `node:async_hooks`. Las herramientas de build y el transporte Node pasan a subrutas propias:

| Símbolos | Antes | Después |
| --- | --- | --- |
| `discoverRoutes`, `discoverConfiguredRoutes`, `composeFrameworkRoutes`, `loadMeekoConfig`, `readMeekoConfigSync`, `resolveConfigSources`, `discoverServerManifest`, `prerenderRoutes`, `prerenderProject` | `@meekojs/meeko/server` | `@meekojs/meeko/build` |
| `toNodeListener`, `attachNodeWebSocketServer`, `createNodeSocketUpgradeHandler` | `@meekojs/meeko/server` | `@meekojs/meeko/node` |

```ts
// Antes
import { createServerDispatcher, discoverServerManifest, prerenderProject, toNodeListener } from "@meekojs/meeko/server";

// Después
import { createServerDispatcher } from "@meekojs/meeko/server";
import { discoverServerManifest, prerenderProject } from "@meekojs/meeko/build";
import { toNodeListener } from "@meekojs/meeko/node";
```

`buildProject` también está en `@meekojs/meeko/build`, y `serveNode` y `createNodeAssetReader` son nuevos en `@meekojs/meeko/node`.

### Cargador de módulos explícito

`createServerDispatcher`, `createLocalCalls`, `generateOpenApi` y `loadSocketChannels` ya no importan rutas del disco: exigen un cargador `load`.

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

## Servidor y runtime

### `server/session.ts` pasa a `server/runtime.ts`

Meeko ya no carga `server/session.ts`. Mueva el `SessionManager` al export por defecto de `server/runtime.ts` y elimine el archivo anterior:

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

La fábrica recibe `{ env, production, platform, prerendering }` y puede devolver además `services`, `socket`, `publicOrigin`, `onError` y `close`; véase [Runtime de servidor](framework.md#runtime-de-servidor). `meeko build` la llama con `prerendering: true` para renderizar las páginas prerenderizadas. En esa fase no hay tráfico de clientes, así que basta un store en memoria.

### Nueva salida de build

`meeko build` escribe un build autónomo por adaptador. Node es el adaptador por defecto:

| Antes | Después |
| --- | --- |
| `.meeko/output/server/entry.js` | `.meeko/output/node/index.mjs`, con `chunks/` y `client/` |
| `.meeko/output/prerender/` | `.meeko/output/node/prerender/`, con un índice `{ version: 1, pages }` en `manifest.json` |

```sh
# Antes: el despliegue dependía de la salida anterior y de las fuentes
meeko start

# Después: la carpeta no lee app/, server/ ni meeko.config.ts
meeko build
node .meeko/output/node/index.mjs   # o meeko start
```

El servidor escucha en `HOST`/`PORT` (o en `server.host`/`server.port` de `meeko.config.ts`), con `127.0.0.1:4173` por defecto. El build Node necesita las dependencias de `node_modules`. Para Bun, Deno o Cloudflare Workers use `meeko build --adapter <bun|deno|cloudflare>`; véase [Build, despliegue y verificación](framework.md#build-despliegue-y-verificación).

`prerenderRoutes` exige que cada documento contenga `<head>` y escribe también el payload de navegación.

### Archivos públicos sólo desde el manifiesto

Sólo se sirven los archivos públicos que lista el manifiesto del build. Un archivo no listado, incluido uno añadido a `public/` después del build, se trata como cualquier ruta de la aplicación (normalmente `404`, antes `403`). Vuelva a construir tras añadir archivos públicos.

### Entradas y módulos virtuales

- **Rutas del cliente.** El HTML ya no incluye `<script id="meeko-routes">`: la entrada cliente importa las rutas desde `virtual:meeko-manifest/client`.
- **Servidor.** `virtual:meeko-server-pages` y `virtual:meeko-server-routes` se sustituyen por `virtual:meeko-server-app`.
- **Páginas de cliente.** La entrada cliente generada importa `virtual:meeko-client-routes`, que declara `.meeko/types/virtual-pages.d.ts`. Si su proyecto tiene una entrada propia, regenere los tipos con `meeko check`.

Estos módulos no son API pública. Una entrada propia que los importe debe fijar la versión exacta de Meeko (véase [Fuera del contrato](stability.md#fuera-del-contrato)).

## Páginas y render

### Sin `renderLayout`

`FrameworkHandlerOptions.renderLayout` desaparece. Los layouts se componen siempre con el outlet:

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

### `render` debe ser un literal

`meeko build` lee `render` del sidecar sin ejecutarlo. Debe ser un literal de texto en `definePage({ ... })`, en un objeto exportado o en una constante local del mismo archivo. Un valor calculado, una clave computada, un spread sin `render` explícito posterior o una reexportación detienen el build.

```ts
// Antes
const mode = process.env.STATIC ? "prerender" : "ssr";
export const route = definePage({ render: mode });

// Después
export const route = definePage({ render: "prerender" });
```

### Nuevos modos y tipos de página

- **`PageRender`.** Incluye ahora `"stream"` y `"client"`, así que un `switch` exhaustivo debe cubrirlos o tener una rama por defecto.
- **`PageDefinition.render`.** Acepta `"ssr"`, `"stream"` y `"prerender"`.
- **Páginas de cliente.** Usan `ClientPageDefinition`: su `load` recibe `ClientPageLoadContext` (`url`, `params`, `search`, `signal`, `state`), sin `request` ni `context`.

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

### El servidor comprueba el `render` del build

El servidor compara el `render` del sidecar con el del manifiesto aunque el sidecar lo omita. Un manifiesto con `render: "prerender"` y un sidecar sin `render`, o con otro valor, responde con error hasta reconstruir. Ejecute `meeko build` (o reinicie `meeko dev`) cada vez que cambie el modo de una ruta.

### El estado se sella tras el render

El `StateStore` de cada petición se sella después del render síncrono y de `head`, en todos los modos de render. Desde ese momento, un `useState` con clave nueva, un `seed` o una escritura lanzan `STATE_SEALED`. Una promesa suelta que escribe estado rechaza; si nadie la captura, Node termina el proceso con su configuración por defecto.

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

### `signal` del loader y prerender con `defer`

- **`PageRequestContext.signal`.** Ya no es `request.signal`. También se aborta por revocación de la sesión, stream cancelado, `HEAD` o error de la petición. Si su código distinguía la desconexión del cliente leyendo esa señal, compruebe `signal.reason`.
- **`defer` con `render: "prerender"`.** Un valor rechazado hace fallar la petición con `500`, y `meeko build` se detiene con la ruta afectada, en lugar de guardar el error en el HTML.
- **`prerenderRoutes`.** Toma el payload de navegación del propio documento (`#meeko-payload`).

## Sesiones y Socket

### `RequestContext.signal` incluye la revocación

`RequestContext.signal` combina la señal de la petición con la revocación de la sesión. Puede abortarse con `SessionRevokedError` (`SESSION_REVOKED`, `401`) aunque el cliente siga conectado. Pásela a `fetch` y a las consultas, y llame `await context.session.verify()` antes de un efecto irreversible.

```ts
handler: async ({ context }) => {
  await context.session.verify();
  return payments.charge(order, { signal: context.signal });
},
```

### Cambios de sesión en un stream

En una respuesta `"stream"` cuyas cabeceras ya se enviaron, `SessionHandle.create`, `rotate` y `revoke` rechazan con `SESSION_LOCKED` (`500`) sin tocar el almacén. Haga los cambios de sesión en el loader crítico, no en el trabajo diferido.

### Contrato de broadcast

`hub.broadcast()` se resuelve cuando el broker acepta el mensaje y ya no rechaza por fallos de entrega. Sólo rechaza en estos casos:

- el evento no existe;
- el payload no cumple su schema;
- el mensaje, serializado con `serializeJson`, supera `maxMessageBytes` (`SOCKET_LIMIT_EXCEEDED`, `413`);
- el broker no acepta la publicación.

Cuando un peer falla, Meeko lo cierra con `1008`, `1009`, `1011` o `1013` y envía el error a `onDeliveryError`. Un `authorizeSend` que devuelve `false` omite a ese peer sin cerrarlo. `LocalSocketPubSub.publish` envía los errores de sus listeners a `onListenerError` en lugar de agregarlos.

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

Sin `socket.onDeliveryError`, los fallos de entrega llegan al `onError` del runtime.

### `SocketPubSub.subscribe` puede ser asíncrono

`subscribe` puede devolver `Unsubscribe | Promise<Unsubscribe>`, y `Unsubscribe` puede devolver una promesa. Un broker propio puede adoptar esa firma, y quien llame a `subscribe` directamente debe esperar el resultado:

```ts
// Antes
const unsubscribe = pubsub.subscribe("chat", "general", listener);
unsubscribe();

// Después
const unsubscribe = await pubsub.subscribe("chat", "general", listener);
await unsubscribe();
```

## Protocolo

El payload de hidratación y navegación pasa a `v: 2`, con estos cambios:

- añade `render`, `head` y la lista `deferred`, con `null` en cada `path` diferido;
- las rutas `"stream"` responden a la navegación con `application/meeko+ndjson`;
- el cliente rechaza con un mensaje explícito un payload sin versión o con otra (incluida `v: 1`).

Servidor y navegador deben salir del mismo build. Regenere los `index.meeko.json` prerenderizados con `meeko build` y, si una CDN los guarda, invalide su caché al desplegar.

## DevTools

El protocolo DevTools pasa a la versión 1:

- **`DevtoolsHook` y `DevtoolsSnapshot`.** Ambos exigen `protocolVersion`, y el hook también `setSignal`. Un hook o una captura construidos a mano, por ejemplo en pruebas, deben añadirlos:

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

- **`DevtoolsReadSite.kind`.** Admite además `computed`, `if`, `each` y `prop`. Un `switch` exhaustivo sobre `text`/`attribute` debe cubrirlos.
- **Paneles.** El panel integrado y la extensión de Chrome 1.0.0 rechazan los runtimes sin `protocolVersion`. Use la extensión 1.0.0 con Meeko 1.0, y la anterior con runtimes anteriores.

## Editor

- **VS Code.** La extensión `meeko-language` 1.0.0 es un cliente del servidor de lenguaje. Usa el de `@meekojs/meeko` del proyecto cuando está instalado (`meeko.languageServer.preferWorkspace`) y el incluido como alternativa o en modo restringido. Instale la extensión 1.0.0 y añada `@meekojs/meeko` como dependencia del proyecto para que el editor y la CLI usen la misma versión.
- **Otros editores.** Pueden usar el mismo servidor con `meeko lsp --stdio` o `meeko-language-server --stdio`; [editors.md](editors.md) explica la configuración de Neovim, Helix, Zed, JetBrains y Sublime Text.
- **Resolución de módulos.** `meeko check` aplica ahora las opciones de resolución del `tsconfig.json` de la raíz del paquete (`paths`, `baseUrl`, `types`, `typeRoots`, `customConditions`, `resolveJsonModule`, `allowImportingTsExtensions`), igual que el editor. Un alias que antes fallaba con `TS2307` en la CLI ahora se resuelve, y pueden aparecer diagnósticos de tipos que ese error ocultaba.
