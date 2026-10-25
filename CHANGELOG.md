# Cambios de Meeko

## [1.0.0-rc.1] - 2026-10-25

Primera versión estable candidata. Desde 1.0, Meeko sigue SemVer según [docs/stability.md](docs/stability.md); la guía [docs/migration-1.0.md](docs/migration-1.0.md) recoge la migración desde `0.1.0`.

### Cambios incompatibles y migración

- La raíz `@meekojs/meeko` sólo exporta la API pública documentada: `signal`, `computed`, `effect`, `batch`, `untrack`, `createRoot`, `onCleanup`, `createContext`, `provide`, `inject`, `provideErrorHandler`, `serializeJson` y sus tipos. Los helpers de DOM, SSR, HMR y DevTools (`bind*`, `render*`, `keyToken`, `withStateSnapshot`, `escapeHtml`, `attributeValue`, `renderAttribute`, `enableHotModule`, `registerHot*`, `replaceHot*`, `restoreSignals`, `snapshotSignals`, `registerDevtoolsInstance`) quedan sólo en `@meekojs/meeko/internal`, que es lo que importa el código generado desde `0.0.2`. Vuelva a compilar los módulos generados con `0.0.1`.
- `ComponentErrorHandler` recibe un segundo argumento `source: ErrorSource`. Los handlers de un solo parámetro siguen siendo válidos.
- El payload de hidratación y navegación lleva `v: 2`, `render` y `head`. La versión 2 añade la lista `deferred`, `null` en cada `path` diferido y la respuesta `application/meeko+ndjson` de las rutas `"stream"`. El cliente rechaza un payload sin versión o con otra versión (incluida `v: 1`) con un mensaje explícito; servidor y navegador deben salir del mismo build, y los `index.meeko.json` prerenderizados deben regenerarse con `meeko build`.
- Se elimina `FrameworkHandlerOptions.renderLayout`. Los layouts se componen siempre mediante el outlet `<component is="props.outlet">`.
- El protocolo DevTools pasa a la versión 1:
  - `DevtoolsHook` exige `protocolVersion` y `setSignal`, y `DevtoolsSnapshot` exige `protocolVersion`. Un hook o una captura construidos a mano, por ejemplo en pruebas, deben añadir esos miembros.
  - `DevtoolsReadSite.kind` admite además `computed`, `if`, `each` y `prop`. Un `switch` exhaustivo sobre `text`/`attribute` debe cubrir los nuevos valores.
  - El panel integrado y la extensión de Chrome 1.0.0 rechazan, con un mensaje explícito, los runtimes sin `protocolVersion`. Use la extensión 1.0.0 con esta versión de `@meekojs/meeko`, y la extensión anterior con runtimes anteriores.
- `server/session.ts` deja de cargarse y se sustituye por `server/runtime.ts`, que exporta por defecto `defineServerRuntime(({ env, production, platform, prerendering }) => ({ sessions, services, socket, publicOrigin, onError, close }))`. Mueva el `SessionManager` de `createSessionManager(production)` a `sessions` y elimine el archivo anterior; `meeko check`, `meeko dev` y `meeko build` se detienen con estas instrucciones mientras exista. `meeko build` llama a la fábrica con `prerendering: true` para renderizar las páginas prerenderizadas.
- `@meekojs/meeko/server` es ahora el núcleo portable (Web APIs y `node:async_hooks`) y ya no carga TypeScript ni el sistema de archivos. Las herramientas de build pasan a la nueva subruta `@meekojs/meeko/build` (`discoverRoutes`, `discoverConfiguredRoutes`, `composeFrameworkRoutes`, `loadMeekoConfig`, `readMeekoConfigSync`, `resolveConfigSources`, `discoverServerManifest`, `prerenderRoutes`, `prerenderProject`, `buildProject`) y `toNodeListener`, `attachNodeWebSocketServer` y `createNodeSocketUpgradeHandler` a la nueva subruta `@meekojs/meeko/node`. Actualice esos imports.
- `createServerDispatcher`, `createLocalCalls`, `generateOpenApi` y `loadSocketChannels` exigen un cargador de módulos explícito (`load`); ya no importan rutas del disco por defecto. En Node puede pasar `(file) => import(pathToFileURL(file).href)`.
- `meeko build` escribe un build Node autónomo en `.meeko/output/node/` (`index.mjs`, `chunks/`, `client/`, `prerender/`) en lugar de `.meeko/output/server/entry.js`, y el prerender pasa de `.meeko/output/prerender/` a `.meeko/output/node/prerender/`, con un índice `{ version: 1, pages }` en `manifest.json`. `prerenderRoutes` requiere que cada documento contenga `<head>` y escribe también el payload de navegación.
- El valor de `render` de un sidecar se lee sin ejecutarlo: debe ser un literal de texto en `definePage({ ... })`, en un objeto exportado o en una constante local del mismo archivo. Un valor calculado, una clave computada no seguida de un `render` literal, un spread sin `render` explícito posterior o una reexportación detienen el build.
- Sólo se sirven los archivos públicos listados en el manifiesto del build; un archivo no listado, incluido un enlace añadido a `public/` después del build, responde como cualquier ruta de la aplicación (normalmente `404`) en lugar de `403`.
- El HTML ya no incluye `<script id="meeko-routes">`: la entrada cliente importa las rutas desde el módulo virtual `virtual:meeko-manifest/client`. Los módulos virtuales `virtual:meeko-server-pages` y `virtual:meeko-server-routes` se sustituyen por `virtual:meeko-server-app`.
- `PageDefinition.render` sólo acepta los modos de servidor (`"ssr"`, `"stream"` y `"prerender"`); las páginas `render: "client"` usan el nuevo tipo `ClientPageDefinition`. `PageRender` incluye ahora `"client"`, de modo que un `switch` exhaustivo sobre él debe cubrir ese valor.
- El servidor compara el `render` del sidecar con el del manifiesto aunque el sidecar lo omita: un manifiesto con `render: "prerender"` y un sidecar sin `render` (o con otro valor) responden con error hasta reconstruir. Un manifiesto escrito a mano sin `render` sigue aceptando sidecars `"ssr"` y `"prerender"`.
- La entrada cliente generada importa `virtual:meeko-client-routes`; `.meeko/types/virtual-pages.d.ts` lo declara. Regenere los tipos con `meeko check` si su proyecto incluye una entrada propia.
- Cambia el contrato de broadcast de Socket:
  - `hub.broadcast()` se resuelve cuando el broker acepta el mensaje y ya no rechaza por fallos de entrega a los peers.
  - `hub.broadcast()` rechaza por tamaño: si el mensaje serializado con `serializeJson` (que escribe `<`, `>` y `&` con 6 bytes) supera `maxMessageBytes`, rechaza con `SOCKET_LIMIT_EXCEEDED` (413) antes de publicar, en lugar de cerrar con `1009` a todos los peers de la sala.
  - Un peer que falla se cierra (`1008`, `1009`, `1011`, o `1013` si su cola de entregas se llena) y su error llega a `SocketHubOptions.onDeliveryError(error, { channel, room, event })` de la instancia que tiene ese peer. `createServerApp` lo conecta por defecto al `onError` del runtime.
  - `LocalSocketPubSub.publish` deja de agregar errores de sus listeners y los envía a `onListenerError`.
  - En un broadcast, `authorizeSend` que devuelve `false` omite a ese peer sin cerrarlo.
  - Quien dependía del rechazo de `broadcast` debe observar `onDeliveryError` o `onError`.
