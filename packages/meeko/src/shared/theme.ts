import type { ReadonlySignal, Signal } from "../core/reactivity";
import type { GeneratedTheme } from "../framework";

/**
 * Opciones de `theme` en `meeko.config.ts`. Todas son opcionales; `theme: true` usa los valores
 * por defecto: temas `light` y `dark`, `"system"` por defecto, atributo `data-theme` y cookie
 * `meeko-theme`.
 *
 * @since 1.4.0
 * @example
 * ```ts
 * // meeko.config.ts
 * import { defineMeekoConfig } from "@meekojs/meeko/framework";
 *
 * export default defineMeekoConfig({
 *   theme: {
 *     themes: ["light", "dark", "sepia"],
 *     default: "system",
 *     darkThemes: ["dark"],
 *     attribute: "data-theme",
 *   },
 * });
 * ```
 * @see https://github.com/meekojs/meeko/blob/main/docs/framework.md#tema-clarooscuro-sin-parpadeo
 */
export interface ThemeConfig {
  /**
   * Temas disponibles, como `["light", "dark", "sepia"]`. Cada nombre usa letras, dígitos, `-` o
   * `_` y no puede ser `"system"`. Por defecto, `["light", "dark"]`.
   */
  readonly themes?: readonly string[];
  /**
   * Elección de quien todavía no eligió: `"system"` (por defecto si `system` está activo) o uno de
   * `themes` (por defecto, el primero si `system` es `false`).
   */
  readonly default?: string;
  /**
   * Modo `"system"`, que sigue a `prefers-color-scheme`: `true` (por defecto) usa los temas
   * `light` y `dark`; un objeto elige qué tema corresponde a cada preferencia; `false` lo
   * desactiva.
   */
  readonly system?: boolean | { readonly light: string; readonly dark: string };
  /**
   * Temas oscuros, que reciben `color-scheme: dark`; los demás, `light`. Por defecto, el tema
   * oscuro de `system` o, sin `system`, `dark` si existe.
   */
  readonly darkThemes?: readonly string[];
  /**
   * Dónde se escribe el tema en `<html>`: un atributo `data-*` (por defecto, `"data-theme"`) o
   * `"class"`, que añade el nombre del tema a las clases.
   */
  readonly attribute?: "class" | `data-${string}`;
  /**
   * Aplica `color-scheme` a `<html>` (`light`, o `dark` en los temas de `darkThemes`) para que el
   * navegador pinte el fondo, las barras de desplazamiento y los controles con el esquema del
   * tema. Lo escriben el script de `<head>`, antes del primer pintado, y el runtime del navegador
   * por CSSOM (`style.colorScheme`), que una CSP sin `'unsafe-inline'` en `style-src` permite; el
   * HTML del servidor no lleva un atributo `style`. Por defecto, `true`. Declárelo también en su
   * CSS (`:root[data-theme="dark"] { color-scheme: dark }`) si la página debe verse bien sin
   * JavaScript.
   */
  readonly colorScheme?: boolean;
  /** Nombre de la cookie que guarda la elección. Por defecto, `"meeko-theme"`. */
  readonly cookie?: string;
  /**
   * Clave de `localStorage` que guarda también la elección y avisa a las otras pestañas. Por
   * defecto, el nombre de la cookie (`cookie`, `"meeko-theme"` si no se cambia); `false` usa sólo
   * la cookie.
   */
  readonly storageKey?: string | false;
  /**
   * Pide el client hint `Sec-CH-Prefers-Color-Scheme` (`Accept-CH`, y `Critical-CH` en modo
   * `"system"`) para resolver ese modo en el servidor desde la primera visita en Chromium. Por
   * defecto, `true`.
   */
  readonly clientHints?: boolean;
}

/** `theme` with every option decided, as the build bakes it into the document configuration. */
export interface ResolvedThemeConfig {
  readonly themes: readonly string[];
  readonly default: string;
  readonly system: false | { readonly light: string; readonly dark: string };
  readonly darkThemes: readonly string[];
  readonly attribute: "class" | `data-${string}`;
  readonly colorScheme: boolean;
  readonly cookie: string;
  readonly storageKey: string | false;
  readonly clientHints: boolean;
}

