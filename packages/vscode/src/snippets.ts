import * as vscode from 'vscode'

import type { SnippetContext } from './snippet-context'

import scriptSnippets from '../snippets/meeko-script.json'
import templateSnippets from '../snippets/meeko-template.json'
import { snippetContextAt } from './snippet-context'

interface SnippetDefinition {
	readonly prefix: string | readonly string[]
	readonly body: readonly string[]
	readonly description: string
}

const definitions: Record<SnippetContext, Readonly<Record<string, SnippetDefinition>>> = { script: scriptSnippets, template: templateSnippets }
const previewLanguage: Record<SnippetContext, string> = { script: 'ts', template: 'html' }

/** The text that the snippet inserts before editing its fields, for the details of the suggestion. */
function preview(body: string): string {
	const values = new Map<string, string>()
	for (const field of body.matchAll(/\$\{(\d+):([^{}]*)\}/g)) values.set(field[1]!, field[2]!)
	return body.replace(/\$\{(\d+)(?::[^{}]*)?\}|\$(\d+)/g, (_, braced: string | undefined, plain: string | undefined) => values.get(braced ?? plain!) ?? '')
}

function completionItems(context: SnippetContext): vscode.CompletionItem[] {
	return Object.entries(definitions[context]).flatMap(([name, snippet]) => {
		const body = snippet.body.join('\n')
		return [snippet.prefix].flat().map((prefix) => {
			const item = new vscode.CompletionItem({ label: prefix, description: name }, vscode.CompletionItemKind.Snippet)
			item.insertText = new vscode.SnippetString(body)
			item.detail = `${snippet.description} (Meeko)`
			item.documentation = new vscode.MarkdownString().appendCodeblock(preview(body), previewLanguage[context])
			return item
		})
	})
}

/**
 * Ofrece los fragmentos de `<script>` y `<template>` en un `.meeko`. VS Code elige los fragmentos
 * declarados en `contributes.snippets` por el lenguaje en la posición del cursor, que dentro de un
 * bloque es `typescript` o `html`: declarados para `meeko` no salen ahí, y declarados para esos
 * lenguajes saldrían en todos los `.ts` y `.html`. Un proveedor se selecciona por el lenguaje del
 * documento. Los esqueletos de la raíz siguen en `contributes.snippets`.
 */
export function registerSnippetCompletion(): vscode.Disposable {
	const items: Record<SnippetContext, vscode.CompletionItem[]> = { script: completionItems('script'), template: completionItems('template') }
	return vscode.languages.registerCompletionItemProvider(
		{ language: 'meeko' },
		{
			provideCompletionItems(document, position) {
				const context = snippetContextAt(document.getText(), document.offsetAt(position))
				return context && items[context]
			},
		},
	)
}
