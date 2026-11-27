// pnpm test:changed: ejecuta sólo las pruebas asociadas a los archivos editados.
//
// Uso: node scripts/test-changed.mjs [--base <ref>] [--list] [--no-build] [--timeout <segundos>] [rutas...]
//   (sin argumentos)  archivos cambiados respecto a HEAD: staged, unstaged y sin seguimiento.
//   --base <ref>      compara con `git merge-base <ref> HEAD` (una rama entera).
//   --list            sólo imprime qué ejecutaría.
//   --no-build        no construye el `dist` que necesiten las pruebas.
//   --max-transitive <n>  tope de pruebas por dependencia transitiva (25); los directos nunca se recortan.
//   --timeout <s>     tope por paquete (por defecto 600 s).
//   rutas             sustituyen a la detección con git.
//
// Cómo decide qué ejecutar, de más a menos preciso:
//   1. Un archivo de prueba (`*.test.ts|mjs`, de primer nivel en `tests/` o `scripts/`) se ejecuta a sí mismo.
//   2. Un archivo de un paquete: las pruebas que lo importan directa o transitivamente (grafo de imports
//      relativos estáticos de `src/`, `tests/` y `scripts/`, analizado con expresiones regulares).
//   3. Respaldo por nombre, porque muchas pruebas ejecutan `dist/cli.js` en vez de importar `src/`: pruebas
//      del mismo paquete cuyo nombre contiene el nombre base del archivo (siempre) o el de su carpeta (sólo si
//      nada más coincidió), y el mapa manual MANUAL_MAP de abajo.
//   4. Sin coincidencias: «sin pruebas asociadas». Nunca se ejecuta la suite completa.
// Los `*.e2e.*` jamás se ejecutan; se listan como omitidos.
//
// Límites conocidos: no sigue imports por nombre de paquete (`@meekojs/meeko`), ni rutas construidas en
// tiempo de ejecución, ni lecturas de archivos (fixtures); un cambio en un paquete del que depende otro no
// lanza las pruebas del dependiente.
import { spawnSync } from 'node:child_process'
import { existsSync, readdirSync, readFileSync } from 'node:fs'
import { basename, dirname, join, posix, relative, resolve, sep } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

/**
 * Mapa manual para casos que ni el grafo ni el nombre resuelven. Clave: ruta (o prefijo de carpeta
 * terminado en `/`) relativa a la raíz; valor: globs (`*` sólo en el nombre) de pruebas a ejecutar.
 */
export const MANUAL_MAP = {
	'packages/meeko/src/cli.ts': ['packages/meeko/tests/cli*.test.ts'],
	'packages/meeko/src/check.ts': ['packages/meeko/tests/check*.test.ts'],
	'packages/meeko/src/build.ts': ['packages/meeko/tests/build*.test.ts'],
	'packages/meeko/src/init.ts': ['packages/meeko/tests/init*.test.ts'],
	'packages/meeko/src/language-server/': ['packages/meeko/tests/language-server*.test.ts'],
}

/** Runners que no se pueden leer del script `test` (el de meeko lo delega en `scripts/run-tests.ts`, que usa `node --import tsx --test`). */
const RUNNER_OVERRIDES = { '@meekojs/meeko': ['node', '--import', 'tsx', '--test', '--test-concurrency=1'] }

const GENERIC_STEMS = new Set(['index', 'types', 'utils', 'util', 'main', 'constants', 'shared', 'core', 'config', 'internal', 'src', 'app', 'tests'])
const SOURCE_EXTENSIONS = ['.ts', '.tsx', '.mts', '.mjs', '.js', '.cjs']
const SKIPPED_DIRECTORIES = new Set(['node_modules', 'dist', '.meeko', '.git', '.turbo', '.dist-building', '.output'])
const TEST_FILE = /\.test\.(?:ts|mjs)$/
const E2E_FILE = /\.e2e\.[cm]?[jt]sx?$/

const toPosix = (path) => path.split(sep).join('/')

