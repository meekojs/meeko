import assert from 'node:assert/strict'
import { mkdir, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { test } from 'node:test'
import { TextDocument } from 'vscode-languageserver-textdocument'

import { classProvidersManifestFile, mergeClassProviders, readClassProvidersManifestSync, writeClassProvidersManifest } from '../src/framework/class-providers.ts'
import { ClassIndex, classProviderActive, configuredClassView } from '../src/language-server/classes.ts'
import { styleDiagnostics } from '../src/language-server/embedded.ts'
import { MeekoProject, staticClassProviders } from '../src/language-server/project.ts'
import { createTempProject } from './helpers/temp-project.ts'

const tailwind = { name: 'Tailwind CSS', vscode: ['bradlc.vscode-tailwindcss'], languages: ['tailwindcss'] }
const uno = { name: 'UnoCSS', vscode: ['antfu.unocss'], languages: [] }

test('a declared provider takes the generated classes only while the editor reports its extension active', () => {
	// A client from 1.12 sends the active extensions of the declared providers, also an empty list.
	assert.equal(classProviderActive({ activeExtensions: ['bradlc.vscode-tailwindcss'] }, [tailwind]), true, 'declared and active')
	assert.equal(classProviderActive({ activeExtensions: ['Bradlc.VSCode-TailwindCSS'] }, [tailwind]), true, 'extension ids ignore case')
	assert.equal(classProviderActive({ activeExtensions: [] }, [tailwind]), false, 'declared and inactive')
	assert.equal(classProviderActive({ activeExtensions: ['antfu.unocss'] }, [tailwind]), false, 'another extension is active')
	assert.equal(classProviderActive({ activeExtensions: ['bradlc.vscode-tailwindcss'] }, []), false, 'nothing declared: Meeko offers every class')
	// Its explicit list wins over the legacy signal it still sends for servers before 1.12.
	assert.equal(classProviderActive({ activeExtensions: [], tailwindActive: true }, []), false, 'a new client without declarations never delegates')
	assert.equal(classProviderActive({ activeExtensions: [], tailwindActive: true }, [tailwind]), false)
	assert.equal(classProviderActive({ activeExtensions: ['antfu.unocss'] }, [tailwind, uno]), true, 'any declared provider')
	assert.equal(classProviderActive({ activeExtensions: ['x.y'] }, [{ name: 'No extension', vscode: [], languages: [] }]), false, 'a provider without extensions is never active')
})

test('a client before 1.12 sends only tailwindActive, which stands for the Tailwind CSS extension', () => {
	assert.equal(classProviderActive({ tailwindActive: true }, [tailwind]), true, 'a provider that names that extension')
	assert.equal(classProviderActive({ tailwindActive: false }, [tailwind]), false)
	assert.equal(classProviderActive({}, [tailwind]), false)
	assert.equal(classProviderActive({ tailwindActive: true }, [uno]), false, 'a project that declares other providers only gets those')
	// Compatibility: that client delegated in a project that used Tailwind; the server no longer looks for Tailwind
	// in the project, so it keeps the delegation the client asks for while the project declares nothing.
	assert.equal(classProviderActive({ tailwindActive: true }, []), true, 'nothing declared: the explicit signal of an old client is respected')
	assert.equal(classProviderActive({ tailwindActive: false }, []), false)
})

test('an active provider takes only generated classes, preserving authored duplicates', async () => {
	const { root, remove } = await createTempProject('lsp-class-providers-')
	try {
		await mkdir(join(root, 'app/styles'), { recursive: true })
		await mkdir(join(root, '.meeko/styles'), { recursive: true })
		await writeFile(join(root, 'app/styles/main.css'), '@import "./theme.css"; .card {}')
		await writeFile(join(root, 'app/styles/theme.css'), '@import "some-engine"; .flex {}')
		await writeFile(join(root, '.meeko/styles/main.css'), '.flex { display: flex } .p-4 { padding: 1rem }')
		const view = new ClassIndex(root).view(join(root, 'app/pages/index.meeko'), '<template><p /></template>', [])
		const filtered = configuredClassView(view, { completion: 'auto', activeExtensions: ['bradlc.vscode-tailwindcss'] }, [tailwind])
		assert.deepEqual([...filtered.global.keys()], ['card', 'flex'])
		assert.equal(filtered.global.get('flex')?.[0]?.origin, 'stylesheet')
		assert.ok(filtered.sources.every((source) => source.origin !== 'snapshot'))
		assert.ok(configuredClassView(view, { completion: 'auto', activeExtensions: [] }, [tailwind]).global.has('p-4'), 'declared and inactive')
		assert.ok(configuredClassView(view, { completion: 'auto', activeExtensions: ['bradlc.vscode-tailwindcss'] }, []).global.has('p-4'), 'nothing declared')
		assert.ok(configuredClassView(view, { completion: 'on', activeExtensions: ['bradlc.vscode-tailwindcss'] }, [tailwind]).global.has('p-4'))
		assert.equal(configuredClassView(view, { completion: 'off' }, [tailwind]).global.size, 0)
		// Without settings nor providers, as callers without a client, every class.
		assert.ok(configuredClassView(view).global.has('p-4'))
		// The server reads no package.json nor stylesheet import to guess a provider.
		await writeFile(join(root, 'package.json'), '{"dependencies":{"tailwindcss":"4"}}')
		await writeFile(join(root, 'app/styles/theme.css'), '@import "tailwindcss"; .flex {}')
		const fresh = new ClassIndex(root).view(join(root, 'app/pages/index.meeko'), '<template><p /></template>', [])
		assert.ok(configuredClassView(fresh, { completion: 'auto', activeExtensions: ['bradlc.vscode-tailwindcss'] }, []).global.has('p-4'))
	} finally {
		await remove()
	}
})

test('the editor reads the providers without running anything: a literal css.classProviders and the manifest', async () => {
	const { root, remove } = await createTempProject('lsp-class-providers-static-')
	try {
		assert.deepEqual(staticClassProviders(root), [])
		await writeFile(join(root, 'meeko.config.ts'), `import { defineMeekoConfig } from "@meekojs/meeko/framework"\nthrow new Error("never runs")\nexport default defineMeekoConfig({ css: { classProviders: [{ name: "UnoCSS", vscode: ["antfu.unocss"] }] } })\n`)
		assert.deepEqual(staticClassProviders(root), [{ name: 'UnoCSS', vscode: ['antfu.unocss'], languages: [] }])
		// What `meeko dev` and `meeko check` write from the modules.
		await writeClassProvidersManifest(root, [tailwind])
		assert.deepEqual(readClassProvidersManifestSync(root), [tailwind])
		assert.deepEqual(staticClassProviders(root), [tailwind, { name: 'UnoCSS', vscode: ['antfu.unocss'], languages: [] }])
		await writeClassProvidersManifest(root, [])
		assert.deepEqual(readClassProvidersManifestSync(root), [], 'no providers removes the manifest')
		// A configuration computed at run time is not known without running it; an invalid one declares nothing.
		await writeFile(join(root, 'meeko.config.ts'), `const providers = [{ name: "UnoCSS" }]\nexport default { css: { classProviders: providers } }\n`)
		assert.deepEqual(staticClassProviders(root), [])
		await writeFile(join(root, 'meeko.config.ts'), `export default { css: { classProviders: [{ name: "", vscode: ["no id"] }] } }\n`)
		assert.deepEqual(staticClassProviders(root), [])
		// A manifest that Meeko did not write is ignored.
		await mkdir(join(root, '.meeko/manifests'), { recursive: true })
		for (const text of ['{', '{"version":2,"providers":[]}', '{"version":1,"providers":[{"name":"x","run":"rm -rf /"}]}', `{"version":1,"providers":[{"name":"x","languages":["meeko"]}]}`]) {
			await writeFile(join(root, classProvidersManifestFile), text)
			assert.deepEqual(readClassProvidersManifestSync(root), [], text)
		}
	} finally {
		await remove()
	}
})

test('a trusted project knows the providers of its modules without meeko dev; an untrusted one, from the manifest', async () => {
	const { root, remove } = await createTempProject('lsp-class-providers-modules-')
	const projects: MeekoProject[] = []
	try {
		await mkdir(join(root, 'modules/engine'), { recursive: true })
		await mkdir(join(root, 'app/pages'), { recursive: true })
		await writeFile(join(root, 'app/pages/index.meeko'), '<template><p /></template>')
		await writeFile(join(root, 'modules/engine/index.mjs'), `export default { [Symbol.for("meeko.module")]: true, meta: { name: "engine" }, setup(_options, meeko) { meeko.addClassProvider(${JSON.stringify(tailwind)}) } };\n`)
		await writeFile(join(root, 'meeko.config.mjs'), `export default { modules: ["./modules/engine"], css: { classProviders: [${JSON.stringify(uno)}] } };\n`)
		const trusted = new MeekoProject(root, { trusted: true })
		projects.push(trusted)
		await trusted.ready()
		assert.deepEqual(trusted.classProviders(), [tailwind, uno])
		// Untrusted, the modules never run: the literal of the configuration, plus the manifest once written.
		const untrusted = new MeekoProject(root, { trusted: false })
		projects.push(untrusted)
		await untrusted.ready()
		assert.deepEqual(untrusted.classProviders(), [uno])
		await writeClassProvidersManifest(root, [tailwind, uno])
		assert.deepEqual(untrusted.classProviders(), [tailwind, uno])
	} finally {
		for (const project of projects) project.dispose()
		await remove()
	}
})

test('providers with the same name are one, with the ids of both', () => {
	assert.deepEqual(mergeClassProviders([tailwind], [{ name: 'Tailwind CSS', vscode: ['bradlc.vscode-tailwindcss', 'other.tailwind'], languages: [] }, uno]), [
		{ name: 'Tailwind CSS', vscode: ['bradlc.vscode-tailwindcss', 'other.tailwind'], languages: ['tailwindcss'] },
		uno,
	])
})

test('unused scoped classes exclude @utility classes and their nested selectors', () => {
	const source = '<template><p /></template><style scoped>@utility foo { color: red; &.nested { color: blue } } .unused { color: red }</style>'
	const diagnostics = styleDiagnostics(TextDocument.create('file:///index.meeko', 'meeko', 1, source))
	const unused = diagnostics.filter((item) => item.code === 'MEEK_UNUSED_CLASS')
	assert.equal(unused.length, 1)
	// LSP 3.18 types a diagnostic message as a string or as MarkupContent.
	const message = unused[0]!.message
	assert.match(typeof message === 'string' ? message : message.value, /\.unused/)
})
