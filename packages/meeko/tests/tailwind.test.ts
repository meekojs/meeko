import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { cp, mkdir, mkdtemp, readdir, readFile, rm, utimes, writeFile } from 'node:fs/promises'
import { createRequire } from 'node:module'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { after, before, describe, test } from 'node:test'
import { fileURLToPath } from 'node:url'
import * as prettier from 'prettier'

import type { MeekoPrettierOptions } from '../src/prettier'

import { compile } from '../src/compiler'
import { classOrderWarnings } from '../src/formatters/prettier/classes'
import { formatWithPrettier } from '../src/formatters/prettier/editor'
import { buildProject, developmentServerPorts, startProject, stopDevelopmentServer } from '../src/framework/project'
import plugin from '../src/prettier'
import { createTempProject, linkRepositoryPackages, type TempProject } from './helpers/temp-project'

type FormatOptions = MeekoPrettierOptions & prettier.Options

const fixture = fileURLToPath(new URL('./fixtures/tailwind-app', import.meta.url))
const projects: TempProject[] = []
const warnings: string[] = []
const write = classOrderWarnings.write

before(() => {
	classOrderWarnings.write = (message) => {
		warnings.push(message)
	}
})
after(async () => {
	classOrderWarnings.write = write
	await Promise.all(projects.map((project) => project.remove()))
})

/** A copy of the fixture with the packages a project that uses Tailwind 4 installs. */
async function tailwindProject(prefix: string): Promise<string> {
	const project = await createTempProject(prefix)
	projects.push(project)
	await cp(fixture, project.root, { recursive: true })
	await linkRepositoryPackages(project.root, ['@meekojs/meeko', 'tailwindcss', '@tailwindcss/postcss', 'vite'])
	return project.root
}

async function put(root: string, file: string, source: string): Promise<void> {
	await mkdir(dirname(join(root, file)), { recursive: true })
	await writeFile(join(root, file), source)
}

/** Writes `file` with a later modification time, so a cache that compares stamps sees the change. */
async function touch(root: string, file: string, source: string): Promise<void> {
	await put(root, file, source)
	const later = new Date(Date.now() + 2_000)
	await utimes(join(root, file), later, later)
}

/** Tailwind detects its sources from the working directory, as `meeko build` run from the project root does. */
async function inDirectory<T>(directory: string, run: () => Promise<T>): Promise<T> {
	const previous = process.cwd()
	process.chdir(directory)
	try {
		return await run()
	} finally {
		process.chdir(previous)
	}
}

/** The inline `<style>` of the document that holds the scoped `.card` rule. */
function cardStyle(html: string): string {
	const style = [...html.matchAll(/<style[^>]*>([\s\S]*?)<\/style>/g)].map((match) => match[1]!).find((css) => css.includes('.card['))
	assert.ok(style, html)
	return style
}

