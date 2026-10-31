import type { ReadonlySignal, Signal } from "../../core/reactivity";
import type { ResolvedThemeConfig, ThemeHead, ThemeSnapshot, ThemeState, ThemeToggleContext } from "../../shared/theme";

import { batch, computed, createRoot, effect, markExternalSignal, signal, untrack } from "../../core/reactivity";
import { isThemeChoice, readCookie, resolveChoice } from "../../shared/theme";
import { currentBrowser } from "../composables/useStorage";
import { afterMountBatch, setupPhase } from "./lifecycle";

function snapshotOf(config: ResolvedThemeConfig, value: unknown): ThemeSnapshot | undefined {
  if (typeof value !== "object" || value === null) return undefined;
  const { theme, resolved, known } = value as Record<string, unknown>;
  return isThemeChoice(config, theme) && typeof resolved === "string" && config.themes.includes(resolved) ? { theme, resolved, known: known !== false } : undefined;
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

export function browserTheme(): BrowserTheme | undefined {
  const browser = currentBrowser();
  return browser ? browserThemes.get(browser) : undefined;
}
