import assert from 'node:assert/strict'
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'

import { parseCodexAgent, renderClaudeAgent, syncAgents } from './sync-agents.mjs'

test('parses the TOML subset used by Codex agents', () => {
	const agent = parseCodexAgent('\n# comment\nname = "demo"\ndescription = "Uses \\"quotes\\" and \\u00e9"\n\ndeveloper_instructions = """\nLine one\nLine \\\n   two\n"""\n', 'demo.toml')
	assert.deepEqual(agent, {
		description: 'Uses "quotes" and é',
		developer_instructions: 'Line one\nLine two\n',
		name: 'demo',
	})
})

test('rejects unsupported or incomplete definitions', () => {
	assert.throws(() => parseCodexAgent('name = "a"\ndescription = "b"\n', 'a.toml'), /developer_instructions/)
	assert.throws(() => parseCodexAgent('name = 1\n', 'a.toml'), /cadena básica/)
	assert.throws(() => parseCodexAgent('[table]\n', 'a.toml'), /no admitida/)
})

test('renders a Claude subagent with escaped YAML frontmatter', () => {
	const output = renderClaudeAgent({ description: 'Say "hi": now', developer_instructions: '\nBody\n\n', name: 'demo' }, 'demo.toml')
	assert.equal(output, '---\n# Generado por scripts/sync-agents.mjs desde .codex/agents/demo.toml; no lo edites a mano.\nname: "demo"\ndescription: "Say \\"hi\\": now"\n---\n\nBody\n')
})

test('syncs, checks and prunes only generated agents', async () => {
	const root = await mkdtemp(join(tmpdir(), 'meeko-sync-agents-'))
	try {
		await mkdir(join(root, '.codex/agents'), { recursive: true })
		await mkdir(join(root, '.claude/agents'), { recursive: true })
		await writeFile(join(root, '.codex/agents/demo.toml'), 'name = "demo"\ndescription = "d"\ndeveloper_instructions = """\nBody\n"""\n')
		await writeFile(join(root, '.claude/agents/manual.md'), '---\nname: manual\n---\n')
		await writeFile(join(root, '.claude/agents/old.md'), '---\n# Generado por scripts/sync-agents.mjs desde .codex/agents/old.toml\n---\n')

		assert.deepEqual((await syncAgents({ check: true, root })).sort(), [join('.claude/agents', 'demo.md'), join('.claude/agents', 'old.md')])
		await syncAgents({ root })
		assert.deepEqual(await syncAgents({ check: true, root }), [])
		assert.match(await readFile(join(root, '.claude/agents/demo.md'), 'utf8'), /^---\n# Generado/)
		await assert.rejects(readFile(join(root, '.claude/agents/old.md')), { code: 'ENOENT' })
		assert.equal(await readFile(join(root, '.claude/agents/manual.md'), 'utf8'), '---\nname: manual\n---\n')
	} finally {
		await rm(root, { force: true, recursive: true })
	}
})

test('repository Claude agents match the Codex definitions', async () => {
	assert.deepEqual(await syncAgents({ check: true }), [])
})
