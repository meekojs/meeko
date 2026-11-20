/**
 * Data keys and invalidation: the identity of what a read loads and what a write changes.
 *
 * A read (`useApi`, `useRpcQuery`, a page loader) depends on keys; a write (`defineRpc`,
 * `defineApiRoute`) declares the keys it changed and the server sends them back in the
 * `x-meeko-invalidate` header of a successful response. The transport (`api.*`, `rpc.*` and the
 * composables built on them) hands that header to this module, which refreshes every mounted
 * dependent whose keys match, once per batch. Keys are hierarchical by dots: `orders` matches
 * `orders`, `orders.list` and `orders.42`, never `ordersArchive`.
 *
 * Only mounted browser code registers dependents: on the server the registry stays empty, so an
 * invalidation there settles at once.
 */
import type { DataKey } from '../framework'

/** Response header with the keys that a successful write invalidated. */
export const INVALIDATE_HEADER = 'x-meeko-invalidate'

/** At most this many keys travel in one response: a longer list is a mistake, not a use. */
const maxKeys = 64
const maxKeyLength = 200

/**
 * Checks one key: a non-empty string of at most 200 characters without control characters, and
 * no empty segment between dots (`orders..list`, `.orders`).
 */
export function checkDataKey(key: unknown, label: string): string {
	if (typeof key !== 'string' || key.length === 0 || key.length > maxKeyLength || /[\u0000-\u001f\u007f]/.test(key) || key.split('.').includes('')) {
		throw new TypeError(`${label}: a data key must be a non-empty string of at most ${maxKeyLength} characters, with dots only between segments, such as "orders" or "orders.42"; got ${JSON.stringify(key)}`)
	}
	return key
}

/**
 * The key by convention of an API path: its static segments after `/api`, joined by dots
 * (`/api/orders/[id]/items` is `orders.items`; a dot inside a segment becomes `-`), or `api` when
 * it has none. The key of an RPC procedure is its ID (`orders.list`).
 */
export function apiDataKey(pathname: string): string {
	const segments = pathname
		.split('/')
		.filter((segment) => segment && !segment.startsWith('['))
		.map((segment) => segment.replaceAll('.', '-'))
	if (segments[0] === 'api' && segments.length > 1) segments.shift()
	return checkDataKey(segments.join('.') || 'api', 'useApi')
}

/** A key and every key above it: `orders.list` gives `orders` and `orders.list`. */
export function dataKeyPrefixes(key: string): string[] {
	const parts = key.split('.')
	return parts.map((_part, index) => parts.slice(0, index + 1).join('.'))
}

/** Checks a list of keys, such as `invalidates` or `keys`. */
export function checkDataKeys(keys: unknown, label: string): readonly string[] {
	if (!Array.isArray(keys)) throw new TypeError(`${label}: expected an array of data keys, such as ["orders"]`)
	return keys.map((key) => checkDataKey(key, label))
}

/** The header value: each key percent-encoded, so any key travels, joined by commas. */
export function formatInvalidation(keys: Iterable<string>): string | undefined {
	const list = [...new Set(keys)].slice(0, maxKeys)
	return list.length ? list.map((key) => encodeURIComponent(key)).join(', ') : undefined
}

/** The keys of a header value; what cannot be read is left out. */
export function parseInvalidation(header: string | null | undefined): string[] {
	if (!header) return []
	const keys = new Set<string>()
	for (const part of header.split(',')) {
		const trimmed = part.trim()
		if (!trimmed) continue
		try {
			keys.add(checkDataKey(decodeURIComponent(trimmed), 'x-meeko-invalidate'))
		} catch {
			/* A malformed key from a proxy or another server is not this application's. */
		}
		if (keys.size >= maxKeys) break
	}
	return [...keys]
}

/** Whether invalidating `changed` refreshes a read that depends on `read`. */
export function keyMatches(changed: string, read: string): boolean {
	return read === changed || (read.length > changed.length && read.startsWith(changed) && read[changed.length] === '.')
}

/** What refreshes when its keys are invalidated: a mounted resource or the current route. */
export interface DataDependent {
	/** The keys it reads now; read when an invalidation arrives. */
	readonly keys: () => readonly string[]
	/** Loads its data again, keeping the previous data meanwhile; never rejects. */
	readonly refresh: () => Promise<unknown>
}

