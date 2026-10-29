---
title: meeko prerender
group: commands
since: 1.0.0
description: Vuelve a prerenderizar las rutas render "prerender" sobre el build de Node existente, sin recompilar, y escribe .meeko/output/node/prerender/.
symbols:
  - "cli:prerender"
related:
  - "cli:build"
  - "@meekojs/meeko/build#prerenderRoutes"
  - "@meekojs/meeko/framework#definePage"
  - docs/framework.md#modos-de-render
---

`meeko prerender` importa el servidor de `.meeko/output/node/index.mjs`, lo crea con `prerendering: true` y renderiza cada URL de las rutas `render: "prerender"` (con `prerenderEntries` en las dinámicas). Borra y vuelve a escribir `.meeko/output/node/prerender/`: el HTML de cada página, su payload de navegación (`index.meeko.json`) y el índice `manifest.json`. Imprime la ruta de cada HTML escrito.

[`meeko build`](/docs/reference/meeko-build) ya prerenderiza; este comando sirve para regenerar las páginas cuando cambian los datos que leen sus loaders, sin volver a compilar el cliente ni el servidor.

## Uso

```sh
meeko build .
meeko prerender .
```

```text
C:\proyectos\tienda\.meeko\output\node\prerender\index.html
```

## Parámetros

| Parámetro | Tipo | Por defecto | Descripción |
| --- | --- | --- | --- |
| `<directorio>` | ruta | obligatorio | Raíz del proyecto, con un build de Node en `.meeko/output/node/`. Sin él, `Falta el directorio de prerender`. |

Los loaders se ejecutan en este proceso: leen `process.env` tal como esté al ejecutar el comando (la CLI no lee el `.env` del proyecto en `prerender`).

## Resultado

- `.meeko/output/node/prerender/<ruta>/index.html` y `<ruta>/index.meeko.json` por página, y `manifest.json` con el archivo, el `ETag`, el desplazamiento del `<head>` y los hashes de los scripts y estilos en línea de cada una, con los que el servidor completa la CSP de esas páginas (con `server.contentSecurityPolicy`, desde `1.7`).
- Una línea por HTML escrito en la salida estándar. Código `0`, o `1` con el error si una página falla.

El servidor que está en marcha lee el índice al arrancar y guarda en memoria cada página la primera vez que la sirve: tras `meeko prerender`, reinicia `meeko start` para que sirva las nuevas.

## Ejemplos

### Regenerar el blog cada noche

```sh
# cron, en el servidor
cd /srv/blog && npx meeko prerender . && systemctl restart blog
```

```ts
// app/pages/blog/[slug].route.ts
import { definePage } from "@meekojs/meeko/framework";

export const route = definePage({
  render: "prerender",
  prerenderEntries: async () => [{ slug: "hola-meeko" }, { slug: "senales" }],
  load: ({ params }) => ({ slug: params.slug ?? "" }),
});
```

`prerenderEntries` se evalúa de nuevo, así que un artículo nuevo que devuelva la función aparece sin otro build.

### Ver qué rutas se prerenderizan

```sh
meeko prerender . | wc -l
```

En PowerShell: `(meeko prerender .).Count`.

## Errores comunes

### Sin build de Node

```sh bad
meeko clean
meeko prerender .
```

```text
No hay build de producción en C:\proyectos\tienda\.meeko\output\node\index.mjs; ejecuta meeko build
```

```sh good
meeko build .
meeko prerender .
```

### Con otro adaptador

`meeko prerender` sólo trabaja sobre `.meeko/output/node/`. Con `adapter: "static"`, `bun`, `deno` o `cloudflare`, el build no escribe esa carpeta (prerenderiza con un servidor intermedio en `.meeko/build/node/`) y el comando falla igual:

```sh bad
# server: { adapter: "static" }
meeko build .
meeko prerender .
```

`No hay build de producción en …\.meeko\output\node\index.mjs; ejecuta meeko build`.

```sh good
# vuelve a construir: prerenderiza y copia las páginas a la salida del adaptador
meeko build .
```

### Una ruta dinámica sin `prerenderEntries`

```ts bad
// app/pages/blog/[slug].route.ts
import { definePage } from "@meekojs/meeko/framework";

export const route = definePage({ render: "prerender" });
```

`Dynamic prerender route /blog/[slug] requires prerenderEntries`, también en `meeko build`.

```ts good
// app/pages/blog/[slug].route.ts
import { definePage } from "@meekojs/meeko/framework";

export const route = definePage({ render: "prerender", prerenderEntries: [{ slug: "hola-meeko" }] });
```

## Notas

- **Sólo HTML `200`.** Una página que responde con otro estado, o que no es HTML, detiene el prerender con el error; nada se sirve a medias.
- **Middleware.** El render no ejecuta el middleware de servidor (`server/middleware`), que se ejecuta al servir la página; el middleware de ruta sí se ejecuta.
- **Sin el sitemap ni los hooks.** El comando sólo regenera las páginas: no actualiza `sitemap.xml` (que está en `client/`) ni evalúa `sitemapEntries`. Si cambian las URL, ejecuta `meeko build`. Los módulos sí reciben el hook `prerender:routes`.
- **Rendimiento.** Las URL se renderizan con la aplicación ya construida, sin Vite: es mucho más rápido que un build completo.
- **Mensajes.** A diferencia del resto de la CLI, el error de build ausente está en inglés.
