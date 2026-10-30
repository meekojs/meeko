import type { RpcDefinition } from "./contracts.js";
import type { Schema } from "../schema.js";

/**
 * Declara un procedimiento RPC, el export por defecto de `server/rpc/<ruta>.ts`, que se llama con
 * `POST /_meeko/rpc/<ruta>` y desde `rpc.*`. Comprueba Origin y CSRF en las llamadas con sesión, y
 * Origin en todas con `origin: "required"`.
 *
 * @param definition Schemas, guardas y handler.
 * @returns La misma definición, con sus tipos inferidos.
 * @example
 * ```ts
 * // server/rpc/users/get.ts
 * import { defineRpc } from "@meekojs/meeko/server";
 * import { userParams, userSchema } from "../../../shared/schemas/user.js";
 *
 * export default defineRpc({
 *   input: userParams,
 *   output: userSchema,
 *   handler: ({ input }) => ({ id: input.id, name: "Ada" }),
 * });
 * ```
 * Un inicio de sesión exige un Origin permitido aunque aún no haya sesión, y limita los intentos:
 * ```ts
 * // server/rpc/auth/login.ts
 * import { ApiError, defineRpc } from "@meekojs/meeko/server";
 * import { loginInput, loginOutput } from "../../../shared/schemas/auth.js";
 * import { verifyPassword } from "../../utils/users.js";
 *
 * export default defineRpc({
 *   input: loginInput,
 *   output: loginOutput,
 *   origin: "required",
 *   rateLimit: { limit: 5, window: "5m" },
 *   handler: async ({ input, context }) => {
 *     const user = await verifyPassword(input.email, input.password);
 *     if (!user) throw new ApiError("INVALID_CREDENTIALS", 401);
 *     await context.session.create({ userId: user.id }, { ttlMs: user.staff ? 12 * 3_600_000 : 30 * 86_400_000 });
 *     return { ok: true };
 *   },
 * });
 * ```
 * @see https://github.com/meekojs/meeko/blob/main/docs/framework.md#api-y-rpc
 */
export function defineRpc<I extends Schema, O extends Schema, S = unknown, L = undefined>(definition: RpcDefinition<I, O, S, L>): RpcDefinition<I, O, S, L> {
  return definition;
}
