import type { ClientOptions } from '../../shared/clients'

/**
 * Opciones de cliente para el navegador: leen el token CSRF de la meta `meeko-csrf-token` en cada
 * llamada, también tras navegar, y la actualizan con la cabecera `x-meeko-csrf-token` de las
 * respuestas, salvo que el documento o el token hayan cambiado durante la petición.
 *
 * @returns Opciones con `csrfToken` y `fetch`.
 * @example
 * ```ts
 * import { createApiClient, createBrowserClientOptions } from "@meekojs/meeko/framework";
 *
 * export const api = createApiClient<ApiContract>(manifest, createBrowserClientOptions());
 * ```
 */
export function createBrowserClientOptions(): ClientOptions {
	const currentCsrfToken = (): string | undefined => (typeof document === 'undefined' ? undefined : (document.querySelector('meta[name="meeko-csrf-token"]')?.getAttribute('content') ?? undefined))
	return {
		csrfToken: currentCsrfToken,
		fetch: async (input, init) => {
			const sourceDocument = typeof document === 'undefined' ? undefined : document
			const csrfTokenAtStart = currentCsrfToken()
			const response = await fetch(input, init)
			const token = response.headers.get('x-meeko-csrf-token')
			// Navigation or a newer response may have rotated or cleared the token.
			if (token !== null && sourceDocument && document === sourceDocument && currentCsrfToken() === csrfTokenAtStart) {
				let meta = document.querySelector('meta[name="meeko-csrf-token"]')
				if (!token) {
					meta?.remove()
					return response
				}
				if (!meta) {
					meta = document.createElement('meta')
					meta.setAttribute('name', 'meeko-csrf-token')
					document.head.append(meta)
				}
				meta.setAttribute('content', token)
			}
			return response
		},
	}
}
