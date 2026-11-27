// The dashboard only answers requests addressed to a name it knows: a loopback name, or one of
// DASHBOARD_ALLOWED_HOSTS (such as dashboard.meekojs.com in production), separated by commas. A
// page of another site that makes the browser resolve its own domain to the server (DNS rebinding)
// sends that domain as Host and is refused, before any session or login is involved.
//
// In development (`NODE_ENV=development`, which `meeko dev` sets when it is unset) a `*.localhost` name
// also passes: portless gives `meeko dev` names such as `dashboard.meeko.localhost` (`dev.portless`).
// That does not reopen rebinding. The attack needs the victim's browser to send the attacker's own
// name as Host while that name resolves to this server, and a browser resolves every `*.localhost`
// to loopback itself (RFC 6761), without asking DNS, so no page of another site can own such a name:
// a page at `evil.localhost` is already served by a process on the developer's machine. The name is
// only matched as a whole (`localhost.evil.example` is refused) and never in production or when
// NODE_ENV is unset or anything else, so a deployment cannot take this path by accident. A client
// that is not a browser can send any Host to a loopback socket, with or without this rule: Host is
// not authentication, and the login still guards every page.
const loopback = new Set(['127.0.0.1', 'localhost', '[::1]'])
const localhostName = /^(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+localhost$/

/** Whether this process runs in development: NODE_ENV is exactly `development`. */
function developing(): boolean {
	return process.env.NODE_ENV === 'development'
}

/** The host name of a Host header, without its port. */
export function hostName(host: string): string {
	const value = host.trim().toLowerCase()
	if (value.startsWith('[')) return value.slice(0, value.indexOf(']') + 1)
	return value.replace(/:\d+$/, '')
}

/** Whether the dashboard answers a request with this Host header. */
export function allowedHost(host: string | null, extra: string | undefined = process.env.DASHBOARD_ALLOWED_HOSTS, development: boolean = developing()): boolean {
	if (!host) return false
	const name = hostName(host)
	if (loopback.has(name)) return true
	if (development && localhostName.test(name)) return true
	return (extra ?? '')
		.split(',')
		.map((entry) => entry.trim().toLowerCase())
		.filter(Boolean)
		.includes(name)
}
