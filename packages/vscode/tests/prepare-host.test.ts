import assert from 'node:assert/strict'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'
import { deflateRawSync } from 'node:zlib'

import { extractVsix, findVSCode, hostTarget, isWindowsCodeInWsl } from './prepare-host.mjs'

interface ZipItem {
	content: string
	mode?: number
	name: string
}

/** A ZIP as vsce writes it: deflated entries, Unix modes in the central directory and a directory entry. */
function zip(items: readonly ZipItem[]): Buffer {
	const locals: Buffer[] = []
	const directories: Buffer[] = []
	let offset = 0
	for (const item of items) {
		const name = Buffer.from(item.name)
		const raw = Buffer.from(item.content)
		const data = item.name.endsWith('/') ? Buffer.alloc(0) : deflateRawSync(raw)
		const local = Buffer.alloc(30)
		local.writeUInt32LE(0x04034b50, 0)
		local.writeUInt16LE(data.length === 0 ? 0 : 8, 8)
		local.writeUInt32LE(data.length, 18)
		local.writeUInt32LE(raw.length, 22)
		local.writeUInt16LE(name.length, 26)
		const directory = Buffer.alloc(46)
		directory.writeUInt32LE(0x02014b50, 0)
		directory.writeUInt16LE(data.length === 0 ? 0 : 8, 10)
		directory.writeUInt32LE(data.length, 20)
		directory.writeUInt32LE(raw.length, 24)
		directory.writeUInt16LE(name.length, 28)
		directory.writeUInt32LE(((0o100000 | (item.mode ?? 0)) << 16) >>> 0, 38)
		directory.writeUInt32LE(offset, 42)
		locals.push(local, name, data)
		directories.push(directory, name)
		offset += local.length + name.length + data.length
	}
	const central = Buffer.concat(directories)
	const end = Buffer.alloc(22)
	end.writeUInt32LE(0x06054b50, 0)
	end.writeUInt16LE(items.length, 8)
	end.writeUInt16LE(items.length, 10)
	end.writeUInt32LE(central.length, 12)
	end.writeUInt32LE(offset, 16)
	return Buffer.concat([...locals, central, end])
}

const temporary = (context: { after: (callback: () => void) => void }): string => {
	const directory = mkdtempSync(join(tmpdir(), 'meeko-prepare-host-test-'))
	context.after(() => rmSync(directory, { force: true, recursive: true }))
	return directory
}

test('extracts a VSIX with nested folders and keeps the executable bit', { skip: process.platform === 'win32' }, (context) => {
	const destination = join(temporary(context), 'vsix')
	extractVsix(
		zip([
			{ content: '', name: 'extension/' },
			{ content: '{"name":"meeko-language"}', mode: 0o644, name: 'extension/package.json' },
			{ content: 'binary', mode: 0o755, name: 'extension/node_modules/@typescript/typescript-linux-x64/lib/tsc' },
			{ content: 'no mode', name: '[Content_Types].xml' },
		]),
		destination,
	)
	assert.equal(readFileSync(join(destination, 'extension/package.json'), 'utf8'), '{"name":"meeko-language"}')
	assert.equal(statSync(join(destination, 'extension/node_modules/@typescript/typescript-linux-x64/lib/tsc')).mode & 0o777, 0o755)
	assert.equal(statSync(join(destination, 'extension/package.json')).mode & 0o777, 0o644)
	assert.equal(statSync(join(destination, '[Content_Types].xml')).mode & 0o777, 0o644)
})

test('refuses a VSIX entry that would be written outside the destination', (context) => {
	const base = temporary(context)
	assert.throws(() => extractVsix(zip([{ content: 'x', mode: 0o644, name: '../escaped.txt' }]), join(base, 'vsix')), /fuera de su carpeta/)
	assert.equal(existsSync(join(base, 'escaped.txt')), false)
})

test('chooses the host target from the platform and the architecture', () => {
	assert.equal(hostTarget('linux', 'x64'), 'linux-x64')
	assert.equal(hostTarget('darwin', 'arm64'), 'darwin-arm64')
	assert.equal(hostTarget('win32', 'x64'), 'win32-x64')
	assert.throws(() => hostTarget('freebsd', 'x64'), /Sistema operativo no admitido/)
	assert.throws(() => hostTarget('linux', 'ia32'), /Arquitectura no admitida/)
})

test('finds VS Code: explicit path, MEEKO_HOST_VSCODE and PATH', { skip: process.platform === 'win32' }, (context) => {
	const base = temporary(context)
	const native = join(base, 'native')
	mkdirSync(native)
	writeFileSync(join(native, 'code'), '')
	const explicit = join(base, 'explicit')
	writeFileSync(explicit, '')

	assert.equal(findVSCode(explicit, { MEEKO_HOST_VSCODE: join(native, 'code') }, 'linux'), explicit)
	assert.throws(() => findVSCode(join(base, 'missing'), {}, 'linux'), /No se encontró el ejecutable de VS Code indicado/)
	assert.equal(findVSCode(undefined, { MEEKO_HOST_VSCODE: join(native, 'code'), PATH: join(base, 'nothing') }, 'linux'), join(native, 'code'))
	assert.equal(findVSCode(undefined, { PATH: native }, 'linux'), join(native, 'code'))
	assert.equal(findVSCode(undefined, { PATH: join(base, 'nothing') }, 'linux'), undefined)
})

test('recognises the Windows code that WSL mounts under /mnt', () => {
	// It would open VS Code for Windows, not a Linux host.
	assert.equal(isWindowsCodeInWsl('/mnt/c/Users/Dev/AppData/Local/Programs/Microsoft VS Code/bin/code', { WSL_DISTRO_NAME: 'Ubuntu' }), true)
	assert.equal(isWindowsCodeInWsl('/mnt/c/Users/Dev/bin/code', {}), false)
	assert.equal(isWindowsCodeInWsl('/usr/bin/code', { WSL_DISTRO_NAME: 'Ubuntu' }), false)
})
