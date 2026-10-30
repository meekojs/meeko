import { createRoot, effect, onCleanup } from "../../core/reactivity.js";
import type { useSocketChannel } from "./use-socket-channel.js";
import { browserReady } from "../runtime/element-refs.js";
import { setupPhase } from "../runtime/lifecycle.js";
import { createSocketClient, contextualSocketObserver, renderOnlyClient } from "../runtime/socket.js";
import type { SocketClient, SocketClientOptions, SocketContract } from "../runtime/socket.js";

/**
 * Crea un cliente Socket ligado a la raíz del componente actual, que se cierra al desmontarlo.
 * Nunca abre conexión en SSR ni en un render que sólo produce HTML: ahí devuelve un cliente inerte
 * que se queda en `"connecting"`, cuyo `on` no registra nada y cuyo `emit` rechaza (hasta `1.6`,
 * en SSR lanzaba «only available in the browser»). Es la forma de bajo nivel, con URL y contrato
 * explícitos; el autoimport `useSocket(canal, opciones)` de las aplicaciones es otra función,
 * generada con {@link useSocketChannel}. Con `await` en el nivel superior del script, el resto del
 * setup continúa en el navegador cuando el socket está abierto. Fuera de un componente, use
 * {@link createSocketClient}.
 *
 * @param url URL `ws:` o `wss:` del canal.
 * @param contract Contrato del canal.
 * @param options Opciones del cliente; sin `onError`, usa el observador de errores más cercano.
 * @returns El cliente tipado; en SSR, uno inerte.
 * @since 1.1.0
 * @example
 * ```ts
 * import { useSocketClient } from "@meekojs/meeko/framework";
 *
 * // Dentro del <script> de un componente: en SSR el cliente no conecta y el HTML sale con el estado inicial.
 * const chat = useSocketClient("wss://example.com/_meeko/socket/chat?room=general", chatContract);
 * chat.on("message", (message) => console.log(message.text));
 * ```
 * @see https://github.com/meekojs/meeko/blob/main/docs/framework.md#websocket
 */
export function useSocketClient<C extends SocketContract>(url: string, contract: C, options: SocketClientOptions = {}): SocketClient<C> {
  // SSR renders the HTML with the initial state; the browser's mount opens the connection.
  if (typeof window === "undefined" || setupPhase() === "render") return renderOnlyClient<C>();
  const onError = options.onError ?? contextualSocketObserver();
  const client = createSocketClient(url, contract, onError ? { ...options, onError } : options);
  try { onCleanup(() => client.close()); }
  catch (error) { client.close(); throw error; }
  // `await useSocketClient(...)` in a component script continues once the socket is open.
  Object.defineProperty(client, browserReady, { value: () => socketOpen(client) });
  return client;
}

/**
 * Alias obsoleto de {@link useSocketClient}: es la misma función, con la misma firma y los mismos
 * tipos. No es el autoimport `useSocket(canal, opciones)` de las aplicaciones, que generan los
 * clientes con {@link useSocketChannel} y no está obsoleto.
 *
 * @deprecated Desde 1.1.0: use useSocketClient. Se retirará en 2.0.
 * @example
 * ```ts
 * // Antes:
 * import { useSocket } from "@meekojs/meeko/framework";
 * const chat = useSocket("wss://example.com/_meeko/socket/chat", chatContract);
 *
 * // Ahora:
 * import { useSocketClient } from "@meekojs/meeko/framework";
 * const chat = useSocketClient("wss://example.com/_meeko/socket/chat", chatContract);
 * ```
 * @see https://github.com/meekojs/meeko/blob/main/docs/framework.md#websocket
 */
export const useSocket: typeof useSocketClient = useSocketClient;

/** Resolves with `client` once its state is `"open"`; a client that never opens keeps it pending. */
function socketOpen<C extends SocketContract>(client: SocketClient<C>): Promise<SocketClient<C>> {
  return new Promise((resolve) => {
    createRoot((dispose) => {
      effect(() => {
        if (client.state.value !== "open") return;
        resolve(client);
        queueMicrotask(dispose);
      });
    });
  });
}