- `SocketPubSub.subscribe` puede devolver `Unsubscribe | Promise<Unsubscribe>`, y `Unsubscribe` puede ser asíncrona. El hub espera la suscripción antes de resolver `accept`. Un broker propio debe aceptar esa firma, y quien llame a `subscribe` directamente debe esperar el resultado con `await`.
- `RequestContext.signal` ya no es `request.signal` sin más: combina esa señal con la revocación de la sesión y puede abortarse con `SessionRevokedError` aunque el cliente siga conectado.
- `PageRender` incluye `"stream"`, y `PageDefinition.render` lo acepta: un `switch` exhaustivo sobre `PageRender` debe cubrirlo. El payload puede llevar `deferred: [{ id, path, status, value?, error? }]` con `null` en cada `path`.
- El servidor sella el `StateStore` de la petición tras el render síncrono y `head`, en todos los modos de render (`ssr`, `stream`, `prerender` y los layouts de `client`): un `useState` con clave nueva, un `seed` o una escritura posteriores lanzan `STATE_SEALED`. Migración: el trabajo asíncrono que escribe estado debe esperarse en el loader (`await`) o devolverse con `defer`; una promesa suelta que escribe estado tras el render rechaza con `STATE_SEALED` y, si nadie la captura, es un rechazo no manejado que termina el proceso de Node con su configuración por defecto. `head` se sigue calculando después del render, con el estado que este escribió.
- `PageRequestContext.signal` (la `signal` del loader del servidor) ya no es `request.signal`: combina `RequestContext.signal` (desconexión y revocación de la sesión) con la cancelación del trabajo diferido (stream cancelado, `HEAD` o error de la petición).
- `SessionHandle.create`, `rotate` y `revoke` rechazan con `SESSION_LOCKED` (`500`) cuando las cabeceras de una respuesta `"stream"` ya se enviaron, sin tocar el almacén.
- Con `render: "prerender"`, un valor `defer` rechazado hace fallar la petición con `500` (y `meeko build` con la ruta afectada) en lugar de guardar el error en el HTML. `prerenderRoutes` toma el payload de navegación del propio documento (`#meeko-payload`) y sólo pide `application/meeko+json` al handler cuando el documento no lo incluye.

### Añadido y corregido

- Una navegación cliente cuyo loader o middleware de servidor redirige (por ejemplo, una página privada que envía a `/login`) ya no falla con «Meeko route data mismatch»: el cliente navega al destino sin recargar si es una ruta de la aplicación en el mismo origen, o hace una carga completa en otro caso. Cubre tanto la redirección que sigue el `fetch` del navegador como un `3xx` devuelto por un `fetch` propio.

