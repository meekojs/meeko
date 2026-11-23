import type { ariaAttributes } from './html-data/aria'
import type { htmlElementAttributes, htmlGlobalAttributes } from './html-data/attributes'
import type { svgElementAttributes, svgGlobalAttributes } from './html-data/svg'

/**
 * Values of each native attribute, HTML and SVG, as types, from the data that `scripts/html-data.ts`
 * generates (`src/shared/html-data`). Only types: the data stays out of every bundle. Completion,
 * hover, `bind:attr`, `bind="obj"`, `ElementAttributes<Tag>` and the check of static attributes all
 * read the same data, in the editor and in `meeko check`.
 *
 * A tag is an HTML element (`"button"`), an SVG one (`"circle"`) or, for the four names that both
 * have (`a`, `script`, `style`, `title`), the SVG one with the prefix `svg:` (`"svg:a"`), which the
 * compiler writes for every element inside `<svg>`.
 *
 * In 1.x a value type offers the values of the standard to completion and hover without narrowing
 * what an attribute accepts: `type` of `<button>` is `"submit" | "reset" | "button"` plus any other
 * value, and `null` or `undefined` always leave an attribute out. A string literal outside the
 * values is the warning MEEK122 (see {@link AttributeLiteralCheck}), member by member in a union;
 * the strict mode (`check.attributeValues: "strict"`) also refuses a wide type such as `string`
 * (see {@link AttributeStrictCheck}), and 2.0 makes it the default.
 */

type ElementData = typeof htmlElementAttributes
type GlobalData = typeof htmlGlobalAttributes
type AriaData = typeof ariaAttributes
type SvgElementData = typeof svgElementAttributes
type SvgGlobalData = typeof svgGlobalAttributes

/** The global or ARIA data of the HTML attribute `Name`, or `undefined`. */
type SharedData<Name extends string> = Name extends keyof GlobalData ? GlobalData[Name] : Name extends keyof AriaData ? AriaData[Name] : undefined

/** The global or ARIA data of the SVG attribute `Name`, or `undefined`. */
type SvgSharedData<Name extends string> = Name extends keyof SvgGlobalData ? SvgGlobalData[Name] : Name extends keyof AriaData ? AriaData[Name] : undefined

/**
 * The SVG element that `Tag` names, or `never` for an HTML or custom element: `"svg:a"` is `"a"`,
 * and a name that only SVG has (`"circle"`) is itself.
 */
export type SvgTagOf<Tag extends string> = Tag extends `svg:${infer Name}` ? Name : Tag extends keyof ElementData ? never : Tag extends keyof SvgElementData ? Tag : never

/** The data of the attribute `Name` on `Tag`: its own, or else the global or ARIA one. Distributive over `Tag`. */
type AttributeDataOf<Tag extends string, Name extends string> = Tag extends string ? ([SvgTagOf<Tag>] extends [never] ? (Tag extends keyof ElementData ? (Name extends keyof ElementData[Tag] ? ElementData[Tag][Name] : SharedData<Name>) : SharedData<Name>) : SvgTagOf<Tag> extends keyof SvgElementData ? (Name extends keyof SvgElementData[SvgTagOf<Tag>] ? SvgElementData[SvgTagOf<Tag>][Name] : SvgSharedData<Name>) : SvgSharedData<Name>) : never

/** The closed values of an attribute's data: the `values` of an `enum`, and what starts with one of its `prefixes`. */
type ClosedValues<Data> = Data extends { readonly kind: 'enum'; readonly values: readonly (infer Value extends string)[] } ? Value | (Data extends { readonly prefixes: readonly (infer Prefix extends string)[] } ? `${Prefix}${string}` : never) : never

/** What a boolean attribute may be written with: the empty string or its own name. */
type PresenceValues<Data, Name extends string> = Data extends { readonly kind: 'boolean' } ? '' | Name : never

