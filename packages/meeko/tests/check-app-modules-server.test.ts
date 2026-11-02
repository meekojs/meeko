import assert from 'node:assert/strict'
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import test from 'node:test'

import { checkFrameworkProject } from '../src/framework/check-project.ts'
import { linkRepositoryPackages, tempProject } from './helpers/temp-project.ts'

async function put(root: string, path: string, source: string): Promise<void> {
	const file = join(root, path)
	await mkdir(dirname(file), { recursive: true })
	await writeFile(file, source)
}

const failure = (root: string): Promise<string> =>
	checkFrameworkProject(root).then(
		() => '',
		(error: Error) => error.message,
	)

test('a plain app/ module may use the autoimports for browser code, which stay forbidden in server code', { timeout: 240_000 }, async (context) => {
	const root = await tempProject(context, 'check-app-modules-server')
	await linkRepositoryPackages(root)
	await put(root, 'package.json', '{"private":true,"type":"module"}\n')
	await put(root, 'meeko.config.mjs', 'export default { layers: ["./layers/base"] };\n')
	await put(root, 'app/components/Box.meeko', '<template><p>box</p></template>\n')
	await put(root, 'app/pages/index.meeko', '<template><main><Box /></main></template>\n')
	// Their exports are declared in server.d.ts, so the server program loads these modules too.
	await put(root, 'app/utils/lazy.ts', 'export function loadBox() { return resolveComponent("Box"); }\n')
	await put(
		root,
		'app/composables/useTitle.ts',
		[
			'export function useTitle() { useHead({ title: "x" }); useSeoMeta({ title: "x" }); return useTheme(); }',
			'export function useContact() { return useForm({ initial: { name: "" }, submit: async () => null }); }',
			'export const isExpected = (error: unknown) => isClientError(error) || error instanceof ClientError;',
			'export type Contact = Form<{ name: string }, null>;',
			'',
		].join('\n'),
	)
	await put(root, 'layers/base/app/pages/layer.meeko', '<template><main>layer</main></template>\n')
	await put(root, 'layers/base/app/utils/layered.ts', 'export function loadLayered() { return resolveComponent("Box"); }\n')
	assert.deepEqual(await checkFrameworkProject(root), [])

	// The names have not moved to the server: its declarations still leave them out…
	const server = await readFile(join(root, '.meeko', 'types', 'autoimports', 'server.d.ts'), 'utf8')
	assert.doesNotMatch(server, /\bconst (?:resolveComponent|useHead|useForm)\b/)
	assert.match(server, /\bconst loadBox\b/, 'the export of the module still reaches the server')

	// …and server code using them keeps failing, with or without an app/ module failing next to it.
	for (const [path, source] of [
		['server/utils/report.ts', 'export function report() { useHead({ title: "x" }); }\n'],
		['app/utils/secret.server.ts', 'export function secret() { return resolveComponent("Box"); }\n'],
		['app/pages/about.route.ts', 'export const route = definePage({ load: () => useForm({ initial: {}, submit: async () => null }) });\n'],
	] as const) {
		await put(root, path, source)
		const message = await failure(root)
		assert.match(message, /tsconfig\.server\.json/, path)
		assert.match(message, /TS2304/, path)
		assert.ok(message.includes(path.split('/').at(-1)!), `${path}: ${message}`)
		assert.doesNotMatch(message, /lazy\.ts|useTitle\.ts|layered\.ts/, 'only what fails is reported')
		await rm(join(root, path))
	}

	// A real error of the module is still reported, by the project it belongs to.
	await put(root, 'app/utils/broken.ts', 'export const broken: number = "x";\n')
	assert.match(await failure(root), /broken\.ts.*TS2322/s)
})