- Streaming SSR con `render: "stream"` y `defer(promise, { timeoutMs })` o `defer((signal) => promise, { timeoutMs })` desde `@meekojs/meeko/framework` (tipos `Deferred`, `DeferredError`, `DeferredStatus`, `DeferOptions`, `DeferredFactory`). La señal de una fábrica se aborta por timeout, desconexión, revocación de la sesión, stream cancelado, `HEAD` o, en el navegador, al salir de la ruta. Antes del primer byte se ejecutan middleware, validación, el loader crítico, `head` y el render síncrono de layouts y página; después se sella el estado y se comprueba la sesión con `session.verify()` (una sesión revocada responde `401`). La respuesta (`cache-control: no-store, no-transform`, `x-accel-buffering: no`; `no-transform` evita que un intermediario comprima o reescriba el cuerpo con buffer) envía el documento con `#meeko-payload` y una entrada `<script type="module" async>` que respeta el nonce CSP, y luego un `<script type="application/json" data-meeko-deferred="N">` por valor resuelto. Los rechazos se envían como `{ code, status }` (los `5xx` llegan a `onError` con el `requestId`), `DEFERRED_TIMEOUT`/`504` al agotar el plazo (10 s por defecto), y los diferidos se abortan con `RequestContext.signal`, al cancelarse el stream o en `HEAD`. Los cambios de sesión en curso terminan antes del primer byte y los posteriores fallan con `SESSION_LOCKED` sin cerrar la sesión del usuario. El navegador hidrata con los valores pendientes, aplica los bloques recibidos tras la hidratación, detecta los posteriores con un `MutationObserver`, sólo acepta bloques hijos directos de `<body>` situados después de `#meeko-payload` y rechaza con `DEFERRED_INCOMPLETE`/`502` los que nunca llegan. La navegación cliente a una ruta `"stream"` recibe `application/meeko+ndjson` (payload en la primera línea, un valor por línea después), informa las líneas mal formadas sin detenerse, rechaza con `DEFERRED_INCOMPLETE` lo pendiente si la lectura falla y cancela la lectura al salir de la ruta. Los valores diferidos pueden ir bajo claves `constructor` o `prototype`; bajo `__proto__` el servidor responde `500`. Con `render: "ssr"` o `"prerender"`, `defer` se espera antes de renderizar. La suite de conformidad comprueba en Node, Bun, Deno y workerd que el primer byte llega antes que el valor diferido. En local, `wrangler dev` y `meeko preview --adapter cloudflare` (Miniflare) comprimen `text/html` con gzip aunque la respuesta lleve `no-transform` y sólo escriben el cuerpo al terminar; un cliente que envía `accept-encoding: identity` recibe el streaming.
- Páginas `render: "client"`: el servidor ejecuta los middlewares, valida `params` y `search` y renderiza sólo los layouts con el outlet vacío; el navegador ejecuta `load` y `head` con el nuevo `ClientPageLoadContext` (`url`, `params`, `search`, `signal`, `state`) y renderiza la página. La navegación entre páginas SSR y de cliente funciona en ambos sentidos y conserva los layouts comunes. Sólo los sidecars `"client"` entran al bundle cliente, mediante `virtual:meeko-client-routes` y la nueva opción `mountClientApp({ loadClientRoute })`; importar código de servidor desde ellos detiene el build. Declarar `prerenderEntries` con `render: "client"` es un error. Sus datos deben llegar por API o RPC con guardas propias, y el HTML inicial no incluye datos ni `<title>` de la página.
- `useNavigation()` devuelve `{ pending }`, una señal de sólo lectura que indica si hay una navegación en curso (tipo `NavigationState`). `@meekojs/meeko/framework` exporta además los tipos `ClientPageDefinition`, `ClientPageLoadContext`, `PageHead` y `PageRender`.
- `RedisSocketPubSub({ publisher, subscriber, prefix, maxMessageBytes?, sharded?, onError? })` en `@meekojs/meeko/server` distribuye los broadcasts de Socket entre instancias mediante Redis pub/sub:
  - usa un canal Redis por canal y sala, con conteo de referencias por instancia;
  - envía un sobre versionado `{ v: 1, event, payload }`;
  - limita el tamaño antes de publicar;
  - el receptor vuelve a validar el schema y la autorización;
  - `sharded: true` activa el pub/sub con shards de Redis 7.

  Tipos nuevos: `RedisPublisherClient`, `RedisSubscriberClient`, `RedisMessageListener`, `RedisSocketPubSubOptions`, `SocketMessage`, `SocketDeliveryErrorContext`, `Unsubscribe` y `LocalSocketPubSubOptions`. `ServerRuntime.socket.onDeliveryError` sustituye al observador por defecto.
- Revocación durante una petición:
  - `SessionStore.subscribeRevocations?` es una capacidad opcional. `RedisSessionStore` la ofrece con la opción `subscriber`: el script de `revokeFamily` publica en `<prefix>revoked`. `MemorySessionStore` notifica dentro del proceso.
  - `SessionHandle.signal` y `RequestContext.signal` se abortan con `SessionRevokedError`, exportado y equivalente a `ApiError` `SESSION_REVOKED` con estado `401`.
  - Los sockets de la familia revocada se cierran con `1008`.
  - `SessionHandle.verify()` relee el store antes de efectos irreversibles.
  - `SessionHandle.signal` y `RequestContext.signal` se abortan aunque el código sólo conserve la señal; `RequestContext.signal` se combina al leerla por primera vez.
- Contrapresión de Socket con brokers asíncronos como Redis, configurable en `SocketHubOptions` y en `socket` de `server/runtime.ts`:
  - `maxPendingDeliveries` (256 por defecto) limita las entregas pendientes de cada peer; un peer que lo supera se cierra con `1013` y se informa con `SOCKET_BACKLOG_EXCEEDED` (503) a `onDeliveryError`.
  - `sessionRefreshMs` (1000 ms por defecto) hace que las entregas de broadcast reutilicen la última lectura de la sesión durante ese intervalo; las revocaciones siguen cerrando el peer al instante y `authorize`/`authorizeSend` se ejecutan en cada entrega. Con `0` se relee en cada entrega, como antes.
- `mountClientApp({ onError })` observa los fallos de la aplicación (navegación, Socket, y eventos, efectos o limpiezas sin un `provideErrorHandler` más cercano) junto con su `ErrorSource`. `provideErrorHandler` recibe también los rechazos de `effect` y `onCleanup` que devuelven una promesa por error.
- La navegación cliente es transaccional: la vista nueva se hidrata junto a la actual y la anterior sólo se retira tras una hidratación correcta; un outlet restaura su página anterior. Sólo si también falla esa restauración se recarga la última URL confirmada.
- La navegación actualiza `document.title` con el `head` de la página siguiente.
- `FrameworkHandlerOptions.document` añade marcado del host a `<head>` y al final de `<body>`, también en la página `+error.meeko`, y aplica un `nonce` CSP por petición a los estilos y al script de entrada. `head` y `bodyEnd` pueden ser funciones que reciben la petición y su nonce.
- Un evento, efecto o limpieza de un componente sin observador antepasado sólo se entrega al `onError` de la aplicación o a la consola, nunca al `provideErrorHandler` de otro componente.
- Las interpolaciones con entidades HTML (`&copy;`, `&lt;`) o saltos CRLF se ubican en la misma posición en `meeko check` y en VS Code: el compilador analiza el texto fuente y decodifica cada parte como el parser HTML. El analizador trata como división el `/` tras `i++`, `i--` o una propiedad con nombre de palabra clave (`obj.return / 2`) y acepta continuaciones de línea CRLF dentro de cadenas.
- `meeko --help` y `meeko --version`.
- DevTools edita señales: `setSignal(instanceId, name, value)` sustituye el valor de una señal editable de una instancia activa por un valor JSON validado y responde `{ ok, error }` en lugar de lanzar. Sólo existe en desarrollo. Los dos paneles añaden el formulario **Editar señal**, con el error visible junto a **Aplicar**, y la línea de tiempo marca esas escrituras como «Escrita desde DevTools».
- La línea de tiempo de DevTools indica qué escribió cada señal. Sólo la compilación de desarrollo (`hot`) lo instrumenta; el código de producción y el HTML de SSR no cambian. Cubre, en el script `.meeko` y en las expresiones `on:` de la plantilla:
  - las asignaciones `.value` con `=`, `??=`, `||=` y `&&=`;
  - las asignaciones compuestas y `++`/`--`.
