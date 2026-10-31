import type { ContextKey } from "@meekojs/meeko";
import type { GeneratedI18nMessages } from "./index";

type MessageKey = keyof GeneratedI18nMessages extends never ? string : keyof GeneratedI18nMessages & string;
type Values = Readonly<Record<string, string | number | boolean | null | undefined>>;

/** Valores de interpolación y selectores admitidos por los catálogos generados. */
export type I18nValue = string | number | boolean;
/** Argumentos de un mensaje: los catálogos antiguos con `true` mantienen su contrato abierto. */
export type I18nMessageValues<K extends MessageKey> = K extends keyof GeneratedI18nMessages
  ? GeneratedI18nMessages[K] extends true ? Values : GeneratedI18nMessages[K]
  : Values;
type TranslationArgs<K extends MessageKey> = K extends keyof GeneratedI18nMessages
  ? GeneratedI18nMessages[K] extends true ? [values?: Values]
    : keyof GeneratedI18nMessages[K] extends never ? [values?: Readonly<Record<string, never>>]
      : [values: GeneratedI18nMessages[K]]
  : [values?: Values];

export interface I18n {
  readonly locale: string;
  t<K extends MessageKey>(key: K, ...args: TranslationArgs<NoInfer<K>>): string;
  number(value: number, options?: Intl.NumberFormatOptions): string;
  date(value: Date | number, options?: Intl.DateTimeFormatOptions): string;
  /** Navigates to the same path under another locale. */
  switchLocale(locale: string): void;
}

// The module plugin may be bundled separately from applications importing this subpath.
export const i18nContext = Symbol.for("meeko.i18n") as ContextKey<I18n>;
