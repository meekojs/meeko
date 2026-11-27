import assert from 'node:assert/strict'
import { mkdir, mkdtemp, rm, utimes, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { after, before, describe, test } from 'node:test'
import * as prettier from 'prettier'

import type { MeekoPrettierOptions } from '../src/prettier.ts'

import { compile } from '../src/compiler.ts'
import { classOrderWarnings } from '../src/formatters/prettier/classes.ts'
import { formatWithPrettier } from '../src/formatters/prettier/editor.ts'
import plugin from '../src/prettier.ts'
import { createTempProject, linkRepositoryPackages, type TempProject } from './helpers/temp-project.ts'

type FormatOptions = prettier.Options & MeekoPrettierOptions

/** Formatea, comprueba que una segunda pasada no cambia nada y que el resultado compila. */
async function formatStable(source: string, options: FormatOptions = {}): Promise<string> {
	const settings: FormatOptions = { filepath: 'Component.meeko', plugins: [plugin], ...options }
	const formatted = await prettier.format(source, settings)
	assert.equal(await prettier.format(formatted, settings), formatted, 'formatting is idempotent')
	compile(formatted, settings.filepath!)
	return formatted
}

/** Plantilla formateada, sin las etiquetas de sección. */
function templateOf(formatted: string): string {
	return formatted.slice(formatted.indexOf('<template>\n') + 11, formatted.indexOf('\n</template>'))
}

const warnings: string[] = []
const write = classOrderWarnings.write
before(() => {
	classOrderWarnings.write = (message) => {
		warnings.push(message)
	}
})
after(() => {
	classOrderWarnings.write = write
})

describe('static class attributes', () => {
	test('collapse whitespace, trim and drop repeated classes', async () => {
		const template = templateOf(await formatStable('<template>\n<div class="  card   stack">a</div>\n<p class="one\ttwo\n   three one  two">b</p>\n<span class="">c</span>\n<i class=" \t\n "></i>\n<b class>d</b>\n</template>\n'))
		assert.equal(
			template,
			[
				'<div class="card stack">a</div>',
				'<p class="one two three">b</p>',
				'<span class="">c</span>',
				'<i class=""></i>',
				'<b class>d</b>',
			].join('\n'),
		)
	})

	test('keep a non-ASCII space inside a class, as HTML does', async () => {
		const template = templateOf(await formatStable('<template>\n<p class="a b  c">x</p>\n</template>\n'))
		assert.equal(template, '<p class="a b c">x</p>')
	})

	test('leave bind:class, other attributes, component props and character references alone', async () => {
		const source = [
			'<script lang="ts">',
			'import Card from "./Card.meeko";',
			'const tone = "a  b";',
			'</script>',
			'<template>',
			'<div><span bind:class="tone" title="a  b  a" data-class="x  x">y</span><Card class="x  x" /><component is="Card" class="y  y"></component><p class="a &amp;  b">z</p></div>',
			'</template>',
			'',
		].join('\n')
		const template = templateOf(await formatStable(source, { printWidth: 200 }))
		assert.ok(template.includes('<span bind:class="tone" title="a  b  a" data-class="x  x">y</span>'), template)
		assert.ok(template.includes('<Card class="x  x" />'), template)
		assert.ok(template.includes('<component is="Card" class="y  y"></component>'), template)
		assert.ok(template.includes('<p class="a &amp;  b">z</p>'), template)
	})

	test('meekoSortClasses alphabetical sorts by code unit and off keeps the order', async () => {
		const source = '<template>\n<p class="b  B a-2 a  b">x</p>\n</template>\n'
		assert.equal(templateOf(await formatStable(source, { meekoSortClasses: 'alphabetical' })), '<p class="B a a-2 b">x</p>')
		assert.equal(templateOf(await formatStable(source)), '<p class="b B a-2 a">x</p>')
	})

	test('the option is a stable choice, off by default', () => {
		const option = plugin.options?.meekoSortClasses as { type?: string; default?: unknown; choices?: Array<{ value: unknown }> } | undefined
		assert.deepEqual(
			{ type: option?.type, default: option?.default, choices: option?.choices?.map((choice) => choice.value) },
			{
				type: 'choice',
				default: 'off',
				choices: ['off', 'stylesheet', 'alphabetical'],
			},
		)
		assert.equal('meekoTailwindStylesheet' in (plugin.options ?? {}), false)
	})

	test('the removed "tailwind" mode is rejected as an invalid option value, never mapped to another mode', async () => {
		const source = '<template>\n<p class="b a">x</p>\n</template>\n'
		await assert.rejects(prettier.format(source, { filepath: 'Component.meeko', plugins: [plugin], meekoSortClasses: 'tailwind' } as unknown as FormatOptions), /Invalid \S*meekoSortClasses\S* value/)
		const root = await mkdtemp(join(tmpdir(), 'meeko-removed-sort-mode-'))
		try {
			await writeFile(join(root, 'meeko.config.ts'), 'export default {}\n')
			await writeFile(join(root, '.prettierrc.json'), JSON.stringify({ meekoSortClasses: 'tailwind' }))
			await assert.rejects(formatWithPrettier({ text: source, filename: join(root, 'Component.meeko'), tabSize: 2, insertSpaces: true, trusted: true }), /Invalid \S*meekoSortClasses\S* value/)
		} finally {
			await rm(root, { recursive: true, force: true })
		}
	})
})

describe('meekoSortClasses stylesheet', () => {
	const projects: TempProject[] = []
	after(async () => {
		await Promise.all(projects.map((project) => project.remove()))
	})

	async function project(prefix: string, files: Record<string, string>): Promise<string> {
		const created = await createTempProject(prefix)
		projects.push(created)
		await linkRepositoryPackages(created.root)
		const all: Record<string, string> = { 'package.json': '{"private":true,"type":"module","devDependencies":{"@meekojs/meeko":"*"}}\n', ...files }
		for (const [path, contents] of Object.entries(all)) {
			await mkdir(dirname(join(created.root, path)), { recursive: true })
			await writeFile(join(created.root, path), contents)
		}
		return created.root
	}

	const stylesheetProject: Record<string, string> = {
		// The configuration a project writes; the counter shows how often the stylesheet is processed.
		'postcss.config.ts': `import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
const counter = { postcssPlugin: "count", Once() { (globalThis as Record<string, number>).__meekoStylesheetRuns = ((globalThis as Record<string, number>).__meekoStylesheetRuns ?? 0) + 1; } };
// A plugin of the project that writes rules from a file it reads, and declares it as a dependency.
const tones = {
	postcssPlugin: "tones",
	AtRule: {
		tones(rule: any, { result, Rule, Declaration }: any) {
			const file = resolve(dirname(rule.source.input.file), rule.params.slice(1, -1));
			result.messages.push({ type: "dependency", plugin: "tones", file, parent: rule.source.input.file });
			const names: string[] = JSON.parse(readFileSync(file, "utf8"));
			rule.replaceWith(names.map((name) => new Rule({ selector: "." + name, nodes: [new Declaration({ prop: "color", value: "green" })] })));
		},
	},
};
export default { plugins: [tones, counter] };
`,
		'app/styles/main.css': `@import "./base.css";\n.zeta { color: red; }\n@tones "./tones/names.json";\n.alpha { color: blue; }\n`,
		'app/styles/base.css': `.stack { display: grid; }\n.card .title { margin: 0; }\n`,
		'app/styles/tones/names.json': `["tone-b", "tone-a"]\n`,
	}

	const component = [
		'<template>',
		'<div class="extra alpha tone-a  local stack zeta other card tone-b alpha">x</div>',
		'</template>',
		'<style scoped>',
		'.local { color: red; }',
		'.stack { color: blue; }',
		'</style>',
		'',
	].join('\n')

	const runs = (): number => (globalThis as { __meekoStylesheetRuns?: number }).__meekoStylesheetRuns ?? 0

	test("orders known classes as the processed stylesheet, unknown first and the component's after", async () => {
		const root = await project('prettier-classes-', stylesheetProject)
		const filepath = join(root, 'app', 'components', 'Box.meeko')
		const options: FormatOptions = { filepath, meekoSortClasses: 'stylesheet' }
		const sorted = '<div class="extra other stack card zeta tone-b tone-a alpha local">x</div>'
		const before = runs()
		assert.equal(templateOf(await formatStable(component, options)), sorted)
		// Every later format reuses the processed stylesheet while none of its files changes.
		assert.equal(templateOf(await formatStable(component, options)), sorted)
		assert.equal(runs() - before, 1, 'the stylesheet is processed once')
		assert.equal(templateOf(await formatStable(component, { filepath })), '<div class="extra alpha tone-a local stack zeta other card tone-b">x</div>', 'off keeps the order')

		// A file that a PostCSS plugin of the project declares as a dependency changes: the order follows it.
		const names = join(root, 'app/styles/tones/names.json')
		await writeFile(names, `["tone-a", "tone-b"]\n`)
		const later = new Date(Date.now() + 2_000)
		await utimes(names, later, later)
		assert.equal(templateOf(await formatStable(component, options)), '<div class="extra other stack card zeta tone-a tone-b alpha local">x</div>')
		assert.equal(runs() - before, 2)
		assert.deepEqual(
			warnings.filter((warning) => warning.includes(root)),
			[],
		)

		// The language server sorts in a trusted workspace with the project's configuration, never in an untrusted one.
		await writeFile(join(root, '.prettierrc'), '{ "meekoSortClasses": "stylesheet" }\n')
		const trusted = await formatWithPrettier({ text: component, filename: filepath, tabSize: 2, insertSpaces: true, trusted: true })
		assert.equal(templateOf(trusted!.text), '<div class="extra other stack card zeta tone-a tone-b alpha local">x</div>')
		const untrusted = await formatWithPrettier({ text: component, filename: filepath, tabSize: 2, insertSpaces: true, trusted: false })
		assert.equal(templateOf(untrusted!.text), '<div class="extra alpha tone-a local stack zeta other card tone-b">x</div>')
	})

	// What `meeko dev` writes after the whole Vite pipeline: utilities that the project's own PostCSS processing never produces.
	const devSheet = '.meeko/styles/main.css'
	const devCss = (...classes: string[]): string => `/* Generated by meeko dev */\n@layer theme, utilities;\n${classes.map((name) => `.${name.replaceAll(':', '\\:')} { color: red; }`).join('\n')}\n`
	const utilities = '<template>\n<div class="hover:underline  p-4 extra flex alpha zeta p-4">x</div>\n</template>\n'
	const dated = async (file: string, seconds: number): Promise<void> => {
		await utimes(file, seconds, seconds)
	}
	const now = Math.floor(Date.now() / 1000)
	const unsorted = '<div class="hover:underline p-4 extra flex zeta alpha">x</div>'

	test('uses the stylesheet of meeko dev when it exists, without running the project, and follows its changes', async () => {
		const root = await project('prettier-classes-dev-', { ...stylesheetProject, [devSheet]: devCss('flex', 'p-4', 'zeta', 'hover:underline') })
		const filepath = join(root, 'app', 'components', 'Box.meeko')
		const options: FormatOptions = { filepath, meekoSortClasses: 'stylesheet' }
		await dated(join(root, devSheet), now + 10)
		const before = runs()
		// `flex`, `p-4` and `hover:underline` exist only in the stylesheet of meeko dev; `alpha` only in the processed one.
		assert.equal(templateOf(await formatStable(utilities, options)), '<div class="extra alpha flex p-4 zeta hover:underline">x</div>')
		assert.equal(runs(), before, 'nothing of the project runs while the stylesheet of meeko dev is used')

		// The stylesheet of meeko dev changes: the cached order is dropped.
		await writeFile(join(root, devSheet), devCss('hover:underline', 'zeta', 'p-4', 'flex'))
		await dated(join(root, devSheet), now + 20)
		assert.equal(templateOf(await formatStable(utilities, options)), '<div class="extra alpha hover:underline zeta p-4 flex">x</div>')

		// It is removed: the stylesheet of the project is processed again, where the utilities are unknown.
		await rm(join(root, devSheet))
		assert.equal(templateOf(await formatStable(utilities, options)), '<div class="hover:underline p-4 extra flex zeta alpha">x</div>')
		assert.equal(runs() - before, 1)
		// And created again.
		await writeFile(join(root, devSheet), devCss('flex', 'p-4'))
		await dated(join(root, devSheet), now + 30)
		assert.equal(templateOf(await formatStable(utilities, options)), '<div class="hover:underline extra alpha zeta flex p-4">x</div>')
		assert.deepEqual(
			warnings.filter((warning) => warning.includes(root)),
			[],
		)
	})

	test('sorts by the stylesheet of meeko dev when the application has no app/styles/main.css', async () => {
		const root = await project('prettier-classes-dev-only-', { 'meeko.config.ts': 'export default {};\n', [devSheet]: devCss('flex', 'p-4') })
		const options: FormatOptions = { filepath: join(root, 'app', 'pages', 'index.meeko'), meekoSortClasses: 'stylesheet' }
		assert.equal(templateOf(await formatStable(utilities, options)), '<div class="hover:underline extra alpha zeta flex p-4">x</div>')
		assert.deepEqual(
			warnings.filter((warning) => warning.includes(root)),
			[],
		)
	})

	test('a stylesheet of meeko dev older than app/styles/main.css still sorts, and warns once', async () => {
		const root = await project('prettier-classes-stale-', { ...stylesheetProject, [devSheet]: devCss('p-4', 'flex') })
		const options: FormatOptions = { filepath: join(root, 'app', 'components', 'Box.meeko'), meekoSortClasses: 'stylesheet' }
		await dated(join(root, devSheet), now - 100)
		await dated(join(root, 'app/styles/main.css'), now)
		assert.equal(templateOf(await formatStable(utilities, options)), '<div class="hover:underline extra alpha zeta p-4 flex">x</div>')
		assert.equal(templateOf(await formatStable(utilities, options)), '<div class="hover:underline extra alpha zeta p-4 flex">x</div>')
		const own = warnings.filter((warning) => warning.includes(root))
		assert.equal(own.length, 1, own.join(''))
		assert.match(own[0]!, /ordena con \.meeko\/styles\/main\.css en .*anterior a app\/styles\/main\.css.*meeko dev/)
		// Once meeko dev writes it again, it is as fresh as the stylesheet and the next format reads it.
		await writeFile(join(root, devSheet), devCss('flex', 'p-4', 'hover:underline'))
		await dated(join(root, devSheet), now + 50)
		assert.equal(templateOf(await formatStable(utilities, options)), '<div class="extra alpha zeta flex p-4 hover:underline">x</div>')
	})

	test('a stylesheet of meeko dev that is unusable falls back to processing app/styles/main.css', async () => {
		// Without classes: silently. That is what meeko dev writes for a project whose sheets name none.
		const empty = await project('prettier-classes-dev-empty-', { ...stylesheetProject, [devSheet]: '/* Generated by meeko dev */\n:root { color: red; }\n' })
		const emptyOptions: FormatOptions = { filepath: join(empty, 'app', 'components', 'Box.meeko'), meekoSortClasses: 'stylesheet' }
		assert.equal(templateOf(await formatStable(utilities, emptyOptions)), unsorted)
		assert.deepEqual(
			warnings.filter((warning) => warning.includes(empty)),
			[],
		)
		// Not CSS: a warning, once.
		const broken = await project('prettier-classes-dev-broken-', { ...stylesheetProject, [devSheet]: '.flex { color: red;\n' })
		const brokenOptions: FormatOptions = { filepath: join(broken, 'app', 'components', 'Box.meeko'), meekoSortClasses: 'stylesheet' }
		assert.equal(templateOf(await formatStable(utilities, brokenOptions)), unsorted)
		assert.equal(templateOf(await formatStable(utilities, brokenOptions)), unsorted)
		const own = warnings.filter((warning) => warning.includes(broken))
		assert.equal(own.length, 1, own.join(''))
		assert.match(own[0]!, /no pudo usar \.meeko\/styles\/main\.css en .*no es CSS válido; se procesa app\/styles\/main\.css/)
	})

	test('an untrusted workspace sorts nothing, even with the stylesheet of meeko dev', async () => {
		// Its configuration, which holds the choice of mode, is not loaded there, so nothing asks for the sheet.
		const root = await project('prettier-classes-dev-untrusted-', { ...stylesheetProject, [devSheet]: devCss('flex', 'p-4'), '.prettierrc': '{ "meekoSortClasses": "stylesheet" }\n' })
		const filename = join(root, 'app', 'components', 'Box.meeko')
		const source = utilities
		const trusted = await formatWithPrettier({ text: source, filename, tabSize: 2, insertSpaces: true, trusted: true })
		assert.equal(templateOf(trusted!.text), '<div class="hover:underline extra alpha zeta flex p-4">x</div>')
		const untrusted = await formatWithPrettier({ text: source, filename, tabSize: 2, insertSpaces: true, trusted: false })
		assert.equal(templateOf(untrusted!.text), '<div class="hover:underline p-4 extra flex alpha zeta">x</div>')
	})

	test('with an order, the class of a component, bind:class and meekoClassFunctions are sorted too, also on saving', async () => {
		// Before 1.8 only @meekojs/prettier-plugin did it, and `prettier --check` failed right after saving.
		const root = await project('prettier-classes-functions-', { 'meeko.config.ts': 'export default {};\n' })
		const filename = join(root, 'app', 'pages', 'index.meeko')
		const source = [
			'<script lang="ts">',
			'const a = tv({ base: "b a", variants: { "z y": { x: ["d c"] } } });',
			'</script>',
			'',
			'<template>',
			"<p bind:class=\"on ? 'b a' : cn('f e')\"></p>",
			"<p bind:title=\"on ? 'b a' : 'd c'\"></p>",
			'<Card class="b  a b" />',
			'<component is="Card" class="b a"></component>',
			'</template>',
			'',
		].join('\n')
		const sorted = [
			'<script lang="ts">',
			'const a = tv({ base: "a b", variants: { "z y": { x: ["c d"] } } });',
			'</script>',
			'',
			'<template>',
			"<p bind:class=\"on ? 'a b' : cn('e f')\"></p>",
			"<p bind:title=\"on ? 'b a' : 'd c'\"></p>",
			'<Card class="a b" />',
			'<component is="Card" class="a b"></component>',
			'</template>',
			'',
		].join('\n')
		await writeFile(join(root, '.prettierrc'), '{ "meekoSortClasses": "alphabetical", "meekoClassFunctions": ["tv", "cn"] }\n')
		assert.equal((await formatWithPrettier({ text: source, filename, tabSize: 2, insertSpaces: true, trusted: true }))!.text, sorted)
		assert.equal((await formatWithPrettier({ text: sorted, filename, tabSize: 2, insertSpaces: true, trusted: true }))!.text, sorted)
		// Without an order nothing beyond the static class of an element changes; nor in an untrusted workspace.
		const untrusted = (await formatWithPrettier({ text: source, filename, tabSize: 2, insertSpaces: true, trusted: false }))!.text
		assert.ok(untrusted.includes('<Card class="b  a b" />'), untrusted)
		assert.ok(untrusted.includes('tv({ base: "b a"'), untrusted)
	})

	test('without app/styles/main.css only normalizes, and warns once', async () => {
		const root = await project('prettier-classes-missing-', { 'meeko.config.ts': 'export default {};\n' })
		const options: FormatOptions = { filepath: join(root, 'app', 'pages', 'index.meeko'), meekoSortClasses: 'stylesheet' }
		assert.equal(templateOf(await formatStable(component, options)), '<div class="extra alpha tone-a local stack zeta other card tone-b">x</div>')
		assert.equal(templateOf(await formatStable(component, options)), '<div class="extra alpha tone-a local stack zeta other card tone-b">x</div>')
		const own = warnings.filter((warning) => warning.includes(root))
		assert.equal(own.length, 1, own.join(''))
		assert.match(own[0]!, /no existe app\/styles\/main\.css/)
	})

	test('a stylesheet that does not process only normalizes, and warns once', async () => {
		const root = await project('prettier-classes-broken-', {
			'postcss.config.ts': stylesheetProject['postcss.config.ts']!,
			'app/styles/main.css': `.stack { display: grid; }\n@tones "./tones/missing.json";\n`,
		})
		const options: FormatOptions = { filepath: join(root, 'app', 'Box.meeko'), meekoSortClasses: 'stylesheet' }
		assert.equal(templateOf(await formatStable(component, options)), '<div class="extra alpha tone-a local stack zeta other card tone-b">x</div>')
		const own = warnings.filter((warning) => warning.includes(root))
		assert.equal(own.length, 1, own.join(''))
		assert.match(own[0]!, /no se pudo procesar app\/styles\/main\.css en .*ENOENT.*missing\.json/)
		// Once the stylesheet is fixed, the next format sorts.
		const stylesheet = join(root, 'app/styles/main.css')
		await writeFile(stylesheet, '.zeta { color: red; }\n.stack { display: grid; }\n')
		const later = new Date(Date.now() + 2_000)
		await utimes(stylesheet, later, later)
		assert.equal(templateOf(await formatStable(component, options)), '<div class="extra alpha tone-a other card tone-b zeta stack local">x</div>')
	})
})
