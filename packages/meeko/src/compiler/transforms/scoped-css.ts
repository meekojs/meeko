import postcss from 'postcss'
import selectorParser from 'postcss-selector-parser'

import type { ScopeTargets } from './scope-targets'

import { scopeTargets } from './scope-targets'

export function scopeCss(css: string, scopeAttribute: string): { css: string; targets: ScopeTargets } {
	const root = postcss.parse(css)
	root.walkRules((rule) => {
		let parent: postcss.Node | undefined = rule.parent
		while (parent) {
			if (parent.type === 'atrule' && /keyframes$/i.test((parent as postcss.AtRule).name)) return
			parent = parent.parent
		}
		const fail = (message: string, node: selectorParser.Node): never => {
			throw rule.error(message, { index: node.sourceIndex })
		}
		rule.selector = selectorParser((selectors) => {
			selectors.each((selector) => scopeSelector(selector, scopeAttribute, fail))
		}).processSync(rule.selector)
	})
	return { css: root.toString(), targets: scopeTargets(root, scopeAttribute) }
}

function isGlobalPseudo(node: selectorParser.Node): node is selectorParser.Pseudo {
	return node.type === 'pseudo' && node.value.toLowerCase() === ':global'
}

/**
 * Añade el atributo de ámbito al último compuesto local del selector y desenvuelve `:global(...)`.
 * Un compuesto que contiene `:global(...)` no se limita; si todo el selector es global, no recibe atributo.
 */
function scopeSelector(selector: selectorParser.Selector, scopeAttribute: string, fail: (message: string, node: selectorParser.Node) => never): void {
	const globals: selectorParser.Pseudo[] = []
	selector.walkPseudos((pseudo) => {
		if (!isGlobalPseudo(pseudo)) return
		if (pseudo.parent !== selector) fail(':global(<selector>) debe ir en el nivel superior de un selector, no dentro de otra pseudoclase', pseudo)
		if (pseudo.nodes.length > 1) fail(':global(...) admite un solo selector; escribe un :global(<selector>) por cada selector de la lista', pseudo)
		if (!pseudo.nodes[0]?.nodes.some((node) => node.type !== 'comment')) fail(':global necesita un selector como argumento; usa :global(<selector>)', pseudo)
		globals.push(pseudo)
	})
	const compounds: Array<Array<selectorParser.Selector['nodes'][number]>> = [[]]
	for (const node of selector.nodes) {
		if (node.type === 'combinator') compounds.push([])
		else if (node.type !== 'comment') compounds.at(-1)!.push(node)
	}
	const scoped = compounds.filter((compound) => compound.length > 0 && !compound.some(isGlobalPseudo)).at(-1)
	if (scoped) {
		const attribute = selectorParser.attribute({ attribute: scopeAttribute, value: undefined, raws: {} })
		const pseudoElement = scoped.find((node) => node.type === 'pseudo' && node.value.startsWith('::'))
		if (pseudoElement) selector.insertBefore(pseudoElement, attribute)
		else selector.insertAfter(scoped.at(-1)!, attribute)
	}
	for (const pseudo of globals) {
		const inner = pseudo.nodes[0]!.nodes.slice()
		inner[0]!.rawSpaceBefore = pseudo.rawSpaceBefore
		inner.at(-1)!.rawSpaceAfter = pseudo.rawSpaceAfter
		pseudo.replaceWith(...inner)
	}
}
