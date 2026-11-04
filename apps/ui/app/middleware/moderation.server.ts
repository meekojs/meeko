import { notFound } from '@meekojs/meeko/framework'
import { isModeratedOut } from 'meeko-docs/moderation'

import { navigation } from '../utils/navigation'

// Una página que el dashboard oculta no existe: responde 404 con la página de error, también al
// navegar en el navegador. Sin base de datos no oculta nada.
export default defineServerRouteMiddleware(async ({ url }) => {
	if (await isModeratedOut('ui', url.pathname, navigation)) notFound()
})
