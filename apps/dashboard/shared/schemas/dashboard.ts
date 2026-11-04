// The public contract of the dashboard's RPC: what the pages read and the actions they run. Dates
// travel as ISO strings.
import * as v from 'valibot'

/** The three public webs of the documentation. */
export const siteSchema = v.picklist(['site', 'ui', 'i18n'])
/** Guide and reference pages of the site are Markdown; ui and i18n pages are `.meeko`. */
export const kindSchema = v.picklist(['guide', 'reference', 'page'])
/** How the published revision of a Markdown source relates to Git (meeko-docs-content/diff). */
export const stateSchema = v.picklist(['git', 'same', 'edited', 'conflict', 'missing'])
/** The languages of the documentation: Spanish is the original, English its translation (`docs/en/**`). */
export const localeSchema = v.picklist(['es', 'en'])
/** How a translation relates to its original (meeko-docs-content/locale `translationStatus`). */
export const translationStatusSchema = v.picklist(['translated', 'outdated', 'missing'])

const id = v.pipe(v.number(), v.integer(), v.minValue(1))
const date = v.string()

export const sourceSchema = v.object({
	id: v.number(),
	site: siteSchema,
	/** `es` for an original, `en` for a translation of `docs/en/**` (same `path` as its original). */
	locale: localeSchema,
	path: v.string(),
	kind: kindSchema,
	title: v.string(),
	file: v.nullable(v.string()),
	baseHash: v.nullable(v.string()),
	importedAt: date,
	removedAt: v.nullable(date),
	publishedRevisionId: v.nullable(v.number()),
	/** `null` for a `.meeko` page, which has no Markdown in the database. */
	state: v.nullable(stateSchema),
	importStale: v.boolean(),
	added: v.number(),
	removed: v.number(),
})

export const sourceListSchema = v.array(sourceSchema)

export const sourceListInput = v.object({
	site: v.optional(siteSchema),
	locale: v.optional(localeSchema),
	kind: v.optional(kindSchema),
	includeRemoved: v.optional(v.boolean()),
})

export const snapshotSchema = v.object({
	id: v.number(),
	publishedAt: date,
	active: v.boolean(),
	pages: v.number(),
	/** Pages of each language: one snapshot holds both. */
	pagesByLocale: v.object({ es: v.number(), en: v.number() }),
	publishedBy: v.nullable(v.string()),
	note: v.nullable(v.string()),
})

export const snapshotListSchema = v.array(snapshotSchema)

/** How many translations into English are in each status. */
export const translationCountsSchema = v.object({ translated: v.number(), outdated: v.number(), missing: v.number(), total: v.number() })

/** Counts of the Spanish originals of a web; the translations are counted in `translations` of the overview. */
export const siteSummarySchema = v.object({
	site: siteSchema,
	total: v.number(),
	kinds: v.object({ guide: v.number(), reference: v.number(), page: v.number() }),
	states: v.object({ git: v.number(), same: v.number(), edited: v.number(), conflict: v.number(), missing: v.number() }),
	importStale: v.number(),
	removed: v.number(),
	/** Newest `imported_at` of its sources: the last import that changed one of them. */
	lastImportedAt: v.nullable(date),
})

export const jobKindSchema = v.picklist(['import', 'publish', 'health'])
export const jobStatusSchema = v.picklist(['running', 'succeeded', 'failed'])

/**
 * What a job found, as data: the screen says it in its language (`job.summary.*`). The job's own
 * output stays a technical log in English.
 */
export const jobFactsSchema = v.variant('kind', [
	v.object({ kind: v.literal('import'), inserted: v.number(), updated: v.number(), unchanged: v.number(), removed: v.number(), restored: v.number() }),
	v.object({
		kind: v.literal('publish'),
		snapshotId: v.number(),
		pages: v.number(),
		revisions: v.number(),
		locales: v.object({ es: v.number(), en: v.number() }),
		translation: v.object({ translated: v.number(), outdated: v.number(), missing: v.number() }),
	}),
	v.object({ kind: v.literal('health'), pending: v.number(), exports: v.number(), broken: v.number(), links: v.number() }),
	/** A publication that lost to another change of the active snapshot: the ids it expected and found. */
	v.object({ kind: v.literal('conflict'), expected: v.nullable(v.number()), actual: v.nullable(v.number()) }),
])

