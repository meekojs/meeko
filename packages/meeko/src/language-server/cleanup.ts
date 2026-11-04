import ts from '@typescript/typescript6'

import type { CompileDiagnostic, SfcSection } from '../compiler/parser/sfc'
import type { SetupFunctionZone } from './zones'

import { analyzeComposables } from '../compiler/composables'
import { locate, parseSfc } from '../compiler/parser/sfc'
import { createVirtualComponent } from './model'
import { setupFunctionZones } from './zones'

/**
 * Globals of the DOM that a cleanup can name and that do not exist in Node 24, the server runtime
 * of the SSR: there, reading one throws `ReferenceError`. Only names that are unmistakably the
 * browser's are listed; `navigator`, `performance`, `fetch`, `WebSocket`, `EventTarget` or
 * `structuredClone` exist in Node too, and short names such as `top`, `self` or `parent` are left
 * out. A test checks that none of these exists in the running Node.
 */
export const browserOnlyGlobals: readonly string[] = [
	// Window and document.
	'window',
	'document',
	'location',
	'history',
	'screen',
	'visualViewport',
	'customElements',
	'localStorage',
	'sessionStorage',
	'indexedDB',
	'caches',
	// Frames, idle callbacks and observers.
	'requestAnimationFrame',
	'cancelAnimationFrame',
	'requestIdleCallback',
	'cancelIdleCallback',
	'ResizeObserver',
	'IntersectionObserver',
	'MutationObserver',
	// Layout and viewport.
	'matchMedia',
	'getComputedStyle',
	'getSelection',
	'scrollTo',
	'scrollBy',
	'innerWidth',
	'innerHeight',
	'outerWidth',
	'outerHeight',
	'scrollX',
	'scrollY',
	'devicePixelRatio',
	// Dialogs and DOM classes.
	'alert',
	'confirm',
	'prompt',
	'HTMLElement',
	'Element',
	'Node',
	'EventSource',
]

const browserGlobals: ReadonlySet<string> = new Set(browserOnlyGlobals)

/** Reference of `onCleanup`, linked from the messages. */
export const cleanupReference = 'https://meekojs.com/docs/reference/oncleanup'

/** Message of `MEEK128`: a cleanup that also runs during SSR uses `apis`, which only exist in the browser. */
export function cleanupBrowserApiMessage(apis: readonly string[]): string {
	const named = apis.map((api) => `\`${api}\``)
	const list = named.length === 1 ? named[0]! : `${named.slice(0, -1).join(', ')} y ${named.at(-1)}`
	return `\`onCleanup\` se ejecuta también en el servidor (SSR) y usa ${list}, que solo ${named.length === 1 ? 'existe' : 'existen'} en el navegador: crea el recurso y su limpieza dentro de \`onMounted\`. Es un aviso en 1.x y será un error en 2.0. Consulta ${cleanupReference}`
}

/** Message of `MEEK129`: `onCleanup` after an `await` of the same function. */
export const cleanupAfterAwaitMessage = '`onCleanup` se registra después de un `await`: cuando la función continúa ya no hay una raíz activa, así que lanza «onCleanup() requires an active component root» o registra la limpieza en otro componente, y si el componente se desmonta mientras espera, el recurso queda abierto. Regístrala antes del primer `await` y deja que compruebe lo que haya. Es un aviso en 1.x y será un error en 2.0. Consulta ' + cleanupReference

/** Message of `MEEK130`: `onCleanup` while a module is evaluated, outside any root. */
export const cleanupOutsideRootMessage = '`onCleanup` se llama al evaluar el módulo, fuera de una raíz: al importarlo lanza «onCleanup() requires an active component root», porque un módulo no se desmonta. Llámalo dentro de un composable que invoque el script del componente, o dentro de `createRoot`. Es un aviso en 1.x y será un error en 2.0. Consulta ' + cleanupReference

type FunctionScope = ts.FunctionLikeDeclaration

