---
title: defineApiRoute
group: macros
since: 1.0.0
description: Declares a server/api endpoint with public schemas, guards, status and handler; the server validates everything and generates the typed api.* client.
symbols:
  - "@meekojs/meeko/server#defineApiRoute"
types:
  - "@meekojs/meeko/server#ApiRouteDefinition"
  - "@meekojs/meeko/server#ApiFormOptions"
related:
  - docs/como-elegir.md
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
  - docs/framework.md#origin-en-mutaciones-anónimas
source-hash: 2b8be9928374d20f3e739aa98dcf5377d1f968fcc97cff52a3bba2d6207f9685
---

`defineApiRoute` declares an HTTP endpoint: the default export of `server/api/<ruta>.<método>.ts`. `server/api/users/[id].get.ts` handles `GET /api/users/:id`. The server validates input with schemas (`params`, `query`, `body`), the session, authorization, `Origin` and CSRF token, runs the handler and validates its result with `response`.

Public schemas live in `shared/` and implement [Standard Schema](https://standardschema.dev) (Valibot, Zod, ArkType…). From them, Meeko generates the `api.*` client, used by `useApi` and `useApiMutation` with the same types, without importing the handler. Since `1.7`, `form` makes the same endpoint also handle a native `<form method="post">`, without JavaScript.

## Usage

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

In the application, `await api.users({ id: "7" }).get()` returns `{ id: string; name: string }`.

## Options

| Option        | Type                                                      | Default                                                                | Description                                                                                                                                                                                                                                                                                                         |
| ------------- | --------------------------------------------------------- | ---------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `params`      | Standard Schema                                           | none                                                                   | Dynamic segments (`[id]`), as required strings. Required in a dynamic route and forbidden in a static one.                                                                                                                                                                                                          |
| `query`       | Standard Schema                                           | none                                                                   | The query string. Fields accept strings or string lists; convert numbers inside the schema.                                                                                                                                                                                                                         |
| `body`        | Standard Schema                                           | none                                                                   | The JSON body (and, with `form`, form body). 1 MiB limit.                                                                                                                                                                                                                                                           |
| `response`    | Standard Schema                                           | required except with `status: 204` or `contentType: "response"`        | Handler result. A result failing validation responds with `500` without details.                                                                                                                                                                                                                                    |
| `status`      | `200 \| 201 \| 202 \| 204`                                | `200`                                                                  | Since `1.2`. Successful response status. With `204`, no body or `response`. **Must be a literal.**                                                                                                                                                                                                                  |
| `auth`        | `"required" \| "optional"`                                | `"optional"`                                                           | With `"required"`, a request without a session responds with `401`.                                                                                                                                                                                                                                                 |
| `authorize`   | `(context) => boolean \| Promise<boolean>`                | none                                                                   | With `false`, `403 FORBIDDEN`.                                                                                                                                                                                                                                                                                      |
| `origin`      | `"required" \| "none"`                                    | `Origin` required on `POST`, `PUT`, `PATCH` and `DELETE` (since `1.8`) | Since `1.8`, every mutation requires an allowed `Origin`, with or without a session; `"required"` makes this explicit. `"none"` (**unsafe**) disables it for requests without a session, including native forms, for a webhook (JSON or form-encoded) or public API; with a session, `Origin` and CSRF still apply. |
| `rateLimit`   | `{ limit, window, key? }`                                 | none                                                                   | Since `1.2`. Request limit per window; above it, `429` with `Retry-After`. Without `key`, counts by client IP (`context.clientAddress`; behind Cloudflare Tunnel, `MEEKO_TRUST_PROXY=cloudflare`).                                                                                                                  |
| `locals`      | `(context) => L \| Promise<L>`                            | none                                                                   | Since `1.2`. A per-request value (the current user) received by the handler as typed `locals`. Declare before `handler`.                                                                                                                                                                                            |
| `contentType` | `"json" \| "response"`                                    | `"json"`                                                               | With `"response"`, the handler returns its own `Response` (a file, CSV, stream).                                                                                                                                                                                                                                    |
| `form`        | `true` or `{ redirect?, maxBytes?, files?, echo? }`       | no forms                                                               | Since `1.7`. Accepts `application/x-www-form-urlencoded` and `multipart/form-data`, validated with `body`, and responds with `303` to the page. `echo` lists fields whose values return to the page after an error; none by default. See below.                                                                     |
| `handler`     | `({ params, query, body, context, locals }) => resultado` | required                                                               | The logic. `context` is `RequestContext`: `session`, `services`, `platform`, `requestId`, `clientAddress`, `signal`.                                                                                                                                                                                                |

Each request follows this order: `Origin` (since `1.8`, on every mutation except with `origin: "none"`), session `Origin` and CSRF, `rateLimit`, `auth`, `authorize`, input validation, `locals`, `handler` and response validation. A native form counts `rateLimit` earlier, after `Origin` and before reading the body, because the CSRF token travels in it.

## Return value

The same definition, with inferred types. This is what the server executes and what `meeko routes`, `meeko check` and `meeko dev` generate the client contract from. Responses:

| Case                     | Response                                                                                                   |
| ------------------------ | ---------------------------------------------------------------------------------------------------------- |
| Success                  | The `status` value, with `response` JSON (or no body with `204`)                                           |
| Invalid input            | `400` `INVALID_PARAMS`, `INVALID_QUERY` or `INVALID_BODY`, with `issues: [{ path, message }]` (at most 20) |
| `ApiError(code, status)` | That status, with `{ code, status, requestId }` and its `issues` if a `4xx`                                |
| Any other error          | `500` `INTERNAL_ERROR`, without the message; logged by the server                                          |
| Native form (`form`)     | `303 See Other` to the page, with the result in a single-use cookie                                        |

## Examples

### Create with `201` and the session

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

### Delete with `204`

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

`await api.orders({ id }).delete()` resolves to `undefined`.

### An error in a field

Since `1.5`, an `ApiError` with `issues` sends the message to a field, displayed alongside it by `useForm`:

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

The third argument's `message` is internal and never sent; `issues` are public.

### A form without JavaScript

Since `1.7`, with `form`, the same endpoint handles native browser submission. Fields arrive as strings and, if the schema rejects them, Meeko validates them once more with typed parsing (`""` → `undefined`, `"on"`/`"true"` → `true`, `"false"` → `false`, a decimal number → `number`), so `v.boolean()` and `v.number()` work unchanged. An asynchronous schema runs only once, without that second attempt:

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

With JavaScript, `form.submit` cancels native submission and sends JSON. Without it, the browser submits the form with the clicked button's `name` and `value` (`helpful=true` reaches the schema as `true`); success responds with `303` to `form.redirect` (or the `return` field, `Referer` or `/`), and an error returns with `303` to the page, which renders result messages and values from `form.echo` fields during SSR, stored in the `__Host-meeko-form` cookie (`HttpOnly`, 60 seconds, single-use).

### A file with `contentType: "response"`

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

### A signed webhook with `origin: "none"`

A webhook arrives from another server without `Origin`, and since `1.8`, a mutation without `Origin` responds with `403 INVALID_ORIGIN`. `origin: "none"` disables that route check, so the handler must prove request legitimacy another way, such as the provider's signature:

<!-- no-check -->

```ts
// server/api/webhooks/payments.post.ts
import { ApiError, defineApiRoute } from "@meekojs/meeko/server";

export default defineApiRoute({
  origin: "none",
  contentType: "response",
  handler: async ({ context }) => {
    const payload = await context.request.text();
    if (!(await verifySignature(payload, context.request.headers.get("x-signature")))) throw new ApiError("INVALID_SIGNATURE", 401);
    await recordPayment(JSON.parse(payload));
    return new Response(null, { status: 204 });
  },
});
```

## Common mistakes

### `403 INVALID_ORIGIN` in a webhook, script or test

Since `1.8`, a `POST`, `PUT`, `PATCH` or `DELETE` without `Origin`, with `Origin: null` or another site's origin responds with `403 INVALID_ORIGIN`, even without a session. The browser and `api.*` clients send `Origin` automatically; Node `fetch` or `curl` do not.

```ts bad
await fetch("http://localhost:4173/api/orders", { method: "POST", headers: { "content-type": "application/json" }, body });
```

<!-- no-check -->

```ts good
await fetch("http://localhost:4173/api/orders", { method: "POST", headers: { "content-type": "application/json", origin: "http://localhost:4173" }, body });
```

For a webhook or public API unable to send it, declare `origin: "none"` on the route and verify a signature or token (see the example above). A client from another known origin belongs in `SessionManager({ allowedOrigins })`. See [Origin in anonymous mutations](../../framework.md#origin-in-anonymous-mutations).

### A schema outside `shared/`, or missing `response`

The client is generated from public schemas without executing the handler, so each must come from `shared/`, which the browser can import. Since 1.8, simple composition using package functions is supported, such as `v.array(item)` with `item` imported from `shared/`, but not a schema local to the handler.

```ts bad
// server/api/items.get.ts
const item = v.object({ id: v.string() });
export default defineApiRoute({ response: v.array(item), handler: () => [] });
```

`meeko check` stops with `server/api/items.get.ts: response debe venir de shared/: item no se importa de shared/ ni de un paquete, …`. Without `response`: `la API requiere un schema público response`. See [Public schemas](../../framework.md#public-schemas).

<!-- no-check -->

```ts good
import { itemList } from "../../shared/schemas/items";
export default defineApiRoute({ response: itemList, handler: () => [] });
```

### A dynamic route without `params`

```ts bad
// server/api/orders/[id].delete.ts
export default defineApiRoute({ status: 204, handler: async () => {} });
```

`server/api/orders/[id].delete.ts: una ruta de API dinámica requiere un schema público params`.

<!-- no-check -->

```ts good
export default defineApiRoute({ params: orderParams, status: 204, handler: async ({ params }) => { await deleteOrder(params.id); } });
```

### Computed `status`, or `204` with `response`

```ts bad
const deleted = 204;
export default defineApiRoute({ params: orderParams, response: orderSchema, status: deleted, handler: async () => {} });
```

`status debe ser el literal 200, 201, 202 o 204`. With literal `204` and `response`: `status 204 responde sin cuerpo y no admite un schema response`.

<!-- no-check -->

```ts good
export default defineApiRoute({ params: orderParams, status: 204, handler: async () => {} });
```

### A result not matching `response`

```ts bad
export default defineApiRoute({ body: newOrder, response: orderSchema, handler: ({ body }) => ({ id: 1, item: body.item, qty: body.qty }) });
```

`meeko check` reports `TS2322: Type 'number' is not assignable to type 'string'.` in the handler. At runtime, a result failing the schema responds with `500` without details.

<!-- no-check -->

```ts good
export default defineApiRoute({ body: newOrder, response: orderSchema, handler: ({ body }) => ({ id: "1", item: body.item, qty: body.qty }) });
```

### Call it from a component

```html bad
<script lang="ts">
const route = defineApiRoute({ handler: () => ({}) });
</script>
```

`meeko check` reports `MEEK108: defineApiRoute viene de @meekojs/meeko/server, que sólo existe en el servidor: el <script> y la plantilla de un componente también se ejecutan en el navegador. Úsalo en los handlers de server/api`. A component calls the endpoint with `api.*`, `useApi` or `useApiMutation`.

```html good
<script lang="ts">
const users = useApi("/api/users");
</script>
```

## Notes

- **Security.** Always validate with schemas: input never reaches the handler without passing them. `auth`, `authorize` and `locals` are the endpoint guards: route middleware does not protect `server/api`, even if only protected pages call it. An error other than `ApiError` never exposes its message.
- **CSRF and Origin.** With a session, each mutation requires an allowed `Origin` and CSRF token (`x-meeko-csrf`, sent automatically by the generated client). A native form (`form`) requires `Origin` (since `1.8`, except without a session and with `origin: "none"`) and, with a session, the `_csrf` field (`useForm`'s `form.csrfToken`); both failures respond with `403` JSON, without `303`.
- **SSR.** On the server, `api.*` dispatches locally through the same pipeline, with the original request's session and services, without network access.
- **Forms (`1.7`).** A repeated name or one ending in `[]` becomes a list; `return` and `_csrf` do not reach the schema; an unchecked checkbox sends nothing (declare it with `v.optional(v.boolean(), false)`). Files require `form.files: true` (otherwise, `400 FILES_NOT_ALLOWED`). The cookie only stores `form.echo` values (none by default), never files or fields whose name contains `password`, `passcode`, `secret`, `token`, `cvc` or `cvv`: do not put card numbers, PINs or other sensitive data in `echo`, because they return in the cookie and HTML. A prerendered page has no CSRF token in its HTML: a signed-in user submitting without JavaScript receives `403 INVALID_CSRF`, so a form for signed-in users belongs on an `"ssr"` page. Without `form`, a form receives `415 UNSUPPORTED_MEDIA_TYPE`. With `form` but no `body`, the handler receives `body: undefined` and form fields are silently discarded: useful for a button-only form (sign out, delete what `params` identifies), so this is not an error; if the form has fields, declare their schema in `body`.
- **Performance.** `rateLimit` counts in memory per instance unless the session store shares it (Redis or, since `1.7`, SQL with driver `rateLimit`).
- **OpenAPI.** `generateOpenApi` documents the JSON contract with its declared status; it does not describe the form body.
