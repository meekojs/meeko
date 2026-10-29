---
title: defer
group: utils
since: 1.0.0
description: Marca un dato del loader o del código de servidor de la página que puede llegar después del primer byte con render stream, con su estado reactivo.
symbols:
  - "@meekojs/meeko/framework#defer"
types:
  - "@meekojs/meeko/framework#Deferred"
  - "@meekojs/meeko/framework#DeferOptions"
  - "@meekojs/meeko/framework#DeferredError"
related:
  - "@meekojs/meeko/framework#definePage"
  - "syntax:script-server"
  - "syntax:meekoawait"
  - docs/framework.md#streaming-ssr-render-stream
  - docs/framework.md#modos-de-render
---

`defer(fábrica)` o `defer(promesa)` marca un dato lento de la página. Con `render: "stream"`, el servidor envía el HTML antes de que el valor se resuelva y el valor llega después por la misma respuesta; la página lo lee con `status`, `value` y `error`, que son reactivos. Con `"ssr"` o `"prerender"`, el servidor lo espera antes de renderizar, así que el HTML siempre lo contiene.

Sirve para lo que no debe retrasar el primer pintado: comentarios, recomendaciones, estadísticas. Lo crítico (el título, el contenido principal) va sin `defer`.

## Uso

```html
<!-- app/pages/posts/[id].meeko -->
<script server lang="ts">
import { defer } from "@meekojs/meeko/framework";

export const route = definePage({
  render: "stream",
  load: ({ params }) => ({
    post: { id: params.id ?? "", title: `Entrada ${params.id ?? ""}` },
    comments: defer(async (signal) => {
      const response = await fetch(`https://api.example.com/posts/${params.id ?? ""}/comments`, { signal });
      return (await response.json()) as { id: string; text: string }[];
    }, { timeoutMs: 5_000 }),
  }),
});
</script>

<script lang="ts">
import type { Deferred } from "@meekojs/meeko/framework";

interface Comment { id: string; text: string }
export interface Props {
  params: { id: string };
  search: Record<string, string | string[]>;
  data: { post: { id: string; title: string }; comments: Deferred<Comment[]> };
}
const props = defineProps<Props>();
</script>

<template>
  <h1>{props.data.post.title}</h1>
  <p if:when="props.data.comments.status === 'pending'">Cargando comentarios…</p>
  <p if:when="props.data.comments.status === 'rejected'" role="alert">No se pudieron cargar ({props.data.comments.error?.code}).</p>
  <ul if:when="props.data.comments.status === 'resolved'">
    <li each:of="props.data.comments.value ?? []" each:as="comment" each:key="comment.id">{comment.text}</li>
  </ul>
</template>
```

El título llega en el primer byte; los comentarios, cuando la API responde o a los 5 segundos. Desde `1.7`, `defer` se autoimporta en `<script server>` (también dentro de las opciones de ruta), en los sidecars `*.route.ts` y en `server/`; antes había que importarlo de `@meekojs/meeko/framework`, y el import explícito sigue valiendo.

## Parámetros

| Parámetro | Tipo | Por defecto | Descripción |
| --- | --- | --- | --- |
| `source` | `(signal: AbortSignal) => T \| PromiseLike<T>`, o una promesa | obligatorio | Una fábrica, que Meeko llama cuando el loader o el bloque terminan, o una promesa ya iniciada. La fábrica recibe un `AbortSignal` que se aborta cuando el valor deja de esperarse: plazo agotado, cliente desconectado, sesión revocada, stream cancelado, petición `HEAD` o, en el navegador, al salir de la ruta. |
| `options.timeoutMs` | `number` | `10000` | Plazo en milisegundos, desde que el loader devuelve. Debe ser finito y positivo (si no, `RangeError`). |

Prefiere la fábrica: una promesa ya iniciada no se puede cancelar, sólo dejar de esperar.

## Valor devuelto

Un `Deferred<T>`:

| Propiedad | Tipo | Descripción |
| --- | --- | --- |
| `status` | `"pending" \| "resolved" \| "rejected"` | El estado. Puede ganar miembros en un minor: un `switch` exhaustivo necesita rama por defecto. |
| `value` | `T \| undefined` | El valor resuelto, o `undefined` mientras no lo está. |
| `error` | `{ code, status } \| undefined` | El fallo público si se rechazó: un `ApiError` conserva su código y estado; cualquier otro error llega como `INTERNAL_ERROR`/`500`; un plazo agotado, como `DEFERRED_TIMEOUT`/`504`. |

Leer `status`, `value` o `error` en la plantilla, un `computed` o un `effect` se suscribe al resultado.

## Ejemplos

### Con un loader

```ts
// app/pages/dashboard.route.ts
import { defer, definePage } from "@meekojs/meeko/framework";

