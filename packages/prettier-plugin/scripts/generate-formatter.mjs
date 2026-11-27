#!/usr/bin/env node
// Copia el formateador de Prettier de su fuente única, `packages/meeko/src/formatters/prettier/`,
// en `src/*.generated.ts` (ignorados por Git). Los módulos se copian tal cual salvo tres cambios
// deterministas: una cabecera, el sufijo `.generated` en los imports entre ellos y el nombre de este
// paquete en los ejemplos de la documentación. `src/packaging.ts` sustituye al del núcleo.
// Uso: `node scripts/generate-formatter.mjs` escribe; con `--check` sólo comprueba y sale con 1.
import { readdir, readFile, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

export const sourceDirectory = fileURLToPath(new URL('../../meeko/src/formatters/prettier/', import.meta.url))
export const targetDirectory = fileURLToPath(new URL('../src/', import.meta.url))

/** Módulo de la fuente y su copia en este paquete. */
export const generatedFiles = {
	'arrays.ts': 'arrays.generated.ts',
	'class-literals.ts': 'class-literals.generated.ts',
	'classes.ts': 'classes.generated.ts',
	'plugin.ts': 'plugin.generated.ts',
	'template.ts': 'template.generated.ts',
}

/** Módulos de la fuente que no se copian: el del servidor de lenguaje y el que cada paquete tiene propio. */
export const coreOnlyFiles = ['editor.ts', 'packaging.ts']

const shared = new Set(Object.keys(generatedFiles).map((file) => `./${file.slice(0, -3)}`))
const importSpecifier = /(\bfrom\s+|\bimport\s*\(\s*|\bimport\s+)(['"])(\.[^'"]*)\2/g

/**
 * Copia de `source`, el contenido de `file` en la fuente. Falla si importa por ruta relativa algo
 * que no sea otro módulo copiado o `./packaging`: lo demás del núcleo es privado para el plugin.
 *
 * @example
 * generateModule("import { a } from './classes'\n", 'arrays.ts')
 * // "// Generado por …\n\nimport { a } from './classes.generated'\n"
 */
export function generateModule(source, file) {
	const text = source
		.replace(/\r\n/g, '\n')
		.replace(importSpecifier, (match, keyword, quote, specifier) => {
			if (specifier === './packaging') return match
			if (!shared.has(specifier)) {
				throw new Error(`${file} importa ${specifier}: el formateador compartido sólo importa otros módulos copiados o ./packaging (el plugin no tiene los módulos privados del núcleo)`)
			}
			return `${keyword}${quote}${specifier}.generated${quote}`
		})
		.replaceAll('@meekojs/meeko/prettier', '@meekojs/prettier-plugin')
	return `// Generado por scripts/generate-formatter.mjs desde packages/meeko/src/formatters/prettier/${file}: no lo edites.\n\n${text}`
}

/** Copias que corresponden a la fuente actual, por nombre de archivo en `src/`. */
export async function expectedModules() {
	const sources = (await readdir(sourceDirectory)).filter((file) => file.endsWith('.ts'))
	const unknown = sources.filter((file) => !Object.hasOwn(generatedFiles, file) && !coreOnlyFiles.includes(file))
	if (unknown.length) {
		throw new Error(`${unknown.join(', ')}: añádelos a generatedFiles o a coreOnlyFiles en scripts/generate-formatter.mjs`)
	}
	const modules = new Map()
	for (const [file, target] of Object.entries(generatedFiles)) {
		modules.set(target, generateModule(await readFile(join(sourceDirectory, file), 'utf8'), file))
	}
	return modules
}

/** Copias que faltan, sobran o no coinciden con la fuente; vacío si están al día. */
export async function staleModules() {
	const expected = await expectedModules()
	const present = (await readdir(targetDirectory)).filter((file) => file.endsWith('.generated.ts'))
	const stale = present.filter((file) => !expected.has(file))
	for (const [file, text] of expected) {
		const current = await readFile(join(targetDirectory, file), 'utf8').catch(() => undefined)
		if (current?.replace(/\r\n/g, '\n') !== text) stale.push(file)
	}
	return stale.sort()
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
	if (process.argv.includes('--check')) {
		const stale = await staleModules()
		if (stale.length) {
			console.error(`Copias del formateador desactualizadas: ${stale.join(', ')}. Ejecuta: pnpm -F @meekojs/prettier-plugin run formatter:generate`)
			process.exitCode = 1
		}
	} else {
		const expected = await expectedModules()
		for (const file of await readdir(targetDirectory)) {
			if (file.endsWith('.generated.ts') && !expected.has(file)) await rm(join(targetDirectory, file))
		}
		for (const [file, text] of expected) {
			const current = await readFile(join(targetDirectory, file), 'utf8').catch(() => undefined)
			if (current !== text) await writeFile(join(targetDirectory, file), text)
		}
	}
}
