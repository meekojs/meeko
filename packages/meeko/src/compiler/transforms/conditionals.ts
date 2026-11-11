import type { TemplateAttribute, TemplateNode } from '../parser/template'

import { compileError } from '../parser/sfc'

/** Valida y enlaza `if`/`else-if`/`else`; `if:when` conserva su contrato como alias de `if`. */
export function prepareConditionals(root: TemplateNode, source: string, filename: string, tolerant = false): void {
	const fail = (message: string, attribute: TemplateAttribute): void => {
		if (!tolerant) throw compileError(source, filename, 'MEEK138', message, attribute.start)
	}
	const rename = (node: TemplateNode, attribute: TemplateAttribute): void => {
		const original = attribute.name
		attribute.originalName = original
		attribute.name = 'if:when'
		const location = node.sourceCodeLocation?.attrs?.[original]
		if (location) node.sourceCodeLocation!.attrs!['if:when'] = location
	}
	const visit = (children: readonly TemplateNode[]): void => {
		let previous: TemplateNode | undefined
		for (const node of children) {
			visit(node.childNodes ?? [])
			visit(node.content?.childNodes ?? [])
			if (node.nodeName === '#comment' || (node.nodeName === '#text' && /^[\t\n\f\r ]*$/.test(node.value ?? ''))) continue
			const directives = node.attrs?.filter((attribute) => ['if', 'if:when', 'else-if', 'else'].includes(attribute.name)) ?? []
			if (directives.length > 1) fail('Una etiqueta sólo puede llevar una directiva condicional: if, else-if o else', directives[1]!)
			const directive = directives[0]
			if (!directive) {
				previous = undefined
				continue
			}
			const name = directive.name
			if ((name === 'else-if' || name === 'else') && node.attrs?.some((attribute) => attribute.name === 'each:of')) fail('No combines una directiva condicional con each:of; coloca la cadena dentro de un <template each:of="…">', directive)
			if (name !== 'else' && name !== 'if:when' && !directive.value.trim()) fail(`${name} necesita una expresión`, directive)
			if (name === 'if' || name === 'if:when') {
				if (name === 'if') rename(node, directive)
				previous = node
				continue
			}
			if (node.tagName === 'snippet' || previous?.tagName === 'snippet') fail('Para encadenar condiciones en un snippet, coloca if/else-if/else en su contenido, no en la declaración <snippet>', directive)
			if (!previous?.attrs?.some((attribute) => attribute.name === 'if:when')) {
				fail(`${name} debe seguir a una etiqueta con if o else-if; entre ramas sólo se permiten espacios y comentarios`, directive)
			} else {
				previous.conditionalElse = node
				node.conditionalContinuation = true
			}
			if (name === 'else-if') rename(node, directive)
			else {
				if (source.slice(directive.start, directive.end).includes('=')) fail('else no lleva valor: escribe sólo else', directive)
				node.attrs = node.attrs!.filter((attribute) => attribute !== directive)
			}
			previous = node
		}
	}
	visit(root.childNodes ?? [])
	visit(root.content?.childNodes ?? [])
}
