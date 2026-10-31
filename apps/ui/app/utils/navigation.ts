export const navigation = [
	{
		title: 'Primeros pasos',
		items: [
			{ label: 'Introducción', href: '/', description: 'Meeko UI, componentes y filosofía' },
			{ label: 'Instalación', href: '/installation', description: 'Configurar el módulo en una aplicación' },
			{ label: 'Temas y personalización', href: '/theming', description: 'Tokens, colores y defaults' },
		],
	},
	{
		title: 'Componentes',
		items: [
			{ label: 'Todos los componentes', href: '/components', description: 'Índice por categorías' },
			{ label: 'Button', href: '/buttons', description: 'Acciones, variantes, tamaños y estados' },
			{ label: 'Link y LinkCard', href: '/links', description: 'Navegación y superficies enlazadas' },
			{ label: 'Badge', href: '/badges', description: 'Etiquetas y metadatos' },
			{ label: 'Field e Input', href: '/forms', description: 'Formularios, modelos y errores' },
			{ label: 'Card', href: '/cards', description: 'Contenedores y snippets' },
			{ label: 'Table', href: '/tables', description: 'Filas y columnas tipadas' },
			{ label: 'Modal', href: '/modals', description: 'Diálogos, resultados y pilas anidadas' },
			{ label: 'App', href: '/app', description: 'Host de modales programáticos' },
		],
	},
	{
		title: 'Integración con Meeko',
		items: [
			{ label: 'View Transitions', href: '/transitions', description: 'Navegación y superficies compartidas' },
		],
	},
] as const
