import { AsyncLocalStorage } from 'node:async_hooks'
import { existsSync, readFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

import type { DocsLocale, PageLocale, TranslationStatus } from '../locale'
import type { SourceOverlay } from '../sources/overlay'

import { defaultLocale, translationStatus } from '../locale'
import { contentHash, emptyOverlay, normalizeText } from '../sources/overlay'
import { readTranslation, translationFile } from './i18n'

/** The public repository whose files the site renders and links to. */
export const repositoryUrl = 'https://github.com/meekojs/meeko'

/** Production origin of the site. */
export const siteOrigin = 'https://meekojs.com'

/** Folder of the package `@meekojs/meeko` in the repository. */
export const packageFolder = 'packages/meeko'

let root: string | undefined

/** Whether `directory` is the root of the Meeko repository: the workspace, its documents and the package. */
function isRepository(directory: string): boolean {
	const manifest = join(directory, ...packageFolder.split('/'), 'package.json')
	if (!existsSync(join(directory, 'pnpm-workspace.yaml')) || !existsSync(join(directory, 'docs', 'framework.md')) || !existsSync(manifest)) return false
	try {
		return (JSON.parse(readFileSync(manifest, 'utf8')) as { name?: unknown }).name === '@meekojs/meeko'
	} catch {
		return false
	}
}

/**
 * Root of the Meeko repository, found from the working directory or from this module: the site
 * lives in `apps/meeko/` and this package in `packages/docs-content/`, and in dev, check and build
 * their code runs from there or from `.meeko/`.
 */
export function repositoryRoot(): string {
	if (root) return root
	const starts = [process.cwd(), dirname(fileURLToPath(import.meta.url))]
	for (const start of starts) {
		for (let directory = resolve(start); ; directory = dirname(directory)) {
			if (isRepository(directory)) return (root = directory)
			if (dirname(directory) === directory) break
		}
	}
	throw new Error(`The Meeko repository was not found above ${starts.join(' or ')}; run the documentation tools from the repository`)
}

/**
 * Path from the repository root of a path the site uses. The site documents `@meekojs/meeko`, so a
 * path that exists in the package is the package's: `README.md`, `CHANGELOG.md`,
 * `package.json` and `examples/…` resolve under `packages/meeko/`. Any other path, such as
 * `docs/api.md` or `packages/vscode/README.md`, is already relative to the repository root.
 */
export function repositoryPath(path: string): string {
	const clean = path.replace(/^\/+/, '')
	if (clean === packageFolder || clean.startsWith(`${packageFolder}/`)) return clean
	return clean && existsSync(join(repositoryRoot(), ...packageFolder.split('/'), ...clean.split('/'))) ? `${packageFolder}/${clean}` : clean
}

/** The inverse of {@link repositoryPath}: a path of the package without its folder (`packages/meeko/README.md` → `README.md`). */
export function sitePath(path: string): string {
	const clean = path.replace(/^\/+/, '')
	return clean.startsWith(`${packageFolder}/`) ? clean.slice(packageFolder.length + 1) : clean
}

/**
 * Text of a file as Git has it in the working tree, without the published revisions: by its path
 * from the root (`docs/api.md`) or from the package (`README.md`).
 */
export function readGitFile(path: string): string {
	return normalizeText(readFileSync(join(repositoryRoot(), ...repositoryPath(path).split('/')), 'utf8'))
}

/** Whether a file exists in the working tree, by the same paths as {@link readGitFile}. */
export function gitFileExists(path: string): boolean {
	return existsSync(join(repositoryRoot(), ...repositoryPath(path).split('/')))
}

/** The translation a context read for an original, by {@link SourceContext.translation}. */
export interface ReadTranslation {
	/** The translation file from the repository root, such as `docs/en/api.md`. */
	readonly file: string
	/** The `source-hash` it declares, or `null`. */
	readonly sourceHash: string | null
	/** Against the original in Git now: `translated` or `outdated`. */
	readonly status: Exclude<TranslationStatus, 'missing'>
}

/**
 * What one render reads: the published revisions over the working tree, and the caches derived
 * from them, in one language. Each publication renders each language in its own context, so
 * neither its overlay nor its caches reach another render or a reader outside it, and a later
 * render reads the repository again.
 *
 * In English, a Markdown original (`docs/api.md`) is read from its translation (`docs/en/api.md`,
 * from the overlay or Git) without its `source-hash`, and from the Spanish original when there is
 * none: the page is then a fallback.
 */
export interface SourceContext {
	/** The published revisions this context reads instead of Git. */
	readonly overlay: SourceOverlay
	/** The language it renders. */
	readonly locale: DocsLocale
	/**
	 * Text of a file as {@link readRepositoryFile} returns it in this context: the translation of a
	 * Markdown original in a translated language. Each file is read once, so a render sees one
	 * version of the working tree even if it changes meanwhile.
	 */
	read(path: string): string
	/** Text of a file in the original language: the overlay or the working tree, never a translation. */
	readOriginal(path: string): string
	/** The translation that {@link read} uses for an original, or `null` when it reads the original. */
	translation(path: string): ReadTranslation | null
	/** The value of `key` in this context, created by `create` the first time. */
	memo<T>(key: string, create: () => T): T
}

type Translated = { readonly text: string; readonly translation: ReadTranslation } | null

/** A new context that reads `overlay` over the working tree in `locale`, with empty caches. */
export function createSourceContext(overlay: SourceOverlay = emptyOverlay, locale: DocsLocale = defaultLocale): SourceContext {
	const originals = new Map<string, string>()
	const translations = new Map<string, Translated>()
	const readOriginal = (path: string): string => {
		const file = repositoryPath(path)
		let text = originals.get(file)
		if (text === undefined) {
			text = overlay.get(file) ?? readGitFile(file)
			originals.set(file, text)
		}
		return text
	}
	const translated = (path: string): Translated => {
		const original = repositoryPath(path)
		if (translations.has(original)) return translations.get(original)!
		const file = original.endsWith('.md') ? translationFile(original, locale) : null
		let found: Translated = null
		if (file !== null && (overlay.has(file) || gitFileExists(file))) {
			const { text, sourceHash } = readTranslation(overlay.get(file) ?? readGitFile(file))
			const originalHash = gitFileExists(original) ? contentHash(readGitFile(original)) : null
			const status = translationStatus({ sourceHash }, originalHash) === 'translated' ? 'translated' : 'outdated'
			found = { text, translation: { file, sourceHash, status } }
		}
		translations.set(original, found)
		return found
	}
	return {
		overlay,
		locale,
		read: (path) => translated(path)?.text ?? readOriginal(path),
		readOriginal,
		translation: (path) => translated(path)?.translation ?? null,
		memo: memoizer(),
	}
}

/** A cache of values by key; a rejected promise is forgotten, so the next call tries again. */
function memoizer(): SourceContext['memo'] {
	const values = new Map<string, unknown>()
	return <T>(key: string, create: () => T): T => {
		if (values.has(key)) return values.get(key) as T
		const value = create()
		values.set(key, value)
		if (value instanceof Promise)
			value.catch(() => {
				if (values.get(key) === value) values.delete(key)
			})
		return value
	}
}

/**
 * The caches of callers outside any render, such as the reference tests or the health check:
 * derived from Git only, never from an overlay. Every render starts with {@link refreshSources},
 * and a long-lived process that reads outside renders calls it when the repository may have changed.
 */
let ambient = memoizer()

/**
 * Forgets what callers outside a render derived from the repository, so their next call reads the
 * working tree again. Renders never use these caches: each one has its own context.
 */
export function refreshSources(): void {
	ambient = memoizer()
}

const contexts = new AsyncLocalStorage<SourceContext>()

/** The context of the running render, or `undefined` outside one. */
export function currentSourceContext(): SourceContext | undefined {
	return contexts.getStore()
}

/**
 * Runs `task` in `context`: {@link readRepositoryFile} and every cache of the render use it until
 * `task` and the asynchronous work it starts finish. Other callers keep their own context.
 */
export function withSourceContext<T>(context: SourceContext, task: () => T): T {
	return contexts.run(context, task)
}

/**
 * Runs `task` in a new context that reads `overlay` over the working tree, in `locale` (Spanish by
 * default). Concurrent calls do not see each other's overlay or caches, and code outside `task`
 * never sees `overlay`.
 */
export function withSourceOverlay<T>(overlay: SourceOverlay, task: () => Promise<T>, locale: DocsLocale = defaultLocale): Promise<T> {
	return withSourceContext(createSourceContext(overlay, locale), task)
}

/** The overlay that {@link readRepositoryFile} applies now: the context's, or none outside a render. */
export function currentOverlay(): SourceOverlay {
	return contexts.getStore()?.overlay ?? emptyOverlay
}

/**
 * A value derived from the sources, cached in the current context. Outside a context it is cached
 * from Git alone until {@link refreshSources}; a render never sees those values, nor they its
 * overlay.
 */
export function sourceCache<T>(key: string, create: () => T): T {
	const context = contexts.getStore()
	return context ? context.memo(key, create) : ambient(key, create)
}

/**
 * Text of a file of the repository, by its path from the root (`docs/api.md`) or from the package
 * (`README.md`): the published revision of the current context when there is one, or the working tree.
 */
export function readRepositoryFile(path: string): string {
	return contexts.getStore()?.read(path) ?? readGitFile(path)
}

/**
 * Text of a file in the original language, by the same paths as {@link readRepositoryFile}: the
 * published revision of the current context or the working tree, never a translation.
 */
export function readOriginalFile(path: string): string {
	return contexts.getStore()?.readOriginal(path) ?? readGitFile(path)
}

/** The language of the current context: the one of its render, or Spanish outside one. */
export function currentLocale(): DocsLocale {
	return contexts.getStore()?.locale ?? defaultLocale
}

/**
 * The file that {@link readRepositoryFile} reads for `path` in the current context, from the
 * repository root: its translation when it reads one (`docs/en/api.md`), or the original.
 */
export function effectiveFile(path: string): string {
	return contexts.getStore()?.translation(path)?.file ?? repositoryPath(path)
}

/**
 * The language of a page rendered from `original` in the current context: in Spanish the original;
 * in a translated language, its translation's status, or `missing` and a fallback without one.
 * `original` `null` is a page whose content is never translated, such as a page generated from the
 * JSDoc: in a translated language it is a fallback too.
 */
export function pageLocale(original: string | null): PageLocale {
	const locale = currentLocale()
	if (locale === defaultLocale) return { locale, status: null, fallback: false }
	const found = original === null ? null : (contexts.getStore()?.translation(original) ?? null)
	return found ? { locale, status: found.status, fallback: false } : { locale, status: 'missing', fallback: true }
}

/**
 * GitHub URL of a file or folder of the repository, by the same paths as {@link readRepositoryFile}:
 * in a translated language, the translation that the context reads.
 */
export function githubUrl(path: string, kind: 'blob' | 'edit' | 'tree' = 'blob'): string {
	return `${repositoryUrl}/${kind}/main/${effectiveFile(path)}`
}
