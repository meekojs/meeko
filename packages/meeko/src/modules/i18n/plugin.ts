// The file declares an ambient module, so it cannot be imported: this is how a program that reaches this file gets it.
// eslint-disable-next-line @typescript-eslint/triple-slash-reference
/// <reference path="./virtual.d.ts" />
import { catalogs } from 'virtual:meeko-i18n'

import type { Message } from './messages'

import { definePlugin } from '../../app/definitions/define-plugin'
import { i18nContext } from '../../shared/i18n'
import { createI18n, localeOf } from './index'

interface Options {
	readonly defaultLocale: string
	readonly locales: readonly string[]
	readonly directions: Readonly<Record<string, 'ltr' | 'rtl'>>
	readonly routes: Readonly<Record<string, readonly string[]>>
}

export default definePlugin<Options>(async (app, options) => {
	const locale = localeOf(app.route.path.value, options.locales, options.defaultLocale)
	const loaders = catalogs[locale]
	if (!loaders) throw new RangeError(`i18n: missing catalog ${locale}`)
	const catalog: Record<string, Message> = Object.create(null)
	const loaded = new Set<string>()
	const load = async (routeId: string | null): Promise<void> => {
		const names = new Set(['common', ...(options.routes[routeId ?? ''] ?? [])])
		const pending = [...names].filter((name) => !loaded.has(name))
		// Requested at once: each one in turn costs the visitor a round trip per namespace. They are merged
		// in the order of the list and up to the first failure, whichever arrives first; waiting for all of
		// them leaves no rejection unhandled, which would stop a Node server.
		const modules = await Promise.allSettled(
			pending.map(async (name) => {
				const module = loaders[name]
				if (!module) throw new RangeError(`i18n: missing ${locale}/${name}`)
				return await module()
			}),
		)
		for (const [index, module] of modules.entries()) {
			if (module.status === 'rejected') throw module.reason
			Object.assign(catalog, module.value.default)
			loaded.add(pending[index]!)
		}
	}
	await load(app.route.id.value)
	app.provide(
		i18nContext,
		createI18n(
			locale,
			catalog,
			options.locales,
			(path) => {
				if (app.side === 'client') window.location.assign(path)
			},
			() => app.route.url.value,
		),
	)
	app.addHead(() => ({ htmlAttrs: { lang: locale, dir: options.directions[locale] ?? 'ltr' } }))
	if (app.side === 'client')
		app.beforeNavigate(async (url, routeId) => {
			if (localeOf(url.pathname, options.locales, options.defaultLocale) !== locale) {
				window.location.assign(url.href)
				return false
			}
			await load(routeId)
		})
})
