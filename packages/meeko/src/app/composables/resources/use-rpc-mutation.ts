import { requestRpc } from "../../../shared/clients.js";
import type { ClientOptions, PublicServerManifest, RpcOperation } from "../../../shared/clients.js";
import { createMutation } from "../../runtime/mutations.js";
import type { MutationOptions } from "../../runtime/mutations.js";
import { requireSetup, rpcEndpoint } from "./engine.js";
import type { RpcMutation, UseRpcMutation } from "./engine.js";

/**
 * Crea `useRpcMutation` para los procedimientos de un manifiesto público, como hacen los clientes
 * generados. El composable acepta desde `1.2` las opciones de mutación (`retrySafe`).
 *
 * @param manifest Manifiesto público con la lista `rpc`.
 * @param options Opciones de transporte: `fetch`, `baseUrl`, cabeceras y CSRF.
 * @returns El composable `useRpcMutation`. Con un procedimiento desconocido lanza `TypeError`, y
 * fuera del script de un componente, `Error`.
 * @since 1.1.0
 * @example
 * ```ts
 * import { createBrowserClientOptions, createUseRpcMutation } from "@meekojs/meeko/framework";
 * import type { RpcContract } from "../types/server-contracts.js";
 *
 * const manifest = { version: 1, api: [], rpc: [{ id: "users.rename", pathname: "/_meeko/rpc/users/rename" }] } as const;
 * export const useRpcMutation = createUseRpcMutation<RpcContract>(manifest, createBrowserClientOptions());
 * ```
 * @see https://github.com/meekojs/meeko/blob/main/docs/framework.md#mutaciones
 */
export function createUseRpcMutation<Contract extends Record<string, RpcOperation>>(manifest: Pick<PublicServerManifest, "rpc">, options: ClientOptions = {}): UseRpcMutation<Contract> {
  const useRpcMutation = (procedure: string, mutationOptions?: MutationOptions): RpcMutation<unknown, unknown> => {
    const label = `useRpcMutation("${procedure}")`;
    requireSetup(label);
    const endpoint = rpcEndpoint(manifest, procedure, "useRpcMutation");
    return createMutation({
      label,
      target: `RPC ${procedure}`,
      send: (input, headers) => requestRpc(endpoint, input, {}, options, headers),
    }, mutationOptions) as RpcMutation<unknown, unknown>;
  };
  return useRpcMutation as never;
}

