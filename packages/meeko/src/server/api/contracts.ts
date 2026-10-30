import type { RequestContext } from "../runtime/request-context.js";
import type { RateLimitOptions } from "../runtime/rate-limit.js";
import type { Schema } from "../schema.js";
import type { Output, OptionalOutput } from "../schema.js";

/**
 * Estados de éxito que un endpoint JSON puede elegir con `status` (desde `1.2`). `204` responde sin
 * cuerpo y el cliente generado resuelve `undefined`.
 *
 * @since 1.2.0
 * @example
 * ```ts
 * import type { ApiSuccessStatus } from "@meekojs/meeko/server";
 *
 * const created: ApiSuccessStatus = 201;
 * ```
 */
export type ApiSuccessStatus = 200 | 201 | 202 | 204;

export const successStatuses: ReadonlySet<unknown> = new Set<ApiSuccessStatus>([200, 201, 202, 204]);

/** What a JSON handler returns: nothing with `204`, the response schema's value otherwise. */
type ApiHandlerResult<R, T> = [T] extends [204] ? void | undefined : R extends Schema ? Output<R> : Response;
/** What `form.redirect` receives: the validated response, `undefined` with `204`, or the handler's `Response`. */
type ApiFormResult<R, T> = [T] extends [204] ? undefined : R extends Schema ? Output<R> : Response;

/**
 * Opciones de un endpoint que acepta formularios HTML nativos con `form` (desde `1.7`): un
 * `<form method="post">` que funciona sin JavaScript, enviado como
 * `application/x-www-form-urlencoded` o `multipart/form-data`.
 *
 * @typeParam Result Lo que recibe `redirect`: la respuesta validada con `response`, `undefined` con
 * `status: 204` o el `Response` del handler con `contentType: "response"`.
 * @typeParam S Tipo de los servicios.
 * @since 1.7.0
 * @example
 * ```ts
 * // server/api/feedback.post.ts
 * import { defineApiRoute } from "@meekojs/meeko/server";
 * import { feedbackInput, feedbackSaved } from "../../shared/schemas/feedback.js";
 * import { saveFeedback } from "../utils/feedback.js";
 *
 * export default defineApiRoute({
 *   body: feedbackInput,
 *   response: feedbackSaved,
 *   // Tras un error, el comentario vuelve a la página; ningún otro valor.
 *   form: { redirect: (saved) => `/gracias?id=${saved.id}`, echo: ["comment"] },
 *   handler: ({ body }) => saveFeedback(body),
 * });
 * ```
 * @see https://github.com/meekojs/meeko/blob/main/docs/framework.md#formularios-sin-javascript-form
 */
export interface ApiFormOptions<Result = unknown, S = unknown> {
  /**
   * Ruta de esta aplicación a la que vuelve un envío correcto con `303 See Other`, como
   * `/gracias`. Sin ella, la del campo `return` del formulario, la de `Referer` o `/`. Una ruta de
   * otro origen, con `//`, `\` o un esquema se sustituye por `/`.
   */
  readonly redirect?: (result: Result, context: RequestContext<S>) => string | Promise<string>;
  /** Tamaño máximo del cuerpo en bytes; por defecto 1 MiB, como el JSON. Por encima, `BODY_TOO_LARGE`. */
  readonly maxBytes?: number;
  /**
   * Con `true`, un `multipart/form-data` puede traer archivos, que llegan al schema de `body` como
   * `File`. Sin él, un archivo responde `FILES_NOT_ALLOWED` (`400`).
   */
  readonly files?: boolean;
  /**
   * Campos cuyo valor enviado vuelve a la página tras un envío con errores, para que el SSR los
   * pinte de nuevo, como `["name", "email"]`. Por defecto ninguno: sólo vuelven el código y los
   * `issues`, y los campos muestran `initial`. Los valores viajan en una cookie de un solo uso y en
   * el HTML de la página, así que no incluyas contraseñas, números de tarjeta ni otros datos
   * sensibles; aun así, los nombres que parecen credenciales (`password`, `token`, `secret`, `cvc`…)
   * nunca se devuelven. Sólo vuelven texto, números y booleanos, nunca archivos.
   */
  readonly echo?: readonly string[];
}

/**
 * Contrato de un endpoint de `server/api/<ruta>.<método>.ts`: schemas de entrada y respuesta,
 * autenticación, autorización y handler. Se declara con {@link defineApiRoute}.
 *
 * @typeParam P Schema de `params`.
 * @typeParam Q Schema de `query`.
 * @typeParam B Schema de `body`.
 * @typeParam R Schema de la respuesta.
 * @typeParam S Tipo de los servicios.
 * @typeParam L Valor de `locals` que recibe el handler; `undefined` sin `locals`.
 * @typeParam T Estado de éxito declarado con `status` (desde `1.2`).
 * @example
 * ```ts
 * import type { ApiRouteDefinition, Schema } from "@meekojs/meeko/server";
 *
 * type Health = ApiRouteDefinition<undefined, undefined, undefined, Schema<{ ok: boolean }>>;
 * ```
 */
