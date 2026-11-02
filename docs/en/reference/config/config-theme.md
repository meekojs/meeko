---
title: theme
group: config
since: 1.4.0
description: Flicker-free light, dark or custom application themes, with the choice in a cookie, the theme on html from the first byte and useTheme in components.
symbols:
  - "config:theme"
types:
  - "@meekojs/meeko/framework#ThemeConfig"
related:
  - "@meekojs/meeko/framework#useTheme"
  - "syntax:meekothemetoggle"
  - "config:document"
  - docs/framework.md#tema-clarooscuro-sin-parpadeo
source-hash: cf2795dc954559f4e0f1a91c04e395d1c7ea01173218488e9b5943c74c1e8f9c
---

`theme` enables Meeko's light/dark theme (and custom themes). The user's choice is stored in a cookie; the server writes the theme to `<html>` from the first byte, and when it cannot know it (a prerendered page, the `static` adapter, `"system"` mode without a client hint), a minimal blocking script in `<head>` applies it before the first render. Components read and change the theme with `useTheme()` and `<MeekoThemeToggle>`.

Without `theme`, nothing changes: no script, cookie, headers or `POST /_meeko/theme`.

## Usage

```ts
// meeko.config.ts
import { defineMeekoConfig } from "@meekojs/meeko/framework";

export default defineMeekoConfig({
  theme: true, // light y dark, "system" por defecto, data-theme y la cookie meeko-theme
});
```

```css
/* app/styles/main.css */
:root { color-scheme: light; --bg: #fff; --ink: #111; }
:root[data-theme="dark"] { color-scheme: dark; --bg: #111; --ink: #eee; }
@media (prefers-color-scheme: dark) {
  :root:not([data-theme]) { color-scheme: dark; --bg: #111; --ink: #eee; }
}
```

## Options

`theme` accepts `true` (the defaults) or an object:

| Option        | Type                         | Default                                             | Description                                                                                                                                     |
| ------------- | ---------------------------- | --------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------- |
| `themes`      | `readonly string[]`          | `["light", "dark"]`                                 | Themes: letters, digits, `-` or `_`, and not `"system"`.                                                                                        |
| `default`     | `string`                     | `"system"`, or the first theme with `system: false` | The choice for users who have not chosen yet.                                                                                                   |
| `system`      | `boolean \| { light, dark }` | `true`                                              | The `"system"` mode, which follows `prefers-color-scheme`. `true` uses `light` and `dark`; an object chooses other themes; `false` disables it. |
| `darkThemes`  | `readonly string[]`          | the dark theme from `system`, or `dark`             | Themes that receive `color-scheme: dark`.                                                                                                       |
| `attribute`   | `"class" \| "data-…"`        | `"data-theme"`                                      | Where the theme goes on `<html>`: a `data-*` attribute or the name as a class.                                                                  |
| `colorScheme` | `boolean`                    | `true`                                              | Applies `color-scheme` to `<html>` through CSSOM.                                                                                               |
| `cookie`      | `string`                     | `"meeko-theme"`                                     | The choice cookie.                                                                                                                              |
| `storageKey`  | `string \| false`            | the value of `cookie`                               | The `localStorage` key that notifies other tabs; `false` uses only the cookie.                                                                  |
| `clientHints` | `boolean`                    | `true`                                              | Requests and reads `Sec-CH-Prefers-Color-Scheme` to resolve `"system"` on the server.                                                           |

## Result

| Case                                                 | Who sets the theme on `<html>`                           |
| ---------------------------------------------------- | -------------------------------------------------------- |
| SSR with the cookie                                  | The server, from the first byte.                         |
| SSR in `"system"` with the client hint (Chromium)    | The server.                                              |
| SSR in `"system"` without the hint (Firefox, Safari) | The `<head>` script, before the first render.            |
| Prerendered page or `static` adapter                 | The `<head>` script, using the cookie or `localStorage`. |

