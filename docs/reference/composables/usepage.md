---
title: usePage
group: composables
since: 1.1.0
description: Devuelve la petición de la página (url, params, search, request, context y signal) en el código de nivel superior de su script server.
symbols:
  - "@meekojs/meeko/framework#usePage"
types:
  - "@meekojs/meeko/framework#PageRequest"
related:
  - "syntax:script-server"
  - "@meekojs/meeko/framework#definePage"
  - "@meekojs/meeko/framework#redirect"
  - "@meekojs/meeko/framework#notFound"
  - "@meekojs/meeko/framework#useRoute"
  - "@meekojs/meeko/server#useRequestState"
  - docs/framework.md#código-de-nivel-superior-y-datos-exportados
  - docs/framework.md#dónde-se-usa-cada-api
---

`usePage()` es la puerta a la petición en curso desde el código de nivel superior del `<script server>` de una página: la URL, los `params` y `search` ya validados por los schemas de [`definePage`](/docs/reference/definepage), el `Request` original, el contexto de la petición (sesión, servicios, plataforma) y una señal de cancelación. Con eso el bloque lee la base de datos, comprueba la sesión, redirige o responde `404`, y exporta los datos que la página recibe.

Dentro del bloque se usa sin importarlo y su tipo sigue los schemas y el ID de la ruta. Sólo existe allí: en el `<script>` o la plantilla del componente, que también se ejecutan en el navegador, es el error `MEEK073`.

## Uso

```html
<!-- app/pages/users/[id].meeko -->
<script server lang="ts">
const { params, context } = usePage();
if (!context.session.current) redirect("/login");
const row = await db.users.findById(params.id);
if (!row) notFound();
export const user = { id: row.id, name: row.name };
</script>

<template><h1>{user.name}</h1></template>
```

Sin schema, `params.id` es `string` porque el archivo es `[id].meeko`. `db` es un autoimport de `server/utils`; `row` nunca sale del servidor, sólo `user`.

## Parámetros

`usePage()` no recibe parámetros.

## Valor devuelto

Una `PageRequest`:

| Propiedad | Tipo | Descripción |
| --- | --- | --- |
| `url` | `URL` | URL completa de la petición. |
| `params` | salida del schema de `params`, o `Readonly<Record<string, string>>` | Segmentos dinámicos, validados antes de ejecutar el bloque. Sin schema, una clave por cada `[segmento]` del archivo. |
| `search` | salida del schema de `search`, o `Readonly<Record<string, string \| string[]>>` | Query string validada; sin schema, una clave repetida es un array. |
| `request` | `Request` | Petición HTTP original: cabeceras, cookies, método. |
| `context` | `RequestContext` | Contexto de la petición: `session`, `services`, `platform`, `state`, `requestId`, `clientAddress`. |
| `signal` | `AbortSignal` | Se aborta si el cliente se desconecta, se revoca la sesión o se cancela la respuesta. Pásala a `fetch` y a las consultas largas. |

Fuera del código de nivel superior de un `<script server>` (o, desde `1.6`, de un middleware de ruta de servidor) lanza `Error: MEEK073: usePage() sólo está disponible mientras se ejecuta el código de nivel superior del <script server> de una página…`.

## Ejemplos

### Params y search validados por el schema

```html
<!-- app/pages/products/[slug].meeko -->
<script server lang="ts">
import * as v from "valibot";

export const route = definePage({
  params: v.object({ slug: v.pipe(v.string(), v.regex(/^[a-z0-9-]+$/)) }),
  search: v.object({ tab: v.optional(v.picklist(["detalles", "opiniones"]), "detalles") }),
});

const { params, search, signal } = usePage();      // search.tab: "detalles" | "opiniones"
const product = await catalog.find(params.slug, { signal });
if (!product) notFound();
export const page = { name: product.name, tab: search.tab };
export const head = { title: product.name };
</script>

<template><h1>{page.name}</h1></template>
```

