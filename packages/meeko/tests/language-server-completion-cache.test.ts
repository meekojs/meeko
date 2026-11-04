import assert from 'node:assert/strict'
import test from 'node:test'

import { completionList } from '../src/language-server/features'
import { languageProject } from './language-server-workspace'

test('completion filters many Meeko exports with one TypeScript program snapshot', async () => {
	const source = '<script lang="ts">\nconst count = signal(0);\nconst value = ;\n</script>\n<template><p>{count.value}{value}</p></template>'
	const workspace = await languageProject('completion-program-snapshot-', { 'app/pages/index.meeko': source })
	try {
		const opened = await workspace.open('app/pages/index.meeko')
		const service = workspace.project.service
		const getProgram = service.getProgram.bind(service)
		let reads = 0
		service.getProgram = () => {
			reads++
			return getProgram()
		}
		const entries = completionList(opened, opened.at('const value = ', 'const value = '.length))?.items ?? []
		assert.ok(entries.some(({ label }) => label === 'signal'))
		assert.ok(entries.length > 100, 'exercise filtering a complete list of suggestions')
		assert.ok(reads <= 3, `getProgram was synchronized ${reads} times for ${entries.length} items`)
	} finally {
		await workspace.dispose()
	}
})
