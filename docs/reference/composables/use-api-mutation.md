---
title: useApiMutation
group: composables
since: 1.2.0
description: Envía bajo demanda una petición POST, PUT, PATCH o DELETE a un endpoint de server/api, con su estado de envío, sus errores y reintentos seguros.
symbols:
  - "autoimport:useApiMutation"
types:
  - "@meekojs/meeko/framework#UseApiMutation"
  - "@meekojs/meeko/framework#ApiMutation"
  - "@meekojs/meeko/framework#MutationOptions"
  - "@meekojs/meeko/framework#RetrySafeMutation"
related:
  - "autoimport:useApi"
  - "autoimport:useRpcMutation"
  - "@meekojs/meeko/framework#useForm"
  - "@meekojs/meeko/framework#ClientError"
  - "@meekojs/meeko/server#defineApiRoute"
  - docs/framework.md#mutaciones
  - docs/framework.md#mutaciones-seguras-ante-reintentos
---

`useApiMutation(ruta, método, opciones?)` prepara una escritura en un endpoint de `server/api` que no es `GET`. No hace ninguna petición hasta que llamas a `mutate({ params, query, body })`, y refleja la última llamada en `pending`, `data` y `error`. `mutate` envía el token CSRF de la sesión, comprueba la entrada contra el contrato del endpoint y devuelve su respuesta, o rechaza con su error.

`ruta` se escribe como en [`useApi`](/docs/reference/use-api) y `método` es `"POST"`, `"PUT"`, `"PATCH"` o `"DELETE"`: TypeScript sólo acepta los métodos que existen para esa ruta. Lo generan los clientes de la aplicación y se autoimporta en los `.meeko`; un export propio llamado `useApiMutation` tiene prioridad.

## Uso

```html
<!-- app/components/NewNote.meeko -->
<script lang="ts">
const create = useApiMutation("/api/notes", "POST");
const text = signal("");
async function save(): Promise<void> {
  await create.mutate({ body: { text: text.value } });
  text.value = "";
}
</script>

<template>
  <textarea model="text"></textarea>
  <button type="button" bind:disabled="create.pending.value" on:click="save">Guardar</button>
  <p if:when="create.error.value" role="alert">No se pudo guardar.</p>
</template>
```

## Parámetros

| Parámetro | Tipo | Por defecto | Descripción |
| --- | --- | --- | --- |
| `ruta` | ruta de un endpoint | obligatorio | Como `"/api/notes"` o `"/api/notes/[id]"`. |
| `método` | `"POST" \| "PUT" \| "PATCH" \| "DELETE"` | obligatorio | Uno de los métodos que el endpoint declara para esa ruta. `"GET"` lanza `TypeError: useApiMutation: GET <ruta> is a read; use useApi`. |
| `opciones.retrySafe` | `{ key, storage? }` | ninguno | Hace la escritura segura ante reintentos: guarda la intención con una clave de idempotencia y la reintenta con la misma clave si no hay respuesta. |
| `opciones.onSuccess` | `(output, attempt) => unknown` | ninguno | Se llama una vez por cada intento que termina bien, también los reintentos automáticos, con el estado ya actualizado. |
| `opciones.onError` | `(error, attempt) => unknown` | ninguno | Se llama una vez por cada intento que falla. `attempt.uncertain` es `true` si no hubo respuesta. |

## Valor devuelto

Una `ApiMutation`:

| Propiedad | Tipo | Descripción |
| --- | --- | --- |
| `mutate(input?)` | `Promise<Output>` | Envía `{ params, query, body }`, comprobados contra el contrato. Sin argumentos si la operación no exige nada. Un endpoint `204` resuelve con `undefined`. Rechaza con un `ClientError` si el servidor responde con error. |
| `pending` | `ReadonlySignal<boolean>` | `true` mientras una llamada está en curso. |
| `data` | `ReadonlySignal<Output \| null>` | Respuesta de la última llamada correcta, o `null`. |
| `error` | `ReadonlySignal<Error \| null>` | Fallo de la última llamada, o `null`. |

Con `retrySafe` añade `uncertain` (la intención enviada sin respuesta), `retry()` y `discard()`. Fuera del script de un componente lanza `Error: useApiMutation("<ruta>", "<método>") must be called while a component script runs, at the top level of <script>`.

## Ejemplos

### Borrar y recargar la lista

```html
<script lang="ts">
const notes = await useApi("/api/notes");
const remove = useApiMutation("/api/notes/[id]", "DELETE");
async function erase(id: string): Promise<void> {
  await remove.mutate({ params: { id } });
  await notes.refresh();
}
</script>

<template>
  <li each:of="notes.data.value" each:as="note" each:key="note.id">
    {note.text}
    <button type="button" bind:disabled="remove.pending.value" on:click="() => erase(note.id)">Borrar</button>
  </li>
</template>
```

