import type { ReadonlySignal } from '../../core/reactivity'
/**
 * Runtime and types behind `defineSnippets<T>()`, `<snippet name params>` and
 * `<render snippet args>`.
 *
 * A snippet is template content that a parent writes between the tags of a child and the child
 * places with `<render>`. Its content belongs to the parent: it reads the parent's scope, and its
 * bindings live in the parent's reactive root although its nodes sit in the child's DOM.
 */
import type { DomScope } from './renderer'

import { currentEffectOwner } from '../../core/reactivity'

declare const snippetArguments: unique symbol

/**
 * Contenido de plantilla que un padre pasa a un hijo y que el hijo coloca con `<render>`. `Args`
 * son los parámetros que el hijo le entrega. Es el tipo de cada campo que devuelve
 * `defineSnippets<T>()`; sólo sirve para tipar, su contenido en tiempo de ejecución es interno.
 * Desde 1.4, una clave de `T` también puede ser un `Snippet<Args>`, que cuenta como `Args`: así
 * `defineSnippets<Omit<AppCardSnippets, "footer">>()` reutiliza los snippets de otro componente.
 *
 * @typeParam Args Tupla de parámetros que recibe el snippet.
 * @since 1.1.0
 * @example
 * ```html
 * <script lang="ts">
 * const props = defineProps<{ names: string[] }>();
 * // snippets.item es Snippet<[name: string]>.
 * const snippets = defineSnippets<{ item: [name: string] }>();
 * </script>
 * <template><ul><li each:of="props.names" each:as="name"><render snippet="snippets.item" args="name" /></li></ul></template>
 * ```
 */
export interface Snippet<Args extends readonly unknown[] = []> {
	/** Sólo de tipo: los parámetros del snippet. */
	readonly [snippetArguments]?: (...args: Args) => void
}

const snippetData = Symbol('meeko.snippet')

/** What a compiled snippet carries at runtime. */
export interface SnippetData {
	readonly render: (...args: readonly unknown[]) => string
	readonly hydrate: ((args: ReadonlySignal<readonly unknown[]>, scope: DomScope) => () => void) | undefined
	/** Reactive root of the parent where the snippet was written. */
	readonly owner: object | undefined
}

/**
 * Crea un snippet en la raíz reactiva actual del padre. Interno a los componentes compilados: sólo
 * la etiqueta del componente tipa `Args`, así que unos `params` de más fallan en la función; un
 * nombre que el hijo no declara recibe `any[]` además de su propio error.
 */
export function snippet<Args extends readonly unknown[] = any[]>(render: NoInfer<(...args: Args) => string>, hydrate?: NoInfer<(args: ReadonlySignal<Args>, scope: DomScope) => () => void>): Snippet<Args> {
	const data: SnippetData = {
		render: render as unknown as SnippetData['render'],
		hydrate: hydrate as SnippetData['hydrate'],
		owner: currentEffectOwner(),
	}
	return { [snippetData]: data } as unknown as Snippet<Args>
}

/** Runtime data of a snippet, or `undefined` for anything else. */
export function snippetOf(value: unknown): SnippetData | undefined {
	return typeof value === 'object' && value !== null ? (value as { [snippetData]?: SnippetData })[snippetData] : undefined
}

export type { SnippetArgs, SnippetMap, SnippetTypes } from '../definitions/define-snippets'
