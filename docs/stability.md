# Política de estabilidad 1.x

A partir de `1.0.0`, `@meekojs/meeko` sigue [Semantic Versioning](https://semver.org/lang/es/). Esta página define qué cubre esa promesa, qué queda fuera, cómo se retira una API y en qué entornos se ejecuta Meeko. Los cambios de cada versión se registran en el [CHANGELOG](../CHANGELOG.md); la actualización desde `0.1.0` se explica en la [guía de migración a 1.0](migration-1.0.md), y la de `1.0` a `1.1`, en [Actualizar de 1.0 a 1.1](migration-1.1.md).

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
| `@meekojs/meeko` | Reactividad (`signal`, `computed`, `effect`, `batch`, `untrack`, `createRoot`, `onCleanup`), ciclo de vida (`onMounted`, desde `1.1`), contexto (`createContext`, `provide`, `inject`), `provideErrorHandler`, `serializeJson` y sus tipos, incluidos los de componentes y del protocolo DevTools. |
| `@meekojs/meeko/framework` | Configuración, rutas, páginas, `defer`, estado, navegación, middleware de rutas, clientes API, RPC y Socket (`createSocketClient`, `createSocketRegistry`, `useSocketChannel`, `useSocketClient` desde `1.1` y su alias obsoleto `useSocket`), las fábricas de los composables de datos (`createUseApi`, `createUseRpcQuery`, `createUseRpcMutation` y sus tipos, desde `1.1`) y la API del código de nivel superior de `<script server>` (`usePage`, `redirect`, `notFound` y los tipos `PageRequest`, `PageRequestOf`, `PageBodyHead`, `ServerData`, `JsonShape` y `SerializableExport`, desde `1.1`). |
| `@meekojs/meeko/vite` | Plugin `meeko()` de Vite. |
| `@meekojs/meeko/server` | Núcleo de servidor portable: `createServerApp`, `defineServerRuntime`, contratos API/RPC, sesiones y stores, middleware, Socket y sus brokers, `createSocketUpgradeHandler` y OpenAPI. |
| `@meekojs/meeko/node` | Adaptador Node: `serveNode`, `toNodeListener`, `createNodeAssetReader`, `attachNodeWebSocketServer` y `createNodeSocketUpgradeHandler`. |
| `@meekojs/meeko/bun` | Adaptador Bun: `createBunServer` y `createBunAssetReader`. |
| `@meekojs/meeko/deno` | Adaptador Deno: `serveDeno` y `createDenoAssetReader`. |
| `@meekojs/meeko/cloudflare` | Adaptador Cloudflare Workers: `createWorker`, `createSocketRoomClass`, `DurableObjectSocketPubSub`, `socketRoomName`, `D1SessionDriver`, `createCloudflareAssetReader`, `createCloudflarePrerenderSource` y sus tipos estructurales. |
| `@meekojs/meeko/build` | Herramientas de build para Node: descubrimiento, configuración, prerender y `buildProject`. |
| `@meekojs/meeko/devtools-ui` | Panel DevTools integrado (`mountDevtoolsPanel`). |
| `@meekojs/meeko/prettier` | Plugin de Prettier para `.meeko` (desde `1.1`): el parser `meeko` y la opción `meekoIndentSections`. El nombre del parser y de la opción son estables; la salida exacta del formato puede mejorar en un minor, como la de Prettier. |

`tests/package-boundaries.test.ts` fija la lista exacta de exports de la raíz.

Los tipos forman parte del contrato. Hay dos matices:

- Una unión que Meeko **entrega** a la aplicación puede ganar miembros en un minor: por ejemplo `ErrorSource`, `PageRender`, `DeferredStatus`, `DevtoolsReadKind`, `DevtoolsEventKind`, el estado de un `SocketClient` (que gana `"unauthorized"` en `1.1`) o los códigos de error. Un `switch` exhaustivo sobre ellas debe tener una rama por defecto. Una unión que la aplicación **pasa** a Meeko no se estrecha en 1.x.
- Una corrección de tipos que rechaza código que ya fallaba en ejecución puede publicarse en un minor o un patch, con su entrada en el CHANGELOG.

#### Excepciones aprobadas

Cambios que rechazan código válido en ejecución y que se publican en un minor por decisión explícita, cada uno con su migración:

| Versión | Cambio | Motivo y migración |
| --- | --- | --- |
| `1.1` | `meeko check` y el editor comprueban las props de cada etiqueta de componente (`<Etiqueta>` o `<component is>`) sólo contra las que declara el hijo: una prop desconocida es un error aunque la acompañen props válidas. | En `1.0`, una prop sobrante pasaba la comprobación y en ejecución se ignoraba, así que no fallaba: el cambio no es una corrección de un fallo en ejecución, sino una excepción aceptada para detectar errores de escritura y props obsoletas. Basta con borrar la prop o declararla en el hijo; el comportamiento en ejecución no cambia. Véase [Actualizar de 1.0 a 1.1](migration-1.1.md#props-de-componente-más-estrictas). |
| `1.1` | `html="..."` y `model="..."` en un elemento HTML estándar (`<div>`, `<input>`…) son directivas: el valor es una expresión, y los usos no admitidos dan `MEEK095` y `MEEK065`. En los elementos personalizados (etiqueta con guion, como `<x-markdown html="intro">`) siguen siendo atributos HTML literales, como en `1.0`. | En `1.0` se escribían como atributos literales, pero `html` y `model` no son atributos válidos de ningún elemento HTML estándar, así que el navegador los ignoraba. Si una hoja de estilos o un script leía ese atributo, escríbalo como `data-html`/`data-model` o con `bind:html="'texto'"`, que sigue siendo un atributo. |
| `1.1` | El handshake de Socket ya no responde `401` ni `403` a un rechazo de sesión o de autorización del canal: los adaptadores de Meeko hacen el upgrade y cierran en seguida con `4401` o `4403`. El Origin no permitido sigue respondiendo `403` por HTTP. En `createSocketUpgradeHandler`, la acción `reject` de `SocketUpgrade` gana el campo opcional `close` con el código y el motivo. | El `WebSocket` del navegador no expone el estado HTTP de un handshake rechazado, así que el cliente reintentaba sin fin. Un cliente propio que esperaba el `401`/`403` HTTP debe tratar los cierres `4401`/`4403` como rechazo definitivo; el cliente de Meeko ya lo hace. La unión no gana miembros, de modo que un adaptador propio escrito para `1.0` sigue funcionando y responde `status` por HTTP mientras no atienda `close`. Véase [Actualizar de 1.0 a 1.1](migration-1.1.md#socket-cierres-4401-y-4403-en-el-handshake). |

### Formato `.meeko` y módulo generado

- Las secciones `<script lang="ts">`, `<template>` y `<style>` (con `scoped` y `:global(...)`), y en las páginas `<script server lang="ts">` (desde `1.1`), con sus dos formas: las opciones de ruta y el código de nivel superior cuyos `export const` son los datos de la página, con la regla que decide cuándo un bloque tiene código de nivel superior. Desde `1.1`, el `<script lang="ts">` es opcional y admite el atributo `generic` con los parámetros de tipo del componente, que no se permite en páginas, layouts, `app.meeko` ni `error.meeko`.
- La macro `defineProps<Props>()`, con o sin defaults, y desde `1.1` las macros `defineEmits<T>()`, `defineExpose(value)`, `defineModel<T>(name?, options?)`, `defineSnippets<T>()` y `useElementRef("name")`.
- Las directivas `{expression}`, `on:event`, `bind:name`, `if:when`, `each:of`/`each:as`/`each:key`/`each:index` y `<component is>`. Desde `1.1`:
  - `each:key` es opcional y sin él la clave es el índice;
  - `on:event` en `<component>` y en las etiquetas de componente equivale a la prop `onEvent`;
  - las etiquetas de componente con nombre en mayúscula (`<AppButton />`), cuyo contenido son snippets;
  - las props estáticas en componentes (`variant="primary"` pasa un literal de texto y un atributo sin valor, `true`), con `is`, `ref`, `html`, los nombres con guiones y los que llevan `:` sin ser directivas reservados;
  - la directiva `ref:name`. `ref="x"` y `bind:ref` conservan su comportamiento de `1.0`;
  - `model` y `model:name` en las etiquetas de componente, `model` en `<input>`, `<textarea>` y `<select>`, y los elementos `<snippet name params>` y `<render snippet args />`;
  - la directiva `html="expression"`, que inserta HTML sin escapar, normalizado para que encaje en el elemento y sin ejecutar nunca sus `<script>` al insertarlo en el navegador;
  - `html` y `model` son directivas sólo en los elementos HTML estándar; en los elementos personalizados (etiqueta con guion) son atributos literales;
  - `<component is="..." />` se cierra solo, como `<Etiqueta />`.
- Las reglas del setup desde `1.1`: `useElementRef`, `useApi`, `useRpcQuery` y `useRpcMutation` sólo en el nivel superior; `await` de nivel superior sólo sobre `useApi`, `useRpcQuery`, `useElementRef`, `useSocket` y `useSocketClient`; la división del setup en el primer `await` de navegador, cuya continuación sólo se ejecuta en el navegador y admite sentencias de expresión y de control de flujo.
- La forma de cada módulo compilado: `ComponentProps`, `ComponentExposed`, `ComponentModels` y `ComponentSnippets` (desde `1.1`), `css`, `renderWithState`, `renderToString`, `hydrate` y `hydrateScope`, cuya función de liberación lleva `exposed`. En un componente con `generic`, los tipos y las funciones llevan sus parámetros de tipo. Las marcas `hasDataAwait`, `__meekoChildren`, `__meekoChannels` y `__meekoTag` son internas.
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
| `meeko clean [directorio]` (desde `1.1`) | `--all`, `--dry-run`. Son contrato las opciones y qué se borra en cada modo; el texto exacto de la salida no. |
| `meeko lsp` | `--stdio`, `--node-ipc`, `--socket=<puerto>` o `--pipe=<nombre>` |
| `meeko --help` (`-h`), `meeko --version` (`-v`) | |

También forman parte del contrato:

- el bin `meeko-language-server`, con los mismos transportes que `meeko lsp`;
- el código de salida `1` ante errores;
- los códigos de diagnóstico (`MEEK0xx`, `MEEK1xx` y `MEEK_*`; véase [Códigos de diagnóstico](#códigos-de-diagnóstico));
- la forma `{ code, message, filename, location }` de `meeko check --json`.

El texto de los mensajes puede mejorar en cualquier versión; desde `1.1` está en español. Un minor puede añadir diagnósticos para código que ya fallaba en ejecución o violaba un contrato documentado, y puede dejar de emitir uno cuando el código que señalaba pasa a ser válido. Un código retirado no se reutiliza con otro significado.

#### Códigos de diagnóstico

| Código | Tema |
| --- | --- |
| `MEEK001` | HTML del componente no válido. |
| `MEEK002` | Contenido de nivel superior que no es `<script>`, `<template>` ni `<style>`, incluida una etiqueta de componente fuera de las secciones. |
| `MEEK003`, `MEEK004` | Sección sin etiqueta de cierre o duplicada. |
| `MEEK005` | **Retirado en `1.1`.** Señalaba la falta de `<script lang="ts">`, que pasa a ser opcional. |
| `MEEK006` | `<script>` o `<script server>` sin `lang="ts"`. |
| `MEEK007` | Falta `<template>`. |
| `MEEK008` | HTML de la plantilla no válido, incluido un cierre de etiqueta de componente sin apertura. |
| `MEEK009`, `MEEK010` | Expresión de plantilla vacía o sin cerrar. |
| `MEEK011` | Nombre de evento no válido. |
| `MEEK012` | Atributo dinámico o directiva no admitidos. |
| `MEEK013` | Error de sintaxis del `<script>`. |
| `MEEK014`, `MEEK015` | Más de una variable por sentencia, o una declaración que no es un nombre simple (desestructuración). |
| `MEEK016`, `MEEK017` | `defineProps` repetido o fuera de su propia declaración, o sin argumento de tipo. |
| `MEEK018` | Sentencia de nivel superior no admitida en el `<script>` o en la continuación de navegador. |
| `MEEK019` | `:global(...)` no válido en `<style scoped>`. |
| `MEEK020` | Error de sintaxis de una expresión de la plantilla. |
| `MEEK021`, `MEEK022` | `if:when` y `each:of` en el mismo nodo; `each:as` o `each:index` no válidos o repetidos. |
| `MEEK023` | **Retirado en `1.1`.** Señalaba una lista sin `each:key`, que pasa a ser opcional. |
| `MEEK024` | Directiva de plantilla incompleta. |
| `MEEK030`, `MEEK031` | `<component>` sin `is`, o con contenido. |
| `MEEK032` | Atributo de componente que no es una prop: `is` en una etiqueta, `ref="x"`, `html` y los nombres con guiones o con `:` que no son directivas. Desde `1.1`, cualquier otro atributo con nombre de identificador es una [prop estática](api.md#props-estáticas) en lugar de este error. |
| `MEEK033`, `MEEK034` | Import de componente que no es una ruta `.meeko` relativa, o que no existe. |
| `MEEK040` a `MEEK042` | Valores por defecto de `defineProps`. |
| `MEEK043`, `MEEK044` | `<script server>` con valor, o fuera de una página. |
| `MEEK045` a `MEEK048` | `defineEmits`, y `on:x` junto a `bind:onX` (o la misma prop dos veces). |
| `MEEK049` | **Retirado en `1.1`.** Señalaba contenido en una etiqueta de componente, que pasa a ser sus snippets. |
| `MEEK050`, `MEEK051` | `defineExpose`. |
| `MEEK052`, `MEEK053` | La directiva `ref:` y los nombres repetidos. |
| `MEEK054` a `MEEK058` | Composables de nivel superior, `await` y la continuación de navegador; `MEEK056`, los argumentos de `useElementRef`. |
| `MEEK059` a `MEEK062` | `defineSnippets`, `<snippet>` y `<render>`. |
| `MEEK063` a `MEEK066` | `defineModel`, `model` en controles de formulario y `model`/`model:name` en componentes. |
| `MEEK070` a `MEEK076` | Código de nivel superior de `<script server>`. |
| `MEEK080` | `await useElementRef(...)` sobre un componente sin `defineExpose`. |
| `MEEK090` | La misma prop como texto estático y con `bind:` u `on:`. |
| `MEEK095` | La directiva `html`: hijos, elementos vacíos o de texto, `<template>`, `model` o valor vacío. |
| `MEEK100` | El atributo `generic`: lista no válida, modificadores, nombres reservados o repetidos, ubicación no admitida y tipos del script que usan sus parámetros. |
| `MEEK_PAGE_PROPS`, `MEEK_LAYOUT_PROPS`, `MEEK_ERROR_PROPS` | Contratos de props de páginas, layouts y páginas de error. |
| `MEEK_AUTOIMPORT`, `MEEK_CHECK`, `MEEK_PROJECT_CHECK` | Servidor de lenguaje: autoimport ambiguo o no disponible, fallo al comprobar el componente y fallo al comprobar los contratos del proyecto. |

Los códigos a partir de `MEEK043` son nuevos en `1.1`. Los errores de TypeScript conservan su código `TSxxxx`, que puede cambiar al actualizar TypeScript o la forma del código que comprueba: en `1.1`, una prop obligatoria que falta en una etiqueta de componente da `TS2345` en lugar de `TS2769`.

La versión de TypeScript que incluye el paquete puede actualizarse en un minor. Si eso cambia los diagnósticos de `meeko check`, el CHANGELOG lo indica.

### Convenciones de proyecto

- `meeko.config.ts` con `defineMeekoConfig`: `extends`, `modules`, `imports.serverDirs` y la unión discriminada `server` (`node`, `bun`, `deno` y `cloudflare`, con sus campos documentados).
- `app/`:
  - `app.meeko`, `error.meeko`, `pages/`, `layouts/default.meeko`, `middleware/`, `components/`, `composables/`, `utils/`, `stores/` y `styles/main.css`;
  - páginas `index.meeko`, `[id].meeko`, `[...slug].meeko` y grupos `(group)`, con `+layout.meeko`, `+error.meeko` y las opciones de ruta en `<script server>` o en sidecars `*.route.ts`.
- `server/`:
  - `api/` (`<nombre>.<método>.ts`), `rpc/`, `socket/`, `middleware/` y `utils/`;
  - `server/runtime.ts`, cuyo export por defecto es `defineServerRuntime(...)`.
- `shared/`, `public/`, layers y módulos.
- Los sufijos `.client.ts`, `.server.ts` y `.shared.ts`, y las exclusiones `*.test.ts`, `*.spec.ts` y `*.d.ts`.
- Los autoimports `api`, `rpc`, `socket`, `useSocket`, `useState`, `href` y `provideErrorHandler`, y desde `1.1` `onMounted`, `useApi`, `useRpcQuery` y `useRpcMutation`. En el código de nivel superior de `<script server>`, `usePage`, `redirect` y `notFound` se pueden usar sin import.
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

- **Payload de página.** Versión `v: 2`, con `render`, `head` (`title` y, desde `1.1`, `description`) y `deferred`:
  - el documento lo lleva en `<script id="meeko-payload" type="application/json">`, dentro de un HTML con `<div id="app">`;
  - la navegación lo pide con `accept: application/meeko+json`, y la respuesta es `application/meeko+json` o, en una ruta `"stream"`, `application/meeko+ndjson` (el payload en la primera línea y un valor `{ "deferred", "value" | "error" }` en cada línea siguiente);
  - con `app/error.meeko`, una URL sin ruta responde `404` con un payload `error: true`, sin `route` y con props `{ status, message }`;
  - desde `1.1`, el campo opcional `resources` lleva los datos de los `await useApi(...)` y `await useRpcQuery(...)` que leyó el render, como objeto por clave de petición. El formato de esas claves es interno y puede cambiar en cualquier versión: sólo el servidor y el navegador de la misma versión lo interpretan. Un payload sin `resources` sigue siendo válido.
- **Streaming.** Los bloques `<script type="application/json" data-meeko-deferred="N">`, hijos directos de `<body>` y posteriores a `#meeko-payload`.
- **Endpoints.** `/api/...` según los archivos de `server/api`, `POST /_meeko/rpc/<ruta>` con cuerpo JSON y `/_meeko/socket/<canal>?room=<sala>`, cuyos mensajes de texto son `{ event, payload }`. Los errores tienen la forma `{ code, status, requestId }`.
- **Cabeceras:**
  - `x-meeko-csrf` en las mutaciones;
  - `x-meeko-csrf-token` y `x-request-id` en las respuestas;
  - `cache-control: no-store` y `x-accel-buffering: no` en los streams.
- **Meta y cookie.** La meta `meeko-csrf-token` y la cookie de sesión, que por defecto es `__Host-meeko.sid` (o `meeko.sid` sin `Secure`) y se configura con `cookieName`.
- **Socket.**
  - Los códigos de cierre documentados: `1003`, `1008`, `1009`, `1011` y `1013`, y desde `1.1` `4401` (sesión rechazada) y `4403` (autorización del canal rechazada).
  - Las respuestas del handshake: `400`, `403` `INVALID_ORIGIN`, `404` y las de los límites por HTTP. Desde `1.1`, un rechazo de sesión (`401`) o de autorización del canal (`403`) completa el upgrade y cierra en seguida con `4401` o `4403`, con un motivo fijo y sin llamar a los handlers. Véase [framework.md](framework.md#websocket).
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
  - Desde `1.1`, `DevtoolsInstance` tiene el campo opcional `signalSites` (tipo `DevtoolsSignalSite`), con la declaración de cada señal. Es un campo añadido dentro del protocolo 1: un hook o una captura sin él siguen siendo válidos.
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
- **El puente del editor.** El protocolo de valores en vivo entre el navegador, `meeko dev` y el editor (eventos `meeko:live*` de HMR, los descriptores `.meeko/dev/editor-bridge-<puerto>.json`, uno por servidor de desarrollo, la ruta `/__meeko/editor-bridge` y sus mensajes, incluido el campo `alias`) es sólo de desarrollo y no forma parte del contrato público: puede cambiar en cualquier versión. La extensión de VS Code ignora un descriptor con otra versión del protocolo. Véase [devtools.md](devtools.md#puente-del-editor).
- **Las extensiones propias del servidor de lenguaje.** La petición LSP `meeko/executionZones` y los modificadores de token semántico propios de Meeko (`signal`, `computed`, `resource` y `reactive`; `modification` es el estándar de LSP) son internos de la extensión de VS Code, que se publica junto al servidor. No son contrato público: pueden cambiar o desaparecer en un minor. Otro cliente LSP puede usarlos, pero debe tolerar esos cambios. Véase [editors.md](editors.md#funciones-propias-de-meeko).
- **La presentación.** El texto de mensajes de error y diagnósticos, el HTML y los estilos de los paneles DevTools, los títulos de CodeLens, hovers y zonas del editor, la salida de consola y el formato de los logs.
- **El repositorio.** Los ejemplos, pruebas, benchmarks y scripts no se publican en npm.
- **El rendimiento.** Las cifras de rendimiento y tamaño, que pueden mejorar o variar entre versiones.

## Deprecación

1. Una API pública sólo se depreca en un minor y siempre con un reemplazo documentado, salvo que la funcionalidad desaparezca por completo; en ese caso se explica el motivo.
2. La deprecación se anuncia en el CHANGELOG, en la documentación y con `@deprecated` en el JSDoc, para que el editor la marque.
3. Donde es viable, el uso deprecado emite además un aviso:
   - un aviso de `meeko check` o del servidor de lenguaje para sintaxis y convenciones;
   - un aviso de consola en desarrollo, una vez por proceso, para APIs de runtime.
4. Lo deprecado sigue funcionando durante toda la serie 1.x y sólo se retira en la siguiente major, cuya guía de migración lo recoge.

### APIs deprecadas

| API | Desde | Reemplazo | Se retira en |
| --- | --- | --- | --- |
| `useSocket(url, contract, options)` de `@meekojs/meeko/framework` | `1.1` | `useSocketClient`, con la misma firma y los mismos tipos | `2.0` |

El alias `useSocket` es la misma función que `useSocketClient`, así que no emite aviso de consola: el editor lo marca por su `@deprecated`. No afecta al autoimport `useSocket("canal", opciones)` de los clientes generados, que no está deprecado. Véase [framework.md](framework.md#clientes-con-url-y-contrato-explícitos).

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

Las vulnerabilidades se informan de forma privada desde la pestaña **Security** de [meekojs/meeko](https://github.com/meekojs/meeko/security/advisories/new), nunca en un issue abierto. [SECURITY.md](../SECURITY.md) detalla las versiones con soporte, qué incluir en el informe y los plazos de respuesta.
