import type { AnnouncementState, AnnouncementTone, ModerationAction } from '../../shared/schemas/moderation'

export const actionLabels: Readonly<Record<ModerationAction, string>> = { hide: 'Oculta', feature: 'Destacada' }

export const tones: readonly AnnouncementTone[] = ['info', 'success', 'warning', 'danger']

/** The tones as the screen names them; `danger` interrupts screen readers (`role="alert"`). */
export const toneLabels: Readonly<Record<AnnouncementTone, string>> = { info: 'Información', success: 'Novedad', warning: 'Advertencia', danger: 'Incidencia' }

export const announcementStateLabels: Readonly<Record<AnnouncementState, string>> = { live: 'En vigor', scheduled: 'Programado', ended: 'Terminado', inactive: 'Inactivo' }

export const announcementStateTones: Readonly<Record<AnnouncementState, 'accent' | 'danger' | 'neutral'>> = { live: 'accent', scheduled: 'neutral', ended: 'neutral', inactive: 'neutral' }

const pad = (value: number) => String(value).padStart(2, '0')

/** The value of an `<input type="datetime-local">` for an ISO instant, in the browser's time. */
export function toLocalInput(iso: string | null): string {
	if (!iso) return ''
	const date = new Date(iso)
	if (Number.isNaN(date.getTime())) return ''
	return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`
}

/** The ISO instant of an `<input type="datetime-local">`, read in the browser's time; `null` when empty or invalid. */
export function fromLocalInput(value: string): string | null {
	if (!value) return null
	const date = new Date(value)
	return Number.isNaN(date.getTime()) ? null : date.toISOString()
}
