---
title: useTheme
group: composables
since: 1.4.0
description: Devuelve el tema claro/oscuro de la aplicación (la elección, el tema efectivo y la lista de temas) y lo cambia en html, la cookie y las demás pestañas.
symbols:
  - "@meekojs/meeko/framework#useTheme"
types:
  - "@meekojs/meeko/framework#ThemeState"
related:
  - "syntax:meekothemetoggle"
  - "config:theme"
  - "@meekojs/meeko/framework#useStorage"
  - "@meekojs/meeko/framework#useHead"
  - docs/framework.md#tema-clarooscuro-sin-parpadeo
  - docs/framework.md#iconos-que-no-saltan
---

Con `theme` en `meeko.config.ts`, Meeko guarda la elección del usuario en una cookie, escribe el tema en `<html>` desde el primer byte y, cuando el servidor no puede saberlo, lo aplica con un script de `<head>` antes del primer pintado. `useTheme()` da a los componentes ese estado: `theme`, la elección (`"system"` incluido), `resolved`, el tema que se ve, `themes`, la lista de temas, y `set`, que cambia la elección en `<html>`, `color-scheme`, la cookie y `localStorage`.

Para un selector listo, usa [`<MeekoThemeToggle>`](/docs/reference/meekothemetoggle). Se autoimporta en los `.meeko` (un export propio con ese nombre tiene prioridad) y se llama mientras se ejecuta el script de un componente.

## Uso

```ts
// meeko.config.ts
import { defineMeekoConfig } from "@meekojs/meeko/framework";

export default defineMeekoConfig({ theme: true }); // light y dark, "system" por defecto
```

```html
<!-- app/components/ThemeSelect.meeko -->
<script lang="ts">
const { theme } = useTheme();
</script>

<template>
  <select aria-label="Tema" model="theme">
    <option value="system">Sistema</option>
    <option value="light">Claro</option>
    <option value="dark">Oscuro</option>
  </select>
</template>
```

`theme` es una señal editable: `model` la cambia y eso equivale a llamar a `set`.

## Parámetros

`useTheme()` no recibe parámetros. Los temas salen de `theme` en `meeko.config.ts` (`themes`, `default`, `system`, `attribute`, `cookie`…).

## Valor devuelto

Un `ThemeState`, compartido por toda la aplicación:

| Propiedad | Tipo | Descripción |
| --- | --- | --- |
| `theme` | `Signal<Choice>` | La elección, `"system"` incluido. Editable en el navegador (asignarla equivale a `set`); de sólo lectura en el servidor. |
| `resolved` | `ReadonlySignal<Name>` | El tema efectivo: la elección o, en `"system"`, el de `prefers-color-scheme`, que sigue a los cambios del sistema. |
| `themes` | `readonly Name[]` | Los temas de la configuración, sin `"system"`. |
| `set(theme)` | `void` | Cambia la elección. Un nombre que no es un tema ni `"system"` lanza `TypeError: useTheme(): unknown theme "…"`; en el servidor lanza `Error: useTheme(): the theme changes in the browser, not during a server render`. |

`meeko check` tipa `Name` y `Choice` con la configuración: con `themes: ["light", "dark", "sepia"]`, `resolved` es `"light" | "dark" | "sepia"`. Sin `theme` en la configuración, `useTheme()` lanza `Error: useTheme() needs theme in meeko.config.ts (theme: true) and a running Meeko application`.

## Ejemplos

### Un botón que alterna claro y oscuro sin que el icono salte

Pinta los dos iconos y deja que el CSS muestre uno según el atributo de `<html>`, que el script de `<head>` escribe antes del primer pintado:

```html
<!-- app/components/ThemeButton.meeko -->
<script lang="ts">
const { resolved, set } = useTheme();
const toggle = (): void => set(resolved.value === "dark" ? "light" : "dark");
</script>

<template>
  <button type="button" class="theme-button" aria-label="Tema oscuro" bind:aria-pressed="String(resolved.value === 'dark')" on:click="toggle">
    <svg class="sun" viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="5" /></svg>
    <svg class="moon" viewBox="0 0 24 24" aria-hidden="true"><path d="M20 14.5A8 8 0 0 1 9.5 4a8 8 0 1 0 10.5 10.5Z" /></svg>
  </button>
</template>

<style>
.theme-button .moon { display: none; }
:root[data-theme="dark"] .theme-button .sun { display: none; }
:root[data-theme="dark"] .theme-button .moon { display: inline; }
</style>
```

