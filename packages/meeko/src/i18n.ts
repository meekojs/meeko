/** Applications may augment this interface with their generated or hand-written keys. */
export interface GeneratedI18nMessages {}
export { createI18n, localeOf, localizedPath } from "./modules/i18n/index.js";
export { i18nContext } from "./shared/i18n.js";
export { useI18n } from "./app/composables/useI18n.js";
export type { I18n } from "./shared/i18n.js";
