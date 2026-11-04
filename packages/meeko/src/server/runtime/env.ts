// Environment variables that Meeko itself reads. Since 1.2 each one is named `MEEKO_<NAME>`.
// `HOST` and `PUBLIC_ORIGIN` keep working through 1.x with a one-time warning and go away in 2.0;
// `PORT` stays a permanent fallback because hosting platforms inject it. Portable: the values
// come from `process.env`, `Deno.env.toObject()` or the Worker bindings.

/** Variables with a name from before `MEEKO_`. */
export type MeekoEnvName = 'HOST' | 'PORT' | 'PUBLIC_ORIGIN'

const permanentFallbacks: ReadonlySet<MeekoEnvName> = new Set(['PORT'])
const warned = new Set<string>()

/** Writes a deprecation warning once per process. */
export function warnOnce(key: string, message: string): void {
	if (warned.has(key)) return
	warned.add(key)
	try {
		console.warn(message)
	} catch {
		/* A broken console cannot stop the server. */
	}
}

/** Forgets the warnings already written; for tests. */
export function resetEnvWarnings(): void {
	warned.clear()
}

/** A nonempty string variable of `env`, which may be `process.env` or the Worker bindings. */
export function envString(env: unknown, name: string): string | undefined {
	if (!env || typeof env !== 'object') return undefined
	let value: unknown
	try {
		value = (env as Record<string, unknown>)[name]
	} catch {
		return undefined
	}
	return typeof value === 'string' && value.trim() !== '' ? value.trim() : undefined
}

/**
 * Reads `MEEKO_<name>`, or the name from before 1.2. `PORT` is a permanent fallback; `HOST` and
 * `PUBLIC_ORIGIN` still work in 1.x and warn once, naming the new variable.
 */
export function meekoEnv(env: unknown, name: MeekoEnvName): string | undefined {
	const value = envString(env, `MEEKO_${name}`)
	if (value !== undefined) return value
	const legacy = envString(env, name)
	if (legacy !== undefined && !permanentFallbacks.has(name)) {
		warnOnce(`env:${name}`, `[meeko] La variable ${name} está obsoleta desde Meeko 1.2; usa MEEKO_${name}. ${name} dejará de leerse en Meeko 2.0.`)
	}
	return legacy
}

const durationUnits: Readonly<Record<string, number>> = { ms: 1, s: 1000, m: 60_000, h: 3_600_000, d: 86_400_000 }

/**
 * Milliseconds of a duration such as `"500ms"`, `"30s"`, `"5m"`, `"12h"` or `"7d"`, or of a
 * positive integer of milliseconds.
 * @throws {RangeError} With `label` when the value is not a positive duration.
 */
export function parseDuration(value: unknown, label: string): number {
	if (typeof value === 'number') {
		if (Number.isSafeInteger(value) && value > 0) return value
	} else if (typeof value === 'string') {
		const match = /^\s*(\d+)\s*(ms|s|m|h|d)\s*$/.exec(value)
		if (match) {
			const result = Number(match[1]) * durationUnits[match[2]!]!
			if (Number.isSafeInteger(result) && result > 0) return result
		}
	}
	throw new RangeError(`${label} must be a positive duration such as "30s", "5m", "12h" or "7d"`)
}

/**
 * How many proxies in front of the server may add `X-Forwarded-For`; `true` trusts all of them.
 * `"cloudflare"` (since 1.8) reads `CF-Connecting-IP` when every hop comes from a trusted network.
 */
export type TrustProxy = boolean | number | 'cloudflare'

const trustCache = new WeakMap<object, TrustProxy>()

/**
 * `MEEKO_TRUST_PROXY`: unset, `false` or `0` trusts no proxy; a positive integer is the number of
 * proxies whose `X-Forwarded-For` entries are trusted; `true` trusts every entry; `cloudflare`
 * reads `CF-Connecting-IP` behind proxies in the networks of `MEEKO_TRUSTED_PROXIES`, which it
 * validates too.
 * @throws {TypeError} When either value is anything else.
 */
