import assert from 'node:assert/strict'
import { readdir, readFile } from 'node:fs/promises'
import test from 'node:test'

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
	const main = await read('main.css')
	const forms = await read('forms.css')
	const rule = (css, selector) => {
		const start = css.indexOf(`${selector} {`)
		assert.notEqual(start, -1, `no ${selector} rule`)
		return css.slice(start, css.indexOf('\n}', start))
	}
	// The same rule paints <UIInput>, <UITextarea> and the trigger of <UISelect> and <UICombobox>.
	assert.match(rule(main.replaceAll('\r\n', '\n'), '.meeko-ui-input,\n[data-meeko-select-trigger]'), /border: var\(--ui-border-width\) solid var\(--ui-color-control-border\)/)
	assert.match(rule(main, ".meeko-ui-button[data-variant='outline']"), /border-color: var\(--ui-color-control-border\)/)
	for (const selector of ['.meeko-ui-choice:not(.meeko-ui-switch) input', '.meeko-ui-switch input', ".meeko-ui-radio-group[data-variant='segmented'] .meeko-ui-radio-options"]) assert.match(rule(forms, selector), /solid var\(--ui-color-control-border\)/, selector)
	assert.match(rule(forms, '.meeko-ui-slider input::-webkit-slider-runnable-track'), /var\(--ui-color-control-border\)/)
	assert.match(rule(forms, '.meeko-ui-slider input::-moz-range-track'), /var\(--ui-color-control-border\)/)
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

test('each scale declares the text with 4.5:1 or more on its solid and on its hover, in both themes', () => {
	for (const theme of ['light', 'dark'])
		for (const scale of scales) {
			for (const [suffix, step] of [
				['contrast', 9],
				['contrast-hover', 10],
			]) {
				const solid = color(theme, scale, step)
				const declared = tokens[theme][`--ui-color-${scale}-${suffix}`]
				assert.equal(declared, expectedContrast(solid), `${theme} ${scale}-${suffix} on ${solid}`)
				assert.ok(contrast(declared, solid) >= 4.5, `${theme} ${scale}-${suffix}: ${contrast(declared, solid).toFixed(2)}`)
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
const strip = (css) => css.replace(/\/\*[\s\S]*?\*\//g, '').replace(/@media[^{]+\{/g, '{')

async function componentSheets() {
	const names = (await readdir(styles)).filter((name) => name.endsWith('.css') && !['palette.css', 'tokens.css', 'fonts.css'].includes(name))
	return Promise.all(names.map(async (name) => [name, strip(await read(name))]))
}

test('component sheets and components have no colour, size, time or weight outside the tokens', async () => {
	const sheets = await componentSheets()
	assert.ok(sheets.length >= 7)
	const meeko = (await readdir(components, { recursive: true })).filter((name) => name.endsWith('.meeko'))
	const sources = [...sheets, ...(await Promise.all(meeko.map(async (name) => [name, await readFile(new URL(name.replaceAll('\\', '/'), components), 'utf8')])))]
	for (const [name, css] of sources) {
		assert.doesNotMatch(css, /#[0-9a-fA-F]{3,8}\b(?![\w-])(?=[\s;,)])/, `${name}: a hex colour`)
		assert.doesNotMatch(css, /\brgba?\(|\bhsla?\(|\boklch\(/, `${name}: a colour function`)
		assert.doesNotMatch(css, /(?<![\w-])\d*\.?\d+(?:px|rem|em|ms|s)\b/, `${name}: a size or a duration`)
		assert.doesNotMatch(css, /\b(?:font-weight|line-height|opacity|letter-spacing):\s*[\d.]/, `${name}: a type or opacity value`)
	}
})

test('what must differ from a surface does not rest on --ui-color-control, which ui.tokens.surface also sets', async () => {
	const card = strip(await read('card.css'))
	const linkCard = strip(await read('link-card.css'))
	const table = strip(await read('table.css'))
	assert.match(card, /\[data-variant='soft'\] \{\s*--card-background: var\(--ui-color-control-hover\)/)
	assert.match(linkCard, /:hover \{[^}]*background: var\(--ui-color-control-hover\)/)
	assert.match(table, /--table-hover: var\(--ui-color-control-hover\)/)
})

test('nothing mentions the removed --meeko-ui-* variables', async () => {
	for (const [name, css] of await componentSheets()) assert.doesNotMatch(css, /--meeko-ui-/, name)
	assert.doesNotMatch(paletteCss + tokensCss, /--meeko-ui-/)
	const source = await readFile(new URL('../src/app/utils/modal-dialog.ts', import.meta.url), 'utf8')
	assert.doesNotMatch(source, /--meeko-ui-/)
})

test('the frame of the page does not depend on how long the page is', async () => {
	assert.match(await read('base.css'), /:root \{[^}]*scrollbar-gutter: stable/, 'a short page and a long one keep the header in place')
	const page = await read('page.css')
	assert.match(page, /\.meeko-ui-page-sidebar,\s*\.meeko-ui-page-aside \{[^}]*scrollbar-gutter: stable/, 'the sidebar is as wide with a long navigation as with a short one')
	assert.doesNotMatch(/\.meeko-ui-skip-link \{[^}]*\}/.exec(page)[0], /box-shadow/, 'the shadow of the hidden skip link would show above the header')
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
	const local = new Set(['--ui-button-color', '--ui-container-size', '--ui-container-padding', '--ui-container-max-width', '--ui-container-gutter', '--ui-card-shadow', '--ui-link-card-padding', '--ui-modal-depth', '--ui-markdown-editor-height'])
	for (const [name, css] of await componentSheets()) for (const [, variable] of css.matchAll(/var\((--ui-[\w-]+)/g)) assert.ok(declared.has(variable) || local.has(variable), `${name} reads ${variable}, which nothing declares`)
})

test('the base goes in a layer, so that any rule of the app wins', async () => {
	const css = await read('base.css')
	const stripped = strip(css).trim()
	assert.match(stripped, /^@layer ui-base \{/)
	assert.match(stripped, /\}$/)
	for (const piece of ['color-scheme: dark', 'background: var(--ui-color-bg)', '::selection', ':focus-visible', 'var(--ui-font-sans)']) assert.ok(css.includes(piece), piece)
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
