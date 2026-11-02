import ts from '@typescript/typescript6'
import { mkdir, readdir, readFile, rm, writeFile } from 'node:fs/promises'
import { dirname, isAbsolute, join, relative, resolve, sep } from 'node:path'

import type { ApiEndpoint, RpcEndpoint } from '../server/runtime/discovery'

import { discoverAutoImports } from '../autoimports/registry'
import { autoImportCompilerHost, autoImportSourceReader } from '../autoimports/typescript'
import { discoverServerManifest } from '../server/api/manifest-discovery'
import { resolveProjectAliases, withAliasPaths } from './aliases'
import { resolveConfigSources } from './config'
import { generateSocketContracts } from './socket-contracts-generate'
import { standardSchemaTypes } from './standard-schema-types'

export interface GeneratedServerContracts {
	readonly types: string
	readonly manifest: string
	readonly apiCount: number
	readonly rpcCount: number
}

async function writeIfChanged(file: string, source: string): Promise<void> {
	try {
		if ((await readFile(file, 'utf8')) === source) return
	} catch (error) {
		if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
	}
	await writeFile(file, source, 'utf8')
}

type Kind = 'api' | 'rpc'
type Imports = Map<string, { file: string; exported: string }>
/** Imports of packages (`valibot`, `zod`…) by their local name: a composed schema can use them. */
type PackageImports = Map<string, { specifier: string; exported: string }>
type ReadSource = (file: string) => string | undefined

/** Folder of `.meeko/types` with the modules of the schemas composed inline in a contract. */
const composedSchemasDirectory = 'contract-schemas'
/** Where the rule and the composed schemas are documented; contract errors point to it. */
const publicSchemasGuide = 'véase docs/framework.md#schemas-públicos'

function inside(parent: string, child: string): boolean {
	const path = relative(parent, child)
	return path === '' || (path !== '..' && !path.startsWith(`..${sep}`) && !isAbsolute(path))
}

function optionsFor(root: string): ts.CompilerOptions {
	const config = ts.findConfigFile(root, ts.sys.fileExists, 'tsconfig.json')
	if (!config) return { module: ts.ModuleKind.ESNext, moduleResolution: ts.ModuleResolutionKind.Bundler, target: ts.ScriptTarget.ES2022, skipLibCheck: true }
	const loaded = ts.readConfigFile(config, ts.sys.readFile)
	if (loaded.error) throw new Error(ts.flattenDiagnosticMessageText(loaded.error.messageText, '\n'))
	return ts.parseJsonConfigFileContent(loaded.config, ts.sys, dirname(config)).options
}

function resolvedImport(specifier: string, importer: string, options: ts.CompilerOptions): string | undefined {
	return ts.resolveModuleName(specifier, importer, options, ts.sys).resolvedModule?.resolvedFileName
}

function importMap(file: ts.SourceFile, sharedRoot: string, options: ts.CompilerOptions): Imports {
	const imports: Imports = new Map()
	for (const statement of file.statements) {
		if (!ts.isImportDeclaration(statement) || !ts.isStringLiteral(statement.moduleSpecifier)) continue
		const specifier = statement.moduleSpecifier.text
		const target = resolvedImport(specifier, file.fileName, options)
		if (!target || !inside(sharedRoot, target)) continue
		const clause = statement.importClause
		if (!clause) continue
		if (clause.name) imports.set(clause.name.text, { file: target, exported: 'default' })
		if (clause.namedBindings && ts.isNamedImports(clause.namedBindings)) {
			for (const element of clause.namedBindings.elements) imports.set(element.name.text, { file: target, exported: element.propertyName?.text ?? element.name.text })
		}
		if (clause.namedBindings && ts.isNamespaceImport(clause.namedBindings)) imports.set(clause.namedBindings.name.text, { file: target, exported: '*' })
	}
	return imports
}

