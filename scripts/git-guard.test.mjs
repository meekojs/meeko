import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { after, describe, test } from 'node:test'
import { fileURLToPath } from 'node:url'

const hooks = fileURLToPath(new URL('../.claude/hooks/', import.meta.url))
const root = mkdtempSync(join(tmpdir(), 'meeko-git-guard-'))
for (const directory of ['.git', 'node_modules/pkg', 'packages/app/node_modules', 'packages/app/src']) mkdirSync(join(root, directory), { recursive: true })
after(() => rmSync(root, { force: true, recursive: true }))

/**
 * Ejecuta un hook como lo hace Claude Code: JSON de PreToolUse por stdin y decisión por stdout.
 * @returns {string | null} motivo del bloqueo o `null` si la orden se permite
 */
function runHook(script, command, { cwd = root, env = {}, tool = 'PowerShell' } = {}) {
	const input = { cwd, hook_event_name: 'PreToolUse', tool_input: { command }, tool_name: tool }
	const result = spawnSync(process.execPath, [join(hooks, script)], {
		encoding: 'utf8',
		env: { ...process.env, ...env },
		input: JSON.stringify(input),
		timeout: 20_000,
	})
	assert.equal(result.status, 0, result.stderr)
	if (!result.stdout.trim()) return null
	const output = JSON.parse(result.stdout).hookSpecificOutput
	assert.equal(output.hookEventName, 'PreToolUse')
	assert.equal(output.permissionDecision, 'deny')
	return output.permissionDecisionReason
}

describe('git-guard', () => {
	const blockedScans = [
		['git status --ignored', {}],
		['git status --ignored --porcelain', { tool: 'Bash' }],
		['git status --ignored', { cwd: join(root, 'packages/app/src') }],
		['git -C packages/app status --ignored=matching', {}],
		['git --no-optional-locks status --ignored', {}],
		['GIT_PAGER=cat git -c core.quotepath=off status --ignored', { tool: 'Bash' }],
		['git status --ignored -- node_modules', {}],
		['git status --ignored :/', { cwd: join(root, 'packages/app/src') }],
		['git status --ignored .', {}],
		['git clean -fdx', {}],
		['git clean -n -X', {}],
		['git clean -ndX packages/app', {}],
		['git clean -fdx', { cwd: join(root, 'packages/app') }],
		['git ls-files --others -i --exclude-standard', {}],
		['git ls-files -o -x "*.log" node_modules/pkg', {}],
		[`git -C "${root}" clean -fdX`, {}],
		[`& 'C:\\Program Files\\Git\\cmd\\git.exe' status --ignored`, {}],
		['pwsh -NoProfile -Command "git status --ignored"', {}],
		[`bash -c 'cd packages/app && git clean -fdx'`, { tool: 'Bash' }],
		['Set-Location packages/app; git clean -xfd', {}],
		['git diff --stat; git status --ignored | Select-Object -First 5', {}],
	]
	for (const [command, options] of blockedScans) {
		test(`blocks: ${command}`, () => {
			assert.match(runHook('git-guard.mjs', command, options) ?? '', /--no-optional-locks status --porcelain/)
		})
	}

	const allowed = [
		['git status', {}],
		['git --no-optional-locks status --porcelain', {}],
		['git status --ignored=no', {}],
		['git status --ignored -- packages/app/src', {}],
		['git status -uno -sb', {}],
		['git clean -fd', {}],
		['git clean -fdx', { cwd: join(root, 'packages/app/src') }],
		['git -C packages/app/src clean -fdX', {}],
		['git ls-files -s', {}],
		['git check-ignore -v node_modules', {}],
		['git commit -m "docs: no uses git status --ignored ni borres .git/index.lock"', {}],
		['echo "git clean -fdx"', { tool: 'Bash' }],
		['Test-Path .git/index.lock', {}],
		['Get-Item .git\\index.lock', {}],
		['rm -f yarn.lock pnpm-lock.yaml', { tool: 'Bash' }],
		['Remove-Item -Recurse dist', {}],
	]
	for (const [command, options] of allowed) {
		test(`allows: ${command}`, () => {
			assert.equal(runHook('git-guard.mjs', command, options), null)
		})
	}

	const blockedLocks = [
		['rm .git/index.lock', { tool: 'Bash' }],
		['rm -f "./.git/index.lock"', { tool: 'Bash' }],
		['Remove-Item -Force .git\\index.lock', {}],
		['del .git\\refs\\heads\\main.lock', {}],
		['Get-ChildItem .git -Filter *.lock -Recurse | Remove-Item', {}],
		['cd .git; rm -f *.lock', { tool: 'Bash' }],
		['mv .git/index.lock /tmp/index.lock.bak', { tool: 'Bash' }],
		[`node -e "require('fs').unlinkSync('.git/index.lock')"`, {}],
		['[System.IO.File]::Delete("D:\\Clients\\meeko\\.git\\index.lock")', {}],
		['Remove-Item .git/worktrees/demo/index.lock', {}],
	]
	for (const [command, options] of blockedLocks) {
		test(`blocks lock removal: ${command}`, () => {
			assert.match(runHook('git-guard.mjs', command, options) ?? '', /coordinador/)
		})
	}

	test('ignores invalid input', () => {
		const result = spawnSync(process.execPath, [join(hooks, 'git-guard.mjs')], { encoding: 'utf8', input: 'not json' })
		assert.equal(result.status, 0)
		assert.equal(result.stdout, '')
	})
})

