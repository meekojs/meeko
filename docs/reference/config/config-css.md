---
title: css
group: config
since: 1.2.0
description: Opciones de los estilos de los componentes, como qué elementos reciben el atributo de style scoped, todos o sólo los que algún selector puede seleccionar.
symbols:
  - "config:css"
related:
  - "syntax:style-scoped"
  - "syntax:style"
  - docs/framework.md#configuración
---

`css` agrupa las opciones de los estilos de los componentes. Hoy tiene una: `scopeAttribute`, que decide qué elementos de la plantilla reciben el atributo de ámbito de `<style scoped>`.

- `"all"`, el valor por defecto en `1.x`: todos los elementos de la plantilla lo reciben.
- `"matched"` (desde `1.2`): sólo los que algún selector con ámbito del componente puede seleccionar. El HTML es más pequeño y las diferencias entre SSR e hidratación, menores. Pasará a ser el valor por defecto en `2.0`.

## Uso

```ts
// meeko.config.ts
import { defineMeekoConfig } from "@meekojs/meeko/framework";

export default defineMeekoConfig({
  css: { scopeAttribute: "matched" },
});
```

## Opciones

| Opción | Tipo | Por defecto | Descripción |
| --- | --- | --- | --- |
| `scopeAttribute` | `"all" \| "matched"` | `"all"` | Qué elementos reciben el atributo de `<style scoped>`. |

## Resultado

Con este componente:

```html
<!-- app/components/Card.meeko -->
<template>
  <article class="card"><h2>{props.title}</h2><p>{props.body}</p></article>
</template>
<style scoped>
.card { padding: 1rem; }
h2 { margin: 0; }
</style>
```

| `scopeAttribute` | Elementos con el atributo |
| --- | --- |
| `"all"` | `<article>`, `<h2>` y `<p>` |
| `"matched"` | `<article>` (`.card`) y `<h2>` (`h2`); `<p>` no, porque ningún selector puede seleccionarlo |

## Ejemplos

### Activar `"matched"` en un proyecto existente

```ts
import { defineMeekoConfig } from "@meekojs/meeko/framework";

export default defineMeekoConfig({ css: { scopeAttribute: "matched" } });
```

Revise los componentes que añaden clases o atributos con la API del DOM (véase «Errores comunes»): es el único caso que cambia.

### Una clase que añade el script, con `"matched"`

```html
<template>
  <button class="toggle" on:click="(event) => event.currentTarget.classList.toggle('open')">Menú</button>
</template>
<style scoped>
.toggle.open { outline: 2px solid; }
</style>
```

Un elemento con `on:` o `ref:` queda en manos del script: en él sólo cuenta la etiqueta y cualquier clase del selector puede coincidir, así que recibe el atributo y el estilo funciona.

## Errores comunes

### Un valor que no existe

```ts bad
export default defineMeekoConfig({ css: { scopeAttribute: "some" } as never });
```

`meeko dev`, `meeko build`, `meeko check` y `meeko routes` se detienen con `…/meeko.config.ts: css.scopeAttribute debe ser "all" o "matched"`.

```ts good
import { defineMeekoConfig } from "@meekojs/meeko/framework";
export default defineMeekoConfig({ css: { scopeAttribute: "matched" } });
```

### Una clase añadida por el DOM a un elemento sin atributo

```html bad
<template><span id="badge">nuevo</span></template>
<script lang="ts">
onMounted(() => document.getElementById("badge")?.classList.add("hot"));
</script>
<style scoped>
.hot { color: red; }
</style>
```

No hay error: con `"matched"`, ningún selector puede seleccionar el `<span>` (no tiene la clase `hot` en la plantilla, ni `ref:` ni `on:`), así que no recibe el atributo y `.hot` no le aplica.

```html good
<template><span bind:class="hot.value ? 'hot' : ''">nuevo</span></template>
<script lang="ts">
const hot = signal(false);
onMounted(() => { hot.value = true; });
</script>
<style scoped>
.hot { color: red; }
</style>
```

## Notas

- **Cuándo cambia.** Sólo afecta a `<style scoped>`; los estilos globales no cambian.
- **`2.0`.** `"matched"` será el valor por defecto. Activarlo ahora y revisar los componentes que tocan el DOM evita sorpresas al migrar.
- **Desarrollo.** Cambiar `meeko.config.ts` exige reiniciar `meeko dev`.
