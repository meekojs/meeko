import type { LinkResolver } from '../../shared/link'
import type { Navigator, RouteRecord } from './router'

import { linkHref } from '../../shared/link'
import { href, matchRoute, serverRequestActive } from './router'

/** What `navigate()` and `useSearchParam()` need from a mounted browser application. */
export interface AppNavigation {
	readonly routes: readonly RouteRecord[]
	readonly browser: Window
	readonly navigate: Navigator['navigate']
	/** The composed resolver of `app.resolveLink`, as `<MeekoLink>` applies it. */
	readonly resolveLink?: LinkResolver | undefined
	/** Reports a failure that no caller awaits, like a failed link navigation. */
	readonly report: (error: unknown) => void
}

/** Mounted browser applications; the last one is active, as for `href(id)`. */
const applications: AppNavigation[] = []

/** Makes `app` the target of `navigate()` until the returned release runs. */
export function activateAppNavigation(app: AppNavigation): () => void {
	applications.push(app)
	let active = true
	return () => {
		if (!active) return
		active = false
		const index = applications.lastIndexOf(app)
		if (index >= 0) applications.splice(index, 1)
	}
}

/** Options of a programmatic navigation. */
export interface NavigateCallOptions {
	readonly replace?: boolean | undefined
	readonly viewTransition?: boolean | undefined
}

/** The typed target of `navigate()`, as `<MeekoLink>` takes it. */
export interface NavigateRouteTarget {
	readonly to: string
	readonly params?: Readonly<Record<string, string>> | undefined
	readonly search?: Readonly<Record<string, string | number | boolean | null | undefined>> | undefined
	readonly hash?: string | undefined
	readonly hreflang?: string | undefined
	readonly resolve?: boolean | undefined
}

/** The mounted application of this call, or the error that explains where `name` works. */
export function currentAppNavigation(name: string): AppNavigation {
	const app = serverRequestActive() ? undefined : applications[applications.length - 1]
	if (!app) {
		throw new Error(`${name} sólo funciona en el navegador, en una aplicación que monta mountClientApp. En el servidor (SSR, loaders, código de nivel superior o middleware) usa redirect() para enviar a otra URL.`)
	}
	return app
}

/** Whether a browser application can navigate now: not during SSR, and with one mounted. */
export function appNavigationAvailable(): boolean {
	return !serverRequestActive() && applications.length > 0
}

/** The URL of a typed target: `href()` of the app's manifest, its fragment and the link resolvers. */
function targetUrl(app: AppNavigation, target: NavigateRouteTarget): string {
	const built = href(app.routes, target.to, {
		...(target.params ? { params: target.params } : {}),
		...(target.search ? { search: target.search } : {}),
	})
	const hash = target.hash ? `#${target.hash.replace(/^#/, '')}` : ''
	return linkHref(app.resolveLink, target.to, built + hash, target.hreflang, target.resolve)
}

/**
 * Navigates `app` to `to`: a route of the application goes through its client router (middleware,
 * loaders, pending state, history) and anything else loads as a document, as a link would. Only
 * `http:` and `https:` URLs are followed.
 */
export function navigateApp(app: AppNavigation, to: string | NavigateRouteTarget, options: NavigateCallOptions = {}): Promise<boolean> {
	let url: URL
	try {
		url = new URL(typeof to === 'string' ? to : targetUrl(app, to), app.browser.location.href)
	} catch (error) {
		return Promise.reject(error)
	}
	if (url.protocol !== 'http:' && url.protocol !== 'https:') return Promise.reject(new TypeError(`navigate() only follows http: and https: URLs, not ${url.protocol}`))
	if (url.origin !== app.browser.location.origin || !matchRoute(app.routes, url.pathname)) {
		// Another origin or a URL without a page: the browser loads it, as it does with a link.
		try {
			if (options.replace) app.browser.location.replace(url.href)
			else app.browser.location.assign(url.href)
		} catch (error) {
			return Promise.reject(error)
		}
		return Promise.resolve(false)
	}
	return app.navigate(url.href, {
		...(options.replace === undefined ? {} : { replace: options.replace }),
		...(options.viewTransition === undefined ? {} : { viewTransition: options.viewTransition }),
	})
}
