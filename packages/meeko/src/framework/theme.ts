/**
 * The light/dark (and custom) theme of a Meeko application, without a flash on load.
 *
 * The choice lives in a cookie (and, by default, in `localStorage` too). Every server render reads
 * the cookie, and in `system` mode the `Sec-CH-Prefers-Color-Scheme` client hint, so `<html>`
 * carries the theme from the first byte and `useTheme()` renders the same icons the browser will
 * keep. When the server cannot know the theme (a prerendered page, a static host, or `system`
 * without the hint), a small blocking script in `<head>` applies it before the first paint; its
 * hash enters the CSP of prerendered pages and it carries the nonce in SSR, like any `useHead`
 * script.
 *
 * Hydration renders what the server rendered (its values travel in the page state); the browser's
 * own values arrive once the hydration batch ends, before `onMounted`, as with `useStorage`.
 */
import type { GeneratedTheme } from "../framework.js";
import { afterMountBatch, setupPhase } from "../lifecycle.js";
import { batch, computed, createContext, createRoot, effect, findContext, isDryRender, markExternalSignal, provide, signal, untrack } from "../reactivity.js";
import type { ReadonlySignal, Signal } from "../reactivity.js";
import { useState } from "./state.js";
import { currentBrowser } from "./storage.js";

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
  if (value !== true && (typeof value !== "object" || value === null || Array.isArray(value))) fail(label, "must be true, false or an object");
  const options = (value === true ? {} : value) as Record<string, unknown>;
  const known = ["themes", "default", "system", "darkThemes", "attribute", "colorScheme", "cookie", "storageKey", "clientHints"];
  for (const name of Object.keys(options)) if (!known.includes(name)) fail(label, `unknown field ${name}`);
  const names = (raw: unknown, field: string): string[] => {
    if (!Array.isArray(raw) || raw.some((entry) => typeof entry !== "string")) fail(label, `${field} must be an array of theme names`);
    for (const entry of raw as string[]) {
      if (!themeName.test(entry) || entry === "system") fail(label, `${field} has an invalid theme name ${JSON.stringify(entry)}: use letters, digits, - or _, and not "system"`);
    }
    return [...raw as string[]];
  };
  const themes = options.themes === undefined ? [...defaults.themes] : names(options.themes, "themes");
  if (!themes.length) fail(label, "themes must name at least one theme");
  if (new Set(themes).size !== themes.length) fail(label, "themes has repeated names");
  const member = (entry: unknown, field: string): string => {
    if (typeof entry !== "string" || !themes.includes(entry)) fail(label, `${field} must be one of themes (${themes.join(", ")})`);
    return entry;
  };
  let system: ResolvedThemeConfig["system"];
  if (options.system === false) system = false;
  else if (options.system === undefined || options.system === true) {
    if (!themes.includes("light") || !themes.includes("dark")) {
      fail(label, 'system needs the themes "light" and "dark"; map other names with system: { light, dark } or turn it off with system: false');
    }
    system = { light: "light", dark: "dark" };
  } else if (typeof options.system === "object" && options.system !== null && !Array.isArray(options.system)) {
    const pair = options.system as Record<string, unknown>;
    for (const name of Object.keys(pair)) if (name !== "light" && name !== "dark") fail(label, `unknown field system.${name}`);
    system = { light: member(pair.light, "system.light"), dark: member(pair.dark, "system.dark") };
  } else fail(label, "system must be a boolean or { light, dark }");
  const fallback = system ? "system" : themes[0]!;
  const choice = options.default === undefined ? fallback
    : options.default === "system" ? (system ? "system" : fail(label, 'default cannot be "system" with system: false'))
      : member(options.default, "default");
  const darkThemes = options.darkThemes === undefined
    ? system ? [system.dark] : themes.filter((entry) => entry === "dark")
    : names(options.darkThemes, "darkThemes").map((entry) => member(entry, "darkThemes"));
  const attribute = options.attribute ?? defaults.attribute;
  if (attribute !== "class" && (typeof attribute !== "string" || !dataAttribute.test(attribute))) {
    fail(label, 'attribute must be "class" or a lowercase data-* attribute such as "data-theme"');
  }
  if (attribute === THEME_CHOICE_ATTRIBUTE) fail(label, `attribute cannot be ${THEME_CHOICE_ATTRIBUTE}: Meeko writes the choice there`);
  const cookie = options.cookie ?? defaults.cookie;
  if (typeof cookie !== "string" || !cookieName.test(cookie)) fail(label, "cookie must be a cookie name (letters, digits and !#$%&'*+.^_`|~-)");
  const storageKey = options.storageKey ?? cookie;
  if (storageKey !== false && (typeof storageKey !== "string" || !storageKey)) fail(label, "storageKey must be a nonempty string or false");
  for (const field of ["colorScheme", "clientHints"] as const) {
    if (options[field] !== undefined && typeof options[field] !== "boolean") fail(label, `${field} must be a boolean`);
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

/**
 * In `"class"` mode, switches the theme class of `<html>` with `classList`, as the inline script
 * does: it removes the classes of the other themes and adds the resolved one, and leaves every
 * other class as it is.
 */
export function applyThemeClass(element: Element, theme: DocumentTheme | undefined): void {
  if (theme?.config.attribute !== "class" || theme.resolved === undefined) return;
  const classes = element.classList;
  for (const name of theme.config.themes) if (name !== theme.resolved && classes.contains(name)) classes.remove(name);
  if (!classes.contains(theme.resolved)) classes.add(theme.resolved);
}

/** Sets `color-scheme` of `<html>` through CSSOM, as the inline script does; CSP allows it. */
export function applyColorScheme(element: Element, theme: DocumentTheme | undefined): void {
  if (!theme?.config.colorScheme || theme.resolved === undefined) return;
  const style = (element as HTMLElement).style as CSSStyleDeclaration | undefined;
  if (!style) return;
  const scheme = theme.config.darkThemes.includes(theme.resolved) ? "dark" : "light";
  if (style.getPropertyValue("color-scheme") !== scheme) style.setProperty("color-scheme", scheme);
}

/** The value of the cookie `name` in a `Cookie` header, or `undefined`. */
function readCookie(header: string | null, name: string): string | undefined {
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

/** The value of `Sec-CH-Prefers-Color-Scheme` (a structured-field string), or `undefined`. */
function readPreferenceHint(header: string | null): "light" | "dark" | undefined {
  const value = header?.trim().replace(/^"(.*)"$/, "$1").toLowerCase();
  return value === "light" || value === "dark" ? value : undefined;
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

const serverThemeKey = /*#__PURE__*/ createContext<ServerTheme>("Meeko theme");

/** Makes the theme of a server request available to the components of a render root. */
export function provideServerTheme(theme: ServerTheme): void {
  provide(serverThemeKey, theme);
}

/** What `BrowserHead` needs from the theme: the attributes it writes on `<html>`. */
export interface ThemeHead {
  setTheme(theme: DocumentTheme | undefined): void;
}

/** What the server rendered, as the page state carries it to hydration. */
interface ThemeSnapshot {
  readonly theme: string;
  readonly resolved: string;
  /** Whether the server knew the choice (the cookie); `<MeekoThemeToggle>` names it only then. */
  readonly known: boolean;
}

/** What the server rendered, from the page state; `undefined` when no component read the theme. */
function snapshotOf(config: ResolvedThemeConfig, value: unknown): ThemeSnapshot | undefined {
  if (typeof value !== "object" || value === null) return undefined;
  const { theme, resolved, known } = value as Record<string, unknown>;
  return isThemeChoice(config, theme) && typeof resolved === "string" && config.themes.includes(resolved) ? { theme, resolved, known: known !== false } : undefined;
}

/**
 * What `<MeekoThemeToggle>` reads besides {@link useTheme}: the configuration and whether the
 * render knows the user's choice and runs in an interactive browser.
 */
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

/** A value that never changes, for what a server render knows. */
function constant<T>(value: T): ReadonlySignal<T> {
  return Object.freeze({ get value() { return value; } });
}

const year = 60 * 60 * 24 * 365;

/** The theme of a mounted browser application. */
export class BrowserTheme {
  readonly state: ThemeState<string, string>;
  /** What `<MeekoThemeToggle>` reads. */
  readonly toggle: ThemeToggleContext;
  private readonly choice: Signal<string>;
  private readonly preference: Signal<"light" | "dark">;
  private readonly live: Signal<boolean>;
  /** The real choice before hydration ends: the cookie, `localStorage` or the default. */
  private stored: string;
  private applying = false;
  private readonly release: () => void;
  private readonly head: ThemeHead;

  constructor(private readonly browser: Window, private readonly config: ResolvedThemeConfig, head: ThemeHead, snapshot: unknown) {
    this.stored = this.readStored();
    const server = snapshotOf(config, snapshot);
    const media = this.media();
    this.preference = signal(media?.matches ? "dark" : "light");
    // Hydration renders what the server rendered; `settle` switches to the real values.
    this.live = signal(server === undefined);
    this.choice = signal(server?.theme ?? this.stored);
    markExternalSignal(this.choice as Signal<unknown>);
    const descriptor = Object.getOwnPropertyDescriptor(this.choice, "value")!;
    const read = descriptor.get!;
    const write = descriptor.set!;
    Object.defineProperty(this.choice, "value", {
      get: read,
      // An arrow keeps `this`: the setter runs with the signal as receiver.
      set: (next: unknown) => {
        if (this.applying) { write.call(this.choice, next); return; }
        if (!isThemeChoice(config, next)) {
          throw new TypeError(`useTheme(): unknown theme ${JSON.stringify(next)}; use ${[...config.system ? ["system"] : [], ...config.themes].map((entry) => JSON.stringify(entry)).join(", ")}`);
        }
        batch(() => {
          this.live.value = true;
          write.call(this.choice, next);
        });
        this.stored = next;
        this.persist(next);
      },
      enumerable: descriptor.enumerable ?? true,
      configurable: true,
    });
    this.head = head;
    let resolved!: ReadonlySignal<string>;
    let known!: ReadonlySignal<boolean>;
    const releaseRoot = createRoot((dispose) => {
      resolved = computed(() => this.live.value
        ? resolveChoice(config, this.choice.value, this.preference.value)
        : server!.resolved);
      known = computed(() => this.live.value || server!.known);
      // `<html>` always shows the real theme, also while hydration renders the server's values.
      effect(() => {
        const current = this.live.value ? this.choice.value : this.stored;
        this.head.setTheme({ config, resolved: resolveChoice(config, current, this.preference.value), knownChoice: current });
      });
      return dispose;
    });
    this.state = Object.freeze({
      theme: this.choice, resolved, themes: config.themes,
      set: (theme: string) => { this.choice.value = theme; },
    });
    this.toggle = Object.freeze({ state: this.state, config, known, interactive: this.live });
    const onPreference = (event: MediaQueryListEvent): void => { this.preference.value = event.matches ? "dark" : "light"; };
    const onStorage = (event: StorageEvent): void => {
      if (config.storageKey === false || event.key !== config.storageKey || !isThemeChoice(config, event.newValue)) return;
      this.stored = event.newValue;
      if (!untrack(() => this.live.value)) return;
      this.applying = true;
      try { this.choice.value = event.newValue; }
      finally { this.applying = false; }
    };
    media?.addEventListener?.("change", onPreference);
    browser.addEventListener("storage", onStorage);
    this.release = () => {
      media?.removeEventListener?.("change", onPreference);
      browser.removeEventListener("storage", onStorage);
      releaseRoot();
    };
    // A choice that only `localStorage` remembers (an expired cookie) reaches the server again.
    const cookie = readCookie(this.cookieHeader(), config.cookie);
    if (!isThemeChoice(config, cookie) && this.storedValue() !== undefined) this.writeCookie(this.stored);
    // The cookie wins, and one that the server wrote (`<MeekoThemeToggle>` without JavaScript)
    // reaches `localStorage` and the other tabs, which would otherwise keep an older choice.
    else if (isThemeChoice(config, cookie) && config.storageKey !== false && this.storedValue() !== cookie) {
      try { this.browser.localStorage.setItem(config.storageKey, cookie); }
      catch { /* Blocked or full storage: the cookie still remembers the choice. */ }
    }
  }

  /** The browser's own values replace those of the server render, once hydration ends. */
  settle(): void {
    if (untrack(() => this.live.value)) return;
    batch(() => {
      this.applying = true;
      try { this.choice.value = this.stored; }
      finally { this.applying = false; }
      this.live.value = true;
    });
  }

  /** The state for a component script; during hydration it settles once the batch ends. */
  use(): ThemeState<string, string> {
    if (setupPhase() === "mount" && !untrack(() => this.live.value)) afterMountBatch(() => this.settle());
    return this.state;
  }

  dispose(): void {
    this.release();
  }

  private media(): MediaQueryList | undefined {
    try { return this.browser.matchMedia?.("(prefers-color-scheme: dark)") ?? undefined; }
    catch { return undefined; }
  }

  private cookieHeader(): string | null {
    try { return this.browser.document.cookie; }
    catch { return null; }
  }

  private storedValue(): string | undefined {
    if (this.config.storageKey === false) return undefined;
    try {
      const value = this.browser.localStorage.getItem(this.config.storageKey);
      return isThemeChoice(this.config, value) ? value : undefined;
    } catch { return undefined; }
  }

  /** The cookie, then `localStorage`, then the default; the same order as the inline script. */
  private readStored(): string {
    const cookie = readCookie(this.cookieHeader(), this.config.cookie);
    if (isThemeChoice(this.config, cookie)) return cookie;
    return this.storedValue() ?? this.config.default;
  }

  private writeCookie(value: string): void {
    const secure = this.browser.location.protocol === "https:" ? "; Secure" : "";
    try { this.browser.document.cookie = `${this.config.cookie}=${encodeURIComponent(value)}; Path=/; Max-Age=${year}; SameSite=Lax${secure}`; }
    catch { /* A sandboxed document without cookies keeps the choice for this page. */ }
  }

  private persist(value: string): void {
    this.writeCookie(value);
    if (this.config.storageKey === false) return;
    try { this.browser.localStorage.setItem(this.config.storageKey, value); }
    catch { /* Blocked or full storage: the cookie still remembers the choice. */ }
  }
}

/** One theme per browser window, the one `mountClientApp` created. */
const browserThemes = new WeakMap<object, BrowserTheme>();

/** Registers the theme of a mounted application; the returned function releases it. */
export function registerBrowserTheme(browser: Window, theme: BrowserTheme): () => void {
  browserThemes.set(browser, theme);
  return () => {
    if (browserThemes.get(browser) === theme) browserThemes.delete(browser);
    theme.dispose();
  };
}

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
  const server = findContext(serverThemeKey);
  if (server) return useServerTheme(server).state as unknown as ThemeState;
  const theme = browserTheme();
  if (!theme) throw new Error('useTheme() needs theme in meeko.config.ts (theme: true) and a running Meeko application');
  return theme.use() as unknown as ThemeState;
}

/** The theme of the server render; hydration renders what it shows, so its values travel in the page state. */
function useServerTheme(server: ServerTheme): ServerTheme {
  if (!isDryRender()) useState<ThemeSnapshot>(THEME_STATE_KEY, () => ({ theme: server.choice, resolved: server.rendered, known: server.known }));
  return server;
}

function browserTheme(): BrowserTheme | undefined {
  const browser = currentBrowser();
  return browser ? browserThemes.get(browser) : undefined;
}

/**
 * What `<MeekoThemeToggle>` reads, like {@link useTheme}; without `theme` it fails with MEEK111.
 * Only for the built-in component.
 */
export function useThemeToggle(): ThemeToggleContext {
  const server = findContext(serverThemeKey);
  if (server) {
    useServerTheme(server);
    return { state: server.state, config: server.config, known: constant(server.known), interactive: constant(false) };
  }
  const theme = browserTheme();
  if (!theme) throw new Error("MEEK111: <MeekoThemeToggle> necesita theme en meeko.config.ts (theme: true) y una aplicación de Meeko en marcha");
  theme.use();
  return theme.toggle;
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

const defaultLabels: Readonly<Record<string, string>> = { light: "Claro", dark: "Oscuro", system: "Sistema" };

const lower = (label: string): string => label.toLocaleLowerCase("es");

const labelOf = (options: ThemeToggleOptions, name: string): string => options.labels?.[name] ?? defaultLabels[name] ?? name;

/** The `mode` of `<MeekoThemeToggle>`: `"cycle"` by default. */
export function themeToggleMode(mode: string | undefined): "cycle" | "select" {
  if (mode === undefined) return "cycle";
  if (mode !== "cycle" && mode !== "select") throw new TypeError(`<MeekoThemeToggle>: mode must be "cycle" or "select", not ${JSON.stringify(mode)}`);
  return mode;
}

/**
 * The choices of `<MeekoThemeToggle>`: `themes` (validated) or every choice of the configuration.
 * `previous` comes back when it paints the same choices: `bind:themes="['light', 'dark']"` is a new
 * array on every read of the props (the end of hydration reads them again), and a new list would
 * write every row again.
 */
export function themeToggleItems(config: ResolvedThemeConfig, options: ThemeToggleOptions, previous?: readonly ThemeToggleItem[]): readonly ThemeToggleItem[] {
  const items = themeToggleList(config, options);
  const same = previous?.length === items.length && items.every((item, index) => {
    const before = previous[index]!;
    return before.name === item.name && before.label === item.label && before.icon === item.icon;
  });
  return same ? previous! : items;
}

function themeToggleList(config: ResolvedThemeConfig, options: ThemeToggleOptions): ThemeToggleItem[] {
  const list = options.themes === undefined ? themeChoices(config) : [...new Set(options.themes)];
  for (const name of list) {
    if (!isThemeChoice(config, name)) throw new TypeError(`<MeekoThemeToggle>: themes has an unknown theme ${JSON.stringify(name)}; use ${themeChoices(config).map((entry) => JSON.stringify(entry)).join(", ")}`);
  }
  if (!list.length) throw new TypeError("<MeekoThemeToggle>: themes must name at least one theme");
  const system = config.system && !list.includes("system") ? config.system : undefined;
  return list.map((name): ThemeToggleItem => ({
    name, label: labelOf(options, name),
    icon: [name, ...system?.light === name ? ["system-light"] : [], ...system?.dark === name ? ["system-dark"] : []].join(" "),
  }));
}

/** What `<MeekoThemeToggle>` says about the current theme; see {@link ThemeToggleStatus}. */
export function themeToggleStatus(toggle: ThemeToggleContext, items: readonly ThemeToggleItem[], options: ThemeToggleOptions): ThemeToggleStatus {
  const list = items.map((item) => item.name);
  const choice = toggle.state.theme.value;
  const known = toggle.known.value;
  // A choice outside the list (`"system"` in a light/dark toggle) moves on from the theme it shows.
  let index = list.indexOf(choice);
  if (index < 0) index = list.indexOf(toggle.state.resolved.value);
  const next = list[(index + 1) % list.length]!;
  const messages = options.messages;
  const label = !known ? messages?.unknown ?? "Cambiar tema"
    : messages?.cycle ? messages.cycle(labelOf(options, choice), labelOf(options, next))
      : `Tema: ${lower(labelOf(options, choice))}. Cambiar a ${lower(labelOf(options, next))}`;
  const checked = known && list.includes(choice) ? choice : undefined;
  return { next, label, checked, focused: toggle.interactive.value ? checked ?? list[0] : undefined };
}

/** `aria-label` of the radio group of `<MeekoThemeToggle>`. */
export function themeToggleGroupLabel(messages: ThemeToggleMessages | undefined): string {
  return messages?.group ?? "Tema";
}

/**
 * The radio that an arrow key, `Home` or `End` moves to in the radio group of `<MeekoThemeToggle>`,
 * as the ARIA radio group pattern does; `undefined` for any other key.
 */
export function themeToggleKeyTarget(key: string, current: number, count: number): number | undefined {
  if (count <= 0) return undefined;
  if (key === "ArrowRight" || key === "ArrowDown") return (current + 1) % count;
  if (key === "ArrowLeft" || key === "ArrowUp") return (current - 1 + count) % count;
  if (key === "Home") return 0;
  if (key === "End") return count - 1;
  return undefined;
}
