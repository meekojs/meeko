---
title: api
group: utils
since: 1.0.0
description: Cliente generado de los endpoints de server/api, tipado por sus schemas, que funciona igual en el navegador y en el servidor.
symbols:
  - "autoimport:api"
types:
  - "@meekojs/meeko/framework#ApiClient"
related:
  - "@meekojs/meeko/server#defineApiRoute"
  - "autoimport:useApi"
  - "autoimport:useApiMutation"
  - "@meekojs/meeko/framework#ClientError"
  - "@meekojs/meeko/framework#createApiClient"
  - "autoimport:rpc"
  - docs/framework.md#api-y-rpc
  - docs/framework.md#segmentos-dinámicos-en-api
---

`api` es el cliente que Meeko genera a partir de los endpoints de `server/api`: cada carpeta o archivo es un nivel, cada sufijo de método (`.get.ts`, `.post.ts`…) es un método, y cada segmento dinámico se llama con su parámetro. Los tipos de la entrada y de la respuesta salen de los schemas públicos del endpoint, así que una ruta, un parámetro o un campo equivocados son errores de `meeko check`.

Se autoimporta en el código de la aplicación y del servidor. En el navegador usa `fetch` del mismo origen con el token CSRF; en el servidor despacha localmente por el mismo pipeline, con la sesión de la petición, sin salir a la red.

## Uso

```text
server/api/users/index.get.ts       → api.users.get()
server/api/users/[id].get.ts        → api.users({ id }).get()
server/api/users/[id].patch.ts      → api.users({ id }).patch({ body })
server/api/orgs/[org]/users.get.ts  → api.orgs({ org }).users.get({ query })
```

```html
<!-- app/components/RenameUser.meeko -->
<script lang="ts">
const props = defineProps<{ id: string }>();
const name = signal("");
const saved = signal<string | null>(null);
async function save(event: SubmitEvent): Promise<void> {
  event.preventDefault();
  const user = await api.users({ id: props.id }).patch({ body: { name: name.value } });
  saved.value = user.name;
}
</script>

<template>
  <form on:submit="save">
    <input model="name" aria-label="Nombre">
    <button>Guardar</button>
    <p if:when="saved.value" role="status">Guardado como {saved.value}</p>
  </form>
</template>
```

## Parámetros

Cada método recibe un objeto opcional:

| Opción | Tipo | Descripción |
| --- | --- | --- |
| `query` | la entrada del schema `query` | La query string. |
| `body` | la entrada del schema `body` | El cuerpo, enviado como JSON. |
| `signal` | `AbortSignal` | Cancela la petición. |

Un segmento dinámico se llama con un objeto con su único parámetro, como texto: `api.users({ id: "7" })`. Un catch-all `[...path]` recibe los segmentos unidos por `/`.

## Valor devuelto

Una promesa con la salida del schema `response` del endpoint (`undefined` con `status: 204`). Una respuesta de error rechaza con un `ClientError`, con `code`, `status`, `requestId` e `issues` si es un `400` de validación o un `ApiError` con `issues`.

## Ejemplos

### En el servidor, con la sesión de la petición

En un `<script server>`, `api.*` reutiliza la petición en curso: la sesión, los servicios y el `requestId`.

```html
<!-- app/pages/users/[id].meeko -->
<script server lang="ts">
const { params } = usePage();
export const user = await api.users({ id: params.id }).get();
</script>

<template><h1>{user.name}</h1></template>
```

### Tratar un error de la API

```ts
import { isClientError } from "@meekojs/meeko/framework";

export async function safeName(load: () => Promise<{ name: string }>): Promise<string> {
  try {
    return (await load()).name;
  } catch (error) {
    if (isClientError(error, "NOT_FOUND")) return "Usuario borrado";
    throw error;
  }
}
```

Con `safeName(() => api.users({ id }).get())`, un `404` del endpoint da «Usuario borrado» y cualquier otro error sigue su camino.

### Cancelar una búsqueda

<!-- no-check -->
```ts
let controller: AbortController | undefined;
async function search(q: string) {
  controller?.abort();
  controller = new AbortController();
  return api.products.get({ query: { q }, signal: controller.signal });
}
```

Para búsquedas mientras se escribe, `useApi(…, { debounceMs })` lo hace por ti desde `1.7`.

## Errores comunes

### `await api.*` en el nivel superior del script

```html bad
<script lang="ts">
const users = await api.users.get();
</script>
```

`MEEK055: El await de nivel superior sólo se admite sobre useElementRef, useSocket, useSocketClient, useApi, useRpcQuery; mueve el resto del trabajo asíncrono a una función o a onMounted`. Para cargar datos en un componente, con SSR e hidratación, usa `useApi`.

```html good
<script lang="ts">
const users = await useApi("/api/users");
</script>
```

### Parámetros de segmento que faltan o no son texto

```ts bad
await api.users({}).get();
await api.users({ id: 7 }).get();
```

`meeko check` da `TS2741: Property 'id' is missing in type '{}' but required in type '{ readonly id: string; }'.` y `TS2322: Type 'number' is not assignable to type 'string'.` En ejecución, un objeto sin el parámetro lanza `TypeError`.

<!-- no-check -->
```ts good
await api.users({ id: String(userId) }).get();
```

### Un método o un campo que el endpoint no tiene

```ts bad
await api.items.post();
await api.users({ id: "1" }).patch({ body: { title: "x" } });
```

`meeko check` da `TS2339: Property 'post' does not exist on type 'ApiMethods<…>'.` y `TS2353: Object literal may only specify known properties, and 'title' does not exist in type '{ name: string; }'.`

<!-- no-check -->
```ts good
await api.items.get();
await api.users({ id: "1" }).patch({ body: { name: "x" } });
```

### La forma antigua con `params`

```ts bad
await api.users.get({ params: { id: "1" } });
```

`meeko check` da `TS2339: Property 'get' does not exist on type …`: desde `1.2`, el segmento dinámico se llama con su parámetro. La forma `api.users.byId.get({ params })` sigue funcionando en `1.x`, obsoleta, y se retirará en `2.0`.

<!-- no-check -->
```ts good
await api.users({ id: "1" }).get();
```

## Notas

- **Generación.** `meeko routes`, `meeko check` y `meeko dev` generan `.meeko/generated/clients.client.ts` y `clients.server.ts` con descriptores públicos y tipos inferidos; nunca importan los handlers. Un endpoint nuevo necesita uno de esos comandos.
- **Seguridad.** En el navegador, el cliente lee el token CSRF de la meta `meeko-csrf-token` y lo envía en cada mutación. Los errores privados del servidor nunca llegan: un fallo desconocido es `INTERNAL_ERROR`.
- **SSR.** En el servidor, una llamada fuera de una petición (un script, un temporizador) falla con un error claro: no hay sesión ni pipeline que reutilizar.
- **Componentes.** Para leer datos con SSR, hidratación y estado de carga, usa `useApi`; para mutaciones con estado de envío, `useApiMutation`. `api.*` es la llamada directa, en manejadores, loaders y código de servidor.
- **Respuestas que no son JSON.** Un endpoint con `contentType: "response"` devuelve el `Response` tal cual.
