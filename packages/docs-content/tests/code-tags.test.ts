import assert from 'node:assert/strict'
import test from 'node:test'

import { codeLanguage, transformCodeTags } from '../src/content/code-tags'

test('a block without a language takes it from the file that names it or from its text', () => {
	const cases: ReadonlyArray<readonly [string, string, string?]> = [
		['css', 'a {}', 'app/styles/main.css'],
		['ts', 'const a = 1', 'meeko.config.ts'],
		['html', '<UIButton>Save</UIButton>'],
		['html', '<!-- A comment -->\n<p>text</p>'],
		['sh', 'pnpm add @meekojs/ui'],
		['sh', '# Comment\npnpm exec meeko check .\nnpx meeko build'],
		['json', '{\n  "greeting": "Hello"\n}'],
		['css', '.workspace {\n  --ui-container-gutter: 1rem;\n}'],
		['css', ':root {\n  color: red;\n}'],
		['css', '/* A brand */\n@layer ui, app;'],
		['css', 'a:hover {\n  color: red;\n}'],
		['ts', "import { signal } from '@meekojs/meeko'"],
		['ts', "// meeko.config.ts\nexport default { modules: ['@meekojs/ui'] }"],
		['ts', '// Inside the options:\ndirections: { ar: "rtl" }'],
		['ts', 'i18n: {\n  defaultLocale: "es",\n}'],
		['ts', 'modal: {\n  open: true,\n}'],
		['ts', '{\n  // Not JSON.\n  a: 1,\n}'],
		['ts', 'const pnpm = 1'],
	]
	for (const [language, code, label] of cases) assert.equal(codeLanguage(code, label), language, code)
})

const options = {
	tag: 'DocsCode',
	evaluate: (expression: string) => ({ 'examples.known': 'const a = "<b>"' })[expression],
	highlight: (code: string) => ({ html: `<pre>${code}</pre>`, label: 'ts' }),
}

/** The string that `bind:highlighted` holds in a transformed source. */
function highlighted(source: string): string {
	const literal = /bind:highlighted="('[^"]*')"/.exec(source)?.[1]
	assert.ok(literal, source)
	return new Function(`return ${literal}`)() as string
}

test('a tag whose code is known takes the highlighted block and its language', () => {
	const source = '<script lang="ts">\n\timport { examples } from "./examples"\n</script>\n<template>\n\t<DocsCode bind:code="examples.known" />\n</template>\n'
	const result = transformCodeTags(source, 'page.meeko', options)!
	assert.equal(highlighted(result), '<pre>const a = "<b>"</pre>')
	assert.match(result, / lang="ts"/)
	assert.doesNotMatch(result, /bind:code/)
	// Outside the template and above the tag nothing moves.
	assert.ok(result.startsWith(source.slice(0, source.indexOf('<DocsCode'))))
	// Nothing in the attribute closes it or opens a tag for the template parser.
	assert.doesNotMatch(/bind:highlighted="([^"]*)"/.exec(result)![1]!, /[<>&]/)
})

test('a literal code attribute, snippets and a declared language are honoured', () => {
	const literal = transformCodeTags('<template><DocsCode code="pnpm add x" label="Terminal" /></template>', 'page.meeko', options)!
	assert.equal(highlighted(literal), '<pre>pnpm add x</pre>')
	assert.match(literal, /label="Terminal"/)
	const declared = transformCodeTags('<template><DocsCode lang="sh" code="pnpm add x" /></template>', 'page.meeko', options)!
	assert.equal(declared.match(/lang=/g)?.length, 1)
	assert.match(declared, /lang="sh"/)
	const nested = transformCodeTags('<template><UICard><snippet name="footer"><DocsCode code="a" /></snippet></UICard></template>', 'page.meeko', options)!
	assert.match(nested, /bind:highlighted/)
})

test('what the build cannot read stays as it is, in plain text', () => {
	assert.equal(transformCodeTags('<template><p>none</p></template>', 'page.meeko', options), undefined)
	assert.equal(transformCodeTags('<template><DocsCode bind:code="props.source" /></template>', 'page.meeko', options), undefined)
	// A mention in a script or a comment is not a tag.
	const mention = '<script lang="ts">\n\tconst text = \'<DocsCode code="a" />\'\n</script>\n<template><!-- <DocsCode code="a" /> --><p>{text}</p></template>'
	assert.equal(transformCodeTags(mention, 'page.meeko', options), undefined)
})
