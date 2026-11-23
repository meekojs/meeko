---
title: ApiError
group: utils
since: 1.0.0
description: Error público de API, RPC, Socket y loaders, que llega al cliente con su código, su estado y, desde 1.5, mensajes por campo y, desde 1.10, datos públicos.
symbols:
  - "@meekojs/meeko/server#ApiError"
types:
  - "@meekojs/meeko/server#ApiErrorDetails"
related:
  - "@meekojs/meeko/framework#ClientError"
  - "@meekojs/meeko/framework#isClientError"
  - "@meekojs/meeko/server#defineApiRoute"
  - "@meekojs/meeko/server#defineRpc"
  - "@meekojs/meeko/framework#useForm"
  - docs/framework.md#errores-de-un-campo-apierror-con-issues
  - docs/framework.md#datos-públicos-de-un-error-apierror-con-details
  - docs/framework.md#errores
---

`new ApiError(code, status, mensaje?)` es el error que el servidor **puede contar** al cliente. Lanzado desde un endpoint, un procedimiento RPC, un canal Socket, un loader o un `defer`, la respuesta lleva su `code` y su `status`, más el `requestId` de la petición. Cualquier otro error se responde como `INTERNAL_ERROR`/`500` sin exponer su mensaje.

Desde `1.5`, el tercer argumento también acepta `{ message, issues }`: `issues` son mensajes públicos por campo, con la forma de los de un `400` de validación, que `useForm` muestra junto a cada campo. Desde `1.10`, `details` añade datos públicos estructurados (un objeto JSON) para que el cliente reaccione al error. `message` siempre es interno.

Se autoimporta en el código de servidor.

## Uso

<!-- no-check -->

```ts
// server/rpc/users/get.ts
import { ApiError, defineRpc } from "@meekojs/meeko/server";
import { userParams, userSchema } from "../../../shared/schemas/user";

export default defineRpc({
  input: userParams,
  output: userSchema,
  handler: async ({ input }) => {
    const user = await findUser(input.id);
    if (!user) throw new ApiError("USER_NOT_FOUND", 404);
    return user;
  },
});
```

La respuesta es `404` con `{ "code": "USER_NOT_FOUND", "status": 404, "requestId": "…" }`, y `rpc.users.get(…)` rechaza con un `ClientError` con ese `code` y ese `status`.

## Parámetros

| Parámetro | Tipo                                         | Por defecto | Descripción                                                                                                                                                                          |
| --------- | -------------------------------------------- | ----------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `code`    | `string`                                     | obligatorio | Código público, estable, que el cliente puede comparar: `"NOT_FOUND"`, `"EMAIL_TAKEN"`.                                                                                              |
| `status`  | `number`                                     | obligatorio | Estado HTTP de la respuesta, normalmente un `4xx`.                                                                                                                                   |
| `message` | `string` o `{ message?, issues?, details? }` | `code`      | El mensaje interno, que nunca se envía. Desde `1.5`, `issues: [{ path, message }]` añade mensajes públicos por campo, y desde `1.10`, `details` (`ApiErrorDetails`), datos públicos. |

Cada issue necesita un `path` de texto (las claves unidas con `.`, o `""` para el formulario entero) y un `message` no vacío. `details` es un objeto JSON (textos, números finitos, booleanos, `null`, arrays y objetos simples, como mucho 32 niveles); cualquier otro valor lanza un `TypeError`, y el error guarda una copia congelada.

## Valor devuelto

Una instancia de `Error` con `name: "ApiError"`, `code`, `status`, `message`, `issues` y `details`. Lo que llega al cliente:

| Campo            | Viaja                    | Notas                                         |
| ---------------- | ------------------------ | --------------------------------------------- |
| `code`, `status` | Sí                       | Más `requestId` y la cabecera `x-request-id`. |
| `issues`         | Sólo con un estado `4xx` | Como mucho 20.                                |
| `details`        | Sólo con un estado `4xx` | Desde `1.10`; en `ClientError.details`.       |
| `message`        | Nunca                    | Úsalo para los registros del servidor.        |

## Ejemplos

### Un conflicto en un campo

<!-- no-check -->

```ts
// server/api/signup.post.ts
import { ApiError, defineApiRoute } from "@meekojs/meeko/server";
import { signupInput, signupResult } from "../../shared/schemas/signup";

export default defineApiRoute({
  body: signupInput,
  response: signupResult,
  status: 201,
  handler: async ({ body }) => {
    if (await emailTaken(body.email)) {
      throw new ApiError("EMAIL_TAKEN", 409, {
        message: `duplicate key for ${body.email}`, // interno
        issues: [{ path: "email", message: "Ese correo ya tiene una cuenta." }],
      });
    }
    return createUser(body);
  },
});
```

En el cliente, `form.errors.value.email` de `useForm` es «Ese correo ya tiene una cuenta.».

