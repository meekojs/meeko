import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { mkdir, mkdtemp, rm, symlink, unlink, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'

import { checkApp } from '../../meeko/dist/framework/check-app.js'
import { prepareFrameworkTypes } from '../../meeko/dist/framework/check-project.js'

const packageRoot = fileURLToPath(new URL('..', import.meta.url))

test('UIButton and UILink public types correlate routes and params and exclude the props of other branches', () => {
	const tsc = fileURLToPath(new URL('../node_modules/typescript/bin/tsc', import.meta.url))
	execFileSync(process.execPath, [tsc, '--ignoreConfig', '--noEmit', '--strict', '--skipLibCheck', '--module', 'nodenext', '--target', 'es2022', fileURLToPath(new URL('./types/button.ts', import.meta.url))], { stdio: 'pipe' })
})

/** An application with `@meekojs/ui`, three routes and the given pages. */
async function createApp(context, pages) {
	const parent = join(packageRoot, '.meeko')
	await mkdir(parent, { recursive: true })
	const root = await mkdtemp(join(parent, 'button-app-'))
	const link = join(root, 'node_modules', '@meekojs', 'ui')
	// The link goes first, so removing the application never walks into the package.
	context.after(async () => {
		await unlink(link).catch(() => undefined)
		await rm(root, { recursive: true, force: true })
	})
	const files = {
		'package.json': JSON.stringify({ name: 'button-app', private: true, type: 'module' }),
		'meeko.config.ts': "import { defineMeekoConfig } from '@meekojs/meeko/framework'\nexport default defineMeekoConfig({ modules: ['@meekojs/ui'] })\n",
		'app/app.meeko': '<template><MeekoOutlet /></template>\n',
		'app/pages/about.meeko': '<template><p>About</p></template>\n',
		'app/pages/users/[id].meeko': '<template><p>User</p></template>\n',
		...pages,
	}
	for (const [file, source] of Object.entries(files)) {
		await mkdir(dirname(join(root, file)), { recursive: true })
		await writeFile(join(root, file), source)
	}
	// The application resolves the package under test, as a consumer that installed it.
	await mkdir(join(root, 'node_modules', '@meekojs'), { recursive: true })
	await symlink(packageRoot, link, 'junction')
	return root
}

const valid = `<script lang="ts">
	const user = { id: '7' }
	const saving = signal(false)
	const clicks = signal(0)
</script>
<template>
	<UIButton to="/about" variant="outline" on:click="(event) => clicks.value += event.button">About</UIButton>
	<UIButton to="/users/[id]" bind:params="{ id: user.id }" bind:search="{ tab: 'activity' }" aria-label="Profile" data-testid="profile">Profile</UIButton>
	<UIButton href="https://example.com" target="_blank" id="docs" title="Docs">Docs</UIButton>
	<UIButton href="/report.pdf" download="report.pdf" size="sm" shape="pill">Download</UIButton>
	<UIButton type="submit" bind:disabled="saving.value" bind:aria-busy="saving.value">Save</UIButton>
	<UIButton class="wide" tabindex="0" on:click="() => clicks.value++">Count</UIButton>
	<UILink href="/about" ariaLabel="About">About</UILink>
	<UILink to="/users/[id]" bind:params="{ id: user.id }" data-testid="user">User</UILink>
	<UILink to="/about" hreflang="en" lang="en" target="_blank">About in English</UILink>
	<UILink href="https://example.com/en" hreflang="en">Example</UILink>
	<UIButton to="/about" hreflang="en" bind:resolve="false">About as written</UIButton>
</template>
`

test('a template checks the routes, params and exclusive props of UIButton and UILink', { timeout: 180_000 }, async (context) => {
	const invalid = [
		'<UIButton to="/missing">Missing</UIButton>',
		'<UIButton to="/users/[id]">No params</UIButton>',
		`<UIButton to="/users/[id]" bind:params="{ slug: 'x' }">Wrong params</UIButton>`,
		'<UIButton to="/about" href="/about">Both</UIButton>',
		'<UIButton href="/about" type="submit">Link type</UIButton>',
		'<UIButton href="/about" disabled>Disabled link</UIButton>',
		'<UIButton to="/about" disabled>Disabled route</UIButton>',
		'<UIButton type="button" target="_blank">Button target</UIButton>',
		'<UIButton autocomplete="off">Not shared by a and button</UIButton>',
		'<UILink to="/" href="/">Both</UILink>',
		'<UILink to="/missing">Missing</UILink>',
		'<UIButton type="button" hreflang="en">Button hreflang</UIButton>',
		'<UILink href="/about" bind:resolve="false">Resolve without to</UILink>',
	]
	const root = await createApp(context, {
		'app/pages/index.meeko': valid,
		'app/pages/invalid.meeko': `<template>\n${invalid.map((line) => `\t${line}`).join('\n')}\n</template>\n`,
	})
	// As meeko check: the generated route types first, then the sources.
	await prepareFrameworkTypes(root)
	const diagnostics = (await checkApp(root)).filter((item) => item.severity !== 'warning')
	const describe = (items) => JSON.stringify(items.map((item) => `${item.filename.replaceAll('\\', '/').split('/app/')[1]}:${item.location.line}: ${item.code} ${item.message.slice(0, 120)}`))
	assert.deepEqual(
		diagnostics.filter((item) => !item.filename.replaceAll('\\', '/').endsWith('/pages/invalid.meeko')),
		[],
		describe(diagnostics),
	)
	// Every invalid line has its own error.
	const lines = new Set(diagnostics.map((item) => item.location.line))
	invalid.forEach((source, index) => assert.ok(lines.has(index + 2), `${source} must be a type error: ${describe(diagnostics)}`))
})