/** Value imports of packages, outside the project or in its `node_modules`, by local name. */
function packageImportMap(file: ts.SourceFile, root: string, options: ts.CompilerOptions): PackageImports {
	const imports: PackageImports = new Map()
	for (const statement of file.statements) {
		if (!ts.isImportDeclaration(statement) || !ts.isStringLiteral(statement.moduleSpecifier)) continue
		const clause = statement.importClause
		if (!clause || clause.isTypeOnly) continue
		const specifier = statement.moduleSpecifier.text
		if (specifier.startsWith('.')) continue
		const target = resolvedImport(specifier, file.fileName, options)
		if (!target || (inside(root, target) && !relative(root, target).split(sep).includes('node_modules'))) continue
		if (clause.name) imports.set(clause.name.text, { specifier, exported: 'default' })
		if (clause.namedBindings && ts.isNamedImports(clause.namedBindings)) {
			for (const element of clause.namedBindings.elements) {
				if (!element.isTypeOnly) imports.set(element.name.text, { specifier, exported: element.propertyName?.text ?? element.name.text })
			}
		}
		if (clause.namedBindings && ts.isNamespaceImport(clause.namedBindings)) imports.set(clause.namedBindings.name.text, { specifier, exported: '*' })
	}
	return imports
}

/** Specifier of `file` from a generated module in `fromDir`, with the extension that ESM resolves. */
function generatedSpecifier(fromDir: string, file: string): string {
	const target = relative(fromDir, file)
		.replaceAll('\\', '/')
		.replace(/\.(?:ts|mts|cts)$/, (suffix) => (suffix === '.mts' ? '.mjs' : suffix === '.cts' ? '.cjs' : '.js'))
	return target.startsWith('.') ? target : `./${target}`
}

/** Import statement that gives `local` the same binding as in the handler. */
function importLine(local: string, exported: string, specifier: string): string {
	const from = JSON.stringify(specifier)
	if (exported === '*') return `import * as ${local} from ${from};`
	if (exported === 'default') return `import ${local} from ${from};`
	return `import { ${exported === local ? local : `${exported} as ${local}`} } from ${from};`
}

const literalKinds = new Set([ts.SyntaxKind.StringLiteral, ts.SyntaxKind.NumericLiteral, ts.SyntaxKind.BigIntLiteral, ts.SyntaxKind.NoSubstitutionTemplateLiteral, ts.SyntaxKind.RegularExpressionLiteral, ts.SyntaxKind.TrueKeyword, ts.SyntaxKind.FalseKeyword, ts.SyntaxKind.NullKeyword])

/**
 * Names that a composed schema reads (`v` and `itemSchema` in `v.array(itemSchema)`), or why it
 * is not a simple composition: only calls, member reads, literals, arrays and object literals, so
 * that the expression means the same in a module of its own.
 */
function composedNames(expression: ts.Expression): { names: Set<string> } | { reason: string } {
	const names = new Set<string>()
	let reason: string | undefined
	const fail = (text: string): void => {
		reason ??= text
	}
	const visit = (node: ts.Expression): void => {
		if (reason) return
		if (ts.isIdentifier(node)) {
			if (node.text !== 'undefined') names.add(node.text)
		} else if (ts.isPropertyAccessExpression(node)) {
			if (node.questionDotToken) fail('usa ?.')
			visit(node.expression)
		} else if (ts.isCallExpression(node)) {
			if (node.typeArguments?.length) fail('pasa argumentos de tipo a una llamada')
			if (node.questionDotToken) fail('usa ?.')
			visit(node.expression)
			for (const argument of node.arguments) visit(ts.isSpreadElement(argument) ? argument.expression : argument)
		} else if (ts.isParenthesizedExpression(node)) {
			visit(node.expression)
		} else if (ts.isAsExpression(node)) {
			if (!ts.isTypeReferenceNode(node.type) || !ts.isIdentifier(node.type.typeName) || node.type.typeName.text !== 'const') fail('usa una aserción de tipo distinta de as const')
			visit(node.expression)
		} else if (ts.isArrayLiteralExpression(node)) {
			for (const element of node.elements) visit(ts.isSpreadElement(element) ? element.expression : element)
		} else if (ts.isObjectLiteralExpression(node)) {
			for (const property of node.properties) {
				if (ts.isPropertyAssignment(property) && !ts.isComputedPropertyName(property.name)) visit(property.initializer)
				else if (ts.isShorthandPropertyAssignment(property)) visit(property.name)
				else if (ts.isSpreadAssignment(property)) visit(property.expression)
				else fail('contiene un método o una propiedad calculada')
			}
		} else if (ts.isPrefixUnaryExpression(node) && (node.operator === ts.SyntaxKind.MinusToken || node.operator === ts.SyntaxKind.PlusToken)) {
			// `v.minValue(-1)`: a signed number.
			if (!ts.isNumericLiteral(node.operand) && !ts.isBigIntLiteral(node.operand)) fail('contiene un operador')
		} else if (!literalKinds.has(node.kind)) {
			fail(ts.isArrowFunction(node) || ts.isFunctionExpression(node) ? 'contiene una función' : 'contiene código que no es una llamada, una propiedad ni un literal')
		}
	}
	visit(expression)
	return reason === undefined ? { names } : { reason }
}

