import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { mkdir, mkdtemp, readFile, realpath, rm, writeFile } from 'node:fs/promises'
import { createRequire } from 'node:module'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import test from 'node:test'
import { pathToFileURL } from 'node:url'

const repository = resolve('.')
// tsx by absolute URL: the child runs from a folder where it cannot be resolved by name.
const tsx = pathToFileURL(createRequire(import.meta.url).resolve('tsx')).href

/** Runs the CLI from source, from `cwd`, so the suite does not depend on a built dist/. */
function cli(cwd: string, ...args: string[]) {
	return spawnSync(process.execPath, ['--import', tsx, join(repository, 'src', 'cli.ts'), ...args], { cwd, encoding: 'utf8' })
}

/** A project whose config records the cwd it was loaded with, next to an unrelated folder to launch from. */
async function withProject(run: (root: string, elsewhere: string) => Promise<void>): Promise<void> {
	const sandbox = await realpath(await mkdtemp(join(tmpdir(), 'meeko-cwd-')))
	try {
		const root = join(sandbox, 'app')
		const elsewhere = join(sandbox, 'elsewhere')
		await mkdir(join(root, 'app', 'pages'), { recursive: true })
		await mkdir(elsewhere)
		await writeFile(join(root, 'package.json'), JSON.stringify({ name: 'app', private: true, type: 'module' }))
		await writeFile(join(root, 'app', 'pages', 'index.meeko'), '<template><h1>Home</h1></template>\n')
		await writeFile(join(root, 'meeko.config.ts'), "import { writeFileSync } from 'node:fs'\n\nwriteFileSync(new URL('./cwd.txt', import.meta.url), process.cwd())\n\nexport default {}\n")
		await run(root, elsewhere)
	} finally {
		await rm(sandbox, { recursive: true, force: true })
	}
}

test('meeko check works with the project root as cwd when launched from another folder', async () => {
	await withProject(async (root, elsewhere) => {
		// Absolute and relative (resolved against the original cwd) project paths.
		for (const path of [root, join('..', 'app')]) {
			await rm(join(root, 'cwd.txt'), { force: true })
			const result = cli(elsewhere, 'check', path)
			// The temporary project has no @meekojs/meeko installed, so TypeScript may complain after the config ran.
			assert.doesNotMatch(result.stderr, /No existe el directorio/)
			assert.equal(await realpath(await readFile(join(root, 'cwd.txt'), 'utf8')), root)
		}
	})
})

test('meeko routes works with the project root as cwd when launched from another folder', async () => {
	await withProject(async (root, elsewhere) => {
		const result = cli(elsewhere, 'routes', join('..', 'app'))
		assert.equal(result.status, 0, result.stderr)
		for (const line of result.stdout.split('\n').filter(Boolean)) assert.ok(line.startsWith(root), `${line} must be inside ${root}`)
	})
})

test('a missing project directory still fails without changing anything', async () => {
	await withProject(async (_root, elsewhere) => {
		const result = cli(elsewhere, 'check', 'missing')
		assert.equal(result.status, 1)
		assert.match(result.stderr, /No existe el directorio missing/)
	})
})
