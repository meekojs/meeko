---
title: ClientError
group: utils
since: 1.0.0
description: El error con que los clientes de API, RPC y Socket rechazan una respuesta de error del servidor, con su código, su estado, el requestId y los issues por campo.
symbols:
  - "@meekojs/meeko/framework#ClientError"
types:
  - "@meekojs/meeko/framework#ValidationIssue"
related:
  - "@meekojs/meeko/framework#isClientError"
  - "@meekojs/meeko/server#ApiError"
  - "autoimport:api"
  - "autoimport:rpc"
  - "@meekojs/meeko/framework#useForm"
  - docs/framework.md#errores-de-validación-en-formularios
  - docs/framework.md#errores
---

`ClientError` es lo que reciben el navegador y el código de servidor cuando una llamada de `api.*`, `rpc.*`, `useApi`, `useRpcQuery`, `useApiMutation` o `useRpcMutation` termina en una respuesta de error. Es la otra cara de `ApiError`: lleva el `code` y el `status` públicos, el `requestId` de la petición y, si los hay, los `issues` por campo. Un canal Socket rechazado por sesión o autorización también entrega un `ClientError` (`401 UNAUTHENTICATED` o `403 FORBIDDEN`).

Su `message` es el código. Una respuesta de error sin `code` usa `HTTP_ERROR`, y una respuesta correcta que no es JSON, `INVALID_RESPONSE`.

## Uso

```ts
import { ClientError } from "@meekojs/meeko/framework";

export async function rename(call: () => Promise<unknown>): Promise<string | null> {
  try {
    await call();
    return null;
  } catch (error) {
    if (error instanceof ClientError && error.status === 409) return "Ese nombre ya existe.";
    if (error instanceof ClientError) console.warn(error.code, error.requestId);
    throw error;
  }
}
```

## Parámetros

`new ClientError(code, status, requestId?, issues?)`. Normalmente no se crea a mano: lo crean los clientes de Meeko.

| Parámetro | Tipo | Por defecto | Descripción |
| --- | --- | --- | --- |
| `code` | `string` | obligatorio | El código público, que también es el `message`. |
| `status` | `number` | obligatorio | El estado HTTP. |
| `requestId` | `string` | ninguno | El ID de la petición, el mismo que la cabecera `x-request-id` y los registros del servidor. |
| `issues` | `readonly { path, message }[]` | ninguno | Los mensajes por campo de un `400` de validación o de un `ApiError` con `issues`. |

## Valor devuelto

Una instancia de `Error` con `name: "ClientError"`, `code`, `status`, `requestId` e `issues`, todos de sólo lectura. `issues` es `undefined` si la respuesta no los trae.

## Ejemplos

### Mensajes por campo sin `useForm`

```ts
import { ClientError } from "@meekojs/meeko/framework";

export function fieldMessage(error: unknown, path: string): string | undefined {
  return error instanceof ClientError ? error.issues?.find((issue) => issue.path === path)?.message : undefined;
}
```

Con `useRpcMutation`, `fieldMessage(login.error.value, "password")` da el mensaje del schema para ese campo. `useForm` hace este reparto por ti.

### Distinguir un error previsto de un fallo de red

`fetch` rechaza con un `TypeError` cuando no hay red; el servidor, con un `ClientError`:

```ts
import { isClientError } from "@meekojs/meeko/framework";

export function errorText(failure: unknown): string {
  if (isClientError(failure, "RATE_LIMITED")) return "Demasiados intentos. Espera un momento.";
  if (isClientError(failure)) return `No se pudo guardar (${failure.code}).`;
  return "No se pudo conectar. Inténtalo de nuevo.";
}
```

Es la forma típica del `errorMessage` de `useForm`.

## Errores comunes

### Leer `message` esperando el texto del servidor

`message` es el código, no el mensaje interno del `ApiError`, que nunca sale del servidor.

```ts bad
alert(error.message); // "EMAIL_TAKEN"
```

<!-- no-check -->
```ts good
alert(error.issues?.[0]?.message ?? "No se pudo crear la cuenta.");
```

### Leer propiedades de un `unknown` sin comprobar

En un `catch` o en un observador de errores, el error es `unknown`.

```ts bad
try { await save(); } catch (error) { console.log(error.code); }
```

`TS18046: 'error' is of type 'unknown'.`

<!-- no-check -->
```ts good
try { await save(); } catch (error) { if (isClientError(error)) console.log(error.code); else throw error; }
```

### `instanceof` con dos copias de Meeko

Con dos copias del paquete en la misma página (un paquete enlazado, una dependencia duplicada), `instanceof ClientError` falla para el error de la otra copia, sin ningún aviso.

```ts bad
if (error instanceof ClientError && error.code === "UNAUTHENTICATED") location.assign("/login");
```

<!-- no-check -->
```ts good
if (isClientError(error, "UNAUTHENTICATED")) location.assign("/login");
```

## Notas

- **Origen.** Los clientes generados lo crean a partir del JSON de error `{ code, status, requestId, issues? }`. Un `500` desconocido llega como `INTERNAL_ERROR`, sin detalles.
- **Observadores.** Un `ClientError` es una respuesta prevista: `useForm` no lo envía al observador de errores del componente, pero sí cualquier otro fallo.
- **Soporte.** Muestra o registra `requestId`: es el mismo ID que el servidor escribe en sus registros, y permite encontrar el fallo.
