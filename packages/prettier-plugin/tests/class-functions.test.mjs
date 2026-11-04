import { compile } from '@meekojs/meeko/compiler'
import corePlugin from '@meekojs/meeko/prettier'
import assert from 'node:assert/strict'
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'
import { format } from 'prettier'

import plugin from '../dist/index.js'

// The fixture resolves tailwindcss and @tailwindcss/postcss from packages/meeko, as a project would.
const fixture = fileURLToPath(new URL('../../meeko/tests/fixtures/tailwind-app/', import.meta.url))

const alphabetical = { meekoClassFunctions: ['tv', 'clsx', 'cn', 'styles.cn'], meekoSortClasses: 'alphabetical', plugins: [plugin] }

async function formatStable(source, options) {
	const formatted = await format(source, options)
	assert.equal(await format(formatted, options), formatted)
	return formatted
}

const ts = (source, options = {}) => formatStable(source, { ...alphabetical, filepath: 'styles.ts', ...options })

const fullTv = `const button = tv({
  base: "z y",
  slots: { icon: "d c", label: ["f e", "h g"] },
  variants: {
    size: { "z a": "k j", md: cond ? "m l" : "o n" },
  },
  defaultVariants: { size: "md" },
  compoundVariants: [{ size: ["md", "lg"], class: "q p" }],
  compoundSlots: [{ slots: ["icon", "label"], size: "md", class: "s r" }],
});
`

const fullTvSorted = `const button = tv({
  base: "y z",
  slots: { icon: "c d", label: ["e f", "g h"] },
  variants: {
    size: { "z a": "j k", md: cond ? "l m" : "n o" },
  },
  defaultVariants: { size: "md" },
  compoundVariants: [{ size: ["md", "lg"], class: "p q" }],
  compoundSlots: [{ slots: ["icon", "label"], size: "md", class: "r s" }],
});
`

test('sorts every string of a complete tv() in a .ts file and never its keys', async () => {
	assert.equal(await ts(fullTv), fullTvSorted)
})

test('sorts in .tsx and .js files too', async () => {
	assert.equal(await formatStable('const a = <p class={cn("b a")} />;\n', { ...alphabetical, filepath: 'a.tsx' }), 'const a = <p class={cn("a b")} />;\n')
	assert.equal(await formatStable('const a = cn("b a");\n', { ...alphabetical, filepath: 'a.js' }), 'const a = cn("a b");\n')
})

test('changes nothing without the option or without an order', async () => {
	for (const options of [{ meekoClassFunctions: undefined }, { meekoClassFunctions: [] }, { meekoSortClasses: 'off' }, { meekoSortClasses: undefined }, { meekoClassFunctions: ['other'] }]) {
		assert.equal(await ts(fullTv, options), fullTv)
	}
	const source = '<script lang="ts">\nconst a = tv({ base: "b a" });\n</script>\n\n<template>\n<p bind:class="on ? \'b  a\' : \'d c\'"></p>\n<Card class="b  a" />\n</template>\n'
	assert.equal(await formatStable(source, { filepath: 'Component.meeko', plugins: [plugin] }), source)
	assert.equal(await formatStable(source, { filepath: 'Component.meeko', meekoSortClasses: 'off', meekoClassFunctions: ['tv'], plugins: [plugin] }), source)
})

test('applies the rules of duplicates and whitespace of a static class', async () => {
	assert.equal(await ts('cn("b  a\\tb");\ncn("b  a b ");\ncn("  ");\ncn("");\n'), 'cn("b  a\\tb");\ncn("a b");\ncn("  ");\ncn("");\n')
})

test('only follows values: other strings of the call stay as written', async () => {
	const source = `cn(a === "z y" ? "b a" : "d c");
cn(a !== "z y" && "b a");
cn(t("z y"), "b a");
cn(() => "z y");
cn(fn(cn("b a")));
cn(list.includes("z y"));
cn({ "z y": on, [key]: "b a", method() { return "z y"; } });
other("z y");
const unrelated = "z y";
`
	assert.equal(
		await ts(source),
		`cn(a === "z y" ? "a b" : "c d");
cn(a !== "z y" && "a b");
cn(t("z y"), "a b");
cn(() => "z y");
cn(fn(cn("a b")));
cn(list.includes("z y"));
cn({
  "z y": on,
  [key]: "a b",
  method() {
    return "z y";
  },
});
other("z y");
const unrelated = "z y";
`,
	)
})

test('follows the three logical operators', async () => {
	assert.equal(await ts('cn(a && "b a", b || "d c", c ?? "f e");\n'), 'cn(a && "a b", b || "c d", c ?? "e f");\n')
})

