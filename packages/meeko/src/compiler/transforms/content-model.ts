import type { CompileDiagnostic } from '../parser/sfc'
import type { TemplateNode } from '../parser/template'

import { htmlElements } from '../../shared/html-data/attributes'
import { locate } from '../parser/sfc'

/**
 * Elementos cuyo modelo de contenido es sólo contenido de frase (`Phrasing content` del estándar
 * HTML). `<legend>`, `<summary>`, `<dt>` y `<th>` también admiten encabezados u otros bloques y no
 * están: el aviso no debe dar falsos positivos.
 */
const phrasingOnly: ReadonlySet<string> = new Set('p h1 h2 h3 h4 h5 h6 pre span em strong small s cite q dfn abbr data time code var samp kbd sub sup i b u mark bdi bdo label output button rt rp progress meter'.split(' '))

/** Elementos transparentes: admiten lo que admite su padre (`<a>` dentro de un `<p>` sólo admite frase). */
const transparent: ReadonlySet<string> = new Set('a ins del map canvas audio video object noscript slot'.split(' '))

const htmlNamespace = 'http://www.w3.org/1999/xhtml'

/**
 * Un elemento de bloque: de la categoría de flujo pero no de la de frase (`<div>`, `<ul>`,
 * `<table>`, `<section>`, `<h1>`…), según los datos HTML del estándar. `<style>` queda fuera: Meeko
 * lo trata aparte.
 */
export function isBlockElement(tag: string): boolean {
	if (tag === 'style') return false
	const categories = (htmlElements as Record<string, { readonly categories?: readonly string[] } | undefined>)[tag]?.categories
	return categories !== undefined && categories.includes('flow') && !categories.includes('phrasing')
}

/** Contexto de frase de un nodo: el padre más cercano que sólo admite frase y si sigue abierto un `<p>`. */
interface PhrasingContext {
	/** Padre que sólo admite contenido de frase. */
	readonly parent: string
	/**
	 * Hay un `<p>` abierto que un elemento de bloque cerraría en el navegador. Un `<button>` lo
	 * separa (`button scope` del parser HTML): un `<div>` dentro de él no cierra el párrafo.
	 */
	readonly paragraph: boolean
}

/**
 * Elemento raíz conocido de un componente de la plantilla: la etiqueta HTML de bloque que pinta en
 * su nivel superior, o `undefined` si no se conoce o sólo pinta contenido de frase.
 */
export type ComponentBlockRoot = (name: string) => string | undefined

function blockInParagraphMessage(child: string, owner: string | undefined): string {
	const what = owner ? `<${owner}> pinta un <${child}>` : `<${child}>`
	return `${what} dentro de <p>, que sólo admite contenido de frase: el navegador cierra el <p> antes del <${child}> y saca de él lo que sigue, así que el DOM del cliente no coincide con el HTML del servidor y la página no se hidrata (Hydration mismatch, controles sin respuesta). ` + `Usa un <div> en lugar del <p>${owner ? ` o un componente que pinte contenido de frase (<span>)` : `, o un elemento de frase (<span>) en lugar del <${child}>`}`
}

function blockInPhrasingMessage(child: string, parent: string, owner: string | undefined): string {
	const what = owner ? `<${owner}> pinta un <${child}>` : `<${child}>`
	return `${what} dentro de <${parent}>, que sólo admite contenido de frase según el modelo de contenido de HTML: el documento no es válido y el navegador puede reordenarlo. Usa un elemento de frase (<span>) o saca el <${child}> de <${parent}>`
}

/** Explicación de un `<p>` que el parser cerró antes de `child` en la propia plantilla. */
function closedParagraphMessage(child: string): string {
	return `<${child}> dentro de <p>, que sólo admite contenido de frase: el HTML cierra el <p> antes del <${child}> y el </p> final abre un párrafo vacío, así que el <${child}> y lo que lo sigue quedan fuera del párrafo, con otro aspecto y otra estructura que la escrita. Usa un <div> en lugar del <p>, o un elemento de frase (<span>) en lugar del <${child}>`
}

