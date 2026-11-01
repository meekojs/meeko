// La navegación de la guía: rutas sin prefijo de idioma, textos en español (que también lee
// meeko-docs-content al importar las fuentes) y, en `en`, los textos ingleses. La usan el Shell,
// el middleware de moderación y los endpoints de métricas.
export const navigation = [
	{
		title: 'Primeros pasos',
		en: { title: 'Getting started' },
		items: [
			{ label: 'Introducción', href: '/', description: 'Meeko UI, componentes y filosofía', en: { label: 'Introduction', description: 'Meeko UI, components and philosophy' } },
			{ label: 'Instalación', href: '/installation', description: 'Configurar el módulo en una aplicación', en: { label: 'Installation', description: 'Set up the module in an application' } },
			{ label: 'Temas y personalización', href: '/theming', description: 'Tokens, colores y defaults', en: { label: 'Theming and customization', description: 'Tokens, colors and defaults' } },
		],
	},
	{
		title: 'Componentes',
		en: { title: 'Components' },
		items: [
			{ label: 'Todos los componentes', href: '/components', description: 'Índice por categorías', en: { label: 'All components', description: 'Index by category' } },
			{ label: 'Container', href: '/container', description: 'Anchos fluidos, gutters y pantallas hasta 4K', en: { label: 'Container', description: 'Fluid widths, gutters and screens up to 4K' } },
			{ label: 'Button', href: '/buttons', description: 'Acciones, variantes, tamaños y estados', en: { label: 'Button', description: 'Actions, variants, sizes and states' } },
			{ label: 'Link y LinkCard', href: '/links', description: 'Navegación y superficies enlazadas', en: { label: 'Link and LinkCard', description: 'Navigation and linked surfaces' } },
			{ label: 'Badge', href: '/badges', description: 'Etiquetas y metadatos', en: { label: 'Badge', description: 'Labels and metadata' } },
			{ label: 'Icon', href: '/icons', description: 'Iconos de Iconify tipados y resueltos al compilar', en: { label: 'Icon', description: 'Typed Iconify icons resolved at build time' } },
			{ label: 'Field e Input', href: '/forms', description: 'Formularios, modelos y errores', en: { label: 'Field and Input', description: 'Forms, models and errors' } },
			{ label: 'Select', href: '/select', description: 'Opciones tipadas, búsqueda y selección múltiple', en: { label: 'Select', description: 'Typed options, search and multiple selection' } },
			{ label: 'Card', href: '/cards', description: 'Contenedores y snippets', en: { label: 'Card', description: 'Containers and snippets' } },
			{ label: 'Table', href: '/tables', description: 'Filas y columnas tipadas', en: { label: 'Table', description: 'Typed rows and columns' } },
			{ label: 'Modal', href: '/modals', description: 'Diálogos, resultados y pilas anidadas', en: { label: 'Modal', description: 'Dialogs, results and nested stacks' } },
			{ label: 'Popover', href: '/popover', description: 'Menús, diálogos ligeros y tooltips anclados', en: { label: 'Popover', description: 'Menus, lightweight dialogs and anchored tooltips' } },
			{ label: 'App', href: '/app', description: 'Host de modales programáticos', en: { label: 'App', description: 'Host for programmatic modals' } },
			{ label: 'ThemeToggle', href: '/theme-toggle', description: 'Selector de tema claro, oscuro y sistema', en: { label: 'ThemeToggle', description: 'Light, dark and system theme switcher' } },
		],
	},
	{
		title: 'Integración con Meeko',
		en: { title: 'Meeko integration' },
		items: [
			{ label: 'View Transitions', href: '/transitions', description: 'Navegación y superficies compartidas', en: { label: 'View Transitions', description: 'Navigation and shared surfaces' } },
		],
	},
] as const
