/**
 * Lo único del formateador que depende del paquete que lo publica.
 *
 * Esta carpeta es la fuente única del formateador de Prettier para `.meeko`: la usan
 * `@meekojs/meeko/prettier` y el servidor de lenguaje (`editor.ts`), y `@meekojs/prettier-plugin`
 * copia en su build `arrays.ts`, `class-literals.ts`, `classes.ts`, `plugin.ts` y `template.ts`
 * (`packages/prettier-plugin/scripts/generate-formatter.mjs`). Esos módulos sólo importan de Meeko a
 * través de este; el plugin tiene su propio `packaging.ts`, con las entradas públicas
 * `@meekojs/meeko/compiler` y `@meekojs/meeko/parse`.
 */
import { maskComponentTags as maskTags } from '../../compiler/parser/sfc'

export { compile } from '../../compiler'
export { scanInterpolations } from '../../compiler/parser/interpolation'
export { locate, MeekoCompileError, parseSfc } from '../../compiler/parser/sfc'
export type { SfcSection } from '../../compiler/parser/sfc'
export { isCustomElementTag } from '../../compiler/parser/template'
export { isMeekoProject } from '../../framework/clean'

/** Siempre presente en el núcleo; el plugin admite un `@meekojs/meeko` que no lo exporte. */
export const maskComponentTags: typeof maskTags | undefined = maskTags

/** Marca del printer `estree` de Meeko, para no delegar en sí mismo ni en otra copia de Meeko cargada. */
export const ownPrinterMarker = Symbol.for('meeko.prettier.estree')

/** Marcas de otros printers de Meeko en los que tampoco delega: ninguna en el núcleo. */
export const foreignPrinterMarkers: readonly symbol[] = []
