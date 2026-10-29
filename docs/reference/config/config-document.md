---
title: document
group: config
since: 1.2.0
description: El documento HTML común de la aplicación, con el lang de html, las etiquetas de head de todas las páginas, la canónica y Open Graph por página y el prefijo de useId.
symbols:
  - "config:document"
types:
  - "@meekojs/meeko/framework#DocumentConfig"
  - "@meekojs/meeko/framework#DocumentSeo"
related:
  - "@meekojs/meeko/framework#useHead"
  - "@meekojs/meeko/framework#useSeoMeta"
  - "@meekojs/meeko#useId"
  - "config:site"
  - "config:theme"
  - docs/framework.md#head-del-documento-document-usehead-y-useseometa
  - docs/framework.md#canónica-y-open-graph-por-página
---

`document` declara lo que comparten todos los documentos HTML de la aplicación: el `lang` de `<html>` y un `head` con título, plantilla de título, `meta`, `link`, `script`, `style` y atributos de `<html>` y `<body>`. Se renderiza en SSR, `"stream"`, `"prerender"`, las páginas de error y el shell de las rutas `"client"`, con la menor prioridad: `useHead`, `useSeoMeta` y el `head` de cada página la sustituyen.

Además, `document.seo` (desde `1.3`) añade a cada página su `<link rel="canonical">` y sus `og:url`, `og:title` y `og:description`, y `document.idPrefix` (desde `1.5`) cambia el prefijo de los IDs de `useId` y `form.field`.

## Uso

```ts
// meeko.config.ts
import { defineMeekoConfig } from "@meekojs/meeko/framework";

export default defineMeekoConfig({
  site: "https://example.com",
  document: {
    lang: "es",
    head: {
      title: "Mi tienda",            // páginas sin título propio
      titleTemplate: "%s · Mi tienda",
      link: [{ rel: "icon", href: "/favicon.svg", type: "image/svg+xml" }],
      meta: [{ name: "theme-color", content: "#0f172a" }],
    },
    seo: true,
  },
});
```

## Opciones

| Opción | Tipo | Por defecto | Descripción |
| --- | --- | --- | --- |
| `lang` | `string` | ninguno | Atributo `lang` de `<html>`; `head.htmlAttrs.lang` tiene prioridad. |
| `head` | `DocumentHead` | ninguno | `title`, `titleTemplate` (una cadena con `%s`), `meta`, `link`, `script`, `style`, `htmlAttrs` y `bodyAttrs`. Debe ser serializable. |
| `seo` | `boolean \| DocumentSeo` | ninguno | Desde `1.3`. `true` activa `canonical`, `ogUrl`, `ogTitle` y `ogDescription`; un objeto desactiva las que valen `false` y puede fijar `origin`. |
| `idPrefix` | `string` | `"m"` | Desde `1.5`. Prefijo de `useId` y `form.field`: una letra seguida de letras, números, `-` o `_`, hasta 32 caracteres. |

## Resultado

| Fuente | Prioridad |
| --- | --- |
| `document.head` de los módulos (`meeko.addHead`) | La menor |
| `document.head` de `meeko.config.ts` | Gana a los módulos |
| `document.seo` | Etiquetas derivadas de cada página, con la misma prioridad |
| `useHead`, `useSeoMeta` y el `head` de la ruta | Ganan a todo lo anterior |

Con `seo: true` y `site: "https://example.com"`, una página `/docs/api` titulada «API» recibe:

```html
<title>API · Mi tienda</title>
<link rel="canonical" href="https://example.com/docs/api">
<meta property="og:url" content="https://example.com/docs/api">
<meta property="og:title" content="API · Mi tienda">
```

`canonical` no lleva la query string, y las páginas de error no reciben `canonical` ni `og:url`.

## Ejemplos

### Un script antes de pintar, compatible con la CSP

```ts
import { defineMeekoConfig } from "@meekojs/meeko/framework";

export default defineMeekoConfig({
  document: {
    head: { script: [{ children: "document.documentElement.dataset.js = 'on'" }] },
  },
});
```

Con `server.contentSecurityPolicy` (desde `1.7`), el script lleva el nonce de cada respuesta SSR y su hash en las páginas prerenderizadas, sin `'unsafe-inline'`.

### Sólo la canónica

```ts
import { defineMeekoConfig } from "@meekojs/meeko/framework";

export default defineMeekoConfig({
  site: "https://example.com",
  document: { seo: { ogUrl: false, ogTitle: false, ogDescription: false } },
});
```

### Dos aplicaciones Meeko en la misma página

```ts
import { defineMeekoConfig } from "@meekojs/meeko/framework";

export default defineMeekoConfig({ document: { idPrefix: "shop" } });
```

## Errores comunes

### Una función en `titleTemplate`

```ts bad
export default defineMeekoConfig({ document: { head: { titleTemplate: (title: string) => `${title} · Mi tienda` } } as never });
```

`document` se fija en el build y termina en el HTML: `meeko check` da un error de tipos y `meeko dev`, `meeko build` y `meeko routes` se detienen con `…/meeko.config.ts: document.head: titleTemplate must be a string here, since it is serialized`.

```ts good
import { defineMeekoConfig } from "@meekojs/meeko/framework";
export default defineMeekoConfig({ document: { head: { titleTemplate: "%s · Mi tienda" } } });
```

### El tema dentro de `document`

```ts bad
export default defineMeekoConfig({ document: { theme: { themes: ["light", "dark"] } } as never });
```

`…/meeko.config.ts: document.theme no es una opción de meeko.config.ts; use theme en el nivel superior`.

```ts good
import { defineMeekoConfig } from "@meekojs/meeko/framework";
export default defineMeekoConfig({ theme: { themes: ["light", "dark"] } });
```

### `seo` sin origen

```ts bad
export default defineMeekoConfig({ document: { seo: true } }); // sin site ni MEEKO_PUBLIC_ORIGIN
```

`meeko build` se detiene antes de compilar con `document.seo (canonical y og:url) necesita la URL pública del sitio: declara site en meeko.config.ts (site: "https://example.com") o define MEEKO_PUBLIC_ORIGIN al construir`. En `meeko dev` sin origen, esas dos etiquetas no se escriben.

```ts good
import { defineMeekoConfig } from "@meekojs/meeko/framework";
export default defineMeekoConfig({ site: "https://example.com", document: { seo: true } });
```

## Notas

- **Público.** `document` llega al bundle del navegador, porque termina en el HTML: no ponga secretos.
- **Seguridad.** `script` y `style` se escriben tal cual en `<head>`: no interpole datos de usuarios ni de la petición.
- **Desarrollo.** Cambiar `meeko.config.ts` exige reiniciar `meeko dev`.
