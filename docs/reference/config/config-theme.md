---
title: theme
group: config
since: 1.4.0
description: El tema claro, oscuro o propio de la aplicación sin parpadeo, con la elección en una cookie, el tema en html desde el primer byte y useTheme en los componentes.
symbols:
  - "config:theme"
types:
  - "@meekojs/meeko/framework#ThemeConfig"
related:
  - "@meekojs/meeko/framework#useTheme"
  - "syntax:meekothemetoggle"
  - "config:document"
  - docs/framework.md#tema-clarooscuro-sin-parpadeo
---

`theme` activa el tema claro/oscuro (y temas propios) de Meeko. La elección del usuario se guarda en una cookie; el servidor escribe el tema en `<html>` desde el primer byte, y cuando no puede saberlo (una página prerenderizada, el adaptador `static`, el modo `"system"` sin client hint) un script mínimo y bloqueante de `<head>` lo aplica antes del primer pintado. Los componentes leen y cambian el tema con `useTheme()` y `<MeekoThemeToggle>`.

Sin `theme`, nada cambia: ni script, ni cookie, ni cabeceras, ni `POST /_meeko/theme`.

## Uso

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

## Opciones

`theme` acepta `true` (los valores por defecto) o un objeto:

| Opción | Tipo | Por defecto | Descripción |
| --- | --- | --- | --- |
| `themes` | `readonly string[]` | `["light", "dark"]` | Los temas: letras, dígitos, `-` o `_`, y no `"system"`. |
| `default` | `string` | `"system"`, o el primer tema con `system: false` | La elección de quien todavía no eligió. |
| `system` | `boolean \| { light, dark }` | `true` | El modo `"system"`, que sigue a `prefers-color-scheme`. `true` usa `light` y `dark`; un objeto elige otros temas; `false` lo desactiva. |
| `darkThemes` | `readonly string[]` | el oscuro de `system`, o `dark` | Temas que reciben `color-scheme: dark`. |
| `attribute` | `"class" \| "data-…"` | `"data-theme"` | Dónde va el tema en `<html>`: un atributo `data-*` o el nombre como clase. |
| `colorScheme` | `boolean` | `true` | Aplica `color-scheme` a `<html>` por CSSOM. |
| `cookie` | `string` | `"meeko-theme"` | La cookie de la elección. |
| `storageKey` | `string \| false` | el valor de `cookie` | La clave de `localStorage`, que avisa a las otras pestañas; `false` usa sólo la cookie. |
| `clientHints` | `boolean` | `true` | Pide y lee `Sec-CH-Prefers-Color-Scheme` para resolver `"system"` en el servidor. |

## Resultado

| Caso | Quién pone el tema en `<html>` |
| --- | --- |
| SSR con la cookie | El servidor, desde el primer byte. |
| SSR en `"system"` con el client hint (Chromium) | El servidor. |
| SSR en `"system"` sin el hint (Firefox, Safari) | El script de `<head>`, antes del primer pintado. |
| Página prerenderizada o adaptador `static` | El script de `<head>`, con la cookie o `localStorage`. |

Las respuestas SSR llevan `Accept-CH: Sec-CH-Prefers-Color-Scheme` (y `Critical-CH` en `"system"`) y `Vary: Cookie, Sec-CH-Prefers-Color-Scheme`.

## Ejemplos

### Temas propios

```ts
import { defineMeekoConfig } from "@meekojs/meeko/framework";

export default defineMeekoConfig({
  theme: { themes: ["day", "night", "sepia"], system: { light: "day", dark: "night" }, darkThemes: ["night"], attribute: "class" },
});
```

### Un selector de tema

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

O, sin escribir nada, `<MeekoThemeToggle />`, que también funciona sin JavaScript con un formulario.

### Una cookie por aplicación en desarrollo

```ts
import { defineMeekoConfig } from "@meekojs/meeko/framework";

// Las cookies son por host, no por puerto: dos apps en localhost compartirían meeko-theme.
export default defineMeekoConfig({ theme: { cookie: "tienda-theme" } });
```

## Errores comunes

### Temas propios con `system` activo

```ts bad
export default defineMeekoConfig({ theme: { themes: ["sepia", "dark"] } });
```

`meeko dev`, `meeko build`, `meeko check` y `meeko routes` se detienen con `…/meeko.config.ts: theme: system necesita los temas "light" y "dark"; asigne otros nombres con system: { light, dark } o desactívelo con system: false`.

```ts good
import { defineMeekoConfig } from "@meekojs/meeko/framework";
export default defineMeekoConfig({ theme: { themes: ["sepia", "dark"], system: false } });
```

### Un `default` que no está en `themes`

```ts bad
export default defineMeekoConfig({ theme: { default: "sepia" } });
```

`…/meeko.config.ts: theme: default debe ser uno de los temas de themes (light, dark)`.

```ts good
import { defineMeekoConfig } from "@meekojs/meeko/framework";
export default defineMeekoConfig({ theme: { themes: ["light", "dark", "sepia"], default: "sepia" } });
```

### El tema en `document`

```ts bad
export default defineMeekoConfig({ document: { theme: { themes: ["light", "dark"] } } as never });
```

`…/meeko.config.ts: document.theme no es una opción de meeko.config.ts; use theme en el nivel superior`.

```ts good
import { defineMeekoConfig } from "@meekojs/meeko/framework";
export default defineMeekoConfig({ theme: true });
```

### `<MeekoThemeToggle>` sin `theme`

```html bad
<!-- sin theme en meeko.config.ts -->
<template><MeekoThemeToggle /></template>
```

`meeko check` da `MEEK111` y, en ejecución, el componente lanza `MEEK111: <MeekoThemeToggle> necesita theme en meeko.config.ts (theme: true) y una aplicación de Meeko en marcha`.

```ts good
import { defineMeekoConfig } from "@meekojs/meeko/framework";
export default defineMeekoConfig({ theme: true });
```

## Notas

- **CSP.** En SSR, el script y el `<style>` de los iconos llevan el nonce (el de `DocumentOptions.nonce` o, desde `1.7`, el que genera Meeko con `server.contentSecurityPolicy`); en las páginas prerenderizadas y `static`, sus hashes entran en la CSP. `color-scheme` se aplica por CSSOM, que una CSP sin `'unsafe-inline'` en `style-src` permite.
- **Seguridad.** El servidor sólo acepta en la cookie un tema de `themes` (o `"system"`); cualquier otro valor se ignora y nunca se escribe en el HTML. La cookie no es `HttpOnly` y no contiene nada privado.
- **Caché.** Las respuestas SSR varían por la cookie: un CDN que las cachee debe incluir la cookie del tema en la clave, o servirá a un usuario el tema de otro. Las páginas prerenderizadas no varían por el tema.
- **Hidratación.** El navegador hidrata con los valores del servidor y aplica los suyos al terminar, antes de `onMounted`: nunca hay un desajuste.
- **Antes de `1.4`.** Si `theme` eran las opciones de un módulo con `configKey: "theme"`, el error lo indica: dele otra `configKey` al módulo (véase `docs/migration-1.4.md`).
