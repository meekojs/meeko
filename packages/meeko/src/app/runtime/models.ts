/**
 * Runtime and types behind `defineModel<T>()`, `model`/`model:name` on component tags and `model`
 * on native form controls.
 *
 * A model is a writable signal that a parent shares with a child: the child reads and writes the
 * parent's own signal. Without a parent signal the child keeps a local one, initialized from its
 * `default`; a model without `default` is required.
 */
import { escapeHtml } from '../../core/server'

/**
 * Key of the signals that a component borrows from its parent in the object its setup returns.
 * State snapshots skip them: the parent owns, snapshots and restores them.
 */
export const borrowedKey: unique symbol = Symbol('meeko.borrowed')

export type { ModelOptions } from '../definitions/define-model'

/** Value of a model signal during SSR. */
export function modelValue(model: unknown): unknown {
	if (typeof model !== 'object' || model === null || !('value' in model)) throw new TypeError('Meeko model expects a signal')
	return (model as { value: unknown }).value
}

/**
 * Content of a `<textarea model>` during SSR. The HTML parser drops one newline right after
 * `<textarea>`, so a value that starts with a newline gets another one before it.
 */
export function modelText(model: unknown): string {
	const value = modelValue(model)
	const text = value === null || value === undefined ? '' : String(value)
	return escapeHtml(text.startsWith('\n') ? `\n${text}` : text)
}

/** Whether an `<option>` of a `<select model>` renders `selected`. */
export function modelSelected(model: unknown, value: unknown): boolean {
	const current = modelValue(model)
	const option = value === null || value === undefined ? '' : String(value)
	return Array.isArray(current) ? current.includes(option) : current === option
}

type Equals<A, B> = (<V>() => V extends A ? 1 : 2) extends <V>() => V extends B ? 1 : 2 ? true : false

/** `unknown` for a signal whose `value` can be written; an error type for a computed or readonly one. */
export type WritableSignalCheck<S> = S extends { readonly value: unknown } ? (Equals<Pick<S, 'value'>, { -readonly [K in keyof Pick<S, 'value'>]: Pick<S, 'value'>[K] }> extends true ? unknown : { readonly 'a model needs a writable signal; computed and readonly signals cannot be written': never }) : unknown

/** Type-only check that a model expression is a writable signal; generated code never calls it. */
export function checkWritableSignal<S>(model: S & WritableSignalCheck<S>): void {
	void model
}

/** Native control kinds of `model` and the signal type each one needs. */
export interface NativeModelValues {
	/** Text-like `<input>` and `<textarea>`: `value`, on `input`. Number inputs also give strings. */
	text: string
	/** `<input type="range">`: `value`, on `input`; a signal that holds a number gets numbers, since 1.8. */
	range: number | string
	/**
	 * `<input type="checkbox">`: `checked`, on `change`. `undefined` renders unchecked, so the field of
	 * an optional schema key (`v.optional(v.boolean(), false)`) binds as it is; `change` writes a boolean.
	 */
	checkbox: boolean | undefined
	/** `<input type="radio">`: checked while the signal equals its value; `change` writes that value. */
	radio: string | null | undefined
	/** `<select>`: `value`, on `change`. */
	select: string
	/** `<select multiple>`: values of the selected options, on `change`. */
	multiple: string[]
}

export type NativeModelKind = keyof NativeModelValues
