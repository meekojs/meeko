import { currentServerTheme, useServerTheme } from "../runtime/theme-context";
import { currentBrowser } from "./useStorage";
import { browserTheme } from "../runtime/theme-browser";
import type { ThemeState } from "../../shared/theme";
export type { ThemeChoice, ThemeConfig, ThemeName, ThemeState, ThemeToggleMessages, ThemeToggleSnippets } from "../../shared/theme";

/**
 * Devuelve el tema de la aplicación: `theme`, la elección (editable, `"system"` incluido),
 * `resolved`, el tema efectivo, `themes` y `set(theme)`. Necesita `theme` en `meeko.config.ts`. Se
 * autoimporta en los `.meeko` y se llama mientras se ejecuta el script de un componente.
 *
 * - En SSR lee la cookie de la petición (y, en `"system"`, el client hint
 *   `Sec-CH-Prefers-Color-Scheme`), así que el HTML del servidor ya pinta los iconos del tema. Si
 *   el servidor no conoce la preferencia del sistema, `resolved` vale el tema claro de `system`;
 *   para que nada salte, pinte los dos iconos y deje que el CSS muestre uno según el atributo de
 *   `<html>` (`data-theme` o, con la elección, `data-theme-choice`), o use `<MeekoThemeToggle>`.
 * - La hidratación pinta lo mismo que el servidor; los valores del navegador llegan al terminar la
 *   hidratación, antes de `onMounted`.
 * - Cambiar el tema (con `set` o asignando `theme.value`) actualiza `<html>`, `color-scheme`, la
 *   cookie y `localStorage`; en `"system"`, `resolved` sigue a `prefers-color-scheme`, y las otras
 *   pestañas reciben el cambio por el evento `storage`.
 *
 * @returns El estado del tema, compartido por toda la aplicación.
 * @throws {Error} Sin `theme` en la configuración o fuera de una aplicación de Meeko.
 * @since 1.4.0
 * @example
 * ```html
 * <script lang="ts">
 * const { resolved, set } = useTheme();
 * const toggle = (): void => set(resolved.value === "dark" ? "light" : "dark");
 * </script>
 * <template>
 *   <button type="button" aria-label="Tema oscuro" bind:aria-pressed="String(resolved.value === 'dark')" on:click="toggle">
 *     <span class="icon-sun" aria-hidden="true">☀</span><span class="icon-moon" aria-hidden="true">☾</span>
 *   </button>
 * </template>
 * ```
 * @see https://github.com/meekojs/meeko/blob/main/docs/framework.md#tema-clarooscuro-sin-parpadeo
 */
export function useTheme(): ThemeState {
  const server = currentServerTheme();
  if (server) return useServerTheme(server).state as unknown as ThemeState;
  const theme = browserTheme();
  if (!theme) throw new Error('useTheme() needs theme in meeko.config.ts (theme: true) and a running Meeko application');
  return theme.use() as unknown as ThemeState;
}
