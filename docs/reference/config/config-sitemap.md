---
title: sitemap
group: config
since: 1.3.0
description: Escribe sitemap.xml en el build con las páginas prerenderizadas, las rutas sin parámetros y, desde 1.7, las URL de sitemapEntries de las rutas dinámicas.
symbols:
  - "config:sitemap"
types:
  - "@meekojs/meeko/framework#SitemapConfig"
  - "@meekojs/meeko/framework#SitemapEntry"
  - "@meekojs/meeko/framework#SitemapEntriesContext"
related:
  - "config:site"
  - "config:robots"
  - "@meekojs/meeko/framework#definePage"
  - docs/framework.md#sitemapxml-y-robotstxt
  - docs/framework.md#rutas-dinámicas-en-el-sitemap-sitemapentries
---

`sitemap` hace que `meeko build` escriba `sitemap.xml` (protocolo sitemaps.org 0.9) con la URL absoluta de cada página prerenderizada y de cada ruta sin parámetros, sea `"ssr"`, `"stream"` o `"client"`. Se omiten las rutas de `exclude` y las páginas prerenderizadas con `<meta name="robots" content="noindex">` (o `none`).

Desde `1.7`, una ruta dinámica con render en el servidor declara sus URL con `sitemapEntries` en `definePage`, con `lastmod`, `changefreq` y `priority` opcionales. Las URL necesitan el origen público: `site` o `MEEKO_PUBLIC_ORIGIN` del build.

## Uso

```ts
// meeko.config.ts
import { defineMeekoConfig } from "@meekojs/meeko/framework";

export default defineMeekoConfig({
  site: "https://example.com",
  sitemap: { exclude: ["/admin", "/admin/*"] }, // o sitemap: true
});
```

## Opciones

| Valor | Tipo | Por defecto | Descripción |
| --- | --- | --- | --- |
| `sitemap` | `boolean \| { exclude? }` | sin sitemap | `true` o un objeto lo activan. |
| `exclude` | `readonly string[]` | `[]` | Rutas (`pathname`) que no se listan. Empiezan por `/`, sin espacios, `?` ni `#`; `*` sustituye a cualquier secuencia, `/` incluida: `"/admin/*"` excluye lo que hay bajo `/admin/`, no `/admin`. |

`sitemapEntries` de `definePage` (desde `1.7`): una lista de `{ params?, lastmod?, changefreq?, priority? }`, o una función, síncrona o asíncrona, que recibe `{ env, prerendering: true }` y la devuelve.

## Resultado

`sitemap.xml` en los archivos públicos del build, servido como los demás en Node, Bun, Deno y Workers, y escrito en la carpeta del adaptador `static`:

```xml
<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
  <url><loc>https://example.com/</loc></url>
  <url><loc>https://example.com/docs/instalacion</loc><lastmod>2026-10-01</lastmod><changefreq>monthly</changefreq><priority>0.8</priority></url>
</urlset>
```

## Ejemplos

### Rutas dinámicas con SSR (desde 1.7)

```ts
// app/pages/docs/[slug].route.ts
import { definePage } from "@meekojs/meeko/framework";

const docs = [{ slug: "instalacion", updatedAt: "2026-10-01", draft: false }];

export const route = definePage({
  sitemapEntries: ({ env }) => docs
    .filter((doc) => env.DOCS_DRAFTS === "1" || !doc.draft)
    .map((doc) => ({ params: { slug: doc.slug }, lastmod: doc.updatedAt, changefreq: "weekly" as const })),
});
```

`meeko build` la evalúa una vez, después de prerenderizar, en el servidor de Node intermedio: el runtime existe con `prerendering: true`, pero no hay petición, sesión ni `services` por petición.

### Completar las páginas prerenderizadas

```ts
// app/pages/blog/[slug].route.ts
import { definePage } from "@meekojs/meeko/framework";

export const route = definePage({
  render: "prerender",
  prerenderEntries: [{ slug: "hola-meeko" }],
  sitemapEntries: [{ params: { slug: "hola-meeko" }, lastmod: new Date("2026-09-15"), priority: 0.6 }],
});
```