export const jobSchema = v.object({
	id: v.number(),
	kind: jobKindSchema,
	status: jobStatusSchema,
	startedAt: date,
	finishedAt: v.nullable(date),
	exitCode: v.nullable(v.number()),
	/** Last lines of its output, stdout and stderr together. */
	output: v.pipe(v.array(v.string()), v.readonly()),
	/** Lines dropped from the start of `output`. */
	dropped: v.number(),
	/** One technical line about the result, in English, such as «Snapshot 12 published with 1274 pages». */
	summary: v.nullable(v.string()),
	/** The result as data, for the screen; `null` while it runs or when the job printed none. */
	facts: v.nullable(jobFactsSchema),
	/**
	 * A publication that lost to a rollback or another publication committed while it rendered
	 * (`SnapshotConflictError`): nothing was stored, and publishing again renders the new state.
	 */
	conflict: v.boolean(),
	/** Who publishes and the note, for a publication: what «Volver a publicar» sends again. */
	publishedBy: v.nullable(v.string()),
	note: v.nullable(v.string()),
})

export const jobsSchema = v.object({
	/** The last import or publication: they share one slot and never run at the same time. */
	content: v.nullable(jobSchema),
	health: v.nullable(jobSchema),
})

export const overviewSchema = v.object({
	sites: v.array(siteSummarySchema),
	/** The translations of the guides and the written reference of the site into English. */
	translations: translationCountsSchema,
	activeSnapshot: v.nullable(snapshotSchema),
	snapshots: v.number(),
	jobs: jobsSchema,
})

export const revisionStatusSchema = v.picklist(['draft', 'published', 'archived'])

export const revisionSchema = v.object({
	id: v.number(),
	author: v.string(),
	status: revisionStatusSchema,
	note: v.nullable(v.string()),
	baseHash: v.nullable(v.string()),
	createdAt: date,
	publishedAt: v.nullable(date),
	/** When it was last archived; `null` when it is not archived or was archived before migration 003. */
	archivedAt: v.nullable(date),
	/** Written from another Git than the file of now: its base hash differs from Git's hash. */
	conflict: v.boolean(),
	/**
	 * The site does not show its state until the next publication: published after the active
	 * snapshot, or the published revision of that snapshot archived after it with nothing published
	 * in its place (the page goes back to Git).
	 */
	pending: v.boolean(),
})

export const sourceDetailSchema = v.object({
	source: sourceSchema,
	revisions: v.array(revisionSchema),
	/** Unified diff from Git to the published revision; empty without one or without differences. */
	diff: v.string(),
	/** Hash of the file in Git now, or `null` when it no longer exists or is a `.meeko` page. */
	gitHash: v.nullable(v.string()),
	/** A guide or reference page whose file Git still has: its Markdown can be edited. */
	editable: v.boolean(),
})

export const idInput = v.object({ id })
export const emptyInput = v.object({})

export const startJobInput = v.variant('kind', [
	v.object({ kind: v.literal('import') }),
	// Who publishes is the user of the session (F5), not a field.
	v.object({
		kind: v.literal('publish'),
		note: v.optional(v.pipe(v.string(), v.trim(), v.maxLength(500, 'validation.max500'))),
	}),
	v.object({ kind: v.literal('health') }),
])

export const pendingReferenceSchema = v.object({ group: v.string(), groupTitle: v.string(), name: v.string(), symbol: v.string(), href: v.string() })
export const undocumentedExportSchema = v.object({ id: v.string(), specifier: v.string(), name: v.string(), kind: v.string(), kindLabel: v.string(), href: v.string(), deprecated: v.boolean() })
export const brokenLinkSchema = v.object({ file: v.string(), line: v.nullable(v.number()), href: v.string(), target: v.string(), reason: v.picklist(['anchor', 'file', 'page']) })

export const healthReportSchema = v.object({
	checkedAt: date,
	pendingReferences: v.array(pendingReferenceSchema),
	undocumentedExports: v.array(undocumentedExportSchema),
	brokenLinks: v.array(brokenLinkSchema),
	checked: v.object({ guides: v.number(), references: v.number(), links: v.number() }),
})

export const healthSchema = v.object({
	/** The last report of this process, or `null` before the first check ends. */
	report: v.nullable(healthReportSchema),
	job: v.nullable(jobSchema),
	/** The `.meeko` pages of ui and i18n, from the imported sources. */
	pages: v.array(sourceSchema),
})

export type DocsSite = v.InferOutput<typeof siteSchema>
export type SourceKind = v.InferOutput<typeof kindSchema>
export type DivergenceState = v.InferOutput<typeof stateSchema>
export type SourceRow = v.InferOutput<typeof sourceSchema>
export type SnapshotRow = v.InferOutput<typeof snapshotSchema>
export type SiteSummary = v.InferOutput<typeof siteSummarySchema>
export type Job = v.InferOutput<typeof jobSchema>
export type JobKind = v.InferOutput<typeof jobKindSchema>
export type Jobs = v.InferOutput<typeof jobsSchema>
export type Overview = v.InferOutput<typeof overviewSchema>
export type RevisionRow = v.InferOutput<typeof revisionSchema>
export type SourceDetail = v.InferOutput<typeof sourceDetailSchema>
export type StartJob = v.InferOutput<typeof startJobInput>
export type HealthReport = v.InferOutput<typeof healthReportSchema>
export type Health = v.InferOutput<typeof healthSchema>

