import type { UIBreadcrumbItem, UICodeBlockProps, UIDrawerProps, UILinkTarget, UILocaleItem, UINavigationLink, UINavigationTreeGroup, UIPageProps, UIPaginationProps, UITableOfContentsEntry } from '@meekojs/ui/runtime'

import type { ComponentProps as BreadcrumbProps } from '../../dist/app/components/Breadcrumb.d.meeko.ts'
import type { ComponentProps as CodeBlockProps } from '../../dist/app/components/CodeBlock.d.meeko.ts'
import type { ComponentProps as DrawerProps } from '../../dist/app/components/Drawer.d.meeko.ts'
import type { ComponentProps as HeaderProps } from '../../dist/app/components/Header.d.meeko.ts'
import type { ComponentProps as PaginationProps } from '../../dist/app/components/Pagination.d.meeko.ts'

// The routes of an application, as `.meeko/types/routes.d.ts` declares them.
declare module '@meekojs/meeko/framework' {
	interface GeneratedRoutes {
		'/': Record<never, never>
		'/about': Record<never, never>
		'/users/[id]': { id: string }
	}
}

// A link goes to a URL or to a route, with its params correlated.
const links: UILinkTarget[] = [{ href: 'https://example.com', target: '_blank', rel: 'external' }, { to: '/about' }, { to: '/users/[id]', params: { id: '7' }, search: { tab: 'a' }, hreflang: 'en', resolve: false }]
const items: UINavigationLink[] = [
	{ label: 'A', to: '/', current: true },
	{ label: 'B', href: '/b' },
]
const header: HeaderProps = { items, sticky: false, size: '2xl', brand: { name: 'Meeko', product: 'UI', to: '/', image: { src: '/logo.svg', width: 24, height: 24 } } }
const crumbs: UIBreadcrumbItem[] = [{ label: 'Inicio', to: '/' }, { label: 'Actual' }]
const breadcrumb: BreadcrumbProps = { items: crumbs }
const group: UINavigationTreeGroup = { title: 'G', icon: 'M0 0', open: false, items: [{ label: 'I', href: '/i', code: true, featured: true, aliases: ['/j'] }] }
const entry: UITableOfContentsEntry = { id: 'a', text: 'A', level: 2 }
const locale: UILocaleItem = { code: 'en', label: 'English', href: '/en', current: false }
const drawer: UIDrawerProps & DrawerProps = { title: 'Menú', side: 'end', closedBy: 'closerequest', triggerLabel: 'Abrir', closeOnNavigate: false }
const code: UICodeBlockProps & CodeBlockProps = { code: 'a', lang: 'ts', verdict: 'bad', mode: 'log', copy: true }
const pagination: UIPaginationProps & PaginationProps = { shown: 1, total: 2, busy: true, moreLink: { to: '/about' } }
const page: UIPageProps = { layout: 'landing', mainId: 'main', lang: 'es', dir: 'rtl', 'data-testid': 'page' }

// @ts-expect-error A route that does not exist.
const missing: UILinkTarget = { to: '/missing' }
// @ts-expect-error A dynamic route needs its params.
const noParams: UILinkTarget = { to: '/users/[id]' }
// @ts-expect-error `to` and `href` exclude each other.
const both: UILinkTarget = { to: '/about', href: '/about' }
// @ts-expect-error A link needs a label in a list.
const noLabel: UINavigationLink = { href: '/a' }
// @ts-expect-error A verdict is good or bad.
const verdict: UICodeBlockProps = { verdict: 'maybe' }
// @ts-expect-error `closedBy` has the values of the attribute.
const closedBy: UIDrawerProps = { title: 'x', closedBy: 'never' }
// @ts-expect-error An entry needs its level.
const noLevel: UITableOfContentsEntry = { id: 'a', text: 'A' }
// @ts-expect-error A layout of the list.
const layout: UIPageProps = { layout: 'wide' }

void [links, header, breadcrumb, group, entry, locale, drawer, code, pagination, page, missing, noParams, both, noLabel, verdict, closedBy, noLevel, layout]
