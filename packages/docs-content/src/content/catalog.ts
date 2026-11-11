import type { DocsLocale } from '../locale'
import type { NavLink, NavSection, Pager } from '../types/docs'

import { exportsHref, referenceHref } from './api-groups'
import { messages } from './messages'
import { taxonomy } from './reference-taxonomy'
import { currentLocale } from './repository'

/** A page of the site and the Markdown file of the repository it renders. */
export interface CatalogEntry {
	/** Slug under `/docs/`. */
	readonly slug: string
	readonly href: string
	/** Path of the Markdown file, as `readRepositoryFile` takes it: `CHANGELOG.md` is the package's. */
	readonly source: string
	/** Short label of the sidebar; the page title is the document's own heading. */
	readonly label: string
	readonly section: string
	/** Optional source transform for a document that needs one. */
	readonly transform?: (text: string) => string
}

/**
 * The published documents in reading order. `docs/releasing.md` is internal and stays out; links
 * to it, and to any other file of the repository, go to GitHub.
 */
export const catalog: readonly CatalogEntry[] = [
	{
		slug: 'inicio-rapido',
		href: '/docs/inicio-rapido',
		source: 'docs/inicio-rapido.md',
		label: 'Inicio rápido',
		section: 'Empezar',
	},
	{ slug: 'primeros-pasos', href: '/docs/primeros-pasos', source: 'docs/primeros-pasos.md', label: 'Primera aplicación', section: 'Empezar' },
	{ slug: 'documentacion', href: '/docs/documentacion', source: 'docs/README.md', label: 'Mapa de documentación', section: 'Empezar' },
	{ slug: 'como-elegir', href: '/docs/como-elegir', source: 'docs/como-elegir.md', label: 'Decisiones habituales', section: 'Fundamentos' },
	{ slug: 'framework', href: '/docs/framework', source: 'docs/framework.md', label: 'Framework full-stack', section: 'Fundamentos' },
	{ slug: 'api', href: '/docs/api', source: 'docs/api.md', label: 'Componentes y lenguaje .meeko', section: 'Fundamentos' },
	{ slug: 'component-basics', href: '/docs/component-basics', source: 'docs/component-basics.md', label: 'Componentes y props', section: 'Fundamentos' },
	{ slug: 'component-template', href: '/docs/component-template', source: 'docs/component-template.md', label: 'Plantillas y directivas', section: 'Fundamentos' },
	{ slug: 'component-events', href: '/docs/component-events', source: 'docs/component-events.md', label: 'Eventos, modelos y snippets', section: 'Fundamentos' },
	{ slug: 'language-reactivity', href: '/docs/language-reactivity', source: 'docs/language-reactivity.md', label: 'Reactividad y ciclo de vida', section: 'Fundamentos' },
	{ slug: 'component-styles', href: '/docs/component-styles', source: 'docs/component-styles.md', label: 'Estilos de componentes', section: 'Fundamentos' },
	{ slug: 'component-dynamic', href: '/docs/component-dynamic', source: 'docs/component-dynamic.md', label: 'Componentes dinámicos', section: 'Fundamentos' },
	{ slug: 'component-attributes', href: '/docs/component-attributes', source: 'docs/component-attributes.md', label: 'Atributos y props estáticas', section: 'Fundamentos' },
	{ slug: 'component-advanced', href: '/docs/component-advanced', source: 'docs/component-advanced.md', label: 'Composición y módulo generado', section: 'Fundamentos' },
	{ slug: 'component-builtins', href: '/docs/component-builtins', source: 'docs/component-builtins.md', label: 'Componentes integrados', section: 'Fundamentos' },
	{ slug: 'routing', href: '/docs/routing', source: 'docs/routing.md', label: 'Rutas: por dónde empezar', section: 'Guías prácticas' },
	{ slug: 'router', href: '/docs/router', source: 'docs/router.md', label: 'Crear rutas y navegar', section: 'Guías prácticas' },
	{ slug: 'routing-pages', href: '/docs/routing-pages', source: 'docs/routing-pages.md', label: 'Páginas y parámetros', section: 'Guías prácticas' },
	{ slug: 'routing-data', href: '/docs/routing-data', source: 'docs/routing-data.md', label: 'Cargar datos', section: 'Guías prácticas' },
	{ slug: 'routing-layouts', href: '/docs/routing-layouts', source: 'docs/routing-layouts.md', label: 'Layouts', section: 'Guías prácticas' },
	{ slug: 'routing-navigation', href: '/docs/routing-navigation', source: 'docs/routing-navigation.md', label: 'Navegación', section: 'Guías prácticas' },
	{ slug: 'routing-middleware', href: '/docs/routing-middleware', source: 'docs/routing-middleware.md', label: 'Middleware de rutas', section: 'Guías prácticas' },
	{ slug: 'framework-configuration', href: '/docs/framework-configuration', source: 'docs/framework-configuration.md', label: 'Configurar y ampliar', section: 'Guías prácticas' },
	{ slug: 'framework-rendering', href: '/docs/framework-rendering', source: 'docs/framework-rendering.md', label: 'Renderizar páginas y layouts', section: 'Guías prácticas' },
	{ slug: 'framework-api', href: '/docs/framework-api', source: 'docs/framework-api.md', label: 'Crear API y RPC', section: 'Guías prácticas' },
	{ slug: 'framework-websocket', href: '/docs/framework-websocket', source: 'docs/framework-websocket.md', label: 'Usar WebSocket', section: 'Guías prácticas' },
	{ slug: 'framework-server', href: '/docs/framework-server', source: 'docs/framework-server.md', label: 'Runtime y errores del servidor', section: 'Guías prácticas' },
	{ slug: 'framework-auth', href: '/docs/framework-auth', source: 'docs/framework-auth.md', label: 'Autenticación y sesiones', section: 'Guías prácticas' },
	{ slug: 'framework-deployment', href: '/docs/framework-deployment', source: 'docs/framework-deployment.md', label: 'Construir y desplegar', section: 'Guías prácticas' },
	{ slug: 'performance', href: '/docs/performance', source: 'docs/performance.md', label: 'Medir tu aplicación', section: 'Guías prácticas' },
	{ slug: 'ui', href: '/docs/ui', source: 'docs/ui.md', label: 'Meeko UI', section: 'Ecosistema' },
	{ slug: 'ui-api', href: '/docs/ui-api', source: 'docs/ui-api.md', label: 'Componentes de Meeko UI', section: 'Ecosistema' },
	{ slug: 'i18n', href: '/docs/i18n', source: 'docs/i18n.md', label: 'Internacionalización', section: 'Ecosistema' },
	{ slug: 'doctor', href: '/docs/doctor', source: 'docs/doctor.md', label: 'Doctor', section: 'Herramientas' },
	{ slug: 'editors', href: '/docs/editors', source: 'docs/editors.md', label: 'Editores', section: 'Herramientas' },
	{ slug: 'eslint', href: '/docs/eslint', source: 'docs/eslint.md', label: 'ESLint', section: 'Herramientas' },
	{ slug: 'tooling', href: '/docs/tooling', source: 'docs/tooling.md', label: 'ESLint y Prettier', section: 'Herramientas' },
	{ slug: 'devtools', href: '/docs/devtools', source: 'docs/devtools.md', label: 'DevTools', section: 'Herramientas' },
	{ slug: 'testing', href: '/docs/testing', source: 'docs/testing.md', label: 'Pruebas y CI', section: 'Herramientas' },
	{ slug: 'stability', href: '/docs/stability', source: 'docs/stability.md', label: 'Estabilidad 1.x', section: 'Referencia' },
	{ slug: 'architecture', href: '/docs/architecture', source: 'docs/architecture.md', label: 'Arquitectura', section: 'Referencia' },
	{ slug: 'routing-data-reference', href: '/docs/routing-data-reference', source: 'docs/routing-data-reference.md', label: 'Routing: datos en detalle', section: 'Referencia' },
	{ slug: 'routing-layouts-reference', href: '/docs/routing-layouts-reference', source: 'docs/routing-layouts-reference.md', label: 'Routing: layouts en detalle', section: 'Referencia' },
	{ slug: 'routing-navigation-reference', href: '/docs/routing-navigation-reference', source: 'docs/routing-navigation-reference.md', label: 'Routing: navegación en detalle', section: 'Referencia' },
	{ slug: 'routing-middleware-reference', href: '/docs/routing-middleware-reference', source: 'docs/routing-middleware-reference.md', label: 'Routing: middleware en detalle', section: 'Referencia' },
	{ slug: 'framework-reference', href: '/docs/framework-reference', source: 'docs/framework-reference.md', label: 'Runtimes, compatibilidad y límites', section: 'Referencia' },
	{ slug: 'migration-1.0', href: '/docs/migration-1.0', source: 'docs/migration-1.0.md', label: 'Migrar a 1.0', section: 'Referencia' },
	{ slug: 'migration-1.1', href: '/docs/migration-1.1', source: 'docs/migration-1.1.md', label: 'Actualizar a 1.1', section: 'Referencia' },
	{ slug: 'migration-1.2', href: '/docs/migration-1.2', source: 'docs/migration-1.2.md', label: 'Actualizar a 1.2', section: 'Referencia' },
	{ slug: 'migration-1.3', href: '/docs/migration-1.3', source: 'docs/migration-1.3.md', label: 'Actualizar a 1.3', section: 'Referencia' },
	{ slug: 'migration-1.4', href: '/docs/migration-1.4', source: 'docs/migration-1.4.md', label: 'Actualizar a 1.4', section: 'Referencia' },
	{ slug: 'migration-1.5', href: '/docs/migration-1.5', source: 'docs/migration-1.5.md', label: 'Actualizar a 1.5', section: 'Referencia' },
	{ slug: 'migration-1.6', href: '/docs/migration-1.6', source: 'docs/migration-1.6.md', label: 'Actualizar a 1.6', section: 'Referencia' },
	{ slug: 'migration-1.7', href: '/docs/migration-1.7', source: 'docs/migration-1.7.md', label: 'Actualizar a 1.7', section: 'Referencia' },
	{ slug: 'migration-1.8', href: '/docs/migration-1.8', source: 'docs/migration-1.8.md', label: 'Actualizar a 1.8', section: 'Referencia' },
	{ slug: 'benchmarks', href: '/docs/benchmarks', source: 'docs/benchmarks.md', label: 'Rendimiento', section: 'Referencia' },
	{ slug: 'contributing', href: '/docs/contributing', source: 'docs/contributing.md', label: 'Contribuir a Meeko', section: 'Proyecto' },
	{ slug: 'roadmap', href: '/docs/roadmap', source: 'docs/roadmap.md', label: 'Plan de desarrollo', section: 'Proyecto' },
	{ slug: 'changelog', href: '/docs/changelog', source: 'CHANGELOG.md', label: 'Cambios', section: 'Proyecto' },
]

