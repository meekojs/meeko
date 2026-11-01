import type { Schema } from "../schema";
import type { ApiRouteDefinition, ApiSuccessStatus } from "./contracts";

/**
 * Declara un endpoint de API, el export por defecto de `server/api/<ruta>.<método>.ts`. El
 * servidor valida entrada, salida, sesión, autorización y CSRF; desde `1.8`, toda petición `POST`,
 * `PUT`, `PATCH` o `DELETE` necesita además un `Origin` permitido salvo con `origin: "none"`. Los
 * clientes `api.*` se generan a partir de sus schemas públicos.
 *
 * @param definition Schemas, guardas y handler.
 * @returns La misma definición, con sus tipos inferidos.
 * @example
 * ```ts
 * // server/api/users/[id].get.ts
 * import { defineApiRoute } from "@meekojs/meeko/server";
 * import { userParams, userSchema } from "../../../shared/schemas/user.js";
 *
 * export default defineApiRoute({
 *   params: userParams,
 *   response: userSchema,
 *   handler: ({ params }) => ({ id: params.id, name: "Ada" }),
 * });
 * ```
 * Con `locals`, el handler recibe el usuario ya cargado:
 * ```ts
 * // server/api/orders/index.post.ts
 * import { ApiError, defineApiRoute } from "@meekojs/meeko/server";
 * import { newOrder, orderSchema } from "../../../shared/schemas/order.js";
 * import { createOrder, findUser } from "../../utils/store.js";
 *
 * export default defineApiRoute({
 *   auth: "required",
 *   body: newOrder,
 *   response: orderSchema,
 *   locals: async ({ session }) => {
 *     const user = await findUser((session.current?.data as { userId: string }).userId);
 *     if (!user) throw new ApiError("UNAUTHENTICATED", 401);
 *     return { user };
 *   },
 *   handler: ({ body, locals }) => createOrder(locals.user, body),
 * });
 * ```
 * Con `status`, una creación responde `201 Created` sin perder la validación ni el tipo del cliente:
 * ```ts
 * // server/api/orders/index.post.ts
 * import { defineApiRoute } from "@meekojs/meeko/server";
 * import { newOrder, orderSchema } from "../../../shared/schemas/order.js";
 * import { createOrder } from "../../utils/store.js";
 *
 * export default defineApiRoute({
 *   body: newOrder,
 *   response: orderSchema,
 *   status: 201,
 *   handler: ({ body }) => createOrder(body),
 * });
 * ```
 * Un webhook llega de otro servidor sin `Origin`: desactiva la comprobación y verifica su firma:
 * ```ts
 * // server/api/webhooks/payments.post.ts
 * import { ApiError, defineApiRoute } from "@meekojs/meeko/server";
 * import { verifySignature } from "../../utils/payments.js";
 *
 * export default defineApiRoute({
 *   origin: "none",
 *   contentType: "response",
 *   handler: async ({ context }) => {
 *     const payload = await context.request.text();
 *     if (!(await verifySignature(payload, context.request.headers.get("x-signature")))) throw new ApiError("INVALID_SIGNATURE", 401);
 *     return new Response(null, { status: 204 });
 *   },
 * });
 * ```
 * @see https://github.com/meekojs/meeko/blob/main/docs/framework.md#api-y-rpc
 */
export function defineApiRoute<P extends Schema | undefined = undefined, Q extends Schema | undefined = undefined, B extends Schema | undefined = undefined, R extends Schema | undefined = undefined, S = unknown, L = undefined, T extends ApiSuccessStatus = ApiSuccessStatus>(definition: ApiRouteDefinition<P, Q, B, R, S, L, T>): ApiRouteDefinition<P, Q, B, R, S, L, T> {
  return definition;
}
