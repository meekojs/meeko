import type { SfcSection } from '@meekojs/meeko/parse'
import type { AstPath, Doc, Options, Parser, ParserOptions, Plugin, Printer, SupportLanguage, SupportOptions } from 'prettier'

import { compile } from '@meekojs/meeko/compiler'
import { locate, MeekoCompileError, parseSfc } from '@meekojs/meeko/parse'
import ts from '@typescript/typescript6'
import { builders, utils } from 'prettier/doc'

import type { ClassOrder } from './classes'

import { preserveArrayBreaksPrinter } from './arrays'
import { appendClassOrder, classOrderOption, stylesheetClassOrder } from './classes'
import { tailwindClassSorter } from './tailwind'
import { templateParserName, templatePlugin } from './template'

const { hardline, indent } = builders
const { replaceEndOfLine } = utils

/**
 * Opciones que el plugin añade a las de Prettier.
 *
 * @since 1.1.0
 * @example
 * ```ts
 * // prettier.config.ts
 * import type { Config } from "prettier";
 * import type { MeekoPrettierOptions } from "@meekojs/prettier-plugin";
 *
 * const config: Config & MeekoPrettierOptions = {
 *   plugins: ["@meekojs/prettier-plugin"],
 *   meekoIndentSections: true,
 * };
 * export default config;
 * ```
 * @see https://github.com/meekojs/meeko/blob/main/docs/editors.md#formato-con-prettier
 */
