// El aspecto de <UIAvatar>: una caja cuadrada con el tamaño de `--ui-avatar-size-*`, el fondo y el texto de
// `--ui-avatar-bg` y `--ui-avatar-color`, y la forma de un círculo o de un cuadrado con las esquinas de
// `--ui-avatar-radius`. La imagen la llena y recorta; las iniciales y el glifo van centrados.
import { tv } from 'tailwind-variants/lite'

export const avatar = tv({
	slots: {
		base: [
			'ui:relative ui:inline-flex ui:flex-none ui:items-center ui:justify-center ui:overflow-hidden ui:align-middle ui:select-none',
			'ui:bg-(color:--ui-avatar-bg) ui:text-(color:--ui-avatar-color)',
			'ui:font-sans ui:leading-none ui:font-semibold ui:whitespace-nowrap',
		],
		/** La foto: llena la caja y se recorta sin deformarse. */
		image: 'ui:block ui:size-full ui:object-cover',
		/** La persona genérica, sin imagen ni nombre: proporcional a la caja. */
		glyph: 'ui:size-3/5 ui:flex-none ui:fill-none ui:stroke-current ui:[stroke-linecap:round] ui:[stroke-linejoin:round] ui:[stroke-width:var(--ui-icon-stroke-width)]',
	},
	variants: {
		size: {
			sm: { base: 'ui:size-(--ui-avatar-size-sm) ui:text-(length:--ui-avatar-font-size-sm)' },
			md: { base: 'ui:size-(--ui-avatar-size-md) ui:text-(length:--ui-avatar-font-size-md)' },
			lg: { base: 'ui:size-(--ui-avatar-size-lg) ui:text-(length:--ui-avatar-font-size-lg)' },
		},
		shape: {
			circle: { base: 'ui:rounded-full' },
			rounded: { base: 'ui:rounded-(--ui-avatar-radius)' },
		},
	},
	defaultVariants: {
		size: 'md',
		shape: 'circle',
	},
})
