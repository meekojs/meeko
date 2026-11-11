import type { TestContext } from 'node:test'

import { mkdir, mkdtemp, rm, symlink, unlink, writeFile } from 'node:fs/promises'
import { dirname, isAbsolute, join, relative } from 'node:path'

interface FixtureOptions {
	files?: Record<string, string>
	links?: Record<string, string>
}

/** Crea un consumidor temporal y registra su limpieza en el contexto de prueba. */
export async function createFixture(context: Pick<TestContext, 'after'> | null, parent: string, prefix: string, { files = {}, links = {} }: FixtureOptions = {}) {
	if (!/^[A-Za-z0-9][A-Za-z0-9_-]*$/.test(prefix)) throw new Error(`Invalid fixture prefix: ${prefix}`)
	await mkdir(parent, { recursive: true })
	const root = await mkdtemp(join(parent, prefix))
	const linked: string[] = []
	let stop: () => Promise<void> = async () => {}
	const cleanup = async () => {
		try {
			await stop()
		} finally {
			for (const link of linked) await unlink(link).catch(() => undefined)
			await rm(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 })
		}
	}
	const inside = (name: string) => {
		const path = join(root, name)
		const suffix = relative(root, path)
		if (isAbsolute(name) || suffix === '..' || suffix.startsWith(`..${process.platform === 'win32' ? '\\' : '/'}`)) throw new Error(`Fixture path leaves its root: ${name}`)
		return path
	}
	const write = async (name: string, source: string) => {
		const path = inside(name)
		await mkdir(dirname(path), { recursive: true })
		await writeFile(path, source)
	}
	const link = async (name: string, source: string) => {
		const path = inside(join('node_modules', name))
		await mkdir(dirname(path), { recursive: true })
		await symlink(source, path, 'junction')
		linked.push(path)
	}
	try {
		for (const [name, source] of Object.entries(files)) await write(name, source)
		for (const [name, source] of Object.entries(links)) await link(name, source)
	} catch (error) {
		await cleanup()
		throw error
	}
	context?.after(cleanup)
	return { root, write, link, cleanup, setStop: (callback: () => Promise<void>) => (stop = callback) }
}
