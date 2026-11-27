// Empaqueta la extensión en un VSIX por plataforma, con el ejecutable nativo de TypeScript 7 de
// su destino. Uso: node package-vsix.mjs [--target <os-cpu>] [--skip-build]
import { spawnSync } from 'node:child_process'
import { cpSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { parseArgs } from 'node:util'

import { resolveManifestVersions } from './scripts/resolve-manifest-versions.mjs'
import { setExecutable, zipEntries } from './scripts/vsix-archive.mjs'

/** Destinos con ejecutable nativo de TypeScript 7 y host de extensión de VS Code. */
export const targets = ['win32-x64', 'win32-arm64', 'linux-x64', 'linux-arm64', 'darwin-x64', 'darwin-arm64']
/** Lo que se copia a la carpeta aislada que empaqueta vsce: vsce sólo ve esa carpeta. */
export const stagedFiles = ['package.json', 'package.nls.json', 'package.nls.es.json', 'README.md', 'CHANGELOG.md', 'language-configuration.json', '.vscodeignore']
export const stagedFolders = ['dist', 'l10n', 'syntaxes', 'icons', 'snippets']
const vsce = '@vscode/vsce@4.1.0'
const extensionRoot = fileURLToPath(new URL('.', import.meta.url))

/** Destino del equipo actual, como `linux-x64`. */
export function hostTarget() {
	const target = `${process.platform}-${process.arch}`
	if (!targets.includes(target)) throw new Error(`Sistema o arquitectura no admitidos para el VSIX: ${target}.`)
	return target
}

/** Ruta del VSIX de un destino en `artifacts/`. */
export function vsixPath(target) {
	const manifest = JSON.parse(readFileSync(join(extensionRoot, 'package.json'), 'utf8'))
	return join(extensionRoot, 'artifacts', `${manifest.name}-${manifest.version}-${target}.vsix`)
}

/** Un argumento para `cmd.exe`: entre comillas si tiene espacios o metacaracteres, como una ruta con espacios. */
const shellArgument = (value) => (/[\s"&|<>^()%!]/.test(value) ? `"${value.replaceAll('"', '""')}"` : value)

function run(command, args, cwd, failure) {
	// pnpm y npm son scripts .cmd en Windows: sólo se lanzan a través del shell, que une los
	// argumentos con espacios sin entrecomillarlos.
	const windows = process.platform === 'win32'
	const result = spawnSync(command, windows ? args.map(shellArgument) : args, { cwd, stdio: 'inherit', shell: windows })
	if (result.status !== 0) throw new Error(failure)
}

/**
 * Construye `artifacts/<nombre>-<versión>-<destino>.vsix`.
 * @param {{ target?: string, skipBuild?: boolean }} options Destino (el del equipo por defecto) y si se reutiliza `dist/`.
 * @returns {string} Ruta del VSIX.
 */
export function packageVsix({ target = hostTarget(), skipBuild = false } = {}) {
	if (!targets.includes(target)) throw new Error(`Destino no admitido: ${target}. Usa uno de ${targets.join(', ')}.`)
	const manifest = JSON.parse(readFileSync(join(extensionRoot, 'package.json'), 'utf8'))
	const typescript = JSON.parse(readFileSync(join(extensionRoot, 'node_modules/typescript/package.json'), 'utf8'))
	const [os, cpu] = target.split('-')
	const nativePackage = `typescript-${target}`
	const nativeExecutable = os === 'win32' ? 'tsc.exe' : 'tsc'
	if (!Object.keys(typescript.optionalDependencies ?? {}).includes(`@typescript/${nativePackage}`)) {
		throw new Error(`TypeScript ${typescript.version} no distribuye el binario nativo para ${target}.`)
	}
	if (!skipBuild) {
		run('pnpm', ['run', 'check'], extensionRoot, 'Falló la comprobación de tipos.')
		run('pnpm', ['run', 'build'], extensionRoot, 'Falló la compilación de la extensión.')
	}
	for (const entry of ['dist/extension.js', 'dist/server.js']) {
		if (!existsSync(join(extensionRoot, entry))) throw new Error(`Falta ${entry}; ejecuta check y build antes de usar --skip-build.`)
	}

	const output = vsixPath(target)
	// Fuera del repositorio: el TypeScript que instala npm no debe resolver nada del workspace.
	const staging = mkdtempSync(join(tmpdir(), 'meeko-vsix-'))
	try {
		for (const name of stagedFiles) cpSync(join(extensionRoot, name), join(staging, name))
		cpSync(join(extensionRoot, '../../LICENSE'), join(staging, 'LICENSE'))
		for (const name of stagedFolders) cpSync(join(extensionRoot, name), join(staging, name), { recursive: true })
		// npm no entiende `catalog:` de pnpm: el manifiesto aislado usa las versiones que fijó el lockfile.
		// Las dependencias de desarrollo no entran en el VSIX: sin ellas npm no las resuelve.
		const staged = JSON.parse(readFileSync(join(staging, 'package.json'), 'utf8'))
		delete staged.devDependencies
		resolveManifestVersions(staged, (name) => {
			const installed = join(extensionRoot, 'node_modules', name, 'package.json')
			if (!existsSync(installed)) throw new Error(`No se puede resolver la versión de ${name}: falta ${installed}. Ejecuta pnpm install.`)
			const resolved = JSON.parse(readFileSync(installed, 'utf8'))
			// Un alias del catálogo (`npm:otro@x`) se instala con el nombre del paquete real.
			return resolved.name === name ? resolved.version : `npm:${resolved.name}@${resolved.version}`
		})
		writeFileSync(join(staging, 'package.json'), `${JSON.stringify(staged, null, '\t')}\n`)

		run('npm', ['install', '--omit=dev', '--ignore-scripts', '--no-audit', '--no-fund', `--os=${os}`, `--cpu=${cpu}`], staging, 'Falló la instalación aislada de TypeScript.')
		if (!existsSync(join(staging, 'node_modules/@typescript', nativePackage, 'lib', nativeExecutable))) {
			throw new Error(`Falta el ejecutable nativo de TypeScript para ${target} en el paquete aislado.`)
		}
		const natives = readdirSync(join(staging, 'node_modules/@typescript')).filter((name) => /^typescript-(?:win32|linux|darwin)-/.test(name))
		if (natives.length !== 1 || natives[0] !== nativePackage) throw new Error(`El paquete aislado contiene binarios nativos inesperados: ${natives.join(', ')}.`)

		mkdirSync(join(extensionRoot, 'artifacts'), { recursive: true })
		run('npm', ['exec', '--yes', `--package=${vsce}`, '--', 'vsce', 'package', '--target', target, '--allow-missing-repository', '--out', output], staging, 'Falló la creación del VSIX.')

		const binaryEntry = `extension/node_modules/@typescript/${nativePackage}/lib/${nativeExecutable}`
		const archive = readFileSync(output)
		if (os !== 'win32') {
			setExecutable(archive, binaryEntry)
			writeFileSync(output, archive)
		}
		const entries = zipEntries(archive)
		const binary = entries.find((entry) => entry.name === binaryEntry)
		if (!binary) throw new Error(`El VSIX no contiene ${binaryEntry}.`)
		if (os !== 'win32' && binary.mode !== 0o755) throw new Error(`El ejecutable de ${target} carece del modo 0755.`)
		const nativeEntries = entries.filter((entry) => /^extension\/node_modules\/@typescript\/typescript-(?:win32|linux|darwin)-[^/]+\/lib\/tsc(?:\.exe)?$/.test(entry.name))
		if (nativeEntries.length !== 1) throw new Error(`El VSIX contiene ${nativeEntries.length} ejecutables nativos de TypeScript; se esperaba uno.`)
		// vsce no comprueba las rutas que declara `contributes`: sin esto, un archivo olvidado sólo se nota en el editor.
		const { grammars = [], snippets = [], languages = [] } = manifest.contributes
		const contributed = [...grammars.map((item) => item.path), ...snippets.map((item) => item.path), ...languages.map((item) => item.configuration)].filter(Boolean)
		for (const path of contributed) {
			const entry = `extension/${path.replace(/^\.\//, '')}`
			if (!entries.some((item) => item.name === entry)) throw new Error(`El VSIX no contiene ${entry}, que declara contributes.`)
		}
		// Sin las traducciones VS Code muestra las `%claves%` del manifiesto o sólo el inglés.
		const localized = [...stagedFiles.filter((name) => name.startsWith('package.nls.')), ...readdirSync(join(extensionRoot, 'l10n')).map((name) => `l10n/${name}`)]
		for (const path of localized) {
			if (!entries.some((item) => item.name === `extension/${path}`)) throw new Error(`El VSIX no contiene extension/${path}, que necesita la localización.`)
		}
		return output
	} finally {
		rmSync(staging, { recursive: true, force: true })
	}
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
	const { values } = parseArgs({ options: { target: { type: 'string' }, 'skip-build': { type: 'boolean' } } })
	console.log(packageVsix({ ...(values.target ? { target: values.target } : {}), skipBuild: values['skip-build'] === true }))
}
