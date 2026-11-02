import type { TrustedHtml } from "../../shared/trusted-html";

import { documentHtmlPlaceholder } from "../../shared/document-html";

/** The values of the current request marked with `documentHtml`, when a page is rendering. */
let marks: (() => Set<string> | undefined) | undefined;

/** @internal Binds `documentHtml` to the active request. */
export function provideDocumentHtmlMarks(provider: () => Set<string> | undefined): void {
  marks = provider;
}

/**
 * Declara que un HTML de confianza sólo necesita viajar una vez: en el HTML del documento. Sin esto,
 * un `html="expresión"` con un dato de la página llega dos veces en la primera carga, en el HTML y
 * en el payload de hidratación, y un artículo grande pesa el doble.
 *
 * Con la marca, el documento lleva en el payload un marcador en lugar del valor, y la hidratación
 * adopta el contenido del elemento sin leerlo ni reescribirlo. Las navegaciones de cliente siguen
 * recibiendo el valor completo. Si esa página vuelve a pintar el elemento, por ejemplo un `if:` que
 * se cierra y se abre, el navegador pide el valor al servidor: el DOM nunca aporta HTML.
 *
 * Sólo es para un valor que se lee en `html="..."`. **En el navegador de esa primera carga el valor
 * es el marcador**, así que `{doc.html.length}` o un `computed` que lo analice no darían lo mismo que
 * en el servidor: para eso, use `trustHtml` sin más. El valor viaja completo, como siempre, si
 * `html` no lo pintó en el documento (un `if:` cerrado) o si el SSR dejó el elemento vacío porque el
 * navegador sacaría su contenido. Fuera de una petición de página devuelve el valor sin marcarlo.
 *
 * @param html HTML ya declarado de confianza con `trustHtml`.
 * @returns El mismo `html`, sin copiarlo.
 * @since 1.8.0
 * @example
 * ```html
 * <script server lang="ts">
 * import { trustHtml } from "@meekojs/meeko";
 * import { documentHtml } from "@meekojs/meeko/framework";
 * import { renderGuide } from "../server/guides";
 *
 * const { params } = usePage();
 * export const guide = { body: documentHtml(trustHtml(await renderGuide(params.slug))) };
 * </script>
 *
 * <template>
 *   <article html="guide.body"></article>
 * </template>
 * ```
 * @see https://github.com/meekojs/meeko/blob/main/docs/api.md#html-que-viaja-una-vez-documenthtml
 */
export function documentHtml(html: TrustedHtml): TrustedHtml {
  // An empty value renders nothing and a placeholder would be truthy: `if:when="html"` would differ.
  if (html) marks?.()?.add(html);
  return html;
}

/** The parts of a payload that carry data of the page, the only ones that hold a value of `html`. */
const dataParts = ["props", "state", "sharedState", "resources", "layoutProps", "deferred"] as const;

/**
 * The payload of a document without the values that are marked and that its HTML already shows: each
 * becomes a placeholder, and `documentHtml` lists where the navigation payload of that URL has it.
 * `undefined` when no value qualifies, so a page that does not use the mark costs nothing.
 */
export function withoutDocumentHtml(payload: Readonly<Record<string, unknown>>, rendered: ReadonlySet<string>): Record<string, unknown> | undefined {
  const marked = marks?.();
  if (!marked?.size) return undefined;
  const positions = new Map<string, number>();
  const paths: (readonly (string | number)[])[] = [];
  const replace = (value: unknown, path: readonly (string | number)[]): unknown => {
    if (typeof value === "string") {
      if (!marked.has(value) || !rendered.has(value)) return value;
      let position = positions.get(value);
      if (position === undefined) {
        position = paths.length;
        positions.set(value, position);
        paths.push(path);
      }
      return documentHtmlPlaceholder(position);
    }
    if (Array.isArray(value)) return value.map((item, index) => replace(item, [...path, index]));
    if (value === null || typeof value !== "object") return value;
    return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, replace(item, [...path, key])]));
  };
  const parts = dataParts.filter((part) => payload[part] !== undefined).map((part) => [part, replace(payload[part], [part])]);
  return paths.length ? { ...payload, ...Object.fromEntries(parts), documentHtml: paths } : undefined;
}