- Las lecturas de DevTools se ubican también en `computed(() => …)`, `if:when`, `each:of` y las props de componentes hijos, además de en las expresiones de texto y atributo.
- Los tipos del protocolo DevTools viven sólo en `src/devtools-protocol.ts`. La extensión de Chrome usa una copia generada (`pnpm run devtools:types`) que su `tsc` con `checkJs` comprueba, y `devtools:check` falla si esa copia queda desactualizada. La raíz exporta los nuevos tipos `DevtoolsReadSite`, `DevtoolsReadKind`, `DevtoolsWriteSite`, `DevtoolsAssignmentSite`, `DevtoolsEditSite`, `DevtoolsCommandResult`, `DevtoolsEventKind` y `DevtoolsProtocolVersion`.
- La extensión Meeko DevTools para Chrome pasa a la versión 1.0.0, con edición de señales, ubicaciones de escritura y lectura y aviso de protocolo no compatible.
- Servidor de lenguaje de Meeko: `meeko lsp --stdio` y el bin `meeko-language-server` (también `--node-ipc`, `--socket=<puerto>` y `--pipe=<nombre>`). Ofrece diagnósticos de `meeko check`, completado, hover, definición, referencias, renombrado entre archivos `.meeko` y `.ts`, ayuda de firma, símbolos, plegado, formato, tokens semánticos y acciones rápidas (añadir imports, resolver un autoimport ambiguo con un import explícito y quitar `params` de un `href` estático). `initializationOptions` admite `trusted`, `projectContracts` y `diagnosticsDelay`. [docs/editors.md](docs/editors.md) explica la configuración para Neovim, Helix, Zed, JetBrains (LSP4IJ) y Sublime Text. Dependencias nuevas: `vscode-languageserver`, `vscode-languageserver-textdocument`, `vscode-html-languageservice` y `vscode-css-languageservice`.
- En un workspace de confianza el servidor de lenguaje ejecuta `meeko.config.*`, de modo que `extends`, `modules` e `imports.serverDirs` ya no tienen que ser arrays literales para el editor; sin confianza sigue leyéndolos de forma estática.
- La extensión de VS Code `meeko-language` 1.0.0 es un cliente del servidor de lenguaje: usa el de `@meekojs/meeko` del proyecto cuando está instalado y el incluido como alternativa o en modo restringido.
- Editor: los diagnósticos cubren el token completo en lugar de un carácter, los tokens semánticos de expresiones multilínea se dividen por línea, el renombrado reescribe declaraciones e imports en otros archivos y hover, completado y navegación usan el `tsconfig.json` real del proyecto.
- `meeko check` aplica las opciones de resolución del `tsconfig.json` de la raíz del paquete (`paths`, `baseUrl`, `types`, `typeRoots`, `customConditions`, `resolveJsonModule`, `allowImportingTsExtensions`), igual que el editor: un alias `paths` que el editor resuelve ya no se informa como `TS2307`. `baseUrl` se traduce a una correspondencia `*` porque TypeScript 7 no lo admite. Las banderas estrictas de comprobación no cambian.
- `createServerApp({ manifest, load, runtime, production })` crea una aplicación portable con `fetch(request, platform?)`, `socket`, `publicOrigin`, `reportError` y `close()`; `defineServerRuntime` declara sesiones, servicios por petición, política de Socket, `publicOrigin`, `onError` y `close`. `RequestContext.platform` expone `{ name, env, waitUntil }`.
- `@meekojs/meeko/node` añade `serveNode(app, { host, port, publicOrigin, platform, onError, handleSignals, shutdownTimeout })`, que conecta también Socket y espera las tareas de `waitUntil` al cerrar, y `createNodeAssetReader`. Las respuestas abiertas, como un stream, tienen `shutdownTimeout` milisegundos (10 000 por defecto) para terminar antes de que se corten sus conexiones, y un fallo al conectar Socket tras escuchar libera el puerto y cierra la aplicación. `toNodeListener` acepta `publicOrigin`.
- Las tareas que un callback de Socket registra con `context.platform.waitUntil` las espera `app.close()` (y por tanto `serveNode`), y sus fallos llegan al observador `onError` del runtime en lugar de la consola.
- `meeko build [directorio] [--adapter <nombre>]` y `MeekoConfig.server` (unión discriminada; Node acepta `host` y `port`) eligen el destino del build. Con Node, `meeko preview` ejecuta el build igual que `meeko start`. El servidor de producción escucha en `HOST`/`PORT` o en los valores de `server`, con `127.0.0.1:4173` por defecto; antes sólo podía escuchar en `127.0.0.1`.
- Adaptadores Bun y Deno:
  - `@meekojs/meeko/bun` exporta `createBunServer(app, { publicOrigin, platform, onError, maxPayloadLength, backpressureLimit, idleTimeout, sendPings })`, que devuelve `{ fetch, websocket }` para `Bun.serve`, y `createBunAssetReader`.
  - `@meekojs/meeko/deno` exporta `serveDeno(app, { host, port, publicOrigin, platform, onError, maxMessageBytes, idleTimeout, handleSignals })` y `createDenoAssetReader`.
  - `@meekojs/meeko/server` añade `createSocketUpgradeHandler`, la comprobación portable de ruta, Origin y sesión previa al upgrade que comparten Node, Bun y Deno.