### Temas propios

```ts
// meeko.config.ts
import { defineMeekoConfig } from "@meekojs/meeko/framework";

export default defineMeekoConfig({
  theme: { themes: ["light", "dark", "sepia"], default: "light", darkThemes: ["dark"] },
});
```

```html
<script lang="ts">
const { theme, themes } = useTheme();
</script>

<template>
  <fieldset>
    <legend>Tema</legend>
    <label each:of="themes" each:as="name" each:key="name"><input type="radio" bind:value="name" model="theme"> {name}</label>
  </fieldset>
</template>
```

### Leer el tema para una librería

Un gráfico que necesita colores distintos en oscuro sigue a `resolved` con un `effect`:

```html
<script lang="ts">
const { resolved } = useTheme();
const chartRef = useElementRef("chart");
onMounted(() => {
  const chart = createChart(chartRef.value!);
  effect(() => chart.setPalette(resolved.value === "dark" ? darkPalette : lightPalette));
  return () => chart.destroy();
});
</script>

<template><canvas ref:chart></canvas></template>
```

## Errores comunes

### Usarlo sin `theme` en la configuración

```ts bad
// meeko.config.ts sin theme
const { resolved } = useTheme();
```

El render lanza `Error: useTheme() needs theme in meeko.config.ts (theme: true) and a running Meeko application`. Activa el tema:

<!-- no-check -->
```ts good
export default defineMeekoConfig({ theme: true });
```

### Un tema que no existe

```ts bad
const { set } = useTheme();
const go = () => set("purple");
```

Con `themes: ["light", "dark", "sepia"]`, `meeko check` da `TS2345: Argument of type '"purple"' is not assignable to parameter of type '"dark" | "light" | "sepia" | "system"'`; en JavaScript, `set` lanza `TypeError: useTheme(): unknown theme "purple"; use "system", "light", "dark", "sepia"`.

<!-- no-check -->
```ts good
const go = () => set("sepia");
```

### Elegir el icono con `resolved` en una página prerenderizada

```html bad
<span>{resolved.value === "dark" ? "🌙" : "☀️"}</span>
```

Funciona cuando el servidor conoce el tema (la cookie o el client hint), pero en una página prerenderizada, en el adaptador `static` o en `"system"` sin client hint, el HTML pinta el tema claro y el icono cambia al terminar la hidratación. Pinta los dos y deja decidir al CSS con el atributo de `<html>`:

```html good
<span class="icon-sun" aria-hidden="true">☀️</span><span class="icon-moon" aria-hidden="true">🌙</span>
<!-- :root[data-theme="dark"] .icon-sun { display: none } … -->
```

## Notas

- **SSR.** El servidor lee la cookie de la petición y, en `"system"`, el client hint `Sec-CH-Prefers-Color-Scheme`. Si no conoce la preferencia, `resolved` vale el tema claro de `system`.
- **Hidratación.** El navegador hidrata con los valores que renderizó el servidor (viajan en el estado de la página) y recibe los suyos al terminar la hidratación, antes de `onMounted`: nunca hay un desajuste.
- **Otras pestañas.** Un cambio en otra pestaña llega por el evento `storage` de `localStorage`; en `"system"`, `resolved` sigue a `prefers-color-scheme` mientras la página está abierta.
- **Navegación.** La navegación del cliente conserva el tema, porque no recarga `<html>`.
- **Seguridad.** La cookie no es `HttpOnly` (la escribe el cliente) y no contiene nada privado. El servidor sólo acepta en ella un tema de `themes` o `"system"`; cualquier otro valor se ignora.
- **CSS.** Declara `color-scheme` en el CSS de cada tema para que la página tenga el esquema correcto también sin JavaScript; Meeko lo aplica además por CSSOM, que una CSP estricta permite.
