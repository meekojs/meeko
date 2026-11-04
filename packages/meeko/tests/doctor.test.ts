import assert from 'node:assert/strict'
import { execFile } from 'node:child_process'
import { mkdir, mkdtemp, readdir, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import { promisify } from 'node:util'

import { diagnoseProject, formatDoctorReport } from '../src/framework/doctor.ts'

test('doctor CLI accepts JSON on either side of the root and rejects repeated or unknown flags', async () => {
	const root = await mkdtemp(join(tmpdir(), 'meeko-doctor-cli-'))
	const run = (...args: string[]) => promisify(execFile)(process.execPath, ['--import', 'tsx', join(process.cwd(), 'src/cli.ts'), 'doctor', ...args], { windowsHide: true })
	try {
		await writeFile(join(root, 'package.json'), '{"type":"module"}')
		for (const args of [
			[root, '--json'],
			['--json', root],
		]) {
			const { stdout, stderr } = await run(...args)
			assert.equal(stderr, '')
			assert.equal(JSON.parse(stdout).root, root)
			assert.equal(JSON.parse(stdout).schemaVersion, 1)
		}
		await assert.rejects(run(root, '--json', '--json'), /aparece más de una vez/)
		await assert.rejects(run(root, '--fix'), /Opción desconocida/)
	} finally {
		await rm(root, { recursive: true, force: true })
	}
})

test('doctor reads metadata without executing config, reading env values or generating artifacts', async () => {
	const root = await mkdtemp(join(tmpdir(), 'meeko-doctor-'))
	try {
		await mkdir(join(root, 'app'))
		await writeFile(join(root, 'package.json'), '{"type":"module","packageManager":"pnpm@12.14.0"}')
		await writeFile(join(root, '.env'), 'SECRET=doctor-secret-must-not-appear\n')
		await writeFile(join(root, 'meeko.config.mjs'), 'import { writeFileSync } from "node:fs"; writeFileSync(new URL("./executed", import.meta.url), "bad"); export default { modules: ["@meekojs/ui"], layers: ["./base"] };')
		const before = await readdir(root)
		const report = await diagnoseProject(root)
		assert.equal(report.schemaVersion, 1)
		assert.equal(report.projectKind, 'application')
		assert.equal(report.config.mode, 'static')
		assert.deepEqual(report.config.modules, ['@meekojs/ui'])
		assert.deepEqual(report.config.layers, ['./base'])
		assert.equal(
			report.generated.some((file) => file.exists),
			false,
		)
		assert.equal(report.checks.find((check) => check.id === 'generated')?.status, 'warning')
		assert.doesNotMatch(JSON.stringify(report) + formatDoctorReport(report), /doctor-secret-must-not-appear/)
		assert.deepEqual(await readdir(root), before)
		assert.equal(await readFile(join(root, '.env'), 'utf8'), 'SECRET=doctor-secret-must-not-appear\n')
	} finally {
		await rm(root, { recursive: true, force: true })
	}
})

test("doctor resolves the project's package and language server without importing its entry", async () => {
	const root = await mkdtemp(join(tmpdir(), 'meeko-doctor-packages-'))
	try {
		const directory = join(root, 'node_modules', '@meekojs', 'meeko')
		await mkdir(join(directory, 'dist', 'language-server'), { recursive: true })
		await writeFile(join(root, 'package.json'), '{"type":"module"}')
		await writeFile(join(directory, 'package.json'), '{"name":"@meekojs/meeko","version":"1.7.1","type":"module","exports":"./dist/index.js","bin":{"meeko-language-server":"dist/language-server/main.js"}}')
		await writeFile(join(directory, 'dist', 'index.js'), 'throw new Error("doctor must not import this");')
		await writeFile(join(directory, 'dist', 'language-server', 'main.js'), 'throw new Error("doctor must not launch LSP");')
		const report = await diagnoseProject(root)
		assert.equal(report.packages.find((item) => item.name === '@meekojs/meeko')?.version, '1.7.1')
		assert.equal(report.languageServer.source, 'project')
		assert.equal(report.languageServer.file, join(directory, 'dist', 'language-server', 'main.js'))
		assert.match(formatDoctorReport(report), /@meekojs\/meeko: 1.7.1/)
	} finally {
		await rm(root, { recursive: true, force: true })
	}
})

test('doctor returns a warning instead of executing a dynamic config and rejects missing roots', async () => {
	const root = await mkdtemp(join(tmpdir(), 'meeko-doctor-dynamic-'))
	try {
		await writeFile(join(root, 'meeko.config.mjs'), 'export default { layers: loadLayers("sensitive-value") };')
		const report = await diagnoseProject(root)
		assert.equal(report.checks.find((check) => check.id === 'config')?.status, 'warning')
		assert.doesNotMatch(JSON.stringify(report), /sensitive-value/)
		await assert.rejects(diagnoseProject(join(root, 'missing')), /No existe el directorio/)
	} finally {
		await rm(root, { recursive: true, force: true })
	}
})
