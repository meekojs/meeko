---
title: documentHtml
group: utils
since: 1.8.0
description: Hace que un HTML de confianza viaje una sola vez en la primera carga, en el HTML del documento y no también en el payload de hidratación.
symbols:
  - "@meekojs/meeko/framework#documentHtml"
related:
  - "@meekojs/meeko#trustHtml"
  - "syntax:html"
  - "syntax:script-server"
  - docs/api.md#html-que-viaja-una-vez-documenthtml
---

`documentHtml(html)` declara que un `TrustedHtml` sólo necesita viajar una vez. Sin esta marca, un dato de la página que se pinta con `html="..."` llega dos veces en la primera carga: en el HTML del documento y en el payload de hidratación. En un artículo grande, eso es la mitad del peso.

Con la marca, el payload del documento lleva un marcador en lugar del valor y la hidratación adopta el contenido del elemento sin leerlo, compararlo ni reescribirlo. Una navegación de cliente sigue recibiendo el valor completo. Se importa de `@meekojs/meeko/framework`, y no es un autoimport.

## Uso

```html
<!-- app/pages/guides/[slug].meeko -->
<script server lang="ts">
import { trustHtml } from "@meekojs/meeko";
import { documentHtml } from "@meekojs/meeko/framework";

const { params } = usePage();
export const guide = { body: documentHtml(trustHtml(`<h2>Guía</h2><p>${params.slug}</p>`)) };
</script>

<template>
  <article html="guide.body"></article>
</template>
```

## Parámetros

| Parámetro | Tipo | Por defecto | Descripción |
| --- | --- | --- | --- |
| `html` | `TrustedHtml` | obligatorio | HTML ya declarado de confianza con [`trustHtml`](/docs/reference/trusthtml). Un `string` sin marcar es un error de tipos. |

## Valor devuelto

El mismo `html`, sin copiarlo, con el tipo `TrustedHtml`. En el servidor, la plantilla y `load` leen el valor real. Fuera de una petición de página no marca nada.

## Ejemplos

### Una lista de artículos

La marca va en cada valor, así que sirve en cualquier parte de los datos, también en una lista o en lo que devuelve `load`:

```html
<!-- app/pages/news.meeko -->
<script server lang="ts">
import { trustHtml } from "@meekojs/meeko";
import { documentHtml } from "@meekojs/meeko/framework";

export const items = ["<p>Primera</p>", "<p>Segunda</p>"].map((body, id) => ({ id, body: documentHtml(trustHtml(body)) }));
</script>

<template>
  <article each:of="items" each:as="item" each:key="item.id" html="item.body"></article>
</template>
```

### Un elemento que se cierra y se abre

Si la página vuelve a pintar el elemento, el navegador pide el valor al servidor con una petición de navegación de esa URL y lo inserta al llegar. Hasta entonces, el elemento queda vacío. La primera línea de una ruta `stream` ya basta: no espera a sus valores diferidos y cancela el resto de la respuesta:

```html
<!-- app/pages/faq.meeko -->
<script server lang="ts">
import { trustHtml } from "@meekojs/meeko";
import { documentHtml } from "@meekojs/meeko/framework";

export const answer = documentHtml(trustHtml("<p>Una respuesta larga.</p>"));
</script>

<script lang="ts">
const open = signal(true);
</script>

<template>
  <button type="button" on:click="() => open.value = !open.value">Respuesta</button>
  <div if:when="open.value" html="answer"></div>
</template>
```

## Errores comunes

### Leer el valor fuera de `html`

En el navegador, durante esa primera carga, el valor es el marcador, un comentario HTML:

```html bad
<script server lang="ts">
import { trustHtml } from "@meekojs/meeko";
import { documentHtml } from "@meekojs/meeko/framework";

export const body = documentHtml(trustHtml("<p>Hola</p>"));
</script>

<template>
  <article html="body"></article>
  <p>{body.length} caracteres</p>
</template>
```

El servidor pinta la longitud real y el navegador la del marcador. Si algo más lee el valor, no lo marque:

```html good
<script server lang="ts">
import { trustHtml } from "@meekojs/meeko";

export const body = trustHtml("<p>Hola</p>");
</script>

<template>
  <article html="body"></article>
  <p>{body.length} caracteres</p>
</template>
```

### Marcar un `string` sin declarar

```ts bad
import { documentHtml } from "@meekojs/meeko/framework";

export const body = documentHtml("<p>Hola</p>");
```

`TS2345: Argument of type 'string' is not assignable to parameter of type 'TrustedHtml'.` La marca no sustituye a la declaración de confianza:

```ts good
import { trustHtml } from "@meekojs/meeko";
import { documentHtml } from "@meekojs/meeko/framework";

export const body = documentHtml(trustHtml("<p>Hola</p>"));
```

## Notas

- **Cuándo viaja completo.** Si `html` no lo pintó en el documento, como dentro de un `if:` cerrado, o si el SSR dejó vacío alguno de sus elementos porque el navegador sacaría su contenido (un `<div>` en un `<p>`), el valor sigue en el payload, aunque otro elemento sí lo muestre. Un valor vacío tampoco se sustituye.
- **Por contenido.** La marca sigue al texto, porque un `string` no tiene identidad: cualquier otro dato de la página con exactamente el mismo texto también viaja como marcador. No marque un valor pequeño que pueda repetirse en otro dato.
- **Seguridad.** El DOM nunca es el origen de un HTML: el navegador no lee el contenido del elemento para volver a pintarlo, sólo lo pide al servidor. Y sólo inserta un valor que esa misma respuesta declare marcado con `documentHtml`, en `markedHtml`, y cuyo hash coincida con el que escribió el documento: ni una posición antigua ni otra ruta convierten un texto en HTML. Un valor que imita el marcador es un comentario sin efecto o, como mucho, nombra un HTML que el servidor declara marcado.
- **Si el valor cambia de sitio.** Se reconoce por el hash de su contenido, así que en una lista reordenada cada elemento recupera su propio artículo.
- **Si el valor ya no está.** Si se publicó otro contenido, se retiró, o la URL redirige, responde otra ruta, un `401`, `403`, `404` o `410`, o el documento en lugar del payload, no se inserta nada y el documento se carga de nuevo: se ve la página actual, o se llega a donde envíe el servidor, y se pierde el estado de cliente de esa página. Esa recarga ocurre una vez por minuto y URL como mucho. Si no basta, o `sessionStorage` no está disponible, el elemento queda vacío y el error llega a `onNavigationError` o `onError`. Un fallo de red o un `5xx` no recarga: avisa del error y el siguiente render del elemento lo reintenta.
- **Un valor distinto en cada petición.** Una fecha o un identificador aleatorio dentro del HTML hacen que el valor nunca coincida, y volver a pintar el elemento acaba como en el caso anterior. Si la página vuelve a pintar ese elemento, no lo marque. En una página prerenderizada, el documento y el archivo salen de dos ejecuciones del loader, así que también deben dar el mismo HTML.
- **Prerender y hosts estáticos.** El archivo `index.meeko.json` guarda el valor completo y su declaración; el documento, el marcador.
- **Caché.** El documento y su payload son una sola respuesta. Un documento antiguo en caché muestra su contenido y se hidrata igual, y la siguiente navegación recibe lo último que se publicó. Si esa página vuelve a pintar el elemento, el documento se carga de nuevo.
- **CSP.** No añade código en línea: el payload sigue siendo un bloque de datos, y `script-src` no necesita `unsafe-inline`.
