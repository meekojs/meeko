---
title: useHead
group: composables
since: 1.2.0
description: Añade el título, etiquetas meta, link, script y style y atributos de html y body al documento mientras el componente está montado.
symbols:
  - "@meekojs/meeko/framework#useHead"
types:
  - "@meekojs/meeko/framework#HeadInput"
related:
  - "@meekojs/meeko/framework#useSeoMeta"
  - "@meekojs/meeko/framework#definePage"
  - "syntax:script-server"
  - "config:document"
  - docs/framework.md#head-del-documento-document-usehead-y-useseometa
  - docs/framework.md#canónica-y-open-graph-por-página
---

`useHead(input)` declara lo que un componente aporta al `<head>`: el título, etiquetas `<meta>`, `<link>`, `<script>` y `<style>`, y atributos de `<html>` y `<body>`. Meeko combina las entradas de `document` en `meeko.config.ts`, `app/app.meeko`, los layouts, la página y sus componentes, y el `head` de la ruta con una sola regla de prioridad, y quita las de un componente cuando éste se desmonta.

En el servidor las escribe en el HTML; en el navegador la hidratación adopta esas mismas etiquetas sin duplicarlas, y un getter o una señal actualizan el documento cuando cambian. Se autoimporta en las aplicaciones.

## Uso

```html
<!-- app/pages/inbox.meeko -->
<script lang="ts">
const unread = signal(3);
useHead(() => ({
  title: unread.value ? `(${unread.value}) Bandeja de entrada` : "Bandeja de entrada",
  meta: [{ name: "robots", content: "noindex" }],
}));
</script>

<template><button on:click="() => unread.value = 0">Marcar como leídos</button></template>
```

Al pulsar el botón, el título del documento cambia sin recargar.

## Parámetros

| Parámetro | Tipo | Por defecto | Descripción |
| --- | --- | --- | --- |
| `input` | `HeadInput`, `ReadonlySignal<HeadInput>` o `() => HeadInput` | obligatorio | Lo que aporta el componente. Con un getter o una señal, el navegador vuelve a aplicarlo cuando cambian las señales que lee. |

`HeadInput` admite:

| Campo | Tipo | Descripción |
| --- | --- | --- |
| `title` | `string` | Título del documento. Gana el de más prioridad. |
| `titleTemplate` | `string` o `(title) => string` | Plantilla del título: `"%s · Mi sitio"`. En `document.head`, `meeko.addHead` y el `head` de la ruta sólo una cadena. |
| `meta` | `HeadMeta[]` | `{ name?, property?, httpEquiv?, content, media?, key? }`. |
| `link` | `HeadLink[]` | `{ rel, href, hreflang?, type?, media?, sizes?, as?, crossorigin?, key? }`. |
| `script` | `HeadScript[]` | Externo con `src` o en línea con `children`; `async`, `defer`, `module`, `type`. |
| `style` | `HeadStyle[]` | `{ children, media?, key? }`. |
| `htmlAttrs`, `bodyAttrs` | `Record<string, string \| undefined>` | Atributos de `<html>` y `<body>` (`lang`, `dir`, `class`, `data-*`). `undefined` no aporta nada; los `on*` se rechazan en ejecución y, desde `1.7`, los de los eventos del DOM (`onclick`, `onload`…) también en los tipos. |

## Valor devuelto

`void`. Fuera de una aplicación de Meeko (por ejemplo, en una prueba unitaria con `renderToString`) no hace nada.

## Ejemplos

### Un título reactivo desde los datos de la página

```html
<!-- app/pages/products/[id].meeko -->
<script server lang="ts">
const { params } = usePage();
export const product = await findProduct(params.id);
</script>

<script lang="ts">
const quantity = signal(1);
useHead(() => ({ title: `${product.name} (${quantity.value})` }));
</script>
```

### Datos estructurados para buscadores

Un script `application/ld+json` en línea; Meeko escapa cada `<` para que el contenido no pueda cerrar la etiqueta:

```html
<script lang="ts">
const props = defineProps<{ data: { title: string; author: string; publishedAt: string } }>();
useHead(() => ({
  script: [{
    type: "application/ld+json",
    children: JSON.stringify({ "@context": "https://schema.org", "@type": "Article", headline: props.data.title, author: props.data.author, datePublished: props.data.publishedAt }),
  }],
}));
</script>
```

### Atributos de `<html>` y `<body>` desde un layout