describe('memory-guard', () => {
	const gb = 1024 ** 2
	const low = JSON.stringify({
		freeKb: 4 * gb,
		processes: [
			{ commandLine: 'node.exe node_modules/vite/bin/vite.js dev', name: 'node', pid: 4242, privateBytes: 97 * 1024 ** 3 },
			{ name: 'Code', pid: 7, privateBytes: 2 * 1024 ** 3 },
		],
		totalKb: 128 * gb,
	})
	const high = JSON.stringify({ freeKb: 64 * gb, totalKb: 128 * gb })

	for (const command of ['node scripts/build.mjs', 'pnpm test', 'npx prettier --check .', 'tsx tests/a.test.ts', '$env:CI=1; pnpm -F @meekojs/meeko test', 'pwsh -Command "pnpm run build"', 'C:\\tools\\node.exe -v']) {
		test(`blocks Node launchers when committed memory is low: ${command}`, () => {
			const reason = runHook('memory-guard.mjs', command, { env: { MEEKO_MEMORY_GUARD_SAMPLE: low } })
			assert.match(reason ?? '', /3\.1 %/)
			assert.match(reason, /node \(PID 4242\): 97\.0 GB — node\.exe node_modules\/vite\/bin\/vite\.js dev/)
			assert.match(reason, /Code \(PID 7\): 2\.0 GB/)
		})
	}

	test('allows commands that do not launch Node even when memory is low', () => {
		for (const command of ['git status', 'Get-Process | Sort-Object PrivateMemorySize64', 'Stop-Process -Id 4242', 'echo "pnpm test"']) {
			assert.equal(runHook('memory-guard.mjs', command, { env: { MEEKO_MEMORY_GUARD_SAMPLE: low } }), null, command)
		}
	})

	test('allows Node launchers when there is enough committed memory', () => {
		assert.equal(runHook('memory-guard.mjs', 'pnpm test', { env: { MEEKO_MEMORY_GUARD_SAMPLE: high } }), null)
	})

	test('honours a custom threshold and can be disabled', () => {
		const env = { MEEKO_MEMORY_GUARD_SAMPLE: high }
		assert.match(runHook('memory-guard.mjs', 'pnpm test', { env: { ...env, MEEKO_MEMORY_GUARD_MIN_FREE_PERCENT: '60' } }) ?? '', /umbral del 60 %/)
		assert.equal(runHook('memory-guard.mjs', 'pnpm test', { env: { MEEKO_MEMORY_GUARD_MIN_FREE_PERCENT: '0', MEEKO_MEMORY_GUARD_SAMPLE: low } }), null)
	})

	test('blocks when memory cannot even be measured', () => {
		const sample = JSON.stringify({ freeKb: 0, totalKb: 0, unavailable: true })
		assert.match(runHook('memory-guard.mjs', 'pnpm test', { env: { MEEKO_MEMORY_GUARD_SAMPLE: sample } }) ?? '', /no se pudo ni medir/)
	})

	test('reads the real committed memory quickly', { skip: process.platform !== 'win32' }, () => {
		const started = performance.now()
		assert.equal(runHook('memory-guard.mjs', 'pnpm test', { env: { MEEKO_MEMORY_GUARD_MIN_FREE_PERCENT: '0.0001' } }), null)
		assert.ok(performance.now() - started < 5000)
	})
})
