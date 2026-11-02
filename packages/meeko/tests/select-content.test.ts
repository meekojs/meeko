import { Window as HappyWindow } from 'happy-dom'
import assert from 'node:assert/strict'
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { after, before, describe, test } from 'node:test'

import { bindAttribute, bindEvent, bindText } from '../src/app/runtime/renderer.ts'
import { checkSource } from '../src/check.ts'
import { compile } from '../src/compiler.ts'
import { MeekoCompileError, parseSfc } from '../src/compiler/parser/sfc.ts'
import { parseTemplate, type TemplateNode } from '../src/compiler/parser/template.ts'
import { signal } from '../src/core/reactivity.ts'
import { elementAttributeNames } from '../src/shared/html-data/attribute-names.ts'
import { htmlElementAttributes } from '../src/shared/html-data/attributes.ts'
import { elementEventNames } from '../src/shared/html-data/events.ts'

const script = `<script lang="ts">
import { signal } from "@meekojs/meeko";
const value = signal("a");
const list = ["a", "b"];
</script>
`

const source = (body: string): string => `${script}<template>${body}</template>`

/** The tags of a template, with their children, as the compiler reads them. */
function tree(body: string): string {
	const text = source(body)
	const print = (nodes: readonly TemplateNode[] | undefined): string =>
		(nodes ?? [])
			.filter((node) => node.tagName !== undefined)
			.map((node) => {
				const inner = print(node.childNodes)
				return `${node.tagName}${inner ? `(${inner})` : ''}`
			})
			.join(' ')
	return print(parseTemplate(text, parseSfc(text, 'Select.meeko').template, 'Select.meeko').childNodes)
}

/** The first HTML string the compiler writes for a template, as source code. */
function html(body: string): string {
	const { code } = compile(source(body), 'Select.meeko')
	const start = code.indexOf('const __meeko_html = ')
	assert.ok(start >= 0, code)
	return code.slice(start, code.indexOf('\n', start))
}

function assertInvalid(body: string, tag: string): void {
	const text = source(body)
	assert.throws(
		() => compile(text, 'Select.meeko'),
		(error: unknown) => {
			assert.ok(error instanceof MeekoCompileError, String(error))
			assert.equal(error.diagnostic.code, 'MEEK008', error.message)
			assert.match(error.message, new RegExp(`<${tag}> no puede ir dentro de <select>`))
			assert.equal(error.diagnostic.location.offset, text.indexOf(`<${tag}`, text.indexOf('<select') + 1))
			return true
		},
		body,
	)
}

