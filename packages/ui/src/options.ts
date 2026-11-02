import type { UIDefaults, UIOptions, UITokens } from './app/types/config'
import type { UIMessageOverrides, UIMessages, UIMessagesConfig } from './app/types/messages'

import { builtinMessages, canonicalLocale } from './app/utils/messages'

/**
 * The variables each option sets. `surface` and `surfaceHover` predate the split into surfaces and
 * controls, so they set every one of them.
 */
const tokenNames = {
	primary: ['--ui-color-primary'],
	primaryHover: ['--ui-color-primary-hover'],
	onPrimary: ['--ui-color-primary-contrast'],
	surface: ['--ui-color-surface', '--ui-color-surface-raised', '--ui-color-control'],
	surfaceHover: ['--ui-color-control-hover', '--ui-color-control-active'],
	text: ['--ui-color-text'],
	textSoft: ['--ui-color-text-soft'],
	muted: ['--ui-color-text-soft'],
	border: ['--ui-color-border'],
	borderStrong: ['--ui-color-border-strong'],
	danger: ['--ui-color-danger', '--ui-color-danger-text'],
	focus: ['--ui-color-focus'],
	radius: ['--ui-radius-md'],
	font: ['--ui-font-sans'],
	controlPadding: ['--ui-control-padding-md'],
	controlHeight: ['--ui-control-height-md'],
	controlWeight: ['--ui-control-font-weight'],
	controlFontSize: ['--ui-control-font-size'],
	accentSoft: ['--ui-color-primary-soft'],
	accentText: ['--ui-color-primary-text'],
} satisfies Record<keyof UITokens, readonly string[]>

function object(value: unknown, name: string): asserts value is Record<string, unknown> {
	if (!value || typeof value !== 'object' || Array.isArray(value)) throw new TypeError(`ui: ${name} must be an object`)
}

const localeTag = /^[A-Za-z]{2,3}(?:-[A-Za-z0-9]{1,8})*$/

/** A language tag that `Intl` accepts too: the regular expression alone lets `en-u` through. */
const validLocale = (locale: string): boolean => localeTag.test(locale) && canonicalLocale(locale) !== undefined

function text(value: unknown, name: string): void {
	if (typeof value !== 'string' || !value.trim()) throw new TypeError(`ui: ${name} must be a non-empty string`)
}

function validateMessages(messages: unknown): void {
	object(messages, 'messages')
	const known = builtinMessages.es as UIMessages
	const seen = new Set<string>()
	for (const [locale, sections] of Object.entries(messages)) {
		if (!validLocale(locale)) throw new TypeError(`ui: invalid locale ${locale} in messages`)
		// `EN` and `en` are one language: only one of them could win.
		const canonical = canonicalLocale(locale)!
		if (seen.has(canonical)) throw new TypeError(`ui: locale ${canonical} is repeated in messages`)
		seen.add(canonical)
		object(sections, `messages.${locale}`)
		for (const [section, entries] of Object.entries(sections)) {
			if (!Object.hasOwn(known, section)) throw new TypeError(`ui: unknown messages section ${section}`)
			object(entries, `messages.${locale}.${section}`)
			for (const [key, value] of Object.entries(entries)) {
				const name = `messages.${locale}.${section}.${key}`
				if (!Object.hasOwn(known[section as keyof UIMessages], key)) throw new TypeError(`ui: unknown message ${name}`)
				if (key !== 'labels') {
					text(value, name)
					continue
				}
				object(value, name)
				for (const [theme, label] of Object.entries(value)) text(label, `${name}.${theme}`)
			}
		}
	}
}

/** Valida opciones antes de escribir CSS o serializar defaults al cliente. */
export function validateOptions(options: UIOptions): void {
	object(options, 'options')
	for (const key of Object.keys(options)) if (!['tokens', 'defaults', 'locale', 'messages', 'base'].includes(key)) throw new TypeError(`ui: unknown option ${key}`)
	if (options.base !== undefined && typeof options.base !== 'boolean') throw new TypeError('ui: base must be a boolean')
	if (options.locale !== undefined && (typeof options.locale !== 'string' || !validLocale(options.locale))) throw new TypeError('ui: locale must be a language tag such as "en" or "pt-BR"')
	if (options.messages !== undefined) validateMessages(options.messages)
	if (options.tokens !== undefined) {
		object(options.tokens, 'tokens')
		for (const [key, value] of Object.entries(options.tokens)) {
			if (!Object.hasOwn(tokenNames, key)) throw new TypeError(`ui: unknown token ${key}`)
			if (typeof value !== 'string' || !value.trim() || /[;{}\r\n]/.test(value)) throw new TypeError(`ui: invalid CSS value for tokens.${key}`)
		}
	}
	if (options.defaults !== undefined) {
		object(options.defaults, 'defaults')
		for (const [component, settings] of Object.entries(options.defaults)) {
			if (!['button', 'link', 'card'].includes(component)) throw new TypeError(`ui: unknown defaults component ${component}`)
			object(settings, `defaults.${component}`)
			for (const [key, value] of Object.entries(settings)) {
				const allowed = key === 'variant' ? (component === 'card' ? ['outline', 'soft', 'solid', 'elevated'] : ['primary', 'secondary', 'outline', 'ghost']) : component !== 'card' && key === 'size' ? ['sm', 'md', 'lg'] : component !== 'card' && key === 'shape' ? ['rounded', 'pill'] : []
				if (!allowed.includes(value as string)) throw new TypeError(`ui: invalid defaults.${component}.${key}`)
			}
		}
	}
}

/**
 * `ui.locale` y `ui.messages` ya validados, con cada idioma en su forma canónica (`EN` es `en` y
 * `pt-br` es `pt-BR`), que es como los busca `resolveUIMessages`.
 */
export function messagesConfig(options: UIOptions): UIMessagesConfig {
	return {
		...(options.locale !== undefined ? { locale: canonicalLocale(options.locale)! } : {}),
		...(options.messages !== undefined ? { messages: Object.fromEntries(Object.entries(options.messages).map(([locale, messages]) => [canonicalLocale(locale)!, messages])) } : {}),
	}
}

/** CSS de variables, aplicado después de los valores claros/oscuros del paquete. */
export function tokenStyles(tokens: UITokens | undefined): string {
	const entries = Object.entries(tokens ?? {}) as Array<[keyof UITokens, string]>
	return entries.length ? `\n:root, :root[data-theme] {\n${entries.flatMap(([key, value]) => tokenNames[key].map((name) => `  ${name}: ${value};`)).join('\n')}\n}\n` : ''
}

export type { UIDefaults, UIMessageOverrides, UIMessages, UIOptions, UITokens }
