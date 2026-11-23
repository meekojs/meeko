import type { CompilerOptions } from '@typescript/typescript6'

import { execFile } from 'node:child_process'
import { createHash, randomUUID } from 'node:crypto'
import { existsSync, readFileSync } from 'node:fs'
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { basename, dirname, isAbsolute, join, relative, resolve, sep } from 'node:path'
import { promisify } from 'node:util'

import type { AutoImport } from './autoimports/registry'
import type { SourceMapping } from './compiler/mapping'
import type { CompileDiagnostic } from './compiler/parser/sfc'
import type { ProjectAliases } from './framework/aliases'

import { UnexposedRefError } from './app/runtime/element-refs'
import { discoverAutoImports } from './autoimports/registry'
import { applyAutoImports, compileWithAutoImports } from './autoimports/transform'
import { aliasCandidates } from './compiler/aliases'
import { attributeData, closedAttributeValuesOf, plainTagName } from './compiler/attribute-values'
import { routeBlockTypeSource } from './compiler/codegen/route-block-types'
import { pageRouteId } from './compiler/codegen/server-script'
import { moduleSpecifiers, replaceModuleSpecifiers } from './compiler/import-graph'
import { originalOffset } from './compiler/mapping'
import { compileError, locate, MeekoCompileError } from './compiler/parser/sfc'
import { generatedServicesDeclaration, projectDeclarationFiles } from './compiler/project-declarations'
import { onceByRoot, projectRoot } from './compiler/project-root'
import { resolveProjectAliases, resolveProjectAliasesSync } from './framework/aliases'
import { readMeekoConfigSync } from './framework/config'
import { modelPropName } from './shared/model-names'
import { tscCommand } from './typescript-cli'

const execFileAsync = promisify(execFile)

interface GeneratedEntry {
	original: string
	generated: string
	source: string
	code: string
	mappings: SourceMapping[]
	/**
	 * TypeScript copy of the page's `<script server>`, which types the exports the page reads. Its
	 * line `n + lines` is line `n` of the `.meeko` file: the autoimports add `lines` lines before it.
	 */
	server?: { readonly file: string; readonly code: string; readonly lines: number }
	/** Compiler warnings of this component. */
	warnings: readonly CompileDiagnostic[]
	/** Components that this one imports, to attribute their errors to the first checked component that reaches them. */
	children: GeneratedEntry[]
}

/** A component to check: its text and its path. */
export interface CheckInput {
	readonly source: string
	readonly filename: string
}

/** Ajustes de `checkSource` para herramientas que no deben ejecutar la configuración del proyecto. */
export interface CheckSourceOptions {
	/** Registro de autoimports por raíz de proyecto; por defecto se carga la configuración como el CLI. */
	readonly autoImports?: (projectRoot: string) => readonly AutoImport[] | Promise<readonly AutoImport[]>
	/**
	 * Aliases de ruta por raíz de proyecto; por defecto se leen de la configuración como el CLI, o sin
	 * ejecutarla si se da `autoImports`.
	 */
	readonly aliases?: (projectRoot: string) => ProjectAliases | Promise<ProjectAliases>
	/**
	 * El componente se comprueba como parte de su proyecto: `meeko check` del directorio, que ya
	 * prepara `.meeko/types`, comprueba dónde va cada `<script server>` y `generic` (`MEEK044`,
	 * `MEEK100`) y pasa TypeScript por el proyecto `server`, o el editor, que hace lo mismo por su
	 * cuenta. Sin él, como `meeko check componente.meeko`, el componente de un proyecto con `app/`
	 * se comprueba solo: aplica esas reglas, da los errores de tipos de su `<script server>` y, si
	 * el proyecto ya tiene `.meeko/types`, los regenera antes.
	 */
	readonly withinProject?: boolean
	/**
	 * Modo de `MEEK122`: `"warn"` avisa de cada literal fuera de los valores de un atributo;
	 * `"strict"` da además un error cuando un atributo con un conjunto cerrado de valores recibe un
	 * tipo amplio como `string | null`. Por defecto, `check.attributeValues` de `meeko.config.*`,
	 * leído sin ejecutar la configuración, y sin él `"warn"`.
	 */
	readonly attributeValues?: 'warn' | 'strict'
}

/** Whether a project checks attribute values in the strict mode: the option, or else `check.attributeValues` of its configuration. */
function strictAttributeValues(root: string, options: CheckSourceOptions): boolean {
	if (options.attributeValues) return options.attributeValues === 'strict'
	try {
		return readMeekoConfigSync(root).check?.attributeValues === 'strict'
	} catch {
		// A configuration that cannot be read is reported elsewhere; the default mode applies.
		return false
	}
}

/** The path aliases of a project, as `options` gives them or as `meeko check` (or the static reader) reads them. */
async function projectAliasesFor(root: string, options: CheckSourceOptions): Promise<ProjectAliases> {
	if (options.aliases) return options.aliases(root)
	return options.autoImports ? resolveProjectAliasesSync(root) : resolveProjectAliases(root)
}

/** The type-checking options of a component checked alone, unless the project's generated tsconfig says otherwise. */
const defaultCheckOptions = {
	strict: true,
	skipLibCheck: true,
	noUncheckedIndexedAccess: true,
	exactOptionalPropertyTypes: true,
	verbatimModuleSyntax: true,
	module: 'esnext',
	moduleResolution: 'bundler',
	target: 'es2022',
	lib: ['es2022', 'dom'],
} as const satisfies Record<string, boolean | string | readonly string[]>

