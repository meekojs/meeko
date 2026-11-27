import { existsSync, readFileSync, statSync } from 'node:fs'
import { dirname, isAbsolute, join, relative } from 'node:path'

import { t } from './l10n'

/** A file that a «Meeko: nuevo…» command writes; `append` adds to an existing file instead. */
export interface ScaffoldFile {
	readonly path: string
	readonly content: string
	readonly append?: boolean
}

/** The Meeko project that contains `path`: the nearest folder with `meeko.config.*` or `app/pages`. */
export function projectRootOf(path: string): string | undefined {
	for (let current = path; ; current = dirname(current)) {
		if (['meeko.config.ts', 'meeko.config.mts', 'meeko.config.js', 'meeko.config.mjs'].some((name) => existsSync(join(current, name))) || existsSync(join(current, 'app', 'pages'))) return current
		if (dirname(current) === current) return undefined
	}
}

const pascal = (text: string): string => text.replace(/(?:^|[-_\s]+)([a-zA-Z0-9])/g, (_, char: string) => char.toUpperCase())
const camel = (text: string): string => {
	const value = pascal(text)
	return value.charAt(0).toLowerCase() + value.slice(1)
}

const routeSegment = /^(?:[a-z0-9][a-z0-9-]*|\[(?:\.\.\.)?[A-Za-z_$][\w$]*\])$/
const componentSegment = /^[A-Z][A-Za-z0-9]*$/

/** Segments of a route such as `/users/[id]`, or a message when it is not one. */
function routeSegments(route: string): string[] | string {
	const path = route.trim().replace(/^\/api(?=\/|$)/, '')
	if (!path.startsWith('/')) return t('The route starts with /, for example /users/[id]')
	const segments = path.split('/').filter(Boolean)
	const invalid = segments.find((segment) => !routeSegment.test(segment))
	return invalid ? t('"{0}" is not a valid segment: use lowercase letters, digits and hyphens, or [param]', invalid) : segments
}

/**
 * `AppCard` → `app/components/App/Card.meeko` when `app/components/App` exists (autoimports name a
 * component by its folders and file), else `app/components/AppCard.meeko`. `App/Card` is a path.
 */
export function componentFile(root: string, name: string, indent = '  '): ScaffoldFile | string {
	const trimmed = name.trim().replace(/\.meeko$/, '')
	if (!/^[A-Z][A-Za-z0-9]*(?:\/[A-Z][A-Za-z0-9]*)*$/.test(trimmed)) return t('Use PascalCase, for example AppCard or App/Card')
	const components = join(root, 'app', 'components')
	let path: string
	if (trimmed.includes('/')) path = join(components, `${trimmed}.meeko`)
	else {
		const words = trimmed.match(/[A-Z][a-z0-9]*/g) ?? [trimmed]
		let directory = components
		let used = 0
		while (used < words.length - 1 && existsSync(join(directory, words[used]!))) directory = join(directory, words[used++]!)
		path = join(directory, `${words.slice(used).join('')}.meeko`)
	}
	return { path, content: `<template>\n${indent}<div></div>\n</template>\n` }
}

/** `/users/[id]` → `app/pages/users/[id].meeko`, `/users` → `app/pages/users/index.meeko`, `/` → `app/pages/index.meeko`. */
export function pageFile(root: string, route: string, indent = '  '): ScaffoldFile | string {
	const segments = routeSegments(route)
	if (typeof segments === 'string') return segments
	const last = segments.at(-1)
	const path = last && last.startsWith('[') ? join(root, 'app', 'pages', ...segments) + '.meeko' : join(root, 'app', 'pages', ...segments, 'index.meeko')
	const title = last ? pascal(last.replace(/^\[(?:\.\.\.)?|\]$/g, '')) : 'Inicio'
	return {
		path,
		content: `<script lang="ts">\nuseHead({ title: ${JSON.stringify(title)} });\n</script>\n\n<template>\n${indent}<section>\n${indent}${indent}<h1>${title}</h1>\n${indent}</section>\n</template>\n`,
	}
}

/** The Standard Schema library of the project, from its `package.json`. */
export function schemaLibrary(root: string): 'valibot' | 'zod' | undefined {
	try {
		const manifest = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8')) as Record<string, Record<string, string> | undefined>
		const dependencies = { ...manifest['devDependencies'], ...manifest['dependencies'] }
		return 'valibot' in dependencies ? 'valibot' : 'zod' in dependencies ? 'zod' : undefined
	} catch {
		return undefined
	}
}

const methods = ['GET', 'POST', 'PUT', 'PATCH', 'DELETE'] as const
export type EndpointMethod = (typeof methods)[number]

/**
 * An API endpoint and its public schemas, which `meeko check` requires: `GET /users/[id]` →
 * `server/api/users/[id].get.ts` with `getUsersById{Params,Response}` in
 * `shared/schemas/users.ts`, added to that file when it exists.
 */
