import { serializeJson } from "../../core/server";
import type { RequestContext } from "../runtime/request-context";
import { echoValues, formEncoding, formFlashCookie, formObject, formReturnPath, issueRoot, planFormConversion, sameOriginPath, seeOther } from "../forms/index";
import type { FormFieldValue, ParsedForm } from "../forms/index";
import { isAllowedOrigin, type SessionManager } from "../runtime/sessions";
import { ApiError, InvalidInputError, issuePath, maxPublicIssues, normalizeServerError, publicIssues, reportServerError, sentIssues } from "../errors";
import type { ApiErrorIssue, ServerErrorObserver } from "../errors";
import { defaultMaxBodyBytes, enforceRateLimit, errorResponse, finish, guard, readBounded, readJson, validate } from "../contract-runtime";
import type { Schema, OptionalOutput } from "../schema";
import { successStatuses, type ApiFormOptions, type ApiRouteDefinition, type ApiSuccessStatus } from "./contracts";

/** The fields of a native form, with `_csrf` and `return` apart. */
async function readForm(request: Request, encoding: "urlencoded" | "multipart", maxBytes: number, files: boolean): Promise<ParsedForm> {
  // A declared length over the limit is refused before reading anything.
  const declared = Number(request.headers.get("content-length") ?? "0");
  if (Number.isFinite(declared) && declared > maxBytes) throw new ApiError("BODY_TOO_LARGE", 413);
  const bytes = await readBounded(request, maxBytes) ?? new Uint8Array();
  let entries: Iterable<[string, FormDataEntryValue]>;
  if (encoding === "urlencoded") {
    entries = new URLSearchParams(new TextDecoder().decode(bytes));
  } else {
    try { entries = await new Response(bytes, { headers: { "content-type": request.headers.get("content-type")! } }).formData() as unknown as Iterable<[string, FormDataEntryValue]>; }
    catch { throw new ApiError("INVALID_FORM", 400); }
  }
  return formObject(entries, files);
}

/**
 * Validates a form with the route's `body` schema: first its text; if the schema rejects some
 * fields, once more with the typed reading of those fields (`convertFormValue`). A field whose
 * conversion still fails keeps the messages of its text.
 */
async function validateForm(schema: Schema, fields: Record<string, FormFieldValue>): Promise<{ value: unknown } | { issues: ApiErrorIssue[]; echo: Record<string, unknown> }> {
  const pending = schema["~standard"].validate(fields);
  // An asynchronous schema may have side effects (a lookup, a uniqueness check): it runs once, so
  // its form fields get no second attempt with the typed reading of their text.
  const asynchronous = typeof (pending as Partial<PromiseLike<unknown>>).then === "function";
  const first = await pending;
  if (!("issues" in first && first.issues)) return { value: (first as { value: unknown }).value };
  const firstIssues = publicIssues(first.issues);
  const plan = asynchronous ? undefined : planFormConversion(fields, first.issues.map((issue) => issueRoot(issuePath((issue as { path?: unknown } | null)?.path))));
  if (!plan) return { issues: firstIssues, echo: fields };
  const second = await schema["~standard"].validate(plan.value);
  if (!("issues" in second && second.issues)) return { value: (second as { value: unknown }).value };
  const failing = new Set(second.issues.map((issue) => issueRoot(issuePath((issue as { path?: unknown } | null)?.path))));
  const issues = [
    ...publicIssues(second.issues).filter((issue) => !plan.converted.has(issueRoot(issue.path))),
    ...firstIssues.filter((issue) => plan.converted.has(issueRoot(issue.path)) && failing.has(issueRoot(issue.path))),
  ].slice(0, maxPublicIssues);
  const echo: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(fields)) echo[key] = plan.converted.has(key) && !failing.has(key) ? plan.value[key] : value;
  return { issues, echo };
}

function queryObject(url: URL): Record<string, string | string[]> {
  const result: Record<string, string | string[]> = Object.create(null);
  for (const [key, value] of url.searchParams) {
    const previous = result[key];
    result[key] = previous === undefined ? value : Array.isArray(previous) ? [...previous, value] : [previous, value];
  }
  return result;
}
/** A misdeclared status is a server fault, reported before any input is read. */
function checkedStatus(definition: { readonly status?: unknown; readonly contentType?: unknown; readonly response?: unknown }): ApiSuccessStatus {
  const status = (definition.status ?? 200) as ApiSuccessStatus;
  if (!successStatuses.has(status) || (definition.status !== undefined && definition.contentType === "response")
    || (status === 204 && definition.response)) throw new ApiError("INVALID_RESPONSE_STATUS", 500);
  return status;
}

