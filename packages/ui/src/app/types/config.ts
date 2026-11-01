import type { UIMessageOverrides } from './messages'

/** Variantes de acciones visuales; los enlaces conservan su semántica de navegación. */
export type UIActionVariant = 'primary' | 'secondary' | 'outline' | 'ghost'
export type UIActionSize = 'sm' | 'md' | 'lg'
export type UIActionShape = 'rounded' | 'pill'
export type UICardVariant = 'outline' | 'soft' | 'solid' | 'elevated'

/** Valores por defecto por aplicación; las props explícitas tienen prioridad. */
export interface UIDefaults {
	readonly button?: { readonly variant?: UIActionVariant; readonly size?: UIActionSize; readonly shape?: UIActionShape }
	readonly link?: { readonly variant?: UIActionVariant; readonly size?: UIActionSize; readonly shape?: UIActionShape }
	readonly card?: { readonly variant?: UICardVariant }
}

/**
 * Sustituciones de los tokens `--ui-*` para una aplicación; admiten valores CSS o referencias a sus
 * variables. `packages/ui/DESIGN.md` explica cada token.
 *
 * @example
 * ```ts
 * export default defineMeekoConfig({
 * 	modules: ['@meekojs/ui'],
 * 	ui: { tokens: { primary: 'var(--brand)', radius: '0.5rem' } },
 * })
 * ```
 */
export interface UITokens {
	/** @deprecated Sólo llega al alias `--meeko-ui-accent`; las acciones y las cards usan `primary`. */
	readonly accent?: string
	/** @deprecated Sólo llega al alias `--meeko-ui-accent-hover`; usa `primaryHover`. */
	readonly accentHover?: string
	/** @deprecated Sólo llega al alias `--meeko-ui-on-accent`; usa `onPrimary`. */
	readonly onAccent?: string
	readonly primary?: string
	readonly primaryHover?: string
	readonly onPrimary?: string
	readonly surface?: string
	readonly surfaceHover?: string
	readonly text?: string
	readonly textSoft?: string
	readonly muted?: string
	readonly border?: string
	readonly borderStrong?: string
	readonly controlPadding?: string
	readonly danger?: string
	readonly focus?: string
	readonly radius?: string
	readonly font?: string
	readonly controlHeight?: string
	readonly controlWeight?: string
	readonly controlFontSize?: string
	readonly accentSoft?: string
	readonly accentText?: string
}

/** Configuración del módulo UI en `meeko.config.ts`. */
export interface UIOptions {
	readonly tokens?: UITokens
	readonly defaults?: UIDefaults
	/**
	 * Carga la base global de UI: reset, `body`, selección y foco, en la capa `ui-base`, que cualquier
	 * regla sin capa de la aplicación sobrescribe. `true` por defecto; `false` la omite y la aplicación
	 * escribe la suya.
	 */
	readonly base?: boolean
	/**
	 * Idioma de los textos propios de los componentes sin `@meekojs/i18n` (`"es"` por defecto). Con
	 * ese módulo manda el idioma del documento y éste es el respaldo de un idioma sin textos.
	 */
	readonly locale?: string
	/** Textos por idioma: sobrescriben los del paquete (`es`, `en`) o añaden otros idiomas. */
	readonly messages?: Readonly<Record<string, UIMessageOverrides>>
}
