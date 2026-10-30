/**
 * `TrustedHtml`, the type that `html="expression"` expects, and `trustHtml`, which declares it.
 *
 * The brand exists only in types: at run time a `TrustedHtml` is the same `string`, so it survives
 * the JSON payload of a page and costs nothing. `meeko check` and the editor warn (`MEEK107`) when
 * the value of `html` is a `string` without the brand.
 */

/** Marca de tipo de {@link TrustedHtml}. Sólo existe en los tipos; no hay ningún símbolo en ejecución. */
declare const trustedHtmlBrand: unique symbol;

/**
 * Un `string` de HTML que el código declaró de confianza con {@link trustHtml}: el tipo que espera
 * la directiva `html="expresión"` para no avisar con `MEEK107`.
 *
 * La marca sólo existe en los tipos: en ejecución es el mismo `string`, así que se serializa en
 * JSON tal cual y llega a la plantilla con la marca intacta desde `<script server>`, `load` o
 * `ServerData<T>`. Un `TrustedHtml` se puede usar donde se espera un `string`, pero no al revés.
 *
 * **La marca no sanea nada**: sólo dice que alguien comprobó el origen del HTML. Márquelo donde
 * nace (el renderizador de Markdown propio, el resultado de un saneador como DOMPurify), no justo
 * antes de la plantilla.
 *
 * @since 1.3.0
 * @example
 * ```ts
 * import { trustHtml } from "@meekojs/meeko";
 * import type { TrustedHtml } from "@meekojs/meeko";
 *
 * export interface Article {
 *   readonly title: string;
 *   readonly body: TrustedHtml;
 * }
 *
 * export function article(title: string, html: string): Article {
 *   // `html` sale de nuestro propio renderizador de Markdown.
 *   return { title, body: trustHtml(html) };
 * }
 * ```
 * @see https://github.com/meekojs/meeko/blob/main/docs/api.md#html-sin-escapar-con-html
 */
export type TrustedHtml = string & { readonly [trustedHtmlBrand]: true };

/**
 * Declara que `html` es HTML de confianza y lo devuelve con el tipo {@link TrustedHtml}, que la
 * directiva `html="expresión"` acepta sin avisar (`MEEK107`). En ejecución devuelve el mismo
 * `string`, sin copiarlo ni comprobarlo: no tiene coste.
 *
 * **`trustHtml` no sanea: sólo declara.** No escapa ni filtra nada. Si el HTML puede contener
 * texto de usuarios o de terceros, sanéelo antes con una biblioteca como
 * [DOMPurify](https://github.com/cure53/DOMPurify) y marque el resultado; si no, ese contenido
 * puede ejecutar scripts en la página (XSS). Para texto, use `{expresión}`, que escapa.
 *
 * @param html HTML que el código ya sabe seguro: propio o saneado.
 * @returns El mismo `html`, con el tipo `TrustedHtml`.
 * @since 1.3.0
 * @example
 * ```ts
 * import DOMPurify from "isomorphic-dompurify";
 * import { trustHtml } from "@meekojs/meeko";
 *
 * // Contenido de usuarios: primero se sanea y después se declara de confianza.
 * export const comment = trustHtml(DOMPurify.sanitize(input));
 *
 * // Contenido propio, como el Markdown del repositorio renderizado en el build: basta con declararlo.
 * export const intro = trustHtml(markdownDeConfianza);
 * ```
 * ```html
 * <template>
 *   <article html="intro"></article>
 *   <div class="comment" html="comment"></div>
 * </template>
 * ```
 * @see https://github.com/meekojs/meeko/blob/main/docs/api.md#html-sin-escapar-con-html
 */
export function trustHtml(html: string): TrustedHtml {
  return html as TrustedHtml;
}

/**
 * The type text of the `MEEK107` warning, short so that TypeScript never truncates it. `meeko check`
 * reads the `MEEK107: ` prefix and reports the long message, as a warning.
 */
export type UntrustedHtmlMessage = "MEEK107: html inserta un string sin escapar; márquelo con trustHtml(…) o use {expr}";

/**
 * Members of `T` that `html` warns about: strings that are neither `TrustedHtml` nor finite literal
 * types. `{} extends Record<M, 1>` holds for `string` and template literal patterns
 * (`` `<b>${string}</b>` ``), whose record is an index signature, and fails for a literal, whose
 * record has a required key. Other members (numbers, objects, `unknown`) are left to the `string`
 * type of `rawHtml`, which already reports them as errors.
 */
type UntrustedHtmlMembers<T> = T extends TrustedHtml | null | undefined ? never
  : T extends string ? ({} extends Record<T, 1> ? T : never)
  : never;

/**
 * `unknown` when the value of `html="expression"` may be inserted without a warning, and
 * `UntrustedHtmlMessage` otherwise: a `string` without the `TrustedHtml` brand, a template literal
 * pattern, or `any`, which says nothing about where the HTML comes from.
 */
export type TrustedHtmlCheck<T> = 0 extends 1 & T ? UntrustedHtmlMessage
  : [UntrustedHtmlMembers<T>] extends [never] ? unknown
  : UntrustedHtmlMessage;

/**
 * Type check that `meeko check` wraps around the value of `html="expression"` (never in the
 * modules that run): `trust` is `true`, which is not assignable to `UntrustedHtmlMessage`, so an
 * untrusted value fails with that type text, reported as the `MEEK107` warning. `const T` keeps a
 * literal written in the template, such as `html="'<br>'"`, as a literal type.
 */
export function checkTrustedHtml<const T>(value: T, trust: TrustedHtmlCheck<T>): T {
  void trust;
  return value;
}
