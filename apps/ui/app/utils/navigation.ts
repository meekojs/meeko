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
			{ label: 'Todos los componentes', href: '/components', description: 'Índice por categorías', en: { label: 'All components', description: 'Index by category' } },
		],
	},
	{
		title: 'Acciones y base',
		en: { title: 'Actions and basics' },
		items: [
			{ label: 'Container', href: '/container', description: 'Anchos fluidos, gutters y pantallas hasta 4K', en: { label: 'Container', description: 'Fluid widths, gutters and screens up to 4K' } },
			{ label: 'Button', href: '/buttons', description: 'Acciones, variantes, tamaños y estados', en: { label: 'Button', description: 'Actions, variants, sizes and states' } },
			{ label: 'Link y LinkCard', href: '/links', description: 'Navegación y superficies enlazadas', en: { label: 'Link and LinkCard', description: 'Navigation and linked surfaces' } },
			{ label: 'Badge', href: '/badges', description: 'Etiquetas y metadatos', en: { label: 'Badge', description: 'Labels and metadata' } },
			{ label: 'Icon', href: '/icons', description: 'Iconos de Iconify tipados y resueltos al compilar', en: { label: 'Icon', description: 'Typed Iconify icons resolved at build time' } },
			{ label: 'ThemeToggle', href: '/theme-toggle', description: 'Selector de tema claro, oscuro y sistema', en: { label: 'ThemeToggle', description: 'Light, dark and system theme switcher' } },
			{ label: 'App', href: '/app', description: 'Host de modales programáticos', en: { label: 'App', description: 'Host for programmatic modals' } },
		],
	},
	{
		title: 'Formularios',
		en: { title: 'Forms' },
		items: [
			{ label: 'Field e Input', href: '/forms', description: 'Formularios, modelos y errores', en: { label: 'Field and Input', description: 'Forms, models and errors' } },
			{ label: 'Controles de formulario', href: '/controls', description: 'Textarea, Checkbox, RadioGroup, Switch y Slider', en: { label: 'Form controls', description: 'Textarea, Checkbox, RadioGroup, Switch and Slider' } },
			{ label: 'Select', href: '/select', description: 'Select nativo y Combobox con búsqueda y selección múltiple', en: { label: 'Select', description: 'Native Select and Combobox with search and multiple selection' } },
			{ label: 'Editor de Markdown', href: '/editor', description: 'Edición visual y de código con Crepe', en: { label: 'Markdown editor', description: 'Visual and code editing with Crepe' } },
		],
	},
	{
		title: 'Datos y avisos',
		en: { title: 'Data and feedback' },
		items: [
			{ label: 'Card', href: '/cards', description: 'Contenedores y snippets', en: { label: 'Card', description: 'Containers and snippets' } },
			{ label: 'Table', href: '/tables', description: 'Filas y columnas tipadas', en: { label: 'Table', description: 'Typed rows and columns' } },
			{ label: 'Datos y contenido', href: '/content', description: 'Stat, DescriptionList, Disclosure, Diff, CodeBlock y Prose', en: { label: 'Data and content', description: 'Stat, DescriptionList, Disclosure, Diff, CodeBlock and Prose' } },
			{ label: 'Avisos', href: '/feedback', description: 'Alert, Toast, Empty y Skeleton', en: { label: 'Feedback', description: 'Alert, Toast, Empty and Skeleton' } },
		],
	},
	{
		title: 'Estructura y capas',
		en: { title: 'Structure and layers' },
		items: [
			{ label: 'Estructura de página', href: '/page', description: 'Page, PageHeader, Header y Footer', en: { label: 'Page structure', description: 'Page, PageHeader, Header and Footer' } },
			{ label: 'Navegación', href: '/navigation', description: 'Árbol, pestañas, migas, paginación, índice e idioma', en: { label: 'Navigation', description: 'Tree, tabs, breadcrumb, pagination, contents and language' } },
			{ label: 'Modal', href: '/modals', description: 'Diálogos, resultados y pilas anidadas', en: { label: 'Modal', description: 'Dialogs, results and nested stacks' } },
			{ label: 'Popover', href: '/popover', description: 'Menús, diálogos ligeros y tooltips anclados', en: { label: 'Popover', description: 'Menus, lightweight dialogs and anchored tooltips' } },
			{ label: 'Superposiciones', href: '/overlays', description: 'Drawer, Tooltip y CommandPalette', en: { label: 'Overlays', description: 'Drawer, Tooltip and CommandPalette' } },
			{ label: 'View Transitions', href: '/transitions', description: 'Navegación y superficies compartidas', en: { label: 'View Transitions', description: 'Navigation and shared surfaces' } },
		],
	},
] as const