/**
 * Nombre de un tema de la aplicación: la unión de los `themes` de `meeko.config.ts` cuando
 * `meeko check` generó sus tipos (`.meeko/types/routes.d.ts`); sin ellos, `string`.
 *
 * @since 1.4.0
 * @example
 * ```ts
 * import type { ThemeName } from "@meekojs/meeko/framework";
 *
 * const icons: Record<ThemeName, string> = { light: "sol", dark: "luna" };
 * ```
 */
export type ThemeName = GeneratedTheme extends { readonly themes: infer Name extends string } ? Name : string;

/**
 * Lo que el usuario puede elegir: un {@link ThemeName} o `"system"` si el modo sistema está
 * activo.
 *
 * @since 1.4.0
 * @example
 * ```ts
 * import type { ThemeChoice } from "@meekojs/meeko/framework";
 *
 * const options: ThemeChoice[] = ["system", "light", "dark"];
 * ```
 */
export type ThemeChoice = GeneratedTheme extends { readonly choices: infer Choice extends string } ? Choice : string;

/**
 * Snippets de `<MeekoThemeToggle>`: uno opcional por elección, con el icono de esa elección
 * (`<snippet name="dark"><IconMoon /></snippet>`). Con los tipos de `meeko check`, sólo los temas
 * de la configuración y `system` si está activo; sin ellos, cualquier nombre.
 *
 * @since 1.4.0
 * @example
 * ```ts
 * import type { ThemeToggleSnippets } from "@meekojs/meeko/framework";
 *
 * type Names = keyof ThemeToggleSnippets; // "light" | "dark" | "system"
 * ```
 */
export type ThemeToggleSnippets = string extends ThemeChoice ? { readonly [name: string]: [] } : { [Choice in ThemeChoice]?: [] };

/**
 * Lo que devuelve {@link useTheme}: la elección, el tema efectivo y la lista de temas.
 *
 * @typeParam Name Nombres de los temas.
 * @typeParam Choice Elecciones posibles: los temas y, si está activo, `"system"`.
 * @since 1.4.0
 * @example
 * ```ts
 * import type { ThemeState } from "@meekojs/meeko/framework";
 *
 * function next(state: ThemeState): void {
 *   state.set(state.resolved.value === "dark" ? "light" : "dark");
 * }
 * ```
 */
export interface ThemeState<Name extends string = ThemeName, Choice extends string = ThemeChoice> {
  /**
   * Elección actual, `"system"` incluido. Es editable (sirve para `model="theme"`): asignarla
   * equivale a {@link ThemeState.set}. En el servidor es de sólo lectura.
   */
  readonly theme: Signal<Choice>;
  /**
   * Tema efectivo: la elección o, en `"system"`, el tema de `prefers-color-scheme`. En SSR, si el
   * servidor no conoce la preferencia (sin client hint), vale el tema claro de `system`.
   */
  readonly resolved: ReadonlySignal<Name>;
  /** Temas de la configuración, sin `"system"`. */
  readonly themes: readonly Name[];
  /**
   * Cambia la elección: actualiza `<html>`, `color-scheme`, la cookie y `localStorage`.
   * @throws {TypeError} Si `theme` no es un tema ni `"system"` (con el modo sistema activo).
   * @throws {Error} En el servidor.
   */
  set(theme: Choice): void;
}

/** Default theme options. */
const defaults = { themes: ["light", "dark"], attribute: "data-theme", cookie: "meeko-theme" } as const;

/** Key of the page state that carries what the server rendered, for hydration. */
export const THEME_STATE_KEY = "meeko:theme";

/**
 * Attribute of `<html>` with the user's choice (`"system"` included): the inline script always
 * writes it, and the server when the cookie tells it. `<MeekoThemeToggle>` and the user's CSS read it.
 */
