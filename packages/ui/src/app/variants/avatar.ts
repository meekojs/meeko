// El aspecto de <UIAvatar>: una caja cuadrada con el tamaño de `--ui-avatar-size-*`, el fondo y el texto de
// `--ui-avatar-bg` y `--ui-avatar-color`, y la forma de un círculo o de un cuadrado con las esquinas de
// `--ui-avatar-radius`. La imagen la llena y recorta; las iniciales y el glifo van centrados.
import { tv } from '../utils/theme'

export const avatar = tv({
	slots: {
		base: [
			'relative inline-flex flex-none items-center justify-center overflow-hidden align-middle select-none',
			'bg-(color:--ui-avatar-bg) text-(color:--ui-avatar-color)',
			'font-sans leading-none font-semibold whitespace-nowrap',
		],
		/** La foto: llena la caja y se recorta sin deformarse. */
		image: 'block size-full object-cover',
		/** La persona genérica, sin imagen ni nombre: proporcional a la caja. */
		glyph: 'size-3/5 flex-none fill-none stroke-current [stroke-linecap:round] [stroke-linejoin:round] [stroke-width:var(--ui-icon-stroke-width)]',
	},
	variants: {
		size: {
			sm: { base: 'size-(--ui-avatar-size-sm) text-(length:--ui-avatar-font-size-sm)' },
			md: { base: 'size-(--ui-avatar-size-md) text-(length:--ui-avatar-font-size-md)' },
			lg: { base: 'size-(--ui-avatar-size-lg) text-(length:--ui-avatar-font-size-lg)' },
		},
		shape: {
			circle: { base: 'rounded-full' },
			rounded: { base: 'rounded-(--ui-avatar-radius)' },
		},
	},
	defaultVariants: {
		size: 'md',
		shape: 'circle',
	},
})
