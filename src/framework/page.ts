/** Browser-safe subset of Standard Schema v1, implemented by Valibot schemas. */
import type { StateStore } from "./state.js";

export interface PageSchema<I = unknown, O = I> {
  readonly "~standard": {
    readonly version: 1;
    readonly validate: (value: unknown) =>
      | { value: O; issues?: undefined }
      | { issues: readonly unknown[] }
      | Promise<{ value: O; issues?: undefined } | { issues: readonly unknown[] }>;
    readonly types?: { readonly input: I; readonly output: O } | undefined;
  };
}

type Output<S> = S extends PageSchema<unknown, infer O> ? O : never;
type Params<P> = P extends PageSchema ? Output<P> : Readonly<Record<string, string>>;
type Search<S> = S extends PageSchema ? Output<S> : Readonly<Record<string, string | string[]>>;

export interface PageLoadContext<P extends PageSchema | undefined, S extends PageSchema | undefined, C = unknown> {
  readonly params: Params<P>;
  readonly search: Search<S>;
  readonly request: Request;
  readonly signal: AbortSignal;
  readonly state: StateStore;
  readonly context?: C;
}

export interface PageDefinition<P extends PageSchema | undefined, S extends PageSchema | undefined, D, C = unknown> {
  readonly params?: P;
  readonly search?: S;
  readonly render?: "ssr" | "prerender";
  readonly prerenderEntries?: readonly Readonly<Record<string, string>>[] | (() => Promise<readonly Readonly<Record<string, string>>[]>);
  readonly load?: (args: PageLoadContext<P, S, C>) => Promise<D> | D;
  readonly head?: (args: PageLoadContext<P, S, C> & { data: D }) => { title?: string };
}

/** Captures route schemas and keeps loader/head inference in one declaration. */
export function definePage<
  const P extends PageSchema | undefined = undefined,
  const S extends PageSchema | undefined = undefined,
  D = unknown,
  C = unknown,
>(definition: PageDefinition<P, S, D, C> & { readonly load: NonNullable<PageDefinition<P, S, D, C>["load"]> }): PageDefinition<P, S, D, C> & { readonly load: NonNullable<PageDefinition<P, S, D, C>["load"]> };
export function definePage<
  const P extends PageSchema | undefined = undefined,
  const S extends PageSchema | undefined = undefined,
  D = unknown,
  C = unknown,
>(definition: PageDefinition<P, S, D, C>): PageDefinition<P, S, D, C>;
export function definePage(definition: unknown): unknown {
  if (typeof definition === "object" && definition !== null && "render" in definition && definition.render === "client") {
    throw new TypeError('render: "client" is not supported; use SSR or prerender');
  }
  return definition;
}

export class PageInputError extends Error {
  constructor(public readonly code: "INVALID_PARAMS" | "INVALID_SEARCH") {
    super(code);
  }
}

function record(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

async function parse(schema: PageSchema | undefined, raw: Record<string, unknown>, code: PageInputError["code"]): Promise<Record<string, unknown>> {
  if (!schema) return raw;
  const result = await schema["~standard"].validate(raw);
  if ("issues" in result && result.issues) throw new PageInputError(code);
  const value = (result as { value: unknown }).value;
  if (!record(value)) throw new PageInputError(code);
  return value;
}

/** Validates both inputs before a page loader executes. */
export async function validatePageInputs(
  definition: Pick<PageDefinition<PageSchema | undefined, PageSchema | undefined, unknown>, "params" | "search"> | undefined,
  params: Readonly<Record<string, string>>,
  search: Readonly<Record<string, string | string[]>>,
): Promise<{ params: Readonly<Record<string, unknown>>; search: Readonly<Record<string, unknown>> }> {
  return {
    params: await parse(definition?.params, { ...params }, "INVALID_PARAMS"),
    search: await parse(definition?.search, { ...search }, "INVALID_SEARCH"),
  };
}

/** Preserves duplicate search keys for schema validation. */
export function pageSearchObject(searchParams: URLSearchParams): Record<string, string | string[]> {
  const result: Record<string, string | string[]> = Object.create(null);
  for (const [key, value] of searchParams) {
    const previous = result[key];
    result[key] = previous === undefined ? value : Array.isArray(previous) ? [...previous, value] : [previous, value];
  }
  return result;
}
