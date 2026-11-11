# Runtime y errores del servidor

Esta guía desarrolla [la visión general del framework](framework.md).

## Runtime de servidor

`server/runtime.ts` exporta por defecto `defineServerRuntime(factory)`. Meeko llama a la fábrica una vez por proceso con `{ env, production, platform, prerendering, root }` y espera los recursos de la aplicación:

```ts
import { defineServerRuntime, SessionManager } from '@meekojs/meeko/server'
import { createDatabase } from './utils/database.js'

export default defineServerRuntime(async ({ env, production, prerendering }) => {
	const db = await createDatabase(env.DATABASE_URL)
	return {
		sessions: new SessionManager({ store: db.sessionStore(), production: production && !prerendering }),
		services: (request, { platform }) => ({ db, region: platform.env.REGION }),
		socket: { allowedOrigins: [], maxMessageBytes: 64 * 1024 },
		publicOrigin: env.MEEKO_PUBLIC_ORIGIN,
		onError: (error, requestId) => console.error('request failed', requestId, error),
		close: () => db.close(),
	}
})
```

- `sessions` es opcional desde `1.2`. Sin `server/runtime.ts`, o si no devuelve `sessions`, Meeko las crea: en memoria en desarrollo y en Redis con `MEEKO_REDIS_URL` en producción (véase [Sesiones sin configuración](framework-auth.md#sesiones-sin-configuración)). Unas `sessions` explícitas siempre ganan.
- `services` puede ser un objeto compartido o una función por petición; llega a páginas, API, RPC y Socket como `RequestContext.services`. Desde `1.7` su tipo se infiere de este archivo, sin conversiones (véase [Tipos de los servicios](#tipos-de-los-servicios)).
- `RequestContext.platform` expone `{ name, env, waitUntil(promise) }`. En Node, `serveNode` espera las tareas registradas con `waitUntil` antes de cerrar la aplicación. Las tareas registradas fuera de una petición HTTP, como en callbacks de Socket, quedan a cargo de la aplicación: `app.close()` las espera y sus fallos llegan al observador `onError` del runtime en lugar de la consola.
- `publicOrigin` es el origen público de la aplicación, por ejemplo `https://example.com` tras un proxy que termina TLS. HTTP y Socket comparan `Origin` con ese valor; `MEEKO_PUBLIC_ORIGIN` lo sustituye en `meeko dev` y en las salidas de Node, Bun, Deno y Workers. Sin `publicOrigin`, Socket usa la dirección en la que escucha el servidor. Si esa dirección o el `publicOrigin` es de loopback, Socket acepta también los otros nombres de loopback (`localhost`, `127.0.0.1`, `[::1]`) con el mismo esquema y puerto. Esto supone que ningún otro proceso escucha en ese puerto con otra dirección de loopback; si ocurre, configure `publicOrigin` con un origen que no sea de loopback o cambie el puerto.
- `onError` recibe los fallos internos con su ID de petición; sin él, Meeko registra el nombre del error y el ID, y en desarrollo también el error completo. También recibe los fallos de entrega de Socket, salvo que `socket.onDeliveryError` los observe por separado, y, desde `1.3`, las promesas rechazadas sin manejar y las excepciones no capturadas del proceso, con un tercer argumento (véase [Errores](#errores)).
- `processErrors` (desde `1.3`) decide qué pasa con esos fallos del proceso; sin declararlo, un rechazo se informa y el servidor sigue atendiendo, y una excepción se informa y el servidor se cierra de forma ordenada con código 1 (véase [Fallos fuera de una petición](#fallos-fuera-de-una-petición)).
- `socket.pubsub` elige el broker de broadcast; `socket.maxPendingDeliveries` y `socket.sessionRefreshMs` limitan la cola de cada peer y la frecuencia con que sus entregas releen la sesión. Véase [Broadcast y varias instancias](framework-websocket.md#broadcast-y-varias-instancias).
- `close` se ejecuta después de cerrar las sesiones, al detener el servidor.
- `root` (desde `1.8`) es la ruta absoluta de la raíz del proyecto, para leer sus archivos desde el servidor (contenido, plantillas, un repositorio de Git). No use `import.meta.url` para eso, porque el build mueve el código de servidor a `.meeko/output/…`, ni `process.cwd()`, que sólo es la raíz cuando la CLI lanza el proceso. En `meeko dev` es la raíz del proyecto; en las salidas de Node, Bun y Deno (también con `meeko start`, con `node .meeko/output/node/index.mjs` desde cualquier carpeta y durante el prerender) es la carpeta tres niveles por encima de la salida. Si despliega la salida fuera del proyecto, `MEEKO_ROOT` (absoluta o relativa al directorio de trabajo) indica dónde está; sin ella, la ruta apuntaría a la carpeta tres niveles por encima de la nueva ubicación. En Cloudflare Workers, sin sistema de archivos, y en un `createServerApp` propio que no pasa la opción `root`, es `undefined`. Pásela a los servicios: `defineServerRuntime(({ root }) => ({ services: { docs: join(root!, "docs") } }))`.

`createServerApp({ manifest, load, runtime, production })` de `@meekojs/meeko/server` crea la misma aplicación a partir de un manifiesto y un cargador de módulos, y expone `fetch(request, platform?)`, `socket`, `publicOrigin`, `reportError` y `close()`. El entry generado por `meeko build` la usa; un host propio puede servirla con `serveNode(app, { host, port, publicOrigin, handleSignals, shutdownTimeout })` de `@meekojs/meeko/node`. Si el servidor arranca pero falla la conexión de Socket, `serveNode` libera el puerto y cierra la aplicación antes de propagar el error.

### Tipos de los servicios

Desde `1.7`, `context.services` tiene el tipo de lo que devuelve `server/runtime.ts`, sin `as unknown as MisServicios`. `meeko check`, `meeko dev` y el editor generan `.meeko/types/services.d.ts`, que amplía la interfaz `GeneratedServices` de `@meekojs/meeko/server` con el tipo de `services` del export por defecto: el objeto compartido o, si `services` es una función por petición, lo que ésta devuelve (sin la promesa). El tipo resultante se llama `AppServices`:

```ts
// server/runtime.ts
export default defineServerRuntime(async ({ env }) => {
	const db = await createDatabase(env.DATABASE_URL)
	return { services: { db, search: createSearch(db) }, close: () => db.close() }
})

// server/utils/docs.ts
import type { RequestContext } from '@meekojs/meeko/server'
export const findDoc = (context: RequestContext, slug: string) => context.services.db.docs.find(slug) // tipado
```

- **Dónde.** En `usePage().context` del `<script server>`, en los handlers, `authorize`, `locals` y `rateLimit.key` de `defineApiRoute` y `defineRpc`, en `defineSocketChannel`, en `defineServerRouteMiddleware` (`services` y `context.services`) y en cualquier `RequestContext` escrito sin argumento. `defineServerMiddleware` no recibe contexto: se ejecuta antes de que exista. El `context` opcional del `load` de `definePage` sigue siendo el tipo `C` de sus argumentos de tipo.
- **Cómo se resuelve.** `RequestContext<TServices>` usa `AppServices` cuando `TServices` es `unknown`, el valor por defecto; un tipo escrito (`RequestContext<MisServicios>`, `defineServerRouteMiddleware<MisServicios>`) o `any` siguen ganando. Sin `server/runtime.ts`, con uno en JavaScript o sin `services`, `AppServices` es `unknown`, como hasta `1.6`. Una conversión `as unknown as MisServicios` sigue compilando; una conversión directa a un tipo incompatible con el inferido pasa a ser un error, porque lo es.
- **Tests y contextos con otros servicios.** `RequestContext` compara por su tipo de servicios, así que un contexto con cualquier otro (el de un test, `createRequestContext(request, { db: falso }, session)`) se sigue aceptando donde se espera un `RequestContext` sin argumento, como el handler de una ruta sin tipo escrito, igual que en `1.6`. A cambio, para recibir el contexto de una ruta en una función, escriba `RequestContext` sin argumento (sus `services` ya son `AppServices`): `RequestContext<AppServices>` no acepta el `RequestContext` de una ruta sin tipo.
- **Autoimports.** La declaración lee una copia de `server/runtime.ts` en `.meeko/types/server-runtime.ts` con sus autoimports de servidor escritos como imports, así que `defineServerRuntime` sin importar funciona también en el editor. La copia lleva `// @ts-nocheck`: los errores se informan una sola vez, en `server/runtime.ts`. Se regenera con cada `meeko check`, al arrancar `meeko dev` y en las comprobaciones del editor.
- **Host propio.** Sin las declaraciones generadas, amplíe `GeneratedServices` a mano en un `.d.ts` de `server/`, como `MeekoSession`: `interface GeneratedServices { readonly services: MisServicios }`. `ServerRuntimeServices<typeof runtime>` calcula ese tipo a partir de una definición de runtime.
- **Límites.** Es un tipo, no valida en ejecución. Si un servicio menciona `RequestContext` en su propio tipo, TypeScript puede encontrar una referencia circular; escriba entonces `RequestContext<MisServicios>` en ese punto.

## Errores

Ningún fallo se pierde sin pasar por un observador de Meeko: cada nivel tiene el suyo, y lo que un nivel no atiende sube al siguiente o, sin observador, a la consola, como sin Meeko.

| Nivel                  | Qué captura                                                                                                                                                                                                   | Observador                                                                                                                                                                                                                                | Política                                                                                                                                                                                                                                                  |
| ---------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Componente             | Handlers `on:`, `effect`, limpiezas, `onMounted`, la continuación de un setup con `await`, formularios, mutaciones y `useStorage` de ese componente y sus hijos.                                              | `provideErrorHandler((error, source) => …)` en el `<script>`; el más cercano gana ([Middleware de rutas y servidor](framework-rendering.md#middleware-de-rutas-y-servidor), [api.md](api.md#componentes-meeko)).                                                | Observa sin cambiar la interfaz. Sin proveedor, sube a la aplicación.                                                                                                                                                                                     |
| Aplicación (navegador) | Lo anterior sin un proveedor más cercano, la navegación, los clientes Socket y, desde `1.3`, las excepciones no capturadas (`"uncaught"`) y las promesas rechazadas sin manejar (`"rejection"`) de la página. | `mountClientApp({ onError })` y `app.onError` de los plugins ([Plugins de aplicación](framework-configuration.md#plugins-de-aplicación)); `onNavigationError` tiene prioridad para la navegación.                                                                   | Sin ninguno, la navegación, Socket y los fallos globales van al primer `provideErrorHandler` activo; sin él, a la consola.                                                                                                                                |
| Página (SSR)           | Un fallo del loader, de `<script server>`, del render (también `render: "stream"` antes del primer byte) o de un `await` de datos.                                                                            | `+error.meeko` más cercano o `app/error.meeko` ([Página de error de la aplicación](framework-rendering.md#página-de-error-de-la-aplicación-apperrormeeko)), y el `onError` del runtime y de los plugins con el `requestId` de la respuesta.                     | El HTML muestra el estado y un mensaje público; un `5xx` se informa con su error privado. Un diferido rechazado de un stream se envía como `{ code, status }` y su causa llega a los mismos observadores ([Streaming SSR](framework-rendering.md#streaming-ssr-render-stream)). |
| API y RPC              | Lo que lanzan los handlers, `auth`, `authorize`, `locals` y las validaciones.                                                                                                                                 | Respuesta normalizada: `ApiError` conserva `code` y `status`, todo lo demás es `INTERNAL_ERROR`, con `requestId` y `x-request-id` ([API y RPC](framework-api.md#api-y-rpc)). En el cliente, `ClientError` (`isClientError(error, "CODIGO")` desde `1.3`). | Sólo los `5xx` llegan a `onError` del runtime; los `4xx` son respuestas previstas.                                                                                                                                                                        |
| Runtime del servidor   | Los `5xx` de páginas, API, RPC, Socket, `waitUntil` y el transporte, y desde `1.3` los fallos del proceso.                                                                                                    | `onError` de `server/runtime.ts` ([Runtime de servidor](#runtime-de-servidor)).                                                                                                                                                           | Nunca cambia la respuesta; un observador que falla se registra sin detalles privados.                                                                                                                                                                     |
| Proceso (desde `1.3`)  | Promesas rechazadas sin manejar y excepciones no capturadas fuera del flujo de una petición.                                                                                                                  | `onError` del runtime, con `{ kind, inRequest }` como tercer argumento.                                                                                                                                                                   | `processErrors`; véase [Fallos fuera de una petición](#fallos-fuera-de-una-petición).                                                                                                                                                                     |

`ErrorSource`, el segundo argumento de los observadores del navegador, gana `"uncaught"` y `"rejection"` en `1.3`. Es una unión que Meeko entrega a la aplicación, así que, según la [política de estabilidad](stability.md#api-pública), un `switch` exhaustivo sobre ella necesita una rama por defecto.

```ts
import { isClientError, mountClientApp } from '@meekojs/meeko/framework'

await mountClientApp({
	...options,
	onError(error, source) {
		if (isClientError(error, 'UNAUTHENTICATED')) return location.assign('/login')
		navigator.sendBeacon('/api/client-errors', JSON.stringify({ source, message: String(error) }))
	},
})
```

### Fallos globales del navegador

Mientras una aplicación está montada, `mountClientApp` escucha `error` y `unhandledrejection` en `window`: un `setTimeout` que lanza, un `fetch().then()` sin `catch` en el setup o el fallo de una librería llegan a `onError` y a `app.onError` con la fuente `"uncaught"` o `"rejection"`. El primer argumento es el error lanzado o el motivo del rechazo, tal cual.

- **Sin duplicados.** Un error que ya recibió un observador de Meeko (un evento, una navegación…) y que la aplicación vuelve a lanzar o deja rechazado no se informa otra vez.
- **Consola.** Cuando un observador lo recibe, Meeko llama a `preventDefault()` y el navegador no lo repite en la consola. Sin ningún observador, el evento no se toca y el navegador lo muestra como siempre. Un evento que otro listener ya marcó con `preventDefault()` se considera atendido.
- **Scripts de otro origen.** El `"Script error."` opaco de un script de otro origen cargado sin CORS no trae error, archivo ni línea: se deja a la consola. Para observarlo, cargue el script con `crossorigin` y sirva `Access-Control-Allow-Origin`.
- **Ciclo de vida.** Los listeners se registran al hidratar y se retiran con `app.dispose()` o si la hidratación falla. Un cambio de un componente con HMR no vuelve a montar la aplicación; un cambio de la entrada recarga la página. Con dos aplicaciones en la misma página, sólo la primera que lo observa recibe cada fallo.

### Fallos fuera de una petición

En el servidor, una promesa que nadie espera dentro de un handler, un `setTimeout` que lanza o el callback de una librería quedan fuera del `try` de la petición. Sin una política, Node 15+, Bun y Deno terminan el proceso con el primer rechazo sin manejar o la primera excepción no capturada, sin pasar por `onError` ni cerrar el servidor de forma ordenada. Desde `1.3`, `meeko dev`, las salidas de `meeko build` (Node, Bun, Deno y Cloudflare Workers) y `serveNode` y `serveDeno` con `handleSignals` aplican la política `processErrors` de `server/runtime.ts`:

| Fallo                | Por defecto                                                                                                                                                                                                                  | Otras opciones                                                                                                                              |
| -------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------- |
| `unhandledRejection` | `"report"`: llega a `onError` y el servidor sigue atendiendo.                                                                                                                                                                | `"shutdown"`: además, cierre ordenado con código 1. `"off"`: el runtime decide (en Node, el rechazo pasa a ser una excepción no capturada). |
| `uncaughtException`  | `"shutdown"`: llega a `onError`, el servidor deja de aceptar conexiones, espera las respuestas abiertas y las tareas de `waitUntil`, cierra la aplicación y sale con código 1, porque el estado del proceso ya no es fiable. | `"off"`: el runtime decide.                                                                                                                 |

```ts
// server/runtime.ts
export default defineServerRuntime(() => ({
	processErrors: { unhandledRejection: 'shutdown' },
	onError(error, requestId, info) {
		if (info) logger.fatal({ kind: info.kind, inRequest: info.inRequest, requestId }, error)
		else logger.error({ requestId }, error)
	},
}))
```

- **Observador.** El `onError` del runtime recibe el error, un ID y `{ kind, inRequest }` (tipo `ServerErrorInfo`); los fallos de una petición no llevan ese tercer argumento. Sin `onError`, Meeko escribe en la consola el error completo, como haría el runtime. `processErrors: false` desactiva los dos casos.
- **`requestId`.** Si el fallo ocurre en el trabajo asíncrono de una petición y el runtime conserva ese contexto hasta el evento, el ID es el de la respuesta (`x-request-id`) e `inRequest` es `true`; si no, el ID es nuevo. Node conserva el contexto para rechazos y excepciones; Deno y workerd, para los rechazos; Bun 1.4, sólo para las excepciones.
- **Listeners de la aplicación.** Si la aplicación registró sus propios `process.on("uncaughtException" | "unhandledRejection")` (o, en Deno, marcó el evento con `preventDefault()` antes), Meeko informa a `onError` y deja que ella decida: no cierra el proceso.
- **Por runtime.** Node y Bun usan los eventos de `process`; Deno, `unhandledrejection` y `error` de `globalThis`. En Cloudflare Workers no hay proceso que cerrar: los rechazos sin manejar del aislado llegan a `onError` y una excepción hace fallar sólo la petición o la tarea de `waitUntil` que la lanzó, que Meeko ya informa. En `meeko dev`, un rechazo de la aplicación no detiene el servidor de desarrollo; la política es la del runtime con el que arrancó.
- **Hosts propios.** `handleProcessErrors(app, { close, onError?, shutdownTimeout? })` de `@meekojs/meeko/server` aplica la misma política a un host que no usa `serveNode` ni `serveDeno`, como `Bun.serve` con `createBunServer`; devuelve la función que retira los listeners. `close` debe detener el servidor y cerrar la aplicación; `shutdownTimeout` (15 s por defecto) limita su duración antes de salir igualmente. Desde `1.7` se instala una sola vez por aplicación: una segunda llamada (por ejemplo, la propia junto a `serveNode` con `handleSignals`) no añade listeners y, si sus opciones son distintas, se ignoran con un aviso en la consola.
