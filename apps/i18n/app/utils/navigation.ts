export const navigation = [
	{
		title: 'Primeros pasos',
		items: [
			{ label: 'Introducción', href: '/', description: 'Traducciones nativas para Meeko' },
			{ label: 'Instalación', href: '/installation', description: 'Configurar el módulo y los catálogos' },
			{ label: 'Laboratorio', href: '/playground', aliases: ['/es/playground', '/en/playground', '/ar/playground'], description: 'Español, inglés, árabe y RTL en vivo' },
		],
	},
	{
		title: 'Guías',
		items: [
			{ label: 'Mensajes y parámetros', href: '/messages', description: 'Interpolación, claves y contratos tipados' },
			{ label: 'Plurales y selectores', href: '/plurals', description: 'PluralRules, categorías y alternativas' },
			{ label: 'Números y fechas', href: '/formatting', description: 'Intl, moneda, fechas y SSR' },
			{ label: 'Idiomas y rutas', href: '/routing', description: 'switchLocale, prefijos y navegación' },
			{ label: 'Namespaces', href: '/namespaces', description: 'Catálogos por ruta y carga diferida' },
			{ label: 'Dirección RTL', href: '/rtl', description: 'Árabe, lang, dir y propiedades lógicas' },
		],
	},
	{
		title: 'Referencia',
		items: [
			{ label: 'API pública', href: '/api', description: 'useI18n, createI18n y utilidades de rutas' },
			{ label: 'Validación y errores', href: '/validation', description: 'meeko check y diagnóstico de contratos' },
		],
	},
] as const