function objectProperty(object: ts.ObjectLiteralExpression, name: string): ts.Expression | undefined {
	const property = object.properties.find((candidate) => {
		if (!ts.isPropertyAssignment(candidate) && !ts.isShorthandPropertyAssignment(candidate)) return false
		return candidate.name.getText(object.getSourceFile()).replace(/^['"]|['"]$/g, '') === name
	})
	if (!property) return undefined
	if (ts.isPropertyAssignment(property)) return property.initializer
	return ts.isShorthandPropertyAssignment(property) ? property.name : undefined
}

function definition(file: ts.SourceFile, kind: Kind): ts.ObjectLiteralExpression {
	const assignment = file.statements.find((statement): statement is ts.ExportAssignment => ts.isExportAssignment(statement) && !statement.isExportEquals)
	const expression = assignment?.expression
	const name = kind === 'api' ? 'defineApiRoute' : 'defineRpc'
	if (!expression || !ts.isCallExpression(expression) || !ts.isIdentifier(expression.expression) || expression.expression.text !== name || !expression.arguments[0] || !ts.isObjectLiteralExpression(expression.arguments[0])) {
		throw new Error(`${file.fileName}: el contrato público de ${kind.toUpperCase()} requiere export default ${name}({...})`)
	}
	return expression.arguments[0]
}

/** Where a contract reads its schemas and collects the modules of the composed ones. */
interface SchemaScope {
	readonly file: ts.SourceFile
	readonly imports: Imports
	readonly packages: PackageImports
	readonly checker: ts.TypeChecker
	readonly root: string
	readonly sharedRoot: string
	readonly options: ts.CompilerOptions
	readonly outputDir: string
	readonly read: ReadSource
	/** Name of the endpoint in the generated module names (`rpc.users.list`). */
	readonly endpoint: string
	/** Modules of composed schemas, by file name, that this run writes. */
	readonly composed: Map<string, string>
}

/**
 * Type of a public schema of a contract. The generator never runs a handler: the client types
 * name the schema by its module, so it must live in `shared/`, which the browser may import and
 * which cannot carry server code. A simple composition of `shared/` schemas with package
 * functions, like `v.array(itemSchema)`, is copied with its imports to a module of `.meeko/types`.
 */
function publicSchema(expression: ts.Expression | undefined, label: string, scope: SchemaScope): string | undefined {
	if (!expression) return undefined
	const { file, imports, checker, root, sharedRoot, options, outputDir, read } = scope
	let local: string | undefined
	let member: string | undefined
	if (ts.isIdentifier(expression)) local = expression.text
	else if (ts.isPropertyAccessExpression(expression) && ts.isIdentifier(expression.expression) && imports.has(expression.expression.text)) {
		local = expression.expression.text
		member = expression.name.text
	}
	const imported = local === undefined ? undefined : imports.get(local)
	if (!imported) {
		if (local !== undefined && !scope.packages.has(local)) {
			throw new Error(`${file.fileName}: ${label} debe venir de shared/: ${local} no se importa de un archivo de shared/; exporte allí el schema e impórtelo en el contrato (${publicSchemasGuide})`)
		}
		return composedSchema(expression, label, scope)
	}
	const exported = imported.exported === '*' ? member : imported.exported
	if (!exported || (imported.exported !== '*' && member)) throw new Error(`${file.fileName}: ${label} debe referenciar un único export de shared/ (${publicSchemasGuide})`)
	standardSchemaTypes(expression, checker, () => new Error(`${file.fileName}: ${label} debe exponer tipos de entrada y salida de Standard Schema concretos`))
	validateSharedGraph(imported.file, root, sharedRoot, options, new Set(), read)
	return `typeof import(${JSON.stringify(generatedSpecifier(outputDir, imported.file))})[${JSON.stringify(exported)}]`
}

/** A schema composed in the contract (`v.array(itemSchema)`), typed through a generated module. */
function composedSchema(expression: ts.Expression, label: string, scope: SchemaScope): string {
	const { file, imports, packages, checker, root, sharedRoot, options, outputDir, read } = scope
	const example = `${label}: v.array(itemSchema), con itemSchema importado de shared/`
	const found = composedNames(expression)
	if ('reason' in found) {
		throw new Error(`${file.fileName}: ${label} debe ser un schema importado de shared/ o una composición simple de ellos (${example}); esta expresión ${found.reason}. Defina el schema en shared/, expórtelo e impórtelo en el contrato (${publicSchemasGuide})`)
	}
	const directory = join(outputDir, composedSchemasDirectory)
	const lines: string[] = []
	const seen = new Set<string>()
	for (const name of found.names) {
		const shared = imports.get(name)
		const external = packages.get(name)
		if (shared) {
			validateSharedGraph(shared.file, root, sharedRoot, options, seen, read)
			lines.push(importLine(name, shared.exported, generatedSpecifier(directory, shared.file)))
		} else if (external) {
			lines.push(importLine(name, external.exported, external.specifier))
		} else {
			throw new Error(`${file.fileName}: ${label} debe venir de shared/: ${name} no se importa de shared/ ni de un paquete, y una composición sólo combina schemas de shared/ con funciones de paquetes como valibot (${example}; ${publicSchemasGuide})`)
		}
	}
	standardSchemaTypes(expression, checker, () => new Error(`${file.fileName}: ${label} debe exponer tipos de entrada y salida de Standard Schema concretos`))
	const name = `${scope.endpoint}.${label}`.replace(/[^\w.-]/g, '_')
	scope.composed.set(
		`${name}.ts`,
		[
			`// Generated by Meeko from ${relative(root, file.fileName).replaceAll('\\', '/')} (${label}). Only its type is read; it never runs.`,
			...lines.sort(),
			`export const schema = ${expression.getText(file)};`,
			'',
		].join('\n'),
	)
	return `typeof import(${JSON.stringify(generatedSpecifier(outputDir, join(directory, `${name}.ts`)))})["schema"]`
}

function schemaInputType(expression: ts.Expression, checker: ts.TypeChecker, invalid: () => Error): ts.Type {
	return standardSchemaTypes(expression, checker, invalid).input
}

function validatePathParams(expression: ts.Expression, pathname: string, checker: ts.TypeChecker, file: ts.SourceFile): void {
	const expected = [...pathname.matchAll(/\[(?:\.\.\.)?([A-Za-z_$][\w$]*)\]/g)].map((match) => match[1]!)
	const invalid = () => new Error(`${file.fileName}: params debe contener exactamente los parámetros de la ruta, como cadenas de URL obligatorias`)
	const inputType = schemaInputType(expression, checker, invalid)
	const stringType = checker.getStringType()
	for (const variant of inputType.isUnion() ? inputType.types : [inputType]) {
		if (variant.flags & (ts.TypeFlags.Any | ts.TypeFlags.Unknown | ts.TypeFlags.Never) || checker.getIndexTypeOfType(variant, ts.IndexKind.String)) throw invalid()
		const fields = checker.getPropertiesOfType(variant)
		if (fields.length !== expected.length || fields.some((field) => !expected.includes(field.getName()))) throw invalid()
		for (const name of expected) {
			const field = checker.getPropertyOfType(variant, name)
			if (!field || field.flags & ts.SymbolFlags.Optional) throw invalid()
			const value = checker.getTypeOfSymbolAtLocation(field, expression)
			if (value.flags & (ts.TypeFlags.Any | ts.TypeFlags.Unknown | ts.TypeFlags.Never) || !checker.isTypeAssignableTo(value, stringType)) throw invalid()
		}
	}
}

function validateQuery(expression: ts.Expression, checker: ts.TypeChecker, file: ts.SourceFile): void {
	const invalid = () => new Error(`${file.fileName}: los valores de query deben ser cadenas de URL o listas de cadenas de URL`)
	const inputType = schemaInputType(expression, checker, invalid)
	const stringType = checker.getStringType()
	const validValue = (value: ts.Type, arrayAllowed: boolean): boolean => {
		if (value.flags & (ts.TypeFlags.Any | ts.TypeFlags.Unknown | ts.TypeFlags.Never)) return false
		if (value.isUnion()) return value.types.every((part) => validValue(part, arrayAllowed))
		if (value.flags & ts.TypeFlags.Undefined) return true
		if (checker.isTypeAssignableTo(value, stringType)) return true
		if (arrayAllowed && (checker.isArrayType(value) || checker.isTupleType(value))) {
			const item = checker.getIndexTypeOfType(value, ts.IndexKind.Number)
			return !!item && validValue(item, false)
		}
		return false
	}
	for (const variant of inputType.isUnion() ? inputType.types : [inputType]) {
		if (!(variant.flags & (ts.TypeFlags.Object | ts.TypeFlags.Intersection)) || checker.isArrayType(variant) || checker.isTupleType(variant)) throw invalid()
		for (const field of checker.getPropertiesOfType(variant)) {
			if (!validValue(checker.getTypeOfSymbolAtLocation(field, expression), true)) throw invalid()
		}
		const indexValue = checker.getIndexTypeOfType(variant, ts.IndexKind.String)
		if (indexValue && !validValue(indexValue, true)) throw invalid()
	}
}

function validateSharedGraph(file: string, root: string, sharedRoot: string, options: ts.CompilerOptions, seen: Set<string>, read: ReadSource): void {
	if (seen.has(file)) return
	seen.add(file)
	if (!inside(sharedRoot, file)) throw new Error(`${file}: una dependencia de un schema público sale de shared/`)
	// Autoimported dependencies appear as the imports that the Vite transform adds.
	const source = read(file)
	if (source === undefined) throw new Error(`${file}: no se encuentra una dependencia de un schema público`)
	const ast = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true)
	const checkDependency = (specifier: string): void => {
		const target = resolvedImport(specifier, file, options)
		if (!target) throw new Error(`${file}: no se puede resolver la dependencia ${specifier} de un schema público`)
		if (inside(root, target) && !relative(root, target).split(sep).includes('node_modules')) validateSharedGraph(target, root, sharedRoot, options, seen, read)
	}
	for (const statement of ast.statements) {
		if (!ts.isImportDeclaration(statement) && !ts.isExportDeclaration(statement)) continue
		const literal = statement.moduleSpecifier
		if (!literal || !ts.isStringLiteral(literal)) continue
		checkDependency(literal.text)
	}
	const visit = (node: ts.Node): void => {
		if (ts.isImportTypeNode(node) && ts.isLiteralTypeNode(node.argument) && ts.isStringLiteral(node.argument.literal)) checkDependency(node.argument.literal.text)
		ts.forEachChild(node, visit)
	}
	visit(ast)
}

function shapeFor(endpoint: ApiEndpoint | RpcEndpoint, checker: ts.TypeChecker, program: ts.Program, root: string, options: ts.CompilerOptions, outputDir: string, read: ReadSource, composed: Map<string, string>): { type: string; contentType?: 'response' } {
	const file = program.getSourceFile(endpoint.file)
	if (!file) throw new Error(`No se encuentra el handler: ${endpoint.file}`)
	const sharedRoot = join(root, 'shared')
	const kind: Kind = endpoint.kind
	const contract = definition(file, kind)
	const scope: SchemaScope = {
		file,
		imports: importMap(file, sharedRoot, options),
		packages: packageImportMap(file, root, options),
		checker,
		root,
		sharedRoot,
		options,
		outputDir,
		read,
		composed,
		endpoint: endpoint.kind === 'rpc' ? `rpc.${endpoint.id}` : `api.${endpoint.clientKey}.${endpoint.method.toLowerCase()}`,
	}
	const schema = (name: string): string | undefined => publicSchema(objectProperty(contract, name), name, scope)
	if (kind === 'rpc') {
		const input = schema('input')
		const output = schema('output')
		if (!input || !output) throw new Error(`${file.fileName}: el RPC requiere schemas públicos input y output`)
		return { type: `import("@meekojs/meeko/framework").RpcOperation<__Input<${input}>, __Output<${output}>>` }
	}
	const params = schema('params')
	if (params && !endpoint.pathname.includes('[')) throw new Error(`${file.fileName}: una ruta de API estática no puede declarar params`)
	if (params) validatePathParams(objectProperty(contract, 'params')!, endpoint.pathname, checker, file)
	const query = schema('query')
	if (query) validateQuery(objectProperty(contract, 'query')!, checker, file)
	const body = schema('body')
	const content = objectProperty(contract, 'contentType')
	if (content && (!ts.isStringLiteral(content) || (content.text !== 'json' && content.text !== 'response'))) throw new Error(`${file.fileName}: contentType debe ser el literal estático "json" o "response"`)
	const responseType = content && ts.isStringLiteral(content) && content.text === 'response'
	const status = successStatus(objectProperty(contract, 'status'), file)
	if (status !== undefined && responseType) throw new Error(`${file.fileName}: status no se combina con contentType: "response"; ese handler devuelve su propio Response con su estado`)
	const noContent = status === 204
	if (noContent && objectProperty(contract, 'response')) throw new Error(`${file.fileName}: status 204 responde sin cuerpo y no admite un schema response`)
	const response = schema('response')
	if (!responseType && !noContent && !response) throw new Error(`${file.fileName}: la API requiere un schema público response`)
	if (endpoint.pathname.includes('[') && !params) throw new Error(`${file.fileName}: una ruta de API dinámica requiere un schema público params`)
	const output = responseType ? 'Response' : noContent ? 'undefined' : `__Output<${response}>`
	return {
		type: `import("@meekojs/meeko/framework").ApiOperation<${params ? `__Input<${params}>` : 'undefined'}, ${query ? `__Input<${query}>` : 'undefined'}, ${body ? `__Input<${body}>` : 'undefined'}, ${output}>`,
		...(responseType ? { contentType: 'response' as const } : {}),
	}
}

/** Writes the modules of the composed schemas and removes those that no contract uses any more. */
async function writeComposedSchemas(directory: string, composed: ReadonlyMap<string, string>): Promise<void> {
	let existing: string[] = []
	try {
		existing = await readdir(directory)
	} catch (error) {
		if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
	}
	for (const name of existing) if (!composed.has(name)) await rm(join(directory, name), { recursive: true, force: true })
	if (!composed.size) {
		await rm(directory, { recursive: true, force: true })
		return
	}
	await mkdir(directory, { recursive: true })
	for (const [name, source] of composed) await writeIfChanged(join(directory, name), source)
}

/** The literal `status` of an API definition; generated clients type a `204` as `undefined`. */
function successStatus(expression: ts.Expression | undefined, file: ts.SourceFile): 200 | 201 | 202 | 204 | undefined {
	if (!expression) return undefined
	const value = ts.isNumericLiteral(expression) ? Number(expression.text) : Number.NaN
	if (value !== 200 && value !== 201 && value !== 202 && value !== 204) throw new Error(`${file.fileName}: status debe ser el literal 200, 201, 202 o 204`)
	return value
}

/** Generate public API/RPC declarations without importing handler modules. */
export async function generateServerContracts(projectRoot: string): Promise<GeneratedServerContracts> {
	const root = resolve(projectRoot)
	await generateSocketContracts(root)
	const discovered = await discoverServerManifest(root)
	const outputDir = join(root, '.meeko', 'types')
	const types = join(outputDir, 'server-contracts.d.ts')
	const manifest = join(root, '.meeko', 'manifests', 'server.json')
	const generatedDir = join(root, '.meeko', 'generated')
	// A schema imported through an alias (`#shared/schemas/auth`) resolves to its file, as in Vite.
	const options = withAliasPaths(optionsFor(root), await resolveProjectAliases(root), 'server')
	const files = [...discovered.api, ...discovered.rpc].map((entry) => entry.file)
	// Handlers and shared schemas are read as Vite runs them, so an autoimported schema
	// resolves to its shared/ file instead of an unknown global.
	const read =
		files.length > 0
			? autoImportSourceReader(
					root,
					await discoverAutoImports(root),
					(await resolveConfigSources(root)).map((source) => source.root),
				)
			: (file: string) => ts.sys.readFile(file)
	const programOptions = { ...options, noEmit: true }
	const program = ts.createProgram({ rootNames: files, options: programOptions, host: autoImportCompilerHost(programOptions, read) })
	const checker = program.getTypeChecker()
	const composed = new Map<string, string>()
	const api = discovered.api.map((endpoint) => ({ endpoint, shape: shapeFor(endpoint, checker, program, root, options, outputDir, read, composed) }))
	const rpc = discovered.rpc.map((endpoint) => ({ endpoint, shape: shapeFor(endpoint, checker, program, root, options, outputDir, read, composed) }))
	const apiMethods = new Map<string, string[]>()
	for (const { endpoint, shape } of api) {
		const methods = apiMethods.get(endpoint.clientKey) ?? []
		methods.push(`${endpoint.method.toLowerCase()}: ${shape.type}`)
		apiMethods.set(endpoint.clientKey, methods)
	}
	const lines = [
		'// Generated by Meeko. Public schemas live in shared/; the ones composed in a contract, in contract-schemas/.',
		'type __Input<S> = S extends { readonly "~standard": { readonly types?: infer T } } ? NonNullable<T> extends { readonly input: infer I } ? I : never : never;',
		'type __Output<S> = S extends { readonly "~standard": { readonly types?: infer T } } ? NonNullable<T> extends { readonly output: infer O } ? O : never : never;',
		'export type ApiContract = {',
		...[...apiMethods].map(([key, methods]) => `  ${JSON.stringify(key)}: { ${methods.join('; ')} };`),
		'};',
		'export type RpcContract = {',
		...rpc.map(({ endpoint, shape }) => `  ${JSON.stringify(endpoint.id)}: ${shape.type};`),
		'};',
		'',
	]
	await mkdir(outputDir, { recursive: true })
	await mkdir(dirname(manifest), { recursive: true })
	await writeComposedSchemas(join(outputDir, composedSchemasDirectory), composed)
	await writeIfChanged(types, lines.join('\n'))
	const publicManifest = { version: 1, api: api.map(({ endpoint, shape }) => ({ clientKey: endpoint.clientKey, pathname: endpoint.pathname, method: endpoint.method, ...(shape.contentType ? { contentType: shape.contentType } : {}) })), rpc: rpc.map(({ endpoint }) => ({ id: endpoint.id, pathname: endpoint.pathname })) }
	await writeIfChanged(manifest, `${JSON.stringify(publicManifest, null, 2)}\n`)
	await mkdir(generatedDir, { recursive: true })
	const clientSource = (server: boolean): string =>
		[
			'// Generated by Meeko. Contains only public route descriptors and shared contract types.',
			`import { createApiClient, createRpcClient${server ? '' : ', createBrowserClientOptions'} } from "@meekojs/meeko/framework";`,
			`import { ${server ? '' : 'createSocketRegistry, '}useSocketChannel, type SocketRegistryOptions } from "@meekojs/meeko/framework";`,
			'import { createUseApi, createUseApiMutation, createUseRpcMutation, createUseRpcQuery } from "@meekojs/meeko/framework";',
			...(server ? ['import { createServerClientOptions, createServerSocketRegistry } from "@meekojs/meeko/server";'] : []),
			'import type { ApiContract, RpcContract } from "../types/server-contracts.js";',
			'import { socketContracts } from "./socket-contracts.js";',
			`const manifest = ${JSON.stringify(publicManifest, null, 2)} as const;`,
			`const options = ${server ? 'createServerClientOptions()' : 'createBrowserClientOptions()'};`,
			'export const api = createApiClient<ApiContract>(manifest, options);',
			'export const rpc = createRpcClient<RpcContract>(manifest, options);',
			// On the server each channel also broadcasts to its rooms through the application's hub.
			`export const socket = ${server ? 'createServerSocketRegistry' : 'createSocketRegistry'}(socketContracts);`,
			'export const useSocket = <K extends keyof typeof socketContracts & string>(name: K, options?: SocketRegistryOptions) => useSocketChannel(socketContracts, name, options);',
			'export const useApi = createUseApi<ApiContract, typeof manifest>(manifest, options);',
			'export const useRpcQuery = createUseRpcQuery<RpcContract>(manifest, options);',
			'export const useRpcMutation = createUseRpcMutation<RpcContract>(manifest, options);',
			'export const useApiMutation = createUseApiMutation<ApiContract, typeof manifest>(manifest, options);',
			'',
		].join('\n')
	await writeIfChanged(join(generatedDir, 'clients.client.ts'), clientSource(false))
	await writeIfChanged(join(generatedDir, 'clients.server.ts'), clientSource(true))
	return { types, manifest, apiCount: api.length, rpcCount: rpc.length }
}
