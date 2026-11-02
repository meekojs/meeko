import { build } from 'esbuild'
import { spawnSync } from 'node:child_process'
import { existsSync } from 'node:fs'
import { mkdir, readdir, readFile, rename, rm, writeFile } from 'node:fs/promises'
import { createRequire } from 'node:module'
import { dirname, join, relative, resolve, sep } from 'node:path'
import ts from 'typescript'

// Keep one output module per source module: import.meta.url resources and shared runtime
// state must have the same locations and identities across all public entry points.
const root = resolve(process.argv[2] ?? process.cwd())
const sourceRoot = join(root, 'src')
const outdir = join(root, 'dist')
const config = existsSync(join(root, 'tsconfig.build.json')) ? 'tsconfig.build.json' : 'tsconfig.json'
const requireFromPackage = createRequire(join(root, 'package.json'))
const compilerPackage = requireFromPackage.resolve('typescript/package.json')
const compilerMetadata = JSON.parse(await readFile(compilerPackage, 'utf8'))
const compiler = resolve(dirname(compilerPackage), compilerMetadata.bin.tsc ?? compilerMetadata.bin.tsc6)

async function filesIn(directory) {
	const entries = await readdir(directory, { withFileTypes: true })
	return (await Promise.all(entries.map((entry) => (entry.isDirectory() ? filesIn(join(directory, entry.name)) : [join(directory, entry.name)])))).flat()
}

function sourceFor(specifier, importer) {
	if (!specifier.startsWith('.')) return
	const path = resolve(dirname(importer), specifier.replace(/\.js$/, '.ts'))
	return [path, `${path}.ts`, join(path, 'index.ts')].find((candidate) => candidate.endsWith('.ts') && existsSync(candidate))
}

function outputSpecifier(specifier, importer) {
	const source = sourceFor(specifier, importer)
	if (!source) return
	const path = relative(dirname(importer), source).split(sep).join('/').replace(/\.ts$/, '.js')
	return path.startsWith('.') ? path : `./${path}`
}

// The build goes to a folder beside dist, at the same depth so that source maps stay valid, and only
// what changed moves to dist at the end. Whoever reads dist meanwhile, such as `meeko dev` or an e2e,
// finds complete files, and a build that changes nothing writes nothing.
const building = join(root, '.dist-building')
await rm(building, { recursive: true, force: true, maxRetries: 5 })

// Check types and emit declarations first. JavaScript is emitted exclusively by esbuild.
const result = spawnSync(process.execPath, [compiler, '-p', config, '--emitDeclarationOnly', '--declaration', '--noEmitOnError', '--outDir', building], {
	cwd: root,
	stdio: 'inherit',
	windowsHide: true,
})
if (result.error) throw result.error
if (result.status !== 0) {
	await rm(building, { recursive: true, force: true, maxRetries: 5 })
	process.exit(result.status ?? 1)
}

const sources = (await filesIn(sourceRoot)).filter((file) => file.endsWith('.ts') && !file.endsWith('.d.ts'))
// esbuild resolves extensionless local imports; marking each resolved module external
// preserves module boundaries while writing explicit ESM extensions for Node consumers.
await build({
	absWorkingDir: root,
	entryPoints: sources,
	outbase: sourceRoot,
	outdir: building,
	bundle: true,
	packages: 'external',
	platform: 'neutral',
	format: 'esm',
	target: 'es2022',
	sourcemap: true,
	sourcesContent: true,
	plugins: [
		{
			name: 'preserve-local-modules',
			setup(context) {
				context.onResolve({ filter: /^\./ }, (args) => {
					const path = outputSpecifier(args.path, args.importer)
					if (path) return { path, external: true }
				})
			},
		},
	],
})

// Bundler resolution permits extensionless declarations. Published declarations must
// also work in strict NodeNext consumers, so rewrite only AST module specifiers.
for (const file of (await filesIn(building)).filter((file) => file.endsWith('.d.ts'))) {
	const sourceFile = join(sourceRoot, relative(building, file).replace(/\.d\.ts$/, '.ts'))
	const text = await readFile(file, 'utf8')
	const ast = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true)
	const edits = []
	function visit(node) {
		if (ts.isStringLiteral(node) && (((ts.isImportDeclaration(node.parent) || ts.isExportDeclaration(node.parent)) && node.parent.moduleSpecifier === node) || (ts.isLiteralTypeNode(node.parent) && ts.isImportTypeNode(node.parent.parent)) || (ts.isModuleDeclaration(node.parent) && node.text.startsWith('.')))) {
			const replacement = outputSpecifier(node.text, sourceFile)
			if (replacement) edits.push({ start: node.getStart(ast) + 1, end: node.end - 1, replacement })
		}
		ts.forEachChild(node, visit)
	}
	visit(ast)
	let output = text
	for (const edit of edits.sort((a, b) => b.start - a.start)) output = output.slice(0, edit.start) + edit.replacement + output.slice(edit.end)
	if (output !== text) await writeFile(file, output)
}

/** Windows refuses a rename over a file that something holds open for a moment. */
async function moveWithRetries(from, to) {
	for (let attempt = 0; ; attempt++) {
		try {
			return await rename(from, to)
		} catch (error) {
			if (attempt >= 20 || !['EPERM', 'EBUSY', 'EACCES'].includes(error.code)) throw error
			await new Promise((done) => setTimeout(done, 50 * (attempt + 1)))
		}
	}
}

// A rename replaces each file at once; a file that did not change keeps its time.
await mkdir(outdir, { recursive: true })
for (const file of await filesIn(building)) {
	const target = join(outdir, relative(building, file))
	const previous = await readFile(target).catch(() => undefined)
	if (previous?.equals(await readFile(file))) continue
	await mkdir(dirname(target), { recursive: true })
	await moveWithRetries(file, target)
}
await rm(building, { recursive: true, force: true, maxRetries: 5 })

// Delete stale outputs only after successful compilation. dist is a fixed child of root.
const expected = new Set(
	sources.flatMap((file) => {
		const base = join(outdir, relative(sourceRoot, file).replace(/\.ts$/, ''))
		return [`${base}.js`, `${base}.js.map`, `${base}.d.ts`]
	}),
)
for (const file of await filesIn(outdir)) {
	if (/\.(?:js(?:\.map)?|d\.ts)$/.test(file) && !file.includes(`${sep}components${sep}`) && !expected.has(file)) await rm(file)
}
console.log(`Built ${sources.length} ESM modules and declarations in ${relative(process.cwd(), outdir) || 'dist'}`)
