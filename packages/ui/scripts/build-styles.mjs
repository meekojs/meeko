// Compiles src/app/styles/main.css with Tailwind 4 into dist/styles/main.css, the sheet that the module
// adds to the app. `--watch` recompiles when a component, a variant or a stylesheet changes.
import tailwind from '@tailwindcss/postcss'
import { watch } from 'node:fs'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import postcss from 'postcss'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const entry = join(root, 'src', 'app', 'styles', 'main.css')
const output = join(root, 'dist', 'styles', 'main.css')

/** Compiles the entry; `optimize: false` leaves the CSS as written, as the app's Vite used to get it. */
async function build() {
	const started = performance.now()
	const result = await postcss([tailwind({ base: root, optimize: false })]).process(await readFile(entry, 'utf8'), { from: entry, to: output })
	await mkdir(dirname(output), { recursive: true })
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
