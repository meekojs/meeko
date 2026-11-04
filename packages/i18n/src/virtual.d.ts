declare module 'virtual:meeko-i18n' {
	import type { I18nDirection } from './context'
	import type { Catalog } from './messages'
	export const catalogs: Readonly<Record<string, Readonly<Record<string, () => Promise<{ default: Catalog }>>>>>
	export const settings: { readonly locales: readonly string[]; readonly defaultLocale: string; readonly directions: Readonly<Record<string, I18nDirection>> }
}