/**
 * Avisos `MEEK139`: un elemento de bloque dentro de un elemento que sólo admite contenido de frase
 * (`<p>`, `<span>`, `<button>`, encabezados, `<a>` dentro de frase…), según el modelo de contenido
 * de HTML. Dentro de un `<p>` el navegador cierra el párrafo antes del bloque, y si el bloque lo pinta
 * un componente, o es un elemento autocerrado como `<div />`, el DOM del cliente ya no coincide con
 * el HTML del servidor y la hidratación falla. `componentRoot` da la raíz de bloque de un componente
 * conocido (`meeko check`); sin él sólo se comprueban los elementos HTML de la plantilla.
 */
export function contentModelHints(source: string, filename: string, root: TemplateNode, componentRoot?: ComponentBlockRoot): CompileDiagnostic[] {
	const diagnostics: CompileDiagnostic[] = []
	const report = (offset: number, message: string): void => {
		diagnostics.push({ code: 'MEEK139', severity: 'warning', filename, location: locate(source, offset), message })
	}
	const visitChildren = (nodes: readonly TemplateNode[], context: PhrasingContext | undefined): void => {
		paragraphsClosedByParser(nodes, report)
		for (const child of nodes) visit(child, context)
	}
	const visit = (node: TemplateNode, context: PhrasingContext | undefined): void => {
		const tag = node.tagName
		if (tag === undefined) return
		if (node.namespaceURI !== undefined && node.namespaceURI !== htmlNamespace) return
		if (node.componentName !== undefined) {
			const block = context ? componentRoot?.(node.componentName) : undefined
			if (context && block) report(node.start, context.paragraph ? blockInParagraphMessage(block, node.componentName) : blockInPhrasingMessage(block, context.parent, node.componentName))
			// Its content goes wherever the component places it, which this check does not know.
			visitChildren(node.childNodes ?? [], undefined)
			return
		}
		if (tag === 'template') {
			// `<template if:when>`, `each:of`…: its content renders in its place.
			visitChildren(node.content?.childNodes ?? node.childNodes ?? [], context)
			return
		}
		if (tag === 'snippet' || tag === 'render' || tag === 'component') {
			visitChildren(node.childNodes ?? [], undefined)
			return
		}
		if (context && isBlockElement(tag)) report(node.start, context.paragraph ? blockInParagraphMessage(tag, undefined) : blockInPhrasingMessage(tag, context.parent, undefined))
		const next: PhrasingContext | undefined = phrasingOnly.has(tag) ? { parent: tag, paragraph: tag === 'p' || (context?.paragraph === true && tag !== 'button') } : transparent.has(tag) ? context : undefined
		visitChildren(node.childNodes ?? [], next)
		if (node.content) visitChildren(node.content.childNodes, next)
	}
	visitChildren(root.childNodes ?? [], undefined)
	return diagnostics
}

/**
 * `<p>…<div>…</div>…</p>` en la plantilla: el parser HTML ya cerró el `<p>` antes del `<div>` y
 * convirtió el `</p>` final en un `<p>` vacío, sin posición en la fuente. Se avisa en el elemento
 * de bloque que sigue al `<p>` que quedó sin etiqueta de cierre.
 */
function paragraphsClosedByParser(nodes: readonly TemplateNode[], report: (offset: number, message: string) => void): void {
	for (let index = 0; index < nodes.length; index++) {
		const synthesized = nodes[index]!
		if (synthesized.tagName !== 'p' || synthesized.sourceCodeLocation) continue
		let opened = -1
		for (let previous = index - 1; previous >= 0; previous--) {
			const candidate = nodes[previous]!
			if (candidate.tagName === 'p' && candidate.sourceCodeLocation?.startTag && !candidate.sourceCodeLocation.endTag) {
				opened = previous
				break
			}
		}
		const closer = opened < 0 ? undefined : nodes.slice(opened + 1, index).find((candidate) => candidate.tagName !== undefined)
		if (closer?.tagName && closer.componentName === undefined) report(closer.start, closedParagraphMessage(closer.tagName))
	}
}