- `meeko build --adapter bun` y `--adapter deno` escriben `.meeko/output/bun/` (`index.js`) y `.meeko/output/deno/` (`main.js`), junto con `chunks/`, `client/` y `prerender/`. Cada salida incluye todas las dependencias del servidor y no necesita `node_modules`. `meeko preview [--adapter <node|cloudflare|bun|deno>]` ejecuta la salida en su runtime real; para Bun y Deno lo hace como proceso hijo, que debe estar en el `PATH`.
- Adaptador Cloudflare Workers:
  - `@meekojs/meeko/cloudflare` exporta `createWorker(app, { socketBinding?, publicOrigin?, onError? })`, `createSocketRoomClass(app, DurableObject, { maxMessageBytes?, autoResponse?, keepHeaders?, maxPendingPublications?, rebuildTimeoutMs?, onError? })`, `DurableObjectSocketPubSub`, `socketRoomName`, `D1SessionDriver` (con `schema()` y `deleteExpired()`), `createCloudflareAssetReader` y `createCloudflarePrerenderSource`, más sus tipos estructurales (`CloudflareApp`, `CloudflareAppContext`, `CloudflareWorker`, `CloudflareWorkerOptions`, `SocketRoomOptions`, `MeekoSocketRoom`, `D1DatabaseLike`, `DurableObjectNamespaceLike`…). No requiere `@cloudflare/workers-types`.
  - Cada sala de Socket es un Durable Object con la API de hibernación: el Worker comprueba ruta, Origin y sesión antes del upgrade, la conexión se reconstruye al despertar desde su attachment y el hub vuelve a autorizar; `ping` se responde con `pong` sin despertar el objeto. `DurableObjectSocketPubSub` es el broker por defecto y publica entre salas por RPC.
  - El attachment de cada conexión guarda sólo la cookie de sesión de la cabecera `Cookie`, además de `origin` y `authorization`; `keepHeaders` añade otras cabeceras. Si el estado supera los 16.384 bytes que admite un attachment, el upgrade responde `431` y el error llega a `onError`, en lugar de cerrar la conexión con `1011` tras aceptarla.
  - Una sala entrega cada publicación a los peers ya suscritos sin esperar a una conexión que todavía se autoriza; tras hibernar espera la reautorización como máximo `rebuildTimeoutMs` (5000 ms) y rechaza con `SOCKET_BACKLOG_EXCEEDED` (503) por encima de `maxPendingPublications` (1024) publicaciones sin entregar. Con nombres de más de 1.024 bytes, que el runtime no expone en `ctx.id.name`, la sala toma su nombre de la primera conexión o publicación y no se llama a sí misma por RPC. Si la aplicación no puede crearse al despertar, la sala cierra con `1011` el WebSocket que la despertó.
  - `runtime.socket.pubsub` sólo admite `DurableObjectSocketPubSub` en Workers: otro broker, como `LocalSocketPubSub` o `RedisSocketPubSub`, se rechaza al crear la aplicación. `socket.maxBufferBytes` no se aplica en las salas porque los WebSockets de Workers no informan de `bufferedAmount`.
  - `D1SessionDriver` implementa `SqlSessionDriver` con `replace` y `revokeFamily` atómicos en una sola sentencia y `UNIQUE(family_id)`. La documentación incluye el esquema, un adaptador de la API REST de Upstash para `RedisSessionStore` y por qué KV no es válido.
  - `meeko build --adapter cloudflare` escribe `.meeko/output/cloudflare/` con `worker.js` (un único módulo, sin `node_modules`), `assets/` (cliente, `public/` y prerender bajo `_meeko/prerender/`) y un `wrangler.jsonc` generado con `nodejs_als`, assets servidos sólo a través del Worker, el binding `MEEKO_SOCKET` y la declaración de la clase de salas. La migración `meeko-socket-v1` sólo se genera cuando `server.wrangler.migrations` está vacío; un historial existente que no crea la clase detiene el build con la entrada exacta que hay que añadir al final, y con el mapa declarativo `exports` Meeko añade la entrada de la clase si falta (combinar `exports` de Durable Objects con `migrations` es un error). `MeekoConfig.server` acepta `{ adapter: "cloudflare", name?, socketClassName?, compatibilityDate?, wrangler? }`; `public/_meeko/` queda reservado. `meeko preview --adapter cloudflare` ejecuta `wrangler dev` sobre la salida.
  - `@meekojs/meeko/server` añade `openSocketSession`, `ServerAppOptions.defaultSocketPubSub` y los campos opcionales `pubsub` y `sessionCookieName` de `ServerAppSocket`.
