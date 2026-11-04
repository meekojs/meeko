import type { UIMessageOverrides, UIMessages, UIOptions } from '@meekojs/ui'
import type { UILinkCardProps } from '@meekojs/ui/runtime'

import type { ComponentProps as LinkCardProps } from '../../dist/app/components/LinkCard.d.meeko.ts'

// The routes of an application, as `.meeko/types/routes.d.ts` declares them.
declare module '@meekojs/meeko/framework' {
	interface GeneratedRoutes {
		'/': Record<never, never>
		'/about': Record<never, never>
		'/users/[id]': { id: string }
	}
}

// ui.locale and ui.messages: any text of any language, or a whole section.
const options = {
	locale: 'en',
	messages: {
		en: { table: { empty: 'Nothing here yet.' } },
		fr: { modal: { close: 'Fermer' }, select: { empty: 'Aucun résultat' }, themeToggle: { labels: { sepia: 'Sépia' }, cycle: '{current} → {next}' } },
	},
} satisfies UIOptions
const override: UIMessageOverrides = { modal: {} }
const text: UIMessages['select']['clear'] = 'Clear'
void [options, override, text]

// @ts-expect-error A section that does not exist.
const unknownSection: UIOptions = { messages: { en: { toast: { close: 'x' } } } }
// @ts-expect-error A text that does not exist.
const unknownText: UIOptions = { messages: { en: { modal: { dismiss: 'x' } } } }
// @ts-expect-error A text is a string: the options are serialized to the client.
const functionText: UIOptions = { messages: { en: { themeToggle: { cycle: () => 'x' } } } }
// @ts-expect-error A locale is a string.
const numericLocale: UIOptions = { locale: 1 }
void [unknownSection, unknownText, functionText, numericLocale]

// The public type and the props of the compiled component accept the same thing.
const card = (props: LinkCardProps & UILinkCardProps): void => void props

card({ title: 'Static', to: '/about' })
card({ title: 'Dynamic', to: '/users/[id]', params: { id: '7' }, search: { tab: 'a' }, description: 'Text', class: 'wide' })
card({ title: 'Other language', to: '/about', hreflang: 'en', lang: 'en', resolve: false, target: '_blank', rel: 'external' })
card({ title: 'URL', href: 'https://example.com', target: '_blank', download: 'file.pdf', hreflang: 'en' })
card({ title: 'Attributes', href: '/about', id: 'card', 'aria-describedby': 'hint', 'data-testid': 'card' })

// @ts-expect-error A card needs `to` or `href`.
card({ title: 'Nowhere' })
// @ts-expect-error A card needs a title.
card({ to: '/about' })
// @ts-expect-error A route that does not exist.
card({ title: 'Missing', to: '/missing' })
// @ts-expect-error A dynamic route needs its params.
card({ title: 'No params', to: '/users/[id]' })
// @ts-expect-error The params are those of the route.
card({ title: 'Wrong params', to: '/users/[id]', params: { slug: 'x' } })
// @ts-expect-error A static route takes no params.
card({ title: 'Static', to: '/about', params: { id: '7' } })
// @ts-expect-error `to` and `href` exclude each other.
card({ title: 'Both', to: '/about', href: '/about' })
// @ts-expect-error `resolve` belongs to `to`.
card({ title: 'Resolve', href: '/about', resolve: false })
