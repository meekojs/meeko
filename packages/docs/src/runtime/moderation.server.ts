import type { ModerationSite } from 'meeko-docs-content/moderation'

import { definePlugin } from '@meekojs/meeko/framework'
import { splitLocalePath } from 'meeko-docs-content/locale'
import { readSiteModeration, withoutDismissed } from 'meeko-docs-content/moderation'

import { docsModerationKey, docsSiteKey } from './state'

// Lee la moderación de la web en el idioma de la URL (`/en/…` es inglés; caché de 30 s) y la publica para el Shell, sin los avisos que el
// lector cerró (su cookie): así el servidor nunca pinta un aviso que el navegador ocultaría. Sin
// base de datos publica la moderación vacía; nunca lanza. Publica también la web, para que el
// navegador pida la moderación otra vez tras cada navegación (`./endpoint.ts`).
export default definePlugin<{ readonly site: ModerationSite }>(async (app, options) => {
	const moderation = await readSiteModeration(options.site, { locale: splitLocalePath(app.route.path.value).locale })
	app.provide(docsModerationKey, withoutDismissed(moderation, app.request?.headers.get('cookie')))
	app.provide(docsSiteKey, options.site)
})
