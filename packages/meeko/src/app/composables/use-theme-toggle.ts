import type { ReadonlySignal } from "../../core/reactivity";
import type { ThemeToggleContext } from "../../shared/theme";

import { browserTheme } from "../runtime/theme-browser";
import { currentServerTheme, useServerTheme } from "../runtime/theme-context";

function constant<T>(value: T): ReadonlySignal<T> {
  return Object.freeze({ get value() { return value; } });
}

/**
 * What `<MeekoThemeToggle>` reads, like {@link useTheme}; without `theme` it fails with MEEK111.
 * Only for the built-in component.
 */
export function useThemeToggle(): ThemeToggleContext {
  const server = currentServerTheme();
  if (server) {
    useServerTheme(server);
    return { state: server.state, config: server.config, known: constant(server.known), interactive: constant(false) };
  }
  const theme = browserTheme();
  if (!theme) throw new Error("MEEK111: <MeekoThemeToggle> necesita theme en meeko.config.ts (theme: true) y una aplicación de Meeko en marcha");
  theme.use();
  return theme.toggle;
}