```html
<!-- app/layouts/docs.meeko -->
<script lang="ts">
const sidebarOpen = signal(false);
useHead(() => ({
  htmlAttrs: { lang: "es", class: "docs" },
  bodyAttrs: { "data-sidebar": sidebarOpen.value ? "open" : undefined },
}));
</script>

<template><main><MeekoOutlet /></main></template>
```

### Un composable de head reutilizable

`useHead` puede llamarse dentro de un composable que el script invoca:

```ts
// app/composables/useNoIndex.ts
import { useHead } from "@meekojs/meeko/framework";

export function useNoIndex(): void {
  useHead({ meta: [{ name: "robots", content: "noindex, nofollow", key: "robots" }] });
}
```

### En `<script server>`

En el código de nivel superior del bloque de servidor, `useHead` forma parte del `head` de la ruta, la entrada de más prioridad:

```html
<script server lang="ts">
const { params } = usePage();
const post = await posts.find(params.slug);
useHead({ title: post.title, link: [{ rel: "canonical", href: `https://example.com/blog/${post.slug}` }] });
export const body = post.html;
</script>
```

## Errores comunes

### Un objeto que lee señales una sola vez

```ts bad
const count = signal(0);
useHead({ title: `${count.value} elementos` });
```

`meeko check` lo acepta, pero el título se calcula una vez, al ejecutar el script: cambiar `count` no lo actualiza. Pasa un getter para que el título siga a la señal:

<!-- no-check -->
```ts good
useHead(() => ({ title: `${count.value} elementos` }));
```

### Una etiqueta `meta` sin `content`

```ts bad
useHead({ meta: [{ name: "description" }] });
```

`meeko check` da `TS2741: Property 'content' is missing in type '{ name: string; }' but required in type 'HeadMeta'`. Una descripción se escribe más corto con [`useSeoMeta`](/docs/reference/useseometa):

<!-- no-check -->
```ts good
useHead({ meta: [{ name: "description", content: "Planes y precios" }] });
```

### Manejadores de eventos en los atributos

```ts bad
useHead({ bodyAttrs: { onload: "init()" } });
```

Desde `1.7`, `meeko check` da `TS2322: Type 'string' is not assignable to type 'never'.` en los manejadores de los eventos del DOM (`onload`, `onclick`…). Cualquier otro atributo `on*` (`onLoad`, `onmievento`) pasa los tipos, pero Meeko lo rechaza en ejecución: `TypeError: useHead.bodyAttrs: event handler attribute onLoad is not allowed`. El código va en el script del componente:

<!-- no-check -->
```ts good
onMounted(() => init());
```

### Una función en `titleTemplate` de la configuración

`document` de `meeko.config.ts` se fija en el build como JSON.

```ts bad
export default defineMeekoConfig({ document: { head: { titleTemplate: (title) => `${title} · Mi sitio` } } });
```

`meeko check` da `TS2322: Type '(title: string) => string' is not assignable to type 'string'` en `meeko.config.ts`, porque `DocumentHead` sólo admite una cadena. Usa `%s`, o la función en un `useHead` de `app/app.meeko`:

<!-- no-check -->
```ts good
export default defineMeekoConfig({ document: { head: { titleTemplate: "%s · Mi sitio" } } });
```

## Notas

- **Prioridad.** De menor a mayor: `document` de la configuración, `app/app.meeko`, cada layout (el más interno gana), la página con sus componentes y el `head` de la ruta (`export const head`, `route.head` o `useHead` en `<script server>`). Dentro de un mismo nivel gana la llamada posterior. Los atributos de `<html>` y `<body>` se combinan por nombre con la misma prioridad.
- **Deduplicación.** Cada etiqueta tiene una clave: `key` si la declara o su clave natural (`name`, `property` o `httpEquiv` en `meta`, con su `media`; `rel` y `href` en `link`, salvo `canonical` e `icon`, que son únicos; `src` o el código en `script`; el CSS en `style`). Con la misma clave sólo queda la de más prioridad.
- **SSR.** Las etiquetas gestionadas van en `<head>` entre `<!--meeko:head-->` y `<!--/meeko:head-->`, con los atributos escapados y el nonce CSP de la petición en `<script>` y `<style>`.
- **Navegación.** Al navegar, las entradas de los componentes que se desmontan desaparecen y vuelve lo que habían sustituido; al volver atrás, la página restaura las suyas. Un script que cambia es un elemento nuevo, que el navegador ejecuta.
- **Seguridad.** El contenido de `script` y `style` en línea no se escapa como HTML: no metas ahí texto del usuario sin validar. Los valores de los atributos sí se escapan.
- **Pasada en seco.** En el render previo de una navegación del cliente, `useHead` no hace nada; lo aplica el render que se confirma.
