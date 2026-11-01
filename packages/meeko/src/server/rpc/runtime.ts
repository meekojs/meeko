import type { ServerErrorObserver } from "../errors";
import type { RequestContext } from "../runtime/request-context";
import type { SessionManager } from "../runtime/sessions";
import type { Output, Schema } from "../schema";
import type { RpcDefinition } from "./contracts";

import { serializeJson } from "../../core/server";
import { errorResponse, finish, guard, readJson, validate } from "../contract-runtime";
import { ApiError, reportServerError } from "../errors";

/**
 * Ejecuta un procedimiento RPC con sus guardas y validaciones y devuelve su salida validada. Es la
 * pieza de bajo nivel de {@link dispatchRpc}. El orden es: Origin (desde `1.8`, en toda llamada
 * salvo con `origin: "none"`), Origin y CSRF de la sesión, `rateLimit`, `auth`, `authorize`, `input`, `locals`, handler y `output`.
 *
 * @param definition Procedimiento declarado con `defineRpc`.
 * @param rawInput Entrada sin validar.
 * @param context Contexto de la petición.
 * @param sessions Gestor de sesiones, para Origin y CSRF.
 * @returns La salida validada.
 * @throws {ApiError} Con `INVALID_ORIGIN`, `RATE_LIMITED`, `UNAUTHENTICATED`, `FORBIDDEN`, `INVALID_INPUT`,
 * `INVALID_RATE_LIMIT`, `INVALID_OUTPUT` o los de `locals` y del handler.
 * @example
 * ```ts
 * import { executeRpc } from "@meekojs/meeko/server";
 * import getUser from "./server/rpc/users/get.js";
 *
 * const user = await executeRpc(getUser, { id: "123" }, context, sessions);
 * ```
 */
export async function executeRpc<I extends Schema, O extends Schema, S, L = undefined>(definition: RpcDefinition<I, O, S, L>, rawInput: unknown, context: RequestContext<S>, sessions: SessionManager): Promise<Output<O>> {
  await guard(definition, context, sessions, true);
  const input = await validate(definition.input, rawInput, "input");
  const locals = definition.locals ? await definition.locals(context) : undefined;
  const result = await definition.handler({ input, context, locals: locals as L });
  const output = await validate(definition.output, result, "output");
  serializeJson(output);
  return output;
}
/**
 * Atiende una petición RPC para un host propio: exige `POST` con JSON (otro método responde `405`
 * con `Allow: POST`), ejecuta el procedimiento, normaliza los errores, informa los fallos 5xx a
 * `onError` y añade `x-request-id`, la cookie de sesión y el token CSRF. Nunca rechaza.
 *
 * @param definition Procedimiento declarado con `defineRpc`.
 * @param context Contexto de la petición.
 * @param sessions Gestor de sesiones.
 * @param onError Observador de los fallos internos.
 * @returns La respuesta final.
 * @example
 * ```ts
 * import { dispatchRpc } from "@meekojs/meeko/server";
 * import getUser from "./server/rpc/users/get.js";
 *
 * const response = await dispatchRpc(getUser, context, sessions);
 * ```
 */
export async function dispatchRpc<I extends Schema, O extends Schema, S, L = undefined>(definition: RpcDefinition<I, O, S, L>, context: RequestContext<S>, sessions: SessionManager, onError?: ServerErrorObserver): Promise<Response> {
  try {
    if (context.request.method !== "POST") {
      const response = errorResponse(new ApiError("METHOD_NOT_ALLOWED", 405), context.requestId);
      response.headers.set("allow", "POST");
      return finish(response, context);
    }
    const output = await executeRpc(definition, await readJson(context.request), context, sessions);
    return finish(new Response(serializeJson(output), { headers: { "content-type": "application/json; charset=utf-8" } }), context);
  } catch (error) { reportServerError(error, context.requestId, onError); return finish(errorResponse(error, context.requestId), context); }
}
