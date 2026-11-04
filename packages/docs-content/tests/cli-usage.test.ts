import assert from 'node:assert/strict'
import { test } from 'node:test'

import { cliCommands, cliUsageText } from '../src/content/reference'

test('the usage text of the CLI is read in either kind of quotes', () => {
	assert.equal(cliUsageText('const usage = "Uso: meeko dev\\n     meeko build";'), 'Uso: meeko dev\n     meeko build')
	assert.equal(cliUsageText("const usage = 'Uso: meeko dev\\n     meeko build'"), 'Uso: meeko dev\n     meeko build')
})

test('the usage text may start on the line after the =', () => {
	assert.equal(cliUsageText("const usage =\n\t'Uso: meeko dev'"), 'Uso: meeko dev')
})

test('the quotes inside the usage text survive either kind of literal', () => {
	assert.equal(cliUsageText('const usage = "a \\"b\\" \'c\'"'), 'a "b" \'c\'')
	assert.equal(cliUsageText("const usage = 'a \"b\" \\'c\\''"), 'a "b" \'c\'')
})

test('a source without the usage text has none', () => {
	assert.equal(cliUsageText('const other = "meeko dev"'), null)
})

test('the commands come from the usage text of the package', () => {
	assert.equal(cliCommands().get('dev'), 'meeko dev [directorio]')
})