export interface ApiRouteDefinition<P extends Schema | undefined, Q extends Schema | undefined, B extends Schema | undefined, R extends Schema | undefined, S = unknown, L = undefined, T extends ApiSuccessStatus = ApiSuccessStatus> {
  /** Segmentos dinámicos de la ruta, como cadenas obligatorias. */
  params?: P;
  /** Query string; sus campos aceptan cadenas o listas de cadenas. */
  query?: Q;
  /** Cuerpo JSON (`application/json`, hasta 1 MiB) y, con `form` (desde `1.7`), el de un formulario nativo. */
  body?: B;
  /** Schema de la respuesta; obligatorio salvo con `contentType: "response"` o `status: 204`. */
  response?: R;
  /**
   * Estado HTTP de la respuesta correcta (desde `1.2`): `200` por defecto, `201` al crear, `202`
   * al aceptar trabajo diferido o `204` sin cuerpo. Con `200`, `201` y `202` la respuesta sigue
   * siendo JSON validado con `response`; con `204` el handler no devuelve nada y no se declara
   * `response`. No se combina con `contentType: "response"`. Debe ser un literal para que el
   * generador lo lea.
   */
  status?: T;
  /** `"required"` responde `401 UNAUTHENTICATED` sin sesión. */
  auth?: "required" | "optional";
  /**
   * `"required"` (desde `1.2`) responde `403 INVALID_ORIGIN` a las peticiones `POST`, `PUT`,
   * `PATCH` y `DELETE` cuyo `Origin` falta o no es el de la aplicación ni uno de
   * `SessionManager.allowedOrigins`, aunque no haya sesión; por ejemplo, un inicio de sesión.
   * Sin él, Origin se comprueba en las mutaciones autenticadas con cookie y, desde `1.2`, cuando el
   * handler llama a `context.session.create()`.
   *
   * `"none"` (desde `1.2`, **inseguro**) permite que `session.create()` cree una sesión sin un
   * `Origin` permitido, para clientes que no lo envían, como una app nativa. Expone esa ruta al
   * *login CSRF*: úsela sólo con otra prueba de que la petición no viene de otra web.
   */
  origin?: "required" | "none";
  /**
   * Límite de peticiones (desde `1.2`), como `{ limit: 5, window: "5m" }`: por encima responde
   * `429 RATE_LIMITED` con `Retry-After`, tras Origin y CSRF y antes de `auth`, `authorize`, la
   * entrada y el handler. Cuenta en el store de sesiones (Redis entre instancias) y, si el store
   * falla, la petición se rechaza.
   */
  rateLimit?: RateLimitOptions<S>;
  /** `"response"` deja que el handler devuelva su propio `Response`. */
  contentType?: "json" | "response";
  /**
   * Acepta también formularios HTML nativos (desde `1.7`): `application/x-www-form-urlencoded` y
   * `multipart/form-data`, validados con el mismo schema de `body`. Un envío correcto responde
   * `303 See Other` a `redirect`, al campo `return` o a la página de `Referer`; un error vuelve a
   * esa página con `303` y su estado, que `useForm({ action })` pinta en el SSR. Exige siempre un
   * `Origin` permitido. Sin `form`, esos tipos responden `415 UNSUPPORTED_MEDIA_TYPE`.
   */
  form?: true | ApiFormOptions<ApiFormResult<R, T>, S>;
  /** Devolver `false` responde `403 FORBIDDEN`. */
  authorize?: (context: RequestContext<S>) => boolean | Promise<boolean>;
  /**
   * Calcula un valor por petición que el handler recibe como `locals` (desde `1.2`), como el
   * usuario actual. Se ejecuta tras Origin, CSRF, `auth`, `authorize` y la validación de la
   * entrada, y justo antes del handler; un `ApiError` que lance (por ejemplo `401` o `403`) es la
   * respuesta. Declárelo antes de `handler` para que TypeScript infiera su tipo.
   */
  locals?: (context: RequestContext<S>) => L | Promise<L>;
  /**
   * Recibe la entrada validada, el contexto y `locals`; su resultado se valida con `response`. Con
   * `status: 204` no devuelve nada.
   */
  handler: (args: { params: OptionalOutput<P>; query: OptionalOutput<Q>; body: OptionalOutput<B>; context: RequestContext<S>; locals: L }) => Promise<ApiHandlerResult<R, T>> | ApiHandlerResult<R, T>;
}

