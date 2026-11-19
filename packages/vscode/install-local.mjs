// Empaqueta la extensión para este equipo y la instala en el VS Code local.
// Uso: node install-local.mjs [--use-existing-vsix] [--code <cli>] [--target <os-cpu>] [--show-cli-deprecations]
import { spawnSync } from 'node:child_process'
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs'
import { homedir } from 'node:os'
import { delimiter, join } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { parseArgs } from 'node:util'

import { hostTarget, packageVsix, vsixPath } from './package-vsix.mjs'
import { zipEntry } from './scripts/vsix-archive.mjs'

const extensionRoot = fileURLToPath(new URL('.', import.meta.url))
const grammarPath = 'syntaxes/meeko.tmLanguage.json'

/** Un ejecutable de `PATH`; en Windows, `code` es `code.cmd`. */
function onPath(name) {
	const extensions = process.platform === 'win32' ? ['.exe', '.cmd', '.bat', ''] : ['']
	for (const folder of (process.env.PATH ?? '').split(delimiter).filter(Boolean)) {
		for (const extension of extensions) {
			const candidate = join(folder, name + extension)
			if (existsSync(candidate) && statSync(candidate).isFile()) return candidate
		}
	}
	return undefined
}

/**
 * El CLI de VS Code: el indicado, `code` del `PATH` o, en WSL y SSH fuera de una terminal de VS Code,
 * el `code-server` más reciente de `~/.vscode-server`, que instala en el servidor remoto.
 */
export function codeCli(command) {
	if (command) return onPath(command) ?? (existsSync(command) ? command : undefined)
	const found = onPath('code')
	if (found) return found
	const servers = join(homedir(), '.vscode-server', 'bin')
	if (!existsSync(servers)) return undefined
	return readdirSync(servers)
		.map((name) => join(servers, name, 'bin', 'code-server'))
		.filter((path) => existsSync(path))
		.sort((left, right) => statSync(right).mtimeMs - statSync(left).mtimeMs)[0]
}

/** JSON normalizado: el mismo contenido con otro formato no cuenta como diferencia. */
const normalized = (text) => JSON.stringify(JSON.parse(text))

function runCli(cli, args, showDeprecations) {
	// VS Code's gallery request still uses url.parse(): microsoft/vscode#319867. Only its CLI hides the warning.
	const env = showDeprecations ? process.env : { ...process.env, NODE_OPTIONS: [process.env.NODE_OPTIONS, '--disable-warning=DEP0169'].filter(Boolean).join(' ') }
	// `code.cmd` sólo se lanza a través de `cmd.exe`, que une los argumentos sin entrecomillarlos.
	const shell = process.platform === 'win32' && /\.(?:cmd|bat)$/i.test(cli)
	const quoted = (value) => (/[\s"&|<>^()%!]/.test(value) ? `"${value.replaceAll('"', '""')}"` : value)
	return spawnSync(shell ? quoted(cli) : cli, shell ? args.map(quoted) : args, { env, encoding: 'utf8', shell })
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
	const { values } = parseArgs({ options: { 'use-existing-vsix': { type: 'boolean' }, code: { type: 'string' }, target: { type: 'string' }, 'show-cli-deprecations': { type: 'boolean' } } })
	const cli = codeCli(values.code)
	if (!cli) throw new Error(`No se encuentra el CLI de VS Code${values.code ? ` '${values.code}'` : ''}. Añade 'code' al PATH o indica --code <ruta>.`)
	const target = values.target ?? hostTarget()
	const vsix = values['use-existing-vsix'] ? vsixPath(target) : packageVsix({ target })
	if (!existsSync(vsix)) throw new Error(`No existe el VSIX: ${vsix}. Ejecuta el script sin --use-existing-vsix para generarlo.`)

	const packaged = zipEntry(readFileSync(vsix), `extension/${grammarPath}`)
	if (!packaged) throw new Error('El VSIX no contiene la gramática de Meeko.')
	if (!values['use-existing-vsix'] && normalized(readFileSync(join(extensionRoot, grammarPath), 'utf8')) !== normalized(packaged.toString('utf8'))) {
		throw new Error('La gramática cambió durante el empaquetado. Guarda el archivo y vuelve a ejecutar el script.')
	}

	const manifest = JSON.parse(readFileSync(join(extensionRoot, 'package.json'), 'utf8'))
	const id = `${manifest.publisher}.${manifest.name}`
	const installed = runCli(cli, ['--install-extension', vsix, '--force'], values['show-cli-deprecations'])
	process.stdout.write(installed.stdout ?? '')
	process.stderr.write(installed.stderr ?? '')
	if (installed.status !== 0) throw new Error('Falló la instalación local en VS Code.')
	const located = runCli(cli, ['--locate-extension', id], values['show-cli-deprecations'])
	const location = located.stdout?.trim().split(/\r?\n/).at(-1)
	if (located.status !== 0 || !location) throw new Error('No se puede localizar la extensión instalada.')
	const installedGrammar = join(location, grammarPath)
	if (!existsSync(installedGrammar)) throw new Error('No se encuentra la gramática instalada.')
	if (normalized(readFileSync(installedGrammar, 'utf8')) !== normalized(packaged.toString('utf8'))) {
		throw new Error('La gramática instalada no coincide con el VSIX. Revisa la instalación de VS Code.')
	}
	console.log(`Instalada ${id} ${manifest.version} (${target}) en ${location}.`)
	console.log('En VS Code ejecuta Developer: Reload Window para cargar los cambios.')
}