/** The sidebar labels of the guides in English, by slug; a guide without one keeps its Spanish label. */
const englishLabels: Readonly<Record<string, string>> = {
	'inicio-rapido': 'Quick start',
	'primeros-pasos': 'First application',
	documentacion: 'Documentation map',
	'como-elegir': 'Common decisions',
	framework: 'Full-stack framework',
	'framework-configuration': 'Configure and extend',
	'framework-rendering': 'Render pages and layouts',
	'framework-api': 'Build APIs and RPC',
	'framework-websocket': 'Use WebSocket',
	'framework-server': 'Server runtime and errors',
	'framework-auth': 'Authentication and sessions',
	'framework-deployment': 'Build and deploy',
	'framework-reference': 'Runtimes, compatibility and limits',
	routing: 'Routing: start here',
	router: 'Create routes and navigate',
	'routing-pages': 'Pages and parameters',
	'routing-data': 'Load data',
	'routing-layouts': 'Layouts',
	'routing-navigation': 'Navigation',
	'routing-middleware': 'Route middleware',
	api: 'Components and .meeko language',
	'component-basics': 'Components and props',
	'component-template': 'Templates and directives',
	'component-events': 'Events, models and snippets',
	'language-reactivity': 'Reactivity and lifecycle',
	'component-styles': 'Component styles',
	'component-dynamic': 'Dynamic components',
	'component-attributes': 'Attributes and static props',
	'component-advanced': 'Composition and generated module',
	'component-builtins': 'Built-in components',
	ui: 'Meeko UI',
	'ui-api': 'Meeko UI components',
	i18n: 'Internationalization',
	doctor: 'Doctor',
	editors: 'Editors',
	eslint: 'ESLint',
	tooling: 'ESLint and Prettier',
	devtools: 'DevTools',
	testing: 'Testing and CI',
	stability: 'Stability 1.x',
	architecture: 'Architecture',
	'routing-data-reference': 'Routing: data details',
	'routing-layouts-reference': 'Routing: layout details',
	'routing-navigation-reference': 'Routing: navigation details',
	'routing-middleware-reference': 'Routing: middleware details',
	'migration-1.0': 'Migrate to 1.0',
	benchmarks: 'Performance',
	performance: 'Measure your application',
	contributing: 'Contribute to Meeko',
	roadmap: 'Roadmap',
	changelog: 'Changes',
}

