---
title: useRpcMutation
group: composables
since: 1.1.0
description: Llama bajo demanda a un procedimiento de server/rpc que cambia datos, con su estado de envío, sus errores y reintentos seguros.
symbols:
  - "autoimport:useRpcMutation"
types:
  - "@meekojs/meeko/framework#UseRpcMutation"
  - "@meekojs/meeko/framework#RpcMutation"
  - "@meekojs/meeko/framework#MutationOptions"
  - "@meekojs/meeko/framework#RetrySafeMutation"
related:
  - "autoimport:useRpcQuery"
  - "autoimport:useApiMutation"
  - "@meekojs/meeko/framework#useForm"
  - "@meekojs/meeko/server#defineRpc"
  - "autoimport:rpc"
  - docs/framework.md#mutaciones
  - docs/framework.md#mutaciones-seguras-ante-reintentos
---

`useRpcMutation(procedimiento, opciones?)` prepara una llamada a un procedimiento de `server/rpc` que cambia datos. No hace nada hasta que llamas a `mutate(input)`, nunca en SSR; entonces envía el token CSRF como `rpc.*`, actualiza `pending`, `data` y `error` y devuelve la salida del procedimiento, o rechaza con su error. Es la pareja de [`useRpcQuery`](/docs/reference/use-rpc-query) para escribir, y la de [`useApiMutation`](/docs/reference/use-api-mutation) para RPC.

Lo generan los clientes de la aplicación y se autoimporta en los `.meeko`; se llama en el nivel superior del `<script>`.

## Uso

```html
<!-- app/components/RenameUser.meeko -->
<script lang="ts">
const props = defineProps<{ id: string; name: string }>();
const rename = useRpcMutation("users.rename");
const name = signal(props.name);
async function save(): Promise<void> {
  await rename.mutate({ id: props.id, name: name.value });
}
</script>

<template>
  <input model="name">
  <button type="button" bind:disabled="rename.pending.value" on:click="save">Guardar</button>
  <p if:when="rename.error.value" role="alert">{rename.error.value.message}</p>
</template>
```

## Parámetros

| Parámetro | Tipo | Por defecto | Descripción |
| --- | --- | --- | --- |
| `procedimiento` | ID de un procedimiento | obligatorio | Como `"users.rename"`. |
| `opciones.retrySafe` | `{ key, storage? }` | ninguno | Desde `1.2`. Guarda la intención con una clave de idempotencia y la reintenta con la misma clave si no hay respuesta. |
| `opciones.onSuccess` | `(output, attempt) => unknown` | ninguno | Desde `1.2`. Una vez por cada intento que termina bien, también los reintentos automáticos. |
| `opciones.onError` | `(error, attempt) => unknown` | ninguno | Desde `1.2`. Una vez por cada intento que falla; `attempt.uncertain` dice si no hubo respuesta. |

## Valor devuelto

Una `RpcMutation<Input, Output>`:

| Propiedad | Tipo | Descripción |
| --- | --- | --- |
| `mutate(input)` | `Promise<Output>` | Llama al procedimiento. Resuelve con su salida o rechaza con su error (un `ClientError` si el servidor respondió). |
| `pending` | `ReadonlySignal<boolean>` | `true` mientras una llamada está en curso. |
| `data` | `ReadonlySignal<Output \| null>` | Salida de la última llamada correcta, o `null`. |
| `error` | `ReadonlySignal<Error \| null>` | Fallo de la última llamada, o `null`. |

Con `retrySafe` añade `uncertain`, `retry()` y `discard()` (`RetrySafeMutation`).

## Ejemplos

### Escribir y volver a leer

```html
<script lang="ts">
const props = defineProps<{ params: { id: string }; search: Record<string, string | string[]> }>();
const user = await useApi("/api/users/[id]", { params: { id: props.params.id } });
const rename = useRpcMutation("users.rename");
async function save(name: string): Promise<void> {
  await rename.mutate({ id: props.params.id, name });
  await user.refresh();
}
</script>
```

### Avisos de cada intento

