import { createHash } from 'node:crypto'
import { readdir, readFile } from 'node:fs/promises'
import { extname, join, relative, resolve, sep } from 'node:path'

import type { AssetManifest, AssetRecord } from '../server/runtime/assets'
import type { BuildAppData } from './app-manifest'

import { assetKey } from './asset-key'
import { clientOutput } from './build-outputs'
import { contentTypes } from './content-types'

async function listFiles(directory: string): Promise<string[]> {
	const found: string[] = []
	for (const entry of await readdir(directory, { withFileTypes: true })) {
		const file = join(directory, entry.name)
		if (entry.isDirectory()) found.push(...(await listFiles(file)))
		else if (entry.isFile()) found.push(file)
	}
	return found
}

type ViteManifest = Record<string, { file?: string; css?: string[]; assets?: string[]; imports?: string[] }>

/**
 * Lists the public client build, which already contains Vite's copy of
 * `public/`. Only files emitted by Vite (listed in its manifest, so content
 * hashed) are immutable; copied `public/` files keep the same URL across edits.
 */
export async function assetManifest(directory: string, viteManifest: ViteManifest): Promise<AssetManifest> {
	const hashed = new Set<string>()
	for (const chunk of Object.values(viteManifest)) {
		for (const file of [chunk.file, ...(chunk.css ?? []), ...(chunk.assets ?? [])]) {
			if (file) hashed.add(assetKey(file.split('/')))
		}
	}
	const assets: Record<string, AssetRecord> = {}
	for (const file of (await listFiles(directory)).sort()) {
		const path = relative(directory, file).split(sep)
		if (path[0] === '.vite') continue
		const content = await readFile(file)
		const key = assetKey(path)
		assets[key] = {
			type: contentTypes[extname(file).toLowerCase()] ?? 'application/octet-stream',
			etag: `"${createHash('sha256').update(content).digest('base64url').slice(0, 27)}"`,
			size: content.byteLength,
			...(hashed.has(key) ? { immutable: true } : {}),
		}
	}
	return assets
}

export async function readViteManifest(root: string): Promise<ViteManifest> {
	return JSON.parse(await readFile(resolve(root, clientOutput, '.vite/manifest.json'), 'utf8')) as ViteManifest
}

export function clientAssets(manifest: ViteManifest, entryKey: string): BuildAppData['client'] {
	const entry = manifest[entryKey]
	if (!entry?.file) throw new Error(`Missing ${entryKey} in the Vite client manifest`)
	const css = new Set(entry.css ?? [])
	const preload = new Set<string>()
	const visit = (key: string): void => {
		const chunk = manifest[key]
		if (!chunk?.file || preload.has(chunk.file)) return
		preload.add(chunk.file)
		for (const file of chunk.css ?? []) css.add(file)
		for (const child of chunk.imports ?? []) visit(child)
	}
	for (const key of entry.imports ?? []) visit(key)
	const url = (file: string): string => assetKey(file.split('/'))
	return { entry: url(entry.file), css: [...css].map(url), preload: [...preload].map(url) }
}