export function trustProxyOf(env: unknown): TrustProxy {
	if (env && typeof env === 'object' && trustCache.has(env)) return trustCache.get(env)!
	const raw = envString(env, 'MEEKO_TRUST_PROXY')
	let trust: TrustProxy
	if (raw === undefined || raw === 'false' || raw === '0') trust = false
	else if (raw === 'true') trust = true
	else if (raw.toLowerCase() === 'cloudflare') {
		trust = 'cloudflare'
		trustedNetworksOf(env)
	} else if (/^[1-9]\d{0,1}$/.test(raw)) trust = Number(raw)
	else throw new TypeError(`MEEKO_TRUST_PROXY must be true, false or the number of trusted proxies (1-99), or cloudflare, not ${JSON.stringify(raw)}`)
	// process.env is a live object: only frozen records such as Worker bindings are cached.
	if (env && typeof env === 'object' && Object.isFrozen(env)) trustCache.set(env, trust)
	return trust
}

/** An IPv4 or IPv6 network: its 16-bit groups (two for IPv4, eight for IPv6) and prefix length. */
export interface Network {
	readonly groups: readonly number[]
	readonly prefix: number
}

/** Where `cloudflared` and the proxies in front of the server usually live: loopback and private networks. */
export const defaultTrustedProxies = '127.0.0.0/8, 10.0.0.0/8, 172.16.0.0/12, 192.168.0.0/16, ::1/128, fc00::/7'

/** The 16-bit groups of a normalized address: two for IPv4, eight for IPv6. */
function addressGroups(address: string): number[] | undefined {
	if (!address.includes(':')) {
		const octets = address.split('.').map(Number)
		return [(octets[0]! << 8) | octets[1]!, (octets[2]! << 8) | octets[3]!]
	}
	return expandIpv6(address)
}

/** A CIDR such as `10.0.0.0/8` or `fc00::/7`, or a single address, as a network. */
function parseNetwork(entry: string): Network | undefined {
	const slash = entry.indexOf('/')
	const address = normalizeAddress(slash < 0 ? entry : entry.slice(0, slash))
	if (address === undefined) return undefined
	const groups = addressGroups(address)
	if (!groups) return undefined
	const bits = groups.length * 16
	if (slash < 0) return { groups, prefix: bits }
	const prefix = entry.slice(slash + 1)
	if (!/^\d{1,3}$/.test(prefix) || Number(prefix) > bits) return undefined
	return { groups, prefix: Number(prefix) }
}

function inNetwork(groups: readonly number[], network: Network): boolean {
	if (groups.length !== network.groups.length) return false
	for (let bit = 0; bit < network.prefix; bit += 16) {
		const width = Math.min(16, network.prefix - bit)
		const mask = (0xffff << (16 - width)) & 0xffff
		if ((groups[bit / 16]! & mask) !== (network.groups[bit / 16]! & mask)) return false
	}
	return true
}

const networksCache = new Map<string, readonly Network[]>()

/**
 * The networks of `MEEKO_TRUSTED_PROXIES`, a list of CIDRs or addresses separated by commas or
 * spaces; by default, {@link defaultTrustedProxies}.
 * @throws {TypeError} When an entry is not a CIDR or an address.
 */
export function trustedNetworksOf(env: unknown): readonly Network[] {
	const raw = envString(env, 'MEEKO_TRUSTED_PROXIES') ?? defaultTrustedProxies
	let networks = networksCache.get(raw)
	if (networks) return networks
	const entries = raw.split(/[\s,]+/).filter(Boolean)
	networks = entries.map((entry) => {
		const network = parseNetwork(entry)
		if (!network) throw new TypeError(`MEEKO_TRUSTED_PROXIES must list CIDRs or IP addresses such as 10.0.0.0/8 or fc00::/7, not ${JSON.stringify(entry)}`)
		return network
	})
	if (!networks.length) throw new TypeError('MEEKO_TRUSTED_PROXIES must list at least one CIDR or IP address')
	if (networksCache.size >= 64) networksCache.clear()
	networksCache.set(raw, networks)
	return networks
}

