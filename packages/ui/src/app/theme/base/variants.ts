export const variants = {
	variant: {
		solid: 'border-transparent bg-(--ui-9) text-(color:--ui-contrast) not-disabled:hover:bg-(--ui-10) not-disabled:hover:text-(color:--ui-contrast-hover) not-disabled:active:bg-(--ui-10) not-disabled:active:text-(color:--ui-contrast-hover)',
		soft: 'border-transparent bg-(--ui-3) text-(color:--ui-12) not-disabled:hover:bg-(--ui-4) not-disabled:active:bg-(--ui-5)',
		outline: 'border-(length:--ui-border-width) border-(color:--ui-8) text-(color:--ui-12) not-disabled:hover:bg-(--ui-3)',
		ghost: 'border-transparent text-(color:--ui-12) not-disabled:hover:bg-(--ui-3) not-disabled:active:bg-(--ui-4)',
		surface: 'border-(length:--ui-border-width) border-(color:--ui-6) bg-(--ui-2) text-(color:--ui-12) not-disabled:hover:bg-(--ui-3)',
		subtle: 'border-transparent bg-(--ui-2) text-(color:--ui-12) not-disabled:hover:bg-(--ui-3)',
		link: 'border-transparent text-(color:--ui-12) not-disabled:hover:underline',
		plain: '',
		gradient: 'border-transparent bg-linear-to-r from-(--ui-9) to-(--ui-gradient-end) text-(color:--ui-contrast)',
		glass: 'border-(length:--ui-border-width) border-(color:--ui-6) bg-(--ui-3)/50 backdrop-blur-md text-(color:--ui-12)',
	},

	color: {
		primary: 'ui-primary',
		secondary: 'ui-secondary',
		neutral: 'ui-neutral',
		success: 'ui-success',
		info: 'ui-info',
		warning: 'ui-warning',
		error: 'ui-error',
		accent: 'ui-accent',
		danger: 'ui-danger',
		gray: 'ui-gray',
		red: 'ui-red',
		orange: 'ui-orange',
		amber: 'ui-amber',
		yellow: 'ui-yellow',
		lime: 'ui-lime',
		green: 'ui-green',
		emerald: 'ui-emerald',
		teal: 'ui-teal',
		cyan: 'ui-cyan',
		sky: 'ui-sky',
		blue: 'ui-blue',
		indigo: 'ui-indigo',
		violet: 'ui-violet',
		purple: 'ui-purple',
		fuchsia: 'ui-fuchsia',
		pink: 'ui-pink',
		rose: 'ui-rose',
	},

	size: {
		'2xs': 'h-5 px-1.5 text-[10px]',
		xs: 'h-6 px-2 text-xs',
		sm: 'h-7 px-2.5 text-xs',
		md: 'h-[34px] px-3 text-sm',
		lg: 'h-10 px-4 text-sm',
		xl: 'h-12 px-5 text-base',
		'2xl': 'h-14 px-6 text-lg',
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