```html
<script lang="ts">
const rename = useRpcMutation("users.rename", {
  onSuccess: (user) => notify(`Guardado como ${user.name}.`),
  onError: (error) => notify(isClientError(error) ? "El nombre no es válido." : "No se pudo conectar."),
});
</script>
```

`onSuccess` y `onError` se llaman después de actualizar `data`, `error` y `pending`. La promesa de `mutate` sigue resolviendo o rechazando como siempre.

### Un cobro seguro ante reintentos

```html
<script lang="ts">
const charge = useRpcMutation("sales.checkout", { retrySafe: { key: "pos:sale" } });
const failure = signal("");
async function pay(input: SaleInput): Promise<void> {
  failure.value = "";
  try {
    await charge.mutate(input);
  } catch (error) {
    // Sin respuesta: queda en verificación y se reintentará con la misma clave.
    if (!charge.uncertain.value) failure.value = error instanceof Error ? error.message : String(error);
  }
}
function discard(): void {
  if (window.confirm("Descarta esta venta sólo si comprobaste que no se registró.")) charge.discard();
}
</script>

<template>
  <div role="alert" if:when="charge.uncertain.value">
    <p>Venta en verificación: se reintentará con la misma clave, así que no se cobrará dos veces.</p>
    <button bind:disabled="charge.pending.value" on:click="() => charge.retry().catch(() => {})">Reintentar ahora</button>
    <button on:click="discard">Descartar</button>
  </div>
  <p if:when="failure.value">{failure.value}</p>
</template>
```

## Errores comunes

### Esperarlo con `await`

```ts bad
const rename = await useRpcMutation("users.rename");
```

`meeko check` da `MEEK055: useRpcMutation no se puede esperar con await; llámalo sin await y espera su mutate(input) en un handler`.

<!-- no-check -->
```ts good
const rename = useRpcMutation("users.rename");
```

### Crearlo dentro de una función

```ts bad
async function save(): Promise<void> {
  await useRpcMutation("users.rename").mutate({ id: "1", name: "Ada" });
}
```

`meeko check` da `MEEK054: useRpcMutation() debe llamarse en el nivel superior de <script>, no dentro de una función, un handler, un effect ni onMounted`.

<!-- no-check -->
```ts good
const rename = useRpcMutation("users.rename");
async function save(): Promise<void> { await rename.mutate({ id: "1", name: "Ada" }); }
```

### Una entrada con otro tipo

```ts bad
const save = () => rename.mutate({ id: 1, name: "Ada" });
```

`meeko check` da `TS2322: Type 'number' is not assignable to type 'string'`: la entrada se comprueba contra el schema `input` del procedimiento.

<!-- no-check -->
```ts good
const save = () => rename.mutate({ id: String(user.id), name: "Ada" });
```

### Un rechazo sin manejar

```html bad
<button on:click="() => rename.mutate({ id, name: name.value })">Guardar</button>
```

Si el servidor responde con error, la promesa rechaza; el manejador la entrega al `provideErrorHandler` más cercano (fuente `"event"`) y `rename.error` lo refleja. Si quieres tratar el error ahí mismo, captúralo:

```html good
<button on:click="() => rename.mutate({ id, name: name.value }).catch(() => {})">Guardar</button>
<p if:when="rename.error.value" role="alert">No se pudo guardar.</p>
```

## Notas

- **Nunca en SSR.** El servidor y las pasadas en seco de una navegación nunca envían una mutación; con `retrySafe`, tampoco la reintentan.
- **Estado coherente.** Desde `1.2`, cada envío empieza con `pending` en `true` y `error` en `null` en una sola actualización, y termina escribiendo a la vez `data` o `error` y `pending` en `false`.
- **Seguridad.** La llamada lleva el token CSRF de la sesión y el `Origin`; el procedimiento aplica sus propias guardas. Con `retrySafe`, la entrada se guarda en el almacenamiento del navegador: no incluyas secretos.
- **`retrySafe`.** Mientras haya una intención incierta bajo la clave, `mutate` rechaza con `MUTATION_UNCERTAIN` sin enviar nada. El servidor recibe la clave validada en `context.idempotencyKey` y es quien deduplica.
