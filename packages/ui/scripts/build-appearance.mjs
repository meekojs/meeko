// Genera src/app/theme/base/colors.ts y hues.ts con las combinaciones color × variante escritas como cadenas
// literales completas: Tailwind solo genera lo que ve escrito. Los archivos generados se versionan.
// Uso: pnpm -F @meekojs/ui run generate:appearance [carpeta de destino]
import { writeFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

// `{c}` es el color. Pasos de Radix: 1–2 fondos, 3–5 fondo de componente (normal/hover/activo),
// 6–8 bordes, 9–10 sólido (normal/hover), 11–12 texto. `plain` no pinta nada y no tiene entradas.
export const templates = {
	solid: 'border-transparent bg-{c}-9 text-{c}-contrast not-disabled:hover:bg-{c}-10 not-disabled:active:bg-{c}-10',
	soft: 'border-transparent bg-{c}-3 text-{c}-11 not-disabled:hover:bg-{c}-4 not-disabled:active:bg-{c}-5',
	outline: 'border-(length:--ui-border-width) border-{c}-7 text-{c}-11 not-disabled:hover:border-{c}-8 not-disabled:hover:bg-{c}-2 not-disabled:active:bg-{c}-3',
	ghost: 'border-transparent text-{c}-11 not-disabled:hover:bg-{c}-3 not-disabled:active:bg-{c}-4',
	surface: 'border-(length:--ui-border-width) border-{c}-6 bg-{c}-2 text-{c}-11 not-disabled:hover:border-{c}-7 not-disabled:hover:bg-{c}-3 not-disabled:active:bg-{c}-4',
	subtle: 'border-transparent bg-{c}-2 text-{c}-11 not-disabled:hover:bg-{c}-3 not-disabled:active:bg-{c}-4',
	link: 'border-transparent text-{c}-11 underline-offset-4 not-disabled:hover:text-{c}-12 not-disabled:hover:underline',
	glass: 'border-(length:--ui-border-width) border-gray-a6 bg-gray-a3 text-{c}-11 backdrop-blur-md not-disabled:hover:bg-gray-a4',
}

/** Los colores semánticos: sus escalas están en la hoja principal (theme.css). */
export const semanticColors = ['primary', 'secondary', 'neutral', 'success', 'info', 'warning', 'danger']

/** Orden y nombres de @radix-ui/colors 3.0.0 (escalas de 12 pasos; se omiten blackA y whiteA). */
export const hueNames = ['gray', 'mauve', 'slate', 'sage', 'olive', 'sand', 'tomato', 'red', 'ruby', 'crimson', 'pink', 'plum', 'purple', 'violet', 'iris', 'indigo', 'blue', 'cyan', 'teal', 'jade', 'green', 'grass', 'brown', 'bronze', 'gold', 'sky', 'mint', 'lime', 'yellow', 'amber', 'orange']

const entries = (colors) => colors.flatMap((color) => Object.entries(templates).map(([variant, template]) => `\t{ color: '${color}', variant: '${variant}', class: '${template.replaceAll('{c}', color)}' },`)).join('\n')

const header = '// Generado a partir de las plantillas de color × variante. Cada clase se escribe completa para que Tailwind\n// la encuentre al escanear; no construyas nombres de clase en tiempo de ejecución.\n'

/** El contenido de colors.ts. */
export const colorsSource = () => `${header}import type { AppearanceColor, AppearanceCompound } from './types'

/**
 * Combinaciones de cada color semántico con cada variante, al estilo de Nuxt UI: \`color\` y \`variant\` no llevan
 * clases por sí solos y cada pareja pinta con los pasos de su escala. \`plain\` no tiene entradas porque no pinta.
 */
export const colorCompoundVariants: readonly AppearanceCompound<AppearanceColor>[] = [
${entries(semanticColors)}
]
`

/** El contenido de hues.ts. */
export const huesSource = () => `${header}// Este archivo queda fuera del escaneo de Tailwind de la hoja principal: solo entra en el bundle y en la hoja
// de quien importa \`@meekojs/ui/theme/hues\`.
import type { AppearanceCompound, Hue, HuePalette } from './types'

/** Nombres de las escalas de Radix Colors que se pueden usar como color crudo. */
export const hueNames = [
${hueNames.map((hue) => `\t'${hue}',`).join('\n')}
] as const

/** Combinaciones de cada tono crudo con cada variante, con las mismas plantillas que los colores semánticos. */
export const hueCompoundVariants: readonly AppearanceCompound<Hue>[] = [
${entries(hueNames)}
]

/**
 * Paleta de tonos crudos para \`appearance()\`. Habilítala de forma explícita con su segundo argumento.
 *
 * @example
 * \`\`\`ts
 * import { appearance, defineTheme } from '@meekojs/ui/theme'
 * import { hues } from '@meekojs/ui/theme/hues'
 *
 * const tag = defineTheme({ ...appearance({ variant: ['soft'], color: ['primary', 'crimson'] }, { hues }) })
 * \`\`\`
 */
export const hues: HuePalette = { names: hueNames, compoundVariants: hueCompoundVariants }
`

if (import.meta.main) {
	const out = resolve(process.argv[2] ?? fileURLToPath(new URL('../src/app/theme/base/', import.meta.url)))
	writeFileSync(resolve(out, 'colors.ts'), colorsSource())
	writeFileSync(resolve(out, 'hues.ts'), huesSource())
	console.log(`Generados colors.ts y hues.ts en ${out}`)
}
