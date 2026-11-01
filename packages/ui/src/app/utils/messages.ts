import type { ContextKey } from '@meekojs/meeko'

import { createContext, inject } from '@meekojs/meeko'

import type { UIMessageOverrides, UIMessages, UIMessagesConfig } from '../types/messages'

/** The texts of a document, with the locale they were chosen for. */
export interface LocalizedUIMessages extends UIMessages {
	readonly locale: string
}

export const uiMessagesKey = createContext<UIMessagesConfig>('@meekojs/ui/messages')

// The key that @meekojs/i18n publishes: a registered symbol, so UI reads the locale of the document
// without depending on that package. Without the module, the lookup finds no provider.
const i18nKey = Symbol.for('meeko.i18n') as ContextKey<{ readonly locale: string }>

const spanish: UIMessages = {
	modal: { close: 'Cerrar modal' },
	table: { empty: 'No hay datos.' },
	select: { empty: 'Sin resultados', clear: 'Quitar selección' },
	themeToggle: {
		labels: { light: 'Claro', dark: 'Oscuro', system: 'Sistema' },
		unknown: 'Cambiar tema',
		group: 'Tema',
		cycle: 'Tema: {current}. Cambiar a {next}',
	},
}

const english: UIMessages = {
	modal: { close: 'Close modal' },
	table: { empty: 'No data.' },
	select: { empty: 'No results', clear: 'Clear selection' },
	themeToggle: {
		labels: { light: 'Light', dark: 'Dark', system: 'System' },
		unknown: 'Change theme',
		group: 'Theme',
		cycle: 'Theme: {current}. Switch to {next}',
	},
}

/** The texts that come with the package. Spanish is complete and the last fallback of every locale. */
export const builtinMessages: Readonly<Record<string, UIMessages>> = { es: spanish, en: english }

const own = <T>(record: Readonly<Record<string, T>> | undefined, key: string): T | undefined => (record && Object.hasOwn(record, key) ? record[key] : undefined)

/**
 * The canonical form of a language tag (`EN` is `en` and `pt-br` is `pt-BR`), the one the texts are
 * keyed by; `undefined` when it is not a valid tag (`en-u`), which `toLocaleLowerCase` and `Intl` reject.
 */
export function canonicalLocale(locale: string | undefined): string | undefined {
	if (locale === undefined) return undefined
	try {
		return Intl.getCanonicalLocales(locale)[0]
	} catch {
		return undefined
	}
}

/** A locale and its base language, the most general first: `['pt', 'pt-BR']`. */
function localeChain(locale: string): readonly string[] {
	const base = locale.split('-')[0]!
	return base === locale ? [locale] : [base, locale]
}

function merge(messages: UIMessages, layer: UIMessageOverrides | undefined): UIMessages {
	if (!layer) return messages
	return {
		modal: { ...messages.modal, ...layer.modal },
		table: { ...messages.table, ...layer.table },
		select: { ...messages.select, ...layer.select },
		themeToggle: { ...messages.themeToggle, ...layer.themeToggle, labels: { ...messages.themeToggle.labels, ...layer.themeToggle?.labels } },
	}
}

/**
 * The texts of a locale. Each layer overrides the previous one: Spanish, `ui.locale` and then the
 * locale of the document, each with its base language first and the texts of the package below those
 * of `ui.messages`, whose keys the module writes in canonical form. A locale that is not a valid tag
 * counts as absent: a document never fails over its language.
 */
export function resolveUIMessages(locale: string | undefined, config?: UIMessagesConfig): LocalizedUIMessages {
	const fallback = canonicalLocale(config?.locale) ?? 'es'
	const active = canonicalLocale(locale) ?? fallback
	let messages = spanish
	for (const tag of [...localeChain(fallback), ...localeChain(active)]) messages = merge(merge(messages, own(builtinMessages, tag)), own(config?.messages, tag))
	return { ...messages, locale: active }
}

function optional<T>(key: ContextKey<T>): T | undefined {
	try {
		return inject(key)
	} catch {
		return undefined
	}
}

/**
 * The texts for the current document, read once in the setup of a component. The locale of the
 * document never changes without a new document (a link to another language is a full navigation)
 * and comes from the URL or the configuration, so SSR and hydration choose the same texts.
 */
export function uiMessages(): LocalizedUIMessages {
	return resolveUIMessages(optional(i18nKey)?.locale, optional(uiMessagesKey))
}

/** `{current}` and `{next}` of the `cycle` text of `<UIThemeToggle>`. */
export function themeCycleLabel(template: string, current: string, next: string): string {
	return template.replaceAll('{current}', () => current).replaceAll('{next}', () => next)
}
