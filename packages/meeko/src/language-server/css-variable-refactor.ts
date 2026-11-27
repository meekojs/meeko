import type { Container } from 'postcss'
import type { Location, Position, Range, TextEdit, WorkspaceEdit } from 'vscode-languageserver/node'

import { existsSync, readdirSync, readFileSync, realpathSync, statSync } from 'node:fs'
import { dirname, isAbsolute, join, relative, sep } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import postcss from 'postcss'
import { TextDocument } from 'vscode-languageserver-textdocument'
import { LSPErrorCodes, ResponseError } from 'vscode-languageserver/node'

import type { ClassSource } from './classes'

import { cssVariableTokenAt } from './css-variables'
import { t } from './l10n'
import { pathKey } from './project'
import { sectionAt, templateRegion } from './regions'

const namePattern = /^--[\w\u0080-\uffff-]+$/u
const nameCharacter = /[\w\u0080-\uffff-]/u
const maximumFiles = 2000
const maximumBytes = 16 * 1024 * 1024

interface Occurrence {
	readonly name: string
	readonly start: number
	readonly end: number
	readonly declaration: boolean
	readonly registered?: boolean
	/** Contexto local del componente; sólo vincula nombres declarados localmente. */
	readonly private: boolean
}

interface VariableFile {
	readonly document: TextDocument
	readonly open: boolean
	readonly occurrences: readonly Occurrence[]
	readonly local: ReadonlySet<string>
	readonly complete: boolean
}

/** Instantánea actual y limitada de las fuentes; nunca incluye CSS generado. */
export interface CssVariableProject {
	readonly files: readonly VariableFile[]
	readonly complete: boolean
}