/** Archivos (rutas relativas a `root`, con `/`) bajo `directory`, sin carpetas generadas. */
function walk(root, directory, maxDepth = Infinity, depth = 0) {
	const base = join(root, directory)
	if (!existsSync(base)) return []
	const files = []
	for (const entry of readdirSync(base, { withFileTypes: true })) {
		if (entry.isDirectory()) {
			if (SKIPPED_DIRECTORIES.has(entry.name) || depth >= maxDepth) continue
			files.push(...walk(root, posix.join(toPosix(directory), entry.name), maxDepth, depth + 1))
		} else files.push(posix.join(toPosix(directory), entry.name))
	}
	return files
}

/** Tokens del ejecutor de un script `test`: `tsx --test --test-concurrency=1 tests/*.test.ts` → `['tsx', '--test', '--test-concurrency=1']`. */
export function parseRunner(script) {
	for (const segment of script.split('&&')) {
		const tokens = segment.trim().split(/\s+/)
		const index = tokens.indexOf('--test')
		if (index < 0) continue
		const runner = tokens.slice(0, index + 1)
		for (const token of tokens.slice(index + 1)) {
			if (!token.startsWith('--')) break
			runner.push(token)
		}
		return runner
	}
}

/** Paquetes con pruebas: `packages/*` y `apps/*` con runner legible, más `scripts/` como paquete raíz. */
export function discoverPackages(root) {
	const packages = [{ name: '(scripts)', dir: '.', testDirectory: 'scripts', runner: ['node', '--test'] }]
	for (const group of ['packages', 'apps']) {
		if (!existsSync(join(root, group))) continue
		for (const entry of readdirSync(join(root, group), { withFileTypes: true })) {
			const manifest = join(root, group, entry.name, 'package.json')
			if (!entry.isDirectory() || !existsSync(manifest)) continue
			const metadata = JSON.parse(readFileSync(manifest, 'utf8'))
			const runner = RUNNER_OVERRIDES[metadata.name] ?? (metadata.scripts?.test ? parseRunner(metadata.scripts.test) : undefined)
			packages.push({ name: metadata.name ?? entry.name, dir: `${group}/${entry.name}`, testDirectory: `${group}/${entry.name}/tests`, runner })
		}
	}
	return packages
}

