import { existsSync } from 'node:fs'
import { dirname, relative, resolve } from 'node:path'
import ts from 'typescript'

/** Relocates generated declaration imports while retaining the component's original .meeko imports. */
export function rebaseComponentDeclaration(text, generatedFile, destinationFile) {
	const source = ts.createSourceFile(generatedFile, text, ts.ScriptTarget.Latest, true)
	const edits = []
	function visit(node) {
		if (ts.isStringLiteral(node) && (
			((ts.isImportDeclaration(node.parent) || ts.isExportDeclaration(node.parent)) && node.parent.moduleSpecifier === node)
			|| (ts.isLiteralTypeNode(node.parent) && ts.isImportTypeNode(node.parent.parent))
			|| (ts.isModuleDeclaration(node.parent) && node.text.startsWith('.'))
		)) {
			const specifier = node.text
			// generateTypes leaves .meeko imports relative to the original component, next to destinationFile.
			if (specifier.startsWith('.') && !specifier.endsWith('.meeko')) {
				let target = resolve(dirname(generatedFile), specifier)
				if (/\.d\.ts$/.test(target)) target = target.replace(/\.d\.ts$/, '.js')
				else if (/\.ts$/.test(target)) target = target.replace(/\.ts$/, '.js')
				else if (existsSync(`${target}.d.ts`) || existsSync(`${target}.js`)) target += '.js'
				else if (existsSync(resolve(target, 'index.d.ts'))) target = resolve(target, 'index.js')
				let replacement = relative(dirname(destinationFile), target).replaceAll('\\', '/')
				if (!replacement.startsWith('.')) replacement = `./${replacement}`
				const escaped = JSON.stringify(replacement).slice(1, -1).replaceAll("'", "\\'")
				edits.push({ start: node.getStart(source) + 1, end: node.end - 1, replacement: escaped })
			}
		}
		ts.forEachChild(node, visit)
	}
	visit(source)
	let result = text
	for (const edit of edits.sort((a, b) => b.start - a.start)) result = result.slice(0, edit.start) + edit.replacement + result.slice(edit.end)
	return result
}