/** The sections of the sidebar in English, by their Spanish title. */
const englishSections: Readonly<Record<string, string>> = {
	Empezar: 'Get started',
	Fundamentos: 'Fundamentals',
	'Guías prácticas': 'How-to guides',
	Ecosistema: 'Ecosystem',
	Herramientas: 'Tools',
	Referencia: 'Reference',
	Proyecto: 'Project',
}

/** The sidebar label of a guide in `locale`: «Actualizar a 1.x» is «Upgrade to 1.x» in English. */
export function catalogLabel(entry: CatalogEntry, locale: DocsLocale = currentLocale()): string {
	if (locale === 'es') return entry.label
	const upgrade = /^Actualizar a (\S+)$/.exec(entry.label)
	return englishLabels[entry.slug] ?? (upgrade ? `Upgrade to ${upgrade[1]}` : entry.label)
}

/** The title of a section of the sidebar in `locale`. */
export function catalogSection(title: string, locale: DocsLocale = currentLocale()): string {
	return locale === 'es' ? title : (englishSections[title] ?? title)
}

/** Slugs of the `/docs/[slug]` pages, for `prerenderEntries`. */
export const docSlugs: readonly string[] = catalog.map((entry) => entry.slug)

/** A short destination map for the docs landing page; the complete inventory remains in the sidebar. */
export const docsIndexSlugs: ReadonlySet<string> = new Set(['inicio-rapido', 'primeros-pasos', 'como-elegir', 'framework', 'api', 'component-basics', 'routing', 'routing-data', 'routing-navigation', 'ui', 'i18n', 'editors', 'doctor', 'testing', 'stability', 'changelog'])