describe('Tailwind CSS 4 with @tailwindcss/postcss', () => {
	test('builds and prerenders utilities, @theme, a scoped @apply, a bind:class literal and meekoUtilities()', { timeout: 180_000 }, async () => {
		const root = await tailwindProject('tailwind-build')
		const result = await inDirectory(root, () => buildProject(root, { adapter: 'static' }))
		const assets = join(result.output, 'assets')
		const styles = (await readdir(assets)).filter((file) => file.endsWith('.css'))
		const css = (await Promise.all(styles.map((file) => readFile(join(assets, file), 'utf8')))).join('\n')
		const html = await readFile(join(result.output, 'index.html'), 'utf8')

		// SSR: the markup keeps the utilities and links the CSS asset.
		assert.match(html, /<main class="flex gap-gutter text-white bg-brand meeko-probe"/)
		assert.ok(
			styles.some((file) => html.includes(file)),
			html,
		)
		// @theme in main.css: its variables and the utilities that use them.
		assert.match(css, /--color-brand:\s*#0a7c66/)
		assert.match(css, /--spacing-gutter:\s*1\.375rem/)
		assert.match(css, /\.bg-brand\s*\{\s*background-color:\s*var\(--color-brand\)/)
		assert.match(css, /\.gap-gutter\s*\{\s*gap:\s*var\(--spacing-gutter\)/)
		assert.match(css, /\.flex\s*\{\s*display:\s*flex/)
		// A class written only in a bind:class literal is generated too, and SSR joins it with the
		// static class of the same element in a single attribute.
		assert.match(html, /<article class="card ring-4"/)
		assert.equal(html.match(/<article [^>]*>/)![0].match(/ class="/g)?.length, 1)
		assert.match(css, /\.ring-4\s*\{/)
		// A scoped <style> with @reference and @apply keeps the scope and emits no theme or preflight.
		const scoped = /\.card\[data-meeko-s-[0-9a-f]+\]\s*\{([^}]*)\}/.exec(css)
		assert.ok(scoped, css)
		assert.match(scoped[1]!, /border-radius:\s*var\(--radius-lg[,)]/)
		assert.match(scoped[1]!, /background-color:\s*var\(--color-brand[,)]/)
		assert.match(scoped[1]!, /padding:\s*var\(--spacing-gutter[,)]/)
		assert.match(html, /<article class="card ring-4"[^>]*\sdata-meeko-s-[0-9a-f]+/)
		assert.equal(css.match(/--color-brand:\s*#0a7c66/g)?.length, 1, 'the @reference block adds no second theme')
		// meekoUtilities() runs before Tailwind and keeps its generated rule.
		assert.match(css, /\.meeko-probe\s*\{[^}]*border-top-width:\s*3px/)
		assert.doesNotMatch(css, /@utilities|@apply|@reference|@theme|@import/)
		compile(await readFile(join(root, 'app/components/Card.meeko'), 'utf8'), 'Card.meeko')
	})

	test('the prerendered document inlines the scoped <style> processed by PostCSS', { timeout: 180_000 }, async () => {
		const root = await tailwindProject('tailwind-ssr-style')
		const result = await inDirectory(root, () => buildProject(root, { adapter: 'static' }))
		const html = await readFile(join(result.output, 'index.html'), 'utf8')
		assert.doesNotMatch(html, /@apply|@reference/)
		const style = cardStyle(html)
		assert.match(style, /\.card\[data-meeko-s-[0-9a-f]+\]\s*\{[^}]*border-radius:\s*var\(--radius-lg[,)]/)
		assert.match(style, /background-color:\s*var\(--color-brand[,)]/)
		// The @reference block adds no theme or preflight to the component's inline style.
		assert.doesNotMatch(style, /--color-brand:\s*#0a7c66/)
	})

	/**
	 * The fixture with range media queries in Card's scoped style (max-sm and one written by hand),
	 * and a PostCSS plugin after Tailwind that adds `</style` to that style in a string and a comment,
	 * which no .meeko source can hold inside its own <style>.
	 */
	async function rangeProject(prefix: string): Promise<string> {
		const root = await tailwindProject(prefix)
		const card = await readFile(join(root, 'app/components/Card.meeko'), 'utf8')
		await put(root, 'app/components/Card.meeko', card.replace('</style>', '.card span {\n\t@apply max-sm:hidden;\n}\n\n@media (width < 30rem) {\n\t.card {\n\t\tcolor: red;\n\t}\n}\n</style>'))
		await put(
			root,
			'postcss.config.mjs',
			[
				`import { meekoUtilities } from '@meekojs/meeko/postcss'`,
				`import tailwindcss from '@tailwindcss/postcss'`,
				``,
				`const closing = {`,
				`\tpostcssPlugin: 'closing-probe',`,
				`\tOnceExit(root) {`,
				`\t\tif (!root.toString().includes('.card[data-meeko-s-')) return`,
				`\t\tconst source = root.source`,
				`\t\troot.append({ text: 'a comment with </STYLE>', source })`,
				`\t\troot.append({ selector: '.card::after', source, nodes: [{ prop: 'content', value: "'</style><b>x</b>'", source }] })`,
				`\t},`,
				`}`,
				``,
				`export default { plugins: [meekoUtilities(), tailwindcss(), closing] }`,
				``,
			].join('\n'),
		)
		return root
	}

	/** Checks Card's inline style: range conditions as written and `</style` unable to close the element. */
	function assertRangeStyle(html: string): string {
		const style = cardStyle(html)
		// A `<` stays the delimiter of a range condition, never the \3C identifier the browser rejects.
		assert.doesNotMatch(html, /width\s*\\3C/i)
		// The string and the comment cannot close the element.
		assert.match(style, /\.card(?:\[[^\]]+\])?::?after\s*\{\s*content:\s*["'](?:<\\\/|\\3c ?\/)style><b>x<\/b>["']/i)
		assert.doesNotMatch(style, /<\/style/i)
		assert.doesNotMatch(html, /<\/style><b>/i)
		return style
	}

	test('the prerendered <style> keeps range media queries, escapes only </style and matches the CSP hashes', { timeout: 180_000 }, async () => {
		const root = await rangeProject('tailwind-ssr-range')
		await put(root, 'meeko.config.mjs', `export default { server: { adapter: 'static', headerFiles: ['_headers'], contentSecurityPolicy: { 'default-src': ["'self'"], 'img-src': ["'self'", 'data:'], 'style-src': ["'self'"] } } }\n`)
		const result = await inDirectory(root, () => buildProject(root, { adapter: 'static' }))
		const html = await readFile(join(result.output, 'index.html'), 'utf8')
		const style = assertRangeStyle(html)
		// Tailwind optimizes range conditions in a build; any of these forms is a valid condition.
		for (const size of ['40rem', '30rem']) assert.match(style, new RegExp(`\\(width\\s*<\\s*${size}\\)|not all and \\((?:width\\s*>=\\s*|min-width:\\s*)${size}\\)`))
		// The CSP lists the hash of every inline <style>, computed from the final document.
		const headers = await readFile(join(result.output, '_headers'), 'utf8')
		assert.match(headers, /style-src 'self' 'sha256-/)
		const styles = [...html.matchAll(/<style[^>]*>([\s\S]*?)<\/style>/g)].map((match) => match[1]!)
		assert.ok(styles.includes(style))
		for (const text of styles) assert.ok(headers.includes(`'sha256-${createHash('sha256').update(text, 'utf8').digest('base64')}'`), headers)
	})

	test('the meeko dev SSR <style> keeps the max-sm range condition and escapes only </style', { timeout: 120_000 }, async () => {
		const root = await rangeProject('tailwind-dev-range')
		const bridge = process.env.MEEKO_EDITOR_BRIDGE
		// A previous `vite build` in this process leaves NODE_ENV=production, and then Tailwind
		// optimizes as in a build; `meeko dev` from a shell runs without it.
		const environment = process.env.NODE_ENV
		delete process.env.NODE_ENV
		process.env.MEEKO_EDITOR_BRIDGE = '0'
		const server = await inDirectory(root, () => startProject(root, false))
		try {
			const origin = `http://127.0.0.1:${developmentServerPorts(server)!.port}`
			const style = assertRangeStyle(await (await fetch(`${origin}/`)).text())
			// Without optimization, Tailwind writes max-sm as a range condition with `<`, and the
			// one written by hand reaches the document as written.
			assert.match(style, /@media \(width < 40rem\)/)
			assert.match(style, /@media \(width < 30rem\)/)
		} finally {
			await stopDevelopmentServer(server)
			if (bridge === undefined) delete process.env.MEEKO_EDITOR_BRIDGE
			else process.env.MEEKO_EDITOR_BRIDGE = bridge
			if (environment !== undefined) process.env.NODE_ENV = environment
		}
	})

	test('the Node build inlines the scoped <style> processed by PostCSS in an SSR response', { timeout: 180_000 }, async () => {
		const root = await tailwindProject('tailwind-node-ssr-style')
		await put(root, 'app/pages/live.meeko', `<template>\n\t<main>\n\t\t<Card\n\t\t\ttone="soft"\n\t\t\ttitle="Live"\n\t\t/>\n\t</main>\n</template>\n`)
		await put(root, 'meeko.config.mjs', `export default { server: { adapter: 'node' } }\n`)
		// Production needs a persistent session store; a memory one marked persistent is enough here.
		await put(root, 'server/runtime.ts', `import { defineServerRuntime, MemorySessionStore, SessionManager } from '@meekojs/meeko/server'\n\nexport default defineServerRuntime(({ production }) => {\n\tconst memory = new MemorySessionStore()\n\treturn { sessions: new SessionManager({ secure: false, production, store: { persistent: true, get: (id) => memory.get(id), set: (record) => memory.set(record), delete: (id) => memory.delete(id), replace: (oldId, record) => memory.replace(oldId, record), revokeFamily: (familyId) => memory.revokeFamily(familyId), close: () => memory.close() } }) }\n})\n`)
		await inDirectory(root, () => buildProject(root, { adapter: 'node' }))
		const port = process.env.MEEKO_PORT
		process.env.MEEKO_PORT = '0'
		const server = await startProject(root, true)
		try {
			const address = server.address()
			assert.ok(address && typeof address === 'object')
			const html = await (await fetch(`http://127.0.0.1:${address.port}/live`)).text()
			// tone="soft": the dynamic class is absent and the static one stays.
			assert.match(html, /<article class="card"[\s>]/)
			assert.doesNotMatch(html, /@apply|@reference/)
			assert.match(cardStyle(html), /\.card\[data-meeko-s-[0-9a-f]+\]\s*\{[^}]*border-radius:\s*var\(--radius-lg[,)]/)
		} finally {
			await new Promise((done) => server.close(done))
			if (port === undefined) delete process.env.MEEKO_PORT
			else process.env.MEEKO_PORT = port
		}
	})

	test('the meeko dev SSR document inlines the scoped <style> processed by PostCSS', { timeout: 120_000 }, async () => {
		const root = await tailwindProject('tailwind-dev-ssr-style')
		const bridge = process.env.MEEKO_EDITOR_BRIDGE
		process.env.MEEKO_EDITOR_BRIDGE = '0'
		const server = await inDirectory(root, () => startProject(root, false))
		try {
			const origin = `http://127.0.0.1:${developmentServerPorts(server)!.port}`
			const html = await (await fetch(`${origin}/`)).text()
			assert.doesNotMatch(html, /@apply|@reference/)
			assert.match(cardStyle(html), /\.card\[data-meeko-s-[0-9a-f]+\]\s*\{[^}]*border-radius/)
		} finally {
			await stopDevelopmentServer(server)
			if (bridge === undefined) delete process.env.MEEKO_EDITOR_BRIDGE
			else process.env.MEEKO_EDITOR_BRIDGE = bridge
		}
	})
})

describe('Tailwind CSS 4 with @tailwindcss/vite registered by a module', () => {
	/** The fixture without postcss.config, with the Vite plugin added by a local module. */
	async function viteProject(prefix: string): Promise<string> {
		const root = await tailwindProject(prefix)
		await linkRepositoryPackages(root, ['@tailwindcss/vite'])
		await rm(join(root, 'postcss.config.mjs'))
		await put(root, 'app/styles/main.css', `@import 'tailwindcss';\n\n@theme {\n\t--color-brand: #0a7c66;\n\t--spacing-gutter: 1.375rem;\n}\n`)
		await put(root, 'modules/tailwind.mjs', `import { defineMeekoModule } from '@meekojs/meeko/framework'\nimport tailwindcss from '@tailwindcss/vite'\n\nexport default defineMeekoModule({\n\tmeta: { name: 'tailwind' },\n\tsetup(_options, meeko) {\n\t\tmeeko.addVitePlugin(tailwindcss())\n\t},\n})\n`)
		await put(root, 'meeko.config.mjs', `import tailwind from './modules/tailwind.mjs'\n\nexport default { modules: [tailwind] }\n`)
		await put(root, 'app/pages/index.meeko', (await readFile(join(root, 'app/pages/index.meeko'), 'utf8')).replace(' meeko-probe', ''))
		return root
	}

	test('builds utilities, @theme, a bind:class literal and a scoped @apply', { timeout: 180_000 }, async () => {
		const root = await viteProject('tailwind-vite-build')
		const result = await inDirectory(root, () => buildProject(root, { adapter: 'static' }))
		const assets = join(result.output, 'assets')
		const styles = (await readdir(assets)).filter((file) => file.endsWith('.css'))
		const css = (await Promise.all(styles.map((file) => readFile(join(assets, file), 'utf8')))).join('\n')
		assert.match(css, /--color-brand:\s*#0a7c66/)
		assert.match(css, /\.bg-brand\s*\{\s*background-color:\s*var\(--color-brand\)/)
		assert.match(css, /\.ring-4\s*\{/)
		assert.match(css, /\.card\[data-meeko-s-[0-9a-f]+\]\s*\{[^}]*border-radius:\s*var\(--radius-lg[,)]/)
		assert.doesNotMatch(css, /@apply|@reference|@theme|@import/)
		// The Vite plugin processes the component's inline style for the prerendered document too.
		const html = await readFile(join(result.output, 'index.html'), 'utf8')
		assert.doesNotMatch(html, /@apply|@reference/)
		assert.match(cardStyle(html), /\.card\[data-meeko-s-[0-9a-f]+\]\s*\{[^}]*border-radius:\s*var\(--radius-lg[,)]/)
	})

	test('meeko dev serves the global stylesheet and the scoped style processed by Tailwind', { timeout: 120_000 }, async () => {
		const root = await viteProject('tailwind-vite-dev')
		const bridge = process.env.MEEKO_EDITOR_BRIDGE
		process.env.MEEKO_EDITOR_BRIDGE = '0'
		const server = await inDirectory(root, () => startProject(root, false))
		try {
			const origin = `http://127.0.0.1:${developmentServerPorts(server)!.port}`
			const global = await (await fetch(`${origin}/app/styles/main.css?direct`)).text()
			assert.match(global, /\.bg-brand\s*\{\s*background-color:\s*var\(--color-brand\)/)
			assert.match(global, /\.ring-4\s*\{/)
			const component = await (await fetch(`${origin}/app/components/Card.meeko?import`)).text()
			const id = /import "([^"]*\?meeko-style=[0-9a-f]{64}&lang\.css)"/.exec(component)?.[1]
			assert.ok(id, component)
			const style = await (await fetch(`${origin}${id}`)).text()
			assert.match(style, /\.card\[data-meeko-s-[0-9a-f]+\]\s*\{[^}]*border-radius/)
			assert.doesNotMatch(style, /@apply/)
		} finally {
			await stopDevelopmentServer(server)
			if (bridge === undefined) delete process.env.MEEKO_EDITOR_BRIDGE
			else process.env.MEEKO_EDITOR_BRIDGE = bridge
		}
	})
})

describe('meekoSortClasses tailwind', () => {
	/** Formats, checks that a second pass changes nothing and returns the template. */
	async function template(source: string, options: FormatOptions): Promise<string> {
		const settings: FormatOptions = { plugins: [plugin], ...options }
		const formatted = await prettier.format(source, settings)
		assert.equal(await prettier.format(formatted, settings), formatted, 'formatting is idempotent')
		return formatted.slice(formatted.indexOf('<template>\n') + 11, formatted.indexOf('\n</template>'))
	}

	const component = (classes: string): string => `<template>\n<div class="${classes}" bind:class="'z-10 flex'">x</div>\n</template>\n`
	const unsorted = 'hover:bg-brand/80 text-white custom p-gutter meeko-probe bg-brand  flex md:flex custom'

	test('orders as Tailwind 4 with the project @theme, unknown classes first in their order', async () => {
		const root = await tailwindProject('tailwind-prettier')
		const filepath = join(root, 'app/components/Box.meeko')
		const sorted = await template(component(unsorted), { filepath, meekoSortClasses: 'tailwind' })
		// Unknown first (custom, meeko-probe) in their order; then layout, background, spacing, color, variants.
		assert.equal(sorted, `<div\n  class="custom meeko-probe flex bg-brand p-gutter text-white hover:bg-brand/80 md:flex"\n  bind:class="'z-10 flex'"\n  >x</div\n>`)
		// off keeps the order and only normalizes.
		assert.match(await template(component(unsorted), { filepath }), /class="hover:bg-brand\/80 text-white custom p-gutter meeko-probe bg-brand flex md:flex"/)
		assert.deepEqual(
			warnings.filter((warning) => warning.includes(root)),
			[],
		)

		// A configurable entry stylesheet with @plugin and @utility; a change to it is picked up.
		await put(root, 'app/styles/plugin.mjs', `import plugin from 'tailwindcss/plugin'\nexport default plugin(({ addUtilities }) => addUtilities({ '.plugin-probe': { display: 'contents' } }))\n`)
		await put(root, 'app/styles/tailwind.css', `@import 'tailwindcss';\n@plugin './plugin.mjs';\n`)
		const options: FormatOptions = { filepath, meekoSortClasses: 'tailwind', meekoTailwindStylesheet: 'app/styles/tailwind.css' }
		const custom = 'stack-probe plugin-probe bg-brand flex'
		// Without @theme bg-brand is unknown; without @utility stack-probe is unknown too.
		assert.match(await template(component(custom), options), /class="stack-probe bg-brand flex plugin-probe"/)
		await touch(root, 'app/styles/tailwind.css', `@import 'tailwindcss';\n@plugin './plugin.mjs';\n@theme { --color-brand: #000; }\n@utility stack-probe { display: grid; }\n`)
		// Tailwind orders by property: every `display` utility (core, @plugin, @utility) before `background-color`.
		assert.match(await template(component(custom), options), /class="flex plugin-probe stack-probe bg-brand"/)

		// The editor sorts in a trusted workspace with the project's configuration, never in an untrusted one.
		await put(root, '.prettierrc', '{ "meekoSortClasses": "tailwind" }\n')
		const source = component(unsorted)
		const trusted = await formatWithPrettier({ text: source, filename: filepath, tabSize: 2, insertSpaces: true, trusted: true })
		assert.match(trusted!.text, /class="custom meeko-probe flex bg-brand p-gutter text-white hover:bg-brand\/80 md:flex"/)
		const untrusted = await formatWithPrettier({ text: source, filename: filepath, tabSize: 2, insertSpaces: true, trusted: false })
		assert.match(untrusted!.text, /class="hover:bg-brand\/80 text-white custom p-gutter meeko-probe bg-brand flex md:flex"/)
		assert.deepEqual(
			warnings.filter((warning) => warning.includes(root)),
			[],
		)
	})

	test('a missing stylesheet or one Tailwind rejects keeps the order and warns once', async () => {
		const root = await tailwindProject('tailwind-prettier-broken')
		const filepath = join(root, 'app/pages/index.meeko')
		const keep = /class="hover:bg-brand\/80 text-white custom p-gutter meeko-probe bg-brand flex md:flex"/
		const missing: FormatOptions = { filepath, meekoSortClasses: 'tailwind', meekoTailwindStylesheet: 'app/styles/none.css' }
		assert.match(await template(component(unsorted), missing), keep)
		assert.match(await template(component(unsorted), missing), keep)
		await put(root, 'app/styles/broken.css', `@import 'tailwindcss';\n@plugin './missing-plugin.mjs';\n`)
		const broken: FormatOptions = { filepath, meekoSortClasses: 'tailwind', meekoTailwindStylesheet: 'app/styles/broken.css' }
		assert.match(await template(component(unsorted), broken), keep)
		const own = warnings.filter((warning) => warning.includes(root))
		assert.equal(own.length, 2, own.join(''))
		assert.match(own[0]!, /meekoSortClasses "tailwind" no ordena las clases: no existe app\/styles\/none\.css/)
		assert.match(own[1]!, /no se pudo cargar Tailwind desde app\/styles\/broken\.css/)
	})

	test('without @tailwindcss/node, a changed @plugin module is imported again', async () => {
		// Outside the test projects, whose node_modules mirrors the repository's (with @tailwindcss/postcss).
		const root = await mkdtemp(join(tmpdir(), 'meeko-tailwind-plugin-'))
		try {
			await linkRepositoryPackages(root, ['tailwindcss'])
			assert.throws(() => createRequire(join(root, 'noop.js')).resolve('@tailwindcss/node'), 'the fallback without @tailwindcss/node is the path under test')
			await put(root, 'meeko.config.ts', 'export default {}\n')
			await put(root, 'app/styles/main.css', `@import 'tailwindcss';\n@plugin './plugin.mjs';\n`)
			const plugin = (name: string): string => `import plugin from 'tailwindcss/plugin'\nexport default plugin(({ addUtilities }) => addUtilities({ '.${name}': { display: 'contents' } }))\n`
			await put(root, 'app/styles/plugin.mjs', plugin('other-probe'))
			const options: FormatOptions = { filepath: join(root, 'app/Box.meeko'), meekoSortClasses: 'tailwind' }
			// Unknown, plugin-probe goes first.
			assert.match(await template(component('bg-red-500 plugin-probe flex'), options), /class="plugin-probe flex bg-red-500"/)
			await touch(root, 'app/styles/plugin.mjs', plugin('plugin-probe'))
			// The new module defines it: a `display` utility, after the core one and before `background-color`.
			assert.match(await template(component('bg-red-500 plugin-probe flex'), options), /class="flex plugin-probe bg-red-500"/)
			assert.deepEqual(
				warnings.filter((warning) => warning.includes(root)),
				[],
			)
		} finally {
			await rm(root, { recursive: true, force: true })
		}
	})

	test('without tailwindcss installed keeps the order and warns once', async () => {
		// Outside the test projects, whose node_modules mirrors the repository's (with tailwindcss).
		const root = await mkdtemp(join(tmpdir(), 'meeko-no-tailwind-'))
		try {
			await put(root, 'meeko.config.ts', 'export default {}\n')
			await put(root, 'app/styles/main.css', `@import 'tailwindcss';\n`)
			const options: FormatOptions = { filepath: join(root, 'app/Box.meeko'), meekoSortClasses: 'tailwind' }
			assert.match(await template(component('text-white flex'), options), /class="text-white flex"/)
			assert.match(await template(component('text-white flex'), options), /class="text-white flex"/)
			const own = warnings.filter((warning) => warning.includes(root))
			assert.equal(own.length, 1, own.join(''))
			assert.match(own[0]!, /tailwindcss no está instalado/)
		} finally {
			await rm(root, { recursive: true, force: true })
		}
	})
})
