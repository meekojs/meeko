---
title: <MeekoThemeToggle>
group: components
since: 1.4.0
description: Selector del tema claro/oscuro que no salta al cargar, accesible y funcional sin JavaScript, con los temas de meeko.config.ts.
symbols:
  - "syntax:meekothemetoggle"
types:
  - "@meekojs/meeko/framework#MeekoThemeToggleProps"
  - "@meekojs/meeko/framework#ThemeToggleMessages"
  - "@meekojs/meeko/framework#ThemeToggleSnippets"
related:
  - "@meekojs/meeko/framework#useTheme"
  - "config:theme"
  - "syntax:meekolink"
  - docs/framework.md#meekothemetoggle
  - docs/framework.md#tema-clarooscuro-sin-parpadeo
  - docs/framework.md#iconos-que-no-saltan
---

Con `theme` en `meeko.config.ts`, `<MeekoThemeToggle>` es el selector de tema listo para usar: un botón que pasa a la elección siguiente (`mode="cycle"`) o un grupo de radios (`mode="select"`). Cada snippet (`light`, `dark`, `system` o un tema propio) es el icono de esa elección.

Pinta todos los iconos y una regla que Meeko añade a `<head>` muestra el de `data-theme-choice` de `<html>`, que el script del tema escribe antes del primer pintado: el icono nunca salta, ni siquiera en una página prerenderizada. Sin JavaScript es un `<form>` que envía `POST /_meeko/theme`. No se importa: el compilador la reconoce, y un componente del proyecto con el mismo nombre tiene prioridad (`MEEK106`).

## Uso

```ts
// meeko.config.ts
import { defineMeekoConfig } from "@meekojs/meeko/framework";

export default defineMeekoConfig({ theme: true });
```

```html
<!-- app/layouts/default.meeko -->
<template>
  <header>
    <MeekoThemeToggle class="toggle">
      <snippet name="light"><IconSun /></snippet>
      <snippet name="dark"><IconMoon /></snippet>
      <snippet name="system"><IconMonitor /></snippet>
    </MeekoThemeToggle>
  </header>
  <main><MeekoOutlet /></main>
</template>
```

El botón dice «Tema: oscuro. Cambiar a sistema» y cada clic pasa a la elección siguiente.

## Props

| Atributo | Tipo | Por defecto | Descripción |
| --- | --- | --- | --- |
| `mode` o `bind:mode` | `"cycle" \| "select"` | `"cycle"` | Un botón que pasa a la elección siguiente, o un grupo de radios que se maneja con las flechas. |
| `bind:themes` | `readonly ThemeChoice[]` | los temas y `"system"` si está activo | Las elecciones y su orden, como `bind:themes="['light', 'dark']"`. |
| `bind:labels` | `Partial<Record<ThemeChoice, string>>` | «Claro», «Oscuro», «Sistema» | El nombre de cada elección; un tema propio sin etiqueta se llama como el tema. |
| `bind:messages` | `ThemeToggleMessages` | en español | Textos accesibles: `cycle(current, next)` (el `aria-label` del botón), `unknown` («Cambiar tema») y `group` («Tema»). |
| `class`, `id` | `string` | ninguno | Del `<form>` raíz. Otros atributos no pasan: envuelve la etiqueta si los necesitas. |

Snippets: uno por elección, con su nombre (`light`, `dark`, `system`, `sepia`…), sin parámetros. Sin snippet se pinta la etiqueta de la elección. `meeko check` tipa `themes`, `labels` y los snippets con los temas de la configuración.

## Resultado

Un `<form method="post" action="/_meeko/theme">` sin estilos visuales:

- `mode="cycle"`: un `<button>` cuyo `aria-label` dice la elección y la siguiente, y que envía la siguiente. Mientras la página no conoce la elección (sin cookie, en una página prerenderizada), el `aria-label` es neutro, «Cambiar tema», hasta terminar la hidratación.
- `mode="select"`: un `role="radiogroup"` con `aria-label` («Tema») y un botón `role="radio"` por elección con `aria-checked` y `data-meeko-theme-option`.
- Cada icono va en `<span data-meeko-theme-icon="light|dark|system|…">`.

Con JavaScript, el envío se intercepta y el cambio es inmediato con `useTheme().set()`, sin navegar.

## Ejemplos

### Un grupo de radios

