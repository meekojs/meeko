---
title: html
group: syntax
since: 1.1.0
description: Llena un elemento con el HTML de una expresión, sin escapar, que debe estar marcado como de confianza con trustHtml.
symbols:
  - "syntax:html"
related:
  - "@meekojs/meeko#trustHtml"
  - "syntax:interpolation"
  - "syntax:style-scoped"
  - "syntax:on"
  - docs/api.md#html-sin-escapar-con-html
  - docs/api.md#html-de-confianza-trustedhtml-y-trusthtml
---

`html="expresión"` llena un elemento con el HTML de la expresión, **sin escapar**: es la vía para pintar Markdown renderizado, el resultado de un resaltador de código o un icono SVG. La expresión es un `string`; `null` y `undefined` dejan el elemento vacío.

Desde `1.3`, ese `string` debe estar marcado como de confianza con [`trustHtml`](/docs/reference/trusthtml) (tipo `TrustedHtml`), o `meeko check` avisa con `MEEK107`. Para texto, usa `{expresión}`, que escapa.

## Uso

```html
<!-- app/components/ArticleBody.meeko -->
<script lang="ts">
import type { TrustedHtml } from "@meekojs/meeko";

const props = defineProps<{ body: TrustedHtml }>();
</script>

<template>
  <article class="prose" html="props.body"></article>
</template>
```

El módulo de servidor que produce el HTML lo sanea, si viene de usuarios, y lo marca con `trustHtml`; el componente sólo recibe `TrustedHtml`.

## Atributos

| Atributo | Tipo | Por defecto | Descripción |
| --- | --- | --- | --- |
| `html` | `TrustedHtml \| null \| undefined` | obligatorio | El contenido del elemento. Un `string` sin marcar compila con el aviso `MEEK107`; un número u otro tipo es un error de tipos. |

El elemento debe estar vacío en la plantilla y ser un elemento HTML estándar que admita contenido: no `<img>`, `<input>` ni otros vacíos, ni `<textarea>`, `<title>`, `<script>` o `<style>`, ni `<template>`.

## Resultado

- **SSR.** El HTML se normaliza para el elemento antes de escribirlo, de modo que ningún nodo salga de él: se cierran las etiquetas que quedaron abiertas (`"<b>Hola"` da `<b>Hola</b>`) y se descartan los cierres que no corresponden a nada abierto. Si el navegador sacaría parte del contenido del elemento (un `<div>` dentro de un `<p>`, un `<li>` suelto), el SSR deja el elemento vacío y el navegador lo llena al hidratar con `innerHTML`.
- **Hidratación.** Si el contenido coincide con el HTML de la expresión, el DOM no se toca; si difiere, se sustituye `innerHTML`.
- **Cambios.** Cada cambio del valor sustituye `innerHTML`. El contenido insertado no es parte de la plantilla: no tiene directivas ni componentes.
- **Scripts.** Meeko nunca ejecuta los `<script>` del contenido cuando lo inserta en el navegador, igual que `innerHTML`. Los que llegan en el HTML del documento inicial sí se ejecutan, como cualquier script de la página.

## Ejemplos

### Markdown del repositorio, renderizado en el servidor

El HTML propio, como el de tus archivos Markdown, basta con declararlo de confianza donde nace:

```ts
// server/content/articles.ts
import { trustHtml } from "@meekojs/meeko";
import type { TrustedHtml } from "@meekojs/meeko";

export function articleHtml(renderedMarkdown: string): TrustedHtml {
  return trustHtml(renderedMarkdown);
}
```

```html
<!-- app/pages/blog/[slug].meeko -->
<script server lang="ts">
import { articleHtml } from "../../../server/content/articles";

const { params } = usePage();
export const article = { title: params.slug, body: articleHtml(`<p>Entrada <strong>${params.slug}</strong></p>`) };
</script>

<template>
  <h1>{article.title}</h1>
  <div class="prose" html="article.body"></div>
</template>
```

`TrustedHtml` sobrevive al payload: el export llega a la plantilla con ese tipo, y `html` no avisa.

### HTML de usuarios, saneado

Un comentario de un usuario puede traer `<img onerror>`. Sanéalo con una biblioteca como DOMPurify y márcalo después:

<!-- no-check -->
```ts
// server/content/comments.ts
import DOMPurify from "isomorphic-dompurify";
import { trustHtml } from "@meekojs/meeko";
import type { TrustedHtml } from "@meekojs/meeko";

export function commentHtml(input: string): TrustedHtml {
  return trustHtml(DOMPurify.sanitize(input));
}
```

