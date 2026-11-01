// The heavy half of `@meekojs/ui/editor`: 360 KB of gzipped JavaScript that only the component loads,
// with `import()`, in the browser. It must not be imported from anywhere else: the public webs do
// not pay for it. The recipe was measured over the 401 documents of `docs/**`; without it Crepe
// damages 338 of them. Do not change a setting without running tests/markdown-editor.e2e.mjs.
import '@milkdown/crepe/theme/common/prosemirror.css'
import '@milkdown/crepe/theme/common/reset.css'
import '@milkdown/crepe/theme/common/block-edit.css'
import '@milkdown/crepe/theme/common/code-mirror.css'
import '@milkdown/crepe/theme/common/cursor.css'
import '@milkdown/crepe/theme/common/link-tooltip.css'
import '@milkdown/crepe/theme/common/list-item.css'
import '@milkdown/crepe/theme/common/placeholder.css'
import '@milkdown/crepe/theme/common/table.css'
import '@milkdown/crepe/theme/common/toolbar.css'
import { HighlightStyle, LanguageDescription, syntaxHighlighting } from '@codemirror/language'
import { EditorView } from '@codemirror/view'
import { tags } from '@lezer/highlight'
import { CrepeBuilder } from '@milkdown/crepe/builder'
import { blockEdit } from '@milkdown/crepe/feature/block-edit'
import { codeMirror } from '@milkdown/crepe/feature/code-mirror'
import { cursor } from '@milkdown/crepe/feature/cursor'
import { linkTooltip } from '@milkdown/crepe/feature/link-tooltip'
import { listItem } from '@milkdown/crepe/feature/list-item'
import { placeholder } from '@milkdown/crepe/feature/placeholder'
import { table } from '@milkdown/crepe/feature/table'
import { toolbar } from '@milkdown/crepe/feature/toolbar'
import { editorViewOptionsCtx, remarkCtx, remarkStringifyOptionsCtx } from '@milkdown/kit/core'
import { uploadConfig } from '@milkdown/kit/plugin/upload'
import { codeBlockSchema, remarkPreserveEmptyLinePlugin } from '@milkdown/kit/preset/commonmark'
import { NodeSelection, Plugin } from '@milkdown/kit/prose/state'
import { $prose } from '@milkdown/kit/utils'

import type { UIMessages } from '../app/types/messages'
import type { MarkdownBlockParser } from './splice'

import { createMarkdownSplicer, splitMarkdownSource } from './splice'

/** The languages of the code blocks of the documentation: importing them all costs 477 KB gzip. */
const languages = [
	LanguageDescription.of({ name: 'TypeScript', alias: ['ts'], extensions: ['ts', 'mts', 'cts'], load: () => import('@codemirror/lang-javascript').then((module) => module.javascript({ typescript: true })) }),
	LanguageDescription.of({ name: 'JavaScript', alias: ['js'], extensions: ['js', 'mjs', 'cjs'], load: () => import('@codemirror/lang-javascript').then((module) => module.javascript()) }),
	LanguageDescription.of({ name: 'HTML', alias: ['meeko', 'vue'], extensions: ['html', 'meeko'], load: () => import('@codemirror/lang-html').then((module) => module.html()) }),
	LanguageDescription.of({ name: 'CSS', extensions: ['css'], load: () => import('@codemirror/lang-css').then((module) => module.css()) }),
	LanguageDescription.of({ name: 'JSON', extensions: ['json'], load: () => import('@codemirror/lang-json').then((module) => module.json()) }),
]

/** One theme of variables: changing `data-theme` needs no `setCodeMirrorTheme`. */
const codeTheme = [
	EditorView.theme({
		'&': { backgroundColor: 'var(--ui-color-surface)', color: 'var(--ui-color-text)' },
		'.cm-content': { caretColor: 'var(--ui-color-primary-text)' },
		'.cm-cursor': { borderLeftColor: 'var(--ui-color-primary-text)' },
		'.cm-gutters': { backgroundColor: 'var(--ui-color-surface)', color: 'var(--ui-color-text-soft)', border: 'none' },
		'.cm-activeLine, .cm-activeLineGutter': { backgroundColor: 'var(--ui-color-control)' },
		'&.cm-focused .cm-selectionBackground, .cm-selectionBackground, ::selection': { backgroundColor: 'var(--ui-color-selection)' },
	}),
	syntaxHighlighting(
		HighlightStyle.define([
			{ tag: [tags.keyword, tags.modifier, tags.operatorKeyword], color: 'var(--ui-color-primary-text)' },
			{ tag: [tags.string, tags.special(tags.string)], color: 'var(--ui-color-success-text)' },
			{ tag: [tags.number, tags.bool, tags.null], color: 'var(--ui-color-orange-11)' },
			{ tag: [tags.comment], color: 'var(--ui-color-text-soft)', fontStyle: 'italic' },
			{ tag: [tags.typeName, tags.className], color: 'var(--ui-color-cyan-11)' },
			{ tag: [tags.function(tags.variableName), tags.function(tags.propertyName)], color: 'var(--ui-color-info-text)' },
			{ tag: [tags.tagName], color: 'var(--ui-color-pink-11)' },
			{ tag: [tags.attributeName, tags.propertyName], color: 'var(--ui-color-info-text)' },
		]),
	),
]