Una URL que no supera el schema responde `400` antes de ejecutar el bloque.

### La sesión y los servicios

```html
<!-- app/pages/account.meeko -->
<script server lang="ts">
const { context, url } = usePage();
const session = context.session.current;
if (!session) redirect(`/login?next=${encodeURIComponent(url.pathname)}`);
export const orders = await context.services.db.orders.forUser(session.data.userId);
</script>

<template><p>{orders.length} pedidos</p></template>
```

`redirect` detiene el bloque: lo que sigue sólo se ejecuta con sesión.

### Cabeceras de la petición

```html
<script server lang="ts">
const { request } = usePage();
export const language = (request.headers.get("accept-language") ?? "es").split(",")[0] ?? "es";
</script>
```

### Una función auxiliar que lo usa

`usePage` funciona en cualquier función que el bloque llame **mientras** se ejecuta su nivel superior:

```html
<script server lang="ts">
async function currentUser() {
  const { context } = usePage();
  return context.session.current ? context.services.db.users.findById(context.session.current.data.userId) : null;
}
export const me = await currentUser();
</script>
```

## Errores comunes

### Llamarlo en el `<script>` del componente

```html bad
<script lang="ts">
const { params } = usePage();
</script>
```

`meeko check` da `MEEK073: usePage() sólo funciona en el código de nivel superior del <script server> de una página: el <script> y la plantilla de un componente también se ejecutan en el navegador`. Exporta lo que necesites desde el bloque de servidor, o lee la ruta con [`useRoute`](/docs/reference/useroute):

```html good
<script server lang="ts">
const { params } = usePage();
export const userId = params.id;
</script>
```

### Llamarlo en las opciones de ruta

`load`, `head` y las demás opciones reciben su propio contexto; se evalúan fuera del nivel superior del bloque.

```html bad
<script server lang="ts">
export const route = definePage({ load: () => ({ id: usePage().params.id }) });
</script>
```

`meeko check` da `MEEK073: usePage() sólo funciona en el código de nivel superior de <script server>, que se ejecuta en cada petición; llámala fuera de cualquier función y fuera de las opciones de ruta`. Usa el argumento de `load`:

```html good
<script server lang="ts">
export const route = definePage({ load: ({ params }) => ({ id: params.id }) });
</script>
```

### Llamarlo cuando el bloque ya terminó

```html bad
<script server lang="ts">
setTimeout(() => console.log(usePage().url.pathname), 1000);
export const ok = true;
</script>
```

`meeko check` no lo detecta, pero al ejecutarse el callback lanza `Error: MEEK073: usePage() sólo está disponible mientras se ejecuta el código de nivel superior…`. Lee los valores antes y usa esa copia:

```html good
<script server lang="ts">
const { url } = usePage();
setTimeout(() => console.log(url.pathname), 1000);
export const ok = true;
</script>
```

## Notas

- **Sólo servidor.** El bloque y sus imports nunca llegan al navegador; sólo viajan los nombres exportados. Puede leer secretos e importar `server/` y módulos `*.server.*`. Con `render: "client"` el bloque es público y su código de nivel superior es `MEEK074`.
- **Cuándo se ejecuta.** En cada petición: en SSR y en la petición de datos de cada navegación del cliente, después del middleware y de validar `params` y `search`.
- **Código de nivel superior.** Usar `usePage`, `redirect` o `notFound` fuera de una función convierte el bloque en código de nivel superior, que no puede convivir con `route.load` (`MEEK070`).
- **Seguridad.** `params` y `search` sin schema son texto que escribe el usuario: valídalos con `definePage` antes de usarlos en una consulta. La sesión de `context` es la de la petición; una página que redirige sin sesión debe comprobarla en cada petición, como aquí.
- **Cancelación.** Pasa `signal` a las operaciones largas: si el usuario cierra la pestaña o navega a otra página, el servidor deja de trabajar para nadie.