// F2: editing the Markdown of the site with revisions ---------------------------------------------

/**
 * Longest Markdown the dashboard sends, in bytes of its JSON ({@link encodedBytes}). An RPC body is
 * at most 1 MiB in Meeko and JSON escapes line breaks, quotes, backslashes and control characters
 * (up to six bytes for one), so the limit counts the escaped text: with the other fields of a save,
 * a body within it always fits. The package's own limit is 1,000,000 characters (`maxRevisionLength`).
 */
export const maxMarkdownBytes = 900_000

const encoder = new TextEncoder()

/** UTF-8 size of a text. */
export const utf8Bytes = (text: string): number => encoder.encode(text).length

/** UTF-8 size of a text as a JSON string, escaped and quoted: what it adds to the body of an RPC. */
export const encodedBytes = (text: string): number => utf8Bytes(JSON.stringify(text))

export const markdownSchema = v.pipe(
	v.string(),
	// The messages are catalog keys (app/locales/<locale>/common.json): the page says them in its language.
	v.check((text) => text.trim().length > 0, 'validation.markdownEmpty'),
	v.check((text) => encodedBytes(text) <= maxMarkdownBytes, 'validation.markdownTooLarge'),
)

const noteSchema = v.pipe(v.string(), v.trim(), v.maxLength(500, 'validation.max500'))
const hashSchema = v.pipe(v.string(), v.regex(/^[0-9a-f]{64}$/))

/** A revision with its Markdown. */
export const revisionDetailSchema = v.object({ ...revisionSchema.entries, sourceId: v.number(), markdown: v.string() })

/** What the editor of a source opens with. */
export const editorSchema = v.object({
	source: sourceSchema,
	/** The draft being edited, or `null` for a new draft. */
	revision: v.nullable(revisionDetailSchema),
	/** The text the editor starts from and where it comes from. */
	start: v.object({
		markdown: v.string(),
		from: v.picklist(['draft', 'revision', 'git']),
		/** The revision it comes from, when it is not Git. */
		revisionId: v.nullable(v.number()),
		/** The Git text a new draft is written from: its source's when it comes from a revision. */
		baseHash: v.nullable(v.string()),
	}),
	/** Hash of the Git text a new draft is written from: the working tree now. */
	gitHash: v.nullable(v.string()),
	/** Size limit of the Markdown, in UTF-8 bytes. */
	maxBytes: v.number(),
	/**
	 * For a translation: its Spanish original, whose hash in the last import «mark as translated»
	 * writes as `source-hash`. `null` for an original.
	 */
	original: v.nullable(v.object({ id: v.number(), title: v.string(), baseHash: v.nullable(v.string()) })),
})

export const editorInput = v.object({
	sourceId: id,
	/** A draft to edit, or another revision to start a new draft from. */
	revisionId: v.optional(id),
})

/** Saves a draft: creates it without `revisionId`, saves it again with one. The author is the user of the session. */
export const saveDraftInput = v.object({
	sourceId: id,
	revisionId: v.optional(id),
	markdown: markdownSchema,
	note: v.optional(noteSchema),
	/** Hash of the text the editor loaded, so a draft saved meanwhile by someone else is not overwritten. */
	expectedHash: v.optional(hashSchema),
	/** Hash of the Git text a new draft starts from. */
	baseHash: v.optional(hashSchema),
})

export const revisionActionInput = v.object({ id })

/** The two sides of a comparison: a revision or the file in Git now. */
export const compareSideSchema = v.variant('kind', [v.object({ kind: v.literal('git') }), v.object({ kind: v.literal('revision'), id })])

export const compareInput = v.object({ sourceId: id, from: compareSideSchema, to: compareSideSchema })

export const comparisonSchema = v.object({
	diff: v.string(),
	added: v.number(),
	removed: v.number(),
	fromLabel: v.string(),
	toLabel: v.string(),
	/** The texts are too different to compare line by line. */
	tooLarge: v.boolean(),
})

export const conflictSchema = v.object({
	revisionId: v.number(),
	state: v.picklist(['conflict', 'current', 'missing']),
	gitHash: v.nullable(v.string()),
	baseHash: v.nullable(v.string()),
	/** Where the text the revision was written from was found, or `null` when it was not. */
	baseOrigin: v.nullable(v.picklist(['import', 'working-tree', 'commit'])),
	baseCommit: v.nullable(v.string()),
	diffs: v.object({ baseToGit: v.string(), baseToRevision: v.string(), gitToRevision: v.string() }),
	/** `clean` merges can become a new draft; `null` without a conflict or without a base. */
	merge: v.nullable(v.object({ clean: v.boolean(), conflicts: v.number() })),
})