/**
 * Valores que el estándar admite en el atributo `Name` de la etiqueta `Tag`, HTML o SVG, como unión
 * de literales: `"submit" | "reset" | "button"` en `type` de `<button>`, `"toggle" | "show" | "hide"`
 * en `popovertargetaction`, `"" | "hidden" | "until-found"` en `hidden`, `"true" | "false" | "mixed" |
 * "undefined"` en `aria-pressed`, `"userSpaceOnUse" | "objectBoundingBox"` en `gradientUnits` de
 * `<linearGradient>`. En `command` incluye además los comandos propios (`--${string}`). `never` en
 * un atributo de texto libre o de ID (`popovertarget`), en uno cuyos valores son sugerencias
 * (`freeform`) o una lista de palabras (`rel`, `class`), y en una etiqueta o un atributo que los
 * datos no conocen. Con una unión de etiquetas, los valores de cualquiera de ellas.
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
 * Valor de `class`, con la semántica de `clsx`: un texto o un número; un objeto cuyas claves son
 * clases que se aplican si su valor es verdadero; o arrays, también anidados, de cualquiera de
 * ellos. Los fragmentos se unen con espacios en su orden. `null`, `undefined`, los booleanos y los
 * textos vacíos se omiten. Una función, un símbolo o una señal sin `.value` no son clases.
 *
 * @since 1.10.0
 * @example
 * ```ts
 * import type { ClassValue } from "@meekojs/meeko";
 * const active = true;
 * // Se escribe como class="button button--active rounded".
 * const classes: ClassValue = ["button", { "button--active": active, "button--busy": false }, [null, "", "rounded"]];
 * ```
 */
export type ClassValue = HintedAttributeValue | { readonly [name: string]: HintedAttributeValue } | readonly ClassValue[]

/**
 * Valor de `style`: texto CSS o un objeto cuyas claves son propiedades CSS en camelCase,
 * kebab-case o variables personalizadas (`--color`). Los valores `false`, `null` y `undefined`
 * omiten la declaración; los números se escriben sin añadir unidades.
 *
 * @since 1.10.0
 * @example
 * ```ts
 * import type { StyleValue } from "@meekojs/meeko";
 * const hidden = false;
 * // Se escribe como style="background-color: red; --gap: 4px; z-index: 2".
 * const style: StyleValue = { backgroundColor: "red", "--gap": "4px", zIndex: 2, display: hidden && "none" };
 * ```
 */
export type StyleValue = HintedAttributeValue | Readonly<Record<string, string | number | false | null | undefined>>

/**
 * Valor de un atributo nativo, HTML o SVG, del elemento `Tag`: cualquier valor de atributo, como
 * antes de `1.8`, con los valores del estándar ({@link AttributeValues}) como sugerencias para el
 * completado y el hover. `null` y `undefined` omiten cualquier atributo. Es el tipo de cada clave de
 * `ElementAttributes<Tag>`; {@link StrictAttributeValueOf} es su forma estricta.
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
export type AttributeValueOf<Tag extends string, Name extends string> = AttributeValues<Tag, Name> | (Name extends 'class' ? ClassValue : Name extends 'style' ? StyleValue : HintedAttributeValue)

/**
 * Valor de un atributo nativo del elemento `Tag` según su semántica en el estándar, sin los valores
 * amplios que {@link AttributeValueOf} admite por compatibilidad. Un atributo de conjunto cerrado
 * sólo acepta sus valores: `"toggle" | "show" | "hide"` en `popovertargetaction`, con `boolean` si
 * `"true"` y `"false"` están entre ellos (`draggable`, `aria-pressed`), y `boolean`, `""` o su
 * nombre en un atributo booleano (`disabled`). `false`, `null` y `undefined` siempre lo omiten. Los
 * demás atributos (texto, IDs, listas, números, `class` y `style`) son los de `AttributeValueOf`.
 * Es el tipo que comprueba el modo estricto (`check.attributeValues: "strict"`).
 *
 * @typeParam Tag Etiqueta o unión de etiquetas.
 * @typeParam Name Nombre del atributo.
 * @since 1.10.0
 * @example
 * ```ts
 * import type { StrictAttributeValueOf } from "@meekojs/meeko";
 * let action: StrictAttributeValueOf<"button", "popovertargetaction"> = "show";
 * action = null; // omite el atributo
 * // @ts-expect-error "shwo" no es un valor de popovertargetaction.
 * action = "shwo";
 * ```
 */
export type StrictAttributeValueOf<Tag extends string, Name extends string> = StrictValue<AttributeDataOf<Tag, Name>, Tag, Name>

