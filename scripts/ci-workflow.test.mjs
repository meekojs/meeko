// The browser tests of UI and icon read the build of some applications. Nothing builds them for those tests but the
// step that runs them, and a failure there only shows up after the rest of a 45-minute job.
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'

const repository = new URL('../', import.meta.url)
const read = (path) => readFileSync(new URL(path, repository), 'utf8').replaceAll('\r\n', '\n')

/** The text of a step of the workflow, up to the next step. */
function stepOf(workflow, name) {
	const start = workflow.indexOf(`- name: ${name}\n`)
	assert.notEqual(start, -1, `the workflow has a step named ${name}`)
	const end = workflow.indexOf('\n      - ', start)
	return end === -1 ? workflow.slice(start) : workflow.slice(start, end)
}

test('the UI browser step builds every application whose output its tests read', () => {
	const step = stepOf(read('.github/workflows/ci.yml'), 'UI browser E2E')
	const tests = step.indexOf('node --test')
	assert.notEqual(tests, -1, 'the step runs the browser tests')
	const files = ['packages/ui/tests/', 'packages/icon/tests/'].flatMap((folder) =>
		readdirSync(new URL(folder, repository))
			.filter((file) => file.endsWith('.e2e.mjs'))
			.map((file) => folder + file),
	)
	const applications = new Set(files.flatMap((file) => [...read(file).matchAll(/apps\/([\w-]+)\/\.meeko\/output/g)].map((match) => match[1])))
	assert.ok(applications.has('i18n'), 'the UIMarkdownEditor test reads the output of apps/i18n')
	for (const application of applications) {
		const { name } = JSON.parse(read(`apps/${application}/package.json`))
		const build = step.indexOf(`pnpm -F ${name} run build`)
		assert.ok(build !== -1 && build < tests, `${name} must be built before the browser tests run`)
	}
})

test('the required CI test check waits for every parallel test job', () => {
	const workflow = read('.github/workflows/ci.yml')
	const gate = workflow.split('\n  test:\n')[1]?.split('\n  performance:\n')[0]
	assert.ok(gate, 'the workflow keeps the required test check')
	assert.match(gate, /needs: \[core-tests, checks, verify, ui-browser\]/)
	assert.match(gate, /if: always\(\)/)
	for (const result of ['core-tests', 'checks', 'verify', 'ui-browser']) {
		assert.ok(gate.includes(`needs.${result}.result`), `${result} must contribute to the test result`)
	}
})

test('workspace setup keeps frozen installs and reusable build/cache behind explicit inputs', () => {
	const action = read('.github/actions/setup-workspace/action.yml')
	assert.match(action, /pnpm\/action-setup@0977fd99725f1db4007ccb2928dbb4e90d06cc86/)
	const { packageManager } = JSON.parse(read('package.json'))
	assert.ok(action.includes(`version: ${packageManager.replace(/^pnpm@/, '')}`), 'CI pins the pnpm version declared by the workspace')
	assert.match(action, /actions\/setup-node@949feb2413d6458794dcd2491c4babbbce0c15c1/)
	assert.match(action, /node-version: '24'/)
	assert.match(action, /pnpm install --frozen-lockfile/)
	assert.match(action, /if: inputs\.build == 'true'\n {6}uses: \.\/\.github\/actions\/build-workspace/)
	assert.match(action, /if: inputs\.npm-cache == 'true'\n {6}uses: \.\/\.github\/actions\/cache-npm/)
	for (const name of ['ci', 'publish', 'publish-vscode', 'publish-devtools']) {
		assert.match(read(`.github/workflows/${name}.yml`), /uses: \.\/\.github\/actions\/setup-workspace/)
	}
})

test('npm OIDC publication cannot invoke workspace setup or build code', () => {
	const workflow = read('.github/workflows/publish.yml')
	const publish = workflow.split('\n  publish:\n')[1]?.split('\n  github-release:\n')[0]
	assert.ok(publish, 'the isolated npm publish job exists')
	assert.match(publish, /id-token: write/)
	assert.doesNotMatch(publish, /setup-workspace|pnpm|build-workspace/)
	assert.match(publish, /actions\/setup-node@v7/)
})

test('verify shards use prepared artifacts after the shared build', () => {
	for (const name of ['ci', 'publish']) {
		const workflow = read(`.github/workflows/${name}.yml`)
		const verify = workflow.split('\n  verify:\n')[1]?.split(/\n {2}[\w-]+:\n/)[0]
		assert.ok(verify, `${name} keeps the verify job`)
		assert.match(verify, /uses: \.\/\.github\/actions\/setup-workspace\n {8}with:\n {10}build: 'true'/)
		assert.match(verify, /pnpm run verify:prepared/)
		assert.doesNotMatch(verify, /pnpm run verify(?:\s|$)/m)
	}
})

test('core shards execute every file exactly once and reject invalid shard indices', () => {
	const parent = fileURLToPath(new URL('packages/meeko/.meeko/', repository))
	mkdirSync(parent, { recursive: true })
	const fixture = mkdtempSync(join(parent, 'sharding-'))
	const runner = fileURLToPath(new URL('packages/meeko/scripts/run-tests.mjs', repository))
	const environment = { ...process.env }
	delete environment.NODE_TEST_CONTEXT
	try {
		mkdirSync(join(fixture, 'tests'))
		for (let index = 0; index < 6; index++) {
			writeFileSync(join(fixture, 'tests', `${index}.test.ts`), `import { appendFileSync } from 'node:fs'; appendFileSync('executed.txt', '${index}\\n')`)
		}
		for (const shard of ['1/3', '2/3', '3/3']) {
			const result = spawnSync(process.execPath, [runner], { cwd: fixture, env: { ...environment, MEEKO_TEST_SHARD: shard }, timeout: 30_000, encoding: 'utf8' })
			assert.equal(result.status, 0, result.stderr)
		}
		assert.deepEqual(readFileSync(join(fixture, 'executed.txt'), 'utf8').trim().split('\n').sort(), ['0', '1', '2', '3', '4', '5'])
		for (const shard of ['0/3', '4/3', '1/0', 'bad']) {
			const result = spawnSync(process.execPath, [runner], { cwd: fixture, env: { ...environment, MEEKO_TEST_SHARD: shard }, timeout: 30_000, encoding: 'utf8' })
			assert.notEqual(result.status, 0)
			assert.match(result.stderr, /MEEKO_TEST_SHARD must/)
		}
	} finally {
		rmSync(fixture, { recursive: true, force: true })
	}
})
