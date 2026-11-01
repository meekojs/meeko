import { moderationResponse } from 'meeko-docs-content/moderation'

/**
 * El handler de `/_meeko-docs/moderation/<web>` que añade el módulo con la opción `site`: la
 * moderación de esa web en JSON, sin los avisos que la cookie cerró y sin caché. El navegador la
 * pide tras cada navegación (`refreshOnNavigation` de `./state`). El módulo sólo registra la ruta
 * de su web, así que una web no sirve la moderación de otra.
 *
 * @param request La petición de la ruta.
 * @returns La moderación, o `404` para una web que no es `ui` ni `i18n`.
 */
export default function moderationEndpointHandler(request: Request): Promise<Response> | Response {
	const site = new URL(request.url).pathname.split('/').pop()
	if (site !== 'ui' && site !== 'i18n') return new Response('Not found', { status: 404 })
	return moderationResponse(site, request)
}