function isFunctionScope(node: ts.Node): node is FunctionScope {
	return ts.isFunctionDeclaration(node) || ts.isFunctionExpression(node) || ts.isArrowFunction(node) || ts.isMethodDeclaration(node) || ts.isAccessor(node) || ts.isConstructorDeclaration(node)
}

function unwrapParent(node: ts.Node): { node: ts.Node; parent: ts.Node } {
	let current = node
	while (ts.isParenthesizedExpression(current.parent) || ts.isAsExpression(current.parent) || ts.isSatisfiesExpression(current.parent)) current = current.parent
	return { node: current, parent: current.parent }
}

function calleeName(call: ts.CallExpression): string | undefined {
	return ts.isIdentifier(call.expression) ? call.expression.text : undefined
}

/** A checker over `file` alone, without libraries: a name it cannot resolve is a global. */
function isolatedChecker(file: ts.SourceFile): ts.TypeChecker {
	const host: ts.CompilerHost = {
		getSourceFile: (name) => (name === file.fileName ? file : undefined),
		getDefaultLibFileName: () => 'lib.d.ts',
		writeFile: () => undefined,
		getCurrentDirectory: () => '',
		getCanonicalFileName: (name) => name,
		useCaseSensitiveFileNames: () => true,
		getNewLine: () => '\n',
		fileExists: (name) => name === file.fileName,
		readFile: () => undefined,
	}
	const options: ts.CompilerOptions = { noLib: true, noResolve: true, types: [], target: ts.ScriptTarget.Latest, module: ts.ModuleKind.ESNext }
	return ts.createProgram({ rootNames: [file.fileName], options, host }).getTypeChecker()
}

/** The symbol that `identifier` names as a value, or `undefined` for a global. */
function valueSymbol(checker: ts.TypeChecker, identifier: ts.Identifier): ts.Symbol | undefined {
	const parent = identifier.parent
	if (ts.isShorthandPropertyAssignment(parent) && parent.name === identifier) return checker.getShorthandAssignmentValueSymbol(parent)
	return checker.getSymbolAtLocation(identifier)
}

/** `call` is Meeko's `onCleanup`: the autoimport (a global here) or an import of `@meekojs/meeko`. */
function isMeekoCleanup(checker: ts.TypeChecker, call: ts.CallExpression): boolean {
	if (!ts.isIdentifier(call.expression)) return false
	const symbol = checker.getSymbolAtLocation(call.expression)
	if (!symbol) return call.expression.text === 'onCleanup'
	const declaration = symbol.declarations?.[0]
	if (!declaration || !ts.isImportSpecifier(declaration)) return false
	const module = declaration.parent.parent.parent.moduleSpecifier
	return (declaration.propertyName ?? declaration.name).text === 'onCleanup' && ts.isStringLiteral(module) && (module.text === '@meekojs/meeko' || module.text.startsWith('@meekojs/meeko/'))
}

function cleanupCalls(file: ts.SourceFile, checker: ts.TypeChecker): ts.CallExpression[] {
	const calls: ts.CallExpression[] = []
	const visit = (node: ts.Node): void => {
		if (ts.isCallExpression(node) && isMeekoCleanup(checker, node)) calls.push(node)
		ts.forEachChild(node, visit)
	}
	visit(file)
	return calls
}

/** The innermost function that contains `node`, if any. */
function enclosingFunction(node: ts.Node): FunctionScope | undefined {
	for (let current = node.parent; current && !ts.isSourceFile(current); current = current.parent) if (isFunctionScope(current)) return current
	return undefined
}

