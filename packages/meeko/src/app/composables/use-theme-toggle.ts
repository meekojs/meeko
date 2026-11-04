import type { ReadonlySignal } from '../../core/reactivity'
import type { ThemeState, ThemeToggleContext, ThemeToggleState } from '../../shared/theme'

import { themeChoices } from '../../shared/theme'
import { browserTheme } from '../runtime/theme-browser'
import { currentServerTheme, useServerTheme } from '../runtime/theme-context'

function constant<T>(value: T): ReadonlySignal<T> {
	return Object.freeze({
		get value() {
			return value
		},
	})
}

/**
 * What `<MeekoThemeToggle>` reads, like {@link useTheme}; without `theme` it fails with MEEK111.
 * Internal: the public API is {@link useThemeToggle}.
 */
export function useThemeToggleContext(): ThemeToggleContext {
	const server = currentServerTheme()
	if (server) {
		useServerTheme(server)
		return { state: server.state, config: server.config, known: constant(server.known), interactive: constant(false) }
	}
	const theme = browserTheme()
	if (!theme) throw new Error('MEEK111: <MeekoThemeToggle> necesita theme en meeko.config.ts (theme: true) y una aplicación de Meeko en marcha')
	theme.use()
	return theme.toggle
}

/**
 * Devuelve lo que necesita un selector de tema propio, como `<UIThemeToggle>` de `@meekojs/ui`:
 * el estado de {@link useTheme}, las elecciones de la configuración en orden, los temas de
 * `"system"` y si el render conoce la elección del usuario y ya responde en el navegador. Necesita
 * `theme` en `meeko.config.ts` y se llama mientras se ejecuta el script de un componente.
 *
 * Para cambiar el tema sin JavaScript, el selector envía un `<form method="post"
 * action="/_meeko/theme">` con `theme` (la elección) y `return` (la URL actual). Para que el icono
 * correcto aparezca desde el primer frame, marque cada icono con `data-meeko-theme-icon` y la
 * elección que representa: la regla que añade `theme` a `<head>` oculta los demás.
 *
 * @returns El estado del selector, compartido por toda la aplicación.
 * @throws {Error} MEEK111 sin `theme` en la configuración o fuera de una aplicación de Meeko.
 * @since 1.8.0
 * @example
 * ```html
 * <script lang="ts">
 * import { useThemeToggle } from "@meekojs/meeko/framework";
 *
 * const toggle = useThemeToggle();
 * const next = computed(() => {
 *   const index = toggle.choices.indexOf(toggle.theme.theme.value);
 *   return toggle.choices[(index + 1) % toggle.choices.length];
 * });
 * </script>
 * <template>
 *   <form method="post" action="/_meeko/theme" on:submit="(event) => { event.preventDefault(); toggle.theme.set(next.value); }">
 *     <input type="hidden" name="theme" bind:value="next.value">
 *     <button type="submit">Cambiar tema</button>
 *   </form>
 * </template>
 * ```
 * @see https://github.com/meekojs/meeko/blob/main/docs/framework.md#selector-de-tema-propio
 */
export function useThemeToggle(): ThemeToggleState {
	const context = useThemeToggleContext()
	const { system } = context.config
	return Object.freeze({
		theme: context.state as unknown as ThemeState,
		choices: Object.freeze(themeChoices(context.config)) as ThemeToggleState['choices'],
		system: system ? (Object.freeze({ light: system.light, dark: system.dark }) as ThemeToggleState['system']) : undefined,
		known: context.known,
		interactive: context.interactive,
	})
}
