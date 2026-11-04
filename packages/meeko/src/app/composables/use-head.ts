import type { HeadInput, HeadSource } from '../../shared/head'

import { effect, findContext, isDryRender, onCleanup } from '../../core/reactivity'
import { normalizeHeadInput } from '../../shared/head'
import { headLevelKey, headManagerKey, pageHeadSink, reader } from '../runtime/head'

/**
 * Añade etiquetas al `<head>` del documento y atributos a `<html>` y `<body>` mientras el componente
 * que la llama está montado. Funciona en páginas, layouts, `app/app.meeko`, componentes y
 * composables (en el nivel superior del script o en un composable que éste llama) y en el código
 * de nivel superior de `<script server>`, como alternativa a `export const head`.
 *
 * En el servidor, las entradas del render se escriben en `<head>` con los atributos escapados y el
 * nonce CSP en los `<script>` y `<style>`. En el navegador, la hidratación adopta las etiquetas del
 * SSR sin duplicarlas; un getter o una señal actualizan el documento cuando cambian, y las entradas
 * de los componentes que se desmontan al navegar desaparecen.
 *
 * Prioridad, de menor a mayor: `document` de `meeko.config.ts`, `app/app.meeko`, los layouts, la
 * página (y sus componentes) y el `head` de la ruta. Dentro de un mismo nivel gana la llamada
 * posterior. Las etiquetas se deduplican por `key` o por su clave natural: `name`, `property` o
 * `httpEquiv` en `meta`; `rel` y `href` en `link` (`canonical` e `icon` son únicos); `src` o el
 * código en `script`. Fuera de una aplicación de Meeko no hace nada.
 *
 * `titleTemplate` se aplica al título ganador de `app/app.meeko`, los layouts, la página y la
 * ruta. El `title` de `document.head` es el título del sitio: se muestra tal cual, sin plantilla,
 * cuando ningún nivel superior aporta un título o el que gana es una cadena vacía.
 *
 * @param input Entrada del head, o un getter o una señal que la devuelven.
 * @since 1.2.0
 * @example
 * ```html
 * <script lang="ts">
 * const count = signal(0);
 * useHead(() => ({
 *   title: `${count.value} elementos`,
 *   meta: [{ name: "robots", content: "noindex" }],
 *   htmlAttrs: { class: count.value > 0 ? "busy" : undefined },
 * }));
 * </script>
 * <template><button on:click="count.value++">Añadir</button></template>
 * ```
 * @see https://github.com/meekojs/meeko/blob/main/docs/framework.md#head-del-documento-document-usehead-y-useseometa
 */
export function useHead(input: HeadSource<HeadInput>): void {
	if (isDryRender()) return
	const read = reader(input)
	const manager = findContext(headManagerKey)
	if (!manager) {
		pageHeadSink?.(read)
		return
	}
	const level = findContext(headLevelKey) ?? 0
	if (!manager.live) {
		manager.add(level, read)
		return
	}
	const entry = manager.register!(level)
	effect(() => manager.update!(entry, normalizeHeadInput(read(), 'useHead')))
	onCleanup(() => manager.remove!(entry))
}