/** `call` comes after an `await` of its own async function (not of a nested one). */
function afterAwait(call: ts.CallExpression): boolean {
	const scope = enclosingFunction(call)
	const async = scope && ts.canHaveModifiers(scope) && ts.getModifiers(scope)?.some((modifier) => modifier.kind === ts.SyntaxKind.AsyncKeyword)
	if (!scope?.body || !async) return false
	const start = call.getStart()
	let found = false
	const visit = (node: ts.Node): void => {
		if (found || node.getStart() >= start) return
		if (node !== scope && isFunctionScope(node)) return
		if ((ts.isAwaitExpression(node) && node.end <= start) || (ts.isForOfStatement(node) && node.awaitModifier && node.awaitModifier.end <= start)) {
			found = true
			return
		}
		ts.forEachChild(node, visit)
	}
	ts.forEachChild(scope.body, visit)
	return found
}

/** `expression` holds a check for the server: `typeof <global>` or `import.meta.env.SSR` (or `.server`, `.client`). */
function hasServerCheck(expression: ts.Node, checker: ts.TypeChecker): boolean {
	let found = false
	const visit = (node: ts.Node): void => {
		if (found) return
		if (ts.isTypeOfExpression(node) && ts.isIdentifier(node.expression) && !valueSymbol(checker, node.expression)) found = true
		else if (ts.isPropertyAccessExpression(node) && /^import\.meta\.(?:env\.SSR|server|client)$/.test(node.getText())) found = true
		else ts.forEachChild(node, visit)
	}
	visit(expression)
	return found
}

/** `statement` leaves early when the check holds: `if (typeof window === "undefined") return;`. */
function isEarlyExit(statement: ts.Statement, checker: ts.TypeChecker): boolean {
	if (!ts.isIfStatement(statement) || !hasServerCheck(statement.expression, checker)) return false
	const exits = (node: ts.Statement): boolean => ts.isReturnStatement(node) || ts.isThrowStatement(node) || (ts.isBlock(node) && node.statements.some(exits))
	return exits(statement.thenStatement)
}

/** A server check protects `node`: an enclosing condition, a `&&`/`?:` branch or an earlier early exit. */
function guarded(node: ts.Node, checker: ts.TypeChecker): boolean {
	let child = node
	for (let current = node.parent; current; child = current, current = current.parent) {
		if (ts.isIfStatement(current) && child !== current.expression && hasServerCheck(current.expression, checker)) return true
		if (ts.isConditionalExpression(current) && child !== current.condition && hasServerCheck(current.condition, checker)) return true
		if (ts.isBinaryExpression(current) && child === current.right && hasServerCheck(current.left, checker) && [ts.SyntaxKind.AmpersandAmpersandToken, ts.SyntaxKind.BarBarToken, ts.SyntaxKind.QuestionQuestionToken].includes(current.operatorToken.kind)) return true
		if (ts.isBlock(current) || ts.isSourceFile(current) || ts.isCaseClause(current) || ts.isDefaultClause(current)) {
			const statements: readonly ts.Statement[] = current.statements
			const index = statements.indexOf(child as ts.Statement)
			if (statements.slice(0, Math.max(index, 0)).some((statement) => isEarlyExit(statement, checker))) return true
		}
		if (ts.isSourceFile(current)) break
	}
	return false
}

/** `identifier` is a value read, not a property name, a declared name or a type. */
function isValueRead(identifier: ts.Identifier): boolean {
	const parent = identifier.parent
	if (ts.isShorthandPropertyAssignment(parent)) return true
	if ((parent as { readonly name?: ts.Node }).name === identifier) return false
	if (ts.isQualifiedName(parent) || ts.isTypeOfExpression(parent) || (ts.isBindingElement(parent) && parent.propertyName === identifier)) return false
	for (let current: ts.Node = parent; !ts.isSourceFile(current); current = current.parent) {
		if (ts.isTypeNode(current)) return false
		if (ts.isStatement(current) && !ts.isBlock(current)) break
	}
	return true
}

/** Browser-only globals that the cleanup of `call` reads without a server check, in order. */
function unguardedBrowserApis(call: ts.CallExpression, checker: ts.TypeChecker): string[] {
	const release = call.arguments[0]
	if (!release) return []
	const found: string[] = []
	const visit = (node: ts.Node): void => {
		if (ts.isIdentifier(node) && browserGlobals.has(node.text) && isValueRead(node) && !valueSymbol(checker, node) && !guarded(node, checker)) {
			if (!found.includes(node.text)) found.push(node.text)
		}
		ts.forEachChild(node, visit)
	}
	visit(release)
	return found
}