/** Options of the generated tsconfig that a component checked alone takes too. */
const inheritedCheckOptions = ['target', 'lib', 'types', 'exactOptionalPropertyTypes', 'noUncheckedIndexedAccess', 'noImplicitOverride', 'noImplicitReturns', 'noFallthroughCasesInSwitch', 'noPropertyAccessFromIndexSignature', 'noUnusedLocals', 'noUnusedParameters', 'useUnknownInCatchVariables'] as const

type CheckOptions = Record<string, boolean | string | readonly string[]>

/**
 * The options of `.meeko/tsconfig.app.json` (or `tsconfig.server.json` for a component of
 * `server/`) that decide the type check, over the defaults: `typescript.compilerOptions` of
 * `meeko.config.ts` and the `types` of the project reach a component checked alone as they reach
 * `meeko check` of the whole project. Without a generated tsconfig, the defaults.
 */
function generatedCheckOptions(rootDirectory: string, filename: string): CheckOptions & { types?: readonly string[] } {
	const file = join(rootDirectory, '.meeko', componentTarget(rootDirectory, filename) === 'server' ? 'tsconfig.server.json' : 'tsconfig.app.json')
	const options: CheckOptions = { ...defaultCheckOptions }
	let generated: Record<string, unknown>
	try {
		generated = (JSON.parse(readFileSync(file, 'utf8')) as { compilerOptions?: Record<string, unknown> }).compilerOptions ?? {}
	} catch {
		return options
	}
	for (const key of inheritedCheckOptions) {
		const value = generated[key]
		if (typeof value === 'boolean' || typeof value === 'string' || (Array.isArray(value) && value.every((entry) => typeof entry === 'string'))) options[key] = value as boolean | string | readonly string[]
	}
	return options
}

/**
 * The entries of `types` that TypeScript resolves from `directory` (where the temporary tsconfig
 * lives, inside the project) with the project's `typeRoots`. The generated tsconfig always lists
 * `node` and `vite/client`; a project without `@types/node` or `vite` installed (a component
 * library, a fixture) would otherwise stop the whole check with a global TS2688 instead of
 * reporting the component's diagnostics. A project that has them keeps them.
 */
async function resolvableTypes(types: readonly string[], directory: string, resolution: Record<string, unknown> | undefined): Promise<string[]> {
	const { default: ts } = await import('@typescript/typescript6')
	const typeRoots = Array.isArray(resolution?.['typeRoots']) ? (resolution['typeRoots'] as unknown[]).filter((entry): entry is string => typeof entry === 'string') : undefined
	const containingFile = join(directory, 'tsconfig.json')
	// `configFilePath` makes the default `typeRoots` those of the temporary tsconfig, not of the process's cwd.
	const options: CompilerOptions = { module: ts.ModuleKind.ESNext, moduleResolution: ts.ModuleResolutionKind.Bundler, configFilePath: containingFile, ...(typeRoots ? { typeRoots } : {}) }
	return types.filter((name) => ts.resolveTypeReferenceDirective(name, containingFile, options, ts.sys).resolvedTypeReferenceDirective !== undefined)
}

/** `options` as `tsc` flags; `types` travels in the temporary tsconfig instead. */
function checkFlags(options: CheckOptions): string[] {
	return Object.entries(options).flatMap(([key, value]) => {
		if (key === 'types') return []
		if (typeof value === 'boolean') return value ? [`--${key}`] : [`--${key}`, 'false']
		return [`--${key}`, typeof value === 'string' ? value.toLowerCase() : value.map((entry) => entry.toLowerCase()).join(',')]
	})
}

function componentTarget(rootDirectory: string, filename: string): 'client' | 'server' {
	return relative(rootDirectory, filename).split(/[\\/]/)[0] === 'server' ? 'server' : 'client'
}

/**
 * Generated declarations that the `tsconfig.app.json` and `tsconfig.server.json` projects
 * load: the autoimport globals of the component's scope, which `.ts` modules imported by the
 * component rely on, and the route ids that type `href`. Only existing files are used, so a
 * component outside a framework project is checked as before.
 */
function generatedDeclarations(rootDirectory: string, filename: string): string[] {
	const types = join(rootDirectory, '.meeko', 'types')
	return [join(types, 'autoimports', `${componentTarget(rootDirectory, filename)}.d.ts`), join(types, 'routes.d.ts'), join(types, 'i18n.d.ts'), join(types, 'modules.d.ts')].filter((file) => existsSync(file))
}

interface CompiledGraph {
	/** Each input, in order: its compiled entry, or the compile error that stops its check. */
	readonly roots: ReadonlyArray<GeneratedEntry | CompileDiagnostic>
	readonly entries: Map<string, GeneratedEntry>
	readonly tempDirectory: string
}

/**
 * Compiles the components of `inputs`, all of one project, and every `.meeko` they import into one
 * temporary tree. A component imported by several of them is compiled once. A compile error stops
 * only the component whose graph it is in: the entries that its attempt left half done are dropped.
 */
