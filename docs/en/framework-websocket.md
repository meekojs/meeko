---
source-hash: 6a1c9d81f93468ec3eb728bfb09a0bc6fa77f271d4712f2d465b41b7f9f287ec
---

# Use WebSocket

This guide expands [the framework overview](framework.md).

## WebSocket

`server/socket/chat.ts` exports a `defineSocketChannel` with separate schemas for each direction. Schemas exposed to the client must come from `shared/`. The generator emits a public contract without importing private handlers. Each event is declared as `evento: schema` or, since `1.2`, with the shorthand `{ kitchenChanged }` when the imported schema has the same name as the event; the same applies to `defineApiRoute` and `defineRpc` fields (`{ body, response }`).

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
// Inside <script lang="ts"> in app/pages/chat/index.meeko
const chat = typeof window === 'undefined' ? undefined : useSocket('chat', { roomId: 'general' })
const unsubscribe = chat?.on('message', (message) => console.log(message.text))
const send = async () => chat?.emit('message', { text: 'Hello', roomId: 'general' })
```

Through `1.6`, `useSocket` without `await` could only be called in the browser (it threw during SSR), hence the `window` check; since `1.7`, during SSR it returns an inert client that stays in `"connecting"` (its `on` registers nothing and its `emit` rejects), so the check is no longer needed. Since `1.1`, top-level `await useSocket(...)` goes further: setup splits at that point and the rest runs only in the browser, after the component mounts and with the socket already open (`"open"` state). The template can only use names declared before the `await` (`MEEK057`), and if the socket never opens, the continuation keeps waiting (see [api.md](api.md#top-level-composables-and-await)):

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

The signature and contract of `useSocket` without `await` do not change. `socket.chat.on(...)` and `socket.chat.emit(...)` offer an alternative typed registry. The registry opens connections only when you access the channel in the browser. Within `mountClientApp`, each application keeps its own connection per channel and closes it on unmount; listeners registered during setup unsubscribe when their root is disposed. Outside a mounted application, the registry keeps its shared client and the caller must dispose of its listeners. `useSocket` requires a component root and disposes of its connection on unmount. No connections open during SSR. In the browser, neither the render that produces a component's HTML before mounting it (under an `if:` or when committing navigation) nor dry runs open connections: there, `useSocket` and `socket.x` return a client that stays in `"connecting"`, whose `emit` rejects, and mounting opens the connection once. The client uses native WebSocket, reconnection with configurable backoff and at-most-once delivery: `emit` rejects while disconnected, with no queue or retries. Invalid incoming messages close the channel; a transport error is reported once per active connection and errors from replaced connections are ignored. A failing listener or `state` observer is reported without preventing other listeners from running or escaping the transport callback. The low-level client accepts `onError(error)` to observe these failures; without an application or component callback, it logs them to the console.
The `socket` registry is application-scoped: cancel listeners with the function returned by `on` and close the channel when you no longer need it.

**Authentication or authorization rejection.** Since `1.1`, when the server rejects the session, the client does not retry: its `state` enters the terminal `"unauthorized"` state, it stops listening and the error observer receives a `ClientError` with `status` `401` (code `UNAUTHENTICATED`) or `403` (`FORBIDDEN`), rather than a generic transport error. It detects this from close codes `4401` and `4403`, the hub's policy code (`1008`, with reason `Unauthorized`, `Session expired` or `Session revoked`) and a handshake rejected with `401` or `403` when the `WebSocket` implementation exposes the HTTP status, such as Node's `ws` package through `webSocketFactory`. `close()` moves an `"unauthorized"` client to `"closed"`; to retry, create another client (in a component, by mounting it again).

**Handshake closes `4401` and `4403`.** The browser's `WebSocket` (and Node's global one) does not expose the HTTP status of a rejected handshake, so since `1.1` Meeko adapters do not respond with `401` or `403` to session or channel authorization rejection. If the hub's precheck rejects the session (an `auth: "required"` channel without a session, `401`) or authorization (`authorize` returns `false`, `403`), the server accepts the upgrade and immediately closes with `4401` (reason `Autenticación requerida`, meaning authentication required) or `4403` (`Acceso denegado`, meaning access denied). It calls no handler and delivers no messages, and the reason is fixed text without session data. The client thus reaches `"unauthorized"` in the browser too, without retrying. Because the upgrade completes, `state` can briefly pass through `"open"` before closing, and an `emit` made at that moment is discarded. A hub reauthorizing an already accepted connection, such as a room's Durable Object on wakeup, closes with `4401` or `4403` in the same way.

Other handshake rejections keep their HTTP response, which the browser sees as a network failure and retries with backoff: an invalid channel name, method or non-upgrade request (`400`), nonexistent channel (`404`), limits (such as `431` on Cloudflare) and a disallowed Origin (`403` `INVALID_ORIGIN`). Origin is a request policy, rather than channel authorization: a foreign origin never completes an upgrade or reaches the session check, so it cannot distinguish `4401` from `4403` either.

`serveNode` connects `attachNodeWebSocketServer` to the same HTTP server when the application declares channels. The Node adapter uses `ws` for framing and upgrades; Bun uses `Bun.serve`'s native WebSocket and Deno uses `Deno.upgradeWebSocket` (see their limitations under [Bun](framework-deployment.md#bun) and [Deno](framework-deployment.md#deno)), and Cloudflare Workers hosts each room in a Durable Object with hibernation (see [Cloudflare Workers](framework-deployment.md#cloudflare-workers)). They all share `createSocketUpgradeHandler`, which checks the route, Origin and session before upgrading and returns `{ action: "reject", status, close }` for session or authorization rejections. A custom adapter that handles `close` upgrades and closes with `close.code` and `close.reason`; one written for `1.0`, which ignores it, still responds with `status`. The existing hub validates Origin, session, channel, room, event and payload; it applies message/buffer limits, heartbeat and graceful shutdown. Behind a proxy, the same `publicOrigin` from `server/runtime.ts` or `MEEKO_PUBLIC_ORIGIN` governs HTTP and Socket Origin checks.

### Clients with explicit URLs and contracts

The `useSocket("canal", opciones)` auto-import covers the application's own channels. For another URL or a custom contract, `@meekojs/meeko/framework` offers two functions with the signature `(url, contract, options)`:

- `useSocketClient` (since `1.1`) binds the client to the current component root, just like the auto-import: it does not connect during SSR (since `1.7` it returns an inert client there; through `1.6` it threw) or during a render that only produces HTML, uses the nearest error observer and closes the connection on unmount. It supports top-level `await useSocketClient(...)` in `<script>`.
- `createSocketClient` creates an independent client, including outside a component; the caller closes it with `close()`.

```ts
import { useSocketClient } from '@meekojs/meeko/framework'