export function endpointFiles(root: string, method: EndpointMethod, route: string, library: 'valibot' | 'zod', indent = '  '): ScaffoldFile[] | string {
	const segments = routeSegments(route)
	if (typeof segments === 'string') return segments
	if (!segments.length) return t('Enter the endpoint route, for example /users')
	const verb = method.toLowerCase()
	const last = segments.at(-1)!
	const endpoint = last.startsWith('[') ? join(root, 'server', 'api', ...segments.slice(0, -1), `${last}.${verb}.ts`) : join(root, 'server', 'api', ...segments, `index.${verb}.ts`)
	const statics = segments.filter((segment) => !segment.startsWith('['))
	const params = segments.filter((segment) => segment.startsWith('[')).map((segment) => segment.replace(/^\[(?:\.\.\.)?|\]$/g, ''))
	const base = `${verb}${statics.map(pascal).join('')}${params.length ? `By${params.map(pascal).join('And')}` : ''}`
	const resource = statics[0] ?? 'api'
	const schemas = join(root, 'shared', 'schemas', `${camel(resource)}.ts`)
	const names = {
		params: params.length ? `${base}Params` : undefined,
		body: method === 'POST' || method === 'PUT' || method === 'PATCH' ? `${base}Body` : undefined,
		response: `${base}Response`,
	}
	const object = (fields: string) => `${library === 'valibot' ? 'v' : 'z'}.object(${fields ? `{ ${fields} }` : '{}'})`
	const text = library === 'valibot' ? 'v.string()' : 'z.string()'
	const flag = library === 'valibot' ? 'v.boolean()' : 'z.boolean()'
	const exported = [
		...(names.params ? [`export const ${names.params} = ${object(params.map((param) => `${param}: ${text}`).join(', '))};`] : []),
		...(names.body ? [`export const ${names.body} = ${object('')};`] : []),
		`export const ${names.response} = ${object(`ok: ${flag}`)};`,
	]
	const existing = existsSync(schemas) ? readFileSync(schemas, 'utf8') : undefined
	if (existing && exported.some((line) => existing.includes(line.slice(0, line.indexOf(' =')) + ' '))) {
		return t('{0} already exports a schema for {1} {2}', relative(root, schemas).replaceAll('\\', '/'), method, route)
	}
	const header = library === 'valibot' ? `import * as v from "valibot";\n` : `import { z } from "zod";\n`
	const schemaFile: ScaffoldFile = existing === undefined ? { path: schemas, content: `${header}\n${exported.join('\n')}\n` } : { path: schemas, content: `${existing.endsWith('\n') ? '' : '\n'}\n${exported.join('\n')}\n`, append: true }
	const specifier = relative(dirname(endpoint), schemas).replaceAll('\\', '/').replace(/\.ts$/, '.js')
	const imported = [names.params, names.body, names.response].filter(Boolean).join(', ')
	const fields = [
		...(names.params ? [`${indent}params: ${names.params},`] : []),
		...(names.body ? [`${indent}body: ${names.body},`] : []),
		`${indent}response: ${names.response},`,
		`${indent}handler: () => ({ ok: true }),`,
	]
	return [
		{ path: endpoint, content: `import { defineApiRoute } from "@meekojs/meeko/server";\nimport { ${imported} } from "${specifier.startsWith('.') ? specifier : `./${specifier}`}";\n\nexport default defineApiRoute({\n${fields.join('\n')}\n});\n` },
		schemaFile,
	]
}

export const endpointMethods: readonly EndpointMethod[] = methods

/** Clave de contexto que la extensión activa y que muestra los comandos «Meeko: nuevo…» en el menú del explorador. */
export const scaffoldContextKey = 'meeko.scaffold'

/** Qué crea un comando «Meeko: nuevo…». */
export type ScaffoldKind = 'component' | 'endpoint' | 'page'

/** La carpeta sobre la que actúa un clic del explorador: el propio recurso si es una carpeta, o la que lo contiene. */
export function clickedFolder(path: string): string {
	try {
		return statSync(path).isDirectory() ? path : dirname(path)
	} catch {
		return dirname(path)
	}
}

/**
 * Valor inicial del cuadro de entrada cuando el comando se lanza sobre una carpeta del explorador:
 * `app/pages/users` → `/users/` para una página, `server/api/users` → `/users/` para un endpoint y
 * `app/components/App/Forms` → `App/Forms/` para un componente. Devuelve `undefined` si la carpeta
 * no pertenece a la raíz de ese tipo, si es la propia `app/components` o si algún tramo no es un
 * segmento que el comando acepte, porque el valor propuesto no podría completarse.
 */
export function scaffoldPrefill(kind: ScaffoldKind, root: string, folder: string): string | undefined {
	const base = kind === 'component' ? join(root, 'app', 'components') : kind === 'page' ? join(root, 'app', 'pages') : join(root, 'server', 'api')
	const inside = relative(base, folder)
	if (inside === '..' || /^\.\.[\\/]/.test(inside) || isAbsolute(inside)) return undefined
	const segments = inside.split(/[\\/]/).filter(Boolean)
	if (kind === 'component') return segments.length && segments.every((segment) => componentSegment.test(segment)) ? `${segments.join('/')}/` : undefined
	if (!segments.every((segment) => routeSegment.test(segment))) return undefined
	return segments.length ? `/${segments.join('/')}/` : '/'
}

/** La unidad de sangría de los archivos generados: un tabulador, o `tabSize` espacios si el editor inserta espacios. */
export function indentUnit(insertSpaces: boolean, tabSize: number): string {
	return insertSpaces ? ' '.repeat(tabSize) : '\t'
}

/** El primer archivo que ya existe y se sobrescribiría: los que se añaden (`append`) no cuentan. */
export function takenFile(files: readonly ScaffoldFile[], exists: (path: string) => boolean = existsSync): ScaffoldFile | undefined {
	return files.find((file) => !file.append && exists(file.path))
}

/** El contenido que se escribe en disco: el del archivo, tras el contenido previo cuando se añade a uno existente. */
export function writtenContent(file: ScaffoldFile, previous: string): string {
	return (file.append ? previous : '') + file.content
}
