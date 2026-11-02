import type { AnyApiOperation, ApiRequestInput, ClientOptions, PublicServerManifest } from '../../../shared/clients'
import type { MutationOptions } from '../../runtime/mutations'
import type { ApiMutation, ApiMutationContract, UseApiMutation } from './engine'

import { requestApi } from '../../../shared/clients'
import { createMutation } from '../../runtime/mutations'
import { requireSetup } from './engine'

/**
 * Crea `useApiMutation` para los endpoints `POST`, `PUT`, `PATCH` y `DELETE` de un manifiesto
 * público, como hacen los clientes generados.
 *
 * @param manifest Manifiesto público con la lista `api`.
 * @param options Opciones de transporte: `fetch`, `baseUrl`, cabeceras y CSRF.
 * @returns El composable `useApiMutation`. Con una ruta o un método sin endpoint, o con `GET`, lanza
 * `TypeError`, y fuera del script de un componente, `Error`.
 * @since 1.2.0
 * @example
 * ```ts
 * import { createBrowserClientOptions, createUseApiMutation } from "@meekojs/meeko/framework";
 * import type { ApiContract } from "../types/server-contracts.js";
 *
 * const manifest = { version: 1, api: [{ clientKey: "notes", pathname: "/api/notes", method: "POST" }], rpc: [] } as const;
 * export const useApiMutation = createUseApiMutation<ApiContract, typeof manifest>(manifest, createBrowserClientOptions());
 * ```
 * @see https://github.com/meekojs/meeko/blob/main/docs/framework.md#mutaciones
 */
export function createUseApiMutation<Contract extends Record<string, Record<string, AnyApiOperation>>, Manifest extends Pick<PublicServerManifest, 'api'>>(manifest: Manifest, options: ClientOptions = {}): UseApiMutation<ApiMutationContract<Manifest, Contract>> {
	const useApiMutation = (path: string, method: string, mutationOptions?: MutationOptions): ApiMutation<AnyApiOperation> => {
		const label = `useApiMutation("${path}", "${method}")`
		requireSetup(label)
		const verb = String(method).toUpperCase()
		if (verb === 'GET' || verb === 'HEAD') throw new TypeError(`useApiMutation: ${verb} ${path} is a read; use useApi`)
		const endpoint = manifest.api.find((entry) => entry.pathname === path && entry.method === verb)
		if (!endpoint) throw new TypeError(`useApiMutation: no ${verb} endpoint at ${path}`)
		return createMutation(
			{
				label,
				target: `${verb} ${path}`,
				send: (input, headers) => requestApi(endpoint, (input ?? {}) as ApiRequestInput, options, headers),
			},
			mutationOptions,
		) as unknown as ApiMutation<AnyApiOperation>
	}
	return useApiMutation as never
}