const stringifyOptions = { bullet: '-', bulletOther: '*', emphasis: '_', strong: '*', fence: '`', fences: true, rule: '-', listItemIndent: 'one', incrementListMarker: true } as const

interface TextState {
	readonly stack: readonly string[]
	safe(value: string, info: Record<string, unknown>): string
}

/** Fixes two faults of Milkdown's `text`: the `\|` of a table cell and the `\[!NOTE]` of a GitHub note. */
const textHandler = (node: { readonly value: string }, _parent: unknown, state: TextState, info: Record<string, unknown>): string => {
	const { value } = node
	if (!state.stack.includes('tableCell') && /^[^*_\\]*\s+$/.test(value)) return value
	return state.safe(value, { ...info, encode: [] }).replace(/^\\\[!(NOTE|TIP|IMPORTANT|WARNING|CAUTION)\]/, '[!$1]')
}

/** Keeps the `meta` of a code block (` ```ts bad `), also when it is copied and pasted as HTML. */
const codeBlockWithMeta = codeBlockSchema.extendSchema((previous) => (ctx) => {
	const base = previous(ctx)
	return {
		...base,
		attrs: { ...base.attrs, meta: { default: '', validate: 'string' } },
		parseDOM: base.parseDOM?.map((rule) => ({
			...rule,
			getAttrs: (dom: HTMLElement | string) => {
				const attrs = rule.getAttrs?.(dom as HTMLElement)
				return attrs === false ? false : { ...attrs, meta: typeof dom === 'string' ? '' : (dom.dataset.meta ?? '') }
			},
		})),
		toDOM: (node) => {
			const [tag, attrs, ...content] = base.toDOM!(node) as [string, Record<string, string>, ...unknown[]]
			return [tag, { ...attrs, ...(node.attrs.meta ? { 'data-meta': node.attrs.meta as string } : {}) }, ...content] as never
		},
		parseMarkdown: {
			match: base.parseMarkdown.match,
			runner: (state, node, type) => {
				state.openNode(type, { language: node.lang ?? '', meta: node.meta ?? '' })
				if (node.value) state.addText(node.value as string)
				state.closeNode()
			},
		},
		toMarkdown: {
			match: base.toMarkdown.match,
			runner: (state, node) => {
				state.addNode('code', undefined, node.content.firstChild?.text || '', { lang: node.attrs.language, meta: node.attrs.meta || null })
			},
		},
	}
})

/**
 * Inserting a table from the menu passes the selection through the next block before leaving it in
 * the first cell. If that block is code, CodeMirror takes the focus and keeps it, and the next key
 * would write into the code: the focus has to follow the selection out of it.
 */
const focusFollowsSelection = $prose(
	() =>
		new Plugin({
			view: () => ({
				update(view, previous) {
					if (previous.selection.eq(view.state.selection) || view.state.selection.$from.parent.type.name === 'code_block') return
					if (view.dom.contains(document.activeElement) && document.activeElement?.closest('.cm-content')) view.focus()
				},
			}),
		}),
)

/**
 * A click in a table cell puts the caret there, and Milkdown then selects the whole paragraph of the
 * cell, in the next frame. Crepe paints that selection as transparent, so the next key would erase
 * the cell with nothing to warn of it. The caret stays; the handles of a row or a column still select.
 */
const clickKeepsTheCaret = $prose(
	() =>
		new Plugin({
			filterTransaction(transaction) {
				const { selection } = transaction
				if (!transaction.selectionSet || transaction.docChanged || !(selection instanceof NodeSelection)) return true
				return !(selection.node.type.name === 'paragraph' && ['table_cell', 'table_header'].includes(selection.$from.parent.type.name))
			},
		}),
)

export interface MarkdownEditorOptions {
	readonly readonly: boolean
	readonly labelledBy?: string | undefined
	readonly describedBy?: string | undefined
	readonly placeholder: string
	readonly texts: UIMessages['markdownEditor']
	/** The whole text after an edit: only the edited blocks differ from the source. */
	readonly onChange: (markdown: string) => void
}

export interface MarkdownEditorHandle {
	/** Whether the source and its serialization have the same blocks. Without that, only the code mode is safe. */
	readonly canSplice: boolean
	/** The text as of now, for a save right after the last key: the change event waits for a pause. */
	flush(): string
	focus(): void
	setReadonly(value: boolean): void
	destroy(): Promise<void>
}

// How long `onChange` waits after Milkdown's own 200 ms: parsing the largest document takes 200 ms.
const spliceDelay = 120

