/**
 * Hosts y orígenes adicionales que acepta `meeko dev`: `true` acepta cualquiera, como
 * `server.allowedHosts` de Vite. Cada entrada es un nombre de host (`mi-pc.local`), un sufijo que
 * empieza por `.` (`.ts.net` acepta `ts.net` y sus subdominios) o un origen completo
 * (`https://app.example.com:8443`).
 *
 * @since 1.10.0
 * @example
 * ```ts
 * import type { DevAllowedHosts } from "@meekojs/meeko/framework";
 *
 * const hosts: DevAllowedHosts = ["mi-pc.tailnet.ts.net", ".ngrok-free.app"];
 * ```
 * @see https://github.com/meekojs/meeko/blob/main/docs/reference/config/config-dev.md
 */
export type DevAllowedHosts = readonly string[] | true

/** The variable that adds hosts to `dev.allowedHosts`, separated by commas; `true` accepts any. */
export const allowedHostsEnv = 'MEEKO_ALLOWED_HOSTS'

/** Whether an entry is a full origin (`https://host`) rather than a host name. */
function isOriginEntry(entry: string): boolean {
	return /^[a-z][a-z0-9+.-]*:\/\//i.test(entry)
}

/**
 * Validates one `dev.allowedHosts` entry and returns its canonical form: a lowercase host name or
 * `.suffix`, or a serialized HTTP(S) origin. Returns an error message instead when it is invalid.
 */
