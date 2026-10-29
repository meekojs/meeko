---
title: definePage
group: macros
since: 1.0.0
description: Declara las opciones de ruta de una página (schemas de params y search, modo de render, loader, head, layout, middleware, caché y sitemap) con los tipos encadenados entre ellas.
symbols:
  - "@meekojs/meeko/framework#definePage"
signature: first
types:
  - "@meekojs/meeko/framework#PageDefinition"
  - "@meekojs/meeko/framework#ClientPageDefinition"
  - "@meekojs/meeko/framework#PageLoadContext"
  - "@meekojs/meeko/framework#PageRender"
  - "@meekojs/meeko/framework#PageCache"
  - "@meekojs/meeko/framework#SitemapEntry"
related:
  - "syntax:script-server"
  - "@meekojs/meeko/framework#usePage"
  - "@meekojs/meeko/framework#defineGroup"
  - "@meekojs/meeko/framework#defer"
  - "@meekojs/meeko/framework#notFound"
  - "@meekojs/meeko/framework#redirect"
  - docs/framework.md#opciones-de-ruta-con-definepage
  - docs/framework.md#modos-de-render
  - docs/framework.md#caché-de-páginas-ssr
  - docs/framework.md#rutas-dinámicas-en-el-sitemap-sitemapentries
  - docs/framework.md#dónde-se-usa-cada-api
---

`definePage` declara las opciones de ruta de una página de `app/pages`: los schemas que validan `params` y `search`, cómo llega al navegador (`render`), qué URL prerenderiza, el loader, el `<head>`, el layout con nombre y sus props, el middleware con nombre y, desde `1.7`, la caché HTTP de la página (`cache`) y sus URL en `sitemap.xml` (`sitemapEntries`). Devuelve la misma definición, pero con los tipos encadenados: `params` sale del schema, `load` los recibe y `head` recibe lo que devuelve `load`.

Se exporta como `route` desde el bloque `<script server>` de la página o desde un sidecar `*.route.ts` junto a ella. `meeko build` lee `render`, `layout` y `middleware` sin ejecutar el archivo, y `meeko check` compara los datos con las props de la página.

## Uso

```html
<!-- app/pages/users/[id].meeko -->
<script server lang="ts">
import * as v from "valibot";

export const route = definePage({
  params: v.object({ id: v.pipe(v.string(), v.regex(/^\d+$/)) }),
  head: () => ({ title: "Perfil" }),
});

const { params } = usePage();               // params.id: string, ya validado
const user = await db.users.find(params.id);
if (!user) notFound();
export const profile = { id: user.id, name: user.name };
</script>

<template><h1>{profile.name}</h1></template>
```

Una petición a `/users/abc` no supera el schema y responde `400` antes de ejecutar el bloque.

## Opciones