/** A new draft of Git now plus the changes of a revision, written by the user of the session. */
export const mergeInput = v.object({ id, note: v.optional(noteSchema) })

export const exportSchema = v.object({ file: v.string(), filename: v.string(), markdown: v.string(), revisionId: v.number() })

export const previewInput = v.object({ sourceId: id, markdown: markdownSchema })

export const previewIssueSchema = v.object({ kind: v.picklist(['frontmatter', 'link', 'render']), message: v.string(), line: v.nullable(v.number()) })

export const previewSchema = v.object({
	title: v.string(),
	description: v.string(),
	html: v.string(),
	toc: v.array(v.object({ id: v.string(), text: v.string(), level: v.number() })),
	complete: v.boolean(),
	issues: v.array(previewIssueSchema),
	durationMs: v.number(),
})

/**
 * A change of a revision that the active snapshot does not have yet: `published` after it, or
 * `archived` after it while the snapshot shows it (its page goes back to Git).
 */
export const pendingRevisionSchema = v.object({
	id: v.number(),
	sourceId: v.number(),
	title: v.string(),
	path: v.string(),
	locale: localeSchema,
	author: v.string(),
	change: v.picklist(['published', 'archived']),
	publishedAt: date,
	archivedAt: v.nullable(date),
})

export const pendingListSchema = v.object({
	revisions: v.array(pendingRevisionSchema),
	/** The active snapshot they are compared with, or `null` when none is active. */
	activeSnapshotId: v.nullable(v.number()),
})

export type RevisionStatus = v.InferOutput<typeof revisionStatusSchema>
export type RevisionDetail = v.InferOutput<typeof revisionDetailSchema>
export type Editor = v.InferOutput<typeof editorSchema>
export type SaveDraft = v.InferOutput<typeof saveDraftInput>
export type CompareSide = v.InferOutput<typeof compareSideSchema>
export type Comparison = v.InferOutput<typeof comparisonSchema>
export type Conflict = v.InferOutput<typeof conflictSchema>
export type ExportedFile = v.InferOutput<typeof exportSchema>
export type Preview = v.InferOutput<typeof previewSchema>
export type PreviewIssue = v.InferOutput<typeof previewIssueSchema>
export type PendingRevision = v.InferOutput<typeof pendingRevisionSchema>
export type PendingList = v.InferOutput<typeof pendingListSchema>

// Translations of the site into English ------------------------------------------------------------

export const translationListInput = v.object({
	kind: v.optional(v.picklist(['guide', 'reference'])),
	status: v.optional(translationStatusSchema),
})

/** A guide or a written reference page of the site and its translation into English. */
export const translationEntrySchema = v.object({
	original: sourceSchema,
	/** The translation, or `null` without one: the English web shows the original. */
	translation: v.nullable(sourceSchema),
	status: translationStatusSchema,
	/** The hash of the original the translation says it was made from (`source-hash`). */
	sourceHash: v.nullable(v.string()),
	/** Where the translation lives or goes in the repository (`docs/en/…`). */
	file: v.nullable(v.string()),
})

export const translationListSchema = v.object({
	entries: v.array(translationEntrySchema),
	counts: translationCountsSchema,
})

/** A translation compared with its original, by the id of either of them. */
export const translationDetailInput = v.object({ id })

export const translationDetailSchema = v.object({
	original: sourceSchema,
	translation: v.nullable(sourceSchema),
	status: translationStatusSchema,
	sourceHash: v.nullable(v.string()),
	file: v.nullable(v.string()),
	originalMarkdown: v.nullable(v.string()),
	translationMarkdown: v.nullable(v.string()),
	translationRevisionId: v.nullable(v.number()),
	/** Where the text the translation was made from was found, or `null` when it was not. */
	translatedFrom: v.nullable(v.picklist(['import', 'working-tree', 'commit'])),
	/** Unified diff of the original since it was translated: what the translation must take in. */
	originalChanges: v.string(),
})

/** Writes the hash of the original as `source-hash` of a translation's Markdown. */
export const stampInput = v.object({ sourceId: id, markdown: v.pipe(v.string(), v.maxLength(1_000_000)) })
export const stampSchema = v.object({ markdown: v.string(), sourceHash: v.string() })

export type DocsLocale = v.InferOutput<typeof localeSchema>
export type TranslationStatus = v.InferOutput<typeof translationStatusSchema>
export type TranslationCounts = v.InferOutput<typeof translationCountsSchema>
export type JobFacts = v.InferOutput<typeof jobFactsSchema>
export type TranslationEntryRow = v.InferOutput<typeof translationEntrySchema>
export type TranslationList = v.InferOutput<typeof translationListSchema>
export type TranslationDetailView = v.InferOutput<typeof translationDetailSchema>