- Las conexiones Socket que nunca se cierran, como las de un Durable Object desalojado con sus WebSockets hibernados, ya no acumulan registros de revocación en el `SessionManager`: los registros de sesiones recolectadas se barren sin depender de los finalizadores.
- Suite de conformidad `tests/conformance/` (`pnpm run conformance`, `conformance:node`, `conformance:bun`, `conformance:deno`, `conformance:workerd`). Construye la misma aplicación para cada adaptador y la ejecuta sin fuentes. Comprueba SSR, API, RPC, CSRF, `404`/`405`, `HEAD`, assets con `ETag`/`304` e intentos de traversal, prerender con CSRF, orden del middleware y Socket (Origin, autenticación, límites, orden y broadcast). La variante `workerd` ejecuta la salida Cloudflare con el runtime local de Wrangler y prueba además sesiones D1, la hibernación forzada de una sala, la publicación entre salas, una cabecera `Cookie` mayor que el límite del attachment, una sala con nombre de más de 1.024 bytes y que la salida sea un único módulo. La CI añade los jobs `bun`, `deno` y `workerd` en Ubuntu y la conformidad Node en Windows; el workflow de publicación exige también esos jobs. Nueva devDependency `wrangler` 4.152.0 (trae workerd 1.20261019.1).
- Un único `publicOrigin` (o `PUBLIC_ORIGIN`) rige las comprobaciones de Origin de HTTP y de Socket, por lo que las mutaciones autenticadas y los WebSocket funcionan tras un proxy que termina TLS.
- Las páginas `render: "prerender"` se sirven por fin desde el build, pasando por el middleware de servidor, el contexto de sesión y el middleware de ruta, con la meta CSRF de la sesión insertada en `<head>`. Sin sesión llevan `ETag`, `Vary: cookie`, `cache-control: public, max-age=0, must-revalidate` y responden `304`; con sesión, `private, no-store`; una CDN delante debe respetar `Vary: cookie` u omitir la caché en peticiones con cookie de sesión. Un fallo de lectura de una página prerenderizada ya no queda en caché: la siguiente petición vuelve a leer el archivo. Antes el prerender se generaba sin contexto ni CSRF y nunca se servía.
- Los archivos públicos del build llevan `ETag`, `content-length`, `HEAD` y `304`; sólo los archivos emitidos por Vite con hash de contenido se sirven con `cache-control: public, max-age=31536000, immutable`, no los copiados de `public/assets/`. Cada archivo se sirve en la ruta que pide el navegador, también con nombres como `logo@2x.png`, `a+b.txt`, espacios o caracteres no ASCII. El HTML enlaza la entrada, su CSS y sus `modulepreload` desde el manifiesto de Vite sin reescribir el documento completo.
- `toNodeListener` interpreta un request-target que empieza por `//` (por ejemplo `//evil.example/api/x`) como ruta del propio origen y no como otro host; antes la URL de la petición apuntaba a ese host y podía satisfacer la comprobación de Origin de una mutación con un `Origin` de ese host. `createServerApp` aplica lo mismo al reescribir la URL con `publicOrigin`.
- `toNodeListener` cancela el cuerpo de la respuesta si el cliente se desconecta antes de recibir las cabeceras o mientras el stream espera datos, de modo que se liberan los archivos abiertos y se detienen los productores.
- El núcleo de servidor genera los IDs con `crypto.randomUUID()` y los tokens de sesión con `crypto.getRandomValues` y un codificador base64url propio, sin `node:crypto`.
- Las expresiones de texto admiten llaves anidadas: objetos literales, plantillas literales con `${...}`, cadenas que contienen `{` o `}`, comentarios y expresiones regulares. Compilador y VS Code comparten el mismo analizador, por lo que SSR, hidratación, `meeko check` y el editor ubican cada expresión en la misma posición. Una interpolación sin cerrar se informa con `MEEK010` en su llave de apertura, y `{}` se informa como expresión vacía (`MEEK009`).
- El código generado envuelve entre paréntesis las expresiones devueltas por funciones flecha, de modo que una expresión que empieza por `{`, como `bind:title="{ text: label }.text"`, no se interpreta como bloque.
- VS Code mapea los valores de directivas sin comillas, como `on:click=handler` o `each:of=items`, con la misma lógica que el compilador; sus diagnósticos, navegación y renombrado ya no se omiten.
- `<style scoped>` admite `:global(<selector>)`: el selector interno se emite sin el atributo de ámbito, que se añade al último compuesto local (`.card :global(.icon)` produce `.card[data-meeko-s-…] .icon`). `:global` sin selector, con una lista de selectores o anidado en otra pseudoclase falla con `MEEK019` en su posición.

### Publicación

- Una versión con sufijo de prerelease (`1.0.0-rc.1`) se publica en npm con el dist-tag `next` y no mueve `latest`. La publicación sigue usando OIDC sin token de npm.
- La etiqueta `v<versión>` adjunta a su release de GitHub los seis VSIX de VS Code, el ZIP de Chrome DevTools y `SHA256SUMS.txt`, y crea la release como prerelease cuando la versión lo es. Sólo ese job tiene `contents: write`, e `id-token: write` queda limitado al job de npm.
- Nuevos workflows `publish-vscode.yml` (etiquetas `vscode-v*`, Visual Studio Marketplace y Open VSX) y `publish-devtools.yml` (etiquetas `devtools-v*`, API v2 de Chrome Web Store). Comprueban la versión de la etiqueta y ejecutan las pruebas de la extensión antes de publicar, y omiten cada tienda sin fallar mientras falten sus secretos (`VSCE_PAT`, `OVSX_PAT`, `CHROME_EXTENSION_ID`, `CHROME_PUBLISHER_ID`, `CHROME_CLIENT_ID`, `CHROME_CLIENT_SECRET`, `CHROME_REFRESH_TOKEN`). [docs/releasing.md](docs/releasing.md) explica el alta de cada cuenta.
- `package-zip.ps1 -RootLayout` genera el ZIP de Chrome DevTools con `manifest.json` en la raíz, como exige Chrome Web Store; sin el switch conserva la carpeta `meeko-devtools/`.

## [0.1.0] - 2026-10-25

Este bloque contiene cambios incompatibles respecto de `0.0.4`. De acuerdo con la política SemVer de Meeko para la serie `0.x`, se publica como `0.1.0`, no como un patch.

### Cambios incompatibles y migración

