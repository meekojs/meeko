import type { MeekoAdapterName } from '../modules/define-meeko-config'

import { bunEntrySource, denoEntrySource } from './adapter-templates'

export const clientOutput = '.meeko/output/client'
export const nodeOutput = '.meeko/output/node'
/** Node server used only to prerender pages for adapters other than Node. */
export const prerenderServer = '.meeko/build/node'
/** The prerendered pages, before they are copied into the adapter's output. */
export const prerenderStaging = '.meeko/build/prerender'
/**
 * Client entry of the static adapter. It lives outside `.meeko/generated`, which `meeko dev` and
 * `meeko check` share: a static build must not change what a running dev server bundles, and a
 * concurrent `prepareProject` must not take the static entry away from the build.
 */
export const staticClientEntry = '.meeko/build/entry-client-static.ts'
const adapters: readonly MeekoAdapterName[] = ['node', 'cloudflare', 'deno', 'bun', 'static']

/** Self-contained bundles for runtimes that do not read node_modules. */
export const bundledAdapters = {
	bun: { entry: '.meeko/generated/entry-bun.ts', source: bunEntrySource, file: 'index.js' },
	deno: { entry: '.meeko/generated/entry-deno.ts', source: denoEntrySource, file: 'main.js' },
} as const

/** Directory written by `meeko build` for an adapter. */
export function adapterOutput(adapter: MeekoAdapterName): string {
	return `.meeko/output/${adapter}`
}

/** Single-file Worker bundle and its generated Wrangler configuration. */
export const cloudflareAdapter = { entry: '.meeko/generated/entry-cloudflare.ts', file: 'worker.js', config: 'wrangler.jsonc' } as const

/** Entry file of an adapter's build output, relative to the project. */
export function adapterEntry(adapter: MeekoAdapterName): string {
	const file = adapter === 'node' ? 'index.mjs' : adapter === 'cloudflare' ? cloudflareAdapter.file : adapter === 'static' ? 'index.html' : bundledAdapters[adapter].file
	return `${adapterOutput(adapter)}/${file}`
}

/** Validates an adapter name. */
export function assertBuildAdapter(adapter: string): MeekoAdapterName {
	if (!adapters.includes(adapter as MeekoAdapterName)) throw new Error(`Adaptador desconocido: ${adapter}; usa node, cloudflare, deno, bun o static`)
	return adapter as MeekoAdapterName
}