async function compileGraph(inputs: readonly CheckInput[], options: CheckSourceOptions, autoImports: (root: string) => Promise<readonly AutoImport[]>): Promise<CompiledGraph> {
	const byOriginal = new Map<string, GeneratedEntry>()
	const byGenerated = new Map<string, GeneratedEntry>()
	const nonce = randomUUID()
	const rootDirectory = projectRoot(inputs[0]!.filename)
	const rootFiles = new Set(inputs.map((input) => input.filename))
	const generatedDirectory = join(rootDirectory, '.meeko', 'check', nonce)
	async function add(original: string, content: string): Promise<GeneratedEntry> {
		const previous = byOriginal.get(original)
		if (previous) return previous
		const target = componentTarget(rootDirectory, original)
		const registry = await autoImports(projectRoot(original))
		const aliases = await projectAliasesFor(projectRoot(original), options)
		const compiled = await compileWithAutoImports(content, original, { typeCheck: true, strictAttributeValues: strictAttributeValues(projectRoot(original), options) }, target, registry, aliases)
		const location = relative(rootDirectory, original)
		// A module component can live outside the consumer project. Keep its temporary copy inside
		// this check's nonce directory, or a second check/build will collide with the escaped file.
		const generatedPath = isAbsolute(location) || location === '..' || location.startsWith(`..${sep}`) ? join('external', createHash('sha256').update(resolve(original)).digest('hex').slice(0, 16), `${basename(original)}.ts`) : `${location}.ts`
		const entry: GeneratedEntry = {
			original,
			source: content,
			code: compiled.code,
			generated: join(generatedDirectory, generatedPath),
			mappings: compiled.mappings.map((mapping) => ({ ...mapping })),
			warnings: compiled.warnings ?? [],
			children: [],
		}
		byOriginal.set(original, entry)
		byGenerated.set(entry.generated, entry)
		const serverSpecifier = `./${basename(original)}.server.js`
		// Checked alone, a page also gets the copy of a block with only route options, so TypeScript
		// checks them (`layoutProps` against its layout, for example) as the server project does.
		const routeOptions = !options.withinProject && rootFiles.has(original) && /<script\b[^>]*\bserver\b/.test(content)
		if (entry.code.includes(`from ${JSON.stringify(serverSpecifier)}`) || routeOptions) {
			const file = entry.generated.replace(/\.ts$/, '.server.ts')
			entry.server = { file, ...serverCopy(content, original, file, options.autoImports ? registry : await autoImports(rootDirectory)) }
		}
		const edits: Array<{ start: number; end: number; text: string }> = []
		for (const specifier of moduleSpecifiers(entry.code, entry.generated)) {
			const { value, start, end } = specifier
			if (entry.server && value === serverSpecifier) continue
			if (!value.endsWith('.meeko') && !value.startsWith('.')) continue
			// Since 1.5 a path alias also names a component (`@/components/Card.meeko`): the first file that exists.
			const aliased = value.startsWith('.') ? undefined : aliasCandidates(aliases.aliases, value)
			if (value.endsWith('.meeko') && !value.startsWith('.') && !aliased) {
				throw compileError(content, original, 'MEEK033', 'Los imports de componentes deben usar rutas .meeko relativas o un alias de ruta (@/, ~/…)', originalOffset(entry.mappings, start) ?? 0)
			}
			let destination: string
			if (value.endsWith('.meeko')) {
				const childFilename = aliased?.find((candidate) => existsSync(candidate)) ?? aliased?.[0] ?? resolve(dirname(original), value)
				let childSource: string
				try {
					childSource = await readFile(childFilename, 'utf8')
				} catch {
					throw compileError(content, original, 'MEEK034', `No se encuentra el componente importado: ${value}`, originalOffset(entry.mappings, start) ?? 0)
				}
				const child = await add(childFilename, childSource)
				entry.children.push(child)
				destination = child.generated.replace(/\.ts$/, '.js')
			} else {
				destination = resolve(dirname(original), value)
			}
			let target = relative(dirname(entry.generated), destination).replaceAll('\\', '/')
			if (!target.startsWith('./') && !target.startsWith('../')) target = `./${target}`
			edits.push({ start, end, text: target })
		}
		for (const edit of edits.reverse()) {
			const delta = edit.text.length - (edit.end - edit.start)
			entry.code = entry.code.slice(0, edit.start) + edit.text + entry.code.slice(edit.end)
			for (const mapping of entry.mappings) {
				if (mapping.generatedStart >= edit.end) mapping.generatedStart += delta
				if (mapping.generatedEnd >= edit.end) mapping.generatedEnd += delta
			}
		}
		return entry
	}
	const roots: Array<GeneratedEntry | CompileDiagnostic> = []
	for (const input of inputs) {
		const known = new Set(byOriginal.keys())
		try {
			roots.push(await add(input.filename, input.source))
		} catch (error) {
			if (!(error instanceof MeekoCompileError)) throw error
			for (const [original, entry] of byOriginal) {
				if (known.has(original)) continue
				byOriginal.delete(original)
				byGenerated.delete(entry.generated)
			}
			roots.push(error.diagnostic)
		}
	}
	return { roots, entries: byGenerated, tempDirectory: generatedDirectory }
}

/**
 * The page's `<script server>` as a module beside the compiled page, with its
 * server autoimports and relative imports resolved from the page's folder. Its
 * own diagnostics belong to the server TypeScript project, not to this check.
 */
function serverCopy(source: string, original: string, file: string, registry: readonly AutoImport[]): { code: string; lines: number } {
	const block = routeBlockTypeSource(source, original, pageRouteId(original)) ?? 'export {};\n'
	let code = block
	try {
		code = applyAutoImports(block, original, registry, 'server')
	} catch {
		/* An unresolved autoimport is reported by the server project. */
	}
	// The block keeps the lines of the `.meeko` file; the autoimports go before it.
	const lines = code.slice(0, code.length - block.length).split('\n').length - 1
	return {
		code: replaceModuleSpecifiers(code, file, ({ value }) => {
			if (!value.startsWith('.')) return value
			const target = relative(dirname(file), resolve(dirname(original), value)).replaceAll('\\', '/')
			return target.startsWith('.') ? target : `./${target}`
		}),
		lines,
	}
}