SSR responses carry `Accept-CH: Sec-CH-Prefers-Color-Scheme` (and `Critical-CH` in `"system"`) and `Vary: Cookie, Sec-CH-Prefers-Color-Scheme`.

## Examples

### Custom themes

```ts
import { defineMeekoConfig } from "@meekojs/meeko/framework";

export default defineMeekoConfig({
  theme: { themes: ["day", "night", "sepia"], system: { light: "day", dark: "night" }, darkThemes: ["night"], attribute: "class" },
});
```

### A theme selector

```html
<!-- app/components/ThemePicker.meeko -->
<script lang="ts">
const { theme } = useTheme();
</script>

<template>
  <select model="theme">
    <option value="system">Sistema</option>
    <option value="light">Claro</option>
    <option value="dark">Oscuro</option>
  </select>
</template>
```

Or, without writing anything, `<MeekoThemeToggle />`, which also works without JavaScript through a form.

### One cookie per application in development

```ts
import { defineMeekoConfig } from "@meekojs/meeko/framework";

// Las cookies son por host, no por puerto: dos apps en localhost compartirían meeko-theme.
export default defineMeekoConfig({ theme: { cookie: "tienda-theme" } });
```

## Common mistakes

### Custom themes with `system` enabled

```ts bad
export default defineMeekoConfig({ theme: { themes: ["sepia", "dark"] } });
```

`meeko dev`, `meeko build`, `meeko check` and `meeko routes` stop with `…/meeko.config.ts: theme: system necesita los temas "light" y "dark"; asigne otros nombres con system: { light, dark } o desactívelo con system: false`.

```ts good
import { defineMeekoConfig } from "@meekojs/meeko/framework";
export default defineMeekoConfig({ theme: { themes: ["sepia", "dark"], system: false } });
```

### A `default` not in `themes`

```ts bad
export default defineMeekoConfig({ theme: { default: "sepia" } });
```

`…/meeko.config.ts: theme: default debe ser uno de los temas de themes (light, dark)`.

```ts good
import { defineMeekoConfig } from "@meekojs/meeko/framework";
export default defineMeekoConfig({ theme: { themes: ["light", "dark", "sepia"], default: "sepia" } });
```

### The theme in `document`

```ts bad
export default defineMeekoConfig({ document: { theme: { themes: ["light", "dark"] } } as never });
```

`…/meeko.config.ts: document.theme no es una opción de meeko.config.ts; use theme en el nivel superior`.

```ts good
import { defineMeekoConfig } from "@meekojs/meeko/framework";
export default defineMeekoConfig({ theme: true });
```

### `<MeekoThemeToggle>` without `theme`

```html bad
<!-- sin theme en meeko.config.ts -->
<template><MeekoThemeToggle /></template>
```

`meeko check` reports `MEEK111` and, at runtime, the component throws `MEEK111: <MeekoThemeToggle> necesita theme en meeko.config.ts (theme: true) y una aplicación de Meeko en marcha`.

```ts good
import { defineMeekoConfig } from "@meekojs/meeko/framework";
export default defineMeekoConfig({ theme: true });
```

## Notes

- **CSP.** In SSR, the script and icon `<style>` carry the nonce (from `DocumentOptions.nonce` or, since `1.7`, generated by Meeko with `server.contentSecurityPolicy`); on prerendered and `static` pages, their hashes enter the CSP. `color-scheme` is applied through CSSOM, which a CSP without `'unsafe-inline'` in `style-src` permits.
- **Security.** The server only accepts a theme from `themes` (or `"system"`) in the cookie; any other value is ignored and never written to the HTML. The cookie is not `HttpOnly` and contains nothing private.
- **Cache.** SSR responses vary by cookie: a CDN caching them must include the theme cookie in the key, or it will serve one user's theme to another. Prerendered pages do not vary by theme.
- **Hydration.** The browser hydrates with server values and applies its own afterward, before `onMounted`: there is never a mismatch.
- **Before `1.4`.** If `theme` held options for a module with `configKey: "theme"`, the error explains it: give the module a different `configKey` (see `docs/migration-1.4.md`).
