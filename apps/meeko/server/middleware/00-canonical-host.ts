import { defineServerMiddleware } from '@meekojs/meeko/server'

/** Environment variables that the redirect reads. */
export interface CanonicalHostEnv {
	readonly [name: string]: string | undefined
	/** The public origin of the site, such as `https://meekojs.com`. Unset or empty: no redirect. */
	readonly SITE_CANONICAL_ORIGIN?: string | undefined
	/** Meeko's proxy trust: only with it does `X-Forwarded-Host` replace `Host`. */
	readonly MEEKO_TRUST_PROXY?: string | undefined
}

/**
 * The canonical origin of `SITE_CANONICAL_ORIGIN`, or `undefined` when it is unset or empty.
 * @throws {TypeError} When the value is not an `http:` or `https:` origin without path, query or credentials.
 */
function canonicalOrigin(value: string | undefined): URL | undefined {
	const raw = value?.trim()
	if (!raw) return undefined
	let url: URL
	try {
		url = new URL(raw)
	} catch {
		throw new TypeError(`SITE_CANONICAL_ORIGIN must be an origin such as https://meekojs.com, not ${JSON.stringify(raw)}`)
	}
	const bare = url.pathname === '/' && !url.search && !url.hash && !url.username && !url.password
	if ((url.protocol !== 'https:' && url.protocol !== 'http:') || !bare) {
		throw new TypeError(`SITE_CANONICAL_ORIGIN must be an origin such as https://meekojs.com, not ${JSON.stringify(raw)}`)
	}
	return url
}

/**
 * How many proxies `MEEKO_TRUST_PROXY` trusts, with Meeko's grammar: unset, `false` or `0` none;
 * `true` all; 1-99 that many. Meeko stops at startup on any other value, so here it trusts none.
 */
function trustedProxies(value: string | undefined): boolean | number {
	if (value === 'true') return true
	return value && /^[1-9]\d?$/.test(value) ? Number(value) : false
}

/** The host name of a `Host` value, lowercase and without port or final dot. */
function hostName(value: string): string {
	return value.trim().toLowerCase().replace(/:\d*$/, '').replace(/\.$/, '')
}

/**
 * The host the client asked for: `Host`, or with `MEEKO_TRUST_PROXY` the `X-Forwarded-Host` entry
 * written by the outermost trusted proxy, as Meeko reads `X-Forwarded-For`. Any client can send
 * `X-Forwarded-Host`, so it is never read without that variable.
 */
function requestedHost(request: Request, env: CanonicalHostEnv): string | undefined {
	const trust = trustedProxies(env.MEEKO_TRUST_PROXY)
	if (trust !== false) {
		const entries = (request.headers.get('x-forwarded-host') ?? '')
			.split(',')
			.map((entry) => entry.trim())
			.filter(Boolean)
		const chosen = trust === true ? entries[0] : entries[Math.max(0, entries.length - trust)]
		if (chosen) return hostName(chosen)
	}
	const host = request.headers.get('host')
	return host ? hostName(host) : undefined
}

/**
 * The permanent redirect of `www.<canonical host>` to the canonical origin, with the same path and
 * query, or `undefined` for any other host or without `SITE_CANONICAL_ORIGIN`. It reads the `Host`
 * header, not `request.url`: with `MEEKO_PUBLIC_ORIGIN`, Meeko rebases the URL on that origin.
 * @throws {TypeError} When `SITE_CANONICAL_ORIGIN` is not a valid origin.
 */
export function canonicalHostRedirect(request: Request, env: CanonicalHostEnv): Response | undefined {
	const canonical = canonicalOrigin(env.SITE_CANONICAL_ORIGIN)
	if (!canonical || requestedHost(request, env) !== `www.${canonical.hostname}`) return undefined
	const url = new URL(request.url)
	// Assigned fields keep a `//host/...` path on the canonical origin.
	const target = new URL(canonical.origin)
	target.pathname = url.pathname
	target.search = url.search
	return new Response(null, { status: 301, headers: { location: target.href } })
}

// A mistyped origin stops startup instead of failing every request.
canonicalOrigin(process.env.SITE_CANONICAL_ORIGIN)

/**
 * `www.meekojs.com` → `https://meekojs.com`, before any other middleware. The files of `public/`
 * are served before the middleware and keep answering on `www`; see the README for the Cloudflare
 * rule that redirects everything.
 */
export default defineServerMiddleware((request, next) => canonicalHostRedirect(request, process.env) ?? next(request))
