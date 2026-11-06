# Usar WebSocket

Esta guía desarrolla [la visión general del framework](framework.md).

## WebSocket

`server/socket/chat.ts` exporta un `defineSocketChannel` con schemas separados para cada dirección. Los schemas expuestos al cliente deben venir de `shared/`. El generador emite un contrato público sin importar handlers privados. Cada evento se declara como `evento: schema` o, desde `1.2`, con la forma abreviada `{ kitchenChanged }` cuando el schema importado se llama como el evento; lo mismo vale para los campos de `defineApiRoute` y `defineRpc` (`{ body, response }`).

```ts
// server/socket/chat.ts
import { defineSocketChannel } from '@meekojs/meeko/server'
import { chatInput, chatMessage } from '../../shared/schemas/chat.js'

export default defineSocketChannel({
	clientToServer: { message: chatInput },
	serverToClient: { message: chatMessage },
	auth: 'required',
	authorize: ({ context, roomId }) => !!context.session.current && roomId === 'general',
	handlers: { message: async ({ payload, emit }) => emit('message', payload) },
})
```

```ts
// Dentro de <script lang="ts"> de app/pages/chat/index.meeko
const chat = typeof window === 'undefined' ? undefined : useSocket('chat', { roomId: 'general' })
const unsubscribe = chat?.on('message', (message) => console.log(message.text))
const send = async () => chat?.emit('message', { text: 'Hola', roomId: 'general' })
```

