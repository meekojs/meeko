import type { Browser, BrowserContext, BrowserContextOptions } from 'playwright-core'

import { mkdir, mkdtemp } from 'node:fs/promises'
import { join } from 'node:path'

/** Owns the isolated contexts of one test and saves diagnostics before closing them. */
export async function withBrowserSession<T>(label: string, getBrowser: () => Promise<Browser>, run: (browser: BrowserSession) => Promise<T>): Promise<T> {
	const contexts = new Set<BrowserContext>()
	const artifactRoot = process.env.MEEKO_E2E_ARTIFACTS
	const newContext = async (options?: BrowserContextOptions): Promise<BrowserContext> => {
		const context = await (await getBrowser()).newContext(options)
		contexts.add(context)
		context.once('close', () => contexts.delete(context))
		if (artifactRoot) await context.tracing.start({ screenshots: true, snapshots: true })
		return context
	}
	try {
		return await run({ newContext, newPage: async (options) => (await newContext(options)).newPage() })
	} catch (error) {
		if (artifactRoot && contexts.size > 0) {
			try {
				await mkdir(artifactRoot, { recursive: true })
				const prefix = label.replace(/[^a-zA-Z0-9-]+/g, '-').slice(0, 70)
				const output = await mkdtemp(join(artifactRoot, `${prefix}-`))
				for (const [index, context] of [...contexts].entries()) {
					const captures = context.pages().map((page, pageIndex) => page.screenshot({ path: join(output, `context-${index}-page-${pageIndex}.png`), timeout: 2_000 }))
					await Promise.allSettled(captures)
					await context.tracing.stop({ path: join(output, `context-${index}.zip`) }).catch((failure: unknown) => console.warn('Could not save browser trace:', failure))
				}
				console.error(`Browser diagnostics: ${output}`)
			} catch (failure) {
				console.warn('Could not save browser diagnostics:', failure)
			}
		}
		throw error
	} finally {
		await Promise.all([...contexts].map((context) => context.close()))
	}
}

export type BrowserSession = Pick<Browser, 'newContext' | 'newPage'>