function globalContext(node: Container | undefined): boolean {
	for (let parent = node; parent; parent = parent.parent as Container | undefined) {
		if (parent.type === 'rule' && /:global\(/.test((parent as postcss.Rule).selector)) return true
		if (parent.type === 'atrule' && (parent as postcss.AtRule).name === 'property') return true
	}
	return false
}

/** Referencias var() fuera de comentarios, cadenas y URL; conserva los offsets originales. */
function variableUses(text: string, base: number, privateContext: boolean, query = false, directNames = false): { occurrences: Occurrence[]; complete: boolean } {
	const occurrences: Occurrence[] = []
	let complete = true
	const trivia = (from: number): number => {
		let at = from
		for (;;) {
			while (/\s/.test(text[at] ?? '') && at < text.length) at++
			if (!text.startsWith('/*', at)) return at
			const end = text.indexOf('*/', at + 2)
			if (end < 0) {
				complete = false
				return text.length
			}
			at = end + 2
		}
	}
	for (let index = 0; index < text.length; index++) {
		const char = text[index]
		if (text.startsWith('/*', index)) {
			const end = text.indexOf('*/', index + 2)
			if (end < 0) {
				complete = false
				break
			}
			index = end + 1
			continue
		}
		if (char === '"' || char === "'") {
			const quote = char
			for (index++; index < text.length && text[index] !== quote; index++) if (text[index] === '\\') index++
			if (index >= text.length) complete = false
			continue
		}
		if (char === '\\') {
			complete = false
			index++
			continue
		}
		if (index > 0 && nameCharacter.test(text[index - 1]!)) continue
		if (text.startsWith('--', index) && (directNames || (query && text.slice(0, index).trimEnd().endsWith('(')))) {
			let end = index + 2
			while (end < text.length && nameCharacter.test(text[end]!)) end++
			const after = trivia(end)
			if (text[end] === '\\') complete = false
			if (namePattern.test(text.slice(index, end)) && text[after] !== '(' && (directNames || text[after] === ':' || text[after] === ')')) occurrences.push({ name: text.slice(index, end), start: base + index, end: base + end, declaration: false, private: privateContext })
		}
		if (text.slice(index, index + 4).toLowerCase() === 'url(') {
			for (index += 4; index < text.length && text[index] !== ')'; index++) if (text[index] === '\\') index++
			continue
		}
		const helper = text.slice(index, index + 4).toLowerCase() === 'var(' ? 4 : text.startsWith('--theme(', index) ? 8 : 0
		if (!helper) continue
		const start = trivia(index + helper)
		let end = start
		while (end < text.length && nameCharacter.test(text[end]!)) end++
		const name = text.slice(start, end)
		const after = trivia(end)
		if (text[end] === '\\') complete = false
		if (namePattern.test(name) && (text[after] === ')' || text[after] === ',')) occurrences.push({ name, start: base + start, end: base + end, declaration: false, private: privateContext })
	}
	return { occurrences, complete }
}

function scanFile(document: TextDocument, open: boolean): VariableFile {
	const source = document.getText()
	const component = document.languageId === 'meeko'
	const style = component ? [...source.matchAll(/<style(?=[\s>])([^>]*)>/g)].find((match) => sectionAt(source, match.index + match[0].length)?.name === 'style') : undefined
	const region = style ? { contentStart: style.index + style[0].length, contentEnd: source.indexOf('</style>', style.index + style[0].length), attributes: style[1] ?? '' } : undefined
	const occurrences: Occurrence[] = []
	let complete = true
	if (!component || region) {
		const base = region?.contentStart ?? 0
		const css = region ? source.slice(base, region.contentEnd < 0 ? source.length : region.contentEnd) : source
		const scoped = /\bscoped\b/.test(region?.attributes ?? '')
		if (region && source.indexOf('</style>', base) < 0) complete = false
		try {
			const root = postcss.parse(css)
			root.walkDecls((node) => {
				const start = node.source?.start?.offset
				const end = node.source?.end?.offset
				if (start === undefined || end === undefined) {
					complete = false
					return
				}
				const privateContext = scoped && !globalContext(node.parent)
				if (namePattern.test(node.prop)) occurrences.push({ name: node.prop, start: base + start, end: base + start + node.prop.length, declaration: true, private: privateContext })
				else if (node.prop.startsWith('--')) complete = false
				const uses = variableUses(css.slice(start, end + 1), base + start, privateContext, false, ['transition', 'transition-property', 'will-change'].includes(node.prop))
				occurrences.push(...uses.occurrences)
				complete &&= uses.complete
			})
			root.walkAtRules((node) => {
				const start = node.source?.start?.offset
				if (start === undefined) return
				const at = css.indexOf(node.params, start + node.name.length + 1)
				if (at < 0) {
					complete = false
					return
				}
				if (node.name === 'property') {
					const name = node.params.trim()
					if (namePattern.test(name)) occurrences.push({ name, start: base + at + node.params.indexOf(name), end: base + at + node.params.indexOf(name) + name.length, declaration: true, registered: true, private: false })
					else complete = false
				}
				const uses = variableUses(node.params, base + at, scoped && !globalContext(node.parent), ['container', 'supports'].includes(node.name))
				occurrences.push(...uses.occurrences)
				complete &&= uses.complete
			})
		} catch {
			complete = false
		}
	}
	if (component) {
		const template = templateRegion(source)
		if (template) {
			for (const match of source.slice(template.contentStart, template.contentEnd).matchAll(/--(?:[\w\u0080-\uffff-]|\\.)*/gu)) {
				const start = template.contentStart + match.index
				if (sectionAt(source, start)?.name !== 'template') continue
				const token = cssVariableTokenAt(source, start + 1)
				if (!token || token.start !== start) continue
				if (!namePattern.test(match[0]) || source[token.end] === '\\') {
					complete = false
					continue
				}
				if (token.end !== start + match[0].length) continue
				occurrences.push({ name: match[0], start, end: token.end, declaration: token.declaration, private: true })
			}
		}
	}
	const unique = [...new Map(occurrences.map((item) => [`${item.start}:${item.end}`, item])).values()]
	const local = new Set(unique.filter((item) => item.declaration && item.private).map((item) => item.name))
	return { document, open, occurrences: unique, local, complete }
}

function inside(root: string, path: string): boolean {
	const inner = relative(root, path)
	return inner !== '..' && !inner.startsWith(`..${sep}`) && !isAbsolute(inner)
}

/** @property registra el nombre para todo el documento, también en declaraciones scoped. */
function projectSnapshot(files: readonly VariableFile[], complete: boolean): CssVariableProject {
	const registered = new Set(files.flatMap((file) => file.occurrences.filter((item) => item.registered).map((item) => item.name)))
	return { files: registered.size ? files.map((file) => ({ ...file, local: new Set([...file.local].filter((name) => !registered.has(name))) })) : files, complete }
}

/** Sólo app/, componentes raíz y fuentes importadas. Los buffers abiertos tienen prioridad. */
export function collectCssVariableProject(root: string, current: TextDocument, opened: readonly TextDocument[], sources: readonly ClassSource[] = []): CssVariableProject {
	if (!current.uri.startsWith('file:')) return projectSnapshot([scanFile(current, true)], true)
	const buffers = new Map(opened.filter((document) => document.uri.startsWith('file:')).map((document) => [pathKey(fileURLToPath(document.uri)), document]))
	buffers.set(pathKey(fileURLToPath(current.uri)), current)
	const files = new Map<string, VariableFile>()
	let complete = true,
		bytes = 0,
		directories = 0
	const realRoot = existsSync(root) ? realpathSync(root) : root
	const owned = (filename: string): boolean => {
		for (let directory = dirname(filename); pathKey(directory) !== pathKey(root); directory = dirname(directory)) {
			if (existsSync(join(directory, 'package.json'))) return false
			if (dirname(directory) === directory) return false
		}
		return true
	}
	const add = (filename: string): void => {
		const key = pathKey(filename)
		if (
			files.has(key) ||
			!inside(root, filename) ||
			relative(root, filename)
				.split(/[\\/]/)
				.some((part) => part.startsWith('.') || part === 'node_modules' || part === 'dist')
		)
			return
		if (!owned(filename)) return
		if (files.size >= maximumFiles) {
			complete = false
			return
		}
		try {
			if (existsSync(filename) && !inside(realRoot, realpathSync(filename))) {
				complete = false
				return
			}
			const buffer = buffers.get(key)
			if (!buffer && statSync(filename).size > maximumBytes - bytes) {
				complete = false
				return
			}
			const text = buffer?.getText() ?? readFileSync(filename, 'utf8')
			bytes += Buffer.byteLength(text)
			if (bytes > maximumBytes) {
				complete = false
				return
			}
			const document = buffer ?? TextDocument.create(pathToFileURL(filename).href, filename.endsWith('.meeko') ? 'meeko' : 'css', 0, text)
			files.set(key, scanFile(document, Boolean(buffer)))
		} catch {
			complete = false
		}
	}
	const visit = (directory: string): void => {
		if (pathKey(directory) !== pathKey(root) && existsSync(join(directory, 'package.json'))) return
		if (++directories > maximumFiles || files.size >= maximumFiles || bytes >= maximumBytes) {
			complete = false
			return
		}
		try {
			for (const entry of readdirSync(directory, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
				if (entry.name.startsWith('.') || ['node_modules', 'dist', 'coverage'].includes(entry.name)) continue
				const filename = join(directory, entry.name)
				if (entry.isSymbolicLink()) {
					complete = false
					continue
				}
				if (entry.isDirectory()) visit(filename)
				else if (/\.(?:css|meeko)$/i.test(entry.name)) add(filename)
			}
		} catch {
			complete = false
		}
	}
	add(fileURLToPath(current.uri))
	const app = join(root, 'app')
	if (existsSync(app)) {
		visit(app)
		for (const entry of readdirSync(root, { withFileTypes: true })) if (entry.isFile() && entry.name.endsWith('.meeko')) add(join(root, entry.name))
	} else visit(root)
	for (const source of sources) if (source.filename && source.origin !== 'snapshot') add(source.filename)
	for (const [filename, document] of buffers) if (/\.(?:css|meeko)$/i.test(filename) && inside(root, filename) && (inside(app, filename) || document.uri === current.uri)) add(fileURLToPath(document.uri))
	return projectSnapshot([...files.values()], complete)
}

function targetAt(project: CssVariableProject, document: TextDocument, position: Position) {
	const token = cssVariableTokenAt(document.getText(), document.offsetAt(position), document.languageId)
	if (!token) return undefined
	const file = project.files.find((file) => file.document.uri === document.uri)
	const occurrence = file?.occurrences.find((item) => item.start === token.start && item.end === token.end)
	return file && occurrence ? { file, occurrence, local: occurrence.private && file.local.has(occurrence.name) } : undefined
}

function matches(file: VariableFile, occurrence: Occurrence, target: NonNullable<ReturnType<typeof targetAt>>): boolean {
	if (occurrence.name !== target.occurrence.name) return false
	const local = occurrence.private && file.local.has(occurrence.name)
	return target.local ? local && file.document.uri === target.file.document.uri : !local
}

const rangeOf = (document: TextDocument, occurrence: Occurrence): Range => ({ start: document.positionAt(occurrence.start), end: document.positionAt(occurrence.end) })
const failure = (message: string): never => {
	throw new ResponseError(LSPErrorCodes.RequestFailed, message)
}

/** Referencias actuales por ámbito, sin coincidencias en comentarios, scripts ni CSS generado. */
export function cssVariableReferences(project: CssVariableProject, document: TextDocument, position: Position, includeDeclaration: boolean): Location[] | undefined {
	const target = targetAt(project, document, position)
	if (!target) return undefined
	if (target.local ? !target.file.complete : !project.complete || project.files.some((file) => !file.complete)) return failure(t('The CSS variable search exceeds the package limits, has incomplete CSS or could not read all its sources.'))
	return project.files.flatMap((file) => file.occurrences.filter((item) => matches(file, item, target) && (includeDeclaration || !item.declaration)).map((item) => ({ uri: file.document.uri, range: rangeOf(file.document, item) })))
}

/** Rechaza búsquedas parciales o CSS incompleto antes de ofrecer el renombrado. */
export function prepareCssVariableRename(project: CssVariableProject, document: TextDocument, position: Position): { range: Range; placeholder: string } | undefined {
	const target = targetAt(project, document, position)
	if (!target) return undefined
	if (target.local ? !target.file.complete : !project.complete || project.files.some((file) => !file.complete)) return failure(t('Cannot rename: there is incomplete CSS, escaped identifiers or sources that could not be fully reviewed.'))
	if (!project.files.some((file) => file.occurrences.some((item) => item.declaration && matches(file, item, target)))) return failure(t('No editable declaration of this CSS variable was found in the package.'))
	return { range: rangeOf(document, target.occurrence), placeholder: target.occurrence.name }
}

/** Un WorkspaceEdit atómico, con versión para documentos abiertos y sin escrituras en disco. */
export function renameCssVariable(project: CssVariableProject, document: TextDocument, position: Position, newName: string, documentChanges: boolean): WorkspaceEdit | undefined {
	const prepared = prepareCssVariableRename(project, document, position)
	const target = targetAt(project, document, position)
	if (!prepared || !target) return undefined
	if (!namePattern.test(newName)) return failure(t('The name must be a full CSS variable, like --color-accent, without spaces or escapes.'))
	if (newName === prepared.placeholder) return { changes: {} }
	const affected = project.files.filter((file) => file.occurrences.some((item) => matches(file, item, target)))
	const collision = project.files.some((file) => file.occurrences.some((item) => item.name === newName && (target.local ? file === target.file : !item.private || !file.local.has(newName) || affected.includes(file))))
	if (collision) return failure(t('Cannot rename: {0} already appears in the variable scope and could change its meaning.', newName))
	const edits = affected.map((file) => ({
		file,
		edits: file.occurrences
			.filter((item) => matches(file, item, target))
			.sort((a, b) => b.start - a.start)
			.map((item): TextEdit => ({ range: rangeOf(file.document, item), newText: newName })),
	}))
	return documentChanges ? { documentChanges: edits.map(({ file, edits }) => ({ textDocument: { uri: file.document.uri, version: file.open ? file.document.version : null }, edits })) } : { changes: Object.fromEntries(edits.map(({ file, edits }) => [file.document.uri, edits])) }
}
