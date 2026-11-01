// The public contract of the moderation screen: rules that hide or feature a page of a web, and
// the announcements each web shows in its header. Dates travel as ISO strings.
import * as v from 'valibot'

import { siteSchema } from './dashboard'

const id = v.pipe(v.number(), v.integer(), v.minValue(1))
/** The version of a rule or an announcement the screen read: a write applies only while the row still has it. */
const version = v.pipe(v.number(), v.integer(), v.minValue(1))
const date = v.string()
/** An instant that the browser chose in its local time and sent as ISO. */
const instant = v.pipe(
	v.string(),
	v.check((value) => !Number.isNaN(Date.parse(value)), 'La fecha no es válida.'),
)

export const moderationActionSchema = v.picklist(['hide', 'feature'])
export const announcementToneSchema = v.picklist(['info', 'success', 'warning', 'danger'])
/** Whether an announcement shows now (meeko-docs-content `announcementState`). */
export const announcementStateSchema = v.picklist(['live', 'scheduled', 'ended', 'inactive'])

/** A page a rule can name: a source of the web, or a page of the site's active snapshot. */
export const knownPageSchema = v.object({ path: v.string(), title: v.string(), origin: v.picklist(['source', 'snapshot']) })

export const moderationRuleSchema = v.object({
	id: v.number(),
	site: siteSchema,
	path: v.string(),
	/** The title of the page, or `null` when the web no longer has it. */
	title: v.nullable(v.string()),
	action: moderationActionSchema,
	reason: v.nullable(v.string()),
	author: v.string(),
	createdAt: date,
	version: v.number(),
})

export const announcementSchema = v.object({
	id: v.number(),
	site: siteSchema,
	message: v.string(),
	tone: announcementToneSchema,
	startsAt: v.nullable(date),
	endsAt: v.nullable(date),
	active: v.boolean(),
	state: announcementStateSchema,
	author: v.string(),
	createdAt: date,
	version: v.number(),
})

export const moderationSchema = v.object({
	site: siteSchema,
	pages: v.array(knownPageSchema),
	rules: v.array(moderationRuleSchema),
	announcements: v.array(announcementSchema),
	/** Rules and announcements of every web, for the counters of the tabs. */
	counts: v.object({
		site: v.object({ rules: v.number(), live: v.number() }),
		ui: v.object({ rules: v.number(), live: v.number() }),
		i18n: v.object({ rules: v.number(), live: v.number() }),
	}),
})

export const moderationInput = v.object({ site: siteSchema })

/** A rule or an announcement to delete, at the version the screen read. */
export const moderationIdInput = v.object({ id, version })

/** Switches an announcement on or off, at the version the screen read; nothing else changes. */
export const announcementActiveInput = v.object({ id, version, active: v.boolean() })

/** The longest reason and message the schema of the database accepts. */
export const maxReasonLength = 2000
export const maxMessageLength = 500

export const saveRuleInput = v.pipe(
	v.object({
		site: siteSchema,
		path: v.pipe(v.string(), v.regex(/^\/[^?#\s]*$/, 'Elige una página de la web.'), v.maxLength(512)),
		action: moderationActionSchema,
		reason: v.optional(v.pipe(v.string(), v.trim(), v.maxLength(maxReasonLength, `Como mucho ${maxReasonLength} caracteres.`))),
		/**
		 * The rule of this page the screen read, or `null` when it had none: its id and its version.
		 * A rule deleted and created again starts at version 1 again, so the version alone does not
		 * name it.
		 */
		id: v.nullable(id),
		version: v.nullable(version),
	}),
	v.check((input) => (input.id === null) === (input.version === null), 'Una regla que se cambia lleva el id y la versión que se leyeron.'),
)

export const saveAnnouncementInput = v.pipe(
	v.object({
		/** The announcement to change; a new one without it. */
		id: v.optional(id),
		/** The version of that announcement the screen read; required with `id`. */
		version: v.optional(version),
		site: siteSchema,
		message: v.pipe(v.string(), v.trim(), v.minLength(1, 'Escribe el mensaje.'), v.maxLength(maxMessageLength, `Como mucho ${maxMessageLength} caracteres.`)),
		tone: announcementToneSchema,
		startsAt: v.nullable(instant),
		endsAt: v.nullable(instant),
		active: v.boolean(),
	}),
	v.check((input) => input.startsAt === null || input.endsAt === null || Date.parse(input.endsAt) > Date.parse(input.startsAt), 'El fin debe ser posterior al inicio.'),
	v.check((input) => (input.id === undefined) === (input.version === undefined), 'Un aviso que se cambia lleva la versión que se leyó.'),
)

export type ModerationAction = v.InferOutput<typeof moderationActionSchema>
export type AnnouncementTone = v.InferOutput<typeof announcementToneSchema>
export type AnnouncementState = v.InferOutput<typeof announcementStateSchema>
export type KnownPageRow = v.InferOutput<typeof knownPageSchema>
export type ModerationRuleRow = v.InferOutput<typeof moderationRuleSchema>
export type AnnouncementRow = v.InferOutput<typeof announcementSchema>
export type ModerationView = v.InferOutput<typeof moderationSchema>
