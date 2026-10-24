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
  }
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
  const known = error instanceof ApiError ? error : error instanceof SessionSecurityError ? new ApiError(error.code, 403) : new ApiError("INTERNAL_ERROR", 500);
  return new Response(serializeJson({ code: known.code, status: known.status, requestId }), { status: known.status, headers: { "content-type": "application/json; charset=utf-8", "x-request-id": requestId } });
}

function finish(response: Response, context: RequestContext): Response {
  response.headers.set("x-request-id", context.requestId);
  if (context.session.cookieHeader) response.headers.append("set-cookie", context.session.cookieHeader);
  if (context.session.current) response.headers.set("x-meeko-csrf-token", context.session.current.csrfToken);
  return response;
}

export async function dispatchApiRoute<P extends Schema | undefined, Q extends Schema | undefined, B extends Schema | undefined, R extends Schema | undefined, S>(definition: ApiRouteDefinition<P, Q, B, R, S>, context: RequestContext<S>, sessions: SessionManager, params: unknown = {}): Promise<Response> {
  try { return finish(await executeApiRoute(definition, context, sessions, params), context); }
  catch (error) { return finish(errorResponse(error, context.requestId), context); }
}

export async function dispatchRpc<I extends Schema, O extends Schema, S>(definition: RpcDefinition<I, O, S>, context: RequestContext<S>, sessions: SessionManager): Promise<Response> {
  try {
    if (context.request.method !== "POST") throw new ApiError("METHOD_NOT_ALLOWED", 405);
    const output = await executeRpc(definition, await readJson(context.request), context, sessions);
    return finish(new Response(serializeJson(output), { headers: { "content-type": "application/json; charset=utf-8" } }), context);
  } catch (error) { return finish(errorResponse(error, context.requestId), context); }
}
