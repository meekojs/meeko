---
title: robots
group: config
since: 1.3.0
description: Escribe robots.txt en el build con las reglas de User-agent asterisco y, con sitemap, la URL absoluta del sitemap.
symbols:
  - "config:robots"
types:
  - "@meekojs/meeko/framework#RobotsConfig"
related:
  - "config:sitemap"
  - "config:site"
  - docs/framework.md#sitemapxml-y-robotstxt
---

`robots` hace que `meeko build` escriba `robots.txt` con las reglas para `User-agent: *`: sus `allow` y `disallow` (`Allow: /` sin ninguna) y, si `sitemap` está activo, la línea `Sitemap:` con su URL absoluta. Vale para todos los adaptadores: en Node, Bun, Deno y Workers se sirve como un archivo público más, con `ETag`.

## Uso

```ts
// meeko.config.ts
import { defineMeekoConfig } from "@meekojs/meeko/framework";

export default defineMeekoConfig({
  site: "https://example.com",
  sitemap: true,
  robots: { disallow: ["/admin/"] }, // o robots: true
});
```

## Opciones

| Opción | Tipo | Por defecto | Descripción |
| --- | --- | --- | --- |
| `allow` | `readonly string[]` | `["/"]` si no hay `disallow` | Prefijos permitidos (`Allow:`). |
| `disallow` | `readonly string[]` | `[]` | Prefijos prohibidos (`Disallow:`). |

Cada entrada empieza por `/`, sin espacios, `?` ni `#`. `robots: true` equivale a `{}`.

## Resultado

```text
User-agent: *
Disallow: /admin/
Sitemap: https://example.com/sitemap.xml
```

Con `robots: true` y sin `sitemap`:

```text
User-agent: *
Allow: /
```

## Ejemplos

### Un entorno de pruebas que no se indexa

```ts
import { defineMeekoConfig } from "@meekojs/meeko/framework";

const staging = process.env.DEPLOY_ENV === "staging";
export default defineMeekoConfig({
  robots: staging ? { disallow: ["/"] } : true,
});
```

### Permitir una carpeta dentro de otra prohibida

```ts
import { defineMeekoConfig } from "@meekojs/meeko/framework";

export default defineMeekoConfig({ robots: { disallow: ["/cuenta/"], allow: ["/cuenta/ayuda/"] } });
```

## Errores comunes

### Un campo mal escrito

```ts bad
export default defineMeekoConfig({ robots: { disalow: ["/admin/"] } as never });
```

`meeko dev`, `meeko build`, `meeko check` y `meeko routes` se detienen con `…/meeko.config.ts: robots: campo desconocido disalow`.

```ts good
import { defineMeekoConfig } from "@meekojs/meeko/framework";
export default defineMeekoConfig({ robots: { disallow: ["/admin/"] } });
```

### Una ruta sin `/` inicial

```ts bad
export default defineMeekoConfig({ robots: { disallow: ["admin"] } });
```

`…/meeko.config.ts: robots.disallow debe ser un array de cadenas no vacías que empiecen por /`.

```ts good
import { defineMeekoConfig } from "@meekojs/meeko/framework";
export default defineMeekoConfig({ robots: { disallow: ["/admin"] } });
```

### Un `public/robots.txt`

```text bad
public/robots.txt   y   robots: true
```

`meeko build` se detiene con `El archivo público robots.txt (de public/ o de un módulo) choca con el que genera la opción robots de meeko.config.ts; quita uno de los dos`.

```text good
Borre public/robots.txt y declare sus reglas en robots
```

## Notas

- **No es seguridad.** `Disallow` es una petición a los rastreadores, no una protección: proteja `/admin` con sesión y middleware de servidor.
- **Origen.** `robots` sin `sitemap` no necesita `site`.
- **Páginas concretas.** Para que una página no se indexe, use `<meta name="robots" content="noindex">` con `useSeoMeta`; si es prerenderizada, además sale del sitemap.
