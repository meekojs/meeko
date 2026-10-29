---
title: <style scoped>
group: syntax
since: 1.0.0
description: Estilos con ámbito del componente, limitados a los elementos de su plantilla con un atributo data-meeko-s, y :global(…) para salir de él.
symbols:
  - "syntax:style-scoped"
related:
  - "syntax:style"
  - "syntax:html"
  - "config:css"
  - docs/api.md#estilos-con-ámbito-y-global
  - docs/api.md#qué-elementos-reciben-el-atributo
---

`<style scoped>` limita los estilos al componente: el compilador añade el atributo `data-meeko-s-<hash>` a los elementos de su plantilla y lo exige en cada selector. Una `.card` de este componente no afecta a la `.card` de otro.

`:global(<selector>)` sale del ámbito para un trozo del selector: alcanza a los elementos de un componente hijo, al contenido de `html="…"` o a una clase de `<html>`.

## Uso

```html
<!-- app/components/AppCard.meeko -->
<script lang="ts">
import type { TrustedHtml } from "@meekojs/meeko";

const props = defineProps<{ title: string; body: TrustedHtml }>();
</script>

<template>
  <section class="card">
    <h2 class="title">{props.title}</h2>
    <div class="content" html="props.body"></div>
  </section>
</template>

<style scoped>
.card { border: 1px solid; padding: 1rem; }
.card .title { font-weight: 700; }
.content :global(p) { margin: 0; }
</style>
```

## Atributos

| Atributo | Tipo | Por defecto | Descripción |
| --- | --- | --- | --- |
| `scoped` | sin valor | ausente | Activa el ámbito. Sin él, el bloque es global (véase `<style>`). |

La opción `css.scopeAttribute` de `meeko.config.ts` decide qué elementos reciben el atributo: `"all"` (por defecto en `1.x`) o, desde `1.2`, `"matched"`.

## Resultado

El compilador añade `[data-meeko-s-<hash>]` al **último compuesto** de cada selector, antes de un pseudoelemento si lo hay. `:global(…)` emite su selector interno sin el atributo:

| Fuente | CSS generado |
| --- | --- |
| `.a { … }` | `.a[data-meeko-s-…] { … }` |
| `.card .title` | `.card .title[data-meeko-s-…]` |
| `.a::before` | `.a[data-meeko-s-…]::before` |
| `.card :global(.icon)` | `.card[data-meeko-s-…] .icon` |
| `:global(html.dark) .a` | `html.dark .a[data-meeko-s-…]` |
| `:global(body)` | `body`, sin atributo |
| `@keyframes spin { … }` | sin cambios |

El hash sale de la ruta del archivo, así que es el mismo en el servidor y en el navegador, y cambia si mueves o renombras el componente. El atributo va en los elementos de la plantilla del componente; el contenido de un snippet recibe el del componente que lo escribe.

## Ejemplos

### Estados con atributos ARIA

Un selector de atributo con ámbito se aplica a los atributos que pone `bind:`:

```html
<script lang="ts">
const open = signal(false);
</script>

<template>
  <button type="button" class="toggle" bind:aria-expanded="open.value ? 'true' : 'false'" on:click="() => open.value = !open.value">Menú</button>
</template>

<style scoped>
.toggle[aria-expanded="true"] { background: CanvasText; color: Canvas; }
</style>
```

### Tema oscuro

`:global(…)` en un ancestro lee una clase o un atributo de `<html>` sin perder el ámbito del resto:

```html
<template><div class="panel">Contenido</div></template>

<style scoped>
.panel { background: white; color: black; }
:global(html[data-theme="dark"]) .panel { background: #111; color: #eee; }
</style>
```

### Elementos de un componente hijo

Los elementos de un hijo no reciben el atributo del padre. Para ajustar uno desde fuera, ancla el selector en tu elemento y usa `:global(…)` para el del hijo:

```html
<template>
  <div class="toolbar"><AppButton label="Guardar" /></div>
</template>

<style scoped>
.toolbar :global(.button) { min-width: 8rem; }
</style>
```

Mejor aún, si el hijo es tuyo: dale una prop (`variant`, `size`) y que el propio hijo decida sus estilos.

### Menos atributos con `scopeAttribute: "matched"`

Desde `1.2`, con `css.scopeAttribute: "matched"`, el atributo sólo va en los elementos que algún selector con ámbito puede seleccionar, y el HTML pesa menos:

```ts
// meeko.config.ts
import { defineMeekoConfig } from "@meekojs/meeko/framework";

export default defineMeekoConfig({
  css: { scopeAttribute: "matched" },
});
```

Antes de activarlo, revisa el código que cambia clases con la API del DOM (`classList`, `setAttribute`) en elementos sin `ref:` ni `on:`: con `"matched"` puede que no tengan el atributo. Usa `bind:class` o una `ref:` en ellos.

## Errores comunes

### `:global` sin paréntesis

```html bad
<style scoped>
.card :global { color: red; }
</style>
```

`MEEK019: :global necesita un selector como argumento; usa :global(<selector>)`.

```html good
<style scoped>
.card :global(.icon) { color: red; }
</style>
```

### Una lista de selectores dentro de `:global(…)`

```html bad
<style scoped>
.card :global(.icon, .badge) { color: red; }
</style>
```

`MEEK019: :global(...) admite un solo selector; escribe un :global(<selector>) por cada selector de la lista`.

```html good
<style scoped>
.card :global(.icon), .card :global(.badge) { color: red; }
</style>
```

### `:global(…)` dentro de otra pseudoclase

```html bad
<style scoped>
.card:not(:global(.dark)) { color: black; }
</style>
```

`MEEK019: :global(<selector>) debe ir en el nivel superior de un selector, no dentro de otra pseudoclase`.

```html good
<style scoped>
.card { color: black; }
:global(.dark) .card { color: white; }
</style>
```

### Estilar el contenido de `html` sin `:global`

El HTML insertado con `html="…"` no es parte de la plantilla y no recibe el atributo: la regla no se aplica, sin ningún error.

```html bad
<style scoped>
.content p { margin: 0; }
</style>
```

```html good
<style scoped>
.content :global(p) { margin: 0; }
</style>
```

### CSS mal formado

```html bad
<style scoped>
.card { color: red;
</style>
```

`MEEK019: Unclosed block`, con la línea del `.meeko`.

```html good
<style scoped>
.card { color: red; }
</style>
```

## Notas

- **SSR e hidratación.** El servidor y el navegador comparten la plantilla compilada, así que el atributo coincide en el HTML del servidor y en el que se pinta después en `if:when`, `each:of` o una navegación.
- **Especificidad.** El atributo suma la especificidad de un selector de atributo al último compuesto: `.card` pasa a pesar como `.card[x]`. Una regla global con la misma clase pierde frente a ella.
- **Rendimiento.** Con `"all"`, cada elemento de la plantilla lleva el atributo; con `"matched"`, sólo los que lo necesitan. Un componente sin `<style scoped>` nunca lo emite.
- **Animaciones.** Las reglas de `@keyframes` no se modifican y su nombre no se aísla: usa nombres con prefijo si varios componentes definen animaciones.
- **Comprobación.** `meeko check`, `meeko build` y el editor analizan el bloque y dan `MEEK019` con la posición del error. `css.scopeAttribute` no cambia los tipos ni los diagnósticos, sólo el HTML.