### Con `useForm`

`useForm` lleva el estado del formulario y los errores por campo; la mutación hace el envío:

```html
<script lang="ts">
const create = useApiMutation("/api/notes", "POST");
const form = useForm({
  initial: { text: "" },
  submit: (values) => create.mutate({ body: values }),
});
</script>

<template>
  <form on:submit="form.submit" novalidate>
    <textarea model="form.fields.text"></textarea>
    <p if:when="form.errors.value.text">{form.errors.value.text}</p>
    <button bind:disabled="form.pending.value">Guardar</button>
  </form>
</template>
```

### Un cobro que no se aplica dos veces

```html
<script lang="ts">
const sale = useApiMutation("/api/sales", "POST", {
  retrySafe: { key: "pos:sale" },
  onSuccess(receipt, attempt) {
    if (attempt.trigger !== "mutate") notify(`Venta #${receipt.number} confirmada.`);
  },
});
</script>

<template>
  <div role="alert" if:when="sale.uncertain.value">
    <p>Venta en verificación: se reintentará con la misma clave, sin cobrar dos veces.</p>
    <button bind:disabled="sale.pending.value" on:click="() => sale.retry().catch(() => {})">Reintentar ahora</button>
  </div>
</template>
```

Si la red falla o el servidor responde `5xx`, `408` o `429`, la intención queda guardada y se reintenta con la misma cabecera `Idempotency-Key` al volver la conexión, al montarse un componente que la usa o con `retry()`. El servidor deduplica con `context.idempotencyKey`.

## Errores comunes

### Esperarlo con `await`

```ts bad
const create = await useApiMutation("/api/notes", "POST");
```

`meeko check` da `MEEK055: useApiMutation no se puede esperar con await; llámalo sin await y espera su mutate(input) en un handler`.

<!-- no-check -->
```ts good
const create = useApiMutation("/api/notes", "POST");
async function save(text: string): Promise<void> { await create.mutate({ body: { text } }); }
```

### Una lectura

```ts bad
const read = useApiMutation("/api/users", "GET");
```

`meeko check` da `TS2345: Argument of type '"/api/users"' is not assignable to parameter of type '"/api/notes" | "/api/notes/[id]"'`: sólo admite rutas con métodos de escritura. Para leer, usa [`useApi`](/docs/reference/use-api).

<!-- no-check -->
```ts good
const users = useApi("/api/users");
```

### El cuerpo sin `body`

`mutate` recibe la entrada de la operación (`params`, `query`, `body`), no el cuerpo directamente.

```ts bad
await create.mutate({ text: "hola" });
```

`meeko check` da `TS2353: Object literal may only specify known properties, and 'text' does not exist in type 'ApiMutationInput<…>'`.

<!-- no-check -->
```ts good
await create.mutate({ body: { text: "hola" } });
```

### Crearlo en el manejador

```ts bad
async function save(): Promise<void> {
  await useApiMutation("/api/notes", "POST").mutate({ body: { text: "x" } });
}
```

El compilador no lo marca (para no rechazar funciones propias con el mismo nombre), pero en ejecución lanza `Error: useApiMutation("/api/notes", "POST") must be called while a component script runs, at the top level of <script>`. Créalo en el nivel superior:

<!-- no-check -->
```ts good
const create = useApiMutation("/api/notes", "POST");
async function save(): Promise<void> { await create.mutate({ body: { text: "x" } }); }
```

## Notas

- **Nunca en SSR.** `mutate` sólo se ejecuta en el navegador, en un manejador. El servidor nunca envía mutaciones, ni las pasadas en seco de una navegación.
- **Estado coherente.** Cada envío pone `pending` en `true` y `error` en `null` en una sola actualización, y termina escribiendo a la vez `data` o `error` y `pending` en `false`.
- **Seguridad.** La petición lleva el token CSRF de la sesión en `x-meeko-csrf` y el `Origin` del navegador; el endpoint aplica sus propias guardas (`auth`, `authorize`, `rateLimit`). No confíes en el cliente para autorizar.
- **Errores.** Un error del servidor llega como `ClientError`, con `code`, `status` y, en un `400`, `issues`. Un fallo dentro de `onSuccess` u `onError` va al [`provideErrorHandler`](/docs/reference/provideerrorhandler) más cercano con la fuente `"event"` y no cambia el resultado.
- **`retrySafe`.** Usa una clave por mutación que incluya lo que distinga a usuarios o cuentas del mismo navegador. Mientras haya una intención incierta, `mutate` rechaza con `MUTATION_UNCERTAIN` sin enviar nada: resuélvela con `retry()` o `discard()`.