/**
 * Ejecuta un endpoint de API con sus guardas y validaciones y devuelve la respuesta JSON, o lanza
 * un `ApiError`. Es la pieza de bajo nivel de {@link dispatchApiRoute}, que además normaliza errores.
 * El orden es: Origin (`origin: "required"`), Origin y CSRF de la sesión, `rateLimit`, `auth`,
 * `authorize`, `params`, `query`, `body`, `locals`, handler y `response`. La respuesta usa el
 * estado de `status` (`200` por defecto); con `204`, sin cuerpo.
 *
 * @param definition Endpoint declarado con `defineApiRoute`.
 * @param context Contexto de la petición.
 * @param sessions Gestor de sesiones, para Origin y CSRF.
 * @param rawParams Parámetros de la ruta sin validar.
 * @returns La respuesta del endpoint.
 * @throws {ApiError} Con `INVALID_ORIGIN`, `RATE_LIMITED`, `UNAUTHENTICATED`, `FORBIDDEN`, `INVALID_PARAMS`, `INVALID_QUERY`,
 * `INVALID_BODY`, `UNSUPPORTED_MEDIA_TYPE`, `BODY_TOO_LARGE`, `INVALID_RATE_LIMIT`, `INVALID_RESPONSE`, `INVALID_RESPONSE_STATUS`
 * (un `status` no admitido o combinado con `contentType: "response"` o, con `204`, con `response`) o los de
 * `locals` y del handler.
 * @example
 * ```ts
 * import { executeApiRoute } from "@meekojs/meeko/server";
 * import userRoute from "./server/api/users/[id].get.js";
 *
 * const response = await executeApiRoute(userRoute, context, sessions, { id: "123" });
 * ```
 */
export async function executeApiRoute<P extends Schema | undefined, Q extends Schema | undefined, B extends Schema | undefined, R extends Schema | undefined, S, L = undefined, T extends ApiSuccessStatus = ApiSuccessStatus>(definition: ApiRouteDefinition<P, Q, B, R, S, L, T>, context: RequestContext<S>, sessions: SessionManager, rawParams: unknown = {}): Promise<Response> {
  const status = checkedStatus(definition);
  await guard(definition, context, sessions);
  const params = definition.params ? await validate(definition.params, rawParams, "params") : undefined;
  const query = definition.query ? await validate(definition.query, queryObject(new URL(context.request.url)), "query") : undefined;
  const body = definition.body ? await validate(definition.body, await readJson(context.request), "body") : undefined;
  const locals = definition.locals ? await definition.locals(context) : undefined;
  const result: unknown = await definition.handler({ params: params as OptionalOutput<P>, query: query as OptionalOutput<Q>, body: body as OptionalOutput<B>, context, locals: locals as L });
  if (definition.contentType === "response") {
    if (!(result instanceof Response)) throw new ApiError("INVALID_RESPONSE", 500);
    return result;
  }
  if (status === 204) {
    if (result !== undefined) throw new ApiError("INVALID_RESPONSE", 500);
    return new Response(null, { status: 204 });
  }
  if (!definition.response) throw new ApiError("MISSING_RESPONSE_SCHEMA", 500);
  const output = await validate(definition.response, result, "response");
  return new Response(serializeJson(output), { status, headers: { "content-type": "application/json; charset=utf-8" } });
}

/**
 * Atiende una petición de API para un host propio: ejecuta el endpoint, normaliza los errores en
 * `{ code, status, requestId }`, informa los fallos 5xx a `onError` y añade `x-request-id`, la
 * cookie de sesión y el token CSRF. Nunca rechaza. Desde `1.7`, si el endpoint declara `form` y
 * la petición es un formulario nativo, responde `303 See Other` con el resultado en una cookie de
 * un solo uso (salvo `403` por Origin o CSRF); `executeApiRoute` sigue aceptando sólo JSON.
 *
 * @param definition Endpoint declarado con `defineApiRoute`.
 * @param context Contexto de la petición.
 * @param sessions Gestor de sesiones.
 * @param params Parámetros de la ruta sin validar.
 * @param onError Observador de los fallos internos.
 * @returns La respuesta final.
 * @example
 * ```ts
 * import { dispatchApiRoute } from "@meekojs/meeko/server";
 * import userRoute from "./server/api/users/[id].get.js";
 *
 * const response = await dispatchApiRoute(userRoute, context, sessions, { id: "123" }, (error, id) => console.error(id, error));
 * ```
 */
export async function dispatchApiRoute<P extends Schema | undefined, Q extends Schema | undefined, B extends Schema | undefined, R extends Schema | undefined, S, L = undefined, T extends ApiSuccessStatus = ApiSuccessStatus>(definition: ApiRouteDefinition<P, Q, B, R, S, L, T>, context: RequestContext<S>, sessions: SessionManager, params: unknown = {}, onError?: ServerErrorObserver): Promise<Response> {
  const encoding = definition.form ? formEncoding(context.request) : undefined;
  if (encoding) return dispatchApiForm(definition, encoding, context, sessions, params, onError);
  try { return finish(await executeApiRoute(definition, context, sessions, params), context); }
  catch (error) { reportServerError(error, context.requestId, onError); return finish(errorResponse(error, context.requestId), context); }
}

