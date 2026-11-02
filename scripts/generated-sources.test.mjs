import assert from 'node:assert/strict'
import { existsSync, readdirSync, readFileSync } from 'node:fs'
import { basename, join, resolve } from 'node:path'
import { test } from 'node:test'
import { fileURLToPath } from 'node:url'

const root = fileURLToPath(new URL('../', import.meta.url))
const importPattern = /from\s+['"](\.[^'"]*?\.generated)(?:\.js)?['"]/g

/** Lista recursivamente los `.ts` de un directorio, sin entrar en `node_modules`. */
function sourcesIn(directory) {
	return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
		if (entry.name === 'node_modules') return []
		const path = join(directory, entry.name)
		if (entry.isDirectory()) return sourcesIn(path)
		return entry.name.endsWith('.ts') ? [path] : []
	})
}

/**
 * Un `*.generated.ts` está en `.gitignore`: no existe en un clon limpio. Todo paquete cuyo `src`
 * lo importe debe encadenar su generador en `build` y en `check`, o fallan en un clon limpio.
 */
test('los paquetes que importan fuentes generadas las generan en build y check', () => {
	let found = 0
	for (const group of ['packages', 'apps']) {
		for (const name of readdirSync(join(root, group))) {
			const directory = join(root, group, name)
			if (!existsSync(join(directory, 'package.json')) || !existsSync(join(directory, 'src'))) continue
			const scripts = JSON.parse(readFileSync(join(directory, 'package.json'), 'utf8')).scripts ?? {}
			const generated = new Set()
			for (const file of sourcesIn(join(directory, 'src'))) {
				for (const [, specifier] of readFileSync(file, 'utf8').matchAll(importPattern)) generated.add(resolve(file, '..', `${specifier}.ts`))
			}
			for (const file of generated) {
				found++
				const base = basename(file)
				const generator = Object.entries(scripts).find(([, command]) => /node\s+(\S+\.mjs)/.test(command) && readFileSync(join(directory, command.match(/node\s+(\S+\.mjs)/)[1]), 'utf8').includes(base))
				assert.ok(generator, `${group}/${name}: ningún script genera ${base}`)
				for (const phase of ['build', 'check']) {
					assert.ok(
						scripts[phase]?.split('&&').some((step) => step.trim() === `pnpm run ${generator[0]}`),
						`${group}/${name}: "${phase}" debe ejecutar "${generator[0]}" antes de usar ${base}`,
					)
				}
			}
		}
	}
	assert.ok(found > 0, 'el recorrido no encontró ninguna fuente generada: revisa el patrón de la prueba')
})