// Inside <script lang="ts"> in a component
const feed = await useSocketClient('wss://feed.example.com/_meeko/socket/prices', pricesContract)
feed.on('price', (price) => console.log(price.symbol, price.value))
```

Through `1.0` this function was exported as `useSocket` from `@meekojs/meeko/framework`, with the same name as the generated auto-import and a different signature. That export remains available as a deprecated alias of `useSocketClient` (the same function) throughout 1.x and will be removed in `2.0`. The generated clients' `useSocket("canal")` auto-import is not deprecated. In a project without generated clients, the `useSocket` auto-import resolves to `useSocketClient`.

### Broadcast from the server

Since `1.2`, the `socket` auto-import in server code (API, RPC, `<script server>`, middleware and Socket handlers) adds `broadcast(roomId, event, payload)` to each channel, typed with the channel's generated contract. It replaces manually publishing to the runtime's `SocketPubSub`, which does not check the event or payload:

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

- **The same checks as `hub.broadcast`.** The hub validates against the channel definition: an event missing from `serverToClient` rejects with `UNKNOWN_SOCKET_EVENT` (404), a payload that fails its schema with `INVALID_SOCKET_PAYLOAD` (400), and a serialized message larger than `socket.maxMessageBytes` with `SOCKET_LIMIT_EXCEEDED` (413), always before publishing. It resolves when the broker accepts the message; see [Broadcast and multiple instances](#broadcast-and-multiple-instances). Inside an API or RPC handler, an uncaught rejection becomes the error response, with that code and status.
- **Room.** `roomId` is the room from `?room=`; connections without a room use `""`.
- **Which hub.** `broadcast` publishes to the hub of the application handling the current HTTP request, including its asynchronous work (such as `platform.waitUntil` or a timer started in the request), or to the current Socket handler's hub. It works the same in Node, Bun, Deno and Cloudflare Workers, where the broker is each room's Durable Object.
- **Outside a request.** A task that starts at startup, outside any request, has no current application and `broadcast` throws. Create a registry with an explicit hub: `createServerSocketRegistry(socketContracts, { hub: () => app.socket?.hub })` from `@meekojs/meeko/server`, or use `app.socket.hub.broadcast(canal, sala, evento, payload)` without types.
- **Server only.** In the browser, `socket.<canal>` remains the WebSocket client and has no `broadcast`. On the server, `on`, `emit`, `state` and `close` on `socket.<canal>` throw, because there is no connection during SSR. Through `1.1`, simply reading `socket.<canal>` on the server already threw that error.

### Broadcast and multiple instances

`hub.broadcast(channel, room, event, payload)` validates the event and payload, and resolves when the broker accepts the message. It does not wait for delivery to peers or report their failures to the sender. It only rejects if the event does not exist, the payload fails its schema, the message is too large or the broker does not accept the publication.

- **`broadcast` rejects oversized messages.** The message is measured after serialization with `serializeJson`, which writes `<`, `>` and `&` as 6-byte sequences; if it exceeds the hub's `maxMessageBytes` (64 KiB by default), `broadcast` rejects with `SOCKET_LIMIT_EXCEEDED` (413) before publishing and no peer closes. Thus, a client message of about 11 KB full of `<` cannot be forwarded as is. A receiver with a lower `maxMessageBytes` than the sender still closes its peer with `1009`.
- **At-most-once delivery per peer.** There are no retries: a message published while an instance is disconnected from the broker is lost. Each peer receives messages from an instance in arrival order.
- **Bounded queue per peer.** Deliveries to a peer are processed one at a time. If a peer accumulates more than `maxPendingDeliveries` pending deliveries (256 by default, including the one in progress), it closes with `1013` ("try again later") and the `SOCKET_BACKLOG_EXCEEDED` (503) error reaches `onDeliveryError`, rather than allowing memory to grow without bounds.
- **Receiver checks.** Each receiving instance revalidates the payload against the schema and runs `authorize` and `authorizeSend` before sending to each local peer. The session is not reread on every delivery: revocation immediately closes the peer through `SessionHandle.signal`, and other changes (expiration, rotation or deletion without notification) are detected when rereading the store, at most once every `sessionRefreshMs` per peer (1000 ms by default; `0` rereads on every delivery). Every client event always rereads the session.
- **`authorizeSend` filters.** If it returns `false`, that peer does not receive the broadcast and stays connected. In a direct `emit`, the same rejection throws `FORBIDDEN`.
- **A failing peer closes.** Failures include an expired session, rejected `authorize`, size limit, full queue or send error. The peer closes with `1008` (policy failure), `1009` (size), `1013` (full queue) or `1011` (internal error) and unsubscribes. The error reaches `SocketHubOptions.onDeliveryError(error, { channel, room, event })` on the instance holding that peer. A payload that fails the receiver's schema is discarded and reported without closing the peer.
- **Default observer.** `createServerApp` forwards `onDeliveryError` to the runtime's `onError` with a new ID; `socket.onDeliveryError` in `server/runtime.ts` replaces it. Without an observer, the hub uses `console.error`.

`LocalSocketPubSub` covers a single instance, and its `publish` also waits for local delivery attempts. Since `1.7`, a production application with channels that does not declare `socket.pubsub` warns once that it uses this broker; for a single instance, declare `new LocalSocketPubSub()` to remove the warning. For multiple instances or processes, use `RedisSocketPubSub`:

```ts
// server/runtime.ts
import { createClient } from 'redis'
import { defineServerRuntime, RedisSessionStore, RedisSocketPubSub, SessionManager } from '@meekojs/meeko/server'

