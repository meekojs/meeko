# Política de estabilidad 1.x

A partir de `1.0.0`, `@meekojs/meeko` sigue [Semantic Versioning](https://semver.org/lang/es/). Esta página define qué cubre esa promesa, qué queda fuera, cómo se retira una API y en qué entornos se ejecuta Meeko. Los cambios de cada versión se registran en el [CHANGELOG](../CHANGELOG.md); la actualización desde `0.1.0` se explica en la [guía de migración a 1.0](migration-1.0.md).

| Versión | Puede incluir |
| --- | --- |
| Patch (`1.0.x`) | Correcciones compatibles y documentación. |
| Minor (`1.x.0`) | API, opciones, diagnósticos y convenciones nuevas que no rompen código existente, y deprecaciones con su reemplazo. |
| Major (`2.0.0`) | Cambios incompatibles y retirada de lo deprecado. |

Las prereleases (`1.1.0-rc.1`) se publican en el dist-tag `next` de npm y no forman parte de la promesa hasta su versión final.

## Un solo paquete

Compilador, runtime, framework, adaptadores, CLI y servidor de lenguaje se publican juntos en `@meekojs/meeko`, con una única versión. Durante 1.x no se separarán en paquetes que haya que coordinar.

El código que genera el compilador (módulos `.meeko` compilados, entradas bajo `.meeko/` y builds de `meeko build`) importa `@meekojs/meeko/internal`, y ambos deben tener **exactamente la misma versión**. Por eso `meeko init` y `meeko init-framework` fijan la versión exacta en el `package.json` generado. Al actualizar Meeko, vuelva a compilar o construir: no mezcle código generado por una versión con el runtime de otra, aunque ambas sean `1.x`.

## API pública

Lo que se enumera a continuación sólo cambia de forma incompatible en una versión major.

### Entradas del paquete

Las subrutas declaradas en `exports` de `package.json` y **todos** los símbolos y tipos que exportan, estén o no descritos en esta guía, [api.md](api.md), [framework.md](framework.md), [devtools.md](devtools.md) y [editors.md](editors.md); su referencia exacta son las declaraciones `.d.ts` publicadas. Las funciones de bajo nivel para hosts propios (por ejemplo `matchRoute`, `createNavigator`, `createSocketHub`, `dispatchApiRoute`, `dispatchRpc` o `createRequestContext`) también forman parte del contrato:

| Entrada | Contenido |
| --- | --- |
| `@meekojs/meeko` | Reactividad (`signal`, `computed`, `effect`, `batch`, `untrack`, `createRoot`, `onCleanup`), contexto (`createContext`, `provide`, `inject`), `provideErrorHandler`, `serializeJson` y sus tipos, incluidos los de componentes y del protocolo DevTools. |
| `@meekojs/meeko/framework` | Configuración, rutas, páginas, `defer`, estado, navegación, middleware de rutas y clientes API, RPC y Socket. |
| `@meekojs/meeko/vite` | Plugin `meeko()` de Vite. |
| `@meekojs/meeko/server` | Núcleo de servidor portable: `createServerApp`, `defineServerRuntime`, contratos API/RPC, sesiones y stores, middleware, Socket y sus brokers, `createSocketUpgradeHandler` y OpenAPI. |
| `@meekojs/meeko/node` | Adaptador Node: `serveNode`, `toNodeListener`, `createNodeAssetReader`, `attachNodeWebSocketServer` y `createNodeSocketUpgradeHandler`. |
| `@meekojs/meeko/bun` | Adaptador Bun: `createBunServer` y `createBunAssetReader`. |
| `@meekojs/meeko/deno` | Adaptador Deno: `serveDeno` y `createDenoAssetReader`. |
| `@meekojs/meeko/cloudflare` | Adaptador Cloudflare Workers: `createWorker`, `createSocketRoomClass`, `DurableObjectSocketPubSub`, `socketRoomName`, `D1SessionDriver`, `createCloudflareAssetReader`, `createCloudflarePrerenderSource` y sus tipos estructurales. |
| `@meekojs/meeko/build` | Herramientas de build para Node: descubrimiento, configuración, prerender y `buildProject`. |
| `@meekojs/meeko/devtools-ui` | Panel DevTools integrado (`mountDevtoolsPanel`). |

`tests/package-boundaries.test.ts` fija la lista exacta de exports de la raíz.

Los tipos forman parte del contrato. Hay dos matices:

- Una unión que Meeko **entrega** a la aplicación puede ganar miembros en un minor: por ejemplo `ErrorSource`, `PageRender`, `DeferredStatus`, `DevtoolsReadKind`, `DevtoolsEventKind` o los códigos de error. Un `switch` exhaustivo sobre ellas debe tener una rama por defecto. Una unión que la aplicación **pasa** a Meeko no se estrecha en 1.x.
- Una corrección de tipos que rechaza código que ya fallaba en ejecución puede publicarse en un minor o un patch, con su entrada en el CHANGELOG.

### Formato `.meeko` y módulo generado

- Las secciones `<script lang="ts">`, `<template>` y `<style>` (con `scoped` y `:global(...)`).
- La macro `defineProps<Props>()`, con o sin defaults.
- Las directivas `{expression}`, `on:event`, `bind:name`, `if:when`, `each:of`/`each:as`/`each:key`/`each:index` y `<component is>`.
- La forma de cada módulo compilado: `ComponentProps`, `css`, `renderWithState`, `renderToString`, `hydrate` y `hydrateScope`.
- El tipo `Component<Props>`.

El código JavaScript generado no es público; véase [Fuera del contrato](#fuera-del-contrato).

### CLI

Los comandos y opciones que muestra `meeko --help`:

| Comando | Opciones |
| --- | --- |
| `meeko dev [directorio]` | |
| `meeko check [directorio \| componente.meeko]` | `--json` (sólo para un componente) |
| `meeko build [directorio]` | `--adapter <node\|bun\|deno\|cloudflare>` o `--adapter=<nombre>` |
| `meeko start [directorio]` | |
| `meeko preview [directorio]` | `--adapter <node\|bun\|deno\|cloudflare>` |
| `meeko check-app <directorio>`, `meeko routes <directorio>`, `meeko prerender <directorio>` | |
| `meeko compile <componente.meeko> <salida.ts>`, `meeko types <componente.meeko>` | |
| `meeko init <directorio>`, `meeko init-framework <directorio>` | |
| `meeko lsp` | `--stdio`, `--node-ipc`, `--socket=<puerto>` o `--pipe=<nombre>` |
| `meeko --help` (`-h`), `meeko --version` (`-v`) | |

También forman parte del contrato:

- el bin `meeko-language-server`, con los mismos transportes que `meeko lsp`;
- el código de salida `1` ante errores;
- los códigos de diagnóstico (`MEEK0xx`, `MEEK_PAGE_PROPS`…);
- la forma `{ code, message, filename, location }` de `meeko check --json`.

El texto de los mensajes puede mejorar en cualquier versión. Un minor puede añadir diagnósticos para código que ya fallaba en ejecución o violaba un contrato documentado.

La versión de TypeScript que incluye el paquete puede actualizarse en un minor. Si eso cambia los diagnósticos de `meeko check`, el CHANGELOG lo indica.

### Convenciones de proyecto

- `meeko.config.ts` con `defineMeekoConfig`: `extends`, `modules`, `imports.serverDirs` y la unión discriminada `server` (`node`, `bun`, `deno` y `cloudflare`, con sus campos documentados).
- `app/`:
  - `app.meeko`, `pages/`, `layouts/default.meeko`, `middleware/`, `components/`, `composables/`, `utils/`, `stores/` y `styles/main.css`;
  - páginas `index.meeko`, `[id].meeko`, `[...slug].meeko` y grupos `(group)`, con `+layout.meeko`, `+error.meeko` y sidecars `*.route.ts`.
- `server/`:
  - `api/` (`<nombre>.<método>.ts`), `rpc/`, `socket/`, `middleware/` y `utils/`;
  - `server/runtime.ts`, cuyo export por defecto es `defineServerRuntime(...)`.
- `shared/`, `public/`, layers y módulos.
- Los sufijos `.client.ts`, `.server.ts` y `.shared.ts`, y las exclusiones `*.test.ts`, `*.spec.ts` y `*.d.ts`.
- Los autoimports `api`, `rpc`, `socket`, `useSocket`, `useState`, `href` y `provideErrorHandler`.
- Las variables de entorno `HOST`, `PORT`, `PUBLIC_ORIGIN` y `MEEKO_HMR_PORT`.

### Salidas de build

| Adaptador | Carpeta | Se ejecuta con |
| --- | --- | --- |
| Node | `.meeko/output/node/` | `index.mjs`, mediante `meeko start` o `node` |
| Bun | `.meeko/output/bun/` | `index.js` |
| Deno | `.meeko/output/deno/` | `main.js` |
| Cloudflare Workers | `.meeko/output/cloudflare/` | `worker.js` y `wrangler.jsonc` |

En Cloudflare también son estables:

- el binding `MEEKO_SOCKET`;
- la migración `meeko-socket-v1`, que no se renombra;
- la reserva de `public/_meeko/`;
- los campos de `wrangler.jsonc` que pertenecen a Meeko.

El contenido de `chunks/`, los nombres de archivos con hash y el resto de `.meeko/` no son públicos.

### Formatos de red y persistidos

Estos formatos permiten clientes externos, proxies, CSP y despliegues graduales:

- **Payload de página.** Versión `v: 2`, con `render`, `head` y `deferred`:
  - el documento lo lleva en `<script id="meeko-payload" type="application/json">`, dentro de un HTML con `<div id="app">`;
  - la navegación lo pide con `accept: application/meeko+json`, y la respuesta es `application/meeko+json` o, en una ruta `"stream"`, `application/meeko+ndjson` (el payload en la primera línea y un valor `{ "deferred", "value" | "error" }` en cada línea siguiente).
- **Streaming.** Los bloques `<script type="application/json" data-meeko-deferred="N">`, hijos directos de `<body>` y posteriores a `#meeko-payload`.
- **Endpoints.** `/api/...` según los archivos de `server/api`, `POST /_meeko/rpc/<ruta>` con cuerpo JSON y `/_meeko/socket/<canal>?room=<sala>`, cuyos mensajes de texto son `{ event, payload }`. Los errores tienen la forma `{ code, status, requestId }`.
- **Cabeceras:**
  - `x-meeko-csrf` en las mutaciones;
  - `x-meeko-csrf-token` y `x-request-id` en las respuestas;
  - `cache-control: no-store` y `x-accel-buffering: no` en los streams.
- **Meta y cookie.** La meta `meeko-csrf-token` y la cookie de sesión, que por defecto es `__Host-meeko.sid` (o `meeko.sid` sin `Secure`) y se configura con `cookieName`.
- **Socket.** Los códigos de cierre documentados: `1003`, `1008`, `1009`, `1011` y `1013`.
- **Redis:**
  - el canal `<prefix>socket:<canal>:<sala>` con el sobre `{ v: 1, event, payload }`;
  - el canal de revocaciones `<prefix>revoked`;
  - los registros de sesión que escriben `RedisSessionStore` y `SqlSessionStore`;
  - el esquema de referencia de `D1SessionDriver.schema()`.
- **Prerender.** El índice `prerender/manifest.json` (`{ version: 1, pages }`).

Un minor sólo puede añadir campos opcionales a estos formatos. Debe aceptar lo que escribió cualquier `1.x` anterior y no cambia la versión de un formato. Durante un despliegue gradual pueden convivir instancias de dos minors con el mismo Redis o la misma base. El navegador y el servidor de una misma aplicación deben salir del mismo build; un payload con otra versión se rechaza con un mensaje explícito.

### DevTools y editor

- **Protocolo DevTools 1.**
  - El hook `window.__MEEKO_DEVTOOLS__` (sólo en desarrollo), con `protocolVersion: 1`.
  - Sus métodos `snapshot`, `subscribe`, `select`, `highlight`, `setBreakpoint` y `setSignal`.
  - Los tipos `Devtools*` de la raíz.
  - Un minor puede añadir campos o tipos de evento. Pasar a otra versión del protocolo requiere una major. La extensión de Chrome mantiene su propio número de versión.
- **Servidor de lenguaje.**
  - El arranque con `meeko lsp --stdio` o `meeko-language-server`.
  - Las `initializationOptions` `trusted`, `projectContracts` y `diagnosticsDelay`.
  - Las capacidades LSP estándar que anuncia. Un minor puede añadir capacidades y acciones rápidas.

## Fuera del contrato

- **`@meekojs/meeko/internal`.** Es el contrato entre el compilador y su runtime. Sólo está garantizado dentro de la **misma versión exacta** y puede cambiar en cualquier patch. No lo importe a mano.
- **El código y los archivos generados.**
  - Lo que hay bajo `.meeko/`: tipos, manifiestos, entradas, `tsconfig` por ámbito, builds intermedios y `chunks/`.
  - Los módulos virtuales de Vite (`virtual:meeko-*`).
  - El JavaScript que emite el compilador.
  - Una entrada propia que importe esos módulos debe fijar la versión exacta de Meeko.
- **La presentación.** El texto de mensajes de error y diagnósticos, el HTML y los estilos de los paneles DevTools, la salida de consola y el formato de los logs.
- **El repositorio.** Los ejemplos, pruebas, benchmarks y scripts no se publican en npm.
- **El rendimiento.** Las cifras de rendimiento y tamaño, que pueden mejorar o variar entre versiones.

## Deprecación

1. Una API pública sólo se depreca en un minor y siempre con un reemplazo documentado, salvo que la funcionalidad desaparezca por completo; en ese caso se explica el motivo.
2. La deprecación se anuncia en el CHANGELOG, en la documentación y con `@deprecated` en el JSDoc, para que el editor la marque.
3. Donde es viable, el uso deprecado emite además un aviso:
   - un aviso de `meeko check` o del servidor de lenguaje para sintaxis y convenciones;
   - un aviso de consola en desarrollo, una vez por proceso, para APIs de runtime.
4. Lo deprecado sigue funcionando durante toda la serie 1.x y sólo se retira en la siguiente major, cuya guía de migración lo recoge.

Una vulnerabilidad que no se pueda corregir de forma compatible es la única excepción. En ese caso, el cambio mínimo necesario puede publicarse en un patch o un minor, con su explicación y migración en el CHANGELOG.

## Entornos soportados

| Entorno | Versión |
| --- | --- |
| Node.js | `>=24` (`engines` de `package.json`). Ejecuta la CLI, el build, el prerender, Vite, el servidor de lenguaje y el adaptador Node. CI usa Node 24 en Windows y Ubuntu. |
| Bun | Bun 1.x, con la salida `meeko build --adapter bun`. La suite de conformidad se ejecuta en CI con Bun 1.4.4. |
| Deno | Deno 2.x, con la salida `meeko build --adapter deno`. La suite de conformidad se ejecuta en CI con Deno 2.9.8. |
| Cloudflare Workers | `wrangler.jsonc` usa por defecto la fecha de compatibilidad `2026-10-19`, configurable con `server.compatibilityDate`, y el flag `nodejs_als` (también vale `nodejs_compat`). La suite de conformidad se ejecuta con workerd 1.20261019.1 (Wrangler 4.152.0). Socket requiere Durable Objects, y las sesiones D1 o Redis por la API REST de Upstash. |
| TypeScript | El paquete incluye TypeScript 7.0.2 para `meeko check` y los tipos. Las aplicaciones comprueban sus declaraciones con TypeScript 7. |
| Vite | Peer opcional `^8.3.5`. |

Las versiones de Bun, Deno y workerd de la tabla son las que se prueban. Pueden actualizarse en un minor y el CHANGELOG lo indica. Dejar de admitir Node 24 requiere una major.

### Navegadores

El runtime se publica compilado a ES2022, sin polyfills. Usa, entre otros, `Object.hasOwn`, `Array.prototype.at`, `MutationObserver`, `fetch` con cuerpos `ReadableStream` (navegación a rutas `"stream"`) y `WebSocket` (Socket). El bundle cliente de una aplicación usa el objetivo por defecto de Vite 8, `baseline-widely-available`. Se admiten los navegadores que cumplen ese objetivo.

Las pruebas E2E se ejecutan con Chrome y con Chromium, Firefox y WebKit de Playwright. WebKit de Playwright no equivale a una prueba en Safari real.

## Seguridad

El repositorio todavía no tiene un `SECURITY.md` con un canal privado para informar vulnerabilidades. Mientras no exista, no publique los detalles de una vulnerabilidad en un issue abierto: abra un issue en [meekojs/meeko](https://github.com/meekojs/meeko/issues) pidiendo un canal privado, sin incluir esos detalles.
