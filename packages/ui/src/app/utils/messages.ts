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
	page: { skip: 'Saltar al contenido' },
	header: { label: 'Navegación principal', menu: 'Menú' },
	footer: { label: 'Enlaces del pie' },
	drawer: { close: 'Cerrar panel' },
	navigationTree: { label: 'Navegación de la sección', featured: 'Destacado', empty: 'Sin resultados' },
	navigationTabs: { label: 'Secciones' },
	breadcrumb: { label: 'Ruta de navegación' },
	pageNavigation: { label: 'Páginas anterior y siguiente', previous: 'Anterior', next: 'Siguiente' },
	pagination: { label: 'Paginación', count: '{shown} de {total}', total: '{total} en total', loadMore: 'Cargar más', loading: 'Cargando…' },
	tableOfContents: { label: 'En esta página' },
	language: { label: 'Idioma', suggestion: 'Sugerencia de idioma', message: 'Esta página también está en {language}.', go: 'Leer en {language}', stay: 'Seguir en {language}' },
	code: { label: 'Código', log: 'Registro', copy: 'Copiar', copied: 'Copiado', copyFailed: 'No se pudo copiar', good: 'Correcto', bad: 'Incorrecto' },
	diff: { empty: 'Sin cambios.', added: 'Añadido:', removed: 'Eliminado:' },
	markdownEditor: {
		loading: 'Cargando el editor…',
		mode: 'Modo de edición',
		visual: 'Visual',
		code: 'Código',
		unsafe: 'El modo visual reescribiría partes de este documento que no has tocado. Edítalo en modo código.',
		failed: 'No se pudo cargar el editor visual. Puedes seguir en modo código.',
		placeholder: 'Escribe, o pulsa / para insertar un bloque',
		groupText: 'Texto',
		text: 'Párrafo',
		heading: 'Título',
		quote: 'Cita',
		divider: 'Separador',
		groupList: 'Listas',
		bulletList: 'Lista con viñetas',
		orderedList: 'Lista numerada',
		taskList: 'Lista de tareas',
		groupAdvanced: 'Avanzado',
		codeBlock: 'Bloque de código',
		table: 'Tabla',
		bold: 'Negrita',
		italic: 'Cursiva',
		strikethrough: 'Tachado',
		inlineCode: 'Código',
		link: 'Enlace',
		linkPlaceholder: 'Pega un enlace…',
		languageSearch: 'Buscar lenguaje',
		languageEmpty: 'Sin resultados',
		copy: 'Copiar',
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
	page: { skip: 'Skip to content' },
	header: { label: 'Main navigation', menu: 'Menu' },
	footer: { label: 'Footer links' },
	drawer: { close: 'Close panel' },
	navigationTree: { label: 'Section navigation', featured: 'Featured', empty: 'No results' },
	navigationTabs: { label: 'Sections' },
	breadcrumb: { label: 'Breadcrumb' },
	pageNavigation: { label: 'Previous and next pages', previous: 'Previous', next: 'Next' },
	pagination: { label: 'Pagination', count: '{shown} of {total}', total: '{total} in total', loadMore: 'Load more', loading: 'Loading…' },
	tableOfContents: { label: 'On this page' },
	language: { label: 'Language', suggestion: 'Language suggestion', message: 'This page is also available in {language}.', go: 'Read in {language}', stay: 'Stay in {language}' },
	code: { label: 'Code', log: 'Log', copy: 'Copy', copied: 'Copied', copyFailed: 'Could not copy', good: 'Correct', bad: 'Incorrect' },
	diff: { empty: 'No changes.', added: 'Added:', removed: 'Removed:' },
	markdownEditor: {
		loading: 'Loading the editor…',
		mode: 'Editing mode',
		visual: 'Visual',
		code: 'Code',
		unsafe: 'The visual mode would rewrite parts of this document you did not touch. Edit it in code mode.',
		failed: 'The visual editor could not be loaded. You can carry on in code mode.',
		placeholder: 'Write, or press / to insert a block',
		groupText: 'Text',
		text: 'Paragraph',
		heading: 'Heading',
		quote: 'Quote',
		divider: 'Divider',
		groupList: 'Lists',
		bulletList: 'Bullet list',
		orderedList: 'Numbered list',
		taskList: 'Task list',
		groupAdvanced: 'Advanced',
		codeBlock: 'Code block',
		table: 'Table',
		bold: 'Bold',
		italic: 'Italic',
		strikethrough: 'Strikethrough',
		inlineCode: 'Code',
		link: 'Link',
		linkPlaceholder: 'Paste a link…',
		languageSearch: 'Search language',
		languageEmpty: 'No results',
		copy: 'Copy',
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
		page: { ...messages.page, ...layer.page },
		header: { ...messages.header, ...layer.header },
		footer: { ...messages.footer, ...layer.footer },
		drawer: { ...messages.drawer, ...layer.drawer },
		navigationTree: { ...messages.navigationTree, ...layer.navigationTree },
		navigationTabs: { ...messages.navigationTabs, ...layer.navigationTabs },
		breadcrumb: { ...messages.breadcrumb, ...layer.breadcrumb },
		pageNavigation: { ...messages.pageNavigation, ...layer.pageNavigation },
		pagination: { ...messages.pagination, ...layer.pagination },
		tableOfContents: { ...messages.tableOfContents, ...layer.tableOfContents },
		language: { ...messages.language, ...layer.language },
		code: { ...messages.code, ...layer.code },
		diff: { ...messages.diff, ...layer.diff },
		markdownEditor: { ...messages.markdownEditor, ...layer.markdownEditor },
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

/**
 * The texts of any locale, for a component that speaks a language other than the document's: read the
 * configuration once in the setup and call the result with the locale. `translated` says whether that
 * locale has texts of its own, so the markup does not claim `lang` over a fallback.
 */
export function uiMessagesFor(): (locale: string) => { readonly messages: LocalizedUIMessages; readonly translated: boolean } {
	const config = optional(uiMessagesKey)
	return (locale) => {
		const tags = localeChain(canonicalLocale(locale) ?? '')
		return { messages: resolveUIMessages(locale, config), translated: tags.some((tag) => own(builtinMessages, tag) !== undefined || own(config?.messages, tag) !== undefined) }
	}
}

/** Fills the `{name}` placeholders of a text. */
export function fillMessage(template: string, values: Readonly<Record<string, string>>): string {
	return template.replace(/\{(\w+)\}/g, (match, name: string) => values[name] ?? match)
}

/** `{current}` and `{next}` of the `cycle` text of `<UIThemeToggle>`. */
export function themeCycleLabel(template: string, current: string, next: string): string {
	return template.replaceAll('{current}', () => current).replaceAll('{next}', () => next)
}
