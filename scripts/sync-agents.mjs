#!/usr/bin/env node
// Genera los agentes de Claude Code (`.claude/agents/*.md`) a partir de las
// definiciones de Codex (`.codex/agents/*.toml`), que son la fuente única.
// Uso: `node scripts/sync-agents.mjs` escribe; con `--check` sólo comprueba.
import { mkdir, readdir, readFile, rm, writeFile } from 'node:fs/promises'
import { basename, join, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'

const GENERATED_MARKER = '# Generado por scripts/sync-agents.mjs'
const REQUIRED_KEYS = ['name', 'description', 'developer_instructions']

/**
 * Lee el subconjunto de TOML que usan los agentes de Codex: claves de nivel
 * superior con cadenas básicas (`"..."`) o multilínea (`"""..."""`).
 *
 * @example
 * parseCodexAgent('name = "a"\ndescription = "b"\ndeveloper_instructions = """\nc\n"""', 'a.toml')
 * // { name: 'a', description: 'b', developer_instructions: 'c\n' }
 */
export function parseCodexAgent(source, file) {
	const values = {}
	const text = source.replace(/\r\n/g, '\n')
	let index = 0
	while (index < text.length) {
		const rest = text.slice(index)
		const blank = /^(?:[ \t]*(?:#[^\n]*)?\n)+/.exec(rest)
		if (blank) {
			index += blank[0].length
			continue
		}
		const key = /^[ \t]*([A-Za-z0-9_-]+)[ \t]*=[ \t]*/.exec(rest)
		if (!key) throw new Error(`${file}: sintaxis TOML no admitida cerca de «${rest.slice(0, 40)}»`)
		index += key[0].length
		const multiline = text.startsWith('"""', index)
		const delimiter = multiline ? '"""' : '"'
		let start = index + delimiter.length
		if (multiline && text[start] === '\n') start += 1
		let end = start
		while (end < text.length && !(text.startsWith(delimiter, end) && !isEscaped(text, end))) {
			if (!multiline && text[end] === '\n') break
			end += 1
		}
		if (!text.startsWith(delimiter, end) || !text.startsWith('"', index)) {
			throw new Error(`${file}: la clave «${key[1]}» debe ser una cadena básica terminada`)
		}
		values[key[1]] = unescapeBasicString(text.slice(start, end), file)
		index = end + delimiter.length
		const trailing = /^[ \t]*(?:#[^\n]*)?(?:\n|$)/.exec(text.slice(index))
		if (!trailing) throw new Error(`${file}: contenido inesperado tras «${key[1]}»`)
		index += trailing[0].length
	}
	for (const required of REQUIRED_KEYS) {
		if (typeof values[required] !== 'string' || values[required].trim() === '') {
			throw new Error(`${file}: falta la clave obligatoria «${required}»`)
		}
	}
	return values
}

/**
 * Convierte un agente de Codex en un subagente de Claude Code con frontmatter YAML.
 *
 * @example
 * renderClaudeAgent({ name: 'a', description: 'b', developer_instructions: 'c' }, 'a.toml')
 */
export function renderClaudeAgent(agent, sourceFile) {
	return [
		'---',
		`${GENERATED_MARKER} desde .codex/agents/${sourceFile}; no lo edites a mano.`,
		`name: ${JSON.stringify(agent.name)}`,
		`description: ${JSON.stringify(agent.description)}`,
		'---',
		'',
		agent.developer_instructions.trim(),
		'',
	].join('\n')
}

/**
 * Sincroniza o comprueba `.claude/agents` frente a `.codex/agents`.
 * Devuelve las rutas que estaban desactualizadas.
 */
export async function syncAgents({ check = false, root = process.cwd() } = {}) {
	const sourceDir = join(root, '.codex/agents')
	const targetDir = join(root, '.claude/agents')
	const sources = (await readdir(sourceDir)).filter((file) => file.endsWith('.toml')).sort()
	const expected = new Map()
	for (const file of sources) {
		const agent = parseCodexAgent(await readFile(join(sourceDir, file), 'utf8'), file)
		if (agent.name !== basename(file, '.toml')) {
			throw new Error(`${file}: «name» debe coincidir con el nombre del archivo`)
		}
		expected.set(`${agent.name}.md`, renderClaudeAgent(agent, file))
	}

	const stale = []
	const existing = await readdir(targetDir).catch(() => [])
	for (const file of existing) {
		if (!file.endsWith('.md') || expected.has(file)) continue
		const content = await readFile(join(targetDir, file), 'utf8')
		if (!content.includes(GENERATED_MARKER)) continue
		stale.push(join('.claude/agents', file))
		if (!check) await rm(join(targetDir, file))
	}
	for (const [file, content] of expected) {
		const current = await readFile(join(targetDir, file), 'utf8').catch(() => null)
		if (current === content) continue
		stale.push(join('.claude/agents', file))
		if (!check) {
			await mkdir(targetDir, { recursive: true })
			await writeFile(join(targetDir, file), content)
		}
	}
	return stale
}

function isEscaped(text, position) {
	let backslashes = 0
	for (let index = position - 1; index >= 0 && text[index] === '\\'; index -= 1) backslashes += 1
	return backslashes % 2 === 1
}

function unescapeBasicString(raw, file) {
	return raw.replace(/\\(?:\n[ \t\n]*|u([0-9A-Fa-f]{4})|U([0-9A-Fa-f]{8})|(.))/g, (match, u4, u8, simple) => {
		if (match.startsWith('\\\n')) return ''
		if (u4 || u8) return String.fromCodePoint(Number.parseInt(u4 ?? u8, 16))
		const escapes = { '"': '"', '\\': '\\', b: '\b', f: '\f', n: '\n', r: '\r', t: '\t' }
		if (simple in escapes) return escapes[simple]
		throw new Error(`${file}: secuencia de escape TOML no válida «${match}»`)
	})
}

if (import.meta.url === pathToFileURL(resolve(process.argv[1] ?? '')).href) {
	const check = process.argv.includes('--check')
	const stale = await syncAgents({ check })
	if (check && stale.length > 0) {
		console.error(`Agentes de Claude desactualizados; ejecuta pnpm agents:sync:\n${stale.join('\n')}`)
		process.exitCode = 1
	} else {
		console.log(stale.length > 0 ? `Actualizados:\n${stale.join('\n')}` : 'Agentes de Claude sincronizados.')
	}
}