- `effect` y `onCleanup` sólo aceptan callbacks síncronos. Inicie el trabajo asíncrono desde un callback síncrono, observe sus errores y gestione explícitamente su cancelación; no devuelva una promesa al runtime reactivo.
- Los stores persistentes personalizados deben conservar `familyId` e implementar `replace` y `revokeFamily` de forma atómica. Migre registros e índices antes del arranque en producción: `SessionManager({ production: true, ... })` rechaza un store incompleto; en desarrollo, la operación que necesite una capacidad ausente falla de forma explícita.
- `render: "client"` ya no forma parte del contrato de páginas. Elimínelo para usar SSR, que continúa siendo el valor predeterminado, o use `render: "prerender"` cuando corresponda.
- Los proyectos generados activan `verbatimModuleSyntax`, `noUncheckedIndexedAccess` y `exactOptionalPropertyTypes`. Use `import type`, compruebe accesos por índice y declare `| undefined` explícitamente cuando la ausencia sea un valor permitido.
- Los contratos Standard Schema públicos deben resolver a tipos concretos. Sustituya `any`, `unknown`, `never`, parámetros genéricos no resueltos y tipos anidados inseguros por tipos públicos concretos de entrada y salida.
- Las rutas estáticas ya no aceptan `params`; las rutas API/RPC que forman jerarquías ambiguas o no representables deben renombrarse. Los parámetros dinámicos deben corresponder exactamente con la URL. Las queries públicas deben aceptar texto o listas de texto y modelar como opcionales las claves que puedan faltar; transforme números dentro del schema.
- Los contratos de componentes, páginas, layouts y errores validan las props que el host realmente suministra. Declare esas props precisas y no ensanche un componente para ocultar requisitos obligatorios.
- Para migrar un starter full-stack de `0.0.4`, adopte `meeko dev`, `meeko check`, `meeko build` y `meeko start`; compare primero cualquier personalización y después retire `server.mjs`, las entradas cliente/servidor, las configuraciones Vite y los `tsconfig.*` ahora generados bajo `.meeko/`. Puede mover el layout raíz a `app/layouts/default.meeko`, pero no lo conserve a la vez que `app/pages/+layout.meeko`.

### Añadido y corregido

- La revocación de sesiones ahora invalida atómicamente la familia activa después de rotaciones concurrentes en memoria, Redis y SQL. Los drivers SQL personalizados deben migrar `familyId` e implementar `revokeFamily`; los stores de producción antiguos fallan al iniciar. VS Code aplica las mismas opciones estrictas de TypeScript que la CLI, HMR acepta IDs de módulo con caracteres de selector CSS y Socket comunica errores del transporte al observador activo.
- El descubrimiento rechaza colisiones jerárquicas que convertirían un miembro `api` o `rpc` simultáneamente en función y objeto. El starter independiente observa y conserva los fallos al cerrar HTTP y Vite mediante `SIGINT` o `SIGTERM`.
- La generación de tipos registra las declaraciones de componentes que administra y elimina las huérfanas tras borrar o renombrar una fuente. La adopción desde versiones anteriores usa el AST del contrato generado y conserva declaraciones ajenas.
- Los autoimports conservan parámetros, restricciones y defaults de tipos genéricos reexportados y deduplican overloads del mismo símbolo. Los proyectos generados usan las mismas opciones estrictas que CLI y VS Code.
- API, RPC y Socket rechazan schemas Standard Schema degradados a `any`, `unknown` o `never`, incluidos parámetros genéricos no resueltos y tipos inseguros anidados; el descubrimiento rechaza APIs raíz sin clave y rutas jerárquicas imposibles de representar. Si el arranque falla, los errores adicionales de cierre llegan al observador sin sustituir la causa original.
- `onCleanup` exige callbacks síncronos en tipos y runtime; un retorno thenable se observa sin `unhandledRejection`, no impide las demás limpiezas y participa en el `AggregateError` de la raíz.
- VS Code tipa `each:index` como `number`, igual que el compilador. La navegación solicita volver a la URL confirmada si falla `pushState` o `replaceState`, y preserva los errores de recuperación.
- `+error.meeko` conserva el contexto SSR de la petición, incluso en peticiones concurrentes; el cliente ignora tokens CSRF de respuestas anteriores a un cambio de sesión o navegación, y VS Code comprueba los tipos de `on:event` y `each:key` como el CLI.
- HMR restaura listeners y todas las raíces del módulo si falla su limpieza o una actualización posterior, mientras el adaptador Node conserva el `requestId` ya enviado al cliente cuando falla un stream de respuesta.
- El outlet del starter y los contratos de layout validan con mayor precisión el `Component`, sus props y la transferencia de estado SSR; los reemplazos de componentes y listas conservan la región previa cuando falla su hidratación o movimiento, y Socket intenta cerrar el peer aunque falle la desuscripción.
- `provideErrorHandler` permite observar errores de eventos por raíz de componentes con autoimport y tipo `unknown`; HMR conserva el contexto padre al reemplazar o restaurar una instancia.
- La navegación y los canales Socket de una aplicación montada consultan su observador activo; `socket` autoimportado conserva conexiones por aplicación y libera listeners al desmontar componentes. HMR preserva el fallo original si también falla el rollback.
- Los scripts `.meeko` admiten llamadas de expresión durante el setup para registrar hooks sin declaraciones artificiales.
- Tipado de defaults de `defineProps`, props de componentes hijos y contratos entre páginas y sidecars de ruta.
- Hidratación de expresiones de texto inicialmente vacías sin perder eventos, verificada con el componente de login original en Chrome.
- Comprobación TypeScript por ámbito de las fuentes de app, shared, servidor, layers y módulos configurados.
- Errores de servidor normalizados con `requestId` en páginas, API, RPC y WebSocket; cierre más robusto de recursos Node.
- Los fallos de limpieza de raíces y componentes compilados conservan también el error original; los fallos de navegación cliente por historial y clic se observan sin rechazos pendientes.
- Los contratos de páginas, layouts y páginas de error rechazan props inseguras; el editor muestra esos diagnósticos sobre `defineProps` al abrir o guardar el proyecto.
- Los componentes recibidos como props comprueban también si sus props obligatorias pueden omitirse; el editor actualiza diagnósticos y colores al guardar módulos TypeScript importados.
- Las rutas sin parámetros rechazan `params` en TypeScript; el editor vuelve a comprobar contratos de páginas cuando cambia un tipo importado por un sidecar.
- Las navegaciones descartadas no conservan estado provisional ni tokens CSRF, y los observadores reactivos pendientes terminan de ejecutarse aunque otro falle.
- Socket comunica fallos de listeners, observadores de estado y reconexión, ignora mensajes de conexiones reemplazadas y continúa un broadcast hacia peers sanos si uno falla.
- Los observadores de errores de navegación y servidor pueden ser asíncronos sin producir rechazos sin manejar; si fallan, Meeko informa el fallo sin sustituir la respuesta original.
- Los handlers `on:event` asíncronos ya entregan su promesa al runtime para registrar rechazos; los errores de TypeScript de módulos `.ts` importados señalan su archivo y posición reales.
- Eventos, navegación, Socket y DevTools comparten una captura interna de callbacks síncronos y asíncronos; los E2E fallan también ante errores de consola.
- `effect` rechaza callbacks que devuelven promesas en tipos y runtime; un rechazo asíncrono concurrente queda observado y registrado. Las aplicaciones que usaban `effect(async () => ...)` deben iniciar el trabajo asíncrono desde un callback síncrono y manejar su cancelación.
- Los contratos API rechazan `params` que no coincidan con la ruta y valores de `query` incompatibles con el transporte URL.
- La limpieza de listas libera todos los hijos aunque falle un release o una hidratación posterior; el middleware HTTP propaga fallos de `next()` aunque su autor no lo espere.
- El adaptador HTTP Node conserva varias cookies `Set-Cookie` y detiene el streaming cuando el cliente se desconecta.
- Comandos de proyecto generados por Meeko, layouts en `app/layouts`, middleware de rutas y HTTP, y validación ampliada del consumidor externo.
- CI selecciona el tarball generado por el build en lugar de fijar el nombre de una versión publicada.
- El workflow de publicación exige ahora las pruebas de la extensión VS Code sobre el SHA del tag.

