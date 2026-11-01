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
			{ label: 'Container', href: '/container', description: 'Anchos fluidos, gutters y pantallas hasta 4K' },
			{ label: 'Button', href: '/buttons', description: 'Acciones, variantes, tamaños y estados' },
			{ label: 'Link y LinkCard', href: '/links', description: 'Navegación y superficies enlazadas' },
			{ label: 'Badge', href: '/badges', description: 'Etiquetas y metadatos' },
			{ label: 'Icon', href: '/icons', description: 'Iconos de Iconify tipados y resueltos al compilar' },
			{ label: 'Field e Input', href: '/forms', description: 'Formularios, modelos y errores' },
			{ label: 'Select', href: '/select', description: 'Opciones tipadas, búsqueda y selección múltiple' },
			{ label: 'Card', href: '/cards', description: 'Contenedores y snippets' },
			{ label: 'Table', href: '/tables', description: 'Filas y columnas tipadas' },
			{ label: 'Modal', href: '/modals', description: 'Diálogos, resultados y pilas anidadas' },
			{ label: 'Popover', href: '/popover', description: 'Menús, diálogos ligeros y tooltips anclados' },
			{ label: 'App', href: '/app', description: 'Host de modales programáticos' },
			{ label: 'ThemeToggle', href: '/theme-toggle', description: 'Selector de tema claro, oscuro y sistema' },
		],
	},
	{
		title: 'Integración con Meeko',
		items: [
			{ label: 'View Transitions', href: '/transitions', description: 'Navegación y superficies compartidas' },
		],
	},
] as const