type StrictValue<Data, Tag extends string, Name extends string> = Data extends { readonly kind: 'boolean' } ? boolean | '' | Name | null | undefined : Data extends { readonly kind: 'enum' } ? ClosedValues<Data> | (['true' | 'false'] extends [ClosedValues<Data>] ? boolean : Name extends 'hidden' ? boolean : false) | null | undefined : AttributeValueOf<Tag, Name>

/**
 * A type error whose text carries a Meeko code: an object with that text as its only key, which no
 * value is assignable to.
 */
type TypeMessage<Text extends string> = { readonly [Key in Text]: never }

/** The members of `Value` that are string literals: `"a"`, not `string` nor `${number}px`. Distributive. */
type LiteralMembers<Value> = Value extends string ? (string extends Value ? never : {} extends Record<Value, 1> ? never : Value) : never

/** `Text` as the attribute compares it: without case in HTML, as written in SVG. */
type Compared<Text extends string, Tag extends string> = [SvgTagOf<Tag>] extends [never] ? Lowercase<Text> : Text

/** The values that the data of an attribute close: an `enum`'s, or the two of a boolean attribute. */
type CheckedValues<Tag extends string, Name extends string> = AttributeValues<Tag, Name> | PresenceValues<AttributeDataOf<Tag, Name>, Name>

/** The literals among `Member` that are not one of `Valid`. Distributive over `Member`. */
type OutsideValues<Member extends string, Valid extends string, Tag extends string> = Member extends string ? (Compared<Member, Tag> extends Compared<Valid, Tag> ? never : Member) : never

/** The literals among `Member` that cannot be one ID: the empty string or a text with a space. */
type NotAnId<Member extends string> = Member extends '' | `${string} ${string}` ? Member : never

/**
 * The string literals of `Value` that the attribute `Name` of `Tag` does not admit, one by one:
 * `"shwo"` in `"show" | "shwo" | null` for `popovertargetaction`. Those outside the closed values
 * of an attribute, and for a reference to one element (`popovertarget`) an empty ID or one with
 * spaces. `never` when every literal is valid, and for an attribute with free text.
 */
export type InvalidAttributeLiterals<Tag extends string, Name extends string, Value> = [CheckedValues<Tag, Name>] extends [never] ? ([AttributeDataOf<Tag, Name>] extends [{ readonly kind: 'id' }] ? NotAnId<LiteralMembers<Value>> : never) : OutsideValues<LiteralMembers<Value>, CheckedValues<Tag, Name>, Tag>

/**
 * `unknown` when `Value` is a valid value of the attribute `Name` of `Tag`; otherwise the text of
 * the warning MEEK122 with each invalid literal, which the type check reports and `meeko check`
 * turns into a warning. Every string literal of `Value` is compared on its own, without case in
 * HTML and with it in SVG: `"show" | "shwo" | null` warns about `"shwo"`, and `"show" | null` does
 * not. A `string`, a number, a boolean, `null`, `undefined` or an attribute with free text never warn.
 */
export type AttributeLiteralCheck<Tag extends string, Name extends string, Value> = [InvalidAttributeLiterals<Tag, Name, Value>] extends [never] ? unknown : TypeMessage<`MEEK122: ${Name} de <${Tag}> no admite ${InvalidAttributeLiterals<Tag, Name, Value>}`>

/**
 * The strict check of MEEK122 (`check.attributeValues: "strict"`): besides the invalid literals of
 * {@link AttributeLiteralCheck}, an attribute with a closed set of values refuses a type that is not
 * within {@link StrictAttributeValueOf}, such as `string | null`. An attribute without a closed set
 * is checked as in the default mode.
 */
export type AttributeStrictCheck<Tag extends string, Name extends string, Value> = [InvalidAttributeLiterals<Tag, Name, Value>] extends [never] ? ([CheckedValues<Tag, Name>] extends [never] ? unknown : [Value] extends [StrictAttributeValueOf<Tag, Name>] ? unknown : TypeMessage<`MEEK122: ${Name} de <${Tag}> exige un tipo cerrado`>) : AttributeLiteralCheck<Tag, Name, Value>
