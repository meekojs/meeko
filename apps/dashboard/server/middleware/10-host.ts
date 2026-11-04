import { defineServerMiddleware } from '@meekojs/meeko/server'

import { allowedHost } from '../dashboard/host'

export default defineServerMiddleware(async (request, next) => {
	if (!allowedHost(request.headers.get('host'))) return new Response('Host no permitido: el dashboard solo responde en loopback o en los nombres de DASHBOARD_ALLOWED_HOSTS.', { status: 421, headers: { 'content-type': 'text/plain; charset=utf-8' } })
	return next(request)
})