const dependents = new Set<DataDependent>()

/** Registers a dependent until the returned function runs. */
export function registerDataDependent(dependent: DataDependent): () => void {
	dependents.add(dependent)
	return () => {
		dependents.delete(dependent)
	}
}

/** Keys waiting for the next batch, or `true` for everything. */
let queued: Set<string> | true | undefined
let batch: Promise<void> | undefined

function runBatch(): Promise<void> {
	const changed = queued
	queued = undefined
	batch = undefined
	if (!changed) return Promise.resolve()
	const refreshes: Promise<unknown>[] = []
	for (const dependent of [...dependents]) {
		// Released while the batch waited.
		if (!dependents.has(dependent)) continue
		let matches = changed === true
		if (!matches) {
			try {
				const keys = dependent.keys()
				matches = keys.some((read) => [...(changed as Set<string>)].some((key) => keyMatches(key, read)))
			} catch {
				matches = false
			}
		}
		if (matches) refreshes.push(Promise.resolve().then(dependent.refresh))
	}
	return Promise.allSettled(refreshes).then(() => {})
}

/**
 * Queues keys for the next batch. Every invalidation of the same task, such as two mutations that
 * end together, shares one batch: each dependent refreshes once.
 */
function schedule(keys: Set<string> | true): Promise<void> {
	if (dependents.size === 0) return Promise.resolve()
	if (keys === true || queued === true) queued = true
	else {
		queued ??= new Set()
		for (const key of keys) queued.add(key)
	}
	batch ??= new Promise<void>((resolve) => {
		setTimeout(() => resolve(runBatch()), 0)
	})
	return batch
}

/**
 * Invalida claves de datos en el navegador: cada `useApi` y `useRpcQuery` montado cuyas claves
 * coinciden vuelve a pedir sus datos, conservando los anteriores (`refreshing` en `true`), y el
 * loader de la ruta actual se vuelve a ejecutar si declaró una clave que coincide con `depends`. Una
 * clave cubre las que empiezan por ella y un punto: `"orders"` refresca `"orders.list"` y
 * `"orders.42"`. Las invalidaciones de la misma tarea se agrupan y cada dato se recarga una vez. Los
 * recursos sin montar no se piden: al montarse cargan sus datos. En el servidor no hace nada.
 *
 * Una mutación no necesita llamarla: la respuesta correcta de un `defineRpc` o un `defineApiRoute`
 * con `invalidates` ya invalida sus claves. Sirve para cambios que llegan por otra vía, como un
 * mensaje de un socket.
 *
 * @param keys Una o más claves, como `"orders"` u `` `orders.${id}` ``.
 * @returns Una promesa que se cumple cuando terminan las recargas; nunca rechaza (un fallo de una
 * recarga queda en el `error` de su recurso).
 * @throws {TypeError} Sin claves, o con una clave vacía, con un punto al principio o al final, o
 * con caracteres de control.
 * @since 1.10.0
 * @example
 * ```html
 * <script lang="ts">
 * const orders = useApi("/api/orders");
 * const feed = useSocket("orders");
 * feed.on("changed", ({ id }) => invalidate("orders", `orders.${id}`));
 * </script>
 * ```
 * @see https://github.com/meekojs/meeko/blob/main/docs/framework-api.md#claves-de-datos-e-invalidación
 */
export function invalidate(...keys: DataKey[]): Promise<void> {
	if (keys.length === 0) throw new TypeError('invalidate() needs at least one data key, such as invalidate("orders"); useRoute().refresh() reloads all the data of the current route')
	return schedule(new Set(keys.map((key) => checkDataKey(key, 'invalidate'))))
}

/** Refreshes every mounted dependent: `useRoute().refresh()`. */
export function invalidateAll(): Promise<void> {
	return schedule(true)
}

/** Applies the keys of a successful response; `api.*`, `rpc.*` and the composables share it. */
export function applyInvalidation(header: string | null | undefined): Promise<void> {
	const keys = parseInvalidation(header)
	return keys.length ? schedule(new Set(keys)) : Promise.resolve()
}
