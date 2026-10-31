import type { AnyApiOperation, ApiRequestInput, ClientOptions, PublicServerManifest } from "../../../shared/clients";
import type { ApiQueryContract, DataResource, DataResourceOptions, UseApi } from "./engine";

import { requestApi } from "../../../shared/clients";
import { createResource, readerOf, stableJson } from "./engine";

/**
 * Crea `useApi` para los endpoints GET de un manifiesto público. Los clientes generados
 * (`.meeko/generated/clients.*.ts`) lo exportan así; un host propio puede hacer lo mismo.
 *
 * @param manifest Manifiesto público con la lista `api`.
 * @param options Opciones de transporte: `fetch`, `baseUrl`, cabeceras y CSRF.
 * @returns El composable `useApi`. Al llamarlo con una ruta sin endpoint GET lanza `TypeError`, y
 * fuera del script de un componente, `Error`.
 * @since 1.1.0
 * @example
 * ```ts
 * import { createBrowserClientOptions, createUseApi } from "@meekojs/meeko/framework";
 * import type { ApiContract } from "../types/server-contracts.js";
 *
 * const manifest = { version: 1, api: [{ clientKey: "users", pathname: "/api/users", method: "GET" }], rpc: [] } as const;
 * export const useApi = createUseApi<ApiContract, typeof manifest>(manifest, createBrowserClientOptions());
 * ```
 * @see https://github.com/meekojs/meeko/blob/main/docs/framework.md#load-o-composables
 */
export function createUseApi<Contract extends Record<string, Record<string, AnyApiOperation>>, Manifest extends Pick<PublicServerManifest, "api">>(manifest: Manifest, options: ClientOptions = {}): UseApi<ApiQueryContract<Manifest, Contract>> {
  const useApi = (path: string, input?: unknown, resource?: DataResourceOptions): DataResource<unknown> => {
    const endpoint = manifest.api.find((entry) => entry.pathname === path && entry.method === "GET");
    if (!endpoint) throw new TypeError(`useApi: no GET endpoint at ${path}`);
    return createResource({
      label: `useApi("${path}")`,
      read: readerOf(input),
      key: (value) => `GET ${path} ${stableJson(value ?? {})}`,
      fetch: (value, signal) => requestApi(endpoint, { ...(value as ApiRequestInput | undefined), ...(signal ? { signal } : {}) }, options),
    }, resource);
  };
  return useApi as never;
}
