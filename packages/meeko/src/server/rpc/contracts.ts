import type { RateLimitOptions } from "../runtime/rate-limit";
import type { RequestContext } from "../runtime/request-context";
import type { Input, Output, Schema } from "../schema";

/**
 * Contrato de un procedimiento de `server/rpc/`: schemas de entrada y salida, guardas y handler.
 * Se declara con {@link defineRpc}.
 *
 * @typeParam I Schema de la entrada.
 * @typeParam O Schema de la salida.
 * @typeParam S Tipo de los servicios.
 * @typeParam L Valor de `locals` que recibe el handler; `undefined` sin `locals`.
 * @example
 * ```ts
 * import type { RpcDefinition, Schema } from "@meekojs/meeko/server";
 *
 * type GetUser = RpcDefinition<Schema<{ id: string }>, Schema<{ id: string; name: string }>>;
 * ```
 */
export interface RpcDefinition<I extends Schema, O extends Schema, S = unknown, L = undefined> {
  /** Schema de la entrada JSON. */
  input: I;
  /** Schema de la salida. */
  output: O;
  /** `"required"` responde `401 UNAUTHENTICATED` sin sesión. */
  auth?: "required" | "optional";
  /**
   * Comprobación de `Origin` en las llamadas, que son siempre `POST`. Desde `1.8`, por defecto
   * (sin `origin`) responden `403 INVALID_ORIGIN` si su `Origin` falta, es `null` o no es el de la
   * aplicación ni uno de `SessionManager.allowedOrigins`, haya o no sesión. `"required"` (desde
   * `1.2`) equivale al valor por defecto y lo deja explícito.
   *
   * `"none"` (desde `1.2`, **inseguro**) desactiva la comprobación en las llamadas sin sesión, para
   * clientes que no envían `Origin`, como una app nativa o un servicio, y permite que
   * `session.create()` cree una sesión sin un `Origin` permitido. Expone el procedimiento al CSRF y
   * al *login CSRF*: úselo sólo con otra prueba de que la llamada no viene de otra web. Una llamada
   * con sesión sigue exigiendo `Origin` y el token CSRF.
   */
  origin?: "required" | "none";
  /**
   * Límite de llamadas (desde `1.2`), como `{ limit: 5, window: "5m" }`: por encima responde
   * `429 RATE_LIMITED` con `Retry-After`, tras Origin y CSRF y antes de `auth`, `authorize`, la
   * entrada y el handler. Cuenta en el store de sesiones (Redis entre instancias) y, si el store
   * falla, la llamada se rechaza.
   */
  rateLimit?: RateLimitOptions<S>;
  /** Devolver `false` responde `403 FORBIDDEN`. */
  authorize?: (context: RequestContext<S>) => boolean | Promise<boolean>;
  /**
   * Calcula un valor por petición que el handler recibe como `locals` (desde `1.2`), como el
   * usuario actual. Se ejecuta tras Origin, CSRF, `auth`, `authorize` y la validación de la
   * entrada, y justo antes del handler; un `ApiError` que lance (por ejemplo `401` o `403`) es la
   * respuesta. Declárelo antes de `handler` para que TypeScript infiera su tipo.
   */
  locals?: (context: RequestContext<S>) => L | Promise<L>;
  /** Recibe la entrada validada, el contexto y `locals`; su resultado se valida con `output`. */
  handler: (args: { input: Output<I>; context: RequestContext<S>; locals: L }) => Promise<Input<O> | Output<O>> | Input<O> | Output<O>;
}