| Opción | Tipo | Por defecto | Descripción |
| --- | --- | --- | --- |
| `params` | `PageSchema` (Standard Schema) | segmentos como texto | Valida los segmentos dinámicos (`[id]`) antes de `load` y del código de nivel superior. Una entrada inválida responde `400`. Sin schema, `params` es `Readonly<Record<string, string>>`. |
| `search` | `PageSchema` | claves como texto | Valida la query string igual. Sin schema, cada clave es un texto, o una lista si se repite. |
| `render` | `"ssr" \| "stream" \| "prerender" \| "client"` | `"ssr"` | Cómo llega la página al navegador (véase [Modos de render](/docs/framework#modos-de-render)). **Debe ser un literal.** |
| `prerenderEntries` | `Record<string, string>[]` o `() => Promise<…>` | ninguno | Los `params` de cada URL que `meeko build` prerenderiza en una ruta dinámica con `render: "prerender"`. Una ruta estática no lo necesita; `"ssr"` y `"stream"` lo ignoran; con `"client"` es un error. |
| `load` | `(context: PageLoadContext) => D \| Promise<D>` | ninguno | Loader. Lo que devuelve llega a la página como `props.data`, que pasa a ser obligatorio. Puede devolver un `Response` para redirigir y valores `defer`. No se combina con código de nivel superior en el bloque. |
| `head` | `(context & { data }) => PageHead` | ninguno | `title`, `description` y las etiquetas de `useHead`, con los datos del loader. Gana a `useHead` y al `document` de la configuración. |
| `layout` | nombre de un layout, o `false` | el de `+group.ts`, o `default` | Desde `1.5`. Layout con nombre de `app/layouts/<nombre>.meeko`; `false` deja sólo `app/app.meeko`. **Debe ser un literal.** |
| `layoutProps` | `Props` del layout, o una función que las calcula | ninguno | Desde `1.5`. Props para el layout, tipadas contra el que elige `layout`. Viajan en el payload: deben poder serializarse en JSON. |
| `middleware` | nombres de `app/middleware`, o `false` | los heredados | Desde `1.6`. Middleware con nombre que la página añade a los globales y a los de sus `+group.ts`; `false` quita los heredados. **Debe ser un array literal.** |
| `cache` | `PageCache`: `{ etag?, maxAge?, staleWhileRevalidate?, memory? }` | sin caché | Desde `1.7`. Caché HTTP de una página `"ssr"` o `"stream"`. `etag(ctx)` devuelve la versión del contenido antes del loader; si coincide con `If-None-Match`, la respuesta es `304` sin loader ni render. `maxAge` y `staleWhileRevalidate` (segundos) escriben `Cache-Control: public, …`. `memory` (`true` o `{ maxEntries, maxBytes }`, por defecto 1000 entradas y 32 MiB) guarda el HTML y el payload en una LRU por ruta y proceso, y necesita `etag`. Sólo en producción y sin sesión. No existe con `"client"`. |
| `sitemapEntries` | `SitemapEntry[]` o `(context) => SitemapEntry[] \| Promise<…>` | ninguno | Desde `1.7`. Las URL de la ruta en `sitemap.xml`: `{ params, lastmod?, changefreq?, priority? }`. `meeko build` la evalúa una vez, después de prerenderizar, con `{ env, prerendering: true }`. Con `"prerender"` sólo añade campos a las páginas prerenderizadas. No existe con `"client"`. |

Con `render: "client"`, `load` y `head` se ejecutan en el navegador y reciben `ClientPageLoadContext` (sin `request` ni `context`).

## Valor devuelto

La misma definición, sin cambios en ejecución, con el tipo de su modo: `PageDefinition<P, S, D, C>` para `"ssr"`, `"stream"` y `"prerender"`, y `ClientPageDefinition<P, S, D>` para `"client"`. Si declara `load`, el tipo lo conserva como obligatorio, igual que `data` en las props de la página. Es lo que leen el servidor, `meeko build` y `meeko check`.

`definePage` valida al cargar el módulo lo que los tipos no bastan para impedir, y lanza un `TypeError`:

- `render: "client" cannot be prerendered; remove prerenderEntries or use render: "prerender"`;
- desde `1.7`, `render: "client" has no server cache; remove cache or render the page on the server`, y los errores de `cache` con el prefijo `definePage:`, como `cache.memory needs cache.etag, which tells when a stored page changed`, `cache.maxAge must be a whole number of seconds` o `cache has an unknown field ttl`.

## Ejemplos

### Un loader con sus datos tipados en la página

```html
<!-- app/pages/products/[slug].meeko -->
<script server lang="ts">
import * as v from "valibot";

export const route = definePage({
  params: v.object({ slug: v.string() }),
  search: v.object({ tab: v.optional(v.picklist(["detalles", "opiniones"]), "detalles") }),
  load: async ({ params, search, signal }) => {
    const product = await catalog.find(params.slug, { signal });
    if (!product) throw new ApiError("NOT_FOUND", 404);
    return { name: product.name, price: product.price, tab: search.tab };
  },
  head: ({ data }) => ({ title: data.name, description: `Precio: ${data.price} €` }),
});
</script>

<script lang="ts">
export interface Props {
  params: { slug: string };
  search: { tab: "detalles" | "opiniones" };
  data: { name: string; price: number; tab: "detalles" | "opiniones" };
}
const props = defineProps<Props>();
</script>

<template><h1>{props.data.name}</h1></template>
```

`meeko check` comprueba que `Props` coincide con los schemas y con lo que devuelve `load`. Un `ApiError` con estado `404` muestra la página de error más cercana con `{ status: 404, message: "NOT_FOUND" }`.

### Prerender de una ruta dinámica, en un sidecar

```ts
// app/pages/blog/[slug].route.ts
import { definePage } from "@meekojs/meeko/framework";

export const route = definePage({
  render: "prerender",
  prerenderEntries: async () => [{ slug: "hola-meeko" }, { slug: "senales" }],
  load: ({ params }) => ({ slug: params.slug ?? "" }),
  head: ({ data }) => ({ title: data.slug }),
});
```

`meeko build` escribe `/blog/hola-meeko/index.html` y `/blog/senales/index.html` con su payload de navegación. Cualquier otra URL de la ruta, o una con query string, se renderiza con SSR.

### Una página que se renderiza en el navegador

```html
<!-- app/pages/notes/index.meeko -->
<script server lang="ts">
export const route = definePage({
  render: "client",
  load: async ({ signal }) => api.notes.list({ signal }),
  head: ({ data }) => ({ title: `${data.length} notas` }),
});
</script>
```

Con `"client"` el bloque es público: entra en el bundle del navegador y no puede importar `server/` ni usar autoimports de servidor. El servidor sólo envía los layouts con el outlet vacío. Úsalo para vistas sin requisitos de SEO.

### Layout con nombre, sus props y middleware

```html
<!-- app/pages/admin/reports.meeko -->
<script server lang="ts">
export const route = definePage({
  layout: "dashboard",
  layoutProps: { title: "Informes", showAlert: true },
  middleware: ["auth"],
});
</script>
```

`layoutProps` se comprueba contra las `Props` de `app/layouts/dashboard.meeko` y `middleware` contra los middleware con nombre de `app/middleware`.

### Revalidar con `ETag` y cachear en memoria

Desde `1.7`, una página SSR cuyo contenido cambia poco se revalida sin ejecutar el loader. `etag` debe ser barato (una fecha de modificación o un contador, no el documento):

```ts
// app/pages/docs/[slug].route.ts
import { definePage } from "@meekojs/meeko/framework";

const updatedAt = new Map<string, string>([["inicio", "2026-10-01T12:00:00Z"]]);

export const route = definePage({
  cache: {
    etag: ({ params }) => updatedAt.get(params.slug ?? ""),
    maxAge: 60,
    staleWhileRevalidate: 600,
    memory: { maxEntries: 500 },
  },
  load: ({ params }) => ({ slug: params.slug ?? "" }),
});
```

La primera petición renderiza la página y responde con `ETag: W/"…"` y `Cache-Control: public, max-age=60, stale-while-revalidate=600`. Una petición con ese `If-None-Match` recibe `304` sin loader ni render; con `memory`, una petición sin él recibe la copia guardada mientras `etag` devuelva lo mismo. El `ETag` combina tu valor con el tema, el build y el tipo de respuesta (documento o payload de navegación), así que un `meeko build` nuevo invalida todas las copias.

### URL de una ruta dinámica en el sitemap

Desde `1.7`, una ruta `/docs/[slug]` con SSR aparece en `sitemap.xml` si declara sus URL. La función se ejecuta una vez en `meeko build`, con `sitemap` activado en `meeko.config.ts`:

```ts
// app/pages/docs/[slug].route.ts
import { definePage } from "@meekojs/meeko/framework";

const docs = [
  { slug: "inicio", updatedAt: new Date("2026-10-01"), draft: false },
  { slug: "borrador", updatedAt: new Date("2026-10-20"), draft: true },
];

export const route = definePage({
  sitemapEntries: ({ env }) => docs
    .filter((doc) => env.DOCS_DRAFTS === "1" || !doc.draft)
    .map((doc) => ({ params: { slug: doc.slug }, lastmod: doc.updatedAt, changefreq: "weekly" as const })),
});
```

Cada entrada da un `<url>` con `<loc>`, construida como `href`, y `<lastmod>` (un `Date` se escribe con `toISOString()`), `<changefreq>` y `<priority>` si los declara. `sitemap.exclude` y `noindex` siguen ganando.

## Errores comunes

### Llamarlo en el `<script>` del componente

El `<script>` y la plantilla se ejecutan también en el navegador: las opciones de ruta no viven ahí.

```html bad
<script lang="ts">
const route = definePage({ render: "prerender" });
</script>
```

`meeko check` avisa con `MEEK109: definePage no tiene efecto en el <script> ni en la plantilla de un componente` (será un error en `2.0`). Con `export const route`, el error es `MEEK018`, porque el script de un componente sólo exporta tipos.

```html good
<script server lang="ts">
export const route = definePage({ render: "prerender" });
</script>
```

### Calcular `render`

`meeko build` lee `render` sin ejecutar el archivo: un valor calculado no se puede leer.

```ts bad
const mode = process.env.STATIC ? "prerender" : "ssr";
export const route = definePage({ render: mode });
```

`meeko check` y `meeko build` se detienen con `render debe ser un literal de texto para que Meeko pueda leerlo durante el build`, con el archivo. Lo mismo vale para `layout` y `middleware`.

<!-- no-check -->
```ts good
export const route = definePage({ render: "prerender" });
```

### Prerenderizar una ruta dinámica sin `prerenderEntries`

```ts bad
// app/pages/blog/[slug].route.ts
export const route = definePage({ render: "prerender" });
```

`meeko check` no lo detecta, pero `meeko build` se detiene con `Dynamic prerender route /blog/[slug] requires prerenderEntries`: no sabe qué URL generar.

<!-- no-check -->
```ts good
export const route = definePage({ render: "prerender", prerenderEntries: async () => (await listPosts()).map((post) => ({ slug: post.slug })) });
```

### `render: "client"` con `prerenderEntries`

Una página que se renderiza en el navegador no tiene HTML que prerenderizar.

```ts bad
export const route = definePage({ render: "client", prerenderEntries: [{ slug: "a" }] });
```

Es un error de tipos (`prerenderEntries?: never`), `meeko check` lo rechaza con `una página render: "client" no se puede prerenderizar; quita prerenderEntries o usa render: "prerender"` y, si llegara a ejecutarse, `definePage` lanza un `TypeError` con el mismo mensaje en inglés.

<!-- no-check -->
```ts good
export const route = definePage({ render: "prerender", prerenderEntries: [{ slug: "a" }] });
```

### `load` y código de nivel superior a la vez

Los exports del bloque ya son los datos de la página; un loader sería una segunda fuente.

```html bad
<script server lang="ts">
export const route = definePage({ load: () => ({ total: 1 }) });
export const greeting = "Hola";
</script>
```

`MEEK070: Un <script server> con código de nivel superior no puede declarar también route.load`. Elige uno: los exports, o el loader.

```html good
<script server lang="ts">
export const route = definePage({ render: "ssr" });
export const total = 1;
export const greeting = "Hola";
</script>
```

### `head` en las opciones y en un export

```html bad
<script server lang="ts">
export const route = definePage({ head: () => ({ title: "A" }) });
export const head = { title: "B" };
</script>
```

`MEEK072: <script server> exporta head y además declara route.head; deja sólo uno de los dos`.

```html good
<script server lang="ts">
export const head = { title: "B" };
</script>
```

### Opciones que leen el código de nivel superior

Las opciones de ruta se evalúan una vez, al cargar el módulo; el código de nivel superior se ejecuta después, en cada petición.

```html bad
<script server lang="ts">
const title = "Hola";
export const route = definePage({ head: () => ({ title }) });
export const greeting = title;
</script>
```

`MEEK076: Las opciones de ruta no pueden leer title`. Mueve el valor compartido a un módulo importado, o calcúlalo dentro de `head`.

```html good
<script server lang="ts">
import { siteTitle } from "../utils/titles";
export const route = definePage({ head: () => ({ title: siteTitle }) });
export const greeting = siteTitle;
</script>
```

### Opciones en el bloque y en un sidecar

```text bad
app/pages/about.meeko      ← <script server> con export const route = definePage(…)
app/pages/about.route.ts   ← export const route = definePage(…)
```

El descubrimiento de rutas se detiene con `las opciones de ruta están declaradas dos veces; deja <script server> o about.route.ts`.

```text good
app/pages/about.meeko      ← <script server> con export const route = definePage(…)
```

### `cache.memory` sin `etag`

La copia en memoria sólo sabe cuándo ha caducado gracias a `etag`.

```ts bad
export const route = definePage({ cache: { memory: true, maxAge: 60 } });
```

`meeko check` no lo detecta: al cargar el módulo, `definePage` lanza `TypeError: definePage: cache.memory needs cache.etag, which tells when a stored page changed`. Lo mismo pasa con un número de segundos negativo o decimal (`cache.maxAge must be a whole number of seconds`).

<!-- no-check -->
```ts good
export const route = definePage({ cache: { etag: () => contentVersion(), memory: true, maxAge: 60 } });
```

### `cache` o `sitemapEntries` en una página `render: "client"`

Las opciones de una página `"client"` llegan al navegador: no hay servidor que cachee ni build que liste sus URL.

```ts bad
export const route = definePage({ render: "client", cache: { maxAge: 60 }, sitemapEntries: [] });
```

`meeko check` da `TS2769: No overload matches this call` con `Type '{ maxAge: 60; }' is not assignable to type 'never'`. Con `sitemapEntries`, el descubrimiento de rutas se detiene además con `una página render: "client" no declara sitemapEntries, porque sus opciones llegan al navegador; quítalo o usa otro modo de render`, y `definePage` lanza en ejecución `TypeError: render: "client" has no server cache; remove cache or render the page on the server`.

<!-- no-check -->
```ts good
export const route = definePage({ render: "ssr", cache: { etag: () => contentVersion(), maxAge: 60 } });
```

### Un layout o un middleware que no existe

```ts bad
export const route = definePage({ layout: "admin", middleware: ["auth"] });
```

`meeko check`, `meeko dev` y `meeko build` se detienen con `el layout "admin" no existe; crea app/layouts/admin.meeko (layouts disponibles: "default")` o `el middleware "auth" no existe; crea app/middleware/auth.ts con defineRouteMiddleware(..., { global: false })…`.

<!-- no-check -->
```ts good
// con app/layouts/admin.meeko y app/middleware/auth.ts
export const route = definePage({ layout: "admin", middleware: ["auth"] });
```

## Notas

- **Dónde va.** En `export const route` de `<script server>` o de un sidecar `*.route.ts`. Se autoimporta, y el import explícito desde `@meekojs/meeko/framework` también vale. Un `<script server>` sólo existe en las páginas: en un componente o un layout es `MEEK044`. Usa preferiblemente el export con nombre `route`; desde `1.7`, `export default definePage(...)` en un bloque sin código de nivel superior también pasa `meeko check` (hasta `1.6`, el del proyecto fallaba con `has no exported member 'route'`).
- **Cuándo se ejecuta.** Las opciones se evalúan una vez por módulo. `params` y `search` se validan en cada petición, después del middleware y antes de `load` y del código de nivel superior; `load` y `head` se ejecutan en cada petición (en SSR y en la petición de datos de cada navegación del cliente), o una vez por URL durante `meeko build` con `"prerender"`.
- **Servidor o navegador.** Salvo con `render: "client"`, el bloque y el sidecar nunca llegan al navegador: pueden importar `server/` y módulos `*.server.*` y leer secretos. Con `"client"` son públicos y el código de nivel superior da `MEEK074`.
- **Serialización.** Lo que devuelve `load` viaja en JSON. Un valor que `serializeJson` rechaza (funciones, `undefined`, `bigint`, instancias de clase como `Date` o `Map`) es un error de tipos en `meeko check` y una respuesta `500` en ejecución.
- **Seguridad.** Los schemas de `params` y `search` son la validación de la entrada de la URL: no confíes en un segmento sin validar. El middleware de ruta protege la navegación, pero una página `"client"` pide sus datos a la API, que debe aplicar sus propias guardas.
- **Caché (`1.7`).** `cache` sólo se aplica en producción, a peticiones `GET` y `HEAD` sin la cookie de sesión. Una respuesta que pone una cookie sale con `no-store` y sin copia, y `"stream"` sólo usa el `ETag`. El middleware de ruta se ejecuta siempre antes del `304` o de la copia en memoria, así que una guarda nunca se salta por la caché. `etag` debe cambiar con todo lo que cambia el HTML salvo el tema: si la página lee una cabecera o una clave de `search`, inclúyela.
- **Sitemap (`1.7`).** `sitemapEntries` sólo se evalúa con `sitemap` en `meeko.config.ts`, en el build y sin petición ni sesión: lee datos que el build tenga a mano. Meeko sólo carga las opciones de las rutas que la nombran, así que escríbela en las opciones, no a través de un spread.
- **`+group.ts`.** Para no repetir `layout`, `layoutProps` o `middleware` en cada página, declara las opciones de una carpeta con `defineGroup`; las de la página ganan.

> [!WARNING]
> Cambiar el `render` de una ruta exige volver a ejecutar `meeko build` o reiniciar `meeko dev`: el servidor compara el modo del archivo con el del manifiesto del build y responde con error si difieren.
