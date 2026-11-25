import * as radix from '@radix-ui/colors'
import assert from 'node:assert/strict'
import { readdir, readFile } from 'node:fs/promises'
import { createRequire } from 'node:module'
import { dirname, resolve as resolvePath } from 'node:path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'
import { compile } from 'tailwindcss'

const styles = new URL('../src/app/styles/', import.meta.url)
const components = new URL('../src/app/components/', import.meta.url)
const read = (name) => readFile(new URL(name, styles), 'utf8')

const scales = ['primary', 'surface', 'info', 'success', 'warning', 'danger', 'cyan', 'orange', 'pink']
const steps = Array.from({ length: 12 }, (_, index) => index + 1)
const WHITE = '#ffffff'
const BLACK = '#000000'

/** The body of a top-level rule, `:root` or `:root[data-theme='dark']`. */
function block(css, selector) {
	const start = css.indexOf(`${selector} {`)
	assert.notEqual(start, -1, `no ${selector} block`)
	return css.slice(start, css.indexOf('\n}', start))
}

function declarations(body) {
	return Object.fromEntries([...body.matchAll(/(--[\w-]+):\s*([^;]+);/g)].map(([, name, value]) => [name, value.trim()]))
}

const channel = (value) => (value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4)
const linear = (hex) => [1, 3, 5].map((start) => channel(parseInt(hex.slice(start, start + 2), 16) / 255))

/** WCAG relative luminance. */
function luminance(hex) {
	const [red, green, blue] = linear(hex)
	return 0.2126 * red + 0.7152 * green + 0.0722 * blue
}

/** WCAG contrast ratio. */
function contrast(first, second) {
	const [high, low] = [luminance(first), luminance(second)].sort((a, b) => b - a)
	return (high + 0.05) / (low + 0.05)
}

/** OKLCH lightness, chroma and hue in degrees. */
function oklch(hex) {
	const [red, green, blue] = linear(hex)
	const long = Math.cbrt(0.4122214708 * red + 0.5363325363 * green + 0.0514459929 * blue)
	const medium = Math.cbrt(0.2119034982 * red + 0.6806995451 * green + 0.1073969566 * blue)
	const short = Math.cbrt(0.0883024619 * red + 0.2817188376 * green + 0.6299787005 * blue)
	const a = 1.9779984951 * long - 2.428592205 * medium + 0.4505937099 * short
	const b = 0.0259040371 * long + 0.7827717662 * medium - 0.808675766 * short
	return { lightness: 0.2104542553 * long + 0.793617785 * medium - 0.0040720468 * short, chroma: Math.hypot(a, b), hue: ((Math.atan2(b, a) * 180) / Math.PI + 360) % 360 }
}

/** The rule of the tokens: white when it reaches 4.5:1, black otherwise. */
const expectedContrast = (solid) => (contrast(WHITE, solid) >= 4.5 ? WHITE : BLACK)

const paletteCss = await read('palette.css')
const tokensCss = await read('tokens.css')
const palette = { light: declarations(block(paletteCss, ':root')), dark: declarations(block(paletteCss, ":root[data-theme='dark']")) }
const tokens = { light: declarations(block(tokensCss, ':root')), dark: declarations(block(tokensCss, ":root[data-theme='dark']")) }
const color = (theme, scale, step) => palette[theme][`--ui-color-${scale}-${step}`]
const primary = (step) => color('dark', 'primary', step)

test('the rules of the prose scope are written from :scope: a class would be read as a nested prose', async () => {
	const prose = await read('prose.css')
	const scope = prose.slice(prose.indexOf('@scope ('))
	assert.ok(scope.includes(':scope h2'))
	assert.ok(!scope.includes('.meeko-ui-prose', scope.indexOf('{')))
})

test('form control borders reach 3:1 against every background and control state they sit on', () => {
	for (const theme of ['light', 'dark']) {
		const step = (tokens[theme]['--ui-color-control-border'] ?? tokens.light['--ui-color-control-border']).match(/surface-(\d+)/)[1]
		for (const background of [1, 2, 3, 4]) {
			const ratio = contrast(color(theme, 'surface', step), color(theme, 'surface', background))
			assert.ok(ratio >= 3, `${theme}: control border on surface ${background} is ${ratio.toFixed(2)}:1`)
		}
	}
})