describe('<select> with rich content in the compiler', () => {
	test('keeps <button>, <selectedcontent>, <span>, <div>, <legend> and <svg>', () => {
		assert.equal(tree(`<select><button type="button"><selectedcontent></selectedcontent></button><option value="a"><span class="i">*</span><span>A</span></option></select>`), 'select(button(selectedcontent) option(span span))')
		assert.equal(tree(`<select><div><option>A</option></div><optgroup label="G"><legend>G</legend><option>B</option></optgroup><hr><option><svg viewBox="0 0 10 10"><circle r="4"/></svg>C</option></select>`), 'select(div(option) optgroup(legend option) hr option(svg(circle)))')
	})

	test('an option with a <span> no longer publishes its tags as visible text', () => {
		const output = html(`<select><option><span>A</span></option></select>`)
		assert.doesNotMatch(output, /&lt;|<\/span><span>/)
		assert.match(output, /"<span" \+ ">" \+ __meeko\.escapeHtml\("A"\) \+ "<\/span>"/)
	})

	test('SVG inside an option keeps its namespace and its self-closed children', () => {
		const text = source(`<select><option><svg viewBox="0 0 10 10"><circle r="4"/></svg></option></select>`)
		const root = parseTemplate(text, parseSfc(text, 'Select.meeko').template, 'Select.meeko')
		const svg = root.childNodes![0]!.childNodes![0]!.childNodes![0]!
		assert.equal(svg.namespaceURI, 'http://www.w3.org/2000/svg')
		assert.equal(svg.childNodes![0]!.tagName, 'circle')
		assert.match(html(`<select><option><svg viewBox="0 0 10 10"><circle r="4"/></svg></option></select>`), /" viewBox=\\"0 0 10 10\\""/)
	})

	test('a component, <render> and directives inside a select stay in it', () => {
		assert.equal(tree(`<select><Foo /><render snippet="s" /><option>A</option></select>`), 'select(Foo render option)')
		assert.equal(tree(`<select><Foo><option>A</option></Foo><option>B</option></select>`), 'select(Foo(option) option)')
		assert.match(html(`<select><button if:when="value.value"><selectedcontent></selectedcontent></button><option each:of="list" each:as="o" each:key="o" bind:value="o"><span>{o}</span></option></select>`), /renderFor/)
	})

	test('the output of a select without rich content does not change', () => {
		const expected: Record<string, string> = {
			[`<select name="x"><option value="a">A</option><option value="b" selected>B</option></select>`]: `"<select" + " name=\\"x\\"" + ">" + "<option" + " value=\\"a\\"" + ">" + __meeko.escapeHtml("A") + "</option>" + "<option" + " value=\\"b\\"" + " selected=\\"\\"" + ">" + __meeko.escapeHtml("B") + "</option>" + "</select>"`,
			[`<select><option>A<option>B<optgroup label="g"><option>C</select><p>after</p>`]: `"<select" + ">" + "<option" + ">" + __meeko.escapeHtml("A") + "</option>" + "<option" + ">" + __meeko.escapeHtml("B") + "</option>" + "<optgroup" + " label=\\"g\\"" + ">" + "<option" + ">" + __meeko.escapeHtml("C") + "</option>" + "</optgroup>" + "</select>" + "<p" + ">" + __meeko.escapeHtml("after") + "</p>"`,
			[`<form><select name="x"><option>A</option></select><button>go</button></form>`]: `"<form" + ">" + "<select" + " name=\\"x\\"" + ">" + "<option" + ">" + __meeko.escapeHtml("A") + "</option>" + "</select>" + "<button" + ">" + __meeko.escapeHtml("go") + "</button>" + "</form>"`,
			[`<table><tbody><tr><td><select><option>A</option></select></td></tr></tbody></table>`]: `"<table" + ">" + "<tbody" + ">" + "<tr" + ">" + "<td" + ">" + "<select" + ">" + "<option" + ">" + __meeko.escapeHtml("A") + "</option>" + "</select>" + "</td>" + "</tr>" + "</tbody>" + "</table>"`,
			[`<select /><p>after</p>`]: `"<select" + ">" + "</select>" + "<p" + ">" + __meeko.escapeHtml("after") + "</p>"`,
			[`<sElEcT name="x"><option>A</option></sElEcT>`]: `"<select" + " name=\\"x\\"" + ">" + "<option" + ">" + __meeko.escapeHtml("A") + "</option>" + "</select>"`,
		}
		for (const [body, output] of Object.entries(expected)) assert.equal(html(body), `const __meeko_html = ${output};`, body)
	})

	test('<SELECT> and <Selector /> are still components, and an unclosed select is still an error', () => {
		assert.equal(tree(`<SELECT label="x"><option>A</option></SELECT>`), 'SELECT(option)')
		assert.equal(tree(`<Select><option>A</option></Select>`), 'Select(option)')
		assert.equal(tree(`<Selector /><p>after</p>`), 'Selector p')
		assert.throws(() => compile(source(`<select><option>A</option>`), 'Select.meeko'), /MEEK001/)
	})

	test('a stray </select> is ignored as before, and a <jelect> of the author keeps its name', () => {
		assert.equal(tree(`<div></select></div>`), 'div')
		assert.equal(tree(`<jelect>x</jelect>`), 'jelect')
	})

	test('<input> and a nested <select> are an error, because the browser closes the select at them', () => {
		assertInvalid(`<select><input name="q"><option>A</option></select>`, 'input')
		assertInvalid(`<select><select><option>A</option></select></select>`, 'select')
		assertInvalid(`<select><div><input></div><option>A</option></select>`, 'input')
		assertInvalid(`<select><button><input></button><option>A</option></select>`, 'input')
	})

	test('the same tags are valid after a select, behind a scope barrier or in content rendered elsewhere', () => {
		assert.equal(tree(`<select><option>A</option></select><input>`), 'select(option) input')
		assert.equal(tree(`<select><option><table><tbody><tr><td><input></td></tr></tbody></table></option></select>`), 'select(option(table(tbody(tr(td(input))))))')
		assert.equal(tree(`<select><option><object><input></object></option></select>`), 'select(option(object(input)))')
		assert.equal(tree(`<select><Foo><input></Foo></select>`), 'select(Foo(input))')
		assert.equal(tree(`<select><Input /><option>A</option></select>`), 'select(Input option)')
	})

	test('a <textarea> stays inside the select, as in the browsers', () => {
		assert.equal(tree(`<select><textarea></textarea><option>A</option></select>`), 'select(textarea option)')
	})
})