export function normalizeDevAllowedHost(entry: unknown): { readonly value: string } | { readonly error: string } {
	if (typeof entry !== 'string' || !entry.trim()) return { error: 'debe ser una cadena no vacía' }
	const value = entry.trim()
	if (isOriginEntry(value)) {
		let url: URL
		try {
			url = new URL(value)
		} catch {
			return { error: `"${value}" no es un origen válido` }
		}
		if (url.protocol !== 'http:' && url.protocol !== 'https:') return { error: `"${value}" debe usar http:// o https://` }
		if (url.pathname !== '/' || url.search || url.hash || url.username || url.password) return { error: `"${value}" debe ser sólo un origen, sin ruta (${url.origin})` }
		return { value: url.origin }
	}
	if (/[\s/:@?#]/.test(value)) return { error: `"${value}" debe ser un nombre de host (sin esquema, puerto ni ruta) o un origen completo como https://${value.replace(/^[^/]*\/\//, '').split(/[/:]/)[0] || 'host'}` }
	return { value: value.toLowerCase() }
}

/**
 * Reads `MEEKO_ALLOWED_HOSTS`: entries separated by commas, or `true` for any host. Empty or
 * missing gives an empty list.
 */
export function parseAllowedHostsEnv(value: string | undefined): DevAllowedHosts {
	const text = value?.trim()
	if (!text) return []
	if (text === 'true') return true
	const entries: string[] = []
	for (const part of text.split(',')) {
		if (!part.trim()) continue
		const result = normalizeDevAllowedHost(part)
		if ('error' in result) throw new TypeError(`${allowedHostsEnv}: ${result.error}`)
		entries.push(result.value)
	}
	return entries
}

/** Joins the lists of `dev.allowedHosts` and `MEEKO_ALLOWED_HOSTS`; `true` in either wins. */
export function mergeDevAllowedHosts(...lists: readonly (DevAllowedHosts | undefined)[]): DevAllowedHosts {
	const merged = new Set<string>()
	for (const list of lists) {
		if (list === true) return true
		for (const entry of list ?? []) {
			const result = normalizeDevAllowedHost(entry)
			if ('value' in result) merged.add(result.value)
		}
	}
	return [...merged]
}

/**
 * The patterns for `server.allowedHosts` of Vite: host names and suffixes as written, and the host
 * name of each origin.
 */
export function viteAllowedHosts(hosts: DevAllowedHosts): true | string[] {
	if (hosts === true) return true
	return [...new Set(hosts.map((entry) => (isOriginEntry(entry) ? new URL(entry).hostname.replace(/^\[|\]$/g, '') : entry)))]
}

/** A dotted IPv4 address; IPv6 arrives in brackets. Without `node:net`, which Workers lack. */
const ipv4 = /^(?:(?:25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)\.){3}(?:25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)$/

/** Whether a host name matches a pattern of Vite's `allowedHosts`: exact, or `.suffix`. */
function hostMatches(hostname: string, pattern: string): boolean {
	const name = hostname.toLowerCase()
	const rule = pattern.toLowerCase()
	if (rule === name) return true
	return rule.startsWith('.') && (rule.slice(1) === name || name.endsWith(rule))
}

/**
 * The host name of a `Host` header, or `undefined` for a header Vite always accepts (missing, an
 * IP address, `localhost` or `*.localhost`). Mirrors Vite's host validation.
 */
export function restrictedHostName(hostHeader: string | undefined): string | undefined {
	if (hostHeader === undefined) return undefined
	const host = hostHeader.trim()
	if (host.startsWith('[')) return undefined
	const colon = host.indexOf(':')
	const hostname = (colon === -1 ? host : host.slice(0, colon)).toLowerCase()
	if (ipv4.test(hostname) || hostname === 'localhost' || hostname.endsWith('.localhost')) return undefined
	return hostname
}

/**
 * Whether `meeko dev` serves a request with this `Host` header, with the same rules as Vite's
 * `server.allowedHosts`: IP addresses, `localhost` and `*.localhost` always pass.
 */
export function isDevHostAllowed(hostHeader: string | undefined, allowed: true | readonly string[]): boolean {
	if (allowed === true) return true
	const hostname = restrictedHostName(hostHeader)
	return hostname === undefined || allowed.some((pattern) => hostMatches(hostname, pattern))
}

/** The 403 text of a request whose host `meeko dev` does not serve. */
export function blockedDevHostMessage(hostname: string): string {
	return `[meeko] meeko dev bloqueó una petición con el host ${JSON.stringify(hostname)}. Para abrir meeko dev desde ese host (un proxy, un túnel o un nombre de la red local), añádalo a dev.allowedHosts en meeko.config.ts (dev: { allowedHosts: [${JSON.stringify(hostname)}] }) o a la variable ${allowedHostsEnv}. Sólo afecta a meeko dev.`
}

/**
 * Whether `meeko dev` accepts this `Origin` beyond the application's own and
 * `SessionManager.allowedOrigins`: an origin listed in full, or an `http:` or `https:` origin
 * whose host name matches a host entry. With `true`, an origin whose host (name and port) is the
 * request's own, whatever its scheme: a proxy that terminates TLS forwards `https://host` to
 * `http://host`.
 */
export function isDevOriginAllowed(origin: string, requestUrl: string, hosts: DevAllowedHosts): boolean {
	let url: URL
	try {
		url = new URL(origin)
	} catch {
		return false
	}
	if ((url.protocol !== 'http:' && url.protocol !== 'https:') || url.origin !== origin) return false
	if (hosts === true) return url.host === new URL(requestUrl).host
	const hostname = url.hostname.replace(/^\[|\]$/g, '')
	return hosts.some((entry) => (isOriginEntry(entry) ? entry === origin : hostMatches(hostname, entry)))
}

/** The warning of an Origin that `meeko dev` refused, with the option that allows it. */
export function rejectedDevOriginMessage(origin: string | null): string {
	if (origin === null) {
		return '[meeko] meeko dev rechazó una mutación sin cabecera Origin (403 INVALID_ORIGIN). Los navegadores la envían; un script debe enviar Origin, o la ruta declarar origin: "none".'
	}
	let host = origin
	try {
		host = new URL(origin).hostname
	} catch {
		/* keeps the raw value */
	}
	return `[meeko] meeko dev rechazó una petición con Origin ${JSON.stringify(origin)} (403 INVALID_ORIGIN). Si abre la aplicación a través de un proxy o un túnel, añada ${JSON.stringify(host)} a dev.allowedHosts en meeko.config.ts o a la variable ${allowedHostsEnv}; para otro sitio, use allowedOrigins de SessionManager. Sólo afecta a meeko dev.`
}