/** The entry of a slug. */
export function catalogEntry(slug: string): CatalogEntry | undefined {
	return catalog.find((entry) => entry.slug === slug)
}

/** Site URL of a repository file, if the site publishes it. */
export function pageOfSource(source: string): string | undefined {
	return catalog.find((entry) => entry.source === source)?.href
}

/** The sidebar, grouped by section in reading order, with the API reference after the guides. */
export function navigation(): NavSection[] {
	const sections: Array<{ title: string; links: NavLink[] }> = []
	for (const entry of catalog) {
		let section = sections.find((candidate) => candidate.title === entry.section)
		if (!section) sections.push((section = { title: entry.section, links: [] }))
		section.links.push({ href: entry.href, label: catalogLabel(entry) })
	}
	// The index links to the taxonomy without expanding all its symbols in the guide sidebar.
	const text = messages()
	const reference = {
		title: text.reference,
		links: [
			{ href: referenceHref, label: text.referenceIndex },
			...taxonomy().map((group) => ({ href: `${referenceHref}#${group.anchor}`, label: group.title })),
			{ href: exportsHref, label: text.allExports },
		],
	}
	const guides = sections.findIndex((section) => section.title === 'Referencia')
	sections.splice(guides < 0 ? sections.length : guides, 0, reference)
	return sections.map((section) => (section === reference ? section : { ...section, title: catalogSection(section.title) }))
}

/** Previous and next pages of `href` in reading order. */
export function pager(href: string): Pager {
	const index = catalog.findIndex((entry) => entry.href === href)
	const link = (entry: CatalogEntry | undefined): NavLink | null => (entry ? { href: entry.href, label: catalogLabel(entry) } : null)
	if (index < 0) return { previous: null, next: null }
	const current = catalog[index]!
	const withinSection = (entry: CatalogEntry | undefined): CatalogEntry | undefined => entry?.section === current.section ? entry : undefined
	return { previous: link(withinSection(catalog[index - 1])), next: link(withinSection(catalog[index + 1])) }
}