/**
 * What `meeko check componente.meeko` adds to the compiler and TypeScript for a component of a
 * framework project (one with `app/`): `MEEK044`/`MEEK100` for `<script server>` and `generic` and,
 * once the project has `.meeko/types`, fresh declarations, so a layout or a page created since the
 * last `meeko check .` is known.
 * Returns the placement error, if any.
 */
async function prepareStandaloneCheck(source: string, filename: string): Promise<CompileDiagnostic | undefined> {
	const root = projectRoot(filename)
	if (!existsSync(join(root, 'app'))) return undefined
	// Loaded on demand: the project generators import this module.
	const [{ prepareFrameworkTypeDeclarations }, { resolveConfigSources }, { assertRouteBlockPlacement }] = await Promise.all([
		import('./framework/type-declarations'),
		import('./framework/config'),
		import('./compiler/transforms/route-block'),
	])
	try {
		assertRouteBlockPlacement(
			source,
			filename,
			(await resolveConfigSources(root)).map((entry) => entry.root),
		)
	} catch (error) {
		if (error instanceof MeekoCompileError) return error.diagnostic
		throw error
	}
	// Only a project that `meeko check .`, `meeko dev` or the editor already prepared: the check of a
	// component reads those declarations, so they are brought up to date; without them it reads none.
	if (!existsSync(join(root, 'app', 'pages')) || !existsSync(join(root, '.meeko', 'types', 'routes.d.ts'))) return undefined
	// Another component that does not compile keeps its previous declaration, and a project that
	// cannot be prepared keeps its previous `.meeko/types`: `meeko check .` reports both.
	try {
		await prepareFrameworkTypeDeclarations(root, { onError: () => undefined })
	} catch {
		/* Checked against the declarations already there. */
	}
	return undefined
}

/** Resolution options of the project tsconfig that `meeko check` shares with the language server. */
const resolutionOptions = ['types', 'typeRoots', 'customConditions', 'resolveJsonModule', 'allowImportingTsExtensions'] as const

/**
 * Reads the module resolution options of `<root>/tsconfig.json` (the file the editor uses for hover
 * and navigation) so a `paths` alias that the editor resolves is not reported by `meeko check`.
 * Type-checking flags stay fixed. TypeScript 7 has no `baseUrl`: it becomes a `*` mapping. Since
 * 1.5 the project's path aliases are `paths` too, also without a tsconfig.
 */
async function projectResolutionOptions(root: string, aliases: ProjectAliases): Promise<Record<string, unknown> | undefined> {
	const { resolveProjectCompilerOptions } = await import('./language-server/model')
	const { options } = resolveProjectCompilerOptions(root, aliases)
	const baseUrl = typeof options.baseUrl === 'string' ? options.baseUrl : undefined
	const pathsBase = baseUrl ?? (typeof options['pathsBasePath'] === 'string' ? options['pathsBasePath'] : root)
	const absolute = (target: string): string => resolve(pathsBase, target).replaceAll('\\', '/')
	const paths: Record<string, string[]> = {}
	for (const [pattern, targets] of Object.entries(options.paths ?? {})) paths[pattern] = targets.map(absolute)
	if (baseUrl && !paths['*']) paths['*'] = [absolute('*')]
	const resolution: Record<string, unknown> = Object.keys(paths).length > 0 ? { paths } : {}
	for (const key of resolutionOptions) if (options[key] !== undefined) resolution[key] = options[key]
	return Object.keys(resolution).length > 0 ? resolution : undefined
}

function generatedOffset(code: string, line: number, column: number): number {
	const lines = code.split('\n')
	let offset = 0
	for (let index = 0; index < line - 1; index++) offset += (lines[index]?.length ?? 0) + 1
	return offset + column - 1
}

function parseTypeScriptOutput(output: string): Array<{ file: string; line: number; column: number; code: string; message: string }> {
	const diagnostics: Array<{ file: string; line: number; column: number; code: string; message: string }> = []
	for (const line of output.split(/\r?\n/)) {
		const match = /^(.*)\((\d+),(\d+)\): error TS(\d+): (.*)$/.exec(line)
		if (match) diagnostics.push({ file: match[1] ?? '', line: Number(match[2]), column: Number(match[3]), code: `TS${match[4]}`, message: match[5] ?? '' })
		else if (line.trim() && diagnostics.length > 0) diagnostics[diagnostics.length - 1]!.message += `\n${line}`
	}
	return diagnostics
}

/**
 * Original span `[start, end)` of the innermost mapping that contains `generated` when that mapping
 * does not keep the expression's length: the compiler rewrote it, so a position inside it is only
 * an approximation. `undefined` for a mapping that copies the source verbatim.
 */
function rewrittenSpan(mappings: readonly SourceMapping[], generated: number): readonly [number, number] | undefined {
	const span = mappings.filter((entry) => generated >= entry.generatedStart && generated < entry.generatedEnd).sort((a, b) => a.generatedEnd - a.generatedStart - (b.generatedEnd - b.generatedStart))[0]
	if (!span || span.generatedEnd - span.generatedStart === span.originalLength) return undefined
	return [span.originalStart, span.originalStart + span.originalLength]
}

/** The type error of `UntrustedHtmlMessage` that `checkTrustedHtml` reports for `html="expression"`. */
const untrustedHtmlType = /\bMEEK107: /

/**
 * Message of the `MEEK107` warning: the value of `html="expression"` is a `string` (or `any`)
 * without the `TrustedHtml` brand. A warning in 1.x; it becomes an error in 2.0.
 */
export const untrustedHtmlMessage = '`html` inserta HTML sin escapar; un `string` puede venir de un usuario (XSS). Sanéelo y márquelo con `trustHtml(…)`, o use `{expr}`, que escapa.'