describe('hydration next to the copy that <selectedcontent> holds', () => {
	/**
	 * The DOM a browser leaves with the option chosen: the option's content, attributes and markers
	 * copied into <selectedcontent>. Built by hand because happy-dom does not copy it.
	 */
	function chosen(): { browser: HappyWindow; root: Element; option: Element; copy: Element } {
		const browser = new HappyWindow({ url: 'https://example.test/' })
		const { document } = browser
		const root = document.createElement('div')
		document.body.append(root)
		const select = document.createElement('select')
		const button = document.createElement('button')
		const copy = document.createElement('selectedcontent')
		const option = document.createElement('option')
		const span = '<span data-meeko="1" title="old"><!--meeko:text:0-->Beta<!--/meeko:text:0--></span>'
		option.innerHTML = span
		copy.innerHTML = span
		button.append(copy)
		select.append(button, option)
		root.append(select)
		return { browser, root: root as unknown as Element, option: option as unknown as Element, copy: copy as unknown as Element }
	}

	test('text, attributes and events hook onto the option, not onto its copy, and release', () => {
		const { browser, root, option, copy } = chosen()
		try {
			const label = signal('Beta')
			const title = signal('old')
			let clicks = 0
			const scope = { root }
			const releases = [
				bindText(scope, 0, () => label.value, 'text'),
				bindAttribute(scope, 1, 'title', () => title.value, 'attribute'),
				bindEvent(scope, 1, 'click', () => {
					clicks++
				}),
			]
			label.value = 'Beta 2'
			title.value = 'new'
			const inOption = option.querySelector('span') as unknown as HTMLElement
			const inCopy = copy.querySelector('span') as unknown as HTMLElement
			assert.equal(inOption.textContent, 'Beta 2')
			assert.equal(inOption.getAttribute('title'), 'new')
			assert.equal(inCopy.textContent, 'Beta')
			assert.equal(inCopy.getAttribute('title'), 'old')
			inCopy.click()
			assert.equal(clicks, 0)
			inOption.click()
			assert.equal(clicks, 1)
			for (const release of releases) release()
			inOption.click()
			label.value = 'Beta 3'
			assert.equal(clicks, 1)
			assert.equal(inOption.textContent, 'Beta 2')
		} finally {
			browser.happyDOM.abort()
		}
	})

	test('a binding of the <selectedcontent> element itself still finds it', () => {
		const { browser, root, copy } = chosen()
		try {
			copy.setAttribute('data-meeko', '7')
			copy.setAttribute('class', 'a')
			const name = signal('a')
			const release = bindAttribute({ root }, 7, 'class', () => name.value, 'attribute')
			name.value = 'b'
			assert.equal(copy.getAttribute('class'), 'b')
			release()
		} finally {
			browser.happyDOM.abort()
		}
	})
})