export interface MeekoPrettierOptions {
	/**
	 * Indenta un nivel el contenido de `<script>`, `<script server>`, `<template>` y `<style>`,
	 * como `vueIndentScriptAndStyle` pero también en la plantilla. Por defecto `false`.
	 */
	meekoIndentSections?: boolean
	/**
	 * Conserva expandido un array, un patrón de desestructuración o una tupla de TypeScript si en el
	 * código fuente hay un salto de línea entre `[` y su primer elemento, como `objectWrap:
	 * "preserve"` hace con los objetos; sin ese salto, Prettier decide como siempre. Para colapsarlo
	 * basta con unir `[` y el primer elemento. Se aplica a todo el JavaScript y TypeScript que
	 * formatee Prettier con el plugin cargado, también a los archivos `.ts` y `.js` del proyecto.
	 * Por defecto `true`; con `false` la salida es la de Prettier.
	 *
	 * @since 1.3.0
	 * @example
	 * ```ts
	 * // Con `printWidth: 800`, este array sigue con un elemento por línea:
	 * const routes = [
	 *   "/",
	 *   "/about",
	 * ];
	 * // y este queda en una línea:
	 * const tags = ["a", "b"];
	 * ```
	 */
	meekoPreserveArrayBreaks?: boolean
	/**
	 * Ordena las clases de cada atributo estático `class="…"` de la plantilla. Con `"off"` (por
	 * defecto) conserva su orden; con `"stylesheet"`, el de la primera aparición de cada clase en
	 * `app/styles/main.css` procesada como en `meeko dev` (con el `postcss.config` del proyecto, sus
	 * `@import` y sus `@utilities`) y, después, en el `<style>` del componente: las clases que no
	 * aparecen en ninguno van primero, en su orden. Con `"tailwind"` (desde 1.8.0), el orden oficial
	 * de Tailwind CSS 4, el mismo que `prettier-plugin-tailwindcss`, calculado con el design system
	 * de la hoja `meekoTailwindStylesheet` y el `tailwindcss` instalado en el proyecto: las clases que
	 * Tailwind no conoce van primero, en su orden. Con `"alphabetical"`, por orden de código. Si la
	 * hoja no existe o no se puede procesar (o, con `"tailwind"`, si `tailwindcss` 4 no está
	 * instalado), no se ordena y se avisa una vez. En un workspace no confiable de VS Code no se
	 * aplica ni `"stylesheet"` ni `"tailwind"`. En un atributo estático de un elemento, haya o no
	 * orden, el valor se normaliza siempre: espacios colapsados y sin clases repetidas. Desde 1.8.0,
	 * con un orden elegido también se aplica al `class` de una etiqueta de componente, a las cadenas
	 * de `bind:class` y a las de `meekoClassFunctions`; con `"off"` esos valores no se tocan.
	 *
	 * @since 1.3.0
	 * @example
	 * ```ts
	 * // prettier.config.ts
	 * import type { Config } from "prettier";
	 * import type { MeekoPrettierOptions } from "@meekojs/prettier-plugin";
	 *
	 * const config: Config & MeekoPrettierOptions = {
	 *   plugins: ["@meekojs/prettier-plugin"],
	 *   meekoSortClasses: "stylesheet",
	 * };
	 * export default config;
	 * // Con `.stack { … }` antes que `.card { … }` en la hoja:
	 * // <div class="card  stack  extra card">  →  <div class="extra stack card">
	 * ```
	 */
	meekoSortClasses?: 'off' | 'stylesheet' | 'tailwind' | 'alphabetical'
	/**
	 * Hoja de entrada de Tailwind con la que `meekoSortClasses: "tailwind"` carga el design system
	 * (sus `@import`, `@theme`, `@plugin`, `@utility` y `@custom-variant`), relativa a la raíz del
	 * proyecto Meeko. Por defecto `app/styles/main.css`.
	 *
	 * @since 1.8.0
	 * @example
	 * ```json
	 * { "plugins": ["@meekojs/prettier-plugin"], "meekoSortClasses": "tailwind", "meekoTailwindStylesheet": "app/styles/tailwind.css" }
	 * ```
	 */
	meekoTailwindStylesheet?: string
	/**
	 * Funciones cuyas cadenas son listas de clases, como `tailwindFunctions` de
	 * `prettier-plugin-tailwindcss`. Con un `meekoSortClasses` distinto de `"off"`, ordena con ese modo
	 * los literales de cadena de sus argumentos a cualquier profundidad (objetos, arrays, ternarios,
	 * `&&`, `||`, `??`, `+`, plantillas de cadena), en cualquier JavaScript o TypeScript que formatee
	 * Prettier con el plugin cargado: `<script>`, `<script server>`, expresiones de la plantilla y
	 * archivos `.ts`, `.tsx` y `.js`. Las claves de un objeto, las comparaciones, el cuerpo de una
	 * función y los argumentos de otra llamada no se tocan. Se comparan por nombre exacto, sin seguir
	 * los `import`: `tv` o, para un miembro, `styles.cn`. Por defecto `[]`: no ordena ninguna cadena.
	 *
	 * @since 1.8.0
	 * @example
	 * ```ts
	 * // prettier.config.ts
	 * import type { Config } from "prettier";
	 * import type { MeekoPrettierOptions } from "@meekojs/prettier-plugin";
	 *
	 * const config: Config & MeekoPrettierOptions = {
	 *   plugins: ["@meekojs/prettier-plugin"],
	 *   meekoSortClasses: "tailwind",
	 *   meekoClassFunctions: ["tv", "clsx", "cn"],
	 * };
	 * export default config;
	 * // tv({ base: "text-white flex" })  →  tv({ base: "flex text-white" })
	 * ```
	 */
	meekoClassFunctions?: string[]
}

interface MeekoSectionNode {
	type: 'section'
	name: SfcSection['name']
	start: number
	end: number
	contentStart: number
	contentEnd: number
	lang?: string
}

interface MeekoCommentNode {
	type: 'comment'
	start: number
	end: number
	value: string
}

interface MeekoRootNode {
	type: 'root'
	start: number
	end: number
	children: Array<MeekoSectionNode | MeekoCommentNode>
	/** Order of the classes for `meekoSortClasses: "stylesheet"` or `"tailwind"`, when it loaded. */
	classOrder?: ClassOrder
}

type MeekoNode = MeekoRootNode | MeekoSectionNode | MeekoCommentNode

/** Error de sintaxis con la ubicación que Prettier muestra en su marco de código. */
function syntaxError(message: string, line: number, column: number, cause?: unknown): Error {
	const error = new SyntaxError(`${message} (${line}:${column})`) as SyntaxError & { loc: unknown; cause?: unknown }
	error.loc = { start: { line, column } }
	if (cause !== undefined) error.cause = cause
	return error
}

