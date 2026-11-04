// The dashboard only answers requests addressed to a name it knows: a loopback name, or one of
// DASHBOARD_ALLOWED_HOSTS (such as dashboard.meekojs.com in production), separated by commas. A
// page of another site that makes the browser resolve its own domain to the server (DNS rebinding)
// sends that domain as Host and is refused, before any session or login is involved.
const loopback = new Set(['127.0.0.1', 'localhost', '[::1]'])

/** The host name of a Host header, without its port. */
export function hostName(host: string): string {
	const value = host.trim().toLowerCase()
	if (value.startsWith('[')) return value.slice(0, value.indexOf(']') + 1)
	return value.replace(/:\d+$/, '')
}

/** Whether the dashboard answers a request with this Host header. */
export function allowedHost(host: string | null, extra: string | undefined = process.env.DASHBOARD_ALLOWED_HOSTS): boolean {
	if (!host) return false
	const name = hostName(host)
	if (loopback.has(name)) return true
	return (extra ?? '')
		.split(',')
		.map((entry) => entry.trim().toLowerCase())
		.filter(Boolean)
		.includes(name)
}
