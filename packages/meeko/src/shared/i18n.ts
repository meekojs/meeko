import type { ContextKey } from "../core/reactivity.js";
import type { GeneratedI18nMessages } from "../i18n.js";

type MessageKey = keyof GeneratedI18nMessages extends never ? string : keyof GeneratedI18nMessages & string;
type Values = Readonly<Record<string, string | number | boolean | null | undefined>>;

export interface I18n {
  readonly locale: string;
  t(key: MessageKey, values?: Values): string;
  number(value: number, options?: Intl.NumberFormatOptions): string;
  date(value: Date | number, options?: Intl.DateTimeFormatOptions): string;
  /** Navigates to the same path under another locale. */
  switchLocale(locale: string): void;
}

// The module plugin may be bundled separately from applications importing this subpath.
export const i18nContext = Symbol.for("meeko.i18n") as ContextKey<I18n>;