/** El archivo debe compilar antes de formatearse; el error conserva la ubicación de Meeko. */
function validate(text: string, filename: string): void {
	try {
		compile(text, filename)
	} catch (error) {
		if (error instanceof MeekoCompileError) {
			const { code, message, location } = error.diagnostic
			throw syntaxError(`${code}: ${message}`, location.line, location.column, error)
		}
		throw error
	}
}

async function parse(text: string, options: ParserOptions<MeekoNode>): Promise<MeekoRootNode> {
	const filename = options.filepath || 'anonymous.meeko'
	validate(text, filename)
	const document = parseSfc(text, filename)
	// A file without `<script lang="ts">` keeps having none: the implicit stand-in is not printed.
	const sections = [document.server, document.script, document.template, document.style].filter((section): section is SfcSection => section !== undefined && !section.implicit).sort((left, right) => left.start - right.start)
	// The compiler does not read `<script server>`; its syntax is checked here.
	if (document.server) {
		const file = ts.createSourceFile(filename, document.server.content, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS) as ts.SourceFile & { parseDiagnostics: readonly ts.DiagnosticWithLocation[] }
		const diagnostic = file.parseDiagnostics[0]
		if (diagnostic) {
			const location = locate(text, document.server.contentStart + (diagnostic.start ?? 0))
			throw syntaxError(`MEEK013: ${ts.flattenDiagnosticMessageText(diagnostic.messageText, '\n')}`, location.line, location.column)
		}
	}
	const children: MeekoRootNode['children'] = []
	const comments = (from: number, to: number): void => {
		for (const match of text.slice(from, to).matchAll(/<!--[\s\S]*?-->/g)) {
			const start = from + match.index
			children.push({ type: 'comment', start, end: start + match[0].length, value: match[0].slice(4, -3) })
		}
	}
	let previous = 0
	for (const section of sections) {
		comments(previous, section.start)
		const lang = section.attributes.find((attribute) => attribute.name === 'lang')?.value
		children.push({
			type: 'section',
			name: section.name,
			start: section.start,
			end: section.end,
			contentStart: section.contentStart,
			contentEnd: section.contentEnd,
			...(lang !== undefined ? { lang } : {}),
		})
		previous = section.end
	}
	comments(previous, text.length)
	const root: MeekoRootNode = { type: 'root', start: 0, end: text.length, children }
	const { meekoSortClasses: sortClasses, meekoTailwindStylesheet: tailwindStylesheet } = options as MeekoPrettierOptions
	if (sortClasses === 'stylesheet') {
		// The component's own classes count as defined after the global stylesheet.
		const global = await stylesheetClassOrder(options.filepath)
		if (global) root.classOrder = document.style ? appendClassOrder(global, document.style.content) : global
	} else if (sortClasses === 'tailwind') {
		const sorter = await tailwindClassSorter(options.filepath, tailwindStylesheet)
		if (sorter) root.classOrder = sorter
	}
	return root
}

const meekoParser: Parser<MeekoNode> = {
	astFormat: 'meeko',
	parse,
	locStart: (node) => node.start,
	locEnd: (node) => node.end,
}

function verbatim(options: ParserOptions<MeekoNode> | Options, start: number, end: number): Doc {
	return replaceEndOfLine((options.originalText as string).slice(start, end))
}

function isPrettierIgnore(node: MeekoNode | undefined): boolean {
	return node?.type === 'comment' && node.value.trim() === 'prettier-ignore'
}

function contentParser(node: MeekoSectionNode): string | undefined {
	if (node.name === 'template') return templateParserName
	if (node.name === 'script' || node.name === 'server') return 'typescript'
	const lang = node.lang?.toLowerCase() ?? 'css'
	return lang === 'css' || lang === 'scss' || lang === 'less' ? lang : undefined
}