/**
 * Message of the `MEEK107` warning for `bind:srcdoc` of an `<iframe>` (since 1.10): the document is
 * HTML that runs its scripts unless `sandbox` stops them.
 */
export const untrustedSrcdocMessage = '`srcdoc` crea un documento con HTML sin escapar; un `string` puede venir de un usuario (XSS). Sanéelo o constrúyalo usted y márquelo con `trustHtml(…)`; si el documento no es de confianza, añada al iframe `sandbox` sin `allow-scripts` ni `allow-same-origin`.'

/** The type error of `RequiredSnippetMessage` that `checkSnippetCondition` reports for `<snippet if:when>`. */
const requiredSnippetType = /\bMEEK110: ([A-Za-z_$][\w$]*) /

/**
 * Message of `MEEK110`: `if:when` on a `<snippet>` that fills a snippet the child requires, which
 * the child would then render without content.
 */
export function requiredSnippetMessage(name: string): string {
	return `if:when en <snippet name="${name}"> deja de pasar el snippet cuando la condición es falsa, pero el hijo declara ${name} como obligatorio. Decláralo opcional en el defineSnippets del hijo (${name}?: [...]) o quita if:when`
}

/**
 * The type errors of `AttributeLiteralCheck` and `AttributeStrictCheck` (MEEK122): one text for each
 * tag and each literal outside the values of an attribute, or the text of the strict mode.
 */
