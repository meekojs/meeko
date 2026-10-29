---
title: isClientError
group: utils
since: 1.3.0
description: Comprueba si un valor unknown es un ClientError y, opcionalmente, si tiene un código concreto, también entre dos copias de Meeko.
symbols:
  - "@meekojs/meeko/framework#isClientError"
related:
  - "@meekojs/meeko/framework#ClientError"
  - "@meekojs/meeko/server#ApiError"
  - "@meekojs/meeko#provideErrorHandler"
  - "@meekojs/meeko/framework#mountClientApp"
  - docs/framework.md#errores
---

`isClientError(error, code?)` comprueba si `error` es un [`ClientError`](/docs/reference/clienterror) y, con `code`, si tiene ese código. Es un *type guard*: en la rama verdadera, TypeScript sabe que `error` es un `ClientError` (y, con `code`, que `error.code` es ese literal).

Sirve donde el error llega como `unknown`: un `catch`, `provideErrorHandler`, el `onError` de `mountClientApp` o el `errorMessage` de `useForm`. A diferencia de `instanceof`, reconoce también el `ClientError` de otra copia de Meeko en la misma página.

## Uso

```ts
import { isClientError } from "@meekojs/meeko/framework";

export function describe(error: unknown): string {
  if (isClientError(error, "UNAUTHENTICATED")) return "Tu sesión ha caducado.";
  if (isClientError(error)) return `Error ${error.status} (${error.code}), petición ${error.requestId ?? "desconocida"}`;
  return "Error inesperado";
}
```

## Parámetros

| Parámetro | Tipo | Por defecto | Descripción |
| --- | --- | --- | --- |
| `error` | `unknown` | obligatorio | El valor que se comprueba. |
| `code` | `string` | cualquiera | El código esperado, como `"NOT_FOUND"`. Con un literal, estrecha `error.code` a ese literal. |

## Valor devuelto

`true` si `error` es un `ClientError` (de esta copia de Meeko o de otra) y, con `code`, si su código coincide; `false` en cualquier otro caso, también con un `Error` cuyo `message` sea el código o con un objeto que sólo tenga `code` y `status`.

## Ejemplos

### Un observador de errores de la aplicación

<!-- no-check -->
```ts
import { isClientError, mountClientApp } from "@meekojs/meeko/framework";

await mountClientApp({
  ...options,
  onError(error, source) {
    if (isClientError(error, "UNAUTHENTICATED")) location.assign("/login");
    else if (isClientError(error)) console.warn(source, error.code, error.requestId);
    else console.error(source, error);
  },
});
```

### El mensaje de un formulario

```html
<script lang="ts">
const form = useForm({
  initial: { name: "" },
  submit: (values) => api.users({ id: "me" }).patch({ body: values }),
  errorMessage: (failure) => isClientError(failure, "RATE_LIMITED")
    ? "Demasiados intentos. Espera un momento."
    : isClientError(failure) ? "No se pudo enviar." : "No se pudo conectar.",
});
</script>

<template>
  <form on:submit="form.submit">
    <input model="form.fields.name" aria-label="Nombre">
    <p if:when="form.error.value" role="alert">{form.error.value}</p>
  </form>
</template>
```

### Reaccionar a un `404` en un componente

```html
<script lang="ts">
const props = defineProps<{ id: string }>();
const user = useApi("/api/users/[id]", () => ({ params: { id: props.id } }));
const missing = computed(() => isClientError(user.error.value, "NOT_FOUND"));
</script>

<template>
  <MeekoAwait for="user">
    <p if:when="user.data.value">{user.data.value?.name}</p>
  </MeekoAwait>
  <p if:when="missing.value">Ese usuario no existe.</p>
</template>
```

## Errores comunes

### Comparar `message` en lugar del código

Un `Error` normal con el mismo texto no es un `ClientError`.

```ts bad
if (error instanceof Error && error.message === "NOT_FOUND") showNotFound();
```

No es un error de compilación, pero también acepta errores que no vienen del servidor.

<!-- no-check -->
```ts good
if (isClientError(error, "NOT_FOUND")) showNotFound();
```

### Leer `code` sin comprobar el tipo

```ts bad
provideErrorHandler((error) => console.warn(error.code));
```

`meeko check` da `TS18046: 'error' is of type 'unknown'.`

<!-- no-check -->
```ts good
provideErrorHandler((error) => { if (isClientError(error)) console.warn(error.code); });
```

## Notas

- **Dos copias.** Con un paquete enlazado o una dependencia duplicada, `instanceof ClientError` falla para los errores de la otra copia; `isClientError` no.
- **Códigos.** Los de Meeko son estables: `UNAUTHENTICATED`, `FORBIDDEN`, `NOT_FOUND`, `RATE_LIMITED`, `INVALID_PARAMS`, `INVALID_QUERY`, `INVALID_BODY`, `INVALID_INPUT`, `INTERNAL_ERROR`, `HTTP_ERROR`, `INVALID_RESPONSE`. Los tuyos son los de tus `ApiError`.
- **Rendimiento.** Es una comprobación barata, sin red ni reflexión: úsala en cada rama de un observador.
