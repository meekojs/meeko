import type { ContextKey } from "@meekojs/meeko";

import type { GeneratedI18nMessages, GeneratedI18nTags } from "./index";

/**
 * Clave de un mensaje: las de los catálogos del proyecto, que genera el módulo, o cualquier texto
 * sin catálogos generados.
 *
 * @since 0.1.0
 * @example
 * ```ts
 * import type { I18nMessageKey } from "@meekojs/i18n";
 *
 * const key: I18nMessageKey = "nav.guide";
 * ```
 */
export type I18nMessageKey = keyof GeneratedI18nMessages extends never ? string : keyof GeneratedI18nMessages & string;
type MessageKey = I18nMessageKey;
type Values = Readonly<Record<string, string | number | boolean | null | undefined>>;

/**
 * Etiquetas de un mensaje (`<code>…</code>`), que `<I18nT>` pide como snippets. Con una clave
 * dinámica, las de todas sus alternativas.
 *
 * @typeParam K Clave del mensaje.
 * @since 0.1.0
 * @example
 * ```ts
 * import type { I18nMessageTags } from "@meekojs/i18n";
 *
 * // Con "footer.built": "Hecho con <code>.meeko</code>", es "code".
 * type Tags = I18nMessageTags<"footer.built">;
 * ```
 */
export type I18nMessageTags<K extends I18nMessageKey> = K extends keyof GeneratedI18nTags ? GeneratedI18nTags[K] & string : never;

/**
 * Trozo de un mensaje con marcado, como lo devuelve `i18n.rich()`: texto sin más o, con `tag`, el
 * contenido de una etiqueta. `text` es siempre texto, nunca HTML.
 *
 * @since 0.1.0
 * @example
 * ```ts
 * import type { I18nRichPart } from "@meekojs/i18n";
 *
 * const parts: I18nRichPart[] = [{ text: "Pulsa " }, { tag: "kbd", text: "Esc" }, { text: " para salir." }];
 * ```
 */
export interface I18nRichPart {
  /** Texto del trozo, con sus parámetros ya sustituidos. */
  readonly text: string;
  /** Nombre de la etiqueta que lo envuelve, si la hay. */
  readonly tag?: string;
}

/**
 * Opciones de `t()` y `rich()`.
 *
 * @since 0.1.0
 * @example
 * ```ts
 * import type { I18nTranslateOptions } from "@meekojs/i18n";
 *
 * const options: I18nTranslateOptions = { locale: "en" };
 * ```
 */
export interface I18nTranslateOptions {
  /**
   * Idioma del mensaje, si no es el del documento. Sólo los namespaces de `multilingual` están
   * cargados en todos los idiomas; otra clave se trata como un mensaje sin cargar.
   */
  readonly locale?: string;
}

/** Valores de interpolación y selectores admitidos por los catálogos generados. */
export type I18nValue = string | number | boolean;
/** Dirección del texto de un idioma. */
export type I18nDirection = "ltr" | "rtl";
/** Argumentos de un mensaje: los catálogos antiguos con `true` mantienen su contrato abierto. */
type DeclaredValues<K extends MessageKey> = K extends keyof GeneratedI18nMessages
  ? GeneratedI18nMessages[K] extends true ? Values : GeneratedI18nMessages[K]
  : Values;
type Intersection<U> = (U extends unknown ? (value: U) => void : never) extends (value: infer Combined) => void ? Combined : never;
/** Una clave dinámica necesita valores válidos para todas sus alternativas posibles. */
export type I18nMessageValues<K extends MessageKey> = keyof Intersection<DeclaredValues<K>> extends never ? Readonly<Record<string, never>> : Intersection<DeclaredValues<K>>;
type RequiredMessages<K extends MessageKey> = K extends keyof GeneratedI18nMessages
  ? GeneratedI18nMessages[K] extends true ? never : keyof GeneratedI18nMessages[K] extends never ? never : K
  : never;
type TranslationArgs<K extends MessageKey> = [RequiredMessages<K>] extends [never]
  ? [values?: I18nMessageValues<K>, options?: I18nTranslateOptions]
  : [values: I18nMessageValues<K>, options?: I18nTranslateOptions];

/**
 * Traductor de un documento, que devuelve `useI18n()`. El idioma no cambia dentro de un documento:
 * cambiar de idioma es una navegación completa.
 */