export const THEME_CHOICE_ATTRIBUTE = "data-theme-choice";

/** Endpoint that changes the theme without JavaScript: the form of `<MeekoThemeToggle>` posts there. */
export const THEME_ENDPOINT = "/_meeko/theme";

const themeName = /^[A-Za-z0-9_-]+$/;
const cookieName = /^[!#$%&'*+.^_`|~0-9A-Za-z-]+$/;
const dataAttribute = /^data-[a-z0-9_.-]+$/;

function fail(label: string, message: string): never {
  throw new TypeError(`${label}: ${message}`);
}

/**
 * Validates `theme` of meeko.config.ts (or `document.theme` of a host) and decides every option;
 * `undefined` when the theme is off. A resolved configuration resolves to itself.
 */
export function resolveThemeConfig(value: unknown, label = "theme"): ResolvedThemeConfig | undefined {
  if (value === undefined || value === false) return undefined;
  if (value !== true && (typeof value !== "object" || value === null || Array.isArray(value))) fail(label, "debe ser true, false o un objeto");
  const options = (value === true ? {} : value) as Record<string, unknown>;
  const known = ["themes", "default", "system", "darkThemes", "attribute", "colorScheme", "cookie", "storageKey", "clientHints"];
  for (const name of Object.keys(options)) if (!known.includes(name)) fail(label, `campo desconocido ${name}`);
  const names = (raw: unknown, field: string): string[] => {
    if (!Array.isArray(raw) || raw.some((entry) => typeof entry !== "string")) fail(label, `${field} debe ser un array de nombres de tema`);
    for (const entry of raw as string[]) {
      if (!themeName.test(entry) || entry === "system") fail(label, `${field} tiene un nombre de tema no válido ${JSON.stringify(entry)}: use letras, dígitos, - o _, y no "system"`);
    }
    return [...raw as string[]];
  };
  const themes = options.themes === undefined ? [...defaults.themes] : names(options.themes, "themes");
  if (!themes.length) fail(label, "themes debe nombrar al menos un tema");
  if (new Set(themes).size !== themes.length) fail(label, "themes tiene nombres repetidos");
  const member = (entry: unknown, field: string): string => {
    if (typeof entry !== "string" || !themes.includes(entry)) fail(label, `${field} debe ser uno de los temas de themes (${themes.join(", ")})`);
    return entry;
  };
  let system: ResolvedThemeConfig["system"];
  if (options.system === false) system = false;
  else if (options.system === undefined || options.system === true) {
    if (!themes.includes("light") || !themes.includes("dark")) {
      fail(label, 'system necesita los temas "light" y "dark"; asigne otros nombres con system: { light, dark } o desactívelo con system: false');
    }
    system = { light: "light", dark: "dark" };
  } else if (typeof options.system === "object" && options.system !== null && !Array.isArray(options.system)) {
    const pair = options.system as Record<string, unknown>;
    for (const name of Object.keys(pair)) if (name !== "light" && name !== "dark") fail(label, `campo desconocido system.${name}`);
    system = { light: member(pair.light, "system.light"), dark: member(pair.dark, "system.dark") };
  } else fail(label, "system debe ser un booleano o { light, dark }");
  const fallback = system ? "system" : themes[0]!;
  const choice = options.default === undefined ? fallback
    : options.default === "system" ? (system ? "system" : fail(label, 'default no puede ser "system" con system: false'))
      : member(options.default, "default");
  const darkThemes = options.darkThemes === undefined
    ? system ? [system.dark] : themes.filter((entry) => entry === "dark")
    : names(options.darkThemes, "darkThemes").map((entry) => member(entry, "darkThemes"));
  const attribute = options.attribute ?? defaults.attribute;
  if (attribute !== "class" && (typeof attribute !== "string" || !dataAttribute.test(attribute))) {
    fail(label, 'attribute debe ser "class" o un atributo data-* en minúsculas, como "data-theme"');
  }
  if (attribute === THEME_CHOICE_ATTRIBUTE) fail(label, `attribute no puede ser ${THEME_CHOICE_ATTRIBUTE}: Meeko escribe ahí la elección`);
  const cookie = options.cookie ?? defaults.cookie;
  if (typeof cookie !== "string" || !cookieName.test(cookie)) fail(label, "cookie debe ser un nombre de cookie (letras, dígitos y !#$%&'*+.^_`|~-)");
  const storageKey = options.storageKey ?? cookie;
  if (storageKey !== false && (typeof storageKey !== "string" || !storageKey)) fail(label, "storageKey debe ser una cadena no vacía o false");
  for (const field of ["colorScheme", "clientHints"] as const) {
    if (options[field] !== undefined && typeof options[field] !== "boolean") fail(label, `${field} debe ser un booleano`);
  }
  return {
    themes, default: choice, system, darkThemes,
    attribute: attribute as ResolvedThemeConfig["attribute"],
    colorScheme: options.colorScheme !== false,
    cookie, storageKey: storageKey as string | false,
    clientHints: options.clientHints !== false,
  };
}

/** Whether `value` is something the user may choose: a theme, or `"system"` when it is on. */
export function isThemeChoice(config: ResolvedThemeConfig, value: unknown): value is string {
  return typeof value === "string" && (value === "system" ? config.system !== false : config.themes.includes(value));
}

/** The theme a choice shows, given the system preference. */
export function resolveChoice(config: ResolvedThemeConfig, choice: string, preference: "light" | "dark"): string {
  return choice === "system" && config.system ? config.system[preference] : choice;
}

/**
 * The inline script of `<head>`: it applies the stored choice to `<html>` before the first paint.
 * It always runs and is idempotent: where the server already wrote the theme it writes the same
 * value; on a prerendered page, a static host or `system` without the client hint it writes the
 * real one. Its text depends only on the configuration, so every page has the same CSP hash.
 */
export function themeScript(config: ResolvedThemeConfig): string {
  const json = JSON.stringify;
  const apply = config.attribute === "class"
    ? "for(i=0;i<t.length;i++)d.classList.remove(t[i]);d.classList.add(r);"
    : `d.setAttribute(${json(config.attribute)},r);`;
  const storage = config.storageKey === false ? ""
    : `if(!ok(c))try{c=localStorage.getItem(${json(config.storageKey)})}catch(x){}`;
  const scheme = config.colorScheme ? `d.style.colorScheme=${json(config.darkThemes)}.indexOf(r)<0?"light":"dark";` : "";
  return [
    `(function(){var d=document.documentElement,t=${json(config.themes)},s=${json(config.system || null)},n=${json(`${config.cookie}=`)},c,i,`,
    `p=document.cookie.split(";"),ok=function(v){return v==="system"?!!s:t.indexOf(v)>=0};`,
    `for(i=0;i<p.length;i++){var e=p[i].replace(/^\\s+/,"");if(e.indexOf(n)===0){try{c=decodeURIComponent(e.slice(n.length))}catch(x){}break}}`,
    storage,
    `if(!ok(c))c=${json(config.default)};`,
    `var m=window.matchMedia&&matchMedia("(prefers-color-scheme: dark)"),r=c==="system"?s[m&&m.matches?"dark":"light"]:c;`,
    apply, `d.setAttribute(${json(THEME_CHOICE_ATTRIBUTE)},c);`, scheme, "})()",
  ].join("");
}

/**
 * The choices of a configuration, in the order `<MeekoThemeToggle>` cycles them: the themes, then
 * `"system"` when it is on.
 */
export function themeChoices(config: ResolvedThemeConfig): string[] {
  return [...config.themes, ...config.system ? ["system"] : []];
}

/**
 * The inline `<style>` of `<head>` that `<MeekoThemeToggle>` needs: of the icons it paints (one
 * `<span data-meeko-theme-icon>` per choice), it hides all but the one of `data-theme-choice`, so
 * the icon is right from the first frame without JavaScript in the component. Without the attribute
 * (the server did not know the choice and no script ran) the default choice counts. In `"system"`, a
 * toggle without a `system` icon marks the icons of its themes `system-light` and `system-dark`, and
 * `prefers-color-scheme` picks one, as the inline script does. Only `display: none`: nothing visual.
 * Its text depends only on the configuration, so every page has the same CSP hash.
 */
export function themeStyle(config: ResolvedThemeConfig): string {
  const icon = "[data-meeko-theme-icon]";
  const root = (choice: string): string => choice === config.default
    ? `:root:is([${THEME_CHOICE_ATTRIBUTE}="${choice}"],:not([${THEME_CHOICE_ATTRIBUTE}]))`
    : `:root[${THEME_CHOICE_ATTRIBUTE}="${choice}"]`;
  const hide = (choice: string, shown: readonly string[]): string =>
    `${root(choice)} ${icon}:not(${shown.map((token) => `[data-meeko-theme-icon~="${token}"]`).join(",")}){display:none}`;
  const rules = config.themes.map((theme) => hide(theme, [theme]));
  if (config.system) {
    rules.push(
      `@media (prefers-color-scheme:light){${hide("system", ["system", "system-light"])}}`,
      `@media (prefers-color-scheme:dark){${hide("system", ["system", "system-dark"])}}`,
    );
  }
  return rules.join("\n");
}

/** The theme a document shows; `resolved` is absent when nobody knows it before the browser runs. */
export interface DocumentTheme {
  readonly config: ResolvedThemeConfig;
  readonly resolved: string | undefined;
  /**
   * The choice for `data-theme-choice`, when this render knows it: the cookie on the server, always
   * in the browser. Without it the inline script writes the attribute.
   */
  readonly knownChoice?: string | undefined;
}

/**
 * The attributes of `<html>` with the theme's: the `data-*` attribute, or the theme among the
 * classes (any other theme class removed), and `data-theme-choice`. What is not known stays as it
 * is, and the inline script applies it. `color-scheme` is not an attribute: a `style` attribute is
 * inline CSS that a CSP without `'unsafe-inline'` blocks, so the inline script and the browser
 * runtime set it through CSSOM (`style.colorScheme`), which CSP allows (see {@link applyColorScheme}).
 *
 * In the browser (`live`), the theme class only joins a `class` that `useHead` declares: otherwise
 * the class attribute is not Meeko's, other scripts add their classes to it (`js`, `wf-active`),
 * and {@link applyThemeClass} switches the theme class alone with `classList`.
 */
export function withThemeAttributes(attributes: ReadonlyMap<string, string>, theme: DocumentTheme | undefined, live = false): ReadonlyMap<string, string> {
  if (!theme || (theme.resolved === undefined && theme.knownChoice === undefined)) return attributes;
  const { config, resolved } = theme;
  const result = new Map(attributes);
  if (resolved === undefined || (live && config.attribute === "class" && !result.has("class"))) { /* The inline script or `applyThemeClass` writes the theme. */ }
  else if (config.attribute === "class") {
    const classes = (result.get("class") ?? "").split(/\s+/).filter((name) => name && !config.themes.includes(name));
    result.set("class", [...classes, resolved].join(" "));
  } else {
    result.set(config.attribute, resolved);
  }
  if (theme.knownChoice !== undefined) result.set(THEME_CHOICE_ATTRIBUTE, theme.knownChoice);
  return result;
}


export function readCookie(header: string | null, name: string): string | undefined {
  if (!header) return undefined;
  for (const part of header.split(";")) {
    const index = part.indexOf("=");
    if (index < 0 || part.slice(0, index).trim() !== name) continue;
    const raw = part.slice(index + 1).trim().replace(/^"(.*)"$/, "$1");
    try { return decodeURIComponent(raw); }
    catch { return undefined; }
  }
  return undefined;
}


export interface ThemeHead {
  setTheme(theme: DocumentTheme | undefined): void;
}

export interface ThemeSnapshot {
  readonly theme: string;
  readonly resolved: string;
  /** Whether the server knew the choice (the cookie); `<MeekoThemeToggle>` names it only then. */
  readonly known: boolean;
}

export interface ThemeToggleContext {
  readonly state: ThemeState<string, string>;
  readonly config: ResolvedThemeConfig;
  /**
   * Whether this render knows the user's choice: the server with the cookie, the browser once
   * hydration ends (hydration renders what the server rendered).
   */
  readonly known: ReadonlySignal<boolean>;
  /** Whether the toggle runs in the browser with its handlers: `false` in SSR and while hydrating. */
  readonly interactive: ReadonlySignal<boolean>;
}

/**
 * Textos accesibles de `<MeekoThemeToggle>` además de los nombres de los temas (`labels`), para
 * traducirlos. Todos son opcionales; los de por defecto están en español.
 *
 * @since 1.4.0
 * @example
 * ```html
 * <MeekoThemeToggle
 *   bind:labels="{ light: 'Light', dark: 'Dark', system: 'System' }"
 *   bind:messages="{ cycle: (current, next) => `Theme: ${current}. Switch to ${next}`, unknown: 'Switch theme', group: 'Theme' }"
 * />
 * ```
 * @see https://github.com/meekojs/meeko/blob/main/docs/framework.md#meekothemetoggle
 */
export interface ThemeToggleMessages {
  /**
   * `aria-label` del botón en `mode="cycle"`: recibe la etiqueta de la elección actual y la del
   * tema al que pasa. Por defecto, «Tema: oscuro. Cambiar a sistema» (las etiquetas, en minúscula).
   */
  readonly cycle?: (current: string, next: string) => string;
  /**
   * `aria-label` del botón cuando la página todavía no conoce la elección: el HTML de una página
   * prerenderizada o de una petición sin la cookie, hasta que termina la hidratación. Por defecto,
   * «Cambiar tema».
   */
  readonly unknown?: string;
  /** `aria-label` del grupo de radios en `mode="select"`. Por defecto, «Tema». */
  readonly group?: string;
}

/** What `<MeekoThemeToggle>` receives besides its snippets. */
export interface ThemeToggleOptions {
  readonly mode?: string | undefined;
  readonly themes?: readonly string[] | undefined;
  readonly labels?: Readonly<Record<string, string | undefined>> | undefined;
  readonly messages?: ThemeToggleMessages | undefined;
}

/** One choice of `<MeekoThemeToggle>`: what it paints, which does not depend on the current theme. */
export interface ThemeToggleItem {
  readonly name: string;
  readonly label: string;
  /**
   * Tokens of `data-meeko-theme-icon` (cycle mode): the choice and, in a list without `"system"`,
   * `system-light` or `system-dark` on the themes of `system`, which `themeStyle` shows in that mode.
   */
  readonly icon: string;
}

/**
 * What `<MeekoThemeToggle>` says about the current theme. Every field is a primitive, so a binding
 * that reads it through its own `computed` runs again only when that value changes: hydration
 * settling to the browser's values writes nothing that stayed the same.
 */
export interface ThemeToggleStatus {
  /** The choice the cycle button moves to. */
  readonly next: string;
  /** `aria-label` of the cycle button. */
  readonly label: string;
  /** The choice that `aria-checked` marks: only one this render knows. */
  readonly checked: string | undefined;
  /** The radio with `tabindex="0"`, once the browser handles the arrow keys; `undefined` before. */
  readonly focused: string | undefined;
}

/** The theme of one server request: its choice, what it shows and the state components read. */
export interface ServerTheme extends DocumentTheme {
  readonly choice: string;
  /**
   * Whether the choice comes from the cookie. Without it the choice is the default, which the
   * browser may replace (`localStorage`, a prerendered page served to everyone).
   */
  readonly known: boolean;
  /** What `useTheme().resolved` renders: the known theme, or the light theme of `system`. */
  readonly rendered: string;
  readonly state: ThemeState<string, string>;
}