### Un icono SVG constante

Un literal que escribes en el código no avisa; una constante del `<script>` necesita `as const` para conservar su tipo literal:

```html
<script lang="ts">
const check = '<svg viewBox="0 0 16 16" aria-hidden="true"><path d="M2 8l4 4 8-8"/></svg>' as const;
</script>

<template><span class="icon" html="check"></span> Guardado</template>
```

### Estilos y eventos en el contenido

El contenido no recibe el atributo de `<style scoped>`: selecciónalo con `:global(…)`. Para reaccionar a un clic dentro de él, escucha en el propio elemento:

```html
<script lang="ts">
import type { TrustedHtml } from "@meekojs/meeko";

const props = defineProps<{ body: TrustedHtml }>();
function onClick(event: MouseEvent): void {
  const heading = (event.target as Element | null)?.closest("h2[id]");
  if (heading) history.replaceState(null, "", `#${heading.id}`);
}
</script>

<template><div class="content" html="props.body" on:click="onClick"></div></template>

<style scoped>
.content :global(h2) { scroll-margin-top: 4rem; }
.content :global(pre) { overflow-x: auto; }
</style>
```

## Errores comunes

### Un `string` sin marcar

```html bad
<article html="body.value"></article>
```

Con `const body = signal("<p>Hola</p>")`, `meeko check` avisa con ``MEEK107: `html` inserta HTML sin escapar; un `string` puede venir de un usuario (XSS). Sanéelo y márquelo con `trustHtml(…)`, o use `{expr}`, que escapa.`` Es un aviso: no hace fallar la comprobación, pero será un error en `2.0`.

```html good
<script lang="ts">
import { trustHtml } from "@meekojs/meeko";

const body = signal(trustHtml("<p>Hola</p>"));
</script>

<template><article html="body.value"></article></template>
```

Una constante sin anotación también avisa, porque llega a la plantilla como `string`: escribe `as const` o márcala.

### Contenido dentro del elemento

```html bad
<article html="body"><p>Cargando…</p></article>
```

`MEEK095: Un elemento con html no admite hijos: el HTML de la expresión es todo su contenido; deja <article html="..."></article> vacío`.

```html good
<article html="body"></article>
<p if:when="!body">Cargando…</p>
```

### Un elemento que no admite contenido HTML

```html bad
<img html="icon">
<textarea html="body"></textarea>
```

`MEEK095: html no se admite en <img>, que no tiene contenido` y `MEEK095: html no se admite en <textarea>, cuyo contenido no es HTML`.

```html good
<span html="icon"></span>
<textarea model="text"></textarea>
```

### Un valor que no es texto

```html bad
<p html="count"></p>
```

Con `const count = 3`, `meeko check` da `TS2345: Argument of type 'number' is not assignable to parameter of type 'string'.` Para pintar un número, interpólalo.

```html good
<p>{count}</p>
```

### Una expresión vacía

```html bad
<div html=""></div>
```

`MEEK095: html necesita una expresión que devuelva HTML: html="content"`.

```html good
<div html="content"></div>
```

## Notas

- **Seguridad.** `html` es inseguro con contenido no confiable: un HTML de usuarios o de terceros puede ejecutar código en la página (XSS). `trustHtml` no sanea, sólo declara: sanea primero. Marca el HTML en el módulo de servidor que lo produce, no justo antes de la plantilla.
- **SSR.** Elige un elemento que admita el contenido (`<div html>` para bloques, `<ul html>` para `<li>`, `<tbody html>` para filas): si el navegador sacaría parte del contenido, el SSR deja el elemento vacío y sin JavaScript no se ve.
- **Hidratación.** Un contenido idéntico no se toca; uno distinto se sustituye entero y pierde la selección o el foco que hubiera dentro.
- **Rendimiento.** Cada cambio sustituye `innerHTML` completo. Para contenido que cambia a menudo, usa la plantilla.
- **Elementos personalizados.** En una etiqueta con guion (`<x-markdown html="intro">`), `html` es un atributo HTML literal y el elemento admite hijos. En una etiqueta de componente, `html` no es una prop (`MEEK032`), y `bind:html` es un atributo llamado `html`.
- **CSP.** El contenido insertado puede traer atributos `style` u `on*`, que una CSP estricta bloquea: tenlo en cuenta al sanear.
