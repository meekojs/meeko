import type { ReadonlySignal, Signal } from '../../core/reactivity'
import type { PageSchema } from '../definitions/define-page'
import type { AppNavigation } from '../runtime/navigate'

import { computed, signal, untrack } from '../../core/reactivity'
import { appNavigationAvailable, currentAppNavigation, navigateApp } from '../runtime/navigate'
import { useRoute } from './useRoute'

/**
 * Opciones de {@link useSearchParam}.
 *
 * @typeParam T Tipo del valor, el de la salida de `schema`.
 * @since 1.10.0
 * @example
 * ```ts
 * import type { SearchParamOptions } from "@meekojs/meeko/framework";
 *
 * const options: SearchParamOptions<string> = { history: "push" };
 * ```
 */
export interface SearchParamOptions<T> {
	/**
	 * Standard Schema síncrono que valida y transforma el valor de la URL: un texto o, si la clave
	 * se repite, una lista de textos. Un valor que no lo cumple vale el valor por defecto. Sin
	 * schema, el valor es el texto de la URL (el primero, si se repite).
	 */
	readonly schema?: PageSchema<unknown, T> | undefined
	/**
	 * Cómo escribe la URL: `"replace"` (por defecto) sustituye la entrada del historial y `"push"`
	 * añade otra, para que el botón atrás vuelva al valor anterior.
	 */
	readonly history?: 'replace' | 'push' | undefined
}

/** The search writes of each application that have not committed yet: the next write builds on them. */
const pendingUrls = new WeakMap<AppNavigation, string>()

/** The values of the parameter in a URL as `URLSearchParams` gives them. */
function serialize(label: string, value: unknown): string[] {
	if (value === null || value === undefined) return []
	if (Array.isArray(value)) return value.flatMap((item: unknown) => serialize(label, item))
	if (value instanceof Date) return [value.toISOString()]
	if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean' || typeof value === 'bigint') return [String(value)]
	throw new TypeError(`${label}: only strings, numbers, booleans, dates and arrays of them can be written to the URL`)
}

function sameValues(first: readonly string[], second: readonly string[]): boolean {
	return first.length === second.length && first.every((value, index) => value === second[index])
}

/**
 * Devuelve una señal editable enlazada al parámetro `name` de la query string de la ruta
 * confirmada. Se autoimporta en los componentes y composables de `app/`.
 *
 * - **Leer.** Sigue a `useRoute()`: cambia cuando una navegación se confirma, también por el
 *   historial. Sin el parámetro, o con un valor que no cumple `schema`, vale `initial`; nunca lanza
 *   por la URL. En SSR es el de la petición y la hidratación lee lo mismo, sin desajustes.
 * - **Escribir.** Navega a la misma URL con el parámetro cambiado, conservando los demás y el
 *   fragmento, por el router del cliente: se ejecutan el middleware de ruta y los datos de la
 *   página, como en cualquier navegación. El valor nuevo se lee al momento; si la navegación falla
 *   o se cancela, vuelve al de la URL. El valor igual a `initial`, `null` y `undefined` quitan el
 *   parámetro. Por defecto sustituye la entrada del historial (`history: "push"` añade otra).
 * - **SSR.** Es de sólo lectura: escribir lanza un error.
 *
 * @param name Nombre del parámetro, como `"tab"`.
 * @param initial Valor por defecto, sin el parámetro o con uno inválido.
 * @param options `history`; sin `schema`, el valor es el texto de la URL.
 * @returns La señal del parámetro.
 * @throws {Error} Fuera de una aplicación de Meeko, como `useRoute()`.
 * @since 1.10.0
 * @example
 * ```html
 * <script lang="ts">
 * const tab = useSearchParam("tab", "perfil");
 * </script>
 * <template>
 *   <button on:click="() => (tab.value = 'actividad')">Actividad</button>
 *   <p>Pestaña: {tab.value}</p>
 * </template>
 * ```
 * @see https://github.com/meekojs/meeko/blob/main/docs/routing-navigation-reference.md#parámetros-de-búsqueda-como-estado
 */