/**
 * Whether the `onCleanup` call of a component's script runs during SSR: at the top level of the
 * setup (before the browser continuation), inside `effect` or `computed`, or in a function of the
 * setup that runs during SSR. `onMounted`, any other callback (an event listener, a timer, a
 * promise) and the functions used only from the browser do not; in doubt, it does not either.
 */
function runsDuringSsr(call: ts.CallExpression, split: number | undefined, zones: () => ReadonlyMap<string, SetupFunctionZone>): boolean {
	for (let current: ts.Node = call.parent; ; current = current.parent) {
		if (ts.isSourceFile(current)) return true
		if (ts.isClassLike(current) || ts.isClassStaticBlockDeclaration(current)) return false
		if (current.parent && ts.isSourceFile(current.parent) && split !== undefined && current.parent.statements.indexOf(current as ts.Statement) >= split) return false
		if (!isFunctionScope(current)) continue
		const { node, parent } = unwrapParent(current)
		if (ts.isCallExpression(parent) && parent.arguments.includes(node as ts.Expression)) {
			const name = calleeName(parent)
			// Their first run happens during SSR, at the top level that owns them.
			if (name === 'effect' || name === 'computed') continue
			return false
		}
		const declared = ts.isFunctionDeclaration(current) && current.name && current.parent && ts.isSourceFile(current.parent) ? current.name.text : ts.isVariableDeclaration(parent) && ts.isIdentifier(parent.name) && parent.initializer === node && ts.isVariableDeclarationList(parent.parent) && ts.isVariableStatement(parent.parent.parent) && ts.isSourceFile(parent.parent.parent.parent) ? parent.name.text : undefined
		return declared !== undefined && zones().get(declared) === 'shared'
	}
}

function scriptFile(filename: string, script: SfcSection): ts.SourceFile {
	return ts.createSourceFile(`${filename}.ts`, script.content, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS)
}

/**
 * Misuses of `onCleanup` in the `<script>` of a component, as warnings (errors in 2.0):
 *
 * - `MEEK128`: a cleanup that also runs during SSR (at the top level of the setup, in `effect` or
 *   `computed`, or in a setup function used during SSR, such as a composable called from the top
 *   level) and reads a global of {@link browserOnlyGlobals} without a server check (`typeof
 *   window`, `import.meta.env.SSR` or an early return). The names are resolved with the checker,
 *   so a local `window` is not the global;
 * - `MEEK129`: `onCleanup` after an `await` of its own async function, such as `onMounted(async …)`.
 */
export function componentCleanupDiagnostics(source: string, filename: string): CompileDiagnostic[] {
	if (!source.includes('onCleanup')) return []
	let script: SfcSection
	try {
		script = parseSfc(source, filename).script
	} catch {
		return []
	}
	if (script.implicit || !script.content.includes('onCleanup')) return []
	const file = scriptFile(filename, script)
	const checker = isolatedChecker(file)
	let split: number | undefined
	try {
		split = analyzeComposables(file).split
	} catch {
		split = undefined
	}
	let zones: ReadonlyMap<string, SetupFunctionZone> | undefined
	const zonesOf = (): ReadonlyMap<string, SetupFunctionZone> => {
		if (zones) return zones
		try {
			zones = setupFunctionZones(createVirtualComponent(source, filename, { registry: [], tolerant: true }))
		} catch {
			zones = new Map()
		}
		return zones
	}
	const diagnostics: CompileDiagnostic[] = []
	for (const call of cleanupCalls(file, checker)) {
		const offset = script.contentStart + call.expression.getStart(file)
		if (afterAwait(call)) {
			diagnostics.push({ code: 'MEEK129', message: cleanupAfterAwaitMessage, filename, location: locate(source, offset), severity: 'warning' })
			continue
		}
		const apis = unguardedBrowserApis(call, checker)
		if (apis.length && runsDuringSsr(call, split, zonesOf)) {
			diagnostics.push({ code: 'MEEK128', message: cleanupBrowserApiMessage(apis), filename, location: locate(source, offset), severity: 'warning' })
		}
	}
	return diagnostics
}

