import { createContext, findContext, isDryRender, provide } from "../../core/reactivity";
import { useState } from "../composables/useState";
import { THEME_STATE_KEY } from "../../shared/theme";
import type { ServerTheme, ThemeSnapshot } from "../../shared/theme";

const serverThemeKey = /*#__PURE__*/ createContext<ServerTheme>("Meeko theme");

export function provideServerTheme(theme: ServerTheme): void { provide(serverThemeKey, theme); }
export function currentServerTheme(): ServerTheme | undefined { return findContext(serverThemeKey); }
export function useServerTheme(server: ServerTheme): ServerTheme {
  if (!isDryRender()) useState<ThemeSnapshot>(THEME_STATE_KEY, () => ({ theme: server.choice, resolved: server.rendered, known: server.known }));
  return server;
}