test('names a member by its path and follows spreads, casts and optional calls', async () => {
	assert.equal(await ts('styles.cn("b a");\nother.cn("b a");\nstyles[cn]("b a");\n'), 'styles.cn("a b");\nother.cn("b a");\nstyles[cn]("b a");\n')
	assert.equal(await ts('cn(..."z y", ...["b a"], ("d c" as string), "f e"!);\ncn?.("b a");\n'), 'cn(..."y z", ...["a b"], "c d" as string, "e f"!);\ncn?.("a b");\n')
})

test('keeps the whitespace and the partial classes around a ${…}', async () => {
	assert.equal(await ts('cn(`z y ${a} d c`);\n'), 'cn(`y z ${a} c d`);\n')
	assert.equal(await ts('cn(`z y p-${a} d c`);\n'), 'cn(`y z p-${a} c d`);\n')
	assert.equal(await ts('cn(`z p-${a}-d y c`);\n'), 'cn(`z p-${a}-d c y`);\n')
	assert.equal(await ts('cn(`  z y  ${a}  d c  `);\n'), 'cn(`  y z  ${a}  c d  `);\n')
	assert.equal(await ts('cn(`\n  z y\n  ${a}\n  d c\n`);\n'), 'cn(`\n  y z\n  ${a}\n  c d\n`);\n')
	assert.equal(await ts('cn(`a b ${a} ${on ? "z y" : "d c"} b a`);\n'), 'cn(`a b ${a} ${on ? "y z" : "c d"} a b`);\n')
	assert.equal(await ts('cn(`p-${on ? "z y" : "d c"}`);\n'), 'cn(`p-${on ? "z y" : "d c"}`);\n')
})

test('sorts a template without expressions as a string and leaves escapes alone', async () => {
	assert.equal(await ts('cn(`\n  z y\n  b a\n`);\n'), 'cn(`a b y z`);\n')
	assert.equal(await ts('cn(`z\\ty ${a}`);\ncn("z\\u0020y");\n'), 'cn(`z\\ty ${a}`);\ncn("z\\u0020y");\n')
})

test('keeps the edges of a concatenation', async () => {
	assert.equal(await ts('cn("z y " + a);\ncn(a + " z y");\ncn("z y-" + a);\ncn(a + "-z y");\ncn("z y " + a + " d c");\n'), 'cn("y z " + a);\ncn(a + " y z");\ncn("z y-" + a);\ncn(a + "-z y");\ncn("y z " + a + " c d");\n')
})

test('keeps a prettier-ignore and a comment', async () => {
	assert.equal(await ts('// prettier-ignore\nconst a = cn("b a");\nconst b = cn(/* first */ "b a"); // last\n'), '// prettier-ignore\nconst a = cn("b a");\nconst b = cn(/* first */ "a b"); // last\n')
})

test('keeps the quotes Prettier chooses', async () => {
	assert.equal(await ts('cn("b a", \'content-["x"] a\');\n', { singleQuote: true }), "cn('a b', 'a content-[\"x\"]');\n")
})

const component = `<script lang="ts">
const a = tv({ base: "b a", variants: { "z y": { x: ["d c"] } } });
</script>

<script server lang="ts">
const b = cn("b a");
</script>

<template>
<p class="d c"></p>
<p bind:class="on ? 'b a' : cn('f e')"></p>
<p bind:title="on ? 'b a' : 'd c'"></p>
<Card class="b  a b" />
<Card bind:class="{ 'z y': on }" />
<component is="Card" class="b a"></component>
</template>
`

test('sorts the script, the server script and the template of a component', async () => {
	const formatted = await formatStable(component, { ...alphabetical, filepath: 'Component.meeko' })
	assert.equal(
		formatted,
		`<script lang="ts">
const a = tv({ base: "a b", variants: { "z y": { x: ["c d"] } } });
</script>

<script server lang="ts">
const b = cn("a b");
</script>

<template>
<p class="c d"></p>
<p bind:class="on ? 'a b' : cn('e f')"></p>
<p bind:title="on ? 'b a' : 'd c'"></p>
<Card class="a b" />
<Card bind:class="{ 'z y': on }" />
<component is="Card" class="a b"></component>
</template>
`,
	)
	compile(formatted, 'Component.meeko')
})