/**
 * Misuses of `onCleanup` in a TypeScript module of the application, as warnings: `MEEK130` for a
 * call while the module is evaluated (its top level, outside any function) and `MEEK129` after an
 * `await` of its own async function.
 */
export function moduleCleanupDiagnostics(text: string, filename: string): CompileDiagnostic[] {
	if (!text.includes('onCleanup')) return []
	const file = ts.createSourceFile(filename, text, ts.ScriptTarget.Latest, true, /\.[cm]?js$/.test(filename) ? ts.ScriptKind.JS : ts.ScriptKind.TS)
	const checker = isolatedChecker(file)
	const diagnostics: CompileDiagnostic[] = []
	for (const call of cleanupCalls(file, checker)) {
		const offset = call.expression.getStart(file)
		let outside = true
		for (let current = call.parent; !ts.isSourceFile(current); current = current.parent) {
			if (isFunctionScope(current) || ts.isClassLike(current)) {
				outside = false
				break
			}
		}
		if (outside) diagnostics.push({ code: 'MEEK130', message: cleanupOutsideRootMessage, filename, location: locate(text, offset), severity: 'warning' })
		else if (afterAwait(call)) diagnostics.push({ code: 'MEEK129', message: cleanupAfterAwaitMessage, filename, location: locate(text, offset), severity: 'warning' })
	}
	return diagnostics
}

/** An edit of the source: replace `[start, end)` with `text`. */
export interface CleanupEdit {
	readonly start: number
	readonly end: number
	readonly text: string
}

/** A quick fix of `MEEK128`: its title and the edits of the `.meeko` source. */
export interface CleanupFix {
	readonly title: string
	readonly edits: readonly CleanupEdit[]
}

/** Names that `node` reads as values. */
function readNames(node: ts.Node): Set<string> {
	const names = new Set<string>()
	const visit = (current: ts.Node): void => {
		if (ts.isIdentifier(current) && isValueRead(current)) names.add(current.text)
		ts.forEachChild(current, visit)
	}
	visit(node)
	return names
}

function bindingNames(name: ts.BindingName, names: Set<string>): void {
	if (ts.isIdentifier(name)) names.add(name.text)
	else for (const element of name.elements) if (!ts.isOmittedExpression(element)) bindingNames(element.name, names)
}

/** Names declared directly in `body` or as parameters of `callback`. */
function declaredNames(callback: ts.ArrowFunction | ts.FunctionExpression, body: ts.Block): Set<string> {
	const names = new Set<string>()
	for (const parameter of callback.parameters) bindingNames(parameter.name, names)
	for (const statement of body.statements) {
		if (ts.isVariableStatement(statement)) for (const declaration of statement.declarationList.declarations) bindingNames(declaration.name, names)
		else if ((ts.isFunctionDeclaration(statement) || ts.isClassDeclaration(statement)) && statement.name) names.add(statement.name.text)
	}
	return names
}

/** Indentation of the line that contains `offset`. */
function lineIndent(text: string, offset: number): string {
	const lineStart = text.lastIndexOf('\n', offset - 1) + 1
	return /^[ \t]*/.exec(text.slice(lineStart))![0]
}

/**
 * Quick fixes of the `MEEK128` warning whose `onCleanup` starts at `offset` of the source, when
 * they are safe: the call is a whole statement at the top level of the setup, before the browser
 * continuation. «Mover a `onMounted`» wraps it in `onMounted(() => { … })`; with a top-level
 * `onMounted` whose callback has a block body, «Mover dentro del `onMounted` existente» moves it
 * to the start of that body, before any `await`, unless that body or its parameters declare a name
 * the cleanup reads. The cleanup keeps reading the same top-level names: `onMounted` runs after the
 * setup, once they are all initialized. Otherwise there is no fix, only the warning's explanation.
 */