describe('types of the native syntax', () => {
	let root: string

	before(async () => {
		const parent = resolve('.meeko')
		await mkdir(parent, { recursive: true })
		root = await mkdtemp(join(parent, 'select-content-check-'))
		await writeFile(join(root, 'package.json'), '{"private":true,"type":"module"}\n')
		await writeFile(
			join(root, 'tsconfig.json'),
			`${JSON.stringify({
				compilerOptions: { types: ['node'], paths: { '@meekojs/meeko/internal': ['../../src/internal.ts'], '@meekojs/meeko': ['../../src/index.ts'] } },
			})}\n`,
		)
	})

	after(async () => {
		await rm(root, { recursive: true, force: true })
	})

	const check = async (name: string, text: string): Promise<string[]> => {
		const file = join(root, `${name}.meeko`)
		await writeFile(file, text)
		return (await checkSource(text, file)).map((item) => `${item.code}: ${item.message}`)
	}

	test('on:command receives a CommandEvent, inline and through a function', async () => {
		assert.deepEqual(
			await check(
				'Command',
				`<script lang="ts">
function run(event: CommandEvent): void { console.log(event.command, event.source); }
</script>
<template><dialog id="d" on:command="run" on:cancel="(event) => event.preventDefault()"></dialog><div on:command="(event: CommandEvent) => console.log(event.command)"></div><div on:command="(event) => console.log(event.command, event.currentTarget.id)"></div><button commandfor="d" command="show-modal" popovertarget="p">x</button></template>
`,
			),
			[],
		)
	})

	test('a rich select passes meeko check, with its elements typed', async () => {
		assert.deepEqual(
			await check(
				'Rich',
				`<script lang="ts">
import { signal } from "@meekojs/meeko";
const value = signal("a");
const options = signal([{ id: "a", name: "Alfa" }]);
const clicks = signal(0);
</script>
<template><select model="value"><button type="button" on:click="(event) => console.log(event.currentTarget.type)"><selectedcontent></selectedcontent></button><option each:of="options.value" each:as="option" each:key="option.id" bind:value="option.id" on:click="(event) => console.log(event.currentTarget.selected)"><svg viewBox="0 0 10 10"><circle r="4" /></svg><span on:click="() => clicks.value++">{option.name}</span></option></select></template>
`,
			),
			[],
		)
	})

	test('<component is> with a select explains that the value comes from its options', async () => {
		const text = `<script lang="ts">
const value = "a";
</script>
<template><component is="'select'" bind:value="value"><option value="a">A</option></component></template>
`
		assert.deepEqual(await check('Dynamic', text), [
			'MEEK112: <select> no tiene el atributo value: Meeko no lo escribiría nunca; marca la opción elegida con bind:selected, o escribe <select> en la plantilla con model',
		])
		assert.deepEqual(await check('DynamicOther', text.replace("'select'", "'div'")), [
			'MEEK112: value no se aplica a ninguna etiqueta posible de is: Meeko no lo escribiría nunca; quítalo o añade a is una etiqueta que lo admita',
		])
		assert.deepEqual(
			await check(
				'DynamicSelected',
				`<template><component is="'select'" bind:required="true"><option bind:selected="true" value="a">A</option></component></template>
`,
			),
			[],
		)
	})

	test('interestfor is in the HTML data as experimental, with its events', () => {
		for (const tag of ['a', 'area', 'button'] as const) {
			assert.deepEqual(htmlElementAttributes[tag].interestfor, { experimental: true }, tag)
			assert.ok(elementAttributeNames[tag].split(' ').includes('interestfor'), tag)
		}
		assert.ok(elementEventNames.split(' ').includes('interest'))
		assert.ok(elementEventNames.split(' ').includes('loseinterest'))
	})

	test('interestfor is accepted in a checked attribute of <component is>', async () => {
		assert.deepEqual(
			await check(
				'Interest',
				`<template><component is="'button'" bind:interestfor="'hint'">x</component><div id="hint" popover="hint"></div></template>
`,
			),
			[],
		)
	})
})
