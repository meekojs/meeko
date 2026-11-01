import GithubSlugger from 'github-slugger'

// The preview of one source with the text of a draft: the page as the site would render it, in a
// source context of its own whose overlay is that text alone. It runs the real render (markdown-it,
// Shiki and, for the reference, the TypeScript model of the package), so the dashboard calls it
// from a child process, never from its server.
import type { TocEntry } from './types/docs'

import { catalog } from './content/catalog'
import { documentHeadings, renderMarkdown, renderSource } from './content/markdown'
import { pageSections, parseFrontmatter, parseWrittenPage, referencePage } from './content/reference'
import { createSourceContext, readRepositoryFile, repositoryPath, withSourceContext } from './content/repository'
import { maxRevisionLength } from './db/revisions'
import { documentBrokenLinks, repositoryLinkTargets } from './health'
import { createOverlay, normalizeSourcePath, normalizeText } from './sources/overlay'

/** The Markdown sources that can be previewed: the guides and the written reference of the site. */
export type PreviewKind = 'guide' | 'reference'

/** Input of {@link renderSourcePreview}. */
export interface PreviewInput {
	/** Path of the source's file from the repository root, such as `docs/api.md`. */
	readonly file: string
	readonly kind: PreviewKind
	/** The draft's Markdown, rendered instead of the file. */
	readonly markdown: string
}

/**
 * Something the preview found:
 *
 * - `frontmatter`: the frontmatter of a reference page is incomplete or wrong, so publishing the
 *   revision is refused ({@link assertPublishable}).
 * - `render`: the page renders only partly, so publishing the documentation would fail, such as a
 *   symbol that the package does not export.
 * - `link`: an internal link or anchor that leads nowhere.
 */
export interface PreviewIssue {
	readonly kind: 'frontmatter' | 'link' | 'render'
	readonly message: string
	/** Its line in the draft, from 1, when it has one. */
	readonly line: number | null
}

/** What {@link renderSourcePreview} returns. */
export interface SourcePreview {
	readonly title: string
	readonly description: string
	/** HTML of the page's body, as the site writes it. */
	readonly html: string
	readonly toc: readonly TocEntry[]
	/**
	 * `true` when the site would render the page like this; `false` when an issue of kind
	 * `frontmatter` or `render` left only its prose, without the generated «Tipo» and «Relacionado».
	 */
	readonly complete: boolean
	readonly issues: readonly PreviewIssue[]
	/** Milliseconds the render took. */
	readonly durationMs: number
}

const messageOf = (error: unknown): string => (error instanceof Error ? error.message : String(error))

/** The anchor ids of the sections of a written page, such as `tipo`, which the render may add. */
const generatedIds: ReadonlySet<string> = (() => {
	const slugger = new GithubSlugger()
	return new Set(pageSections.flatMap((section) => section.titles.map((title) => slugger.slug(title))))
})()

/**
 * Renders one guide or written reference page of the site with `markdown` as its text, in a new
 * source context: nothing else reads that text, and neither the context nor its caches outlive the
 * call. The frontmatter of a reference page is checked as {@link publishRevision} checks it, and
 * the internal links as the health check does; what fails is reported in `issues`, and the prose
 * is still rendered so the author sees it.
 */
export async function renderSourcePreview(input: PreviewInput): Promise<SourcePreview> {
	const started = performance.now()
	const file = normalizeSourcePath(input.file)
	const markdown = normalizeText(input.markdown)
	if (markdown.length > maxRevisionLength) throw new RangeError(`A preview holds at most ${maxRevisionLength} characters`)
	const context = createSourceContext(createOverlay([{ file, markdown }]))
	const result = await withSourceContext(context, () => (input.kind === 'guide' ? previewGuide(file) : previewReference(file, markdown)))
	return { ...result, durationMs: Math.round(performance.now() - started) }
}

type Rendered = Omit<SourcePreview, 'durationMs'>

async function previewGuide(file: string): Promise<Rendered> {
	const entry = catalog.find((candidate) => repositoryPath(candidate.source) === file)
	if (!entry) throw new Error(`${file} is not a guide of the site`)
	const doc = await renderSource(entry.source, entry.transform)
	const issues = await linkIssues(entry.source, readRepositoryFile(entry.source), new Set((await documentHeadings(entry.source)).keys()))
	return { title: doc.title, description: doc.description, html: doc.html, toc: doc.toc, complete: true, issues }
}

async function previewReference(file: string, markdown: string): Promise<Rendered> {
	if (!/^docs\/reference\/[^/]+\/[^/]+\.md$/.test(file)) throw new Error(`${file} is not a written page of the reference`)
	const issues: PreviewIssue[] = []
	let body: string
	let written: ReturnType<typeof parseWrittenPage> | null = null
	try {
		written = parseWrittenPage(markdown, file)
		body = written.body
	} catch (error) {
		issues.push({ kind: 'frontmatter', message: messageOf(error), line: frontmatterLine(messageOf(error)) })
		try {
			body = parseFrontmatter(markdown, file).body
		} catch {
			body = markdown
		}
	}
	const firstLine = markdown.split('\n').length - body.split('\n').length + 1
	if (written) {
		try {
			const page = await referencePage(written.slug)
			if (!page) throw new Error(`${file}: the site has no page for ${written.slug}`)
			const own = new Set([...(await documentHeadings(file)).keys(), ...generatedIds])
			issues.push(...(await linkIssues(file, body, own, firstLine)))
			return { title: page.title, description: page.description, html: page.body, toc: page.toc, complete: true, issues }
		} catch (error) {
			issues.push({ kind: 'render', message: messageOf(error), line: null })
		}
	}
	// Only the prose, as the render would never reach the generated sections.
	const doc = await renderMarkdown(body, file)
	return { title: written?.title ?? doc.title, description: written?.description ?? doc.description, html: doc.html, toc: doc.toc, complete: false, issues }
}

/** The broken internal links of `text`, as issues with their line in the draft. */
async function linkIssues(file: string, text: string, own: ReadonlySet<string>, firstLine = 1): Promise<PreviewIssue[]> {
	const targets = await repositoryLinkTargets()
	const broken = await documentBrokenLinks(text, file, own, targets, firstLine)
	const reasons = { anchor: 'the anchor does not exist', file: 'the file does not exist', page: 'the page does not exist' } as const
	return broken.map((link) => ({ kind: 'link', message: `${link.href} → ${link.target}: ${reasons[link.reason]}`, line: link.line }))
}

/** The line of the file that a frontmatter error names, such as «line 3 of the frontmatter». */
function frontmatterLine(message: string): number | null {
	const match = /line (\d+) of the frontmatter/.exec(message)
	return match ? Number(match[1]) : null
}
