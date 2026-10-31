import type { ResolvedThemeConfig, ThemeToggleContext, ThemeToggleItem, ThemeToggleMessages, ThemeToggleOptions, ThemeToggleStatus } from "./theme";

import { isThemeChoice, themeChoices } from "./theme";

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
