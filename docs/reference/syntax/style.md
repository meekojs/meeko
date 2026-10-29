---
title: <style>
group: syntax
since: 1.0.0
description: Estilos globales que viven junto al componente que los necesita, procesados por el PostCSS de la aplicación y empaquetados con él.
symbols:
  - "syntax:style"
related:
  - "syntax:style-scoped"
  - "syntax:html"
  - "config:css"
  - docs/api.md#estilos-del-componente-style-y-style-scoped
---

`<style>` sin `scoped` es CSS **global** que vive en el `.meeko` del componente que lo necesita. Pasa por el mismo PostCSS que `app/styles/main.css` (`postcss.config.*`, Tailwind, las utilidades de Meeko) y Vite lo empaqueta con el componente, pero sus reglas se aplican a **toda la página**: a los hijos, al contenido de `html="…"` y a cualquier otro componente con la misma clase.

Úsalo para estilos globales a propósito, con un prefijo propio. Para casi todo lo demás, [`<style scoped>`](/docs/reference/style-scoped) es la opción por defecto.

## Uso

```html
<!-- app/components/MarkdownView.meeko -->
<script lang="ts">
import type { TrustedHtml } from "@meekojs/meeko";

const props = defineProps<{ content: TrustedHtml }>();
</script>

<template>
  <article class="markdown-view" html="props.content"></article>
</template>

<style>
/* Global a propósito: el prefijo .markdown-view evita afectar al resto de la página. */
.markdown-view p { margin-block: 0.75em; }
.markdown-view pre { overflow-x: auto; }
</style>
```

## Atributos

| Atributo | Tipo | Por defecto | Descripción |
| --- | --- | --- | --- |
| `scoped` | sin valor | ausente | Con `scoped`, los estilos se limitan al componente (véase `<style scoped>`). Sin él, son globales. |

Un componente admite **un** bloque de estilos: dos `<style>`, aunque uno sea `scoped`, dan `MEEK004: Sección <style> duplicada`.

## Resultado

- **CSS.** Las reglas tal cual, después de PostCSS: no se añade ningún atributo de ámbito ni se transforma `:global(…)`.
- **SSR.** El documento enlaza el CSS de los componentes de la página en `<head>`, así que el primer pintado ya tiene los estilos.
- **Navegación.** La navegación del cliente carga el CSS de cada ruta al entrar en ella. Una vez cargado, sigue aplicándose al navegar a otras rutas, y su orden frente a otras hojas depende de cuándo se cargó.

## Ejemplos

### Estilos de un contenido de terceros

Un componente que envuelve un widget o un HTML que no controla le da estilos globales con un prefijo:

```html
<!-- app/components/CodeBlock.meeko -->
<script lang="ts">
import type { TrustedHtml } from "@meekojs/meeko";

const props = defineProps<{ highlighted: TrustedHtml }>();
</script>

<template><div class="code-block" html="props.highlighted"></div></template>

<style>
.code-block .line { display: block; min-height: 1lh; }
.code-block .line.highlighted { background: color-mix(in oklab, currentColor 8%, transparent); }
</style>
```

### Tailwind y capas

El bloque pasa por el PostCSS de la aplicación, así que admite las directivas de Tailwind si el proyecto lo usa:

```html
<template><nav class="site-nav">…</nav></template>

<style>
@layer components {
  .site-nav { display: flex; gap: 1rem; }
  .site-nav a[aria-current="page"] { font-weight: 700; }
}
</style>
```

## Errores comunes

### Usar `:global(…)` en un `<style>` sin `scoped`

`:global` sólo se transforma en `<style scoped>`. Aquí llega tal cual al navegador, que no lo entiende y descarta la regla, sin ningún error.

```html bad
<style>
.card :global(.icon) { width: 1rem; }
</style>
```

```html good
<style scoped>
.card :global(.icon) { width: 1rem; }
</style>
```

### Un selector genérico sin prefijo

Una clase común en un `<style>` global afecta a todos los componentes que la usan, en el orden en que se cargaron sus hojas: el resultado cambia según la ruta por la que se entra.

```html bad
<style>
.card { padding: 2rem; }
</style>
```

```html good
<style scoped>
.card { padding: 2rem; }
</style>
```

### Dos bloques de estilos

```html bad
<style scoped>
.a { color: red; }
</style>
<style>
.b { color: blue; }
</style>
```

`MEEK004: Sección <style> duplicada`. Usa un `<style scoped>` con `:global(…)` para la parte global.

```html good
<style scoped>
.a { color: red; }
:global(.b) { color: blue; }
</style>
```

## Notas

- **Alcance.** Un `<style>` global no se limita a los momentos en que el componente está montado: una vez cargado, se aplica a toda la página hasta recargarla.
- **Dónde poner los estilos globales.** Reset, tokens y tipografía van mejor en `app/styles/main.css` (o en un archivo que ella importe), donde su orden es explícito. `<style>` en un componente es para los estilos globales que sólo existen si ese componente está en la aplicación.
- **Rendimiento.** Vite empaqueta el CSS por ruta: un componente que sólo se usa en una sección no añade sus estilos a las demás hasta que se visitan.
- **CSP.** En el build, el CSS de los componentes llega en archivos `.css` enlazados, no en etiquetas `<style>` en línea: una CSP con `style-src 'self'` los admite.
- **Comprobación.** `meeko check` no valida el CSS de un `<style>` sin `scoped`; PostCSS y Vite lo procesan en `meeko dev` y `meeko build`.
