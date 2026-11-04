// Hook PreToolUse (Bash y PowerShell) que evita las órdenes de git que dejaron el repositorio bloqueado:
// recorridos de ignorados sobre la raíz o node_modules y borrados de locks de .git.
import { existsSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'

import { deny, readHookInput, visitSegments } from './shell.mjs'

const SCANNING_COMMANDS = new Set(['clean', 'ls-files', 'status'])
const GLOBAL_OPTIONS_WITH_VALUE = new Set(['--config-env', '--exec-path', '--git-dir', '--namespace', '--super-prefix', '--work-tree', '-C', '-c'])
const LONG_OPTIONS_WITH_VALUE = {
	clean: new Set(['--exclude']),
	'ls-files': new Set(['--exclude', '--exclude-from', '--exclude-per-directory', '--format', '--with-tree']),
	status: new Set([]),
}
const SHORT_OPTIONS_WITH_VALUE = { clean: 'e', 'ls-files': 'xX', status: '' }
const ROOT_PATHSPECS = /^(?::\/\*?|:\(top\)\*?|\/|\*)$/
const DELETE_COMMANDS = new Set(['del', 'erase', 'mi', 'move', 'move-item', 'mv', 'rd', 'remove-item', 'ren', 'rename', 'rename-item', 'ri', 'rm', 'rmdir', 'rni', 'unlink'])
const DELETE_CALLS = /\b(?:Delete|Move|rm|rmSync|rmtree|remove|unlink|unlinkSync)\s*\(/i
const LOCK_IN_GIT = /(?:^|[\s'"=\\/])\.git[\\/](?:[^\s'"|;&]*[\\/])?[^\s'"|;&\\/]*\.lock\b/i
const INDEX_LOCK = /\bindex\.lock\b/i
const DOT_GIT = /(?:^|[\s'"=\\/])\.git(?:[\s'"\\/;|&)]|$)/i

export const SCAN_REASON = [
	'Bloqueado por .claude/hooks/git-guard.mjs: `git status`, `git ls-files` o `git clean` con --ignored, -x o -X sobre la raíz o sobre un directorio con node_modules recorre los enlaces de pnpm hasta rutas demasiado largas, tarda minutos y, si se interrumpe, deja un .git/index.lock huérfano que bloquea git para todos.',
	'Alternativas: `git --no-optional-locks status --porcelain` (sin --ignored); `git check-ignore -v <ruta>` para saber si una ruta concreta está ignorada; o limita la orden a un subdirectorio sin node_modules, por ejemplo `git --no-optional-locks status --ignored -- packages/meeko/src`. Para limpiar artefactos usa los scripts del repositorio o borra la carpeta concreta en vez de `git clean -x`.',
].join('\n')

export const LOCK_REASON = [
	'Bloqueado por .claude/hooks/git-guard.mjs: no borres ni muevas .git/index.lock ni otros *.lock de .git. El lock puede pertenecer a un git.exe que sigue escribiendo y quitarlo corrompe el índice.',
	'Avisa al coordinador. Él comprueba que no queda ningún git escritor vivo (`Get-Process git -ErrorAction SilentlyContinue`, VS Code y GitHub Desktop incluidos) y solo entonces lo quita el usuario desde su propia terminal.',
].join('\n')

/**
 * Devuelve el motivo de bloqueo para una orden, o `null` si puede ejecutarse.
 * @param {string} command
 * @param {string} cwd
 * @returns {string | null}
 */
export function checkCommand(command, cwd) {
	let reason = null
	let deletes = DELETE_CALLS.test(command)
	visitSegments(command, cwd, (segment) => {
		if (DELETE_COMMANDS.has(segment.name)) deletes = true
		if (!reason && segment.name === 'git' && scansIgnored(segment.args, segment.cwd)) reason = SCAN_REASON
	})
	if (reason) return reason
	if (deletes && (LOCK_IN_GIT.test(command) || INDEX_LOCK.test(command) || (DOT_GIT.test(command) && /\.lock\b/i.test(command)))) return LOCK_REASON
	return null
}

function scansIgnored(args, cwd) {
	let index = 0
	let gitCwd = cwd
	while (index < args.length && args[index].startsWith('-')) {
		const [name, value] = splitOption(args[index])
		if (GLOBAL_OPTIONS_WITH_VALUE.has(name) && value === undefined) {
			if (name === '-C' || name === '--work-tree') gitCwd = resolve(gitCwd, args[index + 1] ?? '.')
			index += 2
		} else {
			if (name === '--work-tree' && value) gitCwd = resolve(gitCwd, value)
			index++
		}
	}
	const subcommand = args[index]
	if (!SCANNING_COMMANDS.has(subcommand)) return false

	let flagged = false
	let unknownPaths = false
	const pathspecs = []
	const rest = args.slice(index + 1)
	for (let position = 0; position < rest.length; position++) {
		const arg = rest[position]
		if (arg === '--') {
			pathspecs.push(...rest.slice(position + 1))
			break
		}
		if (arg.startsWith('--')) {
			const [name, value] = splitOption(arg)
			if (name === '--ignored' && value?.toLowerCase() !== 'no') flagged = true
			if (name === '--pathspec-from-file') unknownPaths = true
			if (LONG_OPTIONS_WITH_VALUE[subcommand].has(name) && value === undefined) position++
		} else if (arg.startsWith('-') && arg.length > 1) {
			const flags = arg.slice(1)
			for (let at = 0; at < flags.length; at++) {
				// En `ls-files`, `-i` equivale a `--ignored`.
				if (flags[at] === 'x' || flags[at] === 'X' || (subcommand === 'ls-files' && flags[at] === 'i')) flagged = true
				if (SHORT_OPTIONS_WITH_VALUE[subcommand].includes(flags[at])) {
					if (at === flags.length - 1) position++
					break
				}
			}
		} else {
			pathspecs.push(arg)
		}
	}
	if (!flagged) return false
	// `git status` sin rutas abarca todo el repositorio; `ls-files` y `clean`, el directorio actual.
	if (unknownPaths || (subcommand === 'status' && pathspecs.length === 0)) return true
	const targets = pathspecs.length ? pathspecs : ['.']
	return targets.some((target) => touchesHeavyTree(target, gitCwd))
}

function splitOption(arg) {
	const equals = arg.indexOf('=')
	return equals === -1 ? [arg, undefined] : [arg.slice(0, equals), arg.slice(equals + 1)]
}

function touchesHeavyTree(pathspec, cwd) {
	if (/node_modules/i.test(pathspec) || ROOT_PATHSPECS.test(pathspec)) return true
	// `:/ruta` y `:(top)ruta` se resuelven desde la raíz del repositorio, no desde el directorio actual.
	const fromTop = /^:(?:\/|\([^)]*top[^)]*\))/.test(pathspec)
	const literal = pathspec.replace(/^:(?:\/|\([^)]*\))/, '').split(/[*?[]/)[0]
	const directory = resolve(fromTop ? (findRepositoryRoot(cwd) ?? cwd) : cwd, literal || '.')
	return existsSync(join(directory, '.git')) || existsSync(join(directory, 'node_modules'))
}

function findRepositoryRoot(start) {
	for (let directory = resolve(start); ; directory = dirname(directory)) {
		if (existsSync(join(directory, '.git'))) return directory
		if (dirname(directory) === directory) return null
	}
}

if (import.meta.main) {
	const input = readHookInput()
	const reason = input && checkCommand(input.command, input.cwd)
	if (reason) deny(reason)
}
