---
title: <script server>
group: syntax
since: 1.0.0
description: El código de servidor de una página, dentro de su .meeko, con sus opciones de ruta y los datos que exporta a la plantilla, tipados y en JSON.
symbols:
  - "syntax:script-server"
related:
  - "@meekojs/meeko/framework#definePage"
  - "@meekojs/meeko/framework#usePage"
  - "@meekojs/meeko/framework#redirect"
  - "@meekojs/meeko/framework#notFound"
  - "@meekojs/meeko/framework#defer"
  - "@meekojs/meeko/framework#useHead"
  - docs/framework.md#código-de-servidor-de-la-página
  - docs/framework.md#reglas-comunes
  - docs/framework.md#dónde-se-usa-cada-api
---

`<script server lang="ts">` es el código de servidor de una página de `app/pages`, en el propio `.meeko`. Nunca forma parte del componente ni llega al navegador (salvo con `render: "client"`): se ejecuta en el servidor, con los autoimports de `server/utils`, y puede importar `server/`, módulos `*.server.*` y secretos.

El bloque admite dos formas, que pueden convivir salvo `load` junto a código de nivel superior:

- **Código de nivel superior** (desde `1.1`). Se ejecuta en cada petición: lee la petición con `usePage()`, consulta la base de datos, redirige o responde `404`. Cada `export const` es un dato de la página que llega tipado al `<script>` y a la plantilla.
- **Opciones de ruta.** `export const route = definePage({ … })`: los schemas, el modo de render, el loader, el `<head>`, el layout, el middleware, la caché y el sitemap. Es la misma forma que un sidecar `*.route.ts`.

## Uso

```html
<!-- app/pages/users/[id].meeko -->
<script server lang="ts">
export const route = definePage({ head: () => ({ title: "Perfil" }) });

const { params } = usePage();
const row = await findUser(params.id);
if (!row) notFound();
export const user = { id: row.id, name: row.name };
</script>

<script lang="ts">
const name = signal(user.name);
</script>

<template>
  <h1>{user.name}</h1>
  <input model="name" aria-label="Nombre">
</template>
```

`findUser` es una función de `server/utils`, autoimportada. `row` no sale del servidor; sólo `user`, el export, viaja en el payload.

## Atributos

| Atributo | Tipo | Por defecto | Descripción |
| --- | --- | --- | --- |
| `server` | sin valor | obligatorio | Marca el bloque como código de servidor. Con un valor (`server="true"`) es `MEEK043`. |
| `lang` | `"ts"` | obligatorio | El bloque es TypeScript. Sin él es `MEEK006`. |

Una página tiene como mucho un `<script server>` (`MEEK004`), junto a su `<script lang="ts">` y su `<template>`.

## Resultado

| Lo que declara el bloque | Cuándo se evalúa | A dónde llega |
| --- | --- | --- |
| `import`, tipos, `export const route` | Una vez, al cargar el módulo | `route` lo leen el servidor, `meeko build` y `meeko check` |
| Sentencias de nivel superior | En cada petición (SSR y datos de cada navegación), después del middleware y de validar `params` y `search` | A ningún sitio: son privadas |
| `export const x` / `export let x` (salvo `route` y `head`) | En cada petición | Al `<script>` y la plantilla, como `x`, de sólo lectura, en JSON |
| `export const head` | En cada petición | Al `<head>` del documento, como `route.head` |

Un export que es una promesa se espera antes de renderizar; con `render: "stream"`, un export con `defer` llega después del primer pintado.

## Ejemplos

### Una página protegida, con redirección

`usePage().context` da la sesión de la petición; `redirect()` detiene el bloque:

```html
<!-- app/pages/account.meeko -->
<script server lang="ts">
const { context, url } = usePage();
const session = context.session.current;
if (!session) redirect(`/login?next=${encodeURIComponent(url.pathname)}`);
export const account = { id: session.id };
export const head = { title: "Tu cuenta", description: "Ajustes de la cuenta." };
</script>

<template><h1>Cuenta {account.id}</h1></template>
```

