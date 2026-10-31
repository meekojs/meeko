import type { RateLimitOptions } from "./runtime/rate-limit";
import type { RequestContext } from "./runtime/request-context";
import type { Output, Schema } from "./schema";

import { serializeJson } from "../core/server";
import { ApiError, InvalidInputError, normalizeServerError, publicIssues, sentIssues } from "./errors";
import { countRateLimit, rateLimitKey, rateLimitSettings, rateLimitSubject, retryAfterSeconds } from "./runtime/rate-limit";
import { isAllowedOrigin, type SessionManager, settleSessionOrigin } from "./runtime/sessions";

export async function validate<S extends Schema>(schema: S, value: unknown, label: string): Promise<Output<S>> {
  const result = await schema["~standard"].validate(value);
  if ("issues" in result && result.issues) {
    const code = `INVALID_${label.toUpperCase()}`;
    // A response that breaks its own schema is a server fault: no detail reaches the client.
    if (label === "response" || label === "output") throw new ApiError(code, 500);
    throw new InvalidInputError(code, publicIssues(result.issues));
  }
  return (result as { value: Output<S> }).value;
}

export const defaultMaxBodyBytes = 1024 * 1024;

/** The body as bytes, or `undefined` without one; more than `maxBytes` is `413 BODY_TOO_LARGE`. */
export async function readBounded(request: Request, maxBytes: number): Promise<Uint8Array<ArrayBuffer> | undefined> {
  const reader = request.body?.getReader();
  if (!reader) return undefined;
  let length = 0;
  const chunks: Uint8Array[] = [];
  try {
    while (true) {
      const next = await reader.read();
      if (next.done) break;
      length += next.value.byteLength;
      if (length > maxBytes) throw new ApiError("BODY_TOO_LARGE", 413);
      chunks.push(next.value);
    }
  } finally { reader.releaseLock(); }
  const bytes = new Uint8Array(length);
  let position = 0;
  for (const chunk of chunks) { bytes.set(chunk, position); position += chunk.byteLength; }
  return bytes;
}

export async function readJson(request: Request, maxBytes = defaultMaxBodyBytes): Promise<unknown> {
  if (!request.headers.get("content-type")?.toLowerCase().startsWith("application/json")) throw new ApiError("UNSUPPORTED_MEDIA_TYPE", 415);
  const bytes = await readBounded(request, maxBytes);
  if (!bytes) throw new ApiError("INVALID_JSON", 400);
  try { return JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes)) as unknown; }
  catch { throw new ApiError("INVALID_JSON", 400); }
}
type Guarded<S> = {
  auth?: "required" | "optional";
  origin?: "required" | "none";
  rateLimit?: RateLimitOptions<S>;
  authorize?: (context: RequestContext<S>) => boolean | Promise<boolean>;
};

/** Too many requests: `429 RATE_LIMITED`, with the seconds to wait in `Retry-After`. */
class RateLimitedError extends ApiError {
  constructor(readonly retryAfter: number) { super("RATE_LIMITED", 429); }
}

/** Counter route of a request: the dispatcher's route pattern, or its method and pathname. */
const routeIds = new WeakMap<object, string>();

/** Names the route of a request for its rate limit, so `/users/1` and `/users/2` share a counter. */
export function setRateLimitRoute(context: RequestContext<unknown>, route: string): void { routeIds.set(context, route); }

export async function enforceRateLimit<S>(options: RateLimitOptions<S>, context: RequestContext<S>, sessions: SessionManager): Promise<void> {
  // A misdeclared limit is a server fault, reported before the request does anything.
  const settings = rateLimitSettings(options as RateLimitOptions<never>);
  if (!settings) throw new ApiError("INVALID_RATE_LIMIT", 500);
  const subject = await rateLimitSubject(options, context);
  if (subject === undefined) throw new ApiError("INVALID_RATE_LIMIT", 500);
  const request = context.request;
  const route = routeIds.get(context) ?? `${request.method} ${new URL(request.url).pathname}`;
  const key = await rateLimitKey(route, subject);
  // Stores without their own counter (and custom managers) count in this instance's memory.
  const counter = typeof (sessions as Partial<SessionManager>).rateLimit === "function"
    ? sessions.rateLimit(key, settings.windowMs)
    : countRateLimit(undefined, key, settings.windowMs, false);
  const hit = await counter;
  if (hit.count > settings.limit) throw new RateLimitedError(retryAfterSeconds(hit.resetInMs));
}

