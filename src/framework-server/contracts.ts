import { serializeJson } from "../server.js";
import type { RequestContext } from "./context.js";
import { SessionSecurityError, type SessionManager } from "./sessions.js";

/** Valibot schemas implement this public Standard Schema contract. */
export interface Schema<I = unknown, O = I> {
  readonly "~standard": {
    readonly version: 1;
    readonly validate: (value: unknown) => { value: O; issues?: undefined } | { issues: readonly unknown[] } | Promise<{ value: O; issues?: undefined } | { issues: readonly unknown[] }>;
    readonly types?: { readonly input: I; readonly output: O } | undefined;
  };
}

type Input<S> = S extends Schema<infer I, unknown> ? I : never;
type Output<S> = S extends Schema<unknown, infer O> ? O : never;
type OptionalOutput<S> = S extends Schema ? Output<S> : undefined;

export class ApiError extends Error {
  constructor(public readonly code: string, public readonly status: number, message = code) {
    super(message);
    this.name = "ApiError";
  }
}

/**
 * The session family was revoked or its id replaced. It is the abort reason of
 * `RequestContext.signal` and answers `401 SESSION_REVOKED`.
 */
export class SessionRevokedError extends ApiError {
  constructor() {
    super("SESSION_REVOKED", 401, "Session revoked");
    this.name = "SessionRevokedError";
  }
}

/** Preserve public errors loaded through separate Vite module graphs; hide all others. */
export function normalizeServerError(error: unknown): ApiError {
  if (error instanceof SessionSecurityError) return new ApiError(error.code, 403);
  if (error instanceof Error && (error.name === "SessionSecurityError" || error.constructor.name === "SessionSecurityError")) {
    const code = (error as Error & { code?: unknown }).code;
    if (code === "INVALID_ORIGIN" || code === "INVALID_CSRF") return new ApiError(code, 403);
  }
  if (error instanceof Error && (error instanceof ApiError || error.name === "ApiError" || error.constructor.name === "ApiError" || error.name === "SessionRevokedError")) {
    const candidate = error as Error & { code?: unknown; status?: unknown };
    if (typeof candidate.code === "string" && candidate.code.length > 0
      && typeof candidate.status === "number" && Number.isInteger(candidate.status)
      && candidate.status >= 400 && candidate.status <= 599) {
      return error instanceof ApiError ? error : new ApiError(candidate.code, candidate.status);
    }
  }
  return new ApiError("INTERNAL_ERROR", 500);
}

export type ServerErrorObserver = (error: unknown, requestId: string) => void;

function reportObserverFailure(error: unknown, observerError: unknown, requestId?: string): void {
  try {
    const label = requestId ? `Meeko server error observer failed (${requestId})` : "Meeko server error observer failed";
    // Error messages and custom properties may contain private server data.
    console.error(label, { original: error instanceof Error ? "Error" : typeof error, observer: observerError instanceof Error ? "Error" : typeof observerError });
  } catch { /* The fallback logger cannot change the original response. */ }
}

/** Observer failures cannot replace a response or escape as unhandled rejections. */
export function observeErrorCallback(error: unknown, observer?: (error: unknown) => void, requestId?: string): void {
  try { void Promise.resolve(observer?.(error)).catch((observerError: unknown) => reportObserverFailure(error, observerError, requestId)); }
  catch (observerError) { reportObserverFailure(error, observerError, requestId); }
}

/** Apply the same isolation to observers that also receive a request ID. */
export function observeServerError(error: unknown, requestId: string, observer?: ServerErrorObserver): void {
  observeErrorCallback(error, observer ? (failure) => observer(failure, requestId) : undefined, requestId);
}

/** Surface internal failures to the host while keeping observers out of the response path. */
export function reportServerError(error: unknown, requestId: string, observer?: ServerErrorObserver): void {
  if (normalizeServerError(error).status < 500) return;
  observeServerError(error, requestId, observer);
}

export interface ApiRouteDefinition<P extends Schema | undefined, Q extends Schema | undefined, B extends Schema | undefined, R extends Schema | undefined, S = unknown> {
  params?: P;
  query?: Q;
  body?: B;
  response?: R;
  auth?: "required" | "optional";
  contentType?: "json" | "response";
  authorize?: (context: RequestContext<S>) => boolean | Promise<boolean>;
  handler: (args: { params: OptionalOutput<P>; query: OptionalOutput<Q>; body: OptionalOutput<B>; context: RequestContext<S> }) => Promise<R extends Schema ? Output<R> : Response> | (R extends Schema ? Output<R> : Response);
}

export function defineApiRoute<P extends Schema | undefined = undefined, Q extends Schema | undefined = undefined, B extends Schema | undefined = undefined, R extends Schema | undefined = undefined, S = unknown>(definition: ApiRouteDefinition<P, Q, B, R, S>): ApiRouteDefinition<P, Q, B, R, S> {
  return definition;
}

export interface RpcDefinition<I extends Schema, O extends Schema, S = unknown> {
  input: I;
  output: O;
  auth?: "required" | "optional";
  authorize?: (context: RequestContext<S>) => boolean | Promise<boolean>;
  handler: (args: { input: Output<I>; context: RequestContext<S> }) => Promise<Input<O> | Output<O>> | Input<O> | Output<O>;
}

