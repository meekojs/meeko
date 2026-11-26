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
button({ to: '/', variant: 'outline', color: 'neutral', size: 'sm', radius: 'full', width: 'full', elevation: 'sm', class: 'wide', id: 'home', title: 'Home', 'aria-label': 'Home', 'aria-current': 'page', 'data-testid': 'home' })
button({ href: '/file.pdf', tabindex: 0, 'aria-describedby': 'hint', 'data-state': 'idle' })
button({ type: 'reset', id: 'reset', 'aria-busy': true, 'data-count': 3 })
// The attributes of <a> on a link, with `to` or `href`; `resolve` only with `to`.
button({ to: '/about', target: '_blank', rel: 'external', hreflang: 'en', lang: 'en', resolve: false })
button({ href: '/report.pdf', hreflang: 'en', referrerpolicy: 'no-referrer', ping: '/ping' })

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
// @ts-expect-error A button has no `target`.
button({ type: 'button', target: '_blank' })
// @ts-expect-error A button has no `hreflang`.
button({ type: 'button', hreflang: 'en' })
// @ts-expect-error `resolve` belongs to `to`.
button({ href: '/about', resolve: false })
// @ts-expect-error A button has no `download`.
button({ download: true })
// @ts-expect-error Not a `type` of <button>.
button({ type: 'menu' })
// @ts-expect-error Event handlers are not forwarded attributes: use on:click.
button({ onclick: 'alert(1)' })
// @ts-expect-error Only the treatments of the catalog that a button takes.
button({ variant: 'danger' })
// @ts-expect-error primary is a color now: variant="solid" color="primary".
button({ variant: 'primary' })
// @ts-expect-error secondary is a color now: variant="surface" color="neutral" for the old look.
button({ variant: 'secondary' })
// @ts-expect-error tone is gone: color="danger".
button({ tone: 'danger' })
// @ts-expect-error shape is gone: radius="full".
button({ shape: 'pill' })
// @ts-expect-error Only the semantic colors.
button({ color: 'crimson' })
// @ts-expect-error The sizes of the controls.
button({ size: '2xl' })
// @ts-expect-error appearance is gone: its options are props.
button({ appearance: { variant: 'solid' } })
// Every treatment, color and size of a button.
button({ variant: 'soft', color: 'success', size: 'xs', radius: 'none' })
button({ variant: 'link', color: 'info', size: 'xl' })
link({ href: '/', variant: 'subtle', color: 'warning', radius: '2xl' })
// @ts-expect-error UILink has no tone either.
link({ href: '/', tone: 'danger' })

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
// The attributes of <a>, with `to` or `href`; `resolve` only with `to`.
link({ to: '/', target: '_blank', rel: 'help', hreflang: 'en', lang: 'en', download: true, resolve: false })
link({ href: 'https://example.com/en', hreflang: 'en', referrerpolicy: 'no-referrer' })
// @ts-expect-error `resolve` belongs to `to`.
link({ href: '/', resolve: false })
// @ts-expect-error Not an attribute of <a>.
link({ to: '/', autocomplete: 'off' })

button({ type: 'submit', name: 'intent', value: 'save', form: 'editor', loading: true, color: 'danger' })
button({ iconOnly: true, ariaLabel: 'Close' })
button({ iconOnly: true, 'aria-label': 'Close' })
// @ts-expect-error An icon-only action requires an accessible name.
button({ iconOnly: true })

// A toggle with text: `pressed` is for a <button>, never for a link or a route.
button({ variant: 'outline', pressed: true })
button({ type: 'button', pressed: false })
// @ts-expect-error A link is not a toggle.
button({ href: '/docs', pressed: true })
// @ts-expect-error A route is not a toggle either.
button({ to: '/', pressed: false })