const meekoPrinter: Printer<MeekoNode> = {
	getVisitorKeys: (node) => (node.type === 'root' ? ['children'] : []),
	print(path: AstPath<MeekoNode>, options, print) {
		const { node } = path
		if (node.type !== 'root') return verbatim(options, node.start, node.end)
		const text = options.originalText
		const parts: Doc[] = []
		path.each((child, index) => {
			const current = child.node as MeekoSectionNode | MeekoCommentNode
			const previous = index > 0 ? node.children[index - 1] : undefined
			if (previous) {
				parts.push(hardline)
				// One blank line between sections or comments is kept; more collapse into one.
				if ((text.slice(previous.end, current.start).match(/\n/g)?.length ?? 0) > 1) parts.push(hardline)
			}
			parts.push(isPrettierIgnore(previous) ? verbatim(options, current.start, current.end) : print())
		}, 'children')
		return [parts, hardline]
	},
	embed(path: AstPath<MeekoNode>, options: Options) {
		const { node } = path
		if (node.type !== 'section') return null
		const parser = contentParser(node)
		if (!parser) return null
		return async (textToDoc: (text: string, options: Options) => Promise<Doc>) => {
			const text = options.originalText as string
			const open = verbatim(options, node.start, node.contentStart)
			const close = verbatim(options, node.contentEnd, node.end)
			const content = text.slice(node.contentStart, node.contentEnd)
			// The compiler renders this whitespace as text nodes: `<template><p></p></template>` has none.
			const keepsEdges = parser === templateParserName
			if (!content.trim()) return keepsEdges && content ? [open, ' ', close] : [open, close]
			// The script needs it too: its class functions know the classes of the component's `<style>`.
			const classOrder = parser === templateParserName || parser === 'typescript' ? (path.root as MeekoRootNode).classOrder : undefined
			const body = await textToDoc(content, { parser, __embeddedInHtml: true, ...(classOrder ? { [classOrderOption]: classOrder } : {}) })
			const indented = (options as MeekoPrettierOptions).meekoIndentSections === true
			const before = !keepsEdges || /^[\t\n\f\r ]/.test(content) ? hardline : ''
			const after = !keepsEdges || /[\t\n\f\r ]$/.test(content) ? hardline : ''
			return [open, indented ? indent([before, body]) : [before, body], after, close]
		}
	},
}

/**
 * Lenguaje `.meeko` que el plugin registra en Prettier, con el parser `meeko` y la extensión
 * `.meeko`.
 *
 * @since 1.1.0
 * @example
 * ```ts
 * import { languages } from "@meekojs/prettier-plugin";
 *
 * languages[0]?.extensions; // [".meeko"]
 * ```
 */
export const languages: SupportLanguage[] = [
	{
		name: 'Meeko',
		parsers: ['meeko'],
		extensions: ['.meeko'],
		vscodeLanguageIds: ['meeko'],
	},
]

/**
 * Parsers del plugin: `meeko` para archivos completos y el interno de la plantilla. El nombre
 * `meeko` es estable.
 *
 * @since 1.1.0
 * @example
 * ```ts
 * import { format } from "prettier";
 *
 * const formatted = await format(source, { parser: "meeko", plugins: ["@meekojs/prettier-plugin"] });
 * ```
 */
export const parsers: Record<string, Parser> = {
	meeko: meekoParser,
	...templatePlugin.parsers,
}

/**
 * Printers del plugin: `meeko` imprime cada sección del componente y delega el script, el estilo y
 * la plantilla en los printers de TypeScript, CSS y HTML de Prettier. Desde 1.3.0 incluye también
 * `estree`, el printer de JavaScript y TypeScript de Prettier con la regla de
 * `meekoPreserveArrayBreaks`: sustituye al de Prettier en todo lo que se formatee con el plugin
 * cargado (archivos `.ts`, `.js`, `.tsx`, `.mjs`, el script de los `.meeko` y las expresiones de la
 * plantilla) y delega, al formatear, en el printer `estree` del Prettier que lo ejecuta o en el de
 * un plugin anterior de la lista. Si otro plugin posterior también define `estree`, Prettier usa el
 * del último de la lista de `plugins`. Desde 1.8.0, el mismo printer aplica `meekoClassFunctions`.
 *
 * @since 1.1.0
 * @example
 * ```ts
 * import { printers } from "@meekojs/prettier-plugin";
 *
 * Object.keys(printers).includes("meeko"); // true
 * ```
 */
export const printers: Record<string, Printer> = {
	meeko: meekoPrinter,
	estree: preserveArrayBreaksPrinter,
	...templatePlugin.printers,
}

