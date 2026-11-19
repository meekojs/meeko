import { existsSync, readFileSync, statSync } from 'node:fs'
import { dirname, resolve } from 'node:path'

import type { TemplateNode } from '../compiler/parser/template'
import type { ComponentBlockRoot } from '../compiler/transforms/content-model'
import type { ProjectAliases } from '../framework/aliases'
import type { AutoImport } from './registry'

import { aliasCandidates } from '../compiler/aliases'
import { parseSfc } from '../compiler/parser/sfc'
import { parseTemplate } from '../compiler/parser/template'
import { isBlockElement } from '../compiler/transforms/content-model'

/** Raíz de un archivo `.meeko`: sus etiquetas HTML de nivel superior y los componentes que pinta ahí, con su mtime. */
interface ComponentTop {
	readonly mtime: number
	readonly tags: readonly string[]
	readonly components: readonly string[]
	/** Componentes `.meeko` importados en su script, por nombre local. */
	readonly imports: ReadonlyMap<string, string>
}

/** Caché por archivo: `meeko check .` y el editor leen los mismos componentes una y otra vez. */
const tops = new Map<string, ComponentTop | null>()

const meekoImport = /\bimport\s+(?:\*\s+as\s+)?([A-Za-z_$][\w$]*)\s+from\s+(["'])([^"'\n]+\.meeko)\2/g

/** Componentes `.meeko` importados por el script de `source`, como archivo, por nombre local. */
function importedFiles(script: string, filename: string, aliases: ProjectAliases | undefined): Map<string, string> {
	const files = new Map<string, string>()
	for (const match of script.matchAll(meekoImport)) {
		const [, name, , specifier] = match
		if (specifier!.startsWith('.')) files.set(name!, resolve(dirname(filename), specifier!))
		else {
			const candidates = aliases ? aliasCandidates(aliases.aliases, specifier!) : undefined
			const file = candidates?.find((candidate) => existsSync(candidate)) ?? candidates?.[0]
			if (file) files.set(name!, file)
		}
	}
	return files
}

/** Elementos y componentes del nivel superior de una plantilla, atravesando `<template>`. */
function topLevel(nodes: readonly TemplateNode[], tags: string[], components: string[]): void {
	for (const node of nodes) {
		if (node.componentName !== undefined) components.push(node.componentName)
		else if (node.tagName === 'template') topLevel(node.content?.childNodes ?? node.childNodes ?? [], tags, components)
		else if (node.tagName !== undefined) tags.push(node.tagName)
	}
}

function readTop(file: string, aliases: ProjectAliases | undefined): ComponentTop | undefined {
	let mtime: number
	try {
		mtime = statSync(file).mtimeMs
	} catch {
		return undefined
	}
	const cached = tops.get(file)
	if (cached !== undefined && (cached === null || cached.mtime === mtime)) return cached ?? undefined
	try {
		const source = readFileSync(file, 'utf8')
		const sfc = parseSfc(source, file)
		const tags: string[] = []
		const components: string[] = []
		topLevel(parseTemplate(source, sfc.template, file).childNodes ?? [], tags, components)
		const top: ComponentTop = { mtime, tags, components, imports: importedFiles(sfc.script.content, file, aliases) }
		tops.set(file, top)
		return top
	} catch {
		// A component that does not compile reports its own error; here its root is unknown.
		tops.set(file, null)
		return undefined
	}
}

/**
 * Raíz de bloque de los componentes que usa un `.meeko`, para el aviso `MEEK139` de `meeko check` y
 * del editor: la primera etiqueta HTML de bloque (`<div>`, `<ul>`…) que el componente pinta en el
 * nivel superior de su plantilla, siguiendo los componentes que a su vez pinta ahí (`<UITooltip>`
 * pinta un `<Popover>`, que pinta un `<div>`). Se conocen los componentes importados con una ruta
 * `.meeko` y los autoimportados del proyecto y sus módulos; las etiquetas propias de Meeko y los
 * componentes dinámicos no.
 */
export function componentBlockRoots(script: string, filename: string, registry: readonly AutoImport[], aliases?: ProjectAliases): ComponentBlockRoot {
	const registered = new Map(registry.filter((entry) => entry.component && !entry.typeOnly && entry.file.endsWith('.meeko')).map((entry) => [entry.name, entry.file] as const))
	const own = importedFiles(script, filename, aliases)
	const blockOf = (file: string, seen: Set<string>): string | undefined => {
		if (seen.has(file) || seen.size > 8) return undefined
		seen.add(file)
		const top = readTop(file, aliases)
		if (!top) return undefined
		const tag = top.tags.find(isBlockElement)
		if (tag) return tag
		for (const name of top.components) {
			const child = top.imports.get(name) ?? registered.get(name)
			const nested = child ? blockOf(child, seen) : undefined
			if (nested) return nested
		}
		return undefined
	}
	return (name) => {
		const file = own.get(name) ?? registered.get(name)
		return file ? blockOf(file, new Set()) : undefined
	}
}
