// Compiles src/app/styles/main.css with Tailwind 4 into dist/styles/main.css, the sheet that the module
// adds to the app. `--watch` recompiles when a component, a variant or a stylesheet changes.
import tailwind from '@tailwindcss/postcss'
import { watch } from 'node:fs'
import { mkdir, readFile, stat, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import postcss from 'postcss'

import { appearanceStyles } from './appearance-styles.mjs'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const entry = join(root, 'src', 'app', 'styles', 'main.css')
const catalog = new URL('../src/app/theme/base/variants.ts', import.meta.url)
const tailwindTheme = new URL(import.meta.resolve('tailwindcss/theme.css'))
const tailwindColors = new Map()
postcss.parse(await readFile(tailwindTheme, 'utf8')).walkDecls(/^--color-/, ({ prop, value }) => {
	tailwindColors.set(prop, value)
})
const output = join(root, 'dist', 'styles', 'main.css')
const appearanceOutput = join(dirname(entry), 'appearance-palette.css')

/** Compiles the entry; `optimize: false` leaves the CSS as written, as the app's Vite used to get it. */
async function build() {
	const started = performance.now()
	const { mtimeMs } = await stat(catalog)
	const { variants } = await import(`${catalog.href}?mtime=${mtimeMs}`)
	const generated = appearanceStyles(variants.color, tailwindColors)
	await mkdir(dirname(output), { recursive: true })
	if (
		generated !==
		(await readFile(appearanceOutput, 'utf8').catch((error) => {
			if (error.code !== 'ENOENT') throw error
		}))
	)
		await writeFile(appearanceOutput, generated)
	const result = await postcss([tailwind({ base: root, optimize: false })]).process(await readFile(entry, 'utf8'), { from: entry, to: output })
	await writeFile(output, result.css)
	console.log(`[@meekojs/ui] dist/styles/main.css (${Math.round(performance.now() - started)} ms)`)
}

await build()

if (process.argv.includes('--watch')) {
	let timer
	let running = Promise.resolve()
	const schedule = () => {
		clearTimeout(timer)
		timer = setTimeout(() => {
			running = running.then(build).catch((error) => console.error(error))
		}, 50)
	}
	for (const folder of [join(root, 'src', 'app'), join(root, 'src', 'editor', 'components')]) watch(folder, { recursive: true }, schedule)
}
