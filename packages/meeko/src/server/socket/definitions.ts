import type { RequestContext } from "../runtime/request-context";
import type { Schema } from "../schema";

type Output<S> = S extends Schema<unknown, infer O> ? O : never;
type SchemaMap = Readonly<Record<string, Schema>>;

/**
 * Definición de un canal Socket de `server/socket/<nombre>.ts`: schemas por dirección, guardas y
 * handlers de los eventos del cliente. Se declara con {@link defineSocketChannel}.
 *
 * @typeParam C Schemas de los eventos que envía el cliente.
 * @typeParam S Schemas de los eventos que envía el servidor.
 * @typeParam TServices Tipo de los servicios.
 * @example
 * ```ts
 * import type { Schema, SocketChannelDefinition } from "@meekojs/meeko/server";
 *
 * type Chat = SocketChannelDefinition<{ message: Schema<{ text: string }> }, { message: Schema<{ text: string }> }>;
 * ```
 * @see https://github.com/meekojs/meeko/blob/main/docs/framework.md#websocket
 */
export interface SocketChannelDefinition<C extends SchemaMap, S extends SchemaMap, TServices = unknown> {
  /** Schemas de los eventos que envía el cliente; deben venir de `shared/`. */
  clientToServer: C;
  /** Schemas de los eventos que envía el servidor; deben venir de `shared/`. */
  serverToClient: S;
  /** `"required"` rechaza el handshake sin sesión con `401`. */
  auth?: "required" | "optional";
  /** Autoriza el handshake y cada entrega; `false` responde `403`. */
  authorize?: (args: { context: RequestContext<TServices>; roomId?: string }) => boolean | Promise<boolean>;
  /** Autoriza cada evento entrante. */
  authorizeEvent?: (args: { event: keyof C & string; payload: unknown; context: RequestContext<TServices>; roomId?: string }) => boolean | Promise<boolean>;
  /** Filtra cada envío a un peer: con `false` no lo recibe y sigue conectado. */
  authorizeSend?: (args: { event: keyof S & string; payload: unknown; context: RequestContext<TServices>; roomId?: string }) => boolean | Promise<boolean>;
  /** Handlers de los eventos del cliente, con el payload validado y `emit` hacia ese cliente. */
  handlers?: { [K in keyof C]?: (args: { payload: Output<C[K]>; context: RequestContext<TServices>; roomId?: string; emit: <E extends keyof S & string>(event: E, payload: Output<S[E]>) => Promise<void> }) => void | Promise<void> };
}

/**
 * Declara un canal Socket, el export por defecto de `server/socket/<nombre>.ts`. El generador
 * emite un contrato público con sus schemas, sin importar los handlers, para `socket` y `useSocket`.
 *
 * @param definition Schemas, guardas y handlers.
 * @returns La misma definición, con sus tipos inferidos.
 * @example
 * ```ts
 * // server/socket/chat.ts
 * import { defineSocketChannel } from "@meekojs/meeko/server";
 * import { chatInput, chatMessage } from "../../shared/schemas/chat.js";
 *
 * export default defineSocketChannel({
 *   clientToServer: { message: chatInput },
 *   serverToClient: { message: chatMessage },
 *   auth: "required",
 *   authorize: ({ context, roomId }) => !!context.session.current && roomId === "general",
 *   handlers: { message: async ({ payload, emit }) => emit("message", payload) },
 * });
 * ```
 * @see https://github.com/meekojs/meeko/blob/main/docs/framework.md#websocket
 */
export function defineSocketChannel<C extends SchemaMap, S extends SchemaMap, TServices = unknown>(definition: SocketChannelDefinition<C, S, TServices>): SocketChannelDefinition<C, S, TServices> {
  return definition;
}
