import type { Signal } from '@meekojs/meeko'

import { computed, effect, signal, untrack } from '@meekojs/meeko'

import type { CommandPaletteStatus, UICommandPaletteProps } from '../types/command-palette'

import { mountModalDialog } from './modal-dialog'
import { selectLabel } from './select'

/** A row of the list, flat in the order that the keyboard walks. */
export interface CommandPaletteRow<T> {
	readonly item: T
	readonly index: number
	readonly depth: number
	readonly label: string
	readonly href: string | undefined
}

const read = <T, R>(item: T, by: unknown): R | undefined => (typeof by === 'function' ? (by as (item: T) => R | undefined)(item) : typeof by === 'string' ? (item as Record<string, R>)[by] : undefined)

/** The results and what hangs from each one, in one list: the order of the arrows and of `active`. */
export function commandRows<T>(results: readonly T[], settings: Pick<UICommandPaletteProps<T>, 'labelBy' | 'hrefBy' | 'childrenBy'>): CommandPaletteRow<T>[] {
	const rows: CommandPaletteRow<T>[] = []
	const walk = (items: readonly T[], depth: number): void => {
		for (const item of items) {
			rows.push({ item, index: rows.length, depth, label: selectLabel(item, settings.labelBy as never), href: read<T, string>(item, settings.hrefBy) })
			walk(read<T, readonly T[]>(item, settings.childrenBy) ?? [], depth + 1)
		}
	}
	walk(results, 0)
	return rows
}

/** The row that an arrow moves to, wrapping around; `undefined` for any other key or an empty list. */
export function commandKeyTarget(key: string, active: number, count: number): number | undefined {
	if (!count || (key !== 'ArrowDown' && key !== 'ArrowUp')) return undefined
	return (active + (key === 'ArrowDown' ? 1 : -1) + count) % count
}

/** Whether a keyboard event opens the palette: `Ctrl` or `⌘` + `K`, or `/` while not writing. */
export function commandShortcut(event: Pick<KeyboardEvent, 'key' | 'ctrlKey' | 'metaKey' | 'altKey'>, typing: boolean): boolean {
	if (event.key === 'k' || event.key === 'K') return event.ctrlKey || event.metaKey
	return event.key === '/' && !typing && !event.ctrlKey && !event.metaKey && !event.altKey
}

/** What the template of `<UICommandPalette>` reads and the component runs. */
export function createCommandPalette<T>(props: UICommandPaletteProps<T>, models: { readonly open: Signal<boolean>; readonly query: Signal<string>; readonly active: Signal<number> }, id: string, emit: { open(): void; close(): void; choose(item: T): void }) {
	const { open, query, active } = models
	const listId = `${id}-list`
	const rows = computed(() => commandRows(props.results, props))
	const status = computed((): CommandPaletteStatus => props.status ?? (rows.value.length ? 'ready' : 'idle'))
	const showing = computed(() => status.value === 'ready' && rows.value.length > 0)
	const rowId = (index: number): string => `${id}-row-${index}`
	const activeId = computed(() => (showing.value && rows.value[active.value] ? rowId(active.value) : undefined))
	/** The modifier of the shortcut: Ctrl until the browser says it runs on an Apple platform. */
	const modifier = signal('Ctrl')
	const show = (): void => {
		open.value = true
	}
	const hide = (): void => {
		open.value = false
	}
	const pick = (row: CommandPaletteRow<T>): void => {
		emit.choose(row.item)
		hide()
	}
	let dialog: HTMLDialogElement | null = null
	const keydown = (event: KeyboardEvent): void => {
		const target = commandKeyTarget(event.key, active.value, rows.value.length)
		if (event.key === 'Escape') {
			// A search field would spend the first Escape on emptying itself.
			event.preventDefault()
			hide()
		} else if (target !== undefined) {
			event.preventDefault()
			active.value = target
		} else if (event.key === 'Enter' && activeId.value !== undefined) {
			event.preventDefault()
			// A click, so that a link goes through the router and a new tab's modifiers keep working.
			dialog?.ownerDocument.getElementById(activeId.value)?.click()
		}
	}
	const mount = (element: HTMLDialogElement | null, input: HTMLInputElement | null): (() => void) => {
		if (!element) return () => {}
		dialog = element
		const document = element.ownerDocument
		const controller = mountModalDialog(element, open, {}, hide)
		if (/Mac|iPhone|iPad/.test(document.defaultView?.navigator.userAgent ?? '')) modifier.value = '⌘'
		const shortcut = (event: KeyboardEvent): void => {
			if (props.shortcut === false || open.value) return
			const target = event.target as HTMLElement | null
			const typing = target?.isContentEditable === true || /^(?:input|textarea|select)$/i.test(target?.tagName ?? '')
			if (!commandShortcut(event, typing)) return
			event.preventDefault()
			show()
		}
		document.addEventListener('keydown', shortcut)
		let wasOpen = untrack(() => open.value)
		const stopOpen = effect(() => {
			const now = open.value
			untrack(() => {
				if (now === wasOpen) return
				wasOpen = now
				if (!now) {
					emit.close()
					return
				}
				emit.open()
				input?.focus()
				input?.select()
			})
		})
		// New results start again from the first row.
		const stopRows = effect(() => {
			void rows.value
			active.value = 0
		})
		const stopScroll = effect(() => {
			const current = activeId.value
			if (current !== undefined) document.getElementById(current)?.scrollIntoView?.({ block: 'nearest' })
		})
		return () => {
			stopScroll()
			stopRows()
			stopOpen()
			document.removeEventListener('keydown', shortcut)
			controller.dispose()
			dialog = null
		}
	}
	return { listId, rows, status, showing, activeId, modifier, rowId, show, hide, pick, keydown, mount, query }
}
