import { Window } from 'happy-dom'
import assert from 'node:assert/strict'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import test from 'node:test'
import { pathToFileURL } from 'node:url'

import { checkSource } from '../src/check.ts'
import { compile } from '../src/compiler.ts'
import { isSelfClosableElement, maskComponentTags, MeekoCompileError, parseSfc } from '../src/compiler/parser/sfc.ts'
import { parseTemplate, type TemplateNode } from '../src/compiler/parser/template.ts'
import { createEditorModel } from '../src/language-server/model.ts'

const script = `<script lang="ts">const AppButton = {} as never;\nconst show = true;\nconst items = ["a"];\nconst label = "x";</script>\n`

function parse(template: string): { root: TemplateNode; source: string } {
	const source = `${script}<template>${template}</template>`
	return { root: parseTemplate(source, parseSfc(source, 'Empty.meeko').template, 'Empty.meeko'), source }
}

/** The element tree as `tag/` for a self-closing element and `tag(children)` otherwise; text is skipped. */
function shape(node: TemplateNode): string {
	const children = [...(node.childNodes ?? []), ...(node.content?.childNodes ?? [])].filter((child) => child.tagName !== undefined)
	const name = node.tagName ?? node.nodeName
	return node.selfClosing ? `${name}/` : children.length ? `${name}(${children.map(shape).join(' ')})` : name
}

function render(template: string): string {
	return compile(`${script}<template>${template}</template>`, 'Empty.meeko').code
}

test('<tag /> is an empty element that keeps the next nodes as siblings', () => {
	const cases: Array<[string, string]> = [
		[`<div /><p>after</p>`, `div/ p`],
		[`<div class="a" /><span /><em>x</em>`, `div/ span/ em`],
		[`<section><div /><p /><ul><li /><li>a</li></ul></section><footer />`, `section(div/ p/ ul(li/ li)) footer/`],
		[`<textarea name="t" /><title /><p>x</p>`, `textarea/ title/ p`],
		[`<table><tr><td /><td>x</td><th /></tr><tr /></table><p>x</p>`, `table(tbody(tr(td/ td th/) tr/)) p`],
		[`<table /><p>x</p>`, `table/ p`],
		[`<select><option /><optgroup /><option>b</option></select>`, `select(option/ optgroup/ option)`],
		[`<form /><p>x</p>`, `form/ p`],
		[`<my-element data-x="1" /><p>x</p>`, `my-element/ p`],
		[`<AppButton /><div /><component is="AppButton" /><p>x</p>`, `AppButton/ div/ component/ p`],
		[`<template if:when="show"><div /></template><p>x</p>`, `template(div/) p`],
		[`<svg><foreignObject><div /></foreignObject></svg>`, `svg(foreignObject(div/))`],
	]
	for (const [template, expected] of cases) {
		const { root } = parse(template)
		assert.equal(
			root.childNodes
				?.filter((child) => child.tagName !== undefined)
				.map(shape)
				.join(' '),
			expected,
			template,
		)
	}
})

test('a self-closing element ends at its start tag, with its original name and attributes', () => {
	const { root, source } = parse(`<div class="box"\n\tbind:title="label" /><textarea /><p>x</p>`)
	const [div, textarea, p] = root.childNodes!
	assert.equal(div!.tagName, 'div')
	assert.equal(div!.nodeName, 'div')
	assert.equal(div!.selfClosing, true)
	assert.equal(source.slice(div!.start, div!.end), `<div class="box"\n\tbind:title="label" />`)
	assert.equal(div!.sourceCodeLocation?.endOffset, div!.sourceCodeLocation?.startTag?.endOffset)
	assert.deepEqual(
		div!.attrs?.map((attribute) => [attribute.name, source.slice(attribute.start, attribute.end)]),
		[
			['class', `class="box"`],
			['bind:title', `bind:title="label"`],
		],
	)
	assert.equal(textarea!.tagName, 'textarea')
	assert.equal(source.slice(textarea!.start, textarea!.end), `<textarea />`)
	assert.equal(p!.tagName, 'p')
})

test('void, SVG and MathML elements keep their own self-closing', () => {
	const { root } = parse(`<input /><br/><svg><path d="M0" /><circle r="1" /></svg><math><mi /><mn>1</mn></math><p>x</p>`)
	const elements = root.childNodes!.filter((child) => child.tagName !== undefined)
	assert.deepEqual(elements.map(shape), ['input', 'br', 'svg(path circle)', 'math(mi mn)', 'p'])
	for (const element of elements) assert.equal(element.selfClosing, undefined)
	assert.equal(elements[2]!.childNodes![0]!.namespaceURI, 'http://www.w3.org/2000/svg')
	assert.equal(elements[3]!.childNodes![0]!.namespaceURI, 'http://www.w3.org/1998/Math/MathML')
	for (const name of ['input', 'br', 'img', 'col', 'path', 'mi', 'template', 'script', 'style', 'annotation-xml', 'foo']) assert.equal(isSelfClosableElement(name), false, name)
	for (const name of ['div', 'span', 'textarea', 'td', 'option', 'title', 'my-element']) assert.equal(isSelfClosableElement(name), true, name)
})

