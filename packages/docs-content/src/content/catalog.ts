import type { NavLink, NavSection, Pager } from '../types/docs'

import { exportsHref, referenceHref } from './api-groups'
import { taxonomy } from './reference-taxonomy'

/** A page of the site and the Markdown file of the repository it renders. */
export interface CatalogEntry {
	/** Slug under `/docs/`. */
	readonly slug: string
	readonly href: string
	/** Path of the Markdown file, as `readRepositoryFile` takes it: `README.md` and `CHANGELOG.md` are the package's. */
	readonly source: string
	/** Short label of the sidebar; the page title is the document's own heading. */
	readonly label: string
	readonly section: string
	/** Rewrites the Markdown before rendering, such as the README's title and logo for the site. */
	readonly transform?: (text: string) => string
}

/**
 * The published documents in reading order. `docs/releasing.md` is internal and stays out; links
 * to it, and to any other file of the repository, go to GitHub.
 */
export const catalog: readonly CatalogEntry[] = [
	// The package README, whose title and centered logo (an image from GitHub, which the CSP blocks)
	// become the page's own heading.
	{
		slug: 'inicio-rapido',
		href: '/docs/inicio-rapido',
		source: 'README.md',
		label: 'Inicio rápido',
		section: 'Empezar',
		transform: (text) => text.replace(/^# Meeko\n+<p align="center">[\s\S]*?<\/p>\n+/, '# Inicio rápido\n\n'),
	},
	{ slug: 'primeros-pasos', href: '/docs/primeros-pasos', source: 'docs/primeros-pasos.md', label: 'Primera aplicación', section: 'Empezar' },
	{ slug: 'documentacion', href: '/docs/documentacion', source: 'docs/README.md', label: 'Mapa de documentación', section: 'Empezar' },
	{ slug: 'como-elegir', href: '/docs/como-elegir', source: 'docs/como-elegir.md', label: 'Cómo elegir', section: 'Empezar' },
	{ slug: 'framework', href: '/docs/framework', source: 'docs/framework.md', label: 'Framework full-stack', section: 'Framework' },
	{ slug: 'api', href: '/docs/api', source: 'docs/api.md', label: 'Componentes y API', section: 'Componentes y módulos' },
	{ slug: 'ui', href: '/docs/ui', source: 'docs/ui.md', label: 'Meeko UI', section: 'Componentes y módulos' },
	{ slug: 'i18n', href: '/docs/i18n', source: 'docs/i18n.md', label: 'Internacionalización', section: 'Componentes y módulos' },
	{ slug: 'doctor', href: '/docs/doctor', source: 'docs/doctor.md', label: 'Doctor', section: 'Herramientas' },
	{ slug: 'editors', href: '/docs/editors', source: 'docs/editors.md', label: 'Editores', section: 'Herramientas' },
	{ slug: 'tooling', href: '/docs/tooling', source: 'docs/tooling.md', label: 'ESLint y Prettier', section: 'Herramientas' },
	{ slug: 'devtools', href: '/docs/devtools', source: 'docs/devtools.md', label: 'DevTools', section: 'Herramientas' },
	{ slug: 'testing', href: '/docs/testing', source: 'docs/testing.md', label: 'Pruebas y CI', section: 'Herramientas' },
	{ slug: 'stability', href: '/docs/stability', source: 'docs/stability.md', label: 'Estabilidad 1.x', section: 'Referencia' },
	{ slug: 'architecture', href: '/docs/architecture', source: 'docs/architecture.md', label: 'Arquitectura', section: 'Referencia' },
	{ slug: 'migration-1.6', href: '/docs/migration-1.6', source: 'docs/migration-1.6.md', label: 'Actualizar a 1.6', section: 'Referencia' },
	{ slug: 'migration-1.7', href: '/docs/migration-1.7', source: 'docs/migration-1.7.md', label: 'Actualizar a 1.7', section: 'Referencia' },
	{ slug: 'migration-1.8', href: '/docs/migration-1.8', source: 'docs/migration-1.8.md', label: 'Actualizar a 1.8', section: 'Referencia' },
	{ slug: 'migration-1.5', href: '/docs/migration-1.5', source: 'docs/migration-1.5.md', label: 'Actualizar a 1.5', section: 'Referencia' },
	{ slug: 'migration-1.4', href: '/docs/migration-1.4', source: 'docs/migration-1.4.md', label: 'Actualizar a 1.4', section: 'Referencia' },
	{ slug: 'migration-1.3', href: '/docs/migration-1.3', source: 'docs/migration-1.3.md', label: 'Actualizar a 1.3', section: 'Referencia' },
	{ slug: 'migration-1.2', href: '/docs/migration-1.2', source: 'docs/migration-1.2.md', label: 'Actualizar a 1.2', section: 'Referencia' },
	{ slug: 'migration-1.1', href: '/docs/migration-1.1', source: 'docs/migration-1.1.md', label: 'Actualizar a 1.1', section: 'Referencia' },
	{ slug: 'migration-1.0', href: '/docs/migration-1.0', source: 'docs/migration-1.0.md', label: 'Migrar a 1.0', section: 'Referencia' },
	{ slug: 'benchmarks', href: '/docs/benchmarks', source: 'docs/benchmarks.md', label: 'Rendimiento', section: 'Referencia' },
	{ slug: 'performance', href: '/docs/performance', source: 'docs/performance.md', label: 'Presupuestos de rendimiento', section: 'Referencia' },
	{ slug: 'roadmap', href: '/docs/roadmap', source: 'docs/roadmap.md', label: 'Plan de desarrollo', section: 'Proyecto' },
	{ slug: 'changelog', href: '/docs/changelog', source: 'CHANGELOG.md', label: 'Cambios', section: 'Proyecto' },
]

/** Slugs of the `/docs/[slug]` pages, for `prerenderEntries`. */
export const docSlugs: readonly string[] = catalog.map((entry) => entry.slug)

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
		section.links.push({ href: entry.href, label: entry.label })
	}
	// The groups of the taxonomy, each at its place in the index; the reference has its own sidebar.
	const reference = {
		title: 'Referencia de la API',
		links: [
			{ href: referenceHref, label: 'Índice de la API' },
			...taxonomy().map((group) => ({ href: `${referenceHref}#${group.anchor}`, label: group.title })),
			{ href: exportsHref, label: 'Todos los exports' },
		],
	}
	const guides = sections.findIndex((section) => section.title === 'Componentes y módulos')
	sections.splice(guides < 0 ? sections.length : guides + 1, 0, reference)
	return sections
}

/** Previous and next pages of `href` in reading order. */
export function pager(href: string): Pager {
	const index = catalog.findIndex((entry) => entry.href === href)
	const link = (entry: CatalogEntry | undefined): NavLink | null => (entry ? { href: entry.href, label: entry.label } : null)
	return { previous: link(catalog[index - 1]), next: link(catalog[index + 1]) }
}