## [0.0.4] - 2026-10-24

### Framework full-stack

- Rutas basadas en archivos con parámetros y navegación tipados, layouts persistentes, SSR e hidratación.
- Estado `useState` aislado por petición, prerender y composición de módulos y layers.
- Starter `meeko init-framework` y generación de manifiestos mediante CLI y Vite.

### Autoimports y tipos

- Autoimports tipados en `.meeko` y `.ts` para componentes, composables, stores y utilidades; símbolos `api`, `rpc`, `socket` y `useSocket`.
- Declaraciones TypeScript generadas por ámbito, con separación entre código cliente, servidor y shared.

### Servidor

- API HTTP y RPC tipados mediante contratos Standard Schema; despacho RPC local durante SSR con la misma validación y autorización.
- Sesiones con adaptadores Redis y SQL, y canales WebSocket con transporte Node.
- Validación de entradas y salidas, autorización y errores normalizados.

### Seguridad y correcciones

- Aislamiento de peticiones SSR, protección CSRF y límites de imports entre cliente y servidor.
- Protección de rutas públicas y layers frente a enlaces simbólicos que salen del proyecto.
- Comprobaciones de Origin y autorización de WebSocket; `ws` se carga sólo al activar el adaptador Node.

### Verificación y herramientas

- Mejoras de Vite y CLI, source maps de JavaScript con fuentes embebidas y baseline reproducible de rendimiento.
- Consumidor externo desde tarball, integración con Redis real en CI y E2E en Chromium, Firefox y WebKit.

## 0.0.3

- `meeko init .` configura una carpeta recién preparada con pnpm, conserva su manifiesto y archivos del gestor, y rechaza proyectos que ya contienen código o scripts incompatibles.
- Hidratación sin escrituras iniciales redundantes de texto y atributos; señales sin lectores y filas que no usan el índice asignan menos memoria.
- Reconciliación de listas con claves que conserva regiones ordenadas y evita movimientos innecesarios; hidratación inicial sin reconciliación cuando el estado SSR sigue intacto.
- Aplicación piloto con SSR, hidratación, formularios, navegación, componentes anidados y API asíncrona, probada en desarrollo y producción con Chromium, Firefox y WebKit.
- `meeko init <directorio>` genera un proyecto SSR independiente que fija la versión exacta de su compilador y runtime.
- Línea de tiempo de señales en ambos paneles DevTools, con componente, valor seguro y expresiones de texto o atributo que leen cada señal, ubicadas en el `.meeko`.
- Primera publicación npm mediante Trusted Publishing, con procedencia firmada desde `meekojs/meeko` y `publish.yml`.

## 0.0.2

- DevTools experimental para inspeccionar instancias hidratadas, props, señales, eventos, árbol de componentes y estado de hidratación durante el desarrollo con Vite.
- Panel integrado y extensión local de Chrome DevTools con selección, resaltado y puntos de parada por instancia.
- Ruta `@meekojs/meeko/internal` para el runtime generado por el compilador. Los exports internos anteriores siguen disponibles en la raíz durante la serie experimental para conservar compatibilidad.
- Configuración de depuración de la extensión de VS Code y ampliaciones de sus verificaciones y de los benchmarks reproducibles.

La sintaxis y las API de la serie `0.x` siguen siendo experimentales. El compilador y su runtime deben usar la misma versión del paquete.

## 0.0.1

- Primera versión pública con componentes `.meeko`, SSR, hidratación, señales reactivas, plugin de Vite, HMR, CLI y extensión local de VS Code.