export function cleanupFixes(source: string, filename: string, offset: number): CleanupFix[] {
	let script: SfcSection
	try {
		script = parseSfc(source, filename).script
	} catch {
		return []
	}
	if (script.implicit) return []
	const file = scriptFile(filename, script)
	let split: number | undefined
	try {
		split = analyzeComposables(file).split
	} catch {
		split = undefined
	}
	const local = offset - script.contentStart
	const index = file.statements.findIndex((statement) => ts.isExpressionStatement(statement) && ts.isCallExpression(statement.expression) && statement.expression.expression.getStart(file) === local)
	const statement = file.statements[index]
	if (!statement || (split !== undefined && index >= split)) return []
	const start = statement.getStart(file)
	const end = statement.getEnd()
	const text = script.content.slice(start, end)
	const indent = lineIndent(script.content, start)
	const unit = /^\t/m.test(script.content) ? '\t' : '  '
	const semicolon = text.trimEnd().endsWith(';') ? ';' : ''
	const newline = source.includes('\r\n') ? '\r\n' : '\n'
	const lines = text.split(/\r?\n/)
	/** The lines of the statement at `prefix`; those after the first lose the statement's own indentation. */
	const placed = (prefix: string): string =>
		lines
			.map((line, at) => {
				if (at === 0) return `${prefix}${line}`
				if (!line.trim()) return ''
				return `${prefix}${line.startsWith(indent) ? line.slice(indent.length) : line.trimStart()}`
			})
			.join(newline)
	const fixes: CleanupFix[] = [
		{
			title: 'Mover a `onMounted`',
			edits: [
				{
					start: script.contentStart + start,
					end: script.contentStart + end,
					text: `onMounted(() => {${newline}${placed(`${indent}${unit}`)}${newline}${indent}})${semicolon}`,
				},
			],
		},
	]
	const reads = readNames(statement)
	for (const candidate of file.statements.slice(0, split)) {
		if (candidate === statement || !ts.isExpressionStatement(candidate) || !ts.isCallExpression(candidate.expression)) continue
		const call = candidate.expression
		const callback = call.arguments[0]
		if (calleeName(call) !== 'onMounted' || !callback || !(ts.isArrowFunction(callback) || ts.isFunctionExpression(callback)) || !callback.body || !ts.isBlock(callback.body)) continue
		const body = callback.body
		const declared = declaredNames(callback, body)
		if ([...reads].some((name) => declared.has(name))) continue
		const first = body.statements[0]
		const outer = lineIndent(script.content, candidate.getStart(file))
		const bodyIndent = first ? lineIndent(script.content, first.getStart(file)) : `${outer}${unit}`
		const insertAt = script.contentStart + body.getStart(file) + 1
		const moved = `${newline}${placed(bodyIndent)}${first ? '' : `${newline}${outer}`}`
		// Remove the whole line(s) of the statement when it owns them.
		const lineStart = script.content.lastIndexOf('\n', start - 1) + 1
		const lineEnd = script.content.indexOf('\n', end)
		const owns = !script.content.slice(lineStart, start).trim() && !script.content.slice(end, lineEnd < 0 ? undefined : lineEnd).trim()
		const removal = owns ? { start: script.contentStart + lineStart, end: script.contentStart + (lineEnd < 0 ? script.content.length : lineEnd + 1) } : { start: script.contentStart + start, end: script.contentStart + end }
		fixes.push({
			title: 'Mover dentro del `onMounted` existente',
			edits: [
				{ start: insertAt, end: insertAt, text: moved },
				{ ...removal, text: '' },
			],
		})
		break
	}
	return fixes
}
