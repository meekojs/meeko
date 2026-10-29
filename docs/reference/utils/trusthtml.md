---
title: trustHtml
group: utils
since: 1.3.0
description: Declara que un HTML es de confianza y le da el tipo TrustedHtml, que la directiva html acepta sin avisar; no sanea ni copia nada.
symbols:
  - "@meekojs/meeko#trustHtml"
  - "@meekojs/meeko#TrustedHtml"
related:
  - "syntax:html"
  - "syntax:interpolation"
  - "syntax:script-server"
  - docs/api.md#html-de-confianza-trustedhtml-y-trusthtml
  - docs/api.md#html-sin-escapar-con-html
---

`trustHtml(html)` declara que un `string` de HTML es de confianza y lo devuelve con el tipo `TrustedHtml`, el que la directiva `html="expresión"` acepta sin el aviso `MEEK107`. En ejecución devuelve el mismo `string`, sin copiarlo ni comprobarlo: no tiene coste.

**`trustHtml` no sanea: sólo declara.** No escapa ni filtra nada. Si el HTML puede contener texto de usuarios o de terceros, sanéalo antes (con [DOMPurify](https://github.com/cure53/DOMPurify), por ejemplo) y marca el resultado. Para texto, usa `{expresión}`, que escapa.

`TrustedHtml` es un `string` con una marca que sólo existe en los tipos: se serializa en JSON tal cual y llega a la plantilla con la marca intacta desde `<script server>` o `load`. Ambos se importan de `@meekojs/meeko`; no se autoimportan, para que la declaración de confianza sea siempre un import visible.

## Uso

```ts
// server/content/articles.ts
import { trustHtml } from "@meekojs/meeko";
import type { TrustedHtml } from "@meekojs/meeko";

export interface Article {
  readonly title: string;
  readonly body: TrustedHtml;
}

// `html` sale de nuestro propio renderizador de Markdown.
export function article(title: string, html: string): Article {
  return { title, body: trustHtml(html) };
}
```

```html
<!-- app/pages/blog/[slug].meeko -->
<script server lang="ts">
import { article } from "../../../server/content/articles";

const { params } = usePage();
export const post = article(params.slug, `<p>Entrada <em>${params.slug}</em></p>`);
</script>

<template>
  <h1>{post.title}</h1>
  <div class="prose" html="post.body"></div>
</template>
```

## Parámetros

| Parámetro | Tipo | Por defecto | Descripción |
| --- | --- | --- | --- |
| `html` | `string` | obligatorio | HTML que el código ya sabe seguro: propio o saneado. |

## Valor devuelto

El mismo `html`, con el tipo `TrustedHtml`. Un `TrustedHtml` se puede usar donde se espera un `string`, pero no al revés: asignar un `string` a `TrustedHtml` es un error de tipos.

## Ejemplos

### HTML de usuarios, saneado donde nace

<!-- no-check -->
```ts
// server/content/comments.ts
import DOMPurify from "isomorphic-dompurify";
import { trustHtml } from "@meekojs/meeko";
import type { TrustedHtml } from "@meekojs/meeko";

export function commentHtml(input: string): TrustedHtml {
  return trustHtml(DOMPurify.sanitize(input, { ALLOWED_TAGS: ["p", "b", "i", "a", "ul", "li"] }));
}
```

### Un icono en una constante

En el `<script>`, una constante de HTML llega a la plantilla como `string` y avisa. Márcala o escribe `as const`:

```html
<script lang="ts">
import { trustHtml } from "@meekojs/meeko";

const star = trustHtml('<svg viewBox="0 0 16 16" aria-hidden="true"><path d="M8 1l2 5h5l-4 3 2 6-5-4-5 4 2-6-4-3h5z"/></svg>');
</script>

<template><span class="icon" html="star"></span> Favorito</template>
```

### Tipar la prop de un componente

Con `TrustedHtml` en las props, el padre no puede pasar un `string` sin marcar:

```html
<!-- app/components/RichText.meeko -->
<script lang="ts">
import type { TrustedHtml } from "@meekojs/meeko";

const props = defineProps<{ html: TrustedHtml | null }>();
</script>

<template><div class="rich-text" html="props.html"></div></template>
```

## Errores comunes

### Un `string` sin marcar en `html`

```html bad
<article html="body.value"></article>
```

Con `const body = signal("<p>Hola</p>")`, `meeko check` avisa con ``MEEK107: `html` inserta HTML sin escapar; un `string` puede venir de un usuario (XSS). Sanéelo y márquelo con `trustHtml(…)`, o use `{expr}`, que escapa.`` Es un aviso: será un error en `2.0`.

```html good
<script lang="ts">
import { trustHtml } from "@meekojs/meeko";

const body = signal(trustHtml("<p>Hola</p>"));
</script>

<template><article html="body.value"></article></template>
```

### Asignar un `string` a `TrustedHtml`

```ts bad
const raw: string = await response.text();
const body: TrustedHtml = raw;
```

`meeko check` da `TS2322: Type 'string' is not assignable to type 'TrustedHtml'.`

<!-- no-check -->
```ts good
const body: TrustedHtml = trustHtml(DOMPurify.sanitize(await response.text()));
```

### Marcar justo antes de la plantilla

`trustHtml` en el componente, sobre un dato que llega de fuera, quita el aviso sin hacer el HTML más seguro: un XSS sin ningún error.

```html bad
<script lang="ts">
import { trustHtml } from "@meekojs/meeko";
const props = defineProps<{ comment: string }>();
const safe = computed(() => trustHtml(props.comment));
</script>
```

```html good
<script lang="ts">
import type { TrustedHtml } from "@meekojs/meeko";
const props = defineProps<{ comment: TrustedHtml }>(); // saneado en el servidor
</script>
```

## Notas

- **Seguridad.** La marca dice que alguien comprobó el origen del HTML; no lo comprueba. Pon `trustHtml` donde nace el HTML (el renderizador de Markdown propio, la salida del saneador) y declara `TrustedHtml` en los tipos compartidos, para que el resto del código no pueda marcar nada por su cuenta.
- **Serialización.** La marca sólo existe en los tipos: `TrustedHtml` viaja en el payload como un `string` normal y la conserva en la plantilla.
- **Rendimiento.** No hace nada en ejecución: devuelve el mismo `string`.
- **Fuera del framework.** Ambos se exportan desde la raíz, `@meekojs/meeko`, y funcionan igual en un componente suelto.