export const route = definePage({
  render: "stream",
  load: async () => ({
    user: { name: "Ana" },
    stats: defer(async (signal) => {
      const response = await fetch("https://api.example.com/stats", { signal });
      return (await response.json()) as { visits: number };
    }),
  }),
});
```

La página recibe `props.data.stats` como `Deferred<{ visits: number }>`.

### En el código de nivel superior

Un `export const` con `defer` en `<script server>` llega a la plantilla con el mismo nombre:

```html
<!-- app/pages/home.meeko -->
<script server lang="ts">
export const route = definePage({ render: "stream" });

export const hero = { title: "Hola" };
export const weather = defer(async () => ({ city: "Lima", celsius: 19 }), { timeoutMs: 2_000 });
</script>

<template>
  <h1>{hero.title}</h1>
  <p if:when="weather.status === 'pending'">Consultando el tiempo…</p>
  <p if:when="weather.status === 'resolved'">{weather.value?.city}: {weather.value?.celsius} °C</p>
</template>
```

Cada `defer` llega cuando se resuelve, en cualquier orden.

La plantilla recibe `weather` como `Deferred<{ city: string; celsius: number }>`, con sus tipos: los elementos de una lista en `value` tienen el tipo de la lista (`each:of="feed.value ?? []"`). Hasta `1.6`, `defer` no se autoimportaba en `<script server>`, y sin import el export llegaba sin tipo (`value.value` compilaba y los elementos eran `unknown`).

## Errores comunes

### Leer el valor como una señal

`Deferred` no es una señal: `status`, `value` y `error` se leen directamente, y `value` puede ser `undefined`.

```html bad
<p>{props.data.stats.value.value.visits}</p>
```

Con `stats: Deferred<{ visits: number }>` en las `Props`, `meeko check` da `TS18048: 'props.data.stats.value' is possibly 'undefined'.` y `TS2339: Property 'value' does not exist on type '{ visits: number; }'.`

```html good
<p if:when="props.data.stats.status === 'resolved'">{props.data.stats.value?.visits} visitas</p>
```

### Un `timeoutMs` no válido

```ts bad
const slow = defer(load, { timeoutMs: 0 });
```

En ejecución, `defer` lanza `RangeError: defer timeoutMs must be a positive finite number of milliseconds`.

<!-- no-check -->
```ts good
const slow = defer(load, { timeoutMs: 5_000 });
```

### Esperar que `defer` acelere una página `"ssr"`

Con `render: "ssr"` o `"prerender"`, el servidor espera todos los `defer` antes de responder: la página no llega antes, sin ningún aviso.

```ts bad
export const route = definePage({ load: async () => ({ comments: defer(loadComments) }) });
```

<!-- no-check -->
```ts good
export const route = definePage({ render: "stream", load: async () => ({ comments: defer(loadComments) }) });
```

## Notas

- **Streaming.** Con `"stream"`, antes del primer byte se ejecutan el middleware, la validación, el loader crítico, `head` y el render síncrono. Después llega un `<script type="application/json" data-meeko-deferred="N">` por valor resuelto, que el navegador aplica tras la hidratación.
- **Navegación.** Al navegar a una ruta `"stream"`, el navegador recibe `application/meeko+ndjson`: el payload primero y cada valor después. Salir de la ruta aborta las fábricas pendientes.
- **Seguridad.** Un error privado no llega al navegador: sólo `code` y `status`. Los `5xx` llegan al `onError` del servidor con el `requestId`.
- **Prerender.** Con `render: "prerender"`, un `defer` rechazado hace fallar la petición con `500` y `meeko build` con la ruta, en lugar de guardar el error en el HTML.
- **Caché (`1.7`).** Con `cache` en `definePage`, una página `"stream"` sólo usa el `ETag` y el `304`: su cuerpo no se guarda en memoria, porque saldría con los valores diferidos fijados.
- **Serialización.** El valor resuelto viaja en JSON, como cualquier dato de la página.
