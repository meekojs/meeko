export interface GeneratedI18nMessages {}
/** Etiquetas de cada mensaje con marcado; lo genera el módulo desde los catálogos. */
export interface GeneratedI18nTags {}
/** Idiomas de los catálogos; lo genera el módulo. */
export interface GeneratedI18nLocales {}
export { createI18n, localeOf, localizedPath, negotiateLocale, readLocaleCookie, stripLocale } from './runtime'
export type { CreateI18nOptions, I18nCookie } from './runtime'
export { localeAlternates } from './routing'
export type { LocaleAlternate } from './routing'
export { i18nContext } from './context'
export type { I18n, I18nDirection, I18nMessageKey, I18nMessageTags, I18nMessageValues, I18nRichPart, I18nTranslateOptions, I18nValue } from './context'
export { useI18n } from './use-i18n'