Hasta `1.6`, `useSocket` sin `await` sólo podía llamarse en el navegador (en SSR lanzaba un error), de ahí la comprobación de `window`; desde `1.7`, en SSR devuelve un cliente inerte que se queda en `"connecting"` (su `on` no registra nada y su `emit` rechaza), y la comprobación ya no hace falta. Desde `1.1`, `await useSocket(...)` en el nivel superior va más allá: el setup se divide en ese punto y el resto se ejecuta sólo en el navegador, tras montar el componente y con el socket ya abierto (estado `"open"`). La plantilla sólo puede usar los nombres declarados antes del `await` (`MEEK057`), y si el socket no llega a abrirse, la continuación sigue esperando (véase [api.md](api.md#composables-de-nivel-superior-y-await)):

```html
<script lang="ts">
	const messages = signal<string[]>([])
	const chat = await useSocket('chat', { roomId: 'general' })
	chat.on('message', (message) => {
		messages.value = [...messages.value, message.text]
	})
</script>
<template>
	<p
		each:of="messages.value"
		each:as="text"
	>
		{text}
	</p>
</template>
```

La firma y el contrato de `useSocket` sin `await` no cambian. `socket.chat.on(...)` y `socket.chat.emit(...)` ofrecen un registro tipado alternativo. El registro abre conexiones sólo al acceder al canal en navegador. Dentro de `mountClientApp`, cada aplicación conserva su propia conexión por canal y la cierra al desmontarse; los listeners registrados durante el setup se desuscriben al liberar su raíz. Fuera de una aplicación montada, el registro conserva su cliente compartido y el llamador debe liberar sus listeners. `useSocket` requiere una raíz de componente y libera su conexión al desmontar. Durante SSR no se abre ninguna conexión. En el navegador tampoco la abren el render que produce el HTML de un componente antes de montarlo (bajo un `if:` o al confirmar una navegación) ni las pasadas en seco: ahí `useSocket` y `socket.x` devuelven un cliente que se queda en `"connecting"`, cuyo `emit` rechaza, y la conexión la abre el montaje, una sola vez. El cliente usa WebSocket nativo, reconexión con retroceso configurable y entrega a lo sumo una vez: `emit` rechaza si está desconectado, sin cola ni reenvío. Los mensajes entrantes inválidos cierran el canal; un error del transporte se informa una vez por conexión activa y los errores de conexiones reemplazadas se ignoran. Un listener u observador de `state` que falle se informa sin impedir la ejecución de los demás listeners ni salir del callback del transporte. El cliente de bajo nivel acepta `onError(error)` para observar estos fallos; sin callback de aplicación o componente, los registra en la consola.
El registro `socket` es de alcance de aplicación: cancele listeners con la función que devuelve `on` y cierre el canal cuando ya no se necesite.

**Rechazo de autenticación o autorización.** Desde `1.1`, cuando el servidor rechaza la sesión, el cliente no reintenta: su `state` pasa al estado terminal `"unauthorized"`, deja de escuchar y el observador de errores recibe un `ClientError` con `status` `401` (código `UNAUTHENTICATED`) o `403` (`FORBIDDEN`), no el error genérico del transporte. Lo detecta en los códigos de cierre `4401` y `4403`, en el código de política del hub (`1008`, con el motivo `Unauthorized`, `Session expired` o `Session revoked`) y en un handshake rechazado con `401` o `403` cuando la implementación de `WebSocket` expone el estado HTTP, como el paquete `ws` en Node mediante `webSocketFactory`. `close()` pasa un cliente `"unauthorized"` a `"closed"`; para volver a intentarlo, cree otro cliente (en un componente, al volver a montarlo).

**Cierres `4401` y `4403` del handshake.** El `WebSocket` del navegador (y el global de Node) no expone el estado HTTP de un handshake rechazado, así que desde `1.1` los adaptadores de Meeko no responden con `401` ni `403` a un rechazo de sesión o de autorización del canal. Si la comprobación previa del hub rechaza la sesión (un canal `auth: "required"` sin sesión, `401`) o la autorización (`authorize` devuelve `false`, `403`), el servidor acepta el upgrade y cierra en seguida con `4401` (motivo «Autenticación requerida») o `4403` («Acceso denegado»). No llama a ningún handler ni entrega mensajes, y el motivo es un texto fijo, sin datos de la sesión. El cliente llega así a `"unauthorized"` también en el navegador, sin reintentar. Como el upgrade se completa, `state` puede pasar un instante por `"open"` antes del cierre, y un `emit` hecho en ese momento se descarta. Un hub que vuelve a autorizar una conexión ya aceptada, como el Durable Object de una sala al despertar, cierra del mismo modo con `4401` o `4403`.

Los demás rechazos del handshake mantienen su respuesta HTTP, que el navegador ve como un fallo de red y reintenta con retroceso: nombre de canal inválido, método o petición que no es de upgrade (`400`), canal inexistente (`404`), los límites (como `431` en Cloudflare) y el Origin no permitido (`403` `INVALID_ORIGIN`). El Origin es una política de la petición, no la autorización del canal: un origen ajeno nunca completa un upgrade ni llega a la comprobación de la sesión, de modo que tampoco puede distinguir un `4401` de un `4403`.

`serveNode` conecta `attachNodeWebSocketServer` al mismo servidor HTTP cuando la aplicación declara canales. El adaptador Node usa `ws` para framing y upgrades; Bun usa el WebSocket nativo de `Bun.serve` y Deno `Deno.upgradeWebSocket` (véanse sus límites en [Bun](framework-deployment.md#bun) y [Deno](framework-deployment.md#deno)), y Cloudflare Workers aloja cada sala en un Durable Object con hibernación (véase [Cloudflare Workers](framework-deployment.md#cloudflare-workers)). Todos comparten `createSocketUpgradeHandler`, que comprueba ruta, Origin y sesión antes del upgrade y devuelve `{ action: "reject", status, close }` en los rechazos de sesión o autorización. Un adaptador propio que atiende `close` hace el upgrade y cierra con `close.code` y `close.reason`; uno escrito para `1.0`, que lo ignora, sigue respondiendo `status`. El hub existente valida Origin, sesión, canal, sala, evento y payload; aplica límites de mensaje/buffer, heartbeat y cierre ordenado. Tras un proxy, el mismo `publicOrigin` de `server/runtime.ts` o `MEEKO_PUBLIC_ORIGIN` rige la comprobación de Origin de HTTP y de Socket.

### Clientes con URL y contrato explícitos

El autoimport `useSocket("canal", opciones)` cubre los canales de la propia aplicación. Para otra URL o un contrato propio, `@meekojs/meeko/framework` ofrece dos funciones con la firma `(url, contract, options)`:

- `useSocketClient` (desde `1.1`) liga el cliente a la raíz del componente actual, igual que el autoimport: no conecta en SSR (desde `1.7` devuelve ahí un cliente inerte; hasta `1.6` lanzaba) ni en un render que sólo produce HTML, usa el observador de errores más cercano y cierra la conexión al desmontar. Admite `await useSocketClient(...)` en el nivel superior del `<script>`.
- `createSocketClient` crea un cliente independiente, también fuera de un componente; el llamador lo cierra con `close()`.

```ts
import { useSocketClient } from '@meekojs/meeko/framework'

// Dentro de <script lang="ts"> de un componente
const feed = await useSocketClient('wss://feed.example.com/_meeko/socket/prices', pricesContract)
feed.on('price', (price) => console.log(price.symbol, price.value))
```

Hasta `1.0` esta función se exportaba como `useSocket` desde `@meekojs/meeko/framework`, con el mismo nombre que el autoimport generado y otra firma. Ese export sigue disponible como alias obsoleto de `useSocketClient` (es la misma función) durante toda la serie 1.x y se retirará en `2.0`. El autoimport `useSocket("canal")` de los clientes generados no está obsoleto. En un proyecto sin clientes generados, el autoimport `useSocket` resuelve a `useSocketClient`.

### Broadcast desde el servidor

Desde `1.2`, el autoimport `socket` del código de servidor (API, RPC, `<script server>`, middleware y handlers de Socket) añade a cada canal `broadcast(roomId, event, payload)`, tipado con el contrato generado del canal. Sustituye a publicar a mano en el `SocketPubSub` del runtime, que no comprueba el evento ni el payload:

```ts
// server/socket/operations.ts
import { defineSocketChannel } from '@meekojs/meeko/server'
import { kitchenChanged, subscribe } from '../../shared/schemas/operations.js'

export default defineSocketChannel({
	clientToServer: { subscribe },
	serverToClient: { kitchenChanged },
})
```

```ts
// server/api/orders/[id]/ready.post.ts
import { defineApiRoute } from '@meekojs/meeko/server'
import { orderParams, orderSchema } from '../../../../shared/schemas/order.js'
import { markReady } from '../../../utils/orders.js'

export default defineApiRoute({
	params: orderParams,
	response: orderSchema,
	handler: async ({ params }) => {
		const order = await markReady(params.id)
		await socket.operations.broadcast(order.storeId, 'kitchenChanged', { orderId: order.id, status: 'ready' })
		return order
	},
})
```

- **Mismas comprobaciones que `hub.broadcast`.** El hub valida con la definición del canal: un evento que no está en `serverToClient` rechaza con `UNKNOWN_SOCKET_EVENT` (404), un payload que no cumple su schema con `INVALID_SOCKET_PAYLOAD` (400) y un mensaje serializado mayor que `socket.maxMessageBytes` con `SOCKET_LIMIT_EXCEEDED` (413), siempre antes de publicar. Se resuelve cuando el broker acepta el mensaje; véase [Broadcast y varias instancias](#broadcast-y-varias-instancias). Dentro de un handler de API o RPC, un rechazo no capturado es la respuesta de error, con ese código y estado.
- **Sala.** `roomId` es la sala de `?room=`; las conexiones sin sala usan `""`.
- **Qué hub.** `broadcast` publica en el hub de la aplicación que atiende la petición HTTP en curso, también desde su trabajo asíncrono (como `platform.waitUntil` o un temporizador iniciado en la petición), o en el hub del handler de Socket en curso. Funciona igual en Node, Bun, Deno y Cloudflare Workers, donde el broker es el Durable Object de cada sala.
- **Fuera de una petición.** Una tarea que empieza al arrancar, fuera de cualquier petición, no tiene aplicación actual y `broadcast` lanza un error. Cree un registro con el hub explícito: `createServerSocketRegistry(socketContracts, { hub: () => app.socket?.hub })` de `@meekojs/meeko/server`, o use `app.socket.hub.broadcast(canal, sala, evento, payload)` sin tipos.
- **Sólo servidor.** En el navegador `socket.<canal>` sigue siendo el cliente WebSocket y no tiene `broadcast`. En el servidor, `on`, `emit`, `state` y `close` de `socket.<canal>` lanzan un error, porque durante SSR no hay conexión. Hasta `1.1`, leer `socket.<canal>` en el servidor ya lanzaba ese error.

### Broadcast y varias instancias

`hub.broadcast(channel, room, event, payload)` valida el evento y el payload, y se resuelve cuando el broker acepta el mensaje. No espera a que lleguen a los peers ni informa de sus fallos al emisor. Sólo rechaza si el evento no existe, el payload no cumple su schema, el mensaje es demasiado grande o el broker no acepta la publicación.

- **`broadcast` rechaza por tamaño.** El mensaje se mide ya serializado con `serializeJson`, que escribe `<`, `>` y `&` como secuencias de 6 bytes; si supera `maxMessageBytes` del hub (64 KiB por defecto), `broadcast` rechaza con `SOCKET_LIMIT_EXCEEDED` (413) antes de publicar y ningún peer se cierra. Así, un mensaje de cliente de unos 11 KB lleno de `<` no puede reenviarse tal cual. Un receptor con un `maxMessageBytes` menor que el del emisor sigue cerrando su peer con `1009`.
- **Entrega a lo sumo una vez por peer.** No hay reenvío: un mensaje publicado mientras una instancia está desconectada del broker se pierde. Cada peer recibe los mensajes de una instancia en el orden de llegada.
- **Cola acotada por peer.** Las entregas a un peer se procesan de una en una. Si un peer acumula más de `maxPendingDeliveries` entregas pendientes (256 por defecto, contando la que está en curso), se cierra con `1013` ("try again later") y el error `SOCKET_BACKLOG_EXCEEDED` (503) llega a `onDeliveryError`, en lugar de crecer la memoria sin límite.
- **Comprobaciones en el receptor.** Cada instancia receptora vuelve a validar el payload con el schema y ejecuta `authorize` y `authorizeSend` antes de enviar a cada peer local. La sesión no se relee en cada entrega: una revocación cierra el peer de inmediato mediante `SessionHandle.signal`, y el resto de cambios (caducidad, rotación o un borrado sin aviso) se detecta al releer el store, como mucho una vez cada `sessionRefreshMs` por peer (1000 ms por defecto; `0` relee en cada entrega). Cada evento del cliente relee siempre la sesión.
- **`authorizeSend` filtra.** Si devuelve `false`, ese peer no recibe el broadcast y sigue conectado. En un `emit` directo, el mismo rechazo lanza `FORBIDDEN`.
- **Un peer que falla se cierra.** Puede fallar por sesión caducada, `authorize` rechazado, límite de tamaño, cola llena o error de envío. El peer se cierra con `1008` (fallo de política), `1009` (tamaño), `1013` (cola llena) o `1011` (error interno) y se desuscribe. El error llega a `SocketHubOptions.onDeliveryError(error, { channel, room, event })` de la instancia que tiene ese peer. Un payload que no cumple el schema en el receptor se descarta y se informa sin cerrar al peer.
- **Observador por defecto.** `createServerApp` envía `onDeliveryError` al `onError` del runtime con un ID nuevo; `socket.onDeliveryError` de `server/runtime.ts` lo sustituye. Sin observador, el hub usa `console.error`.

`LocalSocketPubSub` cubre una sola instancia, y su `publish` también espera los intentos de entrega locales. Desde `1.7`, una aplicación de producción con canales que no declara `socket.pubsub` avisa una vez de que usa este broker; con una sola instancia, declare `new LocalSocketPubSub()` para quitar el aviso. Para varias instancias o procesos, use `RedisSocketPubSub`:

```ts
// server/runtime.ts
import { createClient } from 'redis'
import { defineServerRuntime, RedisSessionStore, RedisSocketPubSub, SessionManager } from '@meekojs/meeko/server'

export default defineServerRuntime(async ({ env, production, prerendering }) => {
	const redis = createClient({ url: env.MEEKO_REDIS_URL })
	await redis.connect()
	const subscriber = redis.duplicate() // conexión dedicada en modo suscriptor
	await subscriber.connect()
	return {
		sessions: new SessionManager({ store: new RedisSessionStore(redis, { prefix: 'app:prod:session:', subscriber }), production: production && !prerendering }),
		socket: { pubsub: new RedisSocketPubSub({ publisher: redis, subscriber, prefix: 'app:prod:' }) },
		close: async () => {
			await subscriber.quit()
			await redis.quit()
		},
	}
})
```

- **Clientes.** `publisher` y `subscriber` siguen la interfaz de node-redis 4 o posterior (`publish`, `subscribe(channel, listener)`, `unsubscribe(channel, listener)`); el suscriptor necesita su propia conexión. La aplicación abre y cierra ambos clientes.
- **Canales Redis.** Cada par canal/sala usa el canal `<prefix>socket:<canal>:<sala>`, con canal y sala codificados con `encodeURIComponent`. Cada instancia se suscribe una sola vez por sala mientras tenga peers locales en ella y se desuscribe al irse el último. `hub.accept` se resuelve cuando Redis confirma la suscripción.
- **Formato.** El mensaje viaja como `{ v: 1, event, payload }`, serializado con `serializeJson`. `publish` rechaza con `SOCKET_LIMIT_EXCEEDED` (413) los mensajes de más de `maxMessageBytes` (1 MiB por defecto) antes de enviarlos a Redis. El receptor descarta los mensajes mal formados o con otra versión y los informa a `onError` de `RedisSocketPubSub` (por defecto, `console.error`).
- **Redis Cluster.** Con Redis 7 o posterior, `sharded: true` usa `SPUBLISH`/`SSUBSCRIBE`/`SUNSUBSCRIBE`, que en un clúster mantienen cada sala dentro de su shard. Los clientes deben ofrecer `sPublish`, `sSubscribe` y `sUnsubscribe`.

Una implementación propia de `SocketPubSub` debe cumplir el mismo contrato:

- `publish(channel, room, { event, payload })` se resuelve cuando el broker acepta el mensaje.
- `subscribe(channel, room, listener)` devuelve, o promete, una función `Unsubscribe` que puede ser asíncrona.
- Los listeners del hub nunca rechazan, así que el broker no debe agregar sus errores.
