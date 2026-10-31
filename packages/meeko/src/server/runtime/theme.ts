import type { Signal } from "../../core/reactivity";
import type { ResolvedThemeConfig, ServerTheme, ThemeState } from "../../shared/theme";

import { markExternalSignal, signal } from "../../core/reactivity";
import { isThemeChoice, readCookie, resolveChoice } from "../../shared/theme";
export { provideServerTheme } from "../../app/runtime/theme-context";

/** The value of `Sec-CH-Prefers-Color-Scheme` (a structured-field string), or `undefined`. */
function readPreferenceHint(header: string | null): "light" | "dark" | undefined {
  const value = header?.trim().replace(/^"(.*)"$/, "$1").toLowerCase();
  return value === "light" || value === "dark" ? value : undefined;
}


/**
 * Reads the theme of a request: the cookie, validated against the configuration (an unknown
 * value is ignored, never reflected), else the default; in `system` mode, the client hint.
 */
export function requestTheme(config: ResolvedThemeConfig, request: Request): ServerTheme {
  const stored = readCookie(request.headers.get("cookie"), config.cookie);
  const known = isThemeChoice(config, stored);
  const choice = known ? stored : config.default;
  let resolved: string | undefined = choice;
  if (choice === "system") {
    const hint = config.clientHints ? readPreferenceHint(request.headers.get("sec-ch-prefers-color-scheme")) : undefined;
    resolved = hint ? resolveChoice(config, choice, hint) : undefined;
  }
  const rendered = resolved ?? resolveChoice(config, choice, "light");
  const readOnly = (): never => { throw new Error("useTheme(): the theme changes in the browser, not during a server render"); };
  const theme = signal(choice);
  markExternalSignal(theme as Signal<unknown>);
  Object.defineProperty(theme, "value", { get: Object.getOwnPropertyDescriptor(theme, "value")!.get!, set: readOnly, enumerable: true, configurable: true });
  const state: ThemeState<string, string> = Object.freeze({
    theme, resolved: Object.freeze({ get value() { return rendered; } }), themes: config.themes, set: readOnly,
  });
  return { config, choice, known, resolved, ...(known ? { knownChoice: choice } : {}), rendered, state };
}

/**
 * Adds the cache and client hint headers of a server-rendered document that depends on the theme:
 * `Vary` on the cookie and the hint, `Accept-CH` and, when the choice is `system`, `Critical-CH`.
 */
export function addThemeHeaders(headers: Headers, theme: ServerTheme): void {
  const hint = "Sec-CH-Prefers-Color-Scheme";
  const vary = theme.config.clientHints ? ["Cookie", hint] : ["Cookie"];
  const present = new Set((headers.get("vary") ?? "").split(",").map((entry) => entry.trim().toLowerCase()).filter(Boolean));
  if (!present.has("*")) for (const entry of vary) if (!present.has(entry.toLowerCase())) headers.append("vary", entry);
  if (!theme.config.clientHints) return;
  headers.append("accept-ch", hint);
  if (theme.choice === "system") headers.append("critical-ch", hint);
}
