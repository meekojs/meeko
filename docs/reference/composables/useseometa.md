---
title: useSeoMeta
group: composables
since: 1.2.0
description: Atajo tipado de useHead para SEO que convierte cada campo (description, Open Graph, Twitter, canonical) en la etiqueta correcta.
symbols:
  - "@meekojs/meeko/framework#useSeoMeta"
types:
  - "@meekojs/meeko/framework#SeoMetaInput"
related:
  - "@meekojs/meeko/framework#useHead"
  - "@meekojs/meeko/framework#definePage"
  - "config:document"
  - "config:site"
  - docs/framework.md#head-del-documento-document-usehead-y-useseometa
  - docs/framework.md#canónica-y-open-graph-por-página
---

Las etiquetas de SEO tienen reglas que es fácil confundir: `description` y las de Twitter van en `<meta name>`, las de Open Graph en `<meta property>`, la URL canónica es un `<link rel="canonical">`. `useSeoMeta(input)` recibe un objeto plano con un campo por etiqueta y produce la correcta para cada uno. Por debajo es [`useHead`](/docs/reference/usehead): se llama en los mismos sitios, sigue su prioridad y su deduplicación, y acepta un getter o una señal para que las etiquetas sigan a los datos.

Se autoimporta en las aplicaciones.

## Uso

```html
<!-- app/pages/blog/[slug].meeko -->
<script server lang="ts">
const { params } = usePage();
export const post = await posts.find(params.slug);
</script>

<script lang="ts">
useSeoMeta({
  title: post.title,
  description: post.summary,
  ogImage: post.cover,
  twitterCard: "summary_large_image",
  canonical: `https://example.com/blog/${post.slug}`,
});
</script>

<template><article><h1>{post.title}</h1></article></template>
```

## Parámetros

| Parámetro | Tipo | Por defecto | Descripción |
| --- | --- | --- | --- |
| `input` | `SeoMetaInput`, `ReadonlySignal<SeoMetaInput>` o `() => SeoMetaInput` | obligatorio | Los campos de SEO. Un campo `undefined` o `null` no produce nada. |

| Campo | Etiqueta |
| --- | --- |
| `title` | `<title>` |
| `description`, `robots`, `author`, `keywords`, `themeColor`, `colorScheme`, `applicationName`, `referrer` | `<meta name="…">` (`theme-color`, `color-scheme`, `application-name`) |
| `ogTitle`, `ogDescription`, `ogImage`, `ogImageAlt`, `ogImageWidth`, `ogImageHeight`, `ogUrl`, `ogType`, `ogSiteName`, `ogLocale` | `<meta property="og:…">` (`og:image:alt`, `og:site_name`…) |
| `twitterCard` (`"summary"`, `"summary_large_image"`, `"app"` o `"player"`), `twitterSite`, `twitterCreator`, `twitterTitle`, `twitterDescription`, `twitterImage`, `twitterImageAlt` | `<meta name="twitter:…">` |
| `canonical` | `<link rel="canonical">` |

`ogImageWidth` y `ogImageHeight` admiten números; el resto, cadenas.

## Valor devuelto

`void`. Fuera de una aplicación de Meeko no hace nada. Dentro de una, un campo que no está en la lista lanza `TypeError: useSeoMeta: unknown field <nombre>` al aplicar las etiquetas.

## Ejemplos

### Las etiquetas de una ficha de producto

```html
<script lang="ts">
const props = defineProps<{ data: { name: string; summary: string; image: string; price: number } }>();
useSeoMeta(() => ({
  title: props.data.name,
  description: props.data.summary,
  ogTitle: props.data.name,
  ogType: "product",
  ogImage: props.data.image,
  ogImageAlt: `Foto de ${props.data.name}`,
  ogImageWidth: 1200,
  ogImageHeight: 630,
}));
</script>
```

Con un getter, las etiquetas cambian al navegar a otro producto aunque el componente se conserve.

### Una página que no se indexa

```ts
import { useSeoMeta } from "@meekojs/meeko/framework";

// En el <script> de app/pages/account/settings.meeko
useSeoMeta({ robots: "noindex, nofollow" });
```

### Canónica y Open Graph automáticos

Para no repetir `canonical`, `ogUrl`, `ogTitle` y `ogDescription` en cada página, `document.seo` las deriva de la URL, el título y la descripción finales:

```ts
// meeko.config.ts
import { defineMeekoConfig } from "@meekojs/meeko/framework";

export default defineMeekoConfig({
  site: "https://example.com",
  document: { seo: true, head: { titleTemplate: "%s · Mi sitio" } },
});
```

Una página que declara la misma etiqueta con `useSeoMeta` sustituye a la derivada.

## Errores comunes

### Un campo mal escrito

```ts bad
useSeoMeta({ title: "Precios", ogimage: "/og/pricing.png" });
```

`meeko check` da `TS2353: Object literal may only specify known properties, and 'ogimage' does not exist in type 'HeadSource<SeoMetaInput>'` y, en ejecución, `TypeError: useSeoMeta: unknown field ogimage`.

<!-- no-check -->
```ts good
useSeoMeta({ title: "Precios", ogImage: "/og/pricing.png" });
```

### Un `twitterCard` que no existe

```ts bad
useSeoMeta({ twitterCard: "large" });
```

`meeko check` da `TS2322: Type '"large"' is not assignable to type '"app" | "player" | "summary" | "summary_large_image" | null | undefined'`.

<!-- no-check -->
```ts good
useSeoMeta({ twitterCard: "summary_large_image" });
```

### Un objeto con datos que cambian

```ts bad
useSeoMeta({ title: props.data.name });
```

El título se fija con el valor de ese momento: si el layout o la página se conservan al navegar y la prop cambia, la etiqueta se queda con el producto anterior. Pasa un getter:

<!-- no-check -->
```ts good
useSeoMeta(() => ({ title: props.data.name }));
```

### Una URL relativa en `ogImage` o `canonical`

```ts bad
useSeoMeta({ ogImage: "/og/home.png", canonical: "/" });
```

No hay error, pero los buscadores y las redes sociales esperan URL absolutas en `og:image` y en la canónica. Usa el origen público del sitio, o `document.seo` para la canónica:

<!-- no-check -->
```ts good
useSeoMeta({ ogImage: "https://example.com/og/home.png", canonical: "https://example.com/" });
```

## Notas

- **SSR.** Las etiquetas salen en el HTML del servidor, que es lo que leen los buscadores y las vistas previas de las redes sociales. Calcúlalas con datos que el SSR ya tiene: los de `<script server>`, `load`, las props o un `await useApi`.
- **Prioridad.** La misma que `useHead`: el `head` de la ruta gana a la página, la página a los layouts y éstos a `document`. Dentro de un nivel, gana la llamada posterior.
- **`description` de la página.** Si el `head` de la ruta (`export const head` o `route.head`) ya declara `description`, ésta gana sobre la de `useSeoMeta` del componente.
- **Escape.** Los valores van en atributos y Meeko los escapa: un título con comillas o `<` es seguro.