export interface I18n {
  /** Idioma del documento, leído del prefijo de la URL. */
  readonly locale: string;
  /** Idioma de las URL sin prefijo. */
  readonly defaultLocale: string;
  /** Idiomas configurados, en el orden de `catalogs`. */
  readonly locales: readonly string[];
  /** Dirección del idioma del documento. */
  readonly dir: I18nDirection;
  /**
   * Mensaje traducido de `key`, con sus valores tipados desde los catálogos. Con `{ locale }`, en
   * otro idioma, para los namespaces de `multilingual`. Devuelve el texto tal cual: las etiquetas de
   * un mensaje sólo las interpreta `<I18nT>`.
   */
  t<K extends MessageKey>(key: K, ...args: TranslationArgs<NoInfer<K>>): string;
  /**
   * El mensaje de `key` partido por sus etiquetas, la base de `<I18nT>`. Sólo el texto del catálogo
   * forma etiquetas: un valor con `<` sigue siendo texto.
   */
  rich<K extends MessageKey>(key: K, ...args: TranslationArgs<NoInfer<K>>): readonly I18nRichPart[];
  /**
   * Si `key` tiene mensaje en los catálogos ya cargados, para una clave que llega de un dato (el código
   * de error de un servidor) sin mantener una lista aparte. Un namespace que aún no se ha cargado da
   * `false`, igual que para `t()`. Con `{ locale }`, en otro idioma, para los namespaces de
   * `multilingual`. Estrecha `key` a {@link I18nMessageKey}.
   *
   * @param key Clave que se comprueba.
   * @param options Idioma, si no es el del documento.
   * @returns `true` si `t(key)` encontraría su mensaje.
   * @throws {RangeError} Si `options.locale` no es un idioma configurado.
   * @since 0.1.0
   * @example
   * ```ts
   * const { has, t } = useI18n();
   * const text = has(`errors.${code}`) ? t(`errors.${code}` as "errors.UNKNOWN") : t("errors.generic");
   * ```
   */
  has(key: string, options?: I18nTranslateOptions): key is MessageKey;
  /** Número con `Intl.NumberFormat` del idioma. */
  number(value: number, options?: Intl.NumberFormatOptions): string;
  /** Fecha con `Intl.DateTimeFormat` del idioma; fija `timeZone` si SSR y navegador deben coincidir. */
  date(value: Date | number, options?: Intl.DateTimeFormatOptions): string;
  /**
   * Ruta interna en un idioma (por defecto, el del documento): `/guide` da `/en/guide` en inglés y
   * `/guide` en el idioma por defecto. Acepta rutas con o sin prefijo, búsqueda y fragmento.
   */
  localePath(path: string, locale?: string): string;
  /** Ruta equivalente de la página actual en otro idioma, con su búsqueda y fragmento. Es reactiva. */
  switchLocalePath(locale: string): string;
  /**
   * Idiomas que tienen versión de la página actual, en el orden configurado: todos en una ruta
   * localizada, los de `partial` que la incluyen, o sólo el actual en una ruta excluida. Es reactiva.
   */
  pageLocales(): readonly string[];
  /** Nombre de un idioma, por defecto en ese mismo idioma (`"English"`, `"Español"`), para un selector. */
  localeName(locale: string, displayLocale?: string): string;
  /** Dirección de un idioma configurado. */
  directionOf(locale: string): I18nDirection;
  /**
   * Idioma que el lector probablemente prefiere, si no es el del documento: la cookie del idioma
   * elegido y, sin ella, `navigator.languages`. Sólo en el navegador; en el servidor devuelve
   * `undefined`. Llámalo en `onMounted` para mostrar una sugerencia: nunca redirige.
   */
  suggestedLocale(): string | undefined;
  /** Guarda `locale` en la cookie del idioma elegido, por ejemplo al descartar una sugerencia. */
  rememberLocale(locale: string): void;
  /** Guarda el idioma en la cookie y navega a la ruta equivalente en `locale` (documento nuevo). */
  switchLocale(locale: string): void;
}

// The module plugin may be bundled separately from applications importing this subpath.
export const i18nContext = Symbol.for("meeko.i18n") as ContextKey<I18n>;