### Datos para que el cliente reaccione

Desde `1.10`, un conflicto de concurrencia optimista envía la versión actual para que el cliente recargue o reintente:

<!-- no-check -->

```ts
// server/rpc/visits/update.ts
import { ApiError, defineRpc } from "@meekojs/meeko/server";

export default defineRpc({
  input: visitUpdate,
  output: visitSchema,
  handler: async ({ input }) => {
    const visit = await visits.find(input.id);
    if (visit.version !== input.version) {
      throw new ApiError("VERSION_CONFLICT", 409, { message: `visit ${visit.id} is stale`, details: { actualVersion: visit.version } });
    }
    return visits.update(visit, input);
  },
});
```

La respuesta es `409` con `{ "code": "VERSION_CONFLICT", …, "details": { "actualVersion": 8 } }`, y `isClientError(error, "VERSION_CONFLICT")` da acceso a `error.details` (véase [`isClientError`](/docs/reference/isclienterror)).

### Un `404` desde un loader

Un `ApiError` con estado `404` en un loader muestra la página de error más cercana con `{ status: 404, message: "NOT_FOUND" }`:

<!-- no-check -->

```ts
// app/pages/products/[slug].route.ts
import { definePage } from "@meekojs/meeko/framework";
import { ApiError } from "@meekojs/meeko/server";

export const route = definePage({
  load: async ({ params }) => {
    const product = await catalog.find(params.slug);
    if (!product) throw new ApiError("NOT_FOUND", 404);
    return { name: product.name };
  },
});
```

### Errores de permisos desde `locals`

<!-- no-check -->

```ts
locals: async ({ session }) => {
  const user = await findUser((session.current!.data as { userId: string }).userId);
  if (!user) throw new ApiError("UNAUTHENTICATED", 401);
  if (!user.active) throw new ApiError("ACCOUNT_DISABLED", 403);
  return { user };
},
```

## Errores comunes

### Poner datos privados en el código o en los `issues`

`code` y los `issues` llegan al navegador; `message` no. Un dato privado en el sitio público se filtra sin ningún error.

```ts bad
throw new ApiError(`USER_${user.email}_LOCKED`, 403);
```

<!-- no-check -->

```ts good
throw new ApiError("ACCOUNT_LOCKED", 403, { message: `locked: ${user.email}` });
```

### Pasar a `details` un objeto que no es JSON

```ts bad
throw new ApiError("BOOKING_TAKEN", 409, { details: { until: new Date() } });
```

`meeko check` da un `TS2322` en `until`. Sin tipos, crear el error lanza `TypeError: ApiError details must be a plain JSON object: …`. Convierta la fecha a texto, y no pase nunca a `details` el error original ni una fila completa de la base de datos: todo lo que contiene llega al navegador.

<!-- no-check -->

```ts good
throw new ApiError("BOOKING_TAKEN", 409, { details: { until: booking.until.toISOString() } });
```

### Un issue sin `message`

```ts bad
throw new ApiError("INVALID", 409, { issues: [{ path: "email" }] });
```

`meeko check` da `TS2741: Property 'message' is missing in type '{ path: string; }' but required in type 'ApiErrorIssue'.` Sin tipos, crear el error lanza `TypeError: Each ApiError issue needs a string path and a nonempty string message`.

<!-- no-check -->

```ts good
throw new ApiError("INVALID", 409, { issues: [{ path: "email", message: "Revisa el correo." }] });
```

### Lanzar un `Error` normal esperando que llegue al cliente

```ts bad
throw new Error("Ese correo ya tiene una cuenta");
```

La respuesta es `500` `INTERNAL_ERROR`, sin el mensaje, y el servidor lo registra como un fallo interno.

<!-- no-check -->

```ts good
throw new ApiError("EMAIL_TAKEN", 409, { issues: [{ path: "email", message: "Ese correo ya tiene una cuenta." }] });
```

## Notas

- **Seguridad.** Es la frontera entre lo que el servidor sabe y lo que cuenta. Escribe `issues` pensando en el usuario y deja los detalles en `message`, que nunca sale del servidor.
- **`4xx` y `5xx`.** Los `issues` y los `details` sólo viajan con un `4xx`: un `5xx` es un fallo del servidor y responde sin ellos. Las respuestas `4xx` no se registran como fallos internos.
- **Otras copias.** Un `ApiError` de otro grafo de módulos (Vite) conserva sus `issues` y sus `details`. Un error con la misma forma de otro origen (el `ApiError` de un SDK, un `ClientError` de otro servicio) no envía ninguno de los dos.
- **Formularios sin JavaScript.** El `303` de una ruta con `form` no lleva `details`, sólo el código, el estado y los `issues`.
- **Dónde no se usa.** En un componente, `ApiError` es `MEEK108`: el navegador recibe los errores como `ClientError`.
