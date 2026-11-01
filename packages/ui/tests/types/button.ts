import type { UIButtonProps, UILinkProps, UIRouteTarget } from '@meekojs/ui/runtime'

import type { ComponentProps as ButtonProps } from '../../dist/app/components/Button.d.meeko.ts'
import type { ComponentProps as LinkProps } from '../../dist/app/components/Link.d.meeko.ts'

// The routes of an application, as `.meeko/types/routes.d.ts` declares them.
declare module '@meekojs/meeko/framework' {
	interface GeneratedRoutes {
		'/': Record<never, never>
		'/about': Record<never, never>
		'/users/[id]': { id: string }
	}
}

// The public types and the props of the compiled components accept the same thing.
const button = (props: ButtonProps & UIButtonProps): void => void props
const link = (props: LinkProps & UILinkProps): void => void props

// A route, with its params correlated, and the search.
button({ to: '/about' })
button({ to: '/users/[id]', params: { id: '7' }, search: { tab: 'activity', page: 2 } })
const target: UIRouteTarget = { to: '/users/[id]', params: { id: '7' } }
void target
// An URL and a button.
button({ href: 'https://example.com', target: '_blank', rel: 'external', download: 'report.pdf' })
button({ type: 'submit', disabled: true })
button({})
// Appearance and forwarded attributes on every branch.
button({ to: '/', variant: 'outline', size: 'sm', shape: 'pill', class: 'wide', id: 'home', title: 'Home', 'aria-label': 'Home', 'aria-current': 'page', 'data-testid': 'home' })
button({ href: '/file.pdf', tabindex: 0, 'aria-describedby': 'hint', 'data-state': 'idle' })
button({ type: 'reset', id: 'reset', 'aria-busy': true, 'data-count': 3 })

// @ts-expect-error A route that does not exist.
button({ to: '/missing' })
// @ts-expect-error A dynamic route needs its params.
button({ to: '/users/[id]' })
// @ts-expect-error The params are those of the route.
button({ to: '/users/[id]', params: { slug: 'x' } })
// @ts-expect-error A static route takes no params.
button({ to: '/about', params: { id: '7' } })
// @ts-expect-error `to` and `href` exclude each other.
button({ to: '/about', href: '/about' })
// @ts-expect-error A link has no `type`.
button({ href: '/about', type: 'submit' })
// @ts-expect-error A link cannot be disabled.
button({ href: '/about', disabled: true })
// @ts-expect-error A route cannot be disabled.
button({ to: '/about', disabled: true })
// @ts-expect-error A route has no `type`.
button({ to: '/about', type: 'button' })
// @ts-expect-error `target` belongs to `href`.
button({ to: '/about', target: '_blank' })
// @ts-expect-error A button has no `target`.
button({ type: 'button', target: '_blank' })
// @ts-expect-error A button has no `download`.
button({ download: true })
// @ts-expect-error Not a `type` of <button>.
button({ type: 'menu' })
// @ts-expect-error Event handlers are not forwarded attributes: use on:click.
button({ onclick: 'alert(1)' })
// @ts-expect-error Only the variants of UIActionVariant.
button({ variant: 'danger' })

// UILink keeps `href` and accepts `to`.
link({ href: '/installation' })
link({ href: 'https://example.com', target: '_blank', ariaLabel: 'Example' })
link({ to: '/' })
link({ to: '/users/[id]', params: { id: '7' }, 'aria-label': 'Profile', 'data-testid': 'profile' })
// @ts-expect-error UILink needs `to` or `href`.
link({})
// @ts-expect-error `to` and `href` exclude each other.
link({ to: '/', href: '/' })
// @ts-expect-error A dynamic route needs its params.
link({ to: '/users/[id]' })
// @ts-expect-error A route that does not exist.
link({ to: '/missing' })
// @ts-expect-error `target` belongs to `href`.
link({ to: '/', target: '_blank' })