Para no repetir la guarda en cada página, un middleware de ruta de servidor (`app/middleware/auth.server.ts`) la aplica a un grupo de rutas.

### Validar `params` con un schema

Las opciones de ruta se evalúan antes que el código de nivel superior, y sus schemas tipan `usePage()`:

```html
<!-- app/pages/orders/[id].meeko -->
<script server lang="ts">
import * as v from "valibot";

export const route = definePage({
  params: v.object({ id: v.pipe(v.string(), v.regex(/^\d+$/)) }),
  search: v.object({ tab: v.optional(v.picklist(["items", "history"]), "items") }),
});

const { params, search } = usePage();       // params.id: string, search.tab: "items" | "history"
export const order = { id: Number(params.id), tab: search.tab };
</script>

<template><h1>Pedido {order.id}</h1></template>
```

Una URL con `id=abc` responde `400` antes de ejecutar el bloque.

### Datos lentos en streaming

Con `render: "stream"`, un export con `defer` no retrasa el primer byte:

```html
<!-- app/pages/dashboard.meeko -->
<script server lang="ts">
export const route = definePage({ render: "stream" });

export const user = { name: "Ana" };
export const stats = defer(async () => ({ visits: 1200 }));
</script>

<template>
  <h1>Hola, {user.name}</h1>
  <p if:when="stats.status === 'pending'">Cargando estadísticas…</p>
  <p if:when="stats.status === 'resolved'">{stats.value?.visits} visitas</p>
</template>
```

### Sólo opciones de ruta

Un bloque sin código de nivel superior se evalúa una vez, como un sidecar, y puede usar un loader:

```html
<!-- app/pages/blog/index.meeko -->
<script server lang="ts">
export const route = definePage({
  render: "prerender",
  load: async () => ({ posts: [{ slug: "hola", title: "Hola, Meeko" }] }),
  head: ({ data }) => ({ title: `Blog (${data.posts.length})` }),
});
</script>

<script lang="ts">
const props = defineProps<{ params: Record<string, string>; search: Record<string, string | string[]>; data: { posts: { slug: string; title: string }[] } }>();
</script>

<template>
  <ul><li each:of="props.data.posts" each:as="post" each:key="post.slug">{post.title}</li></ul>
</template>
```

## Errores comunes

### Un `<script server>` en un componente o un layout

```html bad
<!-- app/components/UserCard.meeko -->
<script server lang="ts">
export const user = await findUser("1");
</script>
```

`meeko check` da `MEEK044: <script server> declara opciones de ruta y sólo se admite en las páginas de app/pages`. Un componente pide sus datos con `useApi` o `useRpcQuery`, o los recibe en props.

```html good
<!-- app/components/UserCard.meeko -->
<script lang="ts">
const props = defineProps<{ user: { id: string; name: string } }>();
</script>
```

### Exportar algo que no es JSON

Los exports viajan al navegador en JSON.

```html bad
<script server lang="ts">
export const createdAt = new Date();
export const format = (n: number) => n.toFixed(2);
</script>
```

`meeko check` da `TS2344: Type 'Date' does not satisfy the constraint '{ toString: "not serializable to JSON: functions, undefined, bigint, symbols and class instances cannot reach the client"; … }'` y lo mismo con la función. Una `export function` da `MEEK071: export function no se admite en un <script server> con código de nivel superior: cada export const o export let es un dato de la página, que debe poder serializarse como JSON; …`.

```html good
<script server lang="ts">
export const createdAt = new Date().toISOString();
</script>
```

Convierte las fechas en texto y lleva las funciones al `<script>` o a un módulo compartido.

### `usePage()` en el `<script>` del componente

```html bad
<script lang="ts">
const { params } = usePage();
</script>
```

