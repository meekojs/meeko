import assert from 'node:assert/strict'
import { mkdir, symlink, writeFile } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import test from 'node:test'

import { compile } from '../src/compiler.ts'
import { checkApp } from '../src/framework/check-app.ts'
import { prepareFrameworkTypeDeclarations } from '../src/framework/type-declarations.ts'
import { createTempProject } from './helpers/temp-project.ts'

/** A component that forwards optional params to `<MeekoLink>`, as `@meekojs/ui` does in `UIButton`. */
const forwarder = `<script lang="ts">
const props = defineProps<{ to: RouteId; params?: Record<string, string> }>()
</script>
<template><MeekoLink bind:to="props.to" bind:params="props.params">x</MeekoLink></template>
`

/** Prepares an app with the given pages and components, and returns a checker for the template of its index page. */
async function createApp(name: string, pages: readonly string[], components: Readonly<Record<string, string>> = { 'AppLink.meeko': forwarder }) {
	const project = await createTempProject(name)
	const root = project.root
	await writeFile(join(root, 'package.json'), '{"private":true,"type":"module"}\n')
	await mkdir(join(root, 'node_modules', '@meekojs'), { recursive: true })
	await symlink(resolve('.'), join(root, 'node_modules', '@meekojs', 'meeko'), 'junction')
	await mkdir(join(root, 'app', 'components'), { recursive: true })
	await mkdir(join(root, 'app', 'pages'), { recursive: true })
	for (const page of pages) {
		await mkdir(join(root, 'app', 'pages', page, '..'), { recursive: true })
		await writeFile(join(root, 'app', 'pages', page), '<template><h1>x</h1></template>\n')
	}
	for (const [file, source] of Object.entries(components)) await writeFile(join(root, 'app', 'components', file), source)
	await prepareFrameworkTypeDeclarations(root)
	const check = async (script: string, uses: string) => {
		await writeFile(join(root, 'app', 'pages', 'index.meeko'), `<script lang="ts">\n${script}\n</script>\n<template>${uses}</template>\n`)
		return (await checkApp(root)).map((item) => `${item.code}: ${item.message}`)
	}
	return { project, check }
}

test('without generated routes (RouteId = string), <MeekoLink> takes optional params', { timeout: 180_000 }, async () => {
	const { project, check } = await createApp('link-params-no-routes', [])
	try {
		const script = 'const maybe = signal<Record<string, string> | undefined>(undefined);'
		// Params are optional and accept Record<string, string>, also when they are `undefined`.
		assert.deepEqual(await check(script, '<MeekoLink to="/anything">x</MeekoLink>'), [])
		assert.deepEqual(await check(script, '<MeekoLink to="/users/[id]" bind:params="{ id: \'7\' }">x</MeekoLink>'), [])
		assert.deepEqual(await check(script, '<MeekoLink to="/anything" bind:params="maybe.value">x</MeekoLink>'), [])
		// The params still have to be strings.
		const wrong = await check(script, '<MeekoLink to="/anything" bind:params="{ id: 7 }">x</MeekoLink>')
		assert.ok(
			wrong.some((item) => /^TS2322:/.test(item)),
			JSON.stringify(wrong),
		)
		// href() has the same rule: params are optional, also next to a search.
		assert.deepEqual(await check("const url = href('/users/[id]', { search: { tab: 'x' } });", '<a bind:href="url">x</a>'), [])
		// A component that forwards optional params needs no `params ?? {}`.
		assert.deepEqual(await check(script, '<AppLink to="/anything" bind:params="maybe.value" />'), [])
	} finally {
		await project.remove()
	}
})

test('with generated routes, <MeekoLink> requires params of a dynamic route and forbids them in a static one', { timeout: 180_000 }, async () => {
	const { project, check } = await createApp('link-params-routes', ['about.meeko', 'users/[id].meeko'])
	try {
		const script = 'const maybe = signal<{ id: string } | undefined>(undefined);'
		assert.deepEqual(await check(script, '<MeekoLink to="/about">x</MeekoLink>'), [])
		assert.deepEqual(await check(script, '<MeekoLink to="/users/[id]" bind:params="{ id: \'7\' }">x</MeekoLink>'), [])
		const wrong: Array<[string, RegExp]> = [
			['<MeekoLink to="/users/[id]">x</MeekoLink>', /^TS2/],
			['<MeekoLink to="/users/[id]" bind:params="maybe.value">x</MeekoLink>', /^TS2/],
			['<MeekoLink to="/about" bind:params="{ id: \'7\' }">x</MeekoLink>', /^TS2/],
			['<MeekoLink to="/nowhere">x</MeekoLink>', /^TS2345:.*\/nowhere/],
		]
		for (const [uses, message] of wrong) {
			const diagnostics = await check(script, uses)
			assert.ok(
				diagnostics.some((item) => message.test(item)),
				`${uses}: ${JSON.stringify(diagnostics)}`,
			)
		}
	} finally {
		await project.remove()
	}
})

test('with one static route, a forwarder narrows its params to undefined and <MeekoLink> takes them', { timeout: 180_000 }, async () => {
	// The only route of the app is the index page: `to` is not a union of routes, as in a new application.
	const { project, check } = await createApp('link-params-single-route', ['index.meeko'], {
		'Polymorphic.meeko': `<script lang="ts">
type RouteProps = { to: RouteId; params?: never; search?: Readonly<Record<string, string>>; href?: never }
type AnchorProps = { href: string; to?: never; params?: never; search?: never }
const { to, params, search, href } = defineProps<RouteProps | AnchorProps>()
</script>
<template><component is="to !== undefined ? 'MeekoLink' : 'a'" bind:to="to" bind:params="params" bind:search="search" bind:href="href">x</component></template>
`,
	})
	try {
		assert.deepEqual(await check('', '<Polymorphic to="/" /><Polymorphic href="/elsewhere" />'), [])
		// An explicit `undefined` is the same as no params; real params are still an error.
		assert.deepEqual(await check('', '<MeekoLink to="/" bind:params="undefined">x</MeekoLink>'), [])
		const wrong = await check('', '<MeekoLink to="/" bind:params="{ id: \'7\' }">x</MeekoLink>')
		assert.ok(
			wrong.some((item) => /^TS2/.test(item)),
			JSON.stringify(wrong),
		)
	} finally {
		await project.remove()
	}
})

test("the type of <MeekoLink> is the same in the compiler's check and in the editor's virtual code", () => {
	const filename = 'app/components/NavItem.meeko'
	const { code } = compile('<template><MeekoLink to="/a" bind:params="p">x</MeekoLink></template>', filename, { typeCheck: true })
	// The helper that both the compiler and the editor emit: no generated routes, optional params.
	assert.match(code, /type __MeekoLinkOptions<K extends string> = \(keyof __MeekoRoutes extends never \? \{ params\?: Record<string, string> \| undefined \}/)
})
