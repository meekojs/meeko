import assert from 'node:assert/strict'
import { mkdir, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import test from 'node:test'

import type { ServerApp } from '../src/framework-server.ts'

import { discoverAppManifest } from '../src/framework/app-manifest.ts'
import { createServerApp } from '../src/server/runtime/app.ts'
import { linkRepositoryPackages, tempProject } from './helpers/temp-project.ts'

type Context = Parameters<typeof tempProject>[0]

/** The application of a project whose module adds `files`, each with its headers, and whose `server` is `server`. */
async function moduleApp(context: Context, files: Record<string, Record<string, string>>, server: string): Promise<ServerApp> {
	const root = await tempProject(context, 'public-file-headers')
	await linkRepositoryPackages(root)
	const sources: Record<string, string> = {
		'app/pages/index.meeko': '<template><p>x</p></template>\n',
		'modules/fonts/index.ts': `import { defineMeekoModule } from "@meekojs/meeko/framework";
export default defineMeekoModule({
  meta: { name: "fonts" },
  setup(_options, meeko) {
    for (const [path, headers] of Object.entries(${JSON.stringify(files)})) meeko.addPublicFile(path, "x", { headers });
  },
});
`,
		'meeko.config.ts': `export default { modules: ["./modules/fonts"], server: ${server} };\n`,
	}
	for (const [path, source] of Object.entries(sources)) {
		await mkdir(dirname(join(root, path)), { recursive: true })
		await writeFile(join(root, path), source)
	}
	const { manifest } = await discoverAppManifest(root, { entry: '/entry.js', css: [], preload: [] })
	const app = await createServerApp({ manifest, production: false, load: async () => ({}), assets: { get: async () => new Response('x') } })
	context.after(() => app.close())
	return app
}

/** The headers `app` answers `path` with, the raw request target of a browser. */
async function headersOf(app: ServerApp, path: string): Promise<Headers> {
	return (await app.fetch(new Request(`http://localhost${path}`))).headers
}

const module = { 'Access-Control-Allow-Origin': '*', 'X-Override': 'module' }

test('a pattern of server.headers for a public file replaces only the headers it sets', { timeout: 60_000 }, async (context) => {
	const app = await moduleApp(context, { 'font.woff2': module }, `{ adapter: "node", headers: { "/font.woff2": { "X-Override": "configured", "X-Added": "app" } } }`)
	const headers = await headersOf(app, '/font.woff2')
	assert.equal(headers.get('access-control-allow-origin'), '*')
	assert.equal(headers.get('x-override'), 'configured')
	assert.equal(headers.get('x-added'), 'app')
})

test('the name of a header replaces another in any case', { timeout: 60_000 }, async (context) => {
	const app = await moduleApp(context, { 'font.woff2': module }, `{ adapter: "node", headers: { "/font.woff2": { "x-override": "configured" } } }`)
	const headers = await headersOf(app, '/font.woff2')
	assert.equal(headers.get('access-control-allow-origin'), '*')
	assert.equal(headers.get('x-override'), 'configured')
})

test('the patterns of server.headers keep their written order over a public file', { timeout: 60_000 }, async (context) => {
	// The pattern for the file comes after the wildcard: it wins, also when a module adds that file.
	const after = await moduleApp(context, { 'font.woff2': module }, `{ adapter: "node", headers: { "/*": { "X-Override": "wildcard", "X-Other": "wildcard" }, "/font.woff2": { "X-Other": "file" } } }`)
	const headers = await headersOf(after, '/font.woff2')
	assert.equal(headers.get('x-other'), 'file', 'The later pattern wins')
	assert.equal(headers.get('x-override'), 'wildcard', 'Any pattern of the app wins over the module')
	assert.equal(headers.get('access-control-allow-origin'), '*')
})

test('a global header of server.headers does not replace the header of a public file', { timeout: 60_000 }, async (context) => {
	const app = await moduleApp(context, { 'font.woff2': module }, `{ adapter: "node", headers: { "X-Override": "global" } }`)
	assert.equal((await headersOf(app, '/font.woff2')).get('x-override'), 'module')
	assert.equal((await headersOf(app, '/other')).get('x-override'), 'global')
})

test('a public file whose name needs URL encoding has its headers', { timeout: 60_000 }, async (context) => {
	const cors = { 'Access-Control-Allow-Origin': '*' }
	const app = await moduleApp(
		context,
		{
			'font test.woff2': cors,
			'fuente-ñ.woff2': cors,
			'with#hash.woff2': cors,
			'100%.woff2': cors,
			'ask?.woff2': cors,
			'nested dir/a b.woff2': cors,
		},
		`{ adapter: "node" }`,
	)
	for (const path of ['/font%20test.woff2', '/fuente-%C3%B1.woff2', '/fuente-ñ.woff2', '/with%23hash.woff2', '/100%25.woff2', '/ask%3F.woff2', '/nested%20dir/a%20b.woff2']) {
		assert.equal((await headersOf(app, path)).get('access-control-allow-origin'), '*', path)
	}
	// Other files, and what the raw name would mean as a URL, get nothing.
	for (const path of ['/fontXtest.woff2', '/with', '/ask', '/100.woff2']) {
		assert.equal((await headersOf(app, path)).get('access-control-allow-origin'), null, path)
	}
})

test('no character of the name of a public file matches other paths', { timeout: 60_000 }, async (context) => {
	const cors = { 'Access-Control-Allow-Origin': '*' }
	const app = await moduleApp(context, { 'a*b.woff2': cors, 'c.d+(e)$[f]^{g}|h.woff2': cors }, `{ adapter: "node" }`)
	assert.equal((await headersOf(app, '/a*b.woff2')).get('access-control-allow-origin'), '*')
	assert.equal((await headersOf(app, '/c.d+(e)$[f]^{g}|h.woff2')).get('access-control-allow-origin'), '*')
	for (const path of ['/aXb.woff2', '/a/secret/b.woff2', '/cXd+(e)$[f]^{g}|h.woff2']) {
		assert.equal((await headersOf(app, path)).get('access-control-allow-origin'), null, path)
	}
})

test('the static adapter leaves out the headers of public files', { timeout: 60_000 }, async (context) => {
	const root = await tempProject(context, 'public-file-headers-static')
	await linkRepositoryPackages(root)
	await mkdir(join(root, 'modules', 'fonts'), { recursive: true })
	await mkdir(join(root, 'app', 'pages'), { recursive: true })
	await writeFile(join(root, 'app', 'pages', 'index.meeko'), '<template><p>x</p></template>\n')
	await writeFile(
		join(root, 'modules', 'fonts', 'index.ts'),
		`import { defineMeekoModule } from "@meekojs/meeko/framework";
export default defineMeekoModule({ meta: { name: "fonts" }, setup(_options, meeko) { meeko.addPublicFile("font.woff2", "x", { headers: { "X-Module": "1" } }); } });
`,
	)
	await writeFile(join(root, 'meeko.config.ts'), `export default { modules: ["./modules/fonts"], server: { adapter: "static" } };\n`)
	const { manifest } = await discoverAppManifest(root, { entry: '/entry.js', css: [], preload: [] })
	assert.equal(manifest.publicFileHeaders, undefined)
})