export function defineRpc<I extends Schema, O extends Schema, S = unknown>(definition: RpcDefinition<I, O, S>): RpcDefinition<I, O, S> {
  return definition;
}

async function validate<S extends Schema>(schema: S, value: unknown, label: string): Promise<Output<S>> {
  const result = await schema["~standard"].validate(value);
  if ("issues" in result && result.issues) throw new ApiError(`INVALID_${label.toUpperCase()}`, label === "response" || label === "output" ? 500 : 400);
  return (result as { value: Output<S> }).value;
}

async function readJson(request: Request, maxBytes = 1024 * 1024): Promise<unknown> {
  if (!request.headers.get("content-type")?.toLowerCase().startsWith("application/json")) throw new ApiError("UNSUPPORTED_MEDIA_TYPE", 415);
  const reader = request.body?.getReader();
  if (!reader) throw new ApiError("INVALID_JSON", 400);
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
  try { return JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes)) as unknown; }
  catch { throw new ApiError("INVALID_JSON", 400); }
}

function queryObject(url: URL): Record<string, string | string[]> {
  const result: Record<string, string | string[]> = Object.create(null);
  for (const [key, value] of url.searchParams) {
    const previous = result[key];
    result[key] = previous === undefined ? value : Array.isArray(previous) ? [...previous, value] : [previous, value];
  }
  return result;
}

async function guard<S>(definition: { auth?: "required" | "optional"; authorize?: (context: RequestContext<S>) => boolean | Promise<boolean> }, context: RequestContext<S>, sessions: SessionManager, mutating?: boolean): Promise<void> {
  sessions.assertMutationAllowed(context.request, context.session, mutating);
  if (definition.auth === "required" && !context.session.current) throw new ApiError("UNAUTHENTICATED", 401);
  if (definition.authorize && !(await definition.authorize(context))) throw new ApiError("FORBIDDEN", 403);
}

export async function executeApiRoute<P extends Schema | undefined, Q extends Schema | undefined, B extends Schema | undefined, R extends Schema | undefined, S>(definition: ApiRouteDefinition<P, Q, B, R, S>, context: RequestContext<S>, sessions: SessionManager, rawParams: unknown = {}): Promise<Response> {
  await guard(definition, context, sessions);
  const params = definition.params ? await validate(definition.params, rawParams, "params") : undefined;
  const query = definition.query ? await validate(definition.query, queryObject(new URL(context.request.url)), "query") : undefined;
  const body = definition.body ? await validate(definition.body, await readJson(context.request), "body") : undefined;
  const result = await definition.handler({ params: params as OptionalOutput<P>, query: query as OptionalOutput<Q>, body: body as OptionalOutput<B>, context });
  if (definition.contentType === "response") {
    if (!(result instanceof Response)) throw new ApiError("INVALID_RESPONSE", 500);
    return result;
  }
  if (!definition.response) throw new ApiError("MISSING_RESPONSE_SCHEMA", 500);
  const output = await validate(definition.response, result, "response");
  return new Response(serializeJson(output), { headers: { "content-type": "application/json; charset=utf-8" } });
}

export async function executeRpc<I extends Schema, O extends Schema, S>(definition: RpcDefinition<I, O, S>, rawInput: unknown, context: RequestContext<S>, sessions: SessionManager): Promise<Output<O>> {
  await guard(definition, context, sessions, true);
  const input = await validate(definition.input, rawInput, "input");
  const result = await definition.handler({ input, context });
  const output = await validate(definition.output, result, "output");
  serializeJson(output);
  return output;
}

export function errorResponse(error: unknown, requestId: string): Response {
  const known = normalizeServerError(error);
  return new Response(serializeJson({ code: known.code, status: known.status, requestId }), { status: known.status, headers: { "content-type": "application/json; charset=utf-8", "x-request-id": requestId } });
}

function finish(response: Response, context: RequestContext): Response {
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

export async function dispatchApiRoute<P extends Schema | undefined, Q extends Schema | undefined, B extends Schema | undefined, R extends Schema | undefined, S>(definition: ApiRouteDefinition<P, Q, B, R, S>, context: RequestContext<S>, sessions: SessionManager, params: unknown = {}, onError?: ServerErrorObserver): Promise<Response> {
  try { return finish(await executeApiRoute(definition, context, sessions, params), context); }
  catch (error) { reportServerError(error, context.requestId, onError); return finish(errorResponse(error, context.requestId), context); }
}

export async function dispatchRpc<I extends Schema, O extends Schema, S>(definition: RpcDefinition<I, O, S>, context: RequestContext<S>, sessions: SessionManager, onError?: ServerErrorObserver): Promise<Response> {
  try {
    if (context.request.method !== "POST") throw new ApiError("METHOD_NOT_ALLOWED", 405);
    const output = await executeRpc(definition, await readJson(context.request), context, sessions);
    return finish(new Response(serializeJson(output), { headers: { "content-type": "application/json; charset=utf-8" } }), context);
  } catch (error) { reportServerError(error, context.requestId, onError); return finish(errorResponse(error, context.requestId), context); }
}