test('every form control draws its border from --ui-color-control-border, not from a decorative border', async () => {
	const variant = (name) => readFile(new URL(`../src/app/variants/${name}.ts`, import.meta.url), 'utf8')
	const component = (name) => readFile(new URL(`../src/app/components/${name}.meeko`, import.meta.url), 'utf8')
	// The variants are on Tailwind: the border is the color control-border of theme.css.
	assert.match(await read('theme.css'), /--color-control-border: var\(--ui-color-control-border\);/)
	// <UIInput>, <UITextarea> and, through `control`, the trigger of <UISelect> and <UICombobox>.
	assert.match(await variant('input'), /border-solid border-control-border /)
	for (const name of ['Select', 'Combobox']) {
		const source = await component(name)
		assert.match(source, /import \{ control \} from '\.\.\/variants\/input'/, name)
		assert.match(source, /const triggerClass = computed\(\(\) => control\(/, name)
	}
	// A neutral outline button (theme/components/button), and through it the one of <UIIconButton>.
	assert.match(await readFile(new URL('../src/app/theme/components/button.ts', import.meta.url), 'utf8'), /controlBorder = \{ variant: 'outline', color: 'neutral', class: 'border-control-border /)
	// The box of a checkbox or a radio, the track of a switch and the frame of a segmented group.
	const choice = await variant('choice')
	assert.match(choice, /const boxBorder = '[^']*border-solid border-control-border /)
	assert.match(choice, /'border-\(length:--ui-border-width\) border-solid border-control-border checked:border-primary aria-\[invalid=true\]:border-danger'/)
	assert.match(choice, /const track = '[^']*border-solid border-control-border /)
	// The track of a slider, in WebKit and Blink and in Firefox.
	const slider = await variant('slider')
	assert.match(slider, /\[&::-webkit-slider-runnable-track\]:\[background:[^\]]*var\(--ui-color-control-border\)/)
	assert.match(slider, /\[&::-moz-range-track\]:bg-control-border/)
})

/** The value of a token that points to a step, in a theme: `--ui-color-text` becomes a hex. */
function resolve(theme, name) {
	const value = tokens[theme][name] ?? tokens.light[name]
	const step = value?.match(/^var\((--ui-color-[a-z]+-\d+)\)$/)?.[1]
	assert.ok(step, `${name} does not point to a step: ${value}`)
	return palette[theme][step]
}

test('the palette has twelve steps per scale in both themes, with pure white and pure black backgrounds', () => {
	for (const theme of ['light', 'dark']) for (const scale of scales) for (const step of steps) assert.match(color(theme, scale, step) ?? '', /^#[0-9a-f]{6}$/, `${theme} ${scale}-${step}`)
	assert.equal(color('light', 'surface', 1), WHITE)
	assert.equal(color('dark', 'surface', 1), BLACK)
	assert.equal(color('light', 'primary', 9), '#673cdd')
})

test('the dark primary scale is the violet of the light one, not the blue it replaced', () => {
	const { hue } = oklch(color('light', 'primary', 9))
	for (const step of steps) assert.ok(Math.abs(oklch(primary(step)).hue - hue) < 6, `step ${step} has hue ${oklch(primary(step)).hue.toFixed(1)}, not ${hue.toFixed(1)}`)
})

test('the dark primary scale gets lighter at every step, in OKLCH and in luminance', () => {
	for (const step of steps.slice(1)) {
		assert.ok(oklch(primary(step)).lightness > oklch(primary(step - 1)).lightness, `OKLCH lightness of step ${step}`)
		assert.ok(luminance(primary(step)) > luminance(primary(step - 1)), `luminance of step ${step}`)
	}
})

test('dark primary steps 1 to 6 keep the lightness pattern of the other dark scales', () => {
	const others = scales.filter((scale) => !['primary', 'surface'].includes(scale))
	for (const step of steps.slice(0, 6)) {
		const average = others.reduce((sum, scale) => sum + oklch(color('dark', scale, step)).lightness, 0) / others.length
		assert.ok(Math.abs(oklch(primary(step)).lightness - average) < 0.03, `step ${step}`)
	}
})

test('dark primary step 9 is electric: more chroma than any step around it and than the light solid', () => {
	const solid = oklch(primary(9)).chroma
	for (const step of steps.filter((value) => value !== 9)) assert.ok(solid > oklch(primary(step)).chroma, `step ${step}`)
	assert.ok(solid > oklch(color('light', 'primary', 9)).chroma)
})

test('dark primary reaches the contrast each step promises', () => {
	assert.ok(contrast(WHITE, primary(9)) >= 4.5, 'white on step 9')
	assert.ok(contrast(WHITE, primary(10)) >= 4.5, 'white on step 10, its hover')
	assert.ok(contrast(primary(11), color('dark', 'surface', 1)) >= 4.5, 'step 11 on surface-1')
	assert.ok(contrast(primary(12), color('dark', 'surface', 1)) >= 7, 'step 12 on surface-1')
})

test('each official scale reaches 5:1 on its solid and on hover in both themes', () => {
	for (const theme of ['light', 'dark'])
		for (const scale of scales) {
			for (const [suffix, step] of [
				['contrast', 9],
				['contrast-hover', 10],
			]) {
				const solid = color(theme, scale, step)
				const declared = tokens[theme][`--ui-color-${scale}-${suffix}`]
				assert.equal(declared, expectedContrast(solid), `${theme} ${scale}-${suffix} on ${solid}`)
				assert.ok(contrast(declared, solid) >= 5, `${theme} ${scale}-${suffix}: ${contrast(declared, solid).toFixed(2)}`)
			}
		}
})

test('appearance text stays readable on the official palettes and their interactive backgrounds', () => {
	for (const theme of ['light', 'dark']) {
		const surfaces = [1, 2, 3, 4, 5].map((step) => color(theme, 'surface', step))
		for (const scale of scales) {
			const text = color(theme, scale, 12)
			const backgrounds = [...surfaces, ...[2, 3, 4, 5].map((step) => color(theme, scale, step))]
			for (const background of backgrounds) {
				const ratio = contrast(text, background)
				assert.ok(ratio >= 4.5, `${theme} ${scale} text on ${background}: ${ratio.toFixed(2)}:1`)
			}
		}

		const border = resolve(theme, '--ui-color-control-border')
		const focus = resolve(theme, '--ui-color-focus')
		for (const scale of ['surface', 'primary', 'success', 'danger']) {
			for (const step of [2, 3, 4]) {
				const background = color(theme, scale, step)
				assert.ok(contrast(border, background) >= 3, `${theme} input border on ${scale}-${step}`)
				assert.ok(contrast(focus, background) >= 3, `${theme} input focus on ${scale}-${step}`)
			}
		}
	}
})

test('text, soft text and focus tokens stay readable on every background', () => {
	for (const theme of ['light', 'dark']) {
		const backgrounds = ['--ui-color-bg', '--ui-color-surface', '--ui-color-surface-raised', '--ui-color-control', '--ui-color-control-hover', '--ui-color-control-active'].map((name) => resolve(theme, name))
		for (const background of backgrounds) {
			assert.ok(contrast(resolve(theme, '--ui-color-text'), background) >= 7, `${theme} text on ${background}`)
			assert.ok(contrast(resolve(theme, '--ui-color-text-soft'), background) >= 4.5, `${theme} soft text on ${background}`)
			assert.ok(contrast(resolve(theme, '--ui-color-focus'), background) >= 3, `${theme} focus on ${background}`)
		}
		for (const scale of ['primary', 'info', 'success', 'warning', 'danger']) {
			const soft = resolve(theme, `--ui-color-${scale}-soft`)
			const text = resolve(theme, `--ui-color-${scale}-text`)
			assert.ok(contrast(text, soft) >= 4.5, `${theme} ${scale} text on its soft background: ${contrast(text, soft).toFixed(2)}`)
			assert.ok(contrast(text, resolve(theme, '--ui-color-bg')) >= 4.5, `${theme} ${scale} text on the page`)
		}
	}
})

/** Comments, the prelude of a media query and the sheet's `@font-face` source are not values of a component. */
// A media query, a Tailwind breakpoint and a size of a container query (theme.css) take no var(): their lengths are the only raw ones.
const strip = (css) =>
	css
		.replace(/\/\*[\s\S]*?\*\//g, '')
		.replace(/@media[^{]+\{/g, '{')
		.replace(/--breakpoint-[\w-]+:[^;]+;/g, '')
		.replace(/--container-(?:card|stat)-narrow:[^;]+;/g, '')

async function componentSheets() {
	const names = (await readdir(styles)).filter((name) => name.endsWith('.css') && !['hues.css', 'palette.css', 'tokens.css', 'fonts.css'].includes(name))
	return Promise.all(names.map(async (name) => [name, strip(await read(name))]))
}

test('component sheets and components have no colour, size, time or weight outside the tokens', async () => {
	const sheets = await componentSheets()
	assert.ok(sheets.length >= 7)
	const meeko = (await readdir(components, { recursive: true })).filter((name) => name.endsWith('.meeko'))
	// The recipes of the old variants and those of the theme.
	const recipes = await Promise.all(
		['../src/app/variants/', '../src/app/theme/components/'].map(async (path) => {
			const folder = new URL(path, import.meta.url)
			const names = (await readdir(folder)).filter((name) => name.endsWith('.ts'))
			return Promise.all(names.map(async (name) => [name, await readFile(new URL(name, folder), 'utf8')]))
		}),
	)
	const sources = [...sheets, ...(await Promise.all(meeko.map(async (name) => [name, await readFile(new URL(name.replaceAll('\\', '/'), components), 'utf8')]))), ...recipes.flat()]
	for (const [name, css] of sources) {
		assert.doesNotMatch(css, /#[0-9a-fA-F]{3,8}\b(?![\w-])(?=[\s;,)])/, `${name}: a hex colour`)
		assert.doesNotMatch(css, /\brgba?\(|\bhsla?\(|\boklch\(/, `${name}: a colour function`)
		assert.doesNotMatch(css, /(?<![\w-])\d*\.?\d+(?:px|rem|em|ms|s)\b/, `${name}: a size or a duration`)
		assert.doesNotMatch(css, /\b(?:font-weight|line-height|opacity|letter-spacing):\s*[\d.]/, `${name}: a type or opacity value`)
	}
})

test('what must differ from a surface does not rest on --ui-color-control, which ui.tokens.surface also sets', async () => {
	const { cardTheme, linkCardTheme } = await import('../dist/app/theme/components/card.js')
	const { table } = await import('../dist/app/variants/table.js')
	assert.match(cardTheme({ variant: 'soft' }).base(), /(^| )bg-control-hover( |$)/)
	assert.match(linkCardTheme().base(), /(^| )not-disabled:hover:bg-control-hover( |$)/)
	assert.match(table().bodyRow(), /(^| )hover:bg-control-hover( |$)/)
})

test('nothing mentions the removed --meeko-ui-* variables', async () => {
	for (const [name, css] of await componentSheets()) assert.doesNotMatch(css, /--meeko-ui-/, name)
	assert.doesNotMatch(paletteCss + tokensCss, /--meeko-ui-/)
	const source = await readFile(new URL('../src/app/utils/modal-dialog.ts', import.meta.url), 'utf8')
	assert.doesNotMatch(source, /--meeko-ui-/)
})

test('the frame of the page does not depend on how long the page is', async () => {
	assert.match(await read('base.css'), /:root \{[^}]*scrollbar-gutter: stable/, 'a short page and a long one keep the header in place')
	const { page } = await import('../dist/app/variants/page.js')
	const classes = page()
	for (const slot of ['sidebar', 'aside']) assert.match(classes[slot](), /\[scrollbar-gutter:stable\]/, `the ${slot} is as wide with a long navigation as with a short one`)
	const shadows = classes
		.skip()
		.split(' ')
		.filter((name) => /shadow/.test(name))
	assert.ok(shadows.length > 0 && shadows.every((name) => name.startsWith('focus-visible:')), 'the shadow of the hidden skip link would show above the header')
})

test('inline code reads as a chip, so that its padding is not taken for a space before the punctuation', async () => {
	assert.match(await read('prose.css'), /:not\(pre\) > code \{[^}]*background: var\(--ui-color-code-soft\)/)
	const [, inline] = /--ui-prose-code-padding: \S+ (\d*\.?\d+)em/.exec(tokensCss)
	assert.ok(Number(inline) <= 0.2, `${inline}em on each side`)
})

test('code text contrasts with its background in both themes', () => {
	for (const theme of ['light', 'dark']) {
		const text = color(theme, 'cyan', 12)
		for (const step of [2, 3]) {
			const ratio = contrast(text, color(theme, 'cyan', step))
			assert.ok(ratio >= 4.5, `${theme} code on cyan-${step}: ${ratio.toFixed(2)}:1`)
		}
	}
})

test('every --ui-* variable a component sheet reads is declared', async () => {
	const declared = new Set([...Object.keys(palette.light), ...Object.keys(palette.dark), ...Object.keys(declarations(tokensCss))])
	// Hooks a consumer can set: they always go with a fallback in the sheets.
	const local = new Set(['--ui-button-color', '--ui-container-size', '--ui-container-padding', '--ui-container-max-width', '--ui-container-gutter', '--ui-link-card-padding', '--ui-modal-depth', '--ui-markdown-editor-height'])
	for (const [name, css] of await componentSheets()) for (const [, variable] of css.matchAll(/var\((--ui-[\w-]+)/g)) assert.ok(declared.has(variable) || local.has(variable), `${name} reads ${variable}, which nothing declares`)
})

test('the base goes in a layer, so that any rule of the app wins', async () => {
	const css = await read('base.css')
	const stripped = strip(css).trim()
	// Tailwind's preflight layer (`base`) is declared before ui-base, so an app's reset stays below UI.
	assert.match(stripped, /^@layer base, ui-base;\s*@layer ui-base \{/)
	assert.match(stripped, /\}$/)
	for (const piece of ['color-scheme: dark', 'background: var(--ui-color-bg)', '::selection', ':focus-visible', 'var(--ui-font-sans)']) assert.ok(css.includes(piece), piece)
})

test("the entry of UI keeps Tailwind's order of layers and its hand-written rules under every utility", async () => {
	const css = strip(await read('main.css'))
	assert.match(css, /^\s*@layer theme, base, components, utilities;/, 'whatever the app imports first, the preflight stays under the components')
	assert.match(css, /@import '\.\/components\.css' layer\(components\);/)
	assert.doesNotMatch(css, /@import ['"]tailwindcss/, 'the app imports Tailwind once, before UI')
	// Published, the components are in dist/; in the workspace, in src/.
	for (const folder of ['../components', '../variants', '../theme', '../../editor/components', '../../../dist/app/components', '../../../dist/app/variants', '../../../dist/app/theme', '../../../dist/editor/components']) assert.ok(css.includes(`@source '${folder}';`), folder)
})

test('the raw combinations of hues generate CSS only through their own entry', async () => {
	const main = strip(await read('main.css'))
	assert.match(main, /@source not '\.\.\/theme\/base\/hues\.ts';/)
	assert.match(main, /@source not '\.\.\/\.\.\/\.\.\/dist\/app\/theme\/base\/hues\.\*';/)
	assert.deepEqual(
		[...strip(await read('hues.css')).matchAll(/@source '([^']+)';/g)].map(([, path]) => path),
		['../theme/base/hues.ts', '../../../dist/app/theme/base/hues.js'],
	)
	const { exports } = JSON.parse(await readFile(new URL('../package.json', import.meta.url), 'utf8'))
	assert.equal(exports['.'].style, './src/app/styles/main.css')
	assert.deepEqual(Object.keys(exports['.']), ['types', 'style', 'default'], 'style goes before default, which matches any condition')
	assert.equal(exports['./hues'], './src/app/styles/hues.css')
})

/** Compiles a sheet of a consumer with the Tailwind of the package, resolving its imports, and builds the candidates. */
async function consumerCss(imports, candidates) {
	const require = createRequire(import.meta.url)
	const entries = {
		tailwindcss: require.resolve('tailwindcss/index.css'),
		'@meekojs/ui': fileURLToPath(new URL('main.css', styles)),
		'@meekojs/ui/hues': fileURLToPath(new URL('hues.css', styles)),
	}
	const loadStylesheet = async (id, base) => {
		const path = entries[id] ?? resolvePath(base, id)
		return { path, base: dirname(path), content: await readFile(path, 'utf8') }
	}
	const css = ['tailwindcss', ...imports].map((id) => `@import '${id}';`).join('\n')
	const compiler = await compile(css, { base: fileURLToPath(styles), loadStylesheet })
	return compiler.build(candidates)
}

/** The declarations of the rule of one class in compiled CSS. */
const rule = (css, name) => css.match(new RegExp(`\\.${name.replace(/[:()]/g, '\\\\$&')} \\{([^}]*)\\}`))?.[1].trim()

test("the consumer keeps Tailwind's default theme next to the one of UI", async () => {
	const css = await consumerCss(['@meekojs/ui'], ['bg-red-500', 'md:flex', 'max-w-7xl', 'text-white', 'bg-primary-9', 'text-control-md'])
	assert.equal(rule(css, 'bg-red-500'), 'background-color: var(--color-red-500);')
	assert.match(css, /--color-red-500: oklch\(/)
	assert.match(css, /@media \(width >= 48rem\) \{\s*\.md\\:flex \{\s*display: flex;/, 'the md: breakpoint of Tailwind')
	assert.ok(rule(css, 'max-w-7xl'))
	assert.ok(rule(css, 'text-white'))
	assert.equal(rule(css, 'bg-primary-9'), 'background-color: var(--ui-color-primary-9);')
})

test('the defaults of Tailwind do not change the utilities of UI', async () => {
	const css = await consumerCss(['@meekojs/ui'], ['text-xs', 'text-sm', 'text-base', 'text-lg', 'text-6xl', 'text-control-sm', 'transition-colors', 'transition'])
	for (const size of ['xs', 'sm', 'lg', '6xl']) assert.equal(rule(css, `text-${size}`), `font-size: var(--ui-font-size-${size});`, `text-${size} sets the size alone`)
	assert.equal(rule(css, 'text-base'), 'font-size: var(--ui-font-size-md);')
	assert.equal(rule(css, 'text-control-sm'), 'font-size: var(--ui-control-font-size-sm);')
	for (const name of ['transition-colors', 'transition']) {
		assert.match(rule(css, name), /transition-timing-function: var\(--tw-ease, ease\);/, name)
		assert.match(rule(css, name), /transition-duration: var\(--tw-duration, 0s\);/, name)
	}
	assert.doesNotMatch(css, /--default-transition-|--text-xs--line-height/)
})

test('the semantic scales, the alpha gray and the five control sizes are utilities of the main entry', async () => {
	const semantic = ['primary', 'secondary', 'neutral', 'success', 'info', 'warning', 'danger']
	const candidates = [...semantic.flatMap((color) => [...steps.map((step) => `bg-${color}-${step}`), `text-${color}-contrast`]), ...steps.map((step) => `border-gray-a${step}`), ...['xs', 'sm', 'md', 'lg', 'xl'].map((size) => `text-control-${size}`)]
	const css = await consumerCss(['@meekojs/ui'], candidates)
	for (const color of semantic) {
		for (const step of steps) assert.equal(rule(css, `bg-${color}-${step}`), `background-color: var(--ui-color-${color}-${step});`)
		assert.equal(rule(css, `text-${color}-contrast`), `color: var(--ui-color-${color}-contrast);`)
	}
	for (const step of steps) assert.equal(rule(css, `border-gray-a${step}`), `border-color: var(--ui-color-gray-a${step});`)
	for (const size of ['xs', 'sm', 'lg', 'xl']) assert.equal(rule(css, `text-control-${size}`), `font-size: var(--ui-control-font-size-${size});`)
	for (const size of ['xs', 'sm', 'md', 'lg', 'xl']) for (const token of ['height', 'padding']) assert.ok(tokens.light[`--ui-control-${token}-${size}`], `--ui-control-${token}-${size}`)
	const coarse = tokensCss.slice(tokensCss.indexOf('@media (pointer: coarse)'))
	for (const size of ['xs', 'sm', 'md', 'lg', 'xl']) assert.match(coarse, new RegExp(`--ui-control-height-${size}: `), `a touch screen gets a taller ${size} control`)
})

test('the raw hues reach the CSS only through @meekojs/ui/hues', async () => {
	const candidates = ['bg-crimson-9', 'text-crimson-contrast', 'bg-gray-5', 'bg-sky-9']
	const main = await consumerCss(['@meekojs/ui'], candidates)
	for (const name of candidates) assert.equal(rule(main, name), undefined, name)
	assert.doesNotMatch(main, /--color-(?:crimson|sky)-|--color-gray-\d/)

	const css = await consumerCss(['@meekojs/ui', '@meekojs/ui/hues'], candidates)
	assert.equal(rule(css, 'bg-crimson-9'), 'background-color: var(--color-crimson-9);')
	assert.equal(rule(css, 'text-crimson-contrast'), 'color: var(--color-crimson-contrast);')
	assert.match(css, new RegExp(`--color-crimson-9: ${radix.crimson.crimson9};`))
	const dark = css.slice(css.indexOf(":root[data-theme='dark']"))
	assert.match(dark, new RegExp(`--color-crimson-9: ${radix.crimsonDark.crimson9};`))
})

test('the raw hues and the alpha gray are the values of @radix-ui/colors', async () => {
	const hues = await read('hues.css')
	const { hueNames } = await import('@meekojs/ui/theme/hues')
	const light = declarations(hues.slice(hues.indexOf('@theme {'), hues.indexOf(':root[')))
	const dark = declarations(hues.slice(hues.indexOf(":root[data-theme='dark'] {")))
	const darkText = { sky: 'slate', mint: 'sage', lime: 'olive', yellow: 'sand', amber: 'sand' }
	for (const hue of hueNames) {
		for (const step of steps) {
			assert.equal(light[`--color-${hue}-${step}`], radix[hue][`${hue}${step}`], `${hue}-${step}`)
			assert.equal(dark[`--color-${hue}-${step}`], radix[`${hue}Dark`][`${hue}${step}`], `dark ${hue}-${step}`)
		}
		// Dark text on the bright solids of Radix, white on the rest; the same in both themes.
		const text = darkText[hue] ? radix[darkText[hue]][`${darkText[hue]}12`] : WHITE
		assert.equal(light[`--color-${hue}-contrast`], text, `${hue}-contrast`)
		assert.equal(dark[`--color-${hue}-contrast`], text, `dark ${hue}-contrast`)
	}
	assert.equal(Object.keys(light).length, hueNames.length * 13)
	assert.equal(Object.keys(dark).length, hueNames.length * 13)
	for (const step of steps) {
		assert.equal(palette.light[`--ui-color-gray-a${step}`], radix.grayA[`grayA${step}`], `gray-a${step}`)
		assert.equal(palette.dark[`--ui-color-gray-a${step}`], radix.grayDarkA[`grayA${step}`], `dark gray-a${step}`)
	}
})

test('the font and its licence ship with the package', async () => {
	const fonts = await readdir(new URL('fonts/', styles))
	assert.deepEqual(fonts.sort(), ['Inter-OFL.txt', 'inter-latin-opsz-normal.woff2'])
	assert.match(await read('fonts.css'), /\/_meeko-ui\/fonts\/inter-latin-opsz-normal\.woff2/)
})

test('a kbd and highlighted code look the same anywhere in an application', async () => {
	assert.match(await read('base.css'), /:where\(kbd\) \{[^}]*var\(--ui-color-border\)/)
	const code = await read('code.css')
	assert.match(code, /^\.shiki span \{\s*color: var\(--shiki-light\);/m)
	assert.match(code, /:root\[data-theme='dark'\] \.shiki span \{\s*color: var\(--shiki-dark\);/)
})

test('a plain link of an application reads the tokens, in the base layer so that any rule wins', async () => {
	const base = await read('base.css')
	assert.match(base, /:where\(a\) \{[^}]*color: var\(--ui-color-primary-text\);/)
	assert.match(base, /:where\(a\):hover \{[^}]*text-decoration-color: currentColor;/)
})

test('each new family of component tokens is declared and falls back to the global tokens', () => {
	const families = {
		'--ui-copy-button-': ['copied-color', 'failed-color'],
		'--ui-progress-': ['height', 'radius', 'track', 'color', 'indeterminate-width', 'duration'],
		'--ui-meter-': ['height', 'radius', 'track', 'optimum-color', 'suboptimum-color', 'even-less-good-color'],
		'--ui-file-': ['color', 'gap', 'button-height', 'button-padding', 'button-radius', 'button-bg', 'button-bg-hover', 'button-border', 'button-color'],
		'--ui-navigation-progress-': ['height', 'color', 'delay', 'duration'],
	}
	for (const [prefix, names] of Object.entries(families))
		for (const name of names) {
			const value = tokens.light[prefix + name]
			assert.ok(value, `${prefix + name} is declared`)
			// A color reads a token of use: the dark theme and ui.tokens change it without a rule of its own.
			if (/color|track|bg|border/.test(name)) assert.match(value, /^var\(--ui-color-[a-z-]+\)$/, `${prefix + name}: ${value}`)
		}
	assert.equal(tokens.light['--ui-navigation-progress-delay'], 'var(--ui-duration-fast)', 'a fast navigation never shows the bar')
})

test('native <progress>, <meter> and file inputs get the tokens at zero specificity, in the base layer', async () => {
	const base = strip(await read('base.css'))
	const selectors = [...base.matchAll(/^\s*([^{}@\n][^{}]*)\{/gm)].map(([, selector]) => selector.trim()).filter((selector) => !selector.startsWith('@') && /progress|meter|file/.test(selector))
	assert.ok(selectors.length >= 15, selectors.join('\n'))
	// Only :where() and the pseudo-elements of the element: any rule of the app wins.
	for (const selector of selectors) for (const part of selector.split(',')) assert.match(part.trim(), /^:where\([^)]*(?:\([^)]*\))?[^)]*\)(?:::[\w-]+)?$/, part)
	for (const piece of ['var(--ui-progress-track)', 'var(--ui-progress-color)', ':where(progress:indeterminate)', 'var(--ui-meter-optimum-color)', '::-webkit-meter-suboptimum-value', ':-moz-meter-sub-sub-optimum', '::file-selector-button', 'var(--ui-file-button-bg-hover)']) assert.ok(base.includes(piece), piece)
	assert.match(await read('base.css'), /prefers-reduced-motion: reduce\) \{[^]*:where\(progress:indeterminate\) \{[^}]*animation: none/)
})

test('the navigation progress bar shows only while <html> has data-navigating, after its delay, and respects reduced motion', async () => {
	const css = await read('navigation.css')
	assert.match(css, /:root\[data-navigating\]::before \{[^}]*animation: ui-navigation-progress var\(--ui-navigation-progress-duration\) [^}]*var\(--ui-navigation-progress-delay\) forwards;/)
	// Each declaration on its own: Prettier orders the properties of a rule.
	assert.match(css, /:root::before \{[^}]*block-size: var\(--ui-navigation-progress-height\);/)
	assert.match(css, /:root::before \{[^}]*background: var\(--ui-navigation-progress-color\);/)
	// Invisible when idle: its base state is hidden, so the delay shows nothing.
	assert.match(css, /:root::before \{[^}]*opacity: var\(--ui-opacity-hidden\);/)
	assert.match(css, /prefers-reduced-motion: reduce\) \{[^]*animation-name: ui-navigation-progress-still;/)
	// In the sheet of the module, so every app with @meekojs/ui gets it.
	assert.match(await read('components.css'), /@import '\.\/navigation\.css';/)
})
