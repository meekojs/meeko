// Utilidades compartidas por los hooks PreToolUse de Bash y PowerShell.
// Node 24 sin dependencias: se ejecutan antes de cada orden de shell y deben ser baratos.
import { readFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { basename, resolve } from 'node:path'

const SEPARATORS = new Set([';', '|', '&', '\n', '\r', '(', ')', '{', '}'])
const PREFIXES = new Set(['call', 'command', 'env', 'exec', 'nice', 'nohup', 'start', 'sudo', 'time'])
const CHANGE_DIRECTORY = new Set(['cd', 'chdir', 'pushd', 'set-location', 'sl'])
const SHELLS = new Set(['bash', 'cmd', 'dash', 'iex', 'invoke-expression', 'powershell', 'pwsh', 'sh', 'wsl', 'zsh'])

/**
 * Lee la entrada JSON del hook desde stdin. Devuelve `null` si no es válida.
 * @returns {{ command: string, cwd: string } | null}
 */
export function readHookInput() {
	try {
		const input = JSON.parse(readFileSync(0, 'utf8'))
		const command = input?.tool_input?.command
		if (typeof command !== 'string' || !command.trim()) return null
		return { command, cwd: typeof input.cwd === 'string' && input.cwd ? input.cwd : process.cwd() }
	} catch {
		return null
	}
}

/**
 * Escribe la decisión de bloqueo con el formato de PreToolUse y termina.
 * @param {string} reason
 */
export function deny(reason) {
	process.stdout.write(
		JSON.stringify({
			hookSpecificOutput: {
				hookEventName: 'PreToolUse',
				permissionDecision: 'deny',
				permissionDecisionReason: reason,
			},
		}),
	)
	process.exit(0)
}

/**
 * Divide una orden de Bash o PowerShell en segmentos de palabras.
 * Es una aproximación deliberadamente conservadora: respeta comillas y separa en `;`, `|`, `&`,
 * saltos de línea, paréntesis y llaves para detectar también órdenes anidadas.
 * @param {string} command
 * @returns {{ quoted: boolean, value: string }[][]}
 */
export function splitSegments(command) {
	const segments = []
	let words = []
	let word = ''
	let quoted = false
	let started = false
	const pushWord = () => {
		if (started) words.push({ quoted, value: word })
		word = ''
		quoted = false
		started = false
	}
	const pushSegment = () => {
		pushWord()
		if (words.length) segments.push(words)
		words = []
	}
	for (let index = 0; index < command.length; index++) {
		const char = command[index]
		if (char === "'" || char === '"') {
			const end = findClosingQuote(command, index)
			word += unescapeQuoted(command.slice(index + 1, end), char)
			quoted = true
			started = true
			index = end
		} else if (SEPARATORS.has(char)) {
			pushSegment()
		} else if (/\s/.test(char)) {
			pushWord()
		} else if ((char === '\\' || char === '`') && (command[index + 1] === '"' || command[index + 1] === "'")) {
			word += command[++index]
			started = true
		} else {
			word += char
			started = true
		}
	}
	pushSegment()
	return segments
}

function findClosingQuote(command, start) {
	const quote = command[start]
	for (let index = start + 1; index < command.length; index++) {
		const char = command[index]
		if (quote === '"' && (char === '\\' || char === '`') && command[index + 1] === '"') index++
		else if (char === quote) return index
	}
	return command.length
}

function unescapeQuoted(text, quote) {
	return quote === '"' ? text.replace(/[\\`]"/g, '"') : text
}

/**
 * Nombre normalizado de un ejecutable: sin ruta, en minúsculas y sin `.exe`, `.cmd`, `.bat` ni `.ps1`.
 * @param {string} value
 */
export function executableName(value) {
	return basename(value.replace(/\\/g, '/'))
		.toLowerCase()
		.replace(/\.(?:exe|cmd|bat|ps1)$/, '')
}

/**
 * Recorre los segmentos de una orden (y las órdenes entre comillas que contienen, como
 * `pwsh -Command "..."` o `bash -c '...'`) siguiendo los `cd` para estimar el directorio de cada uno.
 * @param {string} command
 * @param {string} cwd
 * @param {(segment: { args: string[], cwd: string, name: string, words: string[] }) => void} visit
 * @param {number} [depth]
 */
export function visitSegments(command, cwd, visit, depth = 0) {
	let current = cwd
	for (const segment of splitSegments(command)) {
		let start = 0
		while (start < segment.length && (/^[A-Za-z_]\w*=/.test(segment[start].value) || PREFIXES.has(executableName(segment[start].value)))) start++
		const words = segment.slice(start).map((word) => word.value)
		if (!words.length) continue
		const name = executableName(words[0])
		if (CHANGE_DIRECTORY.has(name)) current = changeDirectory(current, words.slice(1))
		else visit({ args: words.slice(1), cwd: current, name, words })
		// Solo se analizan las cadenas que otra shell va a ejecutar; así un mensaje de commit o un `echo`
		// que mencionen una orden no la disparan.
		if (SHELLS.has(name) && depth < 3) {
			for (const word of segment.slice(start + 1)) {
				if (word.quoted && /\s/.test(word.value)) visitSegments(word.value, current, visit, depth + 1)
			}
		}
	}
}

function changeDirectory(cwd, args) {
	const target = args.find((arg) => !arg.startsWith('-'))
	if (!target || target === '-') return cwd
	if (target === '~') return homedir()
	return resolve(cwd, target.replace(/^~(?=[\\/])/, homedir()))
}
