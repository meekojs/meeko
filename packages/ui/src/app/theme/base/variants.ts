/**
 * Catálogo de variantes compartidas. Solo contiene utilidades de Tailwind sobre los tokens del tema.
 *
 * `variant` y `color` no llevan clases por sí solos: cada pareja es una entrada de `compoundVariants`
 * (`colors.ts` para los colores semánticos y `hues.ts` para los tonos crudos opcionales).
 */
export const variants = {
	variant: {
		solid: '',
		soft: '',
		outline: '',
		ghost: '',
		surface: '',
		subtle: '',
		link: '',
		plain: '',
		glass: '',
	},

	color: {
		primary: '',
		secondary: '',
		neutral: '',
		success: '',
		info: '',
		warning: '',
		danger: '',
	},

	/** Tamaños de controles: alto mínimo, relleno y texto de los tokens `--ui-control-*`. */
	size: {
		xs: 'min-h-(--ui-control-height-xs) p-(--ui-control-padding-xs) text-control-xs',
		sm: 'min-h-(--ui-control-height-sm) p-(--ui-control-padding-sm) text-control-sm',
		md: 'min-h-(--ui-control-height-md) p-(--ui-control-padding-md) text-control-md',
		lg: 'min-h-(--ui-control-height-lg) p-(--ui-control-padding-lg) text-control-lg',
		xl: 'min-h-(--ui-control-height-xl) p-(--ui-control-padding-xl) text-control-xl',
	},

	radius: {
		none: 'rounded-none',
		xs: 'rounded-xs',
		sm: 'rounded-sm',
		md: 'rounded-md',
		lg: 'rounded-lg',
		xl: 'rounded-xl',
		'2xl': 'rounded-2xl',
		'3xl': 'rounded-3xl',
		full: 'rounded-full',
	},

	elevation: {
		none: 'shadow-none',
		xs: 'shadow-xs',
		sm: 'shadow-sm',
		md: 'shadow-md',
		lg: 'shadow-lg',
		xl: 'shadow-xl',
		'2xl': 'shadow-2xl',
	},

	density: {
		compact: 'gap-1',
		normal: 'gap-2',
		comfortable: 'gap-3',
		spacious: 'gap-4',
	},

	weight: {
		thin: 'font-thin',
		light: 'font-light',
		normal: 'font-normal',
		medium: 'font-medium',
		semibold: 'font-semibold',
		bold: 'font-bold',
		extrabold: 'font-extrabold',
		black: 'font-black',
	},

	align: {
		start: 'justify-start',
		center: 'justify-center',
		end: 'justify-end',
		between: 'justify-between',
		around: 'justify-around',
		evenly: 'justify-evenly',
	},

	orientation: {
		horizontal: 'flex-row',
		vertical: 'flex-col',
	},

	width: {
		auto: 'w-auto',
		fit: 'w-fit',
		min: 'w-min',
		max: 'w-max',
		full: 'w-full',
	},

	overflow: {
		visible: 'overflow-visible',
		hidden: 'overflow-hidden',
		auto: 'overflow-auto',
		scroll: 'overflow-scroll',
		clip: 'overflow-clip',
	},

	disabled: {
		true: 'pointer-events-none opacity-50',
		false: '',
	},

	loading: {
		true: 'cursor-wait',
		false: '',
	},

	interactive: {
		true: 'cursor-pointer select-none',
		false: '',
	},

	focusable: {
		true: 'focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus',
		false: '',
	},

	truncate: {
		true: 'truncate',
		false: '',
	},

	square: {
		true: 'aspect-square px-0',
		false: '',
	},

	transition: {
		none: 'transition-none',
		all: 'transition-all',
		colors: 'transition-colors',
		opacity: 'transition-opacity',
		transform: 'transition-transform',
		shadow: 'transition-shadow',
	},
} as const
