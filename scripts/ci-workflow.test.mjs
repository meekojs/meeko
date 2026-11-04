// The browser tests of UI and icon read the build of some applications. Nothing builds them for those tests but the
// step that runs them, and a failure there only shows up after the rest of a 45-minute job.
import assert from 'node:assert/strict'
import { readdirSync, readFileSync } from 'node:fs'
import test from 'node:test'

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
