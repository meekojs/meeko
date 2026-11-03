import { endsInLiteralOrComment, scanInterpolations } from '../../meeko/src/compiler/parser/interpolation'
import { sectionAt, tagAt } from '../../meeko/src/language-server/regions'

/** Bloque cuyo contenido admite fragmentos en una posición. */
export type SnippetContext = 'script' | 'template'

/** Comments and tags can hold a `{` that opens no interpolation. */
const notTemplateText = /<!--[\s\S]*?-->|<[A-Za-z](?:[^>"']|"[^"]*"|'[^']*')*>/g

function acceptsTemplateSnippet(source: string, contentStart: number, offset: number): boolean {
	if (tagAt(source, offset)) return false
	const before = source.slice(contentStart, offset)
	// An unfinished comment or tag name: `<`, `<di`, `</di`.
	if (before.lastIndexOf('<!--') > before.lastIndexOf('-->') || /<\/?[^\s<>]*$/.test(before)) return false
	return scanInterpolations(before.replace(notTemplateText, ' ')).unterminated === undefined
}

function acceptsScriptSnippet(source: string, contentStart: number, offset: number): boolean {
	const before = source.slice(contentStart, offset)
	// `value.m`: a member is being written, and a statement cannot go there.
	return !/\.[^\S\r\n]*[\w$]*$/.test(before) && !endsInLiteralOrComment(before)
}

/**
 * Qué fragmentos de bloque admite una posición de un `.meeko`: los de script en el código de
 * `<script>` y `<script server>`, los de plantilla en el contenido de `<template>`, y ninguno en
 * `<style>`, en la raíz, en un comentario, en una cadena, en un valor de atributo, dentro de una
 * etiqueta ni en una expresión `{…}`. Lee sólo el texto: responde mientras el componente no compila.
 *
 * @example
 * snippetContextAt('<script lang="ts">\n\n</script>', 19) // 'script'
 * snippetContextAt('<style>\n\n</style>', 8) // undefined
 */
export function snippetContextAt(source: string, offset: number): SnippetContext | undefined {
	const section = sectionAt(source, offset)
	if (section?.name === 'script') return acceptsScriptSnippet(source, section.contentStart, offset) ? 'script' : undefined
	if (section?.name === 'template') return acceptsTemplateSnippet(source, section.contentStart, offset) ? 'template' : undefined
	return undefined
}
