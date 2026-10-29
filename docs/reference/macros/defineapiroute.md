---
title: defineApiRoute
group: macros
since: 1.0.0
description: Declara un endpoint de server/api con sus schemas públicos, guardas, estado y handler; el servidor valida todo y genera el cliente api.* tipado.
symbols:
  - "@meekojs/meeko/server#defineApiRoute"
types:
  - "@meekojs/meeko/server#ApiRouteDefinition"
  - "@meekojs/meeko/server#ApiFormOptions"
related:
  - "@meekojs/meeko/server#defineRpc"
  - "@meekojs/meeko/server#ApiError"
  - "autoimport:api"
  - "autoimport:useApi"
  - "@meekojs/meeko/framework#useForm"
  - "@meekojs/meeko/server#generateOpenApi"
  - docs/framework.md#api-y-rpc
  - docs/framework.md#formularios-sin-javascript-form
  - docs/framework.md#estado-de-la-respuesta-status
  - docs/framework.md#valores-por-petición-locals
---

`defineApiRoute` declara un endpoint HTTP: el export por defecto de `server/api/<ruta>.<método>.ts`. `server/api/users/[id].get.ts` atiende `GET /api/users/:id`. El servidor valida la entrada con los schemas (`params`, `query`, `body`), la sesión, la autorización, el `Origin` y el token CSRF, ejecuta el handler y valida su resultado con `response`.