/** Whether a normalized address belongs to one of `networks`. */
export function isTrustedAddress(address: string, networks: readonly Network[]): boolean {
	const groups = addressGroups(address)
	return groups !== undefined && networks.some((network) => inNetwork(groups, network))
}

/** Addresses that the host saw on the connection, attached by each adapter. */
const socketAddresses = new WeakMap<Request, string>()

/** Records the connection address of `request`; adapters call it before `app.fetch`. */
export function setSocketAddress(request: Request, address: string | undefined): Request {
	const normalized = address === undefined ? undefined : normalizeAddress(address)
	if (normalized !== undefined) socketAddresses.set(request, normalized)
	return request
}

/** The environment whose `MEEKO_TRUST_PROXY` applies to a request, recorded by `ServerApp.fetch`. */
const requestEnvironments = new WeakMap<Request, { readonly env: unknown }>()

/** Records the environment (`platform.env`) of the application that serves `request`. */
export function setRequestEnvironment(request: Request, env: unknown): Request {
	requestEnvironments.set(request, { env })
	return request
}

/** The environment recorded for `request`, if a `ServerApp` serves it. */
export function requestEnvironmentOf(request: Request): { readonly env: unknown } | undefined {
	return requestEnvironments.get(request)
}

/**
 * Carries the connection address of `from` over to a copy of the request, such as a rebased one or
 * the one a server middleware passes to `next()`, with the environment of its application. What is
 * already recorded on `to` is kept.
 */
export function copySocketAddress(from: Request, to: Request): Request {
	if (from === to) return to
	const address = socketAddresses.get(from)
	if (address !== undefined && !socketAddresses.has(to)) socketAddresses.set(to, address)
	const environment = requestEnvironments.get(from)
	if (environment !== undefined && !requestEnvironments.has(to)) requestEnvironments.set(to, environment)
	return to
}

/** The connection address recorded by the adapter, if any. */
export function socketAddressOf(request: Request): string | undefined {
	return socketAddresses.get(request)
}

/**
 * An IPv4 or IPv6 address in a stable form: IPv4-mapped IPv6 becomes IPv4, IPv6 is lowercase and
 * loses its zone and brackets. Anything that is not an address yields `undefined`.
 */
export function normalizeAddress(value: string): string | undefined {
	let address = value.trim()
	if (address.startsWith('[')) {
		const end = address.indexOf(']')
		if (end < 0) return undefined
		address = address.slice(1, end)
	}
	const zone = address.indexOf('%')
	if (zone >= 0) address = address.slice(0, zone)
	address = address.toLowerCase()
	const mapped = /^::ffff:(\d{1,3}(?:\.\d{1,3}){3})$/.exec(address)
	if (mapped) address = mapped[1]!
	if (/^\d{1,3}(?:\.\d{1,3}){3}$/.test(address)) return address.split('.').every((part) => Number(part) <= 255) ? address : undefined
	return expandIpv6(address) === undefined ? undefined : address
}

/** The eight 16-bit groups of an IPv6 address, or `undefined`. */
export function expandIpv6(address: string): number[] | undefined {
	if (!/^[0-9a-f:.]+$/.test(address) || address.length > 45) return undefined
	const halves = address.split('::')
	if (halves.length > 2) return undefined
	const groups = (part: string): number[] | undefined => {
		if (part === '') return []
		const result: number[] = []
		for (const group of part.split(':')) {
			if (!/^[0-9a-f]{1,4}$/.test(group)) return undefined
			result.push(parseInt(group, 16))
		}
		return result
	}
	const head = groups(halves[0]!)
	const tail = halves.length === 2 ? groups(halves[1]!) : []
	if (!head || !tail) return undefined
	if (halves.length === 1) return head.length === 8 ? head : undefined
	const missing = 8 - head.length - tail.length
	return missing >= 1 ? [...head, ...new Array<number>(missing).fill(0), ...tail] : undefined
}