export default defineServerRuntime(async ({ env, production, prerendering }) => {
	const redis = createClient({ url: env.MEEKO_REDIS_URL })
	await redis.connect()
	const subscriber = redis.duplicate() // dedicated connection in subscriber mode
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

- **Clients.** `publisher` and `subscriber` follow the node-redis 4 or later interface (`publish`, `subscribe(channel, listener)`, `unsubscribe(channel, listener)`); the subscriber needs its own connection. The application opens and closes both clients.
- **Redis channels.** Each channel/room pair uses the Redis channel `<prefix>socket:<canal>:<sala>`, with the channel and room encoded using `encodeURIComponent`. Each instance subscribes only once per room while it has local peers there and unsubscribes when the last one leaves. `hub.accept` resolves when Redis confirms the subscription.
- **Format.** The message travels as `{ v: 1, event, payload }`, serialized with `serializeJson`. `publish` rejects messages larger than `maxMessageBytes` (1 MiB by default) with `SOCKET_LIMIT_EXCEEDED` (413) before sending them to Redis. The receiver discards malformed messages or messages with another version and reports them to `RedisSocketPubSub`'s `onError` (by default, `console.error`).
- **Redis Cluster.** With Redis 7 or later, `sharded: true` uses `SPUBLISH`/`SSUBSCRIBE`/`SUNSUBSCRIBE`, which keep each room within its shard in a cluster. Clients must provide `sPublish`, `sSubscribe` and `sUnsubscribe`.

A custom `SocketPubSub` implementation must meet the same contract:

- `publish(channel, room, { event, payload })` resolves when the broker accepts the message.
- `subscribe(channel, room, listener)` returns, or promises, an `Unsubscribe` function that may be asynchronous.
- Hub listeners never reject, so the broker must not aggregate their errors.
