import type { DocumentTheme } from "../../shared/theme.js";

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
