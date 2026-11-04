import type { ClientOptions, PublicServerManifest, RpcOperation } from '../../../shared/clients'
import type { DataResource, DataResourceOptions, UseRpcQuery } from './engine'

import { requestRpc } from '../../../shared/clients'
import { createResource, readerOf, rpcEndpoint, stableJson } from './engine'

/**
 * Crea `useRpcQuery` para los procedimientos de un manifiesto público, como hacen los clientes
 * generados.
 *
 * @param manifest Manifiesto público con la lista `rpc`.
 * @param options Opciones de transporte: `fetch`, `baseUrl`, cabeceras y CSRF.
 * @returns El composable `useRpcQuery`. Con un procedimiento desconocido lanza `TypeError`.
 * @since 1.1.0
 * @example
 * ```ts
 * import { createBrowserClientOptions, createUseRpcQuery } from "@meekojs/meeko/framework";
 * import type { RpcContract } from "../types/server-contracts.js";
 *
 * const manifest = { version: 1, api: [], rpc: [{ id: "users.get", pathname: "/_meeko/rpc/users/get" }] } as const;
 * export const useRpcQuery = createUseRpcQuery<RpcContract>(manifest, createBrowserClientOptions());
 * ```
 * @see https://github.com/meekojs/meeko/blob/main/docs/framework.md#load-o-composables
 */
export function createUseRpcQuery<Contract extends Record<string, RpcOperation>>(manifest: Pick<PublicServerManifest, 'rpc'>, options: ClientOptions = {}): UseRpcQuery<Contract> {
	const useRpcQuery = (procedure: string, input?: unknown, resource?: DataResourceOptions): DataResource<unknown> => {
		const endpoint = rpcEndpoint(manifest, procedure, 'useRpcQuery')
		return createResource(
			{
				label: `useRpcQuery("${procedure}")`,
				// An RPC body is JSON: a left-out input sends `{}`.
				read: readerOf(input === undefined ? {} : input),
				key: (value) => `RPC ${procedure} ${stableJson(value)}`,
				fetch: (value, signal) => requestRpc(endpoint, value, signal ? { signal } : {}, options),
			},
			resource,
		)
	}
	return useRpcQuery as never
}