/**
 * The address of an `X-Forwarded-For` entry, which some proxies (Azure Application Gateway) write
 * with a port: `1.2.3.4:5678` or `[2001:db8::1]:5678`. Anything else that is not an address yields
 * `undefined`.
 */
export function forwardedAddress(entry: string): string | undefined {
	const value = entry.trim()
	const ipv4WithPort = /^(\d{1,3}(?:\.\d{1,3}){3}):\d{1,5}$/.exec(value)
	if (ipv4WithPort) return normalizeAddress(ipv4WithPort[1]!)
	if (value.startsWith('[')) {
		// `[address]` with an optional `:port`, and nothing else after the bracket.
		const end = value.indexOf(']')
		if (end < 0 || !/^(?::\d{1,5})?$/.test(value.slice(end + 1))) return undefined
	}
	return normalizeAddress(value)
}

/**
 * The client address of a request: the connection address, or with `MEEKO_TRUST_PROXY` the
 * `X-Forwarded-For` entry added by the outermost trusted proxy, without its port, or with
 * `MEEKO_TRUST_PROXY=cloudflare` the `CF-Connecting-IP` that trusted networks relayed.
 * `X-Forwarded-For` is never read without that variable, because any client can send it. An entry
 * that is not an address falls back to the connection address, never to an unknown client.
 */
export function clientAddressOf(request: Request, env: unknown): string | undefined {
	const socket = socketAddresses.get(request)
	const trust = trustProxyOf(env)
	if (trust === false) return socket
	const header = request.headers.get('x-forwarded-for')
	const entries = header
		? header
				.split(',')
				.map((entry) => entry.trim())
				.filter(Boolean)
		: []
	if (trust === 'cloudflare') return cloudflareClientAddress(request, socket, entries, trustedNetworksOf(env))
	if (!entries.length) return socket
	// With n trusted proxies, the nth entry from the right was written by the outermost one.
	const chosen = trust === true ? entries[0]! : entries[Math.max(0, entries.length - trust)]!
	return forwardedAddress(chosen) ?? socket
}

/**
 * The client address behind Cloudflare (`MEEKO_TRUST_PROXY=cloudflare`). Only when the connection
 * and every `X-Forwarded-For` hop come from trusted networks did the request reach the server
 * through Cloudflare's edge, `cloudflared` and private proxies; then `CF-Connecting-IP` (or, if
 * absent, `True-Client-IP`) names the client. Walking `X-Forwarded-For` from the right, the first
 * hop outside those networks is the client a trusted proxy saw: a request sent straight to a
 * public proxy, with a forged `CF-Connecting-IP`, counts as that proxy's peer. A connection from
 * outside, an unknown connection, or a malformed hop or header yields the connection address.
 */
function cloudflareClientAddress(request: Request, socket: string | undefined, entries: readonly string[], networks: readonly Network[]): string | undefined {
	if (socket === undefined || !isTrustedAddress(socket, networks)) return socket
	for (let index = entries.length - 1; index >= 0; index--) {
		const hop = forwardedAddress(entries[index]!)
		if (hop === undefined) return socket
		if (!isTrustedAddress(hop, networks)) return hop
	}
	const header = (request.headers.get('cf-connecting-ip') ?? request.headers.get('true-client-ip'))?.trim()
	// One bare address: both headers carry a single IP, without port, brackets or zone.
	return (header && /^[\d.a-f:]+$/i.test(header) ? normalizeAddress(header) : undefined) ?? socket
}

/** The bucket of an address for rate limits: IPv4 as is, IPv6 by its /64 network. */
export function addressBucket(address: string): string {
	const groups = address.includes(':') ? expandIpv6(address) : undefined
	if (!groups) return address
	return `${groups
		.slice(0, 4)
		.map((group) => group.toString(16))
		.join(':')}::/64`
}