```html
<MeekoThemeToggle mode="select" class="theme-radios" />
```

```css
.theme-radios [role="radio"][aria-checked="true"] { font-weight: 700; }
/* Antes de hidratar, sin aria-checked, el CSS lee la elección de <html>: */
[data-theme-choice="dark"] .theme-radios [data-meeko-theme-option="dark"] { font-weight: 700; }
```

### Sólo claro y oscuro, con etiquetas propias

```html
<MeekoThemeToggle bind:themes="['light', 'dark']" bind:labels="{ light: 'Día', dark: 'Noche' }">
  <snippet name="light">☀️</snippet>
  <snippet name="dark">🌙</snippet>
</MeekoThemeToggle>
```

Sin `system` en la lista, en modo sistema se muestra el icono del tema efectivo, según `prefers-color-scheme`.

### Traducir los textos accesibles

```html
<MeekoThemeToggle bind:labels="{ light: 'Light', dark: 'Dark', system: 'System' }"
  bind:messages="{ cycle: (current, next) => `Theme: ${current}. Switch to ${next}`, unknown: 'Change theme', group: 'Theme' }" />
```

### Un tema propio

```ts
// meeko.config.ts
import { defineMeekoConfig } from "@meekojs/meeko/framework";

export default defineMeekoConfig({ theme: { themes: ["light", "dark", "sepia"] } });
```

```html
<MeekoThemeToggle>
  <snippet name="light"><IconSun /></snippet>
  <snippet name="dark"><IconMoon /></snippet>
  <snippet name="sepia"><IconBook /></snippet>
  <snippet name="system"><IconMonitor /></snippet>
</MeekoThemeToggle>
```

## Errores comunes

### Usarlo sin `theme` en la configuración

```html bad
<!-- meeko.config.ts no declara theme -->
<MeekoThemeToggle />
```

`meeko check` da `MEEK111: <MeekoThemeToggle> sólo existe con theme en meeko.config.ts: añade theme: true (o sus opciones) para usarlo`. Si `meeko check` no puede leer `theme` sin ejecutar la configuración (`theme: variable`), el componente da el mismo error al renderizarse.

<!-- no-check -->
```ts good
export default defineMeekoConfig({ theme: true });
```

### Un `mode` que no existe

```html bad
<MeekoThemeToggle mode="toggle" />
```

`meeko check` da `TS2322: Type '"toggle"' is not assignable to type '"cycle" | "select" | undefined'`.

```html good
<MeekoThemeToggle mode="cycle" />
```

### Un tema que la configuración no tiene

```html bad
<MeekoThemeToggle bind:themes="['light', 'night']" />
```

Con `themes: ["light", "dark", "sepia"]`, `meeko check` da `TS2820: Type '"night"' is not assignable to type '"dark" | "light" | "sepia" | "system"'. Did you mean '"light"'?`.

```html good
<MeekoThemeToggle bind:themes="['light', 'dark']" />
```

## Notas

- **Sin JavaScript.** `POST /_meeko/theme` sólo existe con `theme` activo, acepta `application/x-www-form-urlencoded` de hasta 2 KB, comprueba el tema (`400 INVALID_THEME`) y exige un `Origin` igual al de la aplicación (`403 INVALID_ORIGIN`). Escribe la cookie y responde `303` a la página, una ruta de este origen: nunca una redirección abierta.
- **Adaptador `static`.** No hay servidor: con JavaScript funciona, pero sin él el `POST` llega al hosting, que lo rechaza.
- **Sin parpadeo.** El servidor escribe el tema desde la cookie; en una página prerenderizada, en `static` o en `"system"` sin client hint, lo hace el script de `<head>` antes del primer pintado. La regla de los iconos es un `<style>` con el nonce de la petición o con su hash en un sitio estático: una CSP sin `'unsafe-inline'` basta.
- **Hidratación.** El HTML que no conoce la elección no lleva `aria-checked` ni un `aria-label` concreto; la hidratación pinta lo mismo y, al terminar, cada radio recibe su `aria-checked` una sola vez. Nunca hay desajuste.
- **Accesibilidad.** En `mode="select"`, las flechas, `Inicio` y `Fin` mueven el foco y la elección con un `tabindex` itinerante, como un grupo de radios nativo.
- **A mano.** Para un selector propio, [`useTheme()`](/docs/reference/usetheme) da el mismo estado.