const attributeValueType = /"MEEK122: ([^\s"]+) de <([^>]+)> (?:no admite ((?:[^"\\]|\\.)*)|(exige un tipo cerrado))"/g

/** What a MEEK122 type error says: the attribute, its tags, the invalid literals and whether it is the strict check. */
function attributeValueFinding(message: string): { readonly name: string; readonly tags: readonly string[]; readonly invalid: readonly string[]; readonly strict: boolean } | undefined {
	const matches = [...message.matchAll(attributeValueType)]
	if (!matches.length) return undefined
	const invalid = new Set<string>()
	// TypeScript prints the literal inside a quoted property name: `\"` and `\\` are its escapes.
	for (const match of matches) if (match[3] !== undefined) invalid.add(match[3].replace(/\\(.)/g, '$1'))
	return { name: matches[0]![1]!, tags: [...new Set(matches.map((match) => match[2]!))], invalid: [...invalid], strict: matches.every((match) => match[4] !== undefined) }
}

/**
 * Message of `MEEK122`. With `invalid`, the literals that the attribute does not admit, each one
 * named, and the values that the standard admits: a warning in 1.x, an error in 2.0. Without them,
 * the strict mode: the type of the value is wider than the closed set of the attribute.
 */
export function attributeValueMessage(name: string, tags: readonly string[], invalid: readonly string[] = [], type?: string): string {
	const names = tags.map(plainTagName)
	const where = `${name} en <${names.join('> o <')}>`
	if (tags.some((tag) => attributeData(tag, name)?.kind === 'id') && !closedAttributeValuesOf(tags, name)) {
		return `${invalid.map((item) => JSON.stringify(item)).join(', ')} no es un ID válido para ${where}: admite el ID de un elemento, sin espacios y no vacío. Es un aviso en 1.x y será un error en 2.0`
	}
	const values = closedAttributeValuesOf(tags, name) ?? []
	const prefixes = [...new Set(tags.flatMap((tag) => attributeData(tag, name)?.prefixes ?? []))].map((prefix) => `${prefix}…`)
	const shown = [...values.map((item) => (item === '' ? '""' : item)), ...prefixes].join(', ')
	if (!invalid.length) return `${type === undefined ? 'El tipo de ese valor' : `El tipo ${type}`} es más amplio que los valores de ${where}: admite ${shown}, y null o undefined para omitirlo. Estrecha el tipo a esos valores; lo exige check.attributeValues: "strict"`
	const quoted = invalid.map((item) => JSON.stringify(item))
	return `${quoted.join(', ')} no ${quoted.length > 1 ? 'son valores' : 'es un valor'} de ${where}: admite ${shown}. Es un aviso en 1.x y será un error en 2.0`
}

/**
 * Type errors of `<component is>` with a tag (MEEK112, and MEEK031 for a void tag with content) and
 * of `bind="obj"` (MEEK113): the type text carries the code and the message, which the diagnostic
 * keeps without TypeScript's wrapping.
 */
const meekTypeText = /"(MEEK(?:031|112|113|131|136)): ([^"]+)"/

/** Message of a MEEK112, MEEK113, MEEK031 or MEEK131 type error, with what to do about it. */
/**
 * Message of `TS2312` in a component: `interface Props extends X`, where `X`, at `offset`, is usually
 * the `ComponentProps` of a component whose props are a union. An interface has one fixed shape, so
 * TypeScript does not let it extend the several shapes of a union; an intersection keeps them.
 */
export function interfaceExtendsMessage(source: string, offset: number): string {
	const base = /^[\w$.]+(?:<[^{}]*?>)?/.exec(source.slice(offset, offset + 256))?.[0] ?? 'X'
	const name = /interface\s+([\w$]+)[^{}]*$/.exec(source.slice(Math.max(0, offset - 512), offset))?.[1] ?? 'Props'
	return `Una interface no puede extender ${base} porque no tiene una forma única: suele ser una unión de props, y cada variante es distinta. Escribe un tipo, que conserva todas las variantes: type ${name} = ${base} & { … }`
}

/** How a parent passes a model. */
function modelForms(name: string): string {
	return `${name === 'default' ? 'model' : `model:${name}`}="señal" o bind:${modelPropName(name)}="valor"`
}

/**
 * Message of `TS2741` or `TS2739` when what a tag lacks is a required model: TypeScript names its
 * internal key (`"default"`), and the parent writes `model` or `bind:modelValue`. `tag` is the source
 * from the tag on. `undefined` for any other missing property.
 */
function missingModelMessage(message: string, tag: string): string | undefined {
	const type = String.raw`'ComponentModels(?:<[\s\S]*>)?'`
	const one = new RegExp(String.raw`^Property '"?([\w$]+)"?' is missing in type '[\s\S]*' but required in type ${type}\.$`).exec(message)?.[1]
	if (one) {
		const prop = modelPropName(one)
		const written = tag.slice(0, Math.max(0, /\/>|<\//.exec(tag)?.index ?? 0))
		if (new RegExp(String.raw`\bbind:${prop}\s*=`).test(written)) return `bind:${prop} admite undefined y este modelo es obligatorio: pasa un valor que no lo admita, o da a defineModel un default`
		return `Falta el modelo obligatorio${one === 'default' ? '' : ` ${one}`} de este componente: pásalo con ${modelForms(one)}`
	}
	const many = new RegExp(String.raw`^Type '[\s\S]*' is missing the following properties from type ${type}: (.+)$`).exec(message)?.[1]
	if (!many) return undefined
	const names = many.split(', ').map((name) => name.replace(/^"|"$/g, ''))
	return `Faltan modelos obligatorios de este componente: pásalos con ${names.map(modelForms).join(', y ')}`
}

function meekTypeMessage(code: string, text: string, source: string): string {
	if (code === 'MEEK112' && text.endsWith('no se aplica a ninguna etiqueta posible de is')) {
		return `${text}: Meeko no lo escribiría nunca; quítalo o añade a is una etiqueta que lo admita`
	}
	if (code === 'MEEK136') return `${text}: un módulo es código, y este valor se enviaría al navegador en cada render de servidor. Guarda en el estado qué entradas se pintan y léelas con un computed (const options = computed(() => visible.value.map((id) => entries[id]))), o empieza con undefined y asígnalo sólo en el navegador`
	// `is` never turns a text into a component: a name that only exists at run time needs one of these.
	const name = code === 'MEEK112' ? /^<([A-Z][\w$]*)> no es una etiqueta/.exec(text)?.[1] : undefined
	if (name) return `${text}: is nunca convierte un texto en un componente. Escribe el literal en la plantilla (is="cond ? '${name}' : 'section'"), pon en los datos el módulo importado (import * as ${name} from "./${name}.meeko") o cárgalo en ejecución con await resolveComponent('${name}') dentro de una función`
	if (code === 'MEEK112' && text.startsWith('is es un string cualquiera')) {
		return `${text}. Si ese texto nombra un componente, is nunca lo convierte en uno: escribe el literal en la plantilla (is="cond ? 'AppCard' : 'section'"), pon en los datos el módulo importado o cárgalo en ejecución con await resolveComponent(nombre) dentro de una función`
	}
	// `ComponentProps<Name>` also has the callbacks of `defineEmits`, which `bind` does not admit. Its
	// alias does not reach the type text, so the name comes from the component that writes it, if it does.
	if (code === 'MEEK113' && text.startsWith('bind no admite claves on*')) {
		const props = /\bComponentProps<["'`]([A-Z][\w$]*)["'`]>/.exec(source)?.[1]
		if (props) return `${text}. ComponentProps<'${props}'> incluye los eventos de defineEmits: tipa el objeto con el alias ${props}Props, que sólo tiene las props`
	}
	return text
}

/** The type error of `UnexposedRefMessage` that TypeScript reports for `await useElementRef(...)`. */
const unexposedRefType = /\bMEEK080: /

/**
 * `await useElementRef("name")` on a component without `defineExpose` fails as a TypeScript
 * assignability error whose type carries the MEEK080 text. It is reported as MEEK080, at the
 * `useElementRef` call of the original source, with the same message as `UnexposedRefError`.
 */
function unexposedRefDiagnostic(entry: GeneratedEntry, generated: number, offset: number | undefined): CompileDiagnostic {
	const ref = /\belementRef<[^>]*>\(\s*("(?:[^"\\]|\\.)*")/.exec(entry.code.slice(Math.max(0, generated - 32), generated + 512))
	let name: string | undefined
	try {
		name = ref ? (JSON.parse(ref[1]!) as string) : undefined
	} catch {
		name = undefined
	}
	const quoted = name === undefined ? '[^"\'`]*' : name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
	const calls = [...entry.source.matchAll(new RegExp(`\\buseElementRef\\s*\\(\\s*(["'\`])(${quoted})\\1`, 'g'))]
	const call = calls.filter((match) => offset !== undefined && match.index <= offset).at(-1) ?? calls[0]
	const named = name ?? call?.[2] ?? 'name'
	return {
		code: 'MEEK080',
		message: new UnexposedRefError(named).message.replace(/^MEEK080: /, ''),
		filename: entry.original,
		location: locate(entry.source, call?.index ?? offset ?? 0),
	}
}

/** Comprueba un componente con TypeScript 7 y devuelve errores ubicados en el .meeko original. */
export async function checkSource(source: string, filename: string, options: CheckSourceOptions = {}): Promise<CompileDiagnostic[]> {
	const absolute = resolve(filename)
	if (!options.withinProject) {
		const placement = await prepareStandaloneCheck(source, absolute)
		if (placement) return [placement]
	}
	return (await checkSources([{ source, filename: absolute }], options)).get(absolute) ?? []
}

/**
 * Comprueba varios componentes con TypeScript 7, como `checkSource` cada uno, pero con un programa
 * por proyecto y destino (cliente o servidor): un componente que importan varios se comprueba una
 * vez. Devuelve los diagnósticos de cada componente por su ruta absoluta. Un error en un componente
 * importado o en un módulo `.ts` se informa una vez, en el primero de `inputs` que lo alcanza.
 */
export async function checkSources(inputs: readonly CheckInput[], options: CheckSourceOptions = {}): Promise<Map<string, CompileDiagnostic[]>> {
	const groups = new Map<string, CheckInput[]>()
	for (const input of inputs) {
		const filename = resolve(input.filename)
		const root = projectRoot(filename)
		const key = `${root}\0${componentTarget(root, filename)}`
		groups.set(key, [...(groups.get(key) ?? []), { source: input.source, filename }])
	}
	const results = new Map<string, CompileDiagnostic[]>()
	// Discovering the autoimports runs the configuration and parses every autoimport folder: once per project.
	const autoImports = onceByRoot(options.autoImports ?? discoverAutoImports)
	for (const group of groups.values()) {
		const graph = await compileGraph(group, options, autoImports)
		for (const [index, root] of graph.roots.entries()) if (!('original' in root)) results.set(group[index]!.filename, [root])
		const roots = graph.roots.filter((root): root is GeneratedEntry => 'original' in root)
		if (roots.length) for (const [filename, diagnostics] of await typeCheckGraph(graph, roots, options)) results.set(filename, diagnostics)
		else await rm(graph.tempDirectory, { recursive: true, force: true })
	}
	return results
}

/** Runs one `tsc` over the compiled `roots` and maps its errors to each root's `.meeko` file. */
async function typeCheckGraph(graph: CompiledGraph, roots: readonly GeneratedEntry[], options: CheckSourceOptions): Promise<Map<string, CompileDiagnostic[]>> {
	const first = roots[0]!
	const rootDirectory = projectRoot(first.original)
	let output = ''
	try {
		for (const entry of graph.entries.values()) {
			await mkdir(dirname(entry.generated), { recursive: true })
			await writeFile(entry.generated, entry.code, { encoding: 'utf8', flag: 'wx' })
			if (entry.server) await writeFile(entry.server.file, entry.server.code, { encoding: 'utf8', flag: 'wx' })
		}
		// Options such as `paths` only exist in a tsconfig, so they go into a temporary one; the
		// command-line flags below still override every type-checking option.
		const projectResolution = await projectResolutionOptions(rootDirectory, await projectAliasesFor(rootDirectory, options))
		const files = [...roots.flatMap((root) => [root.generated, ...(root.server && !options.withinProject ? [root.server.file] : [])]), ...generatedDeclarations(rootDirectory, first.original), ...projectDeclarationFiles(rootDirectory), ...generatedServicesDeclaration(rootDirectory)]
		// The generated declarations name components by their `.meeko` path (the props of each named
		// layout in routes.d.ts), which the declaration tree resolves as in the framework tsconfigs.
		const declarationTree = join(rootDirectory, '.meeko', 'types')
		const checking = generatedCheckOptions(rootDirectory, first.original)
		const generatedTypes = checking.types && !projectResolution?.['types'] ? await resolvableTypes(checking.types, graph.tempDirectory, projectResolution) : undefined
		const withTypes = generatedTypes ? { ...projectResolution, types: generatedTypes } : projectResolution
		const resolution = existsSync(join(declarationTree, 'routes.d.ts')) ? { ...withTypes, rootDirs: [rootDirectory, declarationTree], allowArbitraryExtensions: true } : withTypes
		const project = resolution ? join(graph.tempDirectory, 'tsconfig.json') : undefined
		if (project) await writeFile(project, JSON.stringify({ compilerOptions: resolution, files }), { encoding: 'utf8', flag: 'wx' })
		try {
			const tsc = tscCommand([...(project ? ['--project', project] : ['--ignoreConfig']), '--noEmit', '--pretty', 'false', ...checkFlags(checking), ...(project ? [] : files)])
			const result = await execFileAsync(tsc.file, tsc.args, { cwd: dirname(first.original), maxBuffer: 64 * 1024 * 1024, windowsHide: true })
			output = result.stdout + result.stderr
		} catch (error) {
			const failure = error as Error & { stdout?: string; stderr?: string }
			output = `${failure.stdout ?? ''}${failure.stderr ?? ''}`
			if (!output.trim()) throw error
		}
	} finally {
		await rm(graph.tempDirectory, { recursive: true, force: true })
	}
	const cwd = dirname(first.original)

	const serverCopies = new Map([...graph.entries.values()].flatMap((entry) => (entry.server ? [[entry.server.file, entry] as const] : [])))
	const parsed = parseTypeScriptOutput(output)
	if (parsed.length === 0 && output.trim()) throw new Error(`Falló la comprobación con TypeScript 7: ${output.trim()}`)
	// Within the project, the server TypeScript project reports errors inside `<script server>` on the
	// page itself. A component checked alone reports those of its own block here.
	const serverDiagnostics: CompileDiagnostic[] = []
	const typed = parsed.filter((diagnostic) => {
		const page = serverCopies.get(resolve(cwd, diagnostic.file))
		if (!page) return true
		if (!options.withinProject && roots.includes(page)) {
			const line = Math.max(1, diagnostic.line - page.server!.lines)
			const offset = Math.min(page.source.length, generatedOffset(page.source, line, diagnostic.column))
			serverDiagnostics.push({ code: diagnostic.code, message: diagnostic.message, filename: page.original, location: locate(page.source, offset) })
		}
		return false
	})
	// Original span of each error whose position comes from a rewritten expression (approximate).
	const approximate = new Map<CompileDiagnostic, readonly [number, number]>()
	const mapped = await Promise.all(
		typed.map(async (diagnostic): Promise<CompileDiagnostic> => {
			const reported = resolve(cwd, diagnostic.file)
			const entry = graph.entries.get(reported)
			if (entry) {
				const generated = generatedOffset(entry.code, diagnostic.line, diagnostic.column)
				const offset = originalOffset(entry.mappings, generated)
				if (unexposedRefType.test(diagnostic.message)) return unexposedRefDiagnostic(entry, generated, offset)
				const requiredSnippet = requiredSnippetType.exec(diagnostic.message)
				if (requiredSnippet) {
					return { code: 'MEEK110', message: requiredSnippetMessage(requiredSnippet[1]!), filename: entry.original, location: locate(entry.source, offset ?? 0) }
				}
				const attributeValue = attributeValueFinding(diagnostic.message)
				if (attributeValue) {
					const type = /(?:Argument of type|Type) '(.*?)' is not assignable/.exec(diagnostic.message)?.[1]
					const message = attributeValueMessage(attributeValue.name, attributeValue.tags, attributeValue.invalid, type)
					// The strict mode is an error; a literal outside the values stays a warning in 1.x.
					return { code: 'MEEK122', message, filename: entry.original, location: locate(entry.source, offset ?? 0), ...(attributeValue.strict ? {} : { severity: 'warning' as const }) }
				}
				if (untrustedHtmlType.test(diagnostic.message)) {
					return { code: 'MEEK107', message: /\bMEEK107: srcdoc /.test(diagnostic.message) ? untrustedSrcdocMessage : untrustedHtmlMessage, filename: entry.original, location: locate(entry.source, offset ?? 0), severity: 'warning' }
				}
				const meekType = meekTypeText.exec(diagnostic.message)
				if (meekType) {
					return { code: meekType[1]!, message: meekTypeMessage(meekType[1]!, meekType[2]!, entry.source), filename: entry.original, location: locate(entry.source, offset ?? 0) }
				}
				const result: CompileDiagnostic = {
					code: diagnostic.code,
					message: offset === undefined ? `TypeScript generado: ${diagnostic.message}` : diagnostic.code === 'TS2312' ? interfaceExtendsMessage(entry.source, offset) : ((diagnostic.code === 'TS2741' || diagnostic.code === 'TS2739' ? missingModelMessage(diagnostic.message, entry.source.slice(offset)) : undefined) ?? diagnostic.message),
					filename: entry.original,
					location: locate(entry.source, offset ?? 0),
				}
				const span = offset === undefined ? undefined : rewrittenSpan(entry.mappings, generated)
				if (span) approximate.set(result, span)
				return result
			}
			// TypeScript also checks .ts dependencies imported by the .meeko graph.
			// Their positions already refer to the original file, not generated code.
			let imported: string
			try {
				imported = await readFile(reported, 'utf8')
			} catch {
				return { code: diagnostic.code, message: `TypeScript generado: ${diagnostic.message}`, filename: first.original, location: locate(first.source, 0) }
			}
			return {
				code: diagnostic.code,
				message: diagnostic.message,
				filename: reported,
				location: locate(imported, generatedOffset(imported, diagnostic.line, diagnostic.column)),
			}
		}),
	)
	// The compiler emits a template expression, and the check of each component tag, for several
	// render paths; each error is reported once. The compiler maps the pieces of an expression it
	// rewrites (a snippet parameter read from its arguments, for example); as a fallback, a copy whose
	// position only comes from a rewritten span is dropped when another path places the same error
	// exactly inside that span.
	const sameError = (left: CompileDiagnostic, right: CompileDiagnostic): boolean => left.filename === right.filename && left.code === right.code && left.message === right.message
	const seen = new Set<string>()
	const keep = (item: CompileDiagnostic): boolean => {
		const span = approximate.get(item)
		if (span && mapped.some((other) => other !== item && !approximate.has(other) && sameError(other, item) && other.location.offset >= span[0] && other.location.offset < span[1])) return false
		const key = `${item.filename}:${item.code}:${item.location.offset}:${item.message}`
		if (seen.has(key)) return false
		seen.add(key)
		return true
	}
	// Each error of an imported component goes to the first root that reaches it; one of a `.ts`
	// module, whose importers TypeScript does not report, to the first root.
	const owner = new Map<string, GeneratedEntry>(roots.map((root) => [root.original, root]))
	for (const root of roots) {
		const pending = [...root.children]
		while (pending.length) {
			const entry = pending.pop()!
			if (owner.has(entry.original)) continue
			owner.set(entry.original, root)
			pending.push(...entry.children)
		}
	}
	const cleanupDiagnostics = roots.some((root) => root.source.includes('onCleanup')) ? (await import('./language-server/cleanup')).componentCleanupDiagnostics : undefined
	const results = new Map<string, CompileDiagnostic[]>()
	for (const root of roots) {
		const own = (item: CompileDiagnostic): boolean => (owner.get(item.filename) ?? first) === root
		// MEEK128 and MEEK129, misuses of `onCleanup` in the script; loaded only when a script uses it.
		const cleanup = cleanupDiagnostics && root.source.includes('onCleanup') ? cleanupDiagnostics(root.source, root.original) : []
		// Warnings of the checked components only; each imported component reports its own when checked.
		const items = [...mapped.filter(own), ...serverDiagnostics.filter((item) => item.filename === root.original), ...root.warnings, ...cleanup]
		results.set(
			root.original,
			items.filter((item) => !(item.severity === 'warning' && item.filename !== root.original) && keep(item)),
		)
	}
	return results
}
