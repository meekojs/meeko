import type { UIDefaults } from '@meekojs/ui'
import type { HintSnippets, UIHintProps, UIIconButtonProps, UIIconName } from '@meekojs/ui/runtime'

import type { ComponentProps as HintProps } from '../../dist/app/components/Hint.d.meeko.ts'
import type { ComponentProps as IconButtonProps } from '../../dist/app/components/IconButton.d.meeko.ts'

declare module '@meekojs/meeko/framework' {
	interface GeneratedRoutes {
		'/': Record<never, never>
		'/users/[id]': { id: string }
	}
}

// The public types and the props of the compiled components accept the same thing.
const iconButton = (props: IconButtonProps & UIIconButtonProps): void => void props
const hint = (props: HintProps & UIHintProps): void => void props

// The three forms of <UIButton>, with a label and an icon of the package or a path.
iconButton({ label: 'Cerrar', icon: 'close' })
iconButton({ label: 'Perfil', to: '/users/[id]', params: { id: '7' }, icon: 'arrowEnd' })
iconButton({ label: 'GitHub', href: 'https://github.com', target: '_blank', icon: 'M2 2h12v12H2Z' })
iconButton({ label: 'Enviar', type: 'submit', disabled: true, loading: false })
// Appearance, a toggle, the tooltip and the slots.
iconButton({ label: 'Fijar', pressed: true, variant: 'outline', color: 'danger', size: 'sm', radius: 'full', elevation: 'sm', tooltip: false, placement: 'bottom', class: 'pin', ui: { base: 'a', icon: 'b', tooltip: 'c' } })
iconButton({ label: 'Ayuda', id: 'help', 'aria-describedby': 'more', 'data-testid': 'help' })
const name: UIIconName = 'info'
void name

// @ts-expect-error The label is the accessible name: it is required.
iconButton({ icon: 'close' })
// @ts-expect-error A link is not a toggle.
iconButton({ label: 'Docs', href: '/docs', pressed: true })
// @ts-expect-error A route is not a toggle either.
iconButton({ label: 'Inicio', to: '/', pressed: false })
// @ts-expect-error A link cannot be disabled.
iconButton({ label: 'Docs', href: '/docs', disabled: true })
// @ts-expect-error The label is the name: aria-label would compete with it.
iconButton({ label: 'Cerrar', 'aria-label': 'Close' })
// @ts-expect-error The label is the tooltip: title would add a second one.
iconButton({ label: 'Cerrar', title: 'Cerrar' })
// @ts-expect-error The treatments of a button but link: an icon has no text to underline.
iconButton({ label: 'Cerrar', variant: 'link' })
// @ts-expect-error The old values of variant are gone: solid and primary.
iconButton({ label: 'Cerrar', variant: 'primary' })
// @ts-expect-error tone is now color.
iconButton({ label: 'Cerrar', tone: 'danger' })
// @ts-expect-error shape is now radius.
iconButton({ label: 'Cerrar', shape: 'pill' })
// @ts-expect-error Only the semantic colors.
iconButton({ label: 'Cerrar', color: 'crimson' })
// @ts-expect-error A slot that it does not have.
iconButton({ label: 'Cerrar', ui: { label: 'x' } })

// <UIHint>: everything is optional, the help comes in `text` or in the snippet.
hint({})
hint({ text: 'Sin impuestos', label: 'Qué incluye', placement: 'right', id: 'revenue-hint', class: 'mine', ui: { base: 'a', icon: 'b', tooltip: 'c' } })
const snippets: HintSnippets = { default: [] }
void snippets
// @ts-expect-error A placement of the popover.
hint({ placement: 'center' })
// @ts-expect-error The help is text.
hint({ text: 3 })

// ui.defaults: the variants of an icon button, and the slots of both.
const defaults: UIDefaults = { iconButton: { variant: 'outline', color: 'neutral', size: 'sm', radius: 'full', class: 'x', ui: { icon: 'y' } }, hint: { class: 'z', ui: { tooltip: 'w' } } }
void defaults
// @ts-expect-error A hint has no variants.
const hintVariant: UIDefaults = { hint: { size: 'sm' } }
// @ts-expect-error tone is gone: the color of an icon button is color.
const toneDefault: UIDefaults = { iconButton: { tone: 'danger' } }
// @ts-expect-error shape is gone: radius.
const shapeDefault: UIDefaults = { iconButton: { shape: 'pill' } }
void [hintVariant, toneDefault, shapeDefault]
