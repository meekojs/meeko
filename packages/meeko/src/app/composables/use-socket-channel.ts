import { socketUrl } from "../runtime/socket";
import type { SocketClient, SocketContract, SocketRegistryOptions } from "../runtime/socket";
import { useSocketClient } from "./use-socket-client";

/**
 * Abre el canal `name` de un registro de contratos ligado a la raíz del componente actual, como
 * {@link useSocketClient}. Los clientes generados lo usan para el autoimport `useSocket(canal, opciones)`.
 *
 * @param contracts Contratos públicos por nombre de canal.
 * @param name Canal que se abre.
 * @param options Sala, URL base y opciones del cliente.
 * @returns El cliente tipado del canal; en SSR, uno inerte que no conecta.
 * @throws {TypeError} Si el canal no existe.
 * @example
 * ```ts
 * import { useSocketChannel } from "@meekojs/meeko/framework";
 * import type { SocketRegistryOptions } from "@meekojs/meeko/framework";
 * import { socketContracts } from "./socket-contracts.js";
 *
 * export const useSocket = <K extends keyof typeof socketContracts & string>(name: K, options?: SocketRegistryOptions) =>
 *   useSocketChannel(socketContracts, name, options);
 * ```
 * @see https://github.com/meekojs/meeko/blob/main/docs/framework.md#websocket
 */
export function useSocketChannel<C extends Record<string, SocketContract>, K extends keyof C & string>(contracts: C, name: K, options: SocketRegistryOptions = {}): SocketClient<C[K]> {
  const contract = contracts[name];
  if (!contract) throw new TypeError(`Unknown socket channel: ${name}`);
  return useSocketClient(socketUrl(name, options), contract, options);
}
