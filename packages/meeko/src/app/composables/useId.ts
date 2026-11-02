import { nextId } from '../runtime/ids'

/**
 * Devuelve un ID único para atributos como `id`, `for`, `aria-describedby` o `aria-controls`, el
 * mismo en el HTML del servidor y al hidratar en el navegador. Llamado en el script de un
 * componente, depende sólo de la posición de la instancia en el árbol (también dentro de `each`,
 * por la clave de cada fila, y de `if`) y del orden de las llamadas en ese script: no viaja en el
 * estado ni se repite entre instancias. Se autoimporta en los `.meeko`.
 *
 * Llámelo al ejecutarse el script, antes de cualquier `await`, nunca en un manejador de eventos ni
 * en una expresión de la plantilla. Fuera del script de un componente devuelve un ID único que no
 * coincide entre servidor y navegador. Todos los IDs empiezan por el prefijo de la aplicación
 * (`document.idPrefix` de `meeko.config.ts`, `m` por defecto) seguido de `-`, y sólo contienen
 * letras, números, `-` y `_`, así que sirven también en un selector CSS.
 *
 * @returns Un ID como `m-0`, `m-2_f0n3-1` o `m-h1k2…-0`.
 * @since 1.5.0
 * @example
 * ```html
 * <!-- app/components/AppSwitch.meeko -->
 * <script lang="ts">
 * const props = defineProps<{ label: string; hint?: string }>();
 * const on = defineModel<boolean>();
 * const id = useId();
 * </script>
 * <template>
 *   <input type="checkbox" role="switch" bind:id="id" bind:aria-describedby="props.hint ? `${id}-hint` : null" model="on">
 *   <label bind:for="id">{props.label}</label>
 *   <p if:when="props.hint" bind:id="`${id}-hint`">{props.hint}</p>
 * </template>
 * ```
 * @see https://github.com/meekojs/meeko/blob/main/docs/api.md#ids-estables-useid
 */
export function useId(): string {
	return nextId()
}
