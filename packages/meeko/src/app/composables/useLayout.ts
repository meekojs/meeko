import type { LayoutHandle, LayoutName, LayoutProps } from '../../shared/layout'

import { findContext } from '../../core/reactivity'
import { layoutKey } from '../runtime/layout'

/**
 * Da acceso a las props del layout con nombre de la página desde su `<script>` (y desde sus
 * componentes y sus `+layout.meeko`). Se autoimporta. En una página, su tipo sigue al layout que
 * eligen su `definePage` o sus `+group.ts`; en otro componente, `useLayout<"dashboard">()`.
 *
 * Las escrituras del setup de la página ya cuentan en el HTML del servidor: si la página escribe
 * durante el render, el servidor vuelve a renderizar la página una vez con esos valores, de modo que
 * la hidratación coincide. En el navegador, lo que se escribe mientras la página se renderiza se
 * aplica al terminar de montarla; después, cada `set` se aplica al momento. Al navegar a otra página,
 * el layout vuelve a las props de la página nueva (sus `layoutProps`, las de sus `+group.ts` y los
 * valores por defecto del layout): nada queda de la anterior.
 *
 * @typeParam L Layout de la página; en una página lo pone Meeko.
 * @returns El acceso a las props del layout; sin layout con nombre, uno que no hace nada.
 * @throws {Error} Fuera de una página que renderiza Meeko (por ejemplo, en una prueba unitaria).
 * @since 1.5.0
 * @example
 * ```html
 * <!-- app/pages/connections.meeko, con layout: "dashboard" -->
 * <script lang="ts">
 * const layout = useLayout();
 * const failing = signal(false);
 * effect(() => layout.set({ showAlert: failing.value }));
 * </script>
 * <template><button on:click="() => failing.value = !failing.value">Probar</button></template>
 * ```
 * @see https://github.com/meekojs/meeko/blob/main/docs/framework.md#props-del-layout-desde-la-página
 */
export function useLayout<L extends LayoutName | false = LayoutName>(): LayoutHandle<LayoutProps<L>> {
	const writer = findContext(layoutKey)
	if (!writer) {
		throw new Error('useLayout() necesita una página que renderiza Meeko: sólo funciona en las páginas, en sus componentes y en sus +layout.meeko. En una prueba unitaria, pasa los valores al componente como props.')
	}
	return Object.freeze({
		name: writer.name,
		get props() {
			return writer.read() as Readonly<Partial<LayoutProps<L>>>
		},
		set(patch: object) {
			if (typeof patch !== 'object' || patch === null || Array.isArray(patch)) throw new TypeError('useLayout().set() necesita un objeto con las props del layout')
			writer.write({ ...patch } as Record<string, unknown>)
		},
	})
}