export function useSearchParam(name: string, initial: string, options?: SearchParamOptions<string> & { readonly schema?: undefined }): Signal<string>
/**
 * Devuelve una señal editable enlazada al parámetro `name` de la query string, validada y
 * transformada por `schema`; el tipo sale del schema.
 *
 * @param name Nombre del parámetro, como `"page"`.
 * @param initial Valor por defecto, sin el parámetro o con uno que no cumple `schema`.
 * @param options `schema` (Standard Schema síncrono) y `history`.
 * @returns La señal del parámetro.
 * @throws {Error} Fuera de una aplicación de Meeko, como `useRoute()`.
 * @throws {TypeError} Si `schema` valida de forma asíncrona.
 * @since 1.10.0
 * @example
 * ```html
 * <script lang="ts">
 * import * as v from "valibot";
 * const page = useSearchParam("page", 1, { schema: v.pipe(v.string(), v.toNumber(), v.integer(), v.minValue(1)) });
 * </script>
 * <template><button on:click="() => page.value++">Página {page.value + 1}</button></template>
 * ```
 * @see https://github.com/meekojs/meeko/blob/main/docs/routing-navigation-reference.md#parámetros-de-búsqueda-como-estado
 */
export function useSearchParam<T>(name: string, initial: NoInfer<T>, options: SearchParamOptions<T> & { readonly schema: PageSchema<unknown, T> }): Signal<T>
export function useSearchParam<T>(name: string, initial: T, options: SearchParamOptions<T> = {}): Signal<T> {
	const label = `useSearchParam("${String(name)}")`
	if (typeof name !== 'string' || name === '') throw new TypeError('useSearchParam: the name must be a non-empty string')
	const schema = options.schema
	if (schema !== undefined && typeof schema['~standard']?.validate !== 'function') throw new TypeError(`${label}: schema must be a Standard Schema`)
	const route = useRoute()
	const fallback = serialize(label, initial)
	const decode = (values: readonly string[]): T => {
		if (values.length === 0) return initial
		const raw = values.length === 1 ? values[0]! : [...values]
		if (!schema) return (typeof raw === 'string' ? raw : raw[0]) as T
		const result = schema['~standard'].validate(raw)
		if (result && typeof (result as PromiseLike<unknown>).then === 'function') {
			void Promise.resolve(result).catch(() => {})
			throw new TypeError(`${label}: the schema must validate synchronously`)
		}
		const settled = result as { value: T; issues?: undefined } | { issues: readonly unknown[] }
		return settled.issues ? initial : (settled as { value: T }).value
	}
	const fromUrl: ReadonlySignal<T> = computed(() => decode(new URL(route.url.value, 'http://meeko.local').searchParams.getAll(name)))
	// The value of a write until its navigation commits, fails or is cancelled.
	const written = signal<{ readonly value: T } | undefined>(undefined)
	const write = (next: T): void => {
		const values = serialize(label, next)
		if (
			sameValues(
				values,
				serialize(
					label,
					untrack(() => result.value),
				),
			)
		)
			return
		if (!appNavigationAvailable()) throw new Error(`${label}: la URL sólo se puede escribir en el navegador; en el servidor el valor es de sólo lectura.`)
		const app = currentAppNavigation(label)
		// Writes in a row build on each other: `page` and then `q` keep both.
		const url = new URL(pendingUrls.get(app) ?? untrack(() => route.url.value), 'http://meeko.local')
		const kept = sameValues(values, fallback) ? [] : values
		// One value keeps the place of the parameter in the query; a list goes at the end.
		if (kept.length === 1) url.searchParams.set(name, kept[0]!)
		else {
			url.searchParams.delete(name)
			for (const value of kept) url.searchParams.append(name, value)
		}
		const target = url.pathname + url.search + url.hash
		const pending = { value: next }
		written.value = pending
		pendingUrls.set(app, target)
		void navigateApp(app, target, { replace: options.history !== 'push', viewTransition: false })
			.catch((error: unknown) => app.report(error))
			.finally(() => {
				if (pendingUrls.get(app) === target) pendingUrls.delete(app)
				if (untrack(() => written.value) === pending) written.value = undefined
			})
	}
	const result: Signal<T> = {
		get value() {
			const local = written.value
			return local ? local.value : fromUrl.value
		},
		set value(next: T) {
			write(next)
		},
	}
	return result
}