/** Imports relativos estáticos de un texto: `from './x'`, `import './x'`, `import('./x')`, `require('./x')`. */
export function importsOf(text) {
	const found = new Set()
	for (const match of text.matchAll(/(?:\bfrom\s*|\bimport\s*\(?\s*|\brequire\s*\(\s*)(['"])(\.{1,2}(?:\/[^'"\n]*)?)\1/g)) found.add(match[2])
	return [...found]
}

/** Archivo de `files` al que apunta `specifier` desde `importer` (extensión `.js`→`.ts`, `.ts`, `.mjs`, `/index`). */
export function resolveImport(specifier, importer, files) {
	const target = posix.normalize(posix.join(posix.dirname(importer), specifier))
	const swapped = target.replace(/\.(?:js|mjs|cjs)$/, '')
	const candidates = [target, ...SOURCE_EXTENSIONS.map((extension) => target + extension), ...SOURCE_EXTENSIONS.map((extension) => swapped + extension), ...SOURCE_EXTENSIONS.map((extension) => `${target}/index${extension}`)]
	return candidates.find((candidate) => files.has(candidate))
}

/** Grafo inverso de imports: archivo → archivos que lo importan. Cubre `src/`, `tests/` y `scripts/` de cada paquete. */
export function buildReverseGraph(root, packages) {
	const directories = new Set(packages.flatMap((pkg) => (pkg.dir === '.' ? ['scripts'] : [`${pkg.dir}/src`, `${pkg.dir}/tests`])))
	const files = new Set([...directories].flatMap((directory) => walk(root, directory).filter((file) => SOURCE_EXTENSIONS.includes(posix.extname(file)))))
	const reverse = new Map()
	for (const file of files) {
		for (const specifier of importsOf(readFileSync(join(root, file), 'utf8'))) {
			const imported = resolveImport(specifier, file, files)
			if (!imported || imported === file) continue
			if (!reverse.has(imported)) reverse.set(imported, new Set())
			reverse.get(imported).add(file)
		}
	}
	return reverse
}

/** Pruebas ejecutables de cada paquete: `*.test.ts|mjs` de primer nivel (como los globs de sus scripts `test`), sin e2e. */
function collectTests(root, packages) {
	const tests = new Map()
	const nested = new Set()
	for (const pkg of packages) {
		const all = walk(root, pkg.testDirectory).filter((file) => TEST_FILE.test(file) && !E2E_FILE.test(file))
		const direct = all.filter((file) => posix.dirname(file) === pkg.testDirectory)
		tests.set(pkg, direct)
		for (const file of all) if (!direct.includes(file)) nested.add(file)
	}
	return { tests, nested }
}

function globToRegExp(glob) {
	return new RegExp(
		`^${glob
			.split('*')
			.map((part) => part.replace(/[.+?^${}()|[\]\\]/g, '\\$&'))
			.join('[^/]*')}$`,
	)
}

/** Nombre base en minúsculas sin ninguna extensión: `Counter.generated.ts` → `counter`. */
function nameOf(file) {
	return posix.basename(file).split('.')[0].toLowerCase()
}

const usable = (stem) => stem.length >= 4 && !GENERIC_STEMS.has(stem)

/**
 * Decide qué pruebas ejecutar para `changed` (rutas relativas a `root`).
 * Devuelve `{ runs: Map<paquete, Map<prueba, Set<motivo>>>, skipped, unmatched }`.
 */
export function mapChanged(root, changed, { maxTransitive = 25 } = {}) {
	const packages = discoverPackages(root)
	const reverse = buildReverseGraph(root, packages)
	const { tests, nested } = collectTests(root, packages)
	const packageOf = (file) => packages.filter((pkg) => pkg.dir !== '.' && file.startsWith(`${pkg.dir}/`)).sort((a, b) => b.dir.length - a.dir.length)[0] ?? (file.startsWith('scripts/') ? packages[0] : undefined)
	const testToPackage = new Map([...tests].flatMap(([pkg, list]) => list.map((file) => [file, pkg])))
	const runs = new Map()
	const skipped = []
	const unmatched = []
	const capped = []
	const add = (test, reason) => {
		const pkg = testToPackage.get(test)
		if (!pkg.runner) return false
		if (!runs.has(pkg)) runs.set(pkg, new Map())
		if (!runs.get(pkg).has(test)) runs.get(pkg).set(test, new Set())
		runs.get(pkg).get(test).add(reason)
		return true
	}

	for (const file of changed) {
		if (E2E_FILE.test(file)) {
			skipped.push({ file, reason: 'e2e: nunca se ejecuta' })
			continue
		}
		if (nested.has(file)) {
			skipped.push({ file, reason: 'prueba fuera del glob de primer nivel del paquete' })
			continue
		}
		if (testToPackage.has(file)) {
			add(file, 'cambiada')
			continue
		}
		if (!existsSync(join(root, file))) {
			unmatched.push({ file, reason: 'eliminado' })
			continue
		}
		const pkg = packageOf(file)
		if (!pkg) {
			unmatched.push({ file, reason: 'fuera de los paquetes con pruebas' })
			continue
		}
		let matched = 0

		// 2. Grafo de imports. Los importadores directos se ejecutan siempre; los transitivos sólo si no son
		// demasiados: un módulo central (config, utilidades) arrastraría casi toda la suite.
		const seen = new Set([file])
		const queue = [file]
		const transitive = []
		while (queue.length) {
			const current = queue.shift()
			for (const importer of reverse.get(current) ?? []) {
				if (seen.has(importer)) continue
				seen.add(importer)
				queue.push(importer)
				if (!testToPackage.has(importer)) continue
				if (current === file) {
					if (add(importer, `${file} (importa)`)) matched++
				} else transitive.push(importer)
			}
		}
		if (transitive.length <= maxTransitive) {
			for (const test of transitive) if (add(test, `${file} (importa transitivo)`)) matched++
		} else capped.push({ file, count: transitive.length })

		// 3. Mapa manual y respaldo por nombre.
		for (const [key, globs] of Object.entries(MANUAL_MAP)) {
			if (key.endsWith('/') ? !file.startsWith(key) : file !== key) continue
			for (const glob of globs) {
				const pattern = globToRegExp(glob)
				for (const test of testToPackage.keys()) if (pattern.test(test) && add(test, `${file} (mapa manual)`)) matched++
			}
		}
		const siblings = (tests.get(pkg) ?? []).filter((test) => testToPackage.get(test) === pkg)
		const stem = nameOf(file)
		if (usable(stem)) for (const test of siblings) if (nameOf(test).includes(stem) && add(test, `${file} (nombre)`)) matched++
		const folder = posix.basename(posix.dirname(file)).toLowerCase()
		if (!matched && usable(folder)) for (const test of siblings) if (nameOf(test).includes(folder) && add(test, `${file} (carpeta)`)) matched++

		if (!matched) unmatched.push({ file, reason: pkg.runner ? 'sin pruebas asociadas' : 'sin pruebas asociadas (el paquete no tiene runner de pruebas)' })
	}
	return { runs, skipped, unmatched, capped, packages }
}

/** ¿Alguna de las pruebas lee el `dist` del paquete? */
export function needsBuild(root, tests) {
	return tests.some((test) => /\bdist\//.test(readFileSync(join(root, test), 'utf8')))
}

function git(root, ...args) {
	const result = spawnSync('git', ['--no-optional-locks', ...args], { cwd: root, encoding: 'utf8', windowsHide: true })
	if (result.status !== 0) throw new Error(`git ${args.join(' ')}: ${result.stderr.trim()}`)
	return result.stdout.split('\n').filter(Boolean)
}

/** Archivos cambiados respecto a HEAD (o al merge-base con `base`), más los sin seguimiento. */
export function changedFiles(root, base) {
	const from = base ? git(root, 'merge-base', base, 'HEAD')[0] : 'HEAD'
	return [...new Set([...git(root, 'diff', '--name-only', from), ...git(root, 'ls-files', '--others', '--exclude-standard', '--', '.')])].sort()
}

export function parseArguments(argv) {
	const options = { base: undefined, list: false, build: true, timeout: 600, maxTransitive: 25, paths: [] }
	for (let index = 0; index < argv.length; index++) {
		const argument = argv[index]
		if (argument === '--list') options.list = true
		else if (argument === '--no-build') options.build = false
		else if (argument === '--base') options.base = argv[++index]
		else if (argument === '--max-transitive') options.maxTransitive = Number(argv[++index])
		else if (argument === '--timeout') options.timeout = Number(argv[++index])
		else if (argument.startsWith('--')) throw new Error(`Opción desconocida: ${argument}`)
		else options.paths.push(argument)
	}
	if (options.base === undefined && argv.includes('--base')) throw new Error('--base necesita una referencia')
	if (!Number.isFinite(options.timeout) || options.timeout <= 0) throw new Error('--timeout necesita un número positivo de segundos')
	return options
}

function describe(runs, skipped, unmatched, capped, root, withBuild) {
	const lines = ['Pruebas a ejecutar:']
	if (!runs.size) lines.push('  (ninguna)')
	for (const [pkg, map] of runs) {
		const build = pkg.dir !== '.' && needsBuild(root, [...map.keys()])
		lines.push(`  ${pkg.dir === '.' ? 'scripts' : pkg.dir} [${pkg.runner.join(' ')}]${build && withBuild ? ' (construye dist antes)' : ''}`)
		for (const [test, reasons] of map) lines.push(`    ${relative(pkg.dir === '.' ? '' : pkg.dir, test) || test}  <- ${[...reasons][0]}${reasons.size > 1 ? ` (+${reasons.size - 1})` : ''}`)
	}
	if (capped.length) lines.push('Dependientes transitivos omitidos por ser demasiados (--max-transitive):', ...capped.map(({ file, count }) => `  ${file}  (${count} pruebas)`))
	if (skipped.length) lines.push('Omitidos:', ...skipped.map(({ file, reason }) => `  ${file}  (${reason})`))
	if (unmatched.length) lines.push('Sin pruebas asociadas:', ...unmatched.map(({ file, reason }) => `  ${file}  (${reason})`))
	return lines
}

function run(command, args, cwd, timeoutSeconds) {
	const result = spawnSync(command, args, {
		cwd,
		stdio: 'inherit',
		windowsHide: true,
		shell: process.platform === 'win32' && command !== process.execPath,
		timeout: timeoutSeconds * 1000,
		killSignal: 'SIGKILL',
		env: { ...process.env, NODE_OPTIONS: [process.env.NODE_OPTIONS, '--max-old-space-size=8192'].filter(Boolean).join(' ') },
	})
	if (result.error) {
		console.error(`  ${command}: ${result.error.code === 'ETIMEDOUT' ? `tiempo agotado (${timeoutSeconds} s)` : result.error.message}`)
		return 1
	}
	return result.status ?? 1
}

export async function main(argv = process.argv.slice(2), root = resolve(dirname(fileURLToPath(import.meta.url)), '..')) {
	const options = parseArguments(argv)
	const changed = options.paths.length ? [...new Set(options.paths.map((path) => toPosix(relative(root, resolve(path)))))].sort() : changedFiles(root, options.base)
	console.log(`Archivos cambiados (${changed.length})${options.base ? ` respecto a ${options.base}` : ''}`)
	if (!changed.length) return 0
	const { runs, skipped, unmatched, capped } = mapChanged(root, changed, { maxTransitive: options.maxTransitive })
	console.log(describe(runs, skipped, unmatched, capped, root, options.build).join('\n'))
	if (options.list) return 0

	const failures = []
	const executed = []
	for (const [pkg, map] of runs) {
		const cwd = join(root, pkg.dir)
		const files = [...map.keys()].map((test) => relative(cwd, join(root, test)))
		const label = pkg.dir === '.' ? 'scripts' : pkg.dir
		if (options.build && pkg.dir !== '.' && needsBuild(root, [...map.keys()])) {
			console.log(`\n> ${label}: pnpm -F ${pkg.name} build`)
			if (run('pnpm', ['-F', pkg.name, 'build'], root, options.timeout) !== 0) {
				failures.push(`${label} (build)`)
				continue
			}
		}
		const [command, ...rest] = pkg.runner
		console.log(`\n> ${label}: ${pkg.runner.join(' ')} ${files.length} archivo(s)`)
		const status = command === 'node' ? run(process.execPath, [...rest, ...files], cwd, options.timeout) : run('pnpm', ['exec', command, ...rest, ...files], cwd, options.timeout)
		executed.push({ label, count: files.length, status })
		if (status !== 0) failures.push(label)
	}

	console.log('\nResumen')
	console.log(`  Archivos cambiados: ${changed.length}`)
	for (const { label, count, status } of executed) console.log(`  ${status === 0 ? 'ok   ' : 'FALLA'} ${label}: ${count} archivo(s) de prueba`)
	console.log(`  Omitidos: ${skipped.length}`)
	console.log(`  Sin pruebas asociadas: ${unmatched.length}${unmatched.length ? ` (${unmatched.map(({ file }) => basename(file)).join(', ')})` : ''}`)
	if (failures.length) console.log(`  Fallos: ${failures.join(', ')}`)
	return failures.length ? 1 : 0
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
	process.exitCode = await main().catch((error) => {
		console.error(error.message)
		return 1
	})
}
