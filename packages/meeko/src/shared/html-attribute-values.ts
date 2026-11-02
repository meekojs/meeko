import type { ariaAttributes } from './html-data/aria'
import type { htmlElementAttributes, htmlGlobalAttributes } from './html-data/attributes'

/**
 * Values of each HTML attribute, as types, from the HTML data that `scripts/html-data.ts`
 * generates (`src/shared/html-data`). Only types: the data stays out of every bundle.
 *
 * In 1.x a value type offers the values of the standard to completion and hover without narrowing
 * what an attribute accepts: `type` of `<button>` is `"submit" | "reset" | "button"` plus any other
 * value. A string literal outside the values is the warning MEEK122 (see {@link AttributeLiteralCheck});
 * 2.0 makes the closed values strict.
 */

type ElementData = typeof htmlElementAttributes
type GlobalData = typeof htmlGlobalAttributes
type AriaData = typeof ariaAttributes

/** The global or ARIA data of the attribute `Name`, or `undefined`. */
type SharedData<Name extends string> = Name extends keyof GlobalData ? GlobalData[Name] : Name extends keyof AriaData ? AriaData[Name] : undefined

/** The data of the attribute `Name` on `Tag`: its own, or else the global or ARIA one. Distributive over `Tag`. */
type AttributeDataOf<Tag extends string, Name extends string> = Tag extends keyof ElementData ? (Name extends keyof ElementData[Tag] ? ElementData[Tag][Name] : SharedData<Name>) : SharedData<Name>

/** The closed values of an attribute's data: its `values`, unless they are suggestions or tokens of a list. */
type ClosedValues<Data> = Data extends { readonly values: readonly (infer Value extends string)[] } ? (Data extends { readonly freeform: true } | { readonly tokens: true } | { readonly type: 'token list' } ? never : Value) : never

/**
 * Valores que el estándar HTML admite en el atributo `Name` de la etiqueta `Tag`, como unión de
 * literales: `"submit" | "reset" | "button"` en `type` de `<button>`, `"" | "hidden" | "until-found"`
 * en `hidden`, `"true" | "false" | "mixed" | "undefined"` en `aria-pressed`. `never` en un atributo de
 * texto libre, en uno cuyos valores son sugerencias (`freeform`) o una lista de palabras (`rel`,
 * `class`), y en una etiqueta o un atributo que los datos HTML no conocen. Con una unión de
 * etiquetas, los valores de cualquiera de ellas.
 *
 * @typeParam Tag Etiqueta o unión de etiquetas.
 * @typeParam Name Nombre del atributo, en minúsculas.
 * @since 1.8.0
 * @example
 * ```ts
 * import type { AttributeValues } from "@meekojs/meeko";
 * type ButtonType = AttributeValues<"button", "type">; // "submit" | "reset" | "button"
 * const kinds: readonly ButtonType[] = ["submit", "reset"];
 * ```
 */
export type AttributeValues<Tag extends string, Name extends string> = ClosedValues<AttributeDataOf<Tag, Name>>

/**
 * Lo que acepta un atributo HTML: `string`, `number` y `boolean` (`true` lo escribe vacío) y
 * `null`, `undefined` o `false` para omitirlo. `string & {}` en vez de `string` conserva en el
 * completado los literales que se le unen.
 */
type HintedAttributeValue = (string & {}) | number | boolean | null | undefined

/**
 * Valor de un atributo HTML del elemento `Tag`: cualquier valor de atributo, como antes de `1.8`,
 * con los valores del estándar ({@link AttributeValues}) como sugerencias para el completado y el
 * hover. Es el tipo de cada clave de `ElementAttributes<Tag>`.
 *
 * @typeParam Tag Etiqueta o unión de etiquetas.
 * @typeParam Name Nombre del atributo.
 * @since 1.8.0
 * @example
 * ```ts
 * import type { AttributeValueOf } from "@meekojs/meeko";
 * // El editor sugiere "submit", "reset" y "button"; cualquier texto sigue siendo válido.
 * const type: AttributeValueOf<"button", "type"> = "submit";
 * ```
 */
export type AttributeValueOf<Tag extends string, Name extends string> = AttributeValues<Tag, Name> | HintedAttributeValue

/**
 * A type error whose text carries a Meeko code: an object with that text as its only key, which no
 * value is assignable to.
 */
type TypeMessage<Text extends string> = { readonly [Key in Text]: never }

/** Whether every member of the string type `Text` is a literal: `"a" | "b"`, not `string` nor `${number}px`. */
type IsLiteral<Text extends string> = [Text] extends [never] ? false : {} extends Record<Text, 1> ? false : true

/**
 * `unknown` when `Value` is a valid value of the attribute `Name` of `Tag`; otherwise the text of
 * the warning MEEK122, which the type check reports and `meeko check` turns into a warning. Only a
 * string literal, or a union of them, that shares no value with {@link AttributeValues} warns,
 * compared without case like HTML: `type="sumbit"` or `bind:type="'sumbit'"` on `<button>`. A
 * `string`, a number, a boolean, `null`, `undefined` or an attribute with free text never warn.
 */
export type AttributeLiteralCheck<Tag extends string, Name extends string, Value> = [AttributeValues<Tag, Name>] extends [never] ? unknown : IsLiteral<Extract<Value, string>> extends false ? unknown : [Extract<Lowercase<Extract<Value, string>>, Lowercase<AttributeValues<Tag, Name>>>] extends [never] ? TypeMessage<`MEEK122: ${Name} de <${Tag}> no admite ese valor`> : unknown
