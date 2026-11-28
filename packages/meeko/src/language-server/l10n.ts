/**
 * Traducción de los textos de usuario del servidor de lenguaje: hovers, detalles y documentación
 * de completado, títulos de acciones, nombres de símbolos, avisos y zonas de ejecución.
 *
 * El idioma se fija al inicializar la conexión con `InitializeParams.locale` (VS Code envía el
 * suyo) y vale para todo el proceso, que atiende una sola conexión.
 *
 * - Un `locale` explícito que empieza por `es` da español; cualquier otro, inglés.
 * - Sin `locale` (otro editor, `meeko check`, pruebas que llaman a las funciones directamente) el
 *   idioma es el español, el único que el servidor produjo hasta ahora: la salida de la CLI y las
 *   integraciones existentes no cambian.
 *
 * Convenciones que comprueba `tests/language-server-l10n.test.ts`:
 *
 * - Todo texto de usuario de `src/language-server/**` pasa por {@link t}. El primer argumento es
 *   siempre un literal de cadena en la misma llamada, entre comillas simples o dobles: ni
 *   plantillas, ni concatenaciones, ni variables. Es el mensaje en inglés y la clave
 *   del catálogo español de `l10n-es.ts`.
 * - Los valores se interpolan con marcadores `{0}`, `{1}`…; la traducción usa los mismos.
 * - {@link t} se llama al mostrar el texto, no al cargar el módulo: una constante de módulo se
 *   evaluaría antes de conocer el idioma. Las tablas estáticas usan {@link localized} o
 *   propiedades `get`.
 * - Lo que informan el compilador y el analizador (`src/compiler/**`, `meeko check`, los mensajes
 *   con código `MEEK…`) sigue en español: el servidor lo reenvía tal cual y alguna acción rápida
 *   reconoce su texto. Pasarlo por este mecanismo exige un catálogo de mensajes en el compilador.
 *
 * El catálogo es un módulo TypeScript y no un archivo JSON leído en ejecución: el servidor se
 * empaqueta con esbuild en la extensión y también se ejecuta desde `node_modules` del proyecto, y
 * así viaja siempre con el código.
 */
import { spanishMessages } from './l10n-es'

/** Idiomas del servidor. */
export type Locale = 'en' | 'es'

/** Valor que puede sustituir a un marcador `{n}`. */
export type MessageArgument = string | number | boolean

/**
 * Idioma sin `locale` del cliente: el español, que era el único. Cambiarlo cambiaría la salida de
 * la CLI y de los clientes LSP que no envían idioma.
 */
export const defaultLocale: Locale = 'es'

let current: Locale = defaultLocale

/**
 * El idioma de un `locale` de LSP (`en`, `es-ES`, `pt-BR`…): español si empieza por `es`, el
 * idioma por defecto si falta o está vacío, e inglés en cualquier otro caso.
 */
export function resolveLocale(tag: string | null | undefined): Locale {
	const language = typeof tag === 'string' ? tag.trim().toLowerCase() : ''
	if (!language) return defaultLocale
	return language === 'es' || language.startsWith('es-') || language.startsWith('es_') ? 'es' : 'en'
}

/** Fija el idioma del servidor; sin argumento vuelve al idioma por defecto. Devuelve el idioma resuelto. */
export function setLocale(tag?: string | null): Locale {
	current = resolveLocale(tag)
	return current
}

/** Idioma vigente del servidor. */
export function currentLocale(): Locale {
	return current
}

/** Sustituye los marcadores `{n}` de `message`; uno sin argumento se deja como está. */
export function format(message: string, ...args: readonly MessageArgument[]): string {
	return args.length === 0 ? message : message.replace(/\{(\d+)\}/g, (marker, index: string) => (Number(index) < args.length ? String(args[Number(index)]) : marker))
}

/**
 * Traduce un texto de usuario al idioma de la conexión.
 *
 * @param message Mensaje en inglés, que es también la clave del catálogo español.
 * @param args Valores de los marcadores `{0}`, `{1}`…
 */
export function t(message: string, ...args: readonly MessageArgument[]): string {
	return format(current === 'es' ? (spanishMessages[message] ?? message) : message, ...args)
}

/**
 * Memoriza por idioma el valor de una tabla que contiene textos traducidos: `build` se ejecuta
 * una vez por idioma, la primera vez que se pide, y no al cargar el módulo.
 *
 * @param build Construye la tabla; llama a {@link t} y no depende de nada más que del idioma.
 */
export function localized<T>(build: () => T): () => T {
	const cache = new Map<Locale, T>()
	return () => {
		let value = cache.get(current)
		if (value === undefined) {
			value = build()
			cache.set(current, value)
		}
		return value
	}
}

/** Une `items` como «a, b y c» (`a, b and c` en inglés). */
export function joinList(items: readonly string[]): string {
	return items.length < 2 ? (items[0] ?? '') : t('{0} and {1}', items.slice(0, -1).join(', '), items.at(-1)!)
}
