import assert from 'node:assert/strict'
import { mkdir, mkdtemp, rm, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import test from 'node:test'

import { discoverAutoImports } from '../src/autoimports/registry.ts'
import { applyAutoImports } from '../src/autoimports/transform.ts'
import { checkApp } from '../src/framework/check-app.ts'
import { prepareFrameworkTypeDeclarations } from '../src/framework/type-declarations.ts'
import { createTempProject } from './helpers/temp-project.ts'

test('navigate and useSearchParam are autoimported in app code, not on the server; a project export still wins', async () => {
	const root = await mkdtemp(join(tmpdir(), 'meeko-navigate-'))
	try {
		await writeFile(join(root, 'package.json'), '{"private":true,"type":"module"}')
		const page = join(root, 'app', 'pages', 'index.meeko')
		const registry = await discoverAutoImports(root)
		const code = applyAutoImports('const tab = useSearchParam("tab", "a");\nconst go = () => navigate("/");', page, registry, 'client')
		assert.match(code, /import \{ navigate as navigate \} from "@meekojs\/meeko\/framework"/)
		assert.match(code, /import \{ useSearchParam as useSearchParam \} from "@meekojs\/meeko\/framework"/)
		// Server code redirects instead: neither name reaches it.
		assert.throws(() => applyAutoImports('navigate("/");', join(root, 'server', 'api', 'x.ts'), registry, 'server'), /navigate/)
		await mkdir(join(root, 'app', 'composables'), { recursive: true })
		await writeFile(join(root, 'app', 'composables', 'navigate.ts'), 'export function navigate(to: string) { return to; }\n')
		const own = applyAutoImports('navigate("/");', page, await discoverAutoImports(root), 'client')
		assert.match(own, /from "\.\.\/composables\/navigate\.js"/)
	} finally {
		await rm(root, { recursive: true, force: true })
	}
})

test('meeko check types the target of navigate() like <MeekoLink> and the value of useSearchParam() by its schema', { timeout: 180_000 }, async () => {
	const project = await createTempProject('navigate-types')
	const root = project.root
	try {
		await writeFile(join(root, 'package.json'), '{"private":true,"type":"module"}\n')
		await mkdir(join(root, 'node_modules', '@meekojs'), { recursive: true })
		await symlink(resolve('.'), join(root, 'node_modules', '@meekojs', 'meeko'), 'junction')
		await mkdir(join(root, 'app', 'pages', 'users'), { recursive: true })
		await writeFile(join(root, 'app', 'pages', 'about.meeko'), '<template><h1>x</h1></template>\n')
		await writeFile(join(root, 'app', 'pages', 'users', '[id].meeko'), '<template><h1>x</h1></template>\n')
		await prepareFrameworkTypeDeclarations(root)
		const schema = "const pageNumber = { '~standard': { version: 1 as const, validate: (value: unknown) => ({ value: Number(value) }) } }"
		const check = async (script: string) => {
			await writeFile(join(root, 'app', 'pages', 'index.meeko'), `<script lang="ts">\n${schema}\n${script}\n</script>\n<template><p>x</p></template>\n`)
			return (await checkApp(root)).map((item) => `${item.code}: ${item.message}`)
		}
		assert.deepEqual(
			await check(`async function go() {
	await navigate({ to: '/about' })
	await navigate({ to: '/users/[id]', params: { id: '7' }, search: { tab: 'x', page: 2 }, hash: 'bio' }, { replace: true, viewTransition: false })
	const done: boolean = await navigate('/users/7?tab=x')
	return done
}
const tab = useSearchParam('tab', 'profile', { history: 'push' })
const page = useSearchParam('page', 1, { schema: pageNumber })
const text: string = tab.value
const count: number = page.value
page.value = count + 1
void [go, text]`),
			[],
		)
		const wrong: Array<[string, RegExp]> = [
			["void navigate({ to: '/nowhere' })", /^TS2769:.*\/nowhere/s],
			["void navigate({ to: '/users/[id]' })", /^TS2769:/],
			["void navigate({ to: '/about', params: { id: '7' } })", /^TS2769:/],
			["void navigate({ to: '/users/[id]', params: { slug: '7' } })", /^TS2769:/],
			["void navigate('/about', { replace: 'yes' })", /^TS2769:/],
			["const page = useSearchParam('page', 'one', { schema: pageNumber })", /^TS2769:.*'string' is not assignable to parameter of type 'number'/s],
			["const page = useSearchParam('page', 1, { schema: pageNumber }); const text: string = page.value", /^TS2322:/],
			["const tab = useSearchParam('tab', 1)", /^TS2/],
		]
		for (const [script, message] of wrong) {
			const diagnostics = await check(script)
			assert.ok(
				diagnostics.some((item) => message.test(item)),
				`${script}: ${JSON.stringify(diagnostics)}`,
			)
		}
	} finally {
		await project.remove()
	}
})