/**
 * A native form against an API route with `form`: the same guards, schemas and handler as JSON,
 * but the answer is a `303 See Other` with a single-use cookie for the page it returns to. Only a
 * foreign Origin or a failed CSRF check answers `403` directly: that request is not this site's.
 */
async function dispatchApiForm<P extends Schema | undefined, Q extends Schema | undefined, B extends Schema | undefined, R extends Schema | undefined, S, L, T extends ApiSuccessStatus>(definition: ApiRouteDefinition<P, Q, B, R, S, L, T>, encoding: "urlencoded" | "multipart", context: RequestContext<S>, sessions: SessionManager, rawParams: unknown, onError?: ServerErrorObserver): Promise<Response> {
  const request = context.request;
  const url = new URL(request.url);
  const options: ApiFormOptions<unknown, S> = definition.form === true || !definition.form ? {} : definition.form as ApiFormOptions<unknown, S>;
  let parsed: ParsedForm | undefined;
  let echo: Record<string, unknown> | undefined;
  const echoNames: readonly string[] = Array.isArray(options.echo) ? options.echo.filter((name): name is string => typeof name === "string") : [];
  try {
    const status = checkedStatus(definition);
    // A form needs no preflight, so any site can send one: every native submission needs this
    // site's Origin, which browsers send with each POST, before its body is read.
    if (!isAllowedOrigin(request, sessions.allowedOrigins ?? [])) throw new ApiError("INVALID_ORIGIN", 403);
    const maxBytes = options.maxBytes ?? defaultMaxBodyBytes;
    if (!Number.isSafeInteger(maxBytes) || maxBytes <= 0) throw new ApiError("INVALID_FORM_OPTIONS", 500);
    if (options.echo !== undefined && !(Array.isArray(options.echo) && options.echo.every((name) => typeof name === "string"))) throw new ApiError("INVALID_FORM_OPTIONS", 500);
    // A flood of submissions is limited before any body is read; the CSRF token is in the body.
    if (definition.rateLimit) await enforceRateLimit(definition.rateLimit, context, sessions);
    parsed = await readForm(request, encoding, maxBytes, options.files === true);
    echo = parsed.fields;
    // Read after `return`, so the error goes back to the page of the form.
    if (parsed.rejectedFile) throw new ApiError("FILES_NOT_ALLOWED", 400);
    await guard(definition, context, sessions, undefined, parsed.csrf, true);
    const params = definition.params ? await validate(definition.params, rawParams, "params") : undefined;
    const query = definition.query ? await validate(definition.query, queryObject(url), "query") : undefined;
    let body: unknown;
    if (definition.body) {
      const checked = await validateForm(definition.body, parsed.fields);
      if ("issues" in checked) { echo = checked.echo; throw new InvalidInputError("INVALID_BODY", checked.issues); }
      body = checked.value;
    }
    const locals = definition.locals ? await definition.locals(context) : undefined;
    const result: unknown = await definition.handler({ params: params as OptionalOutput<P>, query: query as OptionalOutput<Q>, body: body as OptionalOutput<B>, context, locals: locals as L });
    let output: unknown;
    if (definition.contentType === "response") {
      if (!(result instanceof Response)) throw new ApiError("INVALID_RESPONSE", 500);
      // Without `redirect`, the handler's own response is the answer.
      if (!options.redirect) return finish(result, context);
      output = result;
    } else if (status === 204) {
      if (result !== undefined) throw new ApiError("INVALID_RESPONSE", 500);
    } else {
      if (!definition.response) throw new ApiError("MISSING_RESPONSE_SCHEMA", 500);
      output = await validate(definition.response, result, "response");
    }
    const location = options.redirect
      ? sameOriginPath(await options.redirect(output, context), url.origin)
      : formReturnPath(parsed.returnTo, request);
    return finish(seeOther(location, formFlashCookie(request, { action: url.pathname, ok: true }, location)), context);
  } catch (error) {
    reportServerError(error, context.requestId, onError);
    const known = normalizeServerError(error);
    if (known.code === "INVALID_ORIGIN" || known.code === "INVALID_CSRF") return finish(errorResponse(error, context.requestId), context);
    const location = formReturnPath(parsed?.returnTo, request);
    const issues = sentIssues(known);
    const flash = {
      action: url.pathname, ok: false, code: known.code, status: known.status, requestId: context.requestId,
      ...(issues ? { issues } : {}),
      // Only the fields the route lists in `form.echo` travel back; by default, none.
      ...(echo && echoNames.length ? { values: echoValues(echo, echoNames) } : {}),
    };
    return finish(seeOther(location, formFlashCookie(request, flash, location)), context);
  }
}

