// La navegación de la guía: rutas sin prefijo de idioma, textos en español (que también lee
// meeko-docs-content al importar las fuentes) y, en `en`, los textos ingleses. La usan el Shell,
// el middleware de moderación y los endpoints de métricas.
// `/ar/playground` (el árabe del laboratorio) cuenta como `/playground`.
export const navigation = [
	{
		title: 'Primeros pasos',
		en: { title: 'Getting started' },
		items: [
			{ label: 'Introducción', href: '/', description: 'Traducciones nativas para Meeko', en: { label: 'Introduction', description: 'Native translations for Meeko' } },
			{ label: 'Instalación', href: '/installation', description: 'Configurar el módulo y los catálogos', en: { label: 'Installation', description: 'Set up the module and the catalogs' } },
			{ label: 'Laboratorio', href: '/playground', aliases: ['/ar/playground'], description: 'Español, inglés, árabe y RTL en vivo', en: { label: 'Playground', description: 'Spanish, English, Arabic and RTL live' } },
		],
	},
	{
		title: 'Guías',
		en: { title: 'Guides' },
		items: [
			{ label: 'Mensajes y parámetros', href: '/messages', description: 'Interpolación, claves y contratos tipados', en: { label: 'Messages and parameters', description: 'Interpolation, keys and typed contracts' } },
			{ label: 'Plurales y selectores', href: '/plurals', description: 'PluralRules, categorías y alternativas', en: { label: 'Plurals and selectors', description: 'PluralRules, categories and alternatives' } },
			{ label: 'Números y fechas', href: '/formatting', description: 'Intl, moneda, fechas y SSR', en: { label: 'Numbers and dates', description: 'Intl, currency, dates and SSR' } },
			{ label: 'Idiomas y rutas', href: '/routing', description: 'switchLocale, prefijos y navegación', en: { label: 'Languages and routes', description: 'switchLocale, prefixes and navigation' } },
			{ label: 'Namespaces', href: '/namespaces', description: 'Catálogos por ruta y carga diferida', en: { label: 'Namespaces', description: 'Catalogs per route and lazy loading' } },
			{ label: 'Dirección RTL', href: '/rtl', description: 'Árabe, lang, dir y propiedades lógicas', en: { label: 'RTL direction', description: 'Arabic, lang, dir and logical properties' } },
		],
	},
	{
		title: 'Referencia',
		en: { title: 'Reference' },
		items: [
			{ label: 'API pública', href: '/api', description: 'useI18n, createI18n y utilidades de rutas', en: { label: 'Public API', description: 'useI18n, createI18n and route utilities' } },
			{ label: 'Validación y errores', href: '/validation', description: 'meeko check y diagnóstico de contratos', en: { label: 'Validation and errors', description: 'meeko check and contract diagnostics' } },
		],
	},
] as const