/**
 * Creates Crepe over `source`, a whole file: its frontmatter never reaches the editor. Nothing is
 * written back without an edit, and writing back keeps the bytes of the untouched blocks.
 */
export async function createMarkdownEditor(root: HTMLElement, source: string, options: MarkdownEditorOptions): Promise<MarkdownEditorHandle> {
	const { head, body } = splitMarkdownSource(source)
	const { texts } = options
	const heading = (label: string) => ({ label })
	const crepe = new CrepeBuilder({ root, defaultValue: body })
	crepe
		.addFeature(cursor)
		.addFeature(listItem)
		.addFeature(linkTooltip, { inputPlaceholder: texts.linkPlaceholder })
		.addFeature(blockEdit, {
			textGroup: {
				label: texts.groupText,
				text: heading(texts.text),
				h1: heading(`${texts.heading} 1`),
				h2: heading(`${texts.heading} 2`),
				h3: heading(`${texts.heading} 3`),
				h4: heading(`${texts.heading} 4`),
				h5: heading(`${texts.heading} 5`),
				h6: heading(`${texts.heading} 6`),
				quote: heading(texts.quote),
				divider: heading(texts.divider),
			},
			listGroup: { label: texts.groupList, bulletList: heading(texts.bulletList), orderedList: heading(texts.orderedList), taskList: heading(texts.taskList) },
			advancedGroup: { label: texts.groupAdvanced, codeBlock: heading(texts.codeBlock), table: heading(texts.table) },
		})
		.addFeature(placeholder, { text: options.placeholder })
		.addFeature(toolbar, { boldLabel: texts.bold, italicLabel: texts.italic, strikethroughLabel: texts.strikethrough, codeLabel: texts.inlineCode, linkLabel: texts.link })
		.addFeature(table)
		.addFeature(codeMirror, { languages, theme: codeTheme, searchPlaceholder: texts.languageSearch, noResultText: texts.languageEmpty, copyText: texts.copy })
	crepe.editor.config((ctx) => {
		ctx.update(remarkStringifyOptionsCtx, (previous) => ({ ...previous, ...stringifyOptions, handlers: { ...previous.handlers, text: textHandler as never } }))
		ctx.update(editorViewOptionsCtx, (previous) => ({
			...previous,
			attributes: { role: 'textbox', 'aria-multiline': 'true', ...(options.labelledBy ? { 'aria-labelledby': options.labelledBy } : {}), ...(options.describedBy ? { 'aria-describedby': options.describedBy } : {}) },
		}))
		// Without an image block a pasted image would be saved as a `blob:` address of this tab.
		ctx.update(uploadConfig.key, (previous) => ({ ...previous, uploader: () => Promise.resolve([]) }))
	})
	crepe.editor.use(codeBlockWithMeta).use(focusFollowsSelection).use(clickKeepsTheCaret)
	// With it, each empty paragraph is saved as a literal `<br />`.
	await crepe.editor.remove(remarkPreserveEmptyLinePlugin)
	crepe.setReadonly(options.readonly)

	let splice: ((edited: string) => string | null) | undefined
	let baseline: string | undefined
	let latest = source
	let timer: ReturnType<typeof setTimeout> | undefined

	/** The file for a serialization of the editor: the source itself, byte by byte, when nothing changed. */
	const fileOf = (edited: string): string => {
		if (edited === baseline) return source
		const spliced = splice?.(edited)
		if (spliced === null || spliced === undefined) throw new Error('The document does not match block by block')
		return spliced === body ? source : head + spliced
	}
	const publish = (file: string) => {
		if (file === latest) return
		latest = file
		options.onChange(file)
	}

	// `markdownUpdated` also fires without an edit: the `trailing` plugin adds a last paragraph. Neither
	// the event nor `doc.eq` are a signal: only the text that would be written counts.
	crepe.on((listener) => {
		listener.markdownUpdated((_ctx, edited) => {
			if (baseline === undefined) return
			clearTimeout(timer)
			if (edited === baseline) return publish(source)
			timer = setTimeout(() => publish(fileOf(edited)), spliceDelay)
		})
	})
	await crepe.create()
	baseline = crepe.getMarkdown()
	const remark = crepe.editor.action((ctx) => ctx.get(remarkCtx))
	const splicer = createMarkdownSplicer((markdown) => remark.parse(markdown) as ReturnType<MarkdownBlockParser>, body, baseline)
	splice = splicer.splice

	return {
		canSplice: splicer.aligned,
		flush() {
			clearTimeout(timer)
			if (splicer.aligned) publish(fileOf(crepe.getMarkdown()))
			return latest
		},
		focus() {
			root.querySelector<HTMLElement>('.ProseMirror')?.focus()
		},
		setReadonly(value) {
			crepe.setReadonly(value)
		},
		async destroy() {
			clearTimeout(timer)
			await crepe.destroy()
		},
	}
}
