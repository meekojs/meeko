import { compile } from '@meekojs/meeko/compiler'
import corePlugin from '@meekojs/meeko/prettier'
import assert from 'node:assert/strict'
import test from 'node:test'
import { format } from 'prettier'

import plugin from '../dist/index.js'

const defaults = {
	filepath: 'Component.meeko',
	htmlWhitespaceSensitivity: 'ignore',
	singleAttributePerLine: true,
	meekoIndentSections: true,
	useTabs: true,
	singleQuote: true,
	semi: false,
	endOfLine: 'auto',
}

/** Comprueba ambos accesos al plugin y tres guardados, incluidos LF y CRLF. */
async function stable(source, options = {}) {
	let expected
	for (const implementation of [plugin, corePlugin]) {
		const settings = { ...defaults, ...options, plugins: [implementation] }
		const formatted = await format(source, settings)
		if (settings.endOfLine === 'auto' && source.includes('\r\n')) assert.ok(!formatted.replaceAll('\r\n', '').includes('\n'), 'CRLF stays consistent')
		if (expected !== undefined) assert.equal(formatted, expected, 'editor and public plugin agree')
		expected = formatted
		compile(formatted, 'Component.meeko')
		for (let pass = 0; pass < 3; pass++) assert.equal(await format(formatted, settings), formatted, `save ${pass + 2}`)
	}
	return expected.replaceAll('\r\n', '\n')
}

for (const printWidth of [80, 800]) {
	for (const newline of ['\n', '\r\n']) {
		const name = `width ${printWidth}, ${newline === '\n' ? 'LF' : 'CRLF'}`

		test(`indents callbacks, multiline objects and interpolations with ${name}`, async () => {
			const source = `<template>
<button on:click="(event)=>{
event.preventDefault();
submit({type:mode,value:data});
}" bind:class="{
active: ready,
disabled: busy
}">{format({
label: name,
value: count.value
})}</button>
</template>`.replaceAll('\n', newline)
			const result = await stable(source, { printWidth })
			assert.ok(result.includes('on:click="\n\t\t\t(event) => {\n\t\t\t\tevent.preventDefault()'))
			assert.ok(result.includes('bind:class="{\n\t\t\tactive: ready,\n\t\t\tdisabled: busy,\n\t\t}"'))
			assert.ok(result.includes('format({\n\t\t\t\tlabel: name,\n\t\t\t\tvalue: count.value,\n\t\t\t})'))
		})

		test(`formats ternaries and preserves expression comments with ${name}`, async () => {
			const source = `<template>
<div bind:title="(
// Estado de acceso
ready?'Acceso disponible para el usuario actual':'Acceso pendiente de autorización'
)">{/* Total */ items.reduce((total,item)=>total+item.price,0)}</div>
</template>`.replaceAll('\n', newline)
			const result = await stable(source, { printWidth })
			assert.match(result, /\/\/ Estado de acceso\n\s+ready/)
			assert.match(result, /\? 'Acceso disponible para el usuario actual'/)
			assert.match(result, /: 'Acceso pendiente de autorización'/)
			assert.match(result, /\/\* Total \*\//)
			assert.match(result, /\(total, item\) => total \+ item\.price/)
		})

		test(`attaches leading comments and collapses excessive blank lines with ${name}`, async () => {
			const source = `<template>
<section>
<header>Encabezado</header>



<!-- Formulario -->


<form><button>Enviar</button></form>


<!-- Elementos -->

<div each:of="items" each:as="item">{item}</div>

<AuthCard>
<!-- Acciones -->

<snippet name="footer"><button if:when="ready">Entrar</button></snippet>
</AuthCard>
</section>
</template>`.replaceAll('\n', newline)
			const result = await stable(source, { printWidth })
			assert.match(result, /<\/header>\n\n\t\t<!-- Formulario -->\n\t\t<form>/)
			assert.match(result, /<!-- Elementos -->\n\t\t<div/)
			assert.match(result, /<!-- Acciones -->\n\t\t\t<snippet/)
			assert.doesNotMatch(result, /\n[\t ]*\n[\t ]*\n/)
		})
	}
}

test('attaches section comments and prettier-ignore while preserving the ignored code', async () => {
	const ignored = '<script lang="ts">\nconst   value=1\n</script>'
	const source = `<!-- prettier-ignore -->\n\n\n${ignored}\n\n\n<!-- Vista -->\n\n\n<template>\n<p>{value}</p>\n</template>\n\n\n<!-- Estilos -->\n\n<style>p{color:red}</style>`
	const result = await stable(source, { printWidth: 800 })
	assert.ok(result.startsWith(`<!-- prettier-ignore -->\n${ignored}`))
	assert.match(result, /<\/script>\n\n<!-- Vista -->\n<template>/)
	assert.match(result, /<\/template>\n\n<!-- Estilos -->\n<style>/)
	assert.doesNotMatch(result, /\n{3}/)
})

test('preserves literal content, ignored subtrees, inline comments and comment bodies', async () => {
	const literal = '<pre><b><!-- Literal -->\n\n<i>contenido</i></b></pre>'
	const ignored = '<div   class="raw"><b><!-- Ignorado -->\n\n<i>contenido</i></b></div>'
	const comment = '<!--\n  Una nota\n\n  con separación interna\n-->'
	const source = `<template>\n${literal}\n<textarea>  una\n\n  nota  </textarea>\n\n<!-- prettier-ignore -->\n\n${ignored}\n\n${comment}\n\n<form></form>\n<p>Antes <!-- Inline -->\n\n<strong>después</strong></p>\n</template>`
	const result = await stable(source, { printWidth: 800, htmlWhitespaceSensitivity: 'css' })
	assert.ok(result.includes(literal))
	assert.ok(result.includes(ignored))
	assert.match(result, /<textarea>\n? {2}una\n\n {2}nota {2}<\/textarea>/)
	assert.ok(result.includes(comment))
	assert.match(result, /<!-- prettier-ignore -->\n\s*<div {3}class="raw">/)
	assert.match(result, /<!-- Inline -->\n\n/)
})

test('comments that move onto their own line are stable from the first save', async () => {
	const cases = [
		'<p><strong>a</strong><!-- note -->\n\n<em>b</em></p>',
		'<section><div>a</div><!-- note -->\n\n<form>b</form></section>',
		'<p><!-- note -->\n\n<em>b</em></p>',
		'<section><!-- note -->\n\n<div>b</div></section>',
		'<section><div>a</div>\n<!-- one -->\n\n<!-- two -->\n\n<div>b</div></section>',
	]
	for (const htmlWhitespaceSensitivity of ['ignore', 'css', 'strict']) {
		for (const printWidth of [20, 80, 800]) {
			for (const source of cases) await stable(`<template>\n${source}\n</template>`, { htmlWhitespaceSensitivity, printWidth })
		}
	}
})

test('formats short conditional chains as expressions and keeps comments attached to their branch', async () => {
	const source = '<template>\n<p if="ready&&allowed">Listo</p>\n\n<!-- Carga -->\n\n<p else-if="loading||pending">Cargando</p>\n<p else>Vacío</p>\n</template>'
	const result = await stable(source, { printWidth: 800 })
	assert.match(result, /if="ready && allowed"/)
	assert.match(result, /<!-- Carga -->\n\t<p else-if="loading \|\| pending">/)
	assert.match(result, /<p else>Vacío<\/p>/)
})