/** The request with the CSRF token of a native form's `_csrf` field in `x-meeko-csrf`, for the session check. */
function withCsrfHeader(request: Request, token: string | undefined): Request {
  if (!token || request.headers.has("x-meeko-csrf")) return request;
  const headers = new Headers(request.headers);
  headers.set("x-meeko-csrf", token);
  return new Request(request.url, { method: request.method, headers });
}

export async function guard<S>(definition: Guarded<S>, context: RequestContext<S>, sessions: SessionManager, mutating?: boolean, formCsrf?: string, rateLimited = false): Promise<void> {
  const request = context.request;
  // Anonymous mutations such as a sign-in opt in to the session's allowed-origin rule. SSR
  // clients send the request's own origin, so local dispatch passes.
  if (definition.origin === "required" && (mutating ?? !["GET", "HEAD", "OPTIONS"].includes(request.method))) {
    if (!isAllowedOrigin(request, sessions.allowedOrigins ?? [])) throw new ApiError("INVALID_ORIGIN", 403);
    context.session[settleSessionOrigin]?.("verified");
  }
  // An explicit, documented opt-out: session.create() then skips its login CSRF check.
  if (definition.origin === "none") context.session[settleSessionOrigin]?.("exempt");
  sessions.assertMutationAllowed(withCsrfHeader(request, formCsrf), context.session, mutating);
  // Before auth and authorize: a flood of anonymous requests is limited too. A native form counted
  // it already, before reading its body.
  if (definition.rateLimit && !rateLimited) await enforceRateLimit(definition.rateLimit, context, sessions);
  if (definition.auth === "required" && !context.session.current) throw new ApiError("UNAUTHENTICATED", 401);
  if (definition.authorize && !(await definition.authorize(context))) throw new ApiError("FORBIDDEN", 403);
}

/**
 * Convierte un error en la respuesta JSON pública `{ code, status, requestId }` con la cabecera
 * `x-request-id`. Un `ApiError` conserva su código y estado; cualquier otro error es
 * `INTERNAL_ERROR`/`500`, sin su mensaje. Desde `1.2`, la entrada que no supera su schema
 * (`INVALID_PARAMS`, `INVALID_QUERY`, `INVALID_BODY`, `INVALID_INPUT`) añade
 * `issues: [{ path, message }]`, con como mucho 20 mensajes del schema, y `429 RATE_LIMITED`
 * lleva `Retry-After` con los segundos que faltan.
 *
 * @param error Error capturado.
 * @param requestId ID de la petición.
 * @returns La respuesta de error.
 * @example
 * ```ts
 * import { ApiError, errorResponse } from "@meekojs/meeko/server";
 *
 * const response = errorResponse(new ApiError("NOT_FOUND", 404), crypto.randomUUID());
 * // 404 {"code":"NOT_FOUND","status":404,"requestId":"..."}
 * ```
 */
export function errorResponse(error: unknown, requestId: string): Response {
  const known = normalizeServerError(error);
  const issues = sentIssues(known);
  const headers: Record<string, string> = { "content-type": "application/json; charset=utf-8", "x-request-id": requestId };
  if (known instanceof RateLimitedError) headers["retry-after"] = String(known.retryAfter);
  return new Response(serializeJson({ code: known.code, status: known.status, requestId, ...(issues ? { issues } : {}) }), { status: known.status, headers });
}

export function finish(response: Response, context: RequestContext): Response {
  // Fetch-created responses such as Response.redirect have immutable headers.
  // Wrap the response to preserve its status, body, and headers before adding
  // request metadata and session changes.
  const finished = new Response(response.body, response);
  finished.headers.set("x-request-id", context.requestId);
  if (context.session.cookieHeader) finished.headers.append("set-cookie", context.session.cookieHeader);
  if (context.session.current) finished.headers.set("x-meeko-csrf-token", context.session.current.csrfToken);
  else if (context.session.cookieHeader) finished.headers.set("x-meeko-csrf-token", "");
  return finished;
}
