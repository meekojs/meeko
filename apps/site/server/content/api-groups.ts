import { packageFolder, readRepositoryFile } from './repository.js'

/** A group of the API reference: the `.meeko` syntax or a public subpath of `@meekojs/meeko`. */
export interface ApiGroup {
	/** Anchor in the index and part of the slugs that disambiguate a name: `server`, `meeko`. */
	readonly id: string
	/** Short label of the sidebar. */
	readonly label: string
	/** Heading of the index: the module specifier, or the name of the syntax group. */
	readonly title: string
	/** Subpath of `package.json#exports`, such as `./server`; `null` for the syntax group. */
	readonly subpath: string | null
	/** `@meekojs/meeko/server`; `null` for the syntax group. */
	readonly specifier: string | null
	/** Source entry of the subpath from the repository root, such as `packages/meeko/src/framework-server.ts`. */
	readonly entry: string | null
	readonly description: string
}

/** URL of the index of the reference. */
export const referenceHref = '/docs/reference'

const packageName = '@meekojs/meeko'

/**
 * Label and description of the known subpaths, in reading order. A subpath that the package adds
 * later still gets a group, after these, with a generic description.
 */
const known: Readonly<Record<string, { readonly label: string; readonly description: string }>> = {
	'.': {
		label: 'Núcleo',
		description: 'El motor de componentes: señales, efectos, ciclo de vida, contexto, observador de errores, serialización y los tipos de componentes, snippets y DevTools.',
	},
	'./framework': {
		label: 'Framework',
		description: 'La aplicación: configuración, módulos y plugins, rutas y páginas, navegación, head del documento, estado, formularios y almacenamiento, y los clientes de API, RPC y Socket.',
	},
	'./server': {
		label: 'Servidor',
		description: 'El servidor de la aplicación: runtime, middleware, contexto de la petición, sesiones y sus almacenes, endpoints de API y RPC, canales Socket, OpenAPI y llamadas locales.',
	},
	'./node': { label: 'Node.js', description: 'Adaptador de Node.js: listener y servidor HTTP, lectura de assets y WebSocket.' },
	'./bun': { label: 'Bun', description: 'Adaptador de Bun: servidor con WebSocket y lectura de assets.' },
	'./deno': { label: 'Deno', description: 'Adaptador de Deno: servidor y lectura de assets.' },
	'./cloudflare': {
		label: 'Cloudflare',
		description: 'Adaptador de Cloudflare Workers: el worker, las salas Socket en Durable Objects, los assets, el prerender y las sesiones en D1.',
	},
	'./build': {
		label: 'Build',
		description: 'Herramientas de build para Node: descubrimiento de rutas, configuración, prerender y builds de adaptadores. Lee el sistema de archivos y carga TypeScript.',
	},
	'./vite': { label: 'Vite', description: 'El plugin de Vite: compila los imports `.meeko` en cliente y SSR y añade HMR y CSS en desarrollo.' },
	'./prettier': { label: 'Prettier', description: 'El plugin de Prettier para `.meeko`: script, `<script server>`, plantilla y estilo.' },
	'./devtools-ui': { label: 'DevTools', description: 'El panel de DevTools que se monta dentro de la página.' },
}

/** The syntax of a `.meeko` file that the compiler recognizes without an import. */
export const syntaxGroup: ApiGroup = {
	id: 'meeko-syntax',
	label: 'Sintaxis .meeko',
	title: 'Sintaxis de .meeko',
	subpath: null,
	specifier: null,
	entry: null,
	description: 'Lo que el compilador reconoce en un archivo `.meeko` sin importarlo: los bloques del componente, las macros del script, las etiquetas propias y las directivas de la plantilla.',
}

let groups: readonly ApiGroup[] | undefined

/**
 * The groups of the reference: the syntax of `.meeko`, then every public subpath of
 * `package.json#exports` except `./internal` and `./builtins/*`, which only compiled components
 * import (the types of the built-in tags are documented through `./framework`).
 */
export function apiGroups(): readonly ApiGroup[] {
	if (groups) return groups
	const manifest = JSON.parse(readRepositoryFile(`${packageFolder}/package.json`)) as {
		exports: Readonly<Record<string, { readonly default?: string }>>
	}
	const subpaths = Object.entries(manifest.exports).filter(([subpath, target]) => subpath !== './internal' && subpath !== './builtins/*' && typeof target.default === 'string')
	const order = Object.keys(known)
	const rank = (subpath: string): number => (order.includes(subpath) ? order.indexOf(subpath) : order.length)
	subpaths.sort(([left], [right]) => rank(left) - rank(right))
	groups = [
		syntaxGroup,
		...subpaths.map(([subpath, target]): ApiGroup => {
			const name = subpath === '.' ? 'meeko' : subpath.slice(2)
			const meta = known[subpath]
			return {
				id: name,
				label: meta?.label ?? name,
				title: subpath === '.' ? packageName : `${packageName}/${name}`,
				subpath,
				specifier: subpath === '.' ? packageName : `${packageName}/${name}`,
				// `./dist/framework-server.js` is built from `src/framework-server.ts`.
				entry: `${packageFolder}/${target.default!.replace(/^\.\/dist\//, 'src/').replace(/\.js$/, '.ts')}`,
				description: meta?.description ?? `Los exports de \`${packageName}/${name}\`.`,
			}
		}),
	]
	return groups
}

/** URL of a group in the index. */
export function groupHref(group: ApiGroup): string {
	return `${referenceHref}#${group.id}`
}
