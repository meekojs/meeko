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

/** Tokens semánticos; admiten valores CSS o referencias a variables de la aplicación. */
export interface UITokens {
	readonly accent?: string
	readonly accentHover?: string
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
	 * Idioma de los textos propios de los componentes sin `@meekojs/i18n` (`"es"` por defecto). Con
	 * ese módulo manda el idioma del documento y éste es el respaldo de un idioma sin textos.
	 */
	readonly locale?: string
	/** Textos por idioma: sobrescriben los del paquete (`es`, `en`) o añaden otros idiomas. */
	readonly messages?: Readonly<Record<string, UIMessageOverrides>>
}