test('without class functions, bind:class and the class of a component still follow the mode', async () => {
	const formatted = await formatStable(component, { filepath: 'Component.meeko', meekoSortClasses: 'alphabetical', plugins: [plugin] })
	assert.match(formatted, /tv\(\{ base: "b a"/)
	assert.match(formatted, /cn\("b a"\)/)
	assert.match(formatted, /bind:class="on \? 'a b' : cn\('f e'\)"/)
	assert.match(formatted, /<Card class="a b"/)
})

test('escapes the quotes of a sorted bind:class as any other expression', async () => {
	const formatted = await formatStable('<template>\n<p bind:class="on ? &quot;b a&quot; : &quot;d c&quot;"></p>\n</template>\n', { ...alphabetical, filepath: 'Component.meeko', singleQuote: true })
	assert.equal(formatted, `<template>\n<p bind:class="on ? 'a b' : 'c d'"></p>\n</template>\n`)
})

test('orders with the design system of the project in a component and a .ts file', async () => {
	const options = { meekoClassFunctions: ['tv'], meekoSortClasses: 'tailwind', plugins: [plugin], printWidth: 200 }
	const source = 'const a = tv({ base: "text-white custom bg-brand flex custom", variants: { "p-gutter flex": { x: "text-white flex" } } });\n'
	const sorted = 'const a = tv({ base: "custom flex bg-brand text-white", variants: { "p-gutter flex": { x: "flex text-white" } } });\n'
	assert.equal(await formatStable(source, { ...options, filepath: `${fixture}app/styles.ts` }), sorted)
	const formatted = await formatStable(`<script lang="ts">\n${source}</script>\n\n<template>\n<Card class="text-white flex" />\n<p bind:class="on ? 'text-white flex' : ''"></p>\n</template>\n`, { ...options, filepath: `${fixture}app/components/Probe.meeko` })
	assert.equal(formatted, `<script lang="ts">\n${sorted}</script>\n\n<template>\n<Card class="flex text-white" />\n<p bind:class="on ? 'flex text-white' : ''"></p>\n</template>\n`)
})

test('the stylesheet mode knows the classes of the component in its script and only the global ones in a .ts file', async () => {
	const root = await mkdtemp(join(tmpdir(), 'meeko-class-functions-'))
	try {
		await mkdir(join(root, 'app', 'styles'), { recursive: true })
		await writeFile(join(root, 'meeko.config.ts'), 'export default {}\n')
		await writeFile(join(root, 'app', 'styles', 'main.css'), '.global-b { color: red; }\n.global-a { color: blue; }\n')
		const options = { meekoClassFunctions: ['cn'], meekoSortClasses: 'stylesheet', plugins: [plugin] }
		const source = 'const a = cn("local-b global-a unknown global-b local-a");\n'
		const component = `<script lang="ts">\n${source}</script>\n\n<style>\n.local-a {\n  color: red;\n}\n.local-b {\n  color: blue;\n}\n</style>\n\n<template>\n<p>x</p>\n</template>\n`
		assert.match(await formatStable(component, { ...options, filepath: join(root, 'app', 'Probe.meeko') }), /cn\("unknown global-b global-a local-a local-b"\)/)
		assert.equal(await formatStable(source, { ...options, filepath: join(root, 'app', 'styles.ts') }), 'const a = cn("local-b unknown local-a global-b global-a");\n')
	} finally {
		await rm(root, { recursive: true, force: true })
	}
})

test('works when the language server puts the plugin of the core last', async () => {
	const options = { filepath: 'Component.meeko', meekoClassFunctions: ['tv', 'cn'], meekoSortClasses: 'alphabetical', plugins: [plugin, corePlugin] }
	const formatted = await formatStable(component, options)
	assert.match(formatted, /tv\(\{ base: "a b", variants: \{ "z y": \{ x: \["c d"\] \} \} \}\)/)
	assert.match(formatted, /const b = cn\("a b"\)/)
	// Since 1.8 the template printer of the core sorts them too: the editor gives what the CLI gives.
	assert.match(formatted, /bind:class="on \? 'a b' : cn\('e f'\)"/)
	assert.match(formatted, /<Card class="a b"/)
	const arrays = '// first\nconst a = [\n  1, // one\n];\n/* last */\n'
	assert.equal(await format(arrays, { filepath: 'a.ts', plugins: [plugin, corePlugin] }), arrays)
})

test('the order of the core and the plugin does not break the printer', async () => {
	assert.equal(await formatStable('cn("b a");\n', { ...alphabetical, filepath: 'a.ts', plugins: [corePlugin, plugin] }), 'cn("a b");\n')
})

test('the plugin declares the option as a list that is empty by default', () => {
	assert.equal(plugin.options.meekoClassFunctions.type, 'string')
	assert.equal(plugin.options.meekoClassFunctions.array, true)
	assert.deepEqual(plugin.options.meekoClassFunctions.default, [{ value: [] }])
})
