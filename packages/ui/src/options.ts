import type { UIDefaults, UIOptions, UITokens } from './app/types/config'

const tokenNames = {
	accent: 'accent',
	accentHover: 'accent-hover',
	onAccent: 'on-accent',
	primary: 'primary',
	primaryHover: 'primary-hover',
	onPrimary: 'on-primary',
	surface: 'surface',
	surfaceHover: 'surface-hover',
	text: 'text',
	textSoft: 'text-soft',
	muted: 'muted',
	border: 'border',
	borderStrong: 'border-strong',
	danger: 'danger',
	focus: 'focus',
	radius: 'radius',
	font: 'font',
	controlPadding: 'control-padding',
	controlHeight: 'control-height',
	controlWeight: 'control-weight',
	controlFontSize: 'control-font-size',
	accentSoft: 'accent-soft',
	accentText: 'accent-text',
} satisfies Record<keyof UITokens, string>

function object(value: unknown, name: string): asserts value is Record<string, unknown> {
	if (!value || typeof value !== 'object' || Array.isArray(value)) throw new TypeError(`ui: ${name} must be an object`)
}

/** Valida opciones antes de escribir CSS o serializar defaults al cliente. */
export function validateOptions(options: UIOptions): void {
	object(options, 'options')
	for (const key of Object.keys(options)) if (key !== 'tokens' && key !== 'defaults') throw new TypeError(`ui: unknown option ${key}`)
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

/** CSS de variables, aplicado después de los valores claros/oscuros del paquete. */
export function tokenStyles(tokens: UITokens | undefined): string {
	const entries = Object.entries(tokens ?? {}) as Array<[keyof UITokens, string]>
	return entries.length ? `\n:root, :root[data-theme] {\n${entries.map(([key, value]) => `  --meeko-ui-${tokenNames[key]}: ${value};`).join('\n')}\n}\n` : ''
}

export type { UIDefaults, UIOptions, UITokens }