Los schemas públicos viven en `shared/` y son [Standard Schema](https://standardschema.dev) (Valibot, Zod, ArkType…). A partir de ellos, Meeko genera el cliente `api.*`, que `useApi` y `useApiMutation` usan con los mismos tipos, sin importar el handler. Desde `1.7`, `form` hace que el mismo endpoint atienda también un `<form method="post">` nativo, sin JavaScript.

## Uso

<!-- no-check -->
```ts
// shared/schemas/user.ts
import * as v from "valibot";

export const userParams = v.object({ id: v.string() });
export const userSchema = v.object({ id: v.string(), name: v.string() });
```

<!-- no-check -->
```ts
// server/api/users/[id].get.ts
import { ApiError, defineApiRoute } from "@meekojs/meeko/server";
import { userParams, userSchema } from "../../../shared/schemas/user";

export default defineApiRoute({
  params: userParams,
  response: userSchema,
  handler: async ({ params }) => {
    const user = await findUser(params.id);
    if (!user) throw new ApiError("NOT_FOUND", 404);
    return { id: user.id, name: user.name };
  },
});
```

En la aplicación, `await api.users({ id: "7" }).get()` devuelve `{ id: string; name: string }`.

## Opciones

| Opción | Tipo | Por defecto | Descripción |
| --- | --- | --- | --- |
| `params` | Standard Schema | ninguno | Los segmentos dinámicos (`[id]`), como cadenas obligatorias. Obligatorio en una ruta dinámica y prohibido en una estática. |
| `query` | Standard Schema | ninguno | La query string. Sus campos aceptan texto o listas de texto; convierte los números dentro del schema. |
| `body` | Standard Schema | ninguno | El cuerpo JSON (y, con `form`, el del formulario). Límite de 1 MiB. |
| `response` | Standard Schema | obligatorio salvo con `status: 204` o `contentType: "response"` | El resultado del handler. Uno que no lo supera responde `500` sin detalle. |
| `status` | `200 \| 201 \| 202 \| 204` | `200` | Desde `1.2`. Estado de una respuesta correcta. Con `204` no hay cuerpo ni `response`. **Debe ser un literal.** |
| `auth` | `"required" \| "optional"` | `"optional"` | Con `"required"`, una petición sin sesión responde `401`. |
| `authorize` | `(context) => boolean \| Promise<boolean>` | ninguno | Con `false`, `403 FORBIDDEN`. |
| `origin` | `"required" \| "none"` | según la sesión | `"required"` exige un `Origin` permitido aunque no haya sesión (un inicio de sesión, un registro). |
| `rateLimit` | `{ limit, window, key? }` | ninguno | Desde `1.2`. Límite de peticiones por ventana; por encima, `429` con `Retry-After`. |
| `locals` | `(context) => L \| Promise<L>` | ninguno | Desde `1.2`. Un valor por petición (el usuario actual) que el handler recibe tipado en `locals`. Decláralo antes de `handler`. |
| `contentType` | `"json" \| "response"` | `"json"` | Con `"response"`, el handler devuelve su propio `Response` (un archivo, un CSV, un stream). |
| `form` | `true` o `{ redirect?, maxBytes?, files?, echo? }` | sin formularios | Desde `1.7`. Acepta `application/x-www-form-urlencoded` y `multipart/form-data`, validados con `body`, y responde `303` a la página. `echo` lista los campos cuyo valor vuelve a la página tras un error; por defecto, ninguno. Véase abajo. |
| `handler` | `({ params, query, body, context, locals }) => resultado` | obligatorio | La lógica. `context` es el `RequestContext`: `session`, `services`, `platform`, `requestId`, `clientAddress`, `signal`. |

El orden de cada petición es: `Origin` con `origin: "required"`, `Origin` y CSRF de la sesión, `rateLimit`, `auth`, `authorize`, validación de la entrada, `locals`, `handler` y validación de la respuesta. Un formulario nativo cuenta `rateLimit` antes, tras `Origin` y antes de leer el cuerpo, porque el token CSRF viaja en él.

## Valor devuelto

La misma definición, con sus tipos inferidos. Es lo que el servidor ejecuta y de lo que `meeko routes`, `meeko check` y `meeko dev` generan el contrato del cliente. Las respuestas:

| Caso | Respuesta |
| --- | --- |
| Correcta | El estado de `status`, con el JSON de `response` (o sin cuerpo con `204`) |
| Entrada inválida | `400` `INVALID_PARAMS`, `INVALID_QUERY` o `INVALID_BODY`, con `issues: [{ path, message }]` (como mucho 20) |
| `ApiError(code, status)` | Ese estado, con `{ code, status, requestId }` y sus `issues` si es un `4xx` |
| Cualquier otro error | `500` `INTERNAL_ERROR`, sin el mensaje; el servidor lo registra |
| Formulario nativo (`form`) | `303 See Other` a la página, con el resultado en una cookie de un solo uso |

## Ejemplos

### Crear con `201` y la sesión

<!-- no-check -->
```ts
// server/api/orders/index.post.ts
import { ApiError, defineApiRoute } from "@meekojs/meeko/server";
import { newOrder, orderSchema } from "../../../shared/schemas/order";

export default defineApiRoute({
  auth: "required",
  body: newOrder,
  response: orderSchema,
  status: 201,
  rateLimit: { limit: 20, window: "1m" },
  locals: async ({ session }) => {
    const user = await findUser((session.current?.data as { userId: string }).userId);
    if (!user) throw new ApiError("UNAUTHENTICATED", 401);
    return { user };
  },
  handler: ({ body, locals }) => createOrder(locals.user, body),
});
```

### Borrar con `204`

<!-- no-check -->
```ts
// server/api/orders/[id].delete.ts
import { defineApiRoute } from "@meekojs/meeko/server";
import { orderParams } from "../../../shared/schemas/order";

export default defineApiRoute({
  params: orderParams,
  auth: "required",
  status: 204,
  handler: async ({ params }) => { await deleteOrder(params.id); },
});
```

`await api.orders({ id }).delete()` resuelve `undefined`.

### Un error en un campo

Desde `1.5`, un `ApiError` con `issues` lleva el mensaje a un campo, que `useForm` muestra junto a él:

<!-- no-check -->
```ts
// server/api/signup.post.ts
import { ApiError, defineApiRoute } from "@meekojs/meeko/server";
import { signupInput, signupResult } from "../../shared/schemas/signup";

export default defineApiRoute({
  origin: "required",
  body: signupInput,
  response: signupResult,
  status: 201,
  handler: async ({ body }) => {
    if (await emailTaken(body.email)) {
      throw new ApiError("EMAIL_TAKEN", 409, { message: `duplicate ${body.email}`, issues: [{ path: "email", message: "Ese correo ya tiene una cuenta." }] });
    }
    return createUser(body);
  },
});
```

El `message` del tercer argumento es interno y nunca se envía; los `issues` son públicos.

### Un formulario sin JavaScript

Desde `1.7`, con `form`, el mismo endpoint atiende el envío nativo del navegador. Los campos llegan como texto y, si el schema los rechaza, Meeko los vuelve a validar una vez con su lectura tipada (`""` → `undefined`, `"on"`/`"true"` → `true`, `"false"` → `false`, un número decimal → `number`), así que `v.boolean()` y `v.number()` sirven tal cual. Un schema asíncrono se ejecuta una sola vez, sin ese segundo intento:

<!-- no-check -->
```ts
// server/api/feedback.post.ts
import { defineApiRoute } from "@meekojs/meeko/server";
import { feedbackInput, feedbackSaved } from "../../shared/schemas/feedback";

export default defineApiRoute({
  body: feedbackInput,
  response: feedbackSaved,
  // Tras un error, el comentario vuelve a la página; ningún otro valor.
  form: { redirect: (saved) => `/gracias?id=${saved.id}`, echo: ["comment"] },
  handler: ({ body }) => saveFeedback(body),
});
```

```html
<!-- app/components/Feedback.meeko -->
<script lang="ts">
const route = useRoute();
const form = useForm({
  schema: feedbackInput,
  initial: { page: route.path.value, helpful: false, comment: "" },
  action: "/api/feedback",
  submit: (values) => api.feedback.post({ body: values }),
});
</script>

<template>
  <form method="post" action="/api/feedback" on:submit="form.submit" novalidate>
    <input type="hidden" name="return" bind:value="route.url.value">
    <input type="hidden" name="_csrf" bind:value="form.csrfToken">
    <input type="hidden" name="page" bind:value="form.fields.page.value">
    <p if:when="form.error.value" role="alert">{form.error.value}</p>
    <textarea name="comment" model="form.fields.comment" aria-label="Comentario"></textarea>
    <p if:when="form.errors.value.comment">{form.errors.value.comment}</p>
    <button name="helpful" value="true" on:click="() => { form.fields.helpful.value = true; }">Me ha servido</button>
    <button name="helpful" value="false" on:click="() => { form.fields.helpful.value = false; }">No me ha servido</button>
  </form>
</template>
```

Con JavaScript, `form.submit` cancela el envío nativo y manda JSON. Sin él, el navegador envía el formulario con el `name` y el `value` del botón pulsado (`helpful=true` llega al schema como `true`); un envío correcto responde `303` a `form.redirect` (o al campo `return`, al `Referer` o a `/`), y un error vuelve con `303` a la página, que pinta en el SSR los mensajes del resultado y los valores de los campos de `form.echo`, guardado en la cookie `__Host-meeko-form` (`HttpOnly`, 60 segundos, de un solo uso).

### Un archivo con `contentType: "response"`

<!-- no-check -->
```ts
// server/api/reports/[id].get.ts
import { defineApiRoute } from "@meekojs/meeko/server";
import { reportParams } from "../../../shared/schemas/report";

export default defineApiRoute({
  params: reportParams,
  auth: "required",
  contentType: "response",
  handler: async ({ params }) => new Response(await renderCsv(params.id), {
    headers: { "content-type": "text/csv; charset=utf-8", "content-disposition": `attachment; filename="${params.id}.csv"` },
  }),
});
```

## Errores comunes

### Un schema fuera de `shared/`, o sin `response`

El cliente se genera desde los schemas públicos, que deben poder importarse en el navegador.

```ts bad
// server/api/items.get.ts
const item = v.object({ id: v.string() });
export default defineApiRoute({ response: v.array(item), handler: () => [] });
```

`meeko check` se detiene con `server/api/items.get.ts: response debe referenciar un schema importado de shared/`. Sin `response`: `la API requiere un schema público response`.

<!-- no-check -->
```ts good
import { itemList } from "../../shared/schemas/items";
export default defineApiRoute({ response: itemList, handler: () => [] });
```

### Una ruta dinámica sin `params`

```ts bad
// server/api/orders/[id].delete.ts
export default defineApiRoute({ status: 204, handler: async () => {} });
```

`server/api/orders/[id].delete.ts: una ruta de API dinámica requiere un schema público params`.

<!-- no-check -->
```ts good
export default defineApiRoute({ params: orderParams, status: 204, handler: async ({ params }) => { await deleteOrder(params.id); } });
```

### `status` calculado, o `204` con `response`

```ts bad
const deleted = 204;
export default defineApiRoute({ params: orderParams, response: orderSchema, status: deleted, handler: async () => {} });
```

`status debe ser el literal 200, 201, 202 o 204`. Con el literal `204` y `response`: `status 204 responde sin cuerpo y no admite un schema response`.

<!-- no-check -->
```ts good
export default defineApiRoute({ params: orderParams, status: 204, handler: async () => {} });
```

### Un resultado que no coincide con `response`

```ts bad
export default defineApiRoute({ body: newOrder, response: orderSchema, handler: ({ body }) => ({ id: 1, item: body.item, qty: body.qty }) });
```

`meeko check` da `TS2322: Type 'number' is not assignable to type 'string'.` en el handler. En ejecución, un resultado que no supera el schema responde `500` sin detalle.

<!-- no-check -->
```ts good
export default defineApiRoute({ body: newOrder, response: orderSchema, handler: ({ body }) => ({ id: "1", item: body.item, qty: body.qty }) });
```

### Llamarlo desde un componente

```html bad
<script lang="ts">
const route = defineApiRoute({ handler: () => ({}) });
</script>
```

`meeko check` da `MEEK108: defineApiRoute viene de @meekojs/meeko/server, que sólo existe en el servidor: el <script> y la plantilla de un componente también se ejecutan en el navegador. Úsalo en los handlers de server/api`. Un componente llama al endpoint con `api.*`, `useApi` o `useApiMutation`.

```html good
<script lang="ts">
const users = useApi("/api/users");
</script>
```

## Notas

- **Seguridad.** Valida siempre con schemas: la entrada nunca llega al handler sin pasar por ellos. `auth`, `authorize` y `locals` son las guardas del endpoint: el middleware de ruta no protege `server/api`, aunque sólo lo llamen páginas protegidas. Un error que no es `ApiError` nunca expone su mensaje.
- **CSRF y Origin.** Con sesión, cada mutación exige el `Origin` permitido y el token CSRF (`x-meeko-csrf`, que el cliente generado envía solo). Un formulario nativo (`form`) exige siempre `Origin` y, con sesión, el campo `_csrf` (`form.csrfToken` de `useForm`); esos dos fallos responden `403` con JSON, sin `303`.
- **SSR.** En el servidor, `api.*` despacha localmente por el mismo pipeline, con la sesión y los servicios de la petición original, sin salir a la red.
- **Formularios (`1.7`).** Un nombre repetido o terminado en `[]` es una lista; `return` y `_csrf` no llegan al schema; una casilla sin marcar no envía nada (decláralo con `v.optional(v.boolean(), false)`). Los archivos necesitan `form.files: true` (si no, `400 FILES_NOT_ALLOWED`). La cookie sólo guarda los valores de `form.echo` (por defecto ninguno), nunca archivos ni campos cuyo nombre contiene `password`, `passcode`, `secret`, `token`, `cvc` o `cvv`: no pongas en `echo` números de tarjeta, PIN ni otros datos sensibles, porque vuelven en la cookie y en el HTML. Una página prerenderizada no lleva el token CSRF en su HTML: un usuario con sesión que la envía sin JavaScript recibe `403 INVALID_CSRF`, así que un formulario para usuarios con sesión va en una página `"ssr"`. Sin `form`, un formulario recibe `415 UNSUPPORTED_MEDIA_TYPE`. Con `form` y sin `body`, el handler recibe `body: undefined` y los campos del formulario se descartan sin aviso: sirve para un formulario de sólo un botón (cerrar sesión, borrar lo que dicen los `params`), así que no es un error; si el formulario tiene campos, declara su schema en `body`.
- **Rendimiento.** `rateLimit` cuenta en memoria por instancia salvo que el store de sesiones lo comparta (Redis o, desde `1.7`, SQL con `rateLimit` en el driver).
- **OpenAPI.** `generateOpenApi` documenta el contrato JSON, con el estado declarado; no describe el cuerpo de formulario.