`MEEK073: usePage() sólo funciona en el código de nivel superior del <script server> de una página: el <script> y la plantilla de un componente también se ejecutan en el navegador`. Lo mismo para `redirect` y `notFound`. En el componente, `useRoute()` da la ruta actual.

```html good
<script server lang="ts">
const { params } = usePage();
export const id = params.id;
</script>
```

### Importar `server/` desde el `<script>`

```html bad
<script lang="ts">
import { articleHtml } from "../../server/content/articles";
</script>
```

`MEEK108: ../../server/content/articles es un módulo de servidor (server/ o *.server.*) y no puede llegar al bundle del navegador: …; para sus tipos, usa import type`.

```html good
<script server lang="ts">
import { articleHtml } from "../../server/content/articles";
export const body = articleHtml("<p>Hola</p>");
</script>
```

### El mismo nombre en el bloque y en el `<script>`

```html bad
<script server lang="ts">
export const total = 1;
</script>
<script lang="ts">
const total = 2;
</script>
```

`MEEK075: total ya lo exporta <script server> y está en el ámbito como dato de la página; cambia el nombre de la declaración o del export`. Los exports son de sólo lectura: asignarlos da `TS2588: Cannot assign to 'total' because it is a constant.`

```html good
<script server lang="ts">
export const total = 1;
</script>
<script lang="ts">
const count = signal(total);
</script>
```

### Código de nivel superior con `render: "client"`

```html bad
<script server lang="ts">
export const route = definePage({ render: "client" });
export const total = 1;
</script>
```

`MEEK074: Una página render: "client" no puede tener código de servidor de nivel superior: su <script server> se ejecuta en el navegador. Pide los datos con useApi o useRpcQuery, o renderiza en el servidor`.

```html good
<script server lang="ts">
export const route = definePage({ render: "client", load: async () => ({ total: 1 }) });
</script>
```

### Macros del componente en el bloque

```html bad
<script server lang="ts">
const props = defineProps<{ title: string }>();
</script>
```

`MEEK108: defineProps sólo existe en el <script> de un componente: <script server> se ejecuta fuera del componente, antes de renderizar la página. Muévelo al <script lang="ts">`.

```html good
<script lang="ts">
const props = defineProps<{ title: string }>();
</script>
```

## Notas

- **Seguridad.** El bloque, sus imports y sus variables privadas nunca llegan al bundle del navegador ni al payload: sólo los exports. Exporta únicamente lo que la página necesita (`{ id, name }`, no la fila completa con su `passwordHash`).
- **Cuándo se ejecuta.** Cada petición vuelve a ejecutar el código de nivel superior, también la petición de datos de cada navegación del cliente. Una variable de nivel superior (`const cache = new Map()`) es nueva cada vez: lo que deba sobrevivir entre peticiones vive en un módulo importado.
- **Opciones y código.** Las opciones de ruta se evalúan una vez, antes que el código, y no pueden leer sus variables (`MEEK076`). `route.load` y el código de nivel superior no se combinan (`MEEK070`); `export const head` y `route.head` tampoco (`MEEK072`).
- **Hidratación.** Los exports viajan en el payload y no son señales: el navegador los recibe ya calculados y no vuelve a ejecutar el bloque. Para estado editable, crea una señal a partir de ellos.
- **`render: "client"`.** El bloque se envía al navegador y es público: no puede tener código de nivel superior ni importar `server/`.
- **Sidecar o bloque.** Una página no puede declarar las opciones en `<script server>` y en `*.route.ts` a la vez: el descubrimiento de rutas se detiene con un error que nombra los dos.

> [!NOTE]
> La forma recomendada es `export const route = definePage(…)`. Desde `1.7`, `export default definePage(…)` en un bloque sin código de nivel superior también pasa `meeko check`, del proyecto y del archivo suelto, como ya la leían el build y el runtime; hasta `1.6`, el del proyecto fallaba con `has no exported member 'route'`.
