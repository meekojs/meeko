---
title: prerenderRoutes
group: advanced
since: 1.0.0
description: Prerenderiza las rutas render "prerender" con un handler de páginas y escribe su HTML, su payload de navegación y el índice manifest.json.
symbols:
  - "@meekojs/meeko/build#prerenderRoutes"
types:
  - "@meekojs/meeko/build#PrerenderOptions"
  - "@meekojs/meeko/build#PrerenderIndex"
related:
  - "cli:prerender"
  - "@meekojs/meeko/build#buildProject"
  - "@meekojs/meeko/server#createFrameworkHandler"
  - "@meekojs/meeko/framework#definePage"
  - docs/framework.md#modos-de-render
  - docs/framework.md#csp-con-hashes
---

`prerenderRoutes` es el motor de prerender de `meeko build`, sin el build: recorre las rutas `render: "prerender"`, genera sus URL (una por ruta estática y una por cada entrada de `prerenderEntries` en las dinámicas), pide cada una a tu `handler` y escribe en `outputRoot` el HTML de las respuestas `200`, su payload de navegación (`index.meeko.json`) y un `manifest.json` con el archivo, el `ETag` y los hashes de scripts y estilos en línea de cada página.

Sirve para prerenderizar con un host propio (por ejemplo, con [`createFrameworkHandler`](/docs/reference/createframeworkhandler)) o para generar un sitio estático desde un script.

## Uso

```ts
import { prerenderRoutes } from "@meekojs/meeko/build";
import { createFrameworkHandler } from "@meekojs/meeko/server";
import type { PageModule, PageRoute } from "@meekojs/meeko/server";

const page = (title: string): PageModule => ({ renderWithState: () => ({ html: `<h1>${title}</h1>`, state: {} }) });
const routes = [
  { id: "/", file: "index.meeko", layouts: [], render: "prerender" as const },
  { id: "/blog/[slug]", file: "post.meeko", layouts: [], render: "prerender" as const, sidecar: "post.route.ts" },
];
const pages: Record<string, PageModule> = { "index.meeko": page("Inicio"), "post.meeko": page("Artículo") };
const sidecars: Record<string, PageRoute> = { "post.route.ts": { render: "prerender", prerenderEntries: [{ slug: "hola" }, { slug: "adios" }] } };
const loadRoute = async (file: string) => sidecars[file]!;

const files = await prerenderRoutes({
  routes,
  handler: createFrameworkHandler({ routes, loadPage: async (file) => pages[file]!, loadRoute }),
  loadRoute,
  outputRoot: "dist/prerender",
});
console.log(files); // [ ".../dist/prerender/index.html", ".../blog/hola/index.html", ".../blog/adios/index.html" ]
```

## Opciones

| Opción | Tipo | Por defecto | Descripción |
| --- | --- | --- | --- |
| `routes` | `RouteRecord[]` | obligatorio | El manifiesto de rutas; sólo se renderizan las `render: "prerender"`. |
| `handler` | `(request) => Promise<Response>` | obligatorio | Renderiza una página. No debe ejecutar `server/middleware`, que vuelve a ejecutarse al servir el archivo. |
| `outputRoot` | ruta | obligatorio | Carpeta de salida del HTML, los payloads y `manifest.json`. |
| `loadRoute` | `(file) => Promise<PageRoute>` | ninguno | Carga el sidecar de una ruta para leer `render` y `prerenderEntries`. Sin él, sólo cuenta `RouteRecord.render`. |
| `origin` | origen | `http://meeko.local` | Origen de las peticiones de render. |
| `transformHtml` | `(html) => string \| Promise<string>` | ninguno | Transforma el HTML antes de guardarlo. |
| `extendUrls` | `(urls) => void \| Promise<void>` | ninguno | Desde `1.2`. Recibe las URL y puede añadir o quitar; cada una añadida debe tener ruta. Es el hook `prerender:routes` de los módulos. |

## Valor devuelto

Una promesa con las rutas absolutas de los HTML escritos. En `outputRoot` quedan, por página, `<ruta>/index.html` (la raíz es `index.html`) y `<ruta>/index.meeko.json`, y un `manifest.json`:

```json
{"version":1,"pages":{"/":{"file":"index.html","headOffset":147,"etag":"\"pAsBx…\"","payload":"index.meeko.json","scriptHashes":[],"styleHashes":[]}}}
```

Rechaza si una ruta dinámica no tiene `prerenderEntries` (`Dynamic prerender route /blog/[slug] requires prerenderEntries`), una URL se repite o la atiende otra ruta, una página no responde HTML `200`, o una ruta `render: "client"` declara `prerenderEntries`. Si `handler` rechaza, el mensaje incluye la URL, el archivo de la ruta y la pila del error, que queda en `cause`.

## Ejemplos

### Añadir un pie de página al HTML

<!-- no-check -->
```ts
await prerenderRoutes({
  routes, handler, loadRoute, outputRoot: "dist/prerender",
  transformHtml: (html) => html.replace("</body>", `<!-- generado el ${new Date().toISOString()} --></body>`),
});
```

Los hashes de `manifest.json` se calculan sobre el HTML final, así que un script que añada `transformHtml` entra en la CSP.

### Añadir URL desde un CMS

<!-- no-check -->
```ts
await prerenderRoutes({
  routes, handler, loadRoute, outputRoot: "dist/prerender",
  extendUrls: async (urls) => {
    for (const slug of await cms.listSlugs()) urls.push(`/blog/${slug}`);
  },
});
```

## Errores comunes

### Una ruta dinámica sin entradas

```ts bad
const sidecars = { "post.route.ts": { render: "prerender" } };
```

`Dynamic prerender route /blog/[slug] requires prerenderEntries`: no hay forma de saber qué URL generar.

<!-- no-check -->
```ts good
const sidecars = { "post.route.ts": { render: "prerender", prerenderEntries: async () => (await cms.listSlugs()).map((slug) => ({ slug })) } };
```

### Un handler que ejecuta el middleware de servidor

```ts bad
await prerenderRoutes({ routes, handler: (request) => app.fetch(request), outputRoot });
```

`app.fetch` de `createServerApp` ejecuta `server/middleware` y sirve las páginas ya prerenderizadas. El middleware se ejecutaría dos veces (al prerenderizar y al servir) y un middleware que exige sesión respondería `401`, que detiene el prerender porque sólo se aceptan respuestas `200`.

<!-- no-check -->
```ts good
await prerenderRoutes({ routes, handler: createFrameworkHandler({ routes, loadPage, loadRoute }), loadRoute, outputRoot });
```

### Olvidar `loadRoute` con la opción en el sidecar

```ts bad
await prerenderRoutes({ routes: [{ id: "/about", file: "about.meeko", layouts: [], sidecar: "about.route.ts" }], handler, outputRoot });
```

Sin `loadRoute`, `prerenderRoutes` sólo ve `RouteRecord.render`: una ruta que declara `render: "prerender"` sólo en su sidecar no se prerenderiza y el resultado es `[]`.

<!-- no-check -->
```ts good
await prerenderRoutes({ routes, handler, loadRoute, outputRoot });
```

## Notas

- **Sólo HTML `200`.** Una respuesta con otro estado o sin HTML detiene el prerender; nada se escribe a medias para esa URL.
- **Carpeta de salida.** Escribe sobre `outputRoot` sin vaciarlo; `meeko build` y `meeko prerender` la borran antes.
- **Query string.** Las URL prerenderizadas no llevan query: una petición con `?…` a esa ruta se renderiza con SSR al servirla.
- **CSP.** `scriptHashes` y `styleHashes` de cada página son los que usa el servidor (desde `1.7`, con cualquier adaptador con servidor) y el adaptador `static` para completar `Content-Security-Policy`. Desde `1.7` sólo cubren el código en línea que escribe Meeko fuera de `#app` y de los teleports, así que un `<script>` o `<style>` que llegue con el contenido de la página queda bloqueado.
- **Rendimiento.** Las URL se renderizan una tras otra con el mismo handler; un loader lento retrasa todo el prerender.