/**
 * Opciones propias del plugin para Prettier: `meekoIndentSections` (booleana, `false` por
 * defecto) y, desde 1.3.0, `meekoPreserveArrayBreaks` (booleana, `true` por defecto) y
 * `meekoSortClasses` (`"off"` por defecto, `"stylesheet"`, `"tailwind"` desde 1.8.0 o
 * `"alphabetical"`; en la CLI, `--meeko-sort-classes`) y, desde 1.8.0, `meekoTailwindStylesheet`
 * (ruta; en la CLI, `--meeko-tailwind-stylesheet`) y `meekoClassFunctions` (lista de nombres, `[]`
 * por defecto; en la CLI, `--meeko-class-functions`, una vez por nombre). Los nombres de las
 * opciones son estables.
 *
 * @since 1.1.0
 * @example
 * ```json
 * { "plugins": ["@meekojs/prettier-plugin"], "meekoIndentSections": true, "meekoPreserveArrayBreaks": false }
 * ```
 * @example
 * ```json
 * { "plugins": ["@meekojs/prettier-plugin"], "meekoSortClasses": "stylesheet" }
 * ```
 * @example
 * ```json
 * { "plugins": ["@meekojs/prettier-plugin"], "meekoSortClasses": "tailwind", "meekoClassFunctions": ["tv", "clsx", "cn"] }
 * ```
 * @see https://github.com/meekojs/meeko/blob/main/docs/editors.md#formato-con-prettier
 */
export const options: SupportOptions = {
	meekoIndentSections: {
		type: 'boolean',
		category: 'Meeko',
		default: false,
		description: 'Indent the content of <script>, <script server>, <template> and <style> sections in .meeko files.',
	},
	meekoPreserveArrayBreaks: {
		type: 'boolean',
		category: 'Meeko',
		default: true,
		description: 'Keep arrays, array patterns and tuple types expanded when the source has a line break between [ and the first element, like objectWrap: "preserve" does for objects.',
	},
	meekoSortClasses: {
		type: 'choice',
		category: 'Meeko',
		default: 'off',
		description: 'Sort the classes of static class attributes in .meeko templates.',
		choices: [
			{ value: 'off', description: 'Keep the order of the classes.' },
			{ value: 'stylesheet', description: "Order of first appearance in app/styles/main.css, processed as meeko dev does, then in the component's <style>; unknown classes first." },
			{ value: 'tailwind', description: "Tailwind CSS 4 order, as prettier-plugin-tailwindcss, from the project's tailwindcss and meekoTailwindStylesheet; unknown classes first." },
			{ value: 'alphabetical', description: 'Code unit order.' },
		],
	},
	meekoTailwindStylesheet: {
		type: 'string',
		category: 'Meeko',
		description: 'Tailwind CSS entry stylesheet for meekoSortClasses "tailwind", relative to the Meeko project root. Default: app/styles/main.css.',
	},
	meekoClassFunctions: {
		type: 'string',
		array: true,
		category: 'Meeko',
		default: [{ value: [] }],
		description: 'Functions whose string literals are class lists, such as tv, clsx or cn; meekoSortClasses orders them at any depth of their arguments.',
	},
}

/**
 * Plugin de Prettier para componentes `.meeko`. Formatea `<script>` y `<script server>` como
 * TypeScript, `<style>` como CSS y la plantilla como HTML, con los valores de las directivas y el
 * texto `{expr}` formateados como expresiones. Desde 1.3.0 normaliza el atributo estático `class`
 * de los elementos (espacios colapsados, sin clases repetidas) y puede ordenar sus clases con
 * `meekoSortClasses`. Un archivo que no compila no se formatea.
 *
 * @since 1.1.0
 * @example
 * ```ts
 * import { format } from "prettier";
 * import meeko from "@meekojs/prettier-plugin";
 *
 * const output = await format('<script lang="ts">const a=1</script><template><p>{a}</p></template>', {
 *   parser: "meeko",
 *   plugins: [meeko],
 * });
 * ```
 * @see https://github.com/meekojs/meeko/blob/main/docs/editors.md#formato-con-prettier
 */
const plugin: Plugin = { languages, parsers, printers, options }
export default plugin
