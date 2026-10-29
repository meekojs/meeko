---
title: site
group: config
since: 1.3.0
description: La URL pública del sitio, de la que sólo cuenta el origen, para las URL absolutas de sitemap.xml, robots.txt y document.seo.
symbols:
  - "config:site"
related:
  - "config:sitemap"
  - "config:robots"
  - "config:document"
  - docs/framework.md#sitemapxml-y-robotstxt
  - docs/framework.md#canónica-y-open-graph-por-página
---

`site` es el origen público del sitio (`"https://example.com"`, sin ruta). Es el origen de las URL absolutas que Meeko escribe en el build: las de `sitemap.xml`, la línea `Sitemap:` de `robots.txt` y, con `document.seo`, `<link rel="canonical">` y `og:url`. Sin `site`, el build usa `MEEKO_PUBLIC_ORIGIN` de su entorno.

`site` se fija en el build y no cambia las comprobaciones de `Origin` de HTTP y Socket: esas siguen leyendo `MEEKO_PUBLIC_ORIGIN` o `publicOrigin` de `server/runtime.ts` al ejecutarse.

## Uso

```ts
// meeko.config.ts
import { defineMeekoConfig } from "@meekojs/meeko/framework";

export default defineMeekoConfig({
  site: "https://example.com",
  sitemap: true,
  robots: true,
  document: { seo: true },
});
```

## Opciones

| Valor | Tipo | Por defecto | Descripción |
| --- | --- | --- | --- |
| `site` | `string` | `MEEKO_PUBLIC_ORIGIN` del build | Una URL absoluta `http:` o `https:` sin ruta, query, fragmento ni credenciales. |

## Resultado

Con `site: "https://example.com"`:

```xml
<!-- sitemap.xml -->
<url><loc>https://example.com/docs/api</loc></url>
```

```text
# robots.txt
User-agent: *
Allow: /
Sitemap: https://example.com/sitemap.xml
```

```html
<!-- /docs/api con document.seo -->
<link rel="canonical" href="https://example.com/docs/api">
```

## Ejemplos

### Un origen por entorno

```ts
import { defineMeekoConfig } from "@meekojs/meeko/framework";

export default defineMeekoConfig({
  site: process.env.SITE_URL ?? "https://example.com",
  sitemap: true,
});
```

```sh
SITE_URL=https://staging.example.com npm run build
```

### Sin `site`, con la variable del build

```sh
MEEKO_PUBLIC_ORIGIN=https://example.com npx meeko build
```

La misma variable fija después, en producción, el origen de las comprobaciones de `Origin`.

## Errores comunes

### Una URL con ruta

```ts bad
export default defineMeekoConfig({ site: "https://example.com/blog" });
```

`meeko dev`, `meeko build`, `meeko check` y `meeko routes` se detienen con `…/meeko.config.ts: site must be an origin without path, query, fragment or credentials, such as "https://example.com"`. Un sitio bajo una subruta no se admite.

```ts good
import { defineMeekoConfig } from "@meekojs/meeko/framework";
export default defineMeekoConfig({ site: "https://example.com" });
```

### Un dominio sin esquema

```ts bad
export default defineMeekoConfig({ site: "example.com" });
```

`…/meeko.config.ts: site must be an absolute URL such as "https://example.com"`.

```ts good
import { defineMeekoConfig } from "@meekojs/meeko/framework";
export default defineMeekoConfig({ site: "https://example.com" });
```

### Esperar que `site` arregle las comprobaciones de `Origin`

```text bad
site: "https://example.com" y la aplicación tras un proxy TLS, sin MEEKO_PUBLIC_ORIGIN al ejecutarse
```

Las mutaciones autenticadas responden `403 INVALID_ORIGIN`: `site` sólo se usa en el build. El origen de las comprobaciones de seguridad se fija al ejecutarse.

```text good
MEEKO_PUBLIC_ORIGIN=https://example.com al arrancar el servidor
```

## Notas

- **Sólo build.** Un cambio de `site` exige volver a construir; no se lee en producción.
- **Sin origen.** Con `sitemap`, o con `document.seo` y `canonical` u `ogUrl`, y sin `site` ni `MEEKO_PUBLIC_ORIGIN`, `meeko build` se detiene antes de compilar; `robots` sin `sitemap` no lo necesita.
