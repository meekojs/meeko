/**
 * Public Standard Schema v1 contract for API, RPC, and Socket.
 * Los schemas de Valibot lo implementan; los públicos viven en `shared/`.
 *
 * @typeParam I Tipo de entrada.
 * @typeParam O Tipo de salida, tras validar y transformar.
 * @example
 * ```ts
 * // shared/schemas/user.ts
 * import * as v from "valibot";
 * import type { Schema } from "@meekojs/meeko/server";
 *
 * export const userSchema: Schema<{ id: string; name: string }> = v.object({ id: v.string(), name: v.string() });
 * ```
 */
export interface Schema<I = unknown, O = I> {
  /** Interfaz Standard Schema v1: `validate` devuelve el valor de salida o la lista de `issues`. */
  readonly "~standard": {
    readonly version: 1;
    readonly validate: (value: unknown) => { value: O; issues?: undefined } | { issues: readonly unknown[] } | Promise<{ value: O; issues?: undefined } | { issues: readonly unknown[] }>;
    readonly types?: { readonly input: I; readonly output: O } | undefined;
  };
}

export type Input<S> = S extends Schema<infer I, unknown> ? I : never;
export type Output<S> = S extends Schema<unknown, infer O> ? O : never;
export type OptionalOutput<S> = S extends Schema ? Output<S> : undefined;