Con `"prerender"`, `sitemapEntries` sólo añade `lastmod`, `changefreq` y `priority` a las URL que ya se prerenderizan.

### Junto a `robots.txt`

```ts
import { defineMeekoConfig } from "@meekojs/meeko/framework";

export default defineMeekoConfig({ site: "https://example.com", sitemap: true, robots: { disallow: ["/admin/"] } });
// robots.txt termina con «Sitemap: https://example.com/sitemap.xml»
```

## Errores comunes

### Sin origen público

```text bad
sitemap: true, sin site ni MEEKO_PUBLIC_ORIGIN al construir
```

`meeko build` se detiene antes de compilar con `sitemap necesita la URL pública del sitio: declara site en meeko.config.ts (site: "https://example.com") o define MEEKO_PUBLIC_ORIGIN al construir`.

```ts good
import { defineMeekoConfig } from "@meekojs/meeko/framework";
export default defineMeekoConfig({ site: "https://example.com", sitemap: true });
```

### Un patrón sin `/` inicial

```ts bad
export default defineMeekoConfig({ site: "https://example.com", sitemap: { exclude: ["admin"] } });
```

`meeko dev`, `meeko build`, `meeko check` y `meeko routes` se detienen con `…/meeko.config.ts: sitemap.exclude debe ser un array de cadenas no vacías que empiecen por /`.

```ts good
import { defineMeekoConfig } from "@meekojs/meeko/framework";
export default defineMeekoConfig({ site: "https://example.com", sitemap: { exclude: ["/admin", "/admin/*"] } });
```

### Un `public/sitemap.xml` (o el de un módulo)

```text bad
public/sitemap.xml   y   sitemap: true
```

`meeko build` se detiene con `El archivo público sitemap.xml (de public/ o de un módulo) choca con el que genera la opción sitemap de meeko.config.ts; quita uno de los dos`.

```text good
Borre public/sitemap.xml, o quite sitemap de meeko.config.ts
```

### Una entrada que no se prerenderiza

```ts bad
export const route = definePage({
  render: "prerender",
  prerenderEntries: [{ slug: "a" }],
  sitemapEntries: [{ params: { slug: "b" } }],
});
```

`meeko build` se detiene con `sitemapEntries of route /blog/[slug] lists /blog/b, which is not prerendered: add it to prerenderEntries or remove it`: el sitemap nunca anuncia una URL que el adaptador `static` no tiene.

<!-- no-check -->
```ts good
export const route = definePage({ render: "prerender", prerenderEntries: [{ slug: "a" }, { slug: "b" }], sitemapEntries: [{ params: { slug: "b" } }] });
```

### Valores fuera del protocolo

```ts bad
sitemapEntries: [{ params: { slug: "a" }, priority: 2, changefreq: "sometimes" as never }],
```

El build se detiene con la ruta y `priority must be a number from 0 to 1` o `changefreq must be always, hourly, daily, weekly, monthly, yearly or never`. Un `lastmod` que no es un `Date` válido ni un texto W3C Datetime da `lastmod must be a Date or a W3C Datetime text, such as "2026-10-01" or "2026-10-01T12:00:00Z"`, y una URL repetida, `duplicate sitemap URL`.

<!-- no-check -->
```ts good
sitemapEntries: [{ params: { slug: "a" }, priority: 0.8, changefreq: "monthly", lastmod: "2026-10-01" }],
```

## Notas

- **`render: "client"`.** Sus opciones llegan al navegador, así que no admite `sitemapEntries`: es un error de tipos y detiene `meeko dev`, `meeko build` y `meeko check`.
- **Spread.** Meeko sólo carga las opciones de las rutas que nombran `sitemapEntries`: escríbala en el objeto de `definePage`, no a través de un spread.
- **Datos.** La función se ejecuta en el build: si lee una base de datos, debe estar accesible al construir. Nunca recibe datos de una petición.
- **`exclude` y `noindex` ganan** a `sitemapEntries`.
- **Coste.** En Node, el sitemap obliga a compilar el servidor una vez más, porque lista las páginas prerenderizadas.