test('<tag /> compiles exactly like <tag></tag>', () => {
	const pairs: Array<[string, string]> = [
		[`<div />`, `<div></div>`],
		[`<div class="a" bind:title="label" /><span>x</span>`, `<div class="a" bind:title="label"></div><span>x</span>`],
		[`<span if:when="show" class="flag" /><p>x</p>`, `<span if:when="show" class="flag"></span><p>x</p>`],
		[`<ul><li each:of="items" each:as="item" each:key="item" bind:data-id="item" /></ul>`, `<ul><li each:of="items" each:as="item" each:key="item" bind:data-id="item"></li></ul>`],
		[`<textarea name="t" />`, `<textarea name="t"></textarea>`],
		[`<table><tr><td /><td>x</td></tr></table>`, `<table><tr><td></td><td>x</td></tr></table>`],
		[`<select><option value="" /></select>`, `<select><option value=""></option></select>`],
		[`<my-element />`, `<my-element></my-element>`],
		[`<AppButton><div /></AppButton>`, `<AppButton><div></div></AppButton>`],
	]
	for (const [selfClosing, explicit] of pairs) {
		// Only source positions (source maps, devtools locations) may differ.
		const strip = (code: string): string => code.replace(/\/\/# sourceMappingURL=.*$/m, '').replace(/"(?:line|column|offset|start|end)":\s*\d+/g, '')
		assert.equal(strip(render(selfClosing)), strip(render(explicit)), selfClosing)
	}
	assert.match(render(`<div /><textarea />`), /"<div" \+ ">" \+ "<\/div>" \+ "<textarea" \+ ">" \+ "<\/textarea>"/)
})

test('section parsing accepts <tag /> inside the template', () => {
	assert.doesNotThrow(() => parseSfc(`${script}<template><div><span /></div><textarea /></template>`, 'Empty.meeko'))
	const masked = maskComponentTags(`<div /><td /><span>x</span>`, { tableSnippets: true })
	assert.deepEqual([...masked.elements], [0, 7])
	assert.equal(masked.text, `<jiv  ><td  ><span>x</span>`)
})

test('<template />, <script />, <style /> and unknown elements still need their end tag', () => {
	for (const template of [`<template />`, `<foo />`, `<style />`]) {
		const source = `${script}<template>${template}<p>x</p></template>`
		assert.throws(
			() => compile(source, 'Empty.meeko'),
			(error: unknown) => {
				assert.ok(error instanceof MeekoCompileError, String(error))
				assert.equal(error.diagnostic.code, 'MEEK001', template)
				assert.match(error.diagnostic.message, /no pueden cerrarse con \/>; escribe la etiqueta de cierre \(non-void-html-element-start-tag-with-trailing-solidus\)$/)
				return true
			},
		)
	}
	// An unquoted value keeps its `/`: `<span title=a/>` is open.
	assert.match(render(`<span title=a/>x</span>`), /"<span" \+ " title=\\"a\/\\"" \+ ">" \+ __meeko\.escapeHtml\("x"\)/)
})

test('<td /> followed by its own end tag is a clear error', () => {
	for (const [template, tag] of [
		[`<table><tr><td /></td></tr></table>`, '</td>'],
		[`<select><option /></option></select>`, '</option>'],
	] as const) {
		const source = `${script}<template>${template}</template>`
		assert.throws(
			() => compile(source, 'Empty.meeko'),
			(error: unknown) => {
				assert.ok(error instanceof MeekoCompileError, String(error))
				assert.equal(error.diagnostic.code, 'MEEK008')
				assert.equal(error.diagnostic.location.offset, source.indexOf(tag))
				assert.match(error.diagnostic.message, /ya está cerrada; quita <\//)
				return true
			},
		)
	}
})

test('meeko check and the editor map diagnostics, hover and rename inside and after <tag />', { timeout: 120_000 }, async () => {
	const filename = resolve('examples/counter/SelfClosing.meeko')
	const component = `<script lang="ts">
import { signal } from "@meekojs/meeko";
const label = signal("a");
</script>
<template><div class="box"
	bind:title="label.value" /><span bind:title="missingName" /><p>{otherName}</p><textarea bind:title="label.value" /></template>`
	const diagnostics = await checkSource(component, filename)
	const at = (code: string, text: string): boolean => diagnostics.some((item) => item.code === code && item.location.offset === component.indexOf(text))
	assert.ok(at('TS2304', 'missingName'), JSON.stringify(diagnostics))
	assert.ok(at('TS2304', 'otherName'), JSON.stringify(diagnostics))
	assert.equal(diagnostics.length, 2, JSON.stringify(diagnostics))
	const model = createEditorModel(component, filename)
	try {
		const declaration = component.indexOf('label = signal')
		const uses = [component.indexOf('label.value'), component.lastIndexOf('label.value')]
		for (const use of uses) {
			const offset = model.toGenerated(use + 1)
			assert.notEqual(offset, undefined)
			assert.match(
				model.service
					.getQuickInfoAtPosition(model.virtualFilename, offset!)
					?.displayParts?.map((part) => part.text)
					.join('') ?? '',
				/label/,
			)
		}
		const rename = model.service.findRenameLocations(model.virtualFilename, model.toGenerated(uses[0]! + 1)!, false, false, true) ?? []
		const mapped = rename.map((item) => model.toSource(item.textSpan.start))
		assert.ok(mapped.includes(declaration))
		for (const use of uses) assert.ok(mapped.includes(use), JSON.stringify(mapped))
	} finally {
		model.dispose()
	}
	// A tag that cannot close itself is a parse diagnostic at the tag.
	const invalid = component.replace(`<textarea bind:title="label.value" />`, `<template />`)
	const parse = await checkSource(invalid, filename)
	assert.ok(
		parse.some((item) => item.code === 'MEEK001' && item.location.offset === invalid.indexOf('<template />')),
		JSON.stringify(parse),
	)
})

test('SSR, hydration, updates and release of self-closing elements', { timeout: 60_000 }, async () => {
	const source = `<script lang="ts">
import { signal } from "@meekojs/meeko";
const items = signal(["a", "b"]);
const show = signal(true);
const label = signal("first");
</script>
<template><div class="box"
	bind:title="label.value" /><span if:when="show.value" class="flag" /><ul><li each:of="items.value" each:as="item" each:key="item" bind:data-id="item" /></ul><textarea name="note" /><table><tr><td bind:title="label.value" /><td>x</td></tr></table><p>{label.value}</p><button class="toggle" on:click="() => show.value = !show.value">t</button><button class="add" on:click="() => items.value = [...items.value, 'c']">a</button><button class="rename" on:click="() => label.value = 'second'">r</button></template>`
	const directory = await mkdtemp(join(tmpdir(), 'meeko-self-closing-'))
	const runtime = (path: string): string => JSON.stringify(pathToFileURL(resolve(path)).href)
	const window = new Window()
	try {
		const code = compile(source, join(directory, 'Empty.meeko'))
			.code.replace(`from "@meekojs/meeko/internal"`, `from ${runtime('src/internal.ts')}`)
			.replace(`from "@meekojs/meeko"`, `from ${runtime('src/index.ts')}`)
		await writeFile(join(directory, 'Empty.ts'), code)
		const component = (await import(pathToFileURL(join(directory, 'Empty.ts')).href)) as {
			renderToString(props: Record<string, never>): string
			hydrate(root: Element, props: Record<string, never>): () => void
		}
		const html = component.renderToString({})
		// Valid HTML: every non-void element has its end tag and no `/>`.
		assert.doesNotMatch(html, /\/>/)
		assert.match(html, /<div class="box" title="first" data-meeko="\d+"><\/div>/)
		assert.match(html, /<span class="flag"><\/span>/)
		assert.match(html, /<li data-id="a" data-meeko="\d+"><\/li>/)
		assert.match(html, /<textarea name="note"><\/textarea>/)
		assert.match(html, /<td title="first" data-meeko="\d+"><\/td><td>x<\/td>/)
		const root = window.document.createElement('main')
		root.innerHTML = html
		const tree = (): string => [...root.children].map((child) => child.tagName.toLowerCase()).join(' ')
		assert.equal(tree(), 'div span ul textarea table p button button button')
		const box = root.querySelector('div.box')!
		const cell = root.querySelector('td')!
		const release = component.hydrate(root as unknown as Element, {})
		const click = (name: string): void => (root.querySelector(`button.${name}`) as unknown as HTMLButtonElement).click()
		// Hydration adopts the server nodes.
		assert.equal(root.querySelector('div.box'), box)
		assert.equal(root.querySelector('td'), cell)
		assert.equal(box.childNodes.length, 0)
		const ids = (): string[] => [...root.querySelectorAll('li')].map((item) => item.getAttribute('data-id') ?? '')
		assert.deepEqual(ids(), ['a', 'b'])
		// Updates of bindings, conditions and lists.
		click('rename')
		assert.equal(box.getAttribute('title'), 'second')
		assert.equal(cell.getAttribute('title'), 'second')
		assert.equal(root.querySelector('p')?.textContent, 'second')
		click('toggle')
		assert.equal(root.querySelector('span.flag'), null)
		click('toggle')
		const flag = root.querySelector('span.flag')
		assert.ok(flag)
		assert.equal(flag.childNodes.length, 0)
		assert.equal(flag.nextElementSibling?.tagName.toLowerCase(), 'ul')
		click('add')
		assert.deepEqual(ids(), ['a', 'b', 'c'])
		assert.ok([...root.querySelectorAll('li')].every((item) => item.childNodes.length === 0))
		assert.equal(tree(), 'div span ul textarea table p button button button')
		// Released, the component no longer updates.
		release()
		click('add')
		assert.deepEqual(ids(), ['a', 'b', 'c'])
	} finally {
		window.happyDOM.abort()
		await rm(directory, { recursive: true, force: true })
	}
})
