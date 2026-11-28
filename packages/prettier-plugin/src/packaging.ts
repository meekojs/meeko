/**
 * Lo único del formateador que depende de este paquete.
 *
 * La fuente única del formateador vive en `packages/meeko/src/formatters/prettier/`, y
 * `scripts/generate-formatter.mjs` la copia en `src/*.generated.ts` en `build` y en `check`. Esos
 * módulos importan de Meeko sólo a través de este, que sustituye al `packaging.ts` del núcleo: aquí
 * se usan las entradas públicas de `@meekojs/meeko`, porque el plugin la tiene como dependencia par.
 */
import * as meekoParse from '@meekojs/meeko/parse'
import { readFile, stat } from 'node:fs/promises'
import { join } from 'node:path'

export { compile } from '@meekojs/meeko/compiler'
export type { SfcSection } from '@meekojs/meeko/parse'
export { isCustomElementTag, locate, MeekoCompileError, parseSfc, scanInterpolations } from '@meekojs/meeko/parse'

/** `undefined` con un Meeko anterior a 1.8, que no lo exporta: la plantilla queda como antes. */
export const maskComponentTags = (meekoParse as Partial<typeof meekoParse>).maskComponentTags

/** Marca del printer `estree` del núcleo (`@meekojs/meeko/prettier`), en el que este nunca delega. */
const coreMarker = Symbol.for('meeko.prettier.estree')

/**
 * Marca del printer `estree` de este paquete, para no delegar en sí mismo. Es otra que la del
 * núcleo a propósito: el servidor de lenguaje pone el plugin del núcleo el último, y así este lo
 * trata como el printer del host y delega en él, de modo que `meekoClassFunctions` también se
 * aplica allí.
 */
export const ownPrinterMarker = Symbol.for('meeko.prettier-plugin.estree')

/** Marcas de otros printers de Meeko en los que tampoco delega: el del núcleo. */
export const foreignPrinterMarkers: readonly symbol[] = [coreMarker]

/**
 * Si `root` tiene `meeko.config.*` o un `package.json` que depende de `@meekojs/meeko`. No importa
 * el servidor de desarrollo ni módulos privados de Meeko.
 */
export async function isMeekoProject(root: string): Promise<boolean> {
	for (const file of ['meeko.config.ts', 'meeko.config.mts', 'meeko.config.js', 'meeko.config.mjs']) {
		if ((await stat(join(root, file)).catch(() => undefined))?.isFile()) return true
	}
	try {
		const manifest = JSON.parse(await readFile(join(root, 'package.json'), 'utf8')) as Record<string, Record<string, unknown> | undefined>
		return !!(manifest.dependencies?.['@meekojs/meeko'] || manifest.devDependencies?.['@meekojs/meeko'])
	} catch {
		return false
	}
}
