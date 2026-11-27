import assert from 'node:assert/strict'
import test from 'node:test'

import type { ExecutionZoneItem, ExecutionZoneKind, ZoneDocumentLines } from '../src/zone-ranges'

import { executionZoneKinds, LatestRequests, zoneDecorationRanges, zoneHover } from '../src/zone-ranges'

const source = ['<script server lang="ts">', 'export const route = 1', '</script>', '<script lang="ts">', 'const count = 0', 'onMounted(() => {})', '</script>', '<template><p>{count}</p></template>']

const lines = (text: readonly string[]): ZoneDocumentLines => ({ lineCount: text.length, lineLength: (line) => text[line]!.length })

const zone = (kind: ExecutionZoneKind, start: number, end: number, label: string = kind): ExecutionZoneItem => ({
	kind,
	reason: 'test',
	label,
	detail: `detalle de ${label}`,
	range: { start: { line: start, character: 0 }, end: { line: end, character: 0 } },
})

test('zones are decorated in a fixed order of kinds', () => {
	assert.deepEqual(executionZoneKinds, ['server', 'shared', 'browser'])
})

test('a zone of several lines has the hover on its first line and one range for the rest', () => {
	const ranges = zoneDecorationRanges([zone('server', 0, 2, 'Sólo servidor')], 'server', lines(source))
	assert.deepEqual(ranges, [
		{ startLine: 0, startCharacter: 0, endLine: 0, endCharacter: source[0]!.length, hover: '**Sólo servidor** · detalle de Sólo servidor' },
		{ startLine: 1, startCharacter: 0, endLine: 2, endCharacter: source[2]!.length },
	])
	assert.ok(!('hover' in ranges[1]!), 'Only the first line explains the zone')
})

test('a zone of one line is a single range with its hover', () => {
	assert.deepEqual(zoneDecorationRanges([zone('browser', 5, 5)], 'browser', lines(source)), [{ startLine: 5, startCharacter: 0, endLine: 5, endCharacter: source[5]!.length, hover: zoneHover(zone('browser', 5, 5)) }])
})

test('only the zones of the requested kind produce ranges, in the order of the response', () => {
	const zones = [zone('server', 0, 2), zone('shared', 3, 4), zone('browser', 5, 5), zone('shared', 6, 6)]
	assert.deepEqual(
		zoneDecorationRanges(zones, 'shared', lines(source)).map((range) => [range.startLine, range.endLine, range.hover !== undefined]),
		[
			[3, 3, true],
			[4, 4, false],
			[6, 6, true],
		],
	)
	assert.equal(zoneDecorationRanges(zones, 'browser', lines(source)).length, 1)
	assert.deepEqual(zoneDecorationRanges([], 'server', lines(source)), [])
})

test('a zone that ends after the document is clipped to its last line', () => {
	const short = source.slice(0, 5)
	assert.deepEqual(zoneDecorationRanges([zone('shared', 3, 6)], 'shared', lines(short)), [
		{ startLine: 3, startCharacter: 0, endLine: 3, endCharacter: short[3]!.length, hover: zoneHover(zone('shared', 3, 6)) },
		{ startLine: 4, startCharacter: 0, endLine: 4, endCharacter: short[4]!.length },
	])
})

test('a zone that starts after the document collapses onto its last line', () => {
	const short = source.slice(0, 2)
	// The response describes an older text: the document lost lines before the zones were applied.
	assert.deepEqual(zoneDecorationRanges([zone('browser', 5, 7)], 'browser', lines(short)), [{ startLine: 1, startCharacter: 0, endLine: 1, endCharacter: short[1]!.length, hover: zoneHover(zone('browser', 5, 7)) }])
	assert.deepEqual(zoneDecorationRanges([zone('browser', 5, 7)], 'browser', lines([''])), [{ startLine: 0, startCharacter: 0, endLine: 0, endCharacter: 0, hover: zoneHover(zone('browser', 5, 7)) }])
})

test('the hover joins the label and the detail of the zone', () => {
	assert.equal(zoneHover({ label: 'Sólo navegador', detail: 'Se ejecuta al montar.' }), '**Sólo navegador** · Se ejecuta al montar.')
})

test('the most recent request of a key wins', () => {
	const requests = new LatestRequests()
	const first = requests.begin('a')
	assert.ok(requests.isCurrent('a', first))
	const second = requests.begin('a')
	assert.ok(!requests.isCurrent('a', first), 'An older request is discarded')
	assert.ok(requests.isCurrent('a', second))
})

test('requests of different keys do not discard each other', () => {
	const requests = new LatestRequests()
	const a = requests.begin('a')
	const b = requests.begin('b')
	assert.ok(requests.isCurrent('a', a))
	assert.ok(requests.isCurrent('b', b))
	assert.ok(!requests.isCurrent('b', a))
	assert.equal(requests.size, 2)
})

test('forgetting a key frees it and discards its request in flight, also after the key is used again', () => {
	const requests = new LatestRequests()
	const beforeClose = requests.begin('a')
	const other = requests.begin('b')
	requests.forget('a')
	assert.equal(requests.size, 1, 'A closed document keeps no entry')
	assert.ok(!requests.isCurrent('a', beforeClose), 'The request of a closed document is discarded')
	assert.ok(requests.isCurrent('b', other))
	// Reopened: the first request of the new life must not be confused with the one before closing.
	const reopened = requests.begin('a')
	assert.notEqual(reopened, beforeClose)
	assert.ok(!requests.isCurrent('a', beforeClose))
	assert.ok(requests.isCurrent('a', reopened))
	requests.clear()
	assert.equal(requests.size, 0)
	assert.ok(!requests.isCurrent('a', reopened))
})
