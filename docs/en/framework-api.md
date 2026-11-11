---
source-hash: 42d1fb3b9fd824930b8a46b96acd3caa4c67afdd882f2806b43ee3b4a9fab0eb
---

# Build APIs and RPC

This guide expands [the framework overview](framework.md).

## API and RPC

The files `server/api/users/index.get.ts`, `index.post.ts` and `[id].get.ts` create `/api/users` and `/api/users/:id`. Procedures under `server/rpc/users/get.ts` create `/_meeko/rpc/users/get`. Public schemas live in `shared/`. Handlers use `defineApiRoute` and `defineRpc`, and the server validates input, output, session, authorization, CSRF and, since `1.8`, the `Origin` of every mutation (see [Origin in anonymous mutations](framework-auth.md#origin-in-anonymous-mutations)).

**Validator: Standard Schema, Valibot by default.** Meeko validates with any library implementing [Standard Schema](https://standardschema.dev), such as Valibot, Zod or ArkType, in API, RPC, Socket, routes, `useForm` and `useStorage`. Examples in this documentation use Valibot (`import * as v from "valibot"`, from version 1), the recommended validator: it is small and modular, so the browser bundle only includes functions used by the `shared/` schemas shared by server and client. Choosing another library changes no Meeko API; only OpenAPI export needs that library's JSON Schema converter (for Valibot, `@valibot/to-json-schema`).

```sh
npm install valibot
```

```ts
// shared/schemas/user.ts
import * as v from 'valibot'
export const userParams = v.object({ id: v.string() })
export const userSchema = v.object({ id: v.string(), name: v.string() })
export const usersSchema = v.array(userSchema)
```

```ts
// server/api/users/index.get.ts
import { defineApiRoute } from '@meekojs/meeko/server'
import { usersSchema } from '../../../shared/schemas/user.js'

export default defineApiRoute({
	response: usersSchema,
	handler: () => [{ id: '123', name: 'Ada' }],
})
```

```ts
// server/api/users/[id].get.ts
import { defineApiRoute } from '@meekojs/meeko/server'
import { userParams, userSchema } from '../../../shared/schemas/user.js'

export default defineApiRoute({
	params: userParams,
	response: userSchema,
	handler: ({ params }) => ({ id: params.id, name: 'Ada' }),
})
```

```ts
// server/rpc/users/get.ts
import { defineRpc } from '@meekojs/meeko/server'
import { userParams, userSchema } from '../../../shared/schemas/user.js'

export default defineRpc({
	input: userParams,
	output: userSchema,
	handler: ({ input }) => ({ id: input.id, name: 'Ada' }),
})
```

```ts
// app/pages/users/index.meeko, without manual imports
const loadUsers = async () => {
	const users = await api.users.get()
	const user = await api.users({ id: '123' }).get()
	const result = await rpc.users.get({ id: '123' })
	return { users, user, result }
}
```

These symbols also work in `.ts` files according to scope. `meeko routes .` generates `.meeko/generated/clients.client.ts` and `clients.server.ts` with public descriptors and inferred types; they do not import private handlers. In SSR, clients look up the current context on every call and dispatch locally through the same HTTP pipeline if the host supplies `createLocalServerFetch`. The starter already connects it. Credentials, session, services, state and `requestId` remain bound to the original request. Outside an SSR context, a call to the server client fails with a clear error. In the browser, same-origin `fetch` is used and the CSRF token is read from the `meeko-csrf-token` meta tag, updated after responses and navigation. `createApiClient` and `createRpcClient` remain available for explicit or external clients. Non-JSON responses require `contentType: "response"`.

An API/RPC response started before a token change cannot restore a CSRF token already removed by logout or overwrite the token applied by navigation. The client compares the current document and token with those it had when the request started before applying the response header.

API `params` schemas must describe exactly the route's dynamic segments as required strings. A static route does not declare `params`. `query` inputs must accept strings or lists of strings, with optional fields if a key may be absent. If you need numbers, convert them from text within the schema; the generator rejects a contract directly requiring a number that the URL cannot deliver.

Public API, RPC and Socket schemas must expose concrete Standard Schema types: generation rejects `any`, `unknown` and `never` in both input and output, including when nested, as well as generic parameters left unresolved in the exported contract. Make those parameters concrete and explicitly model the public type before generating clients. The manifest also rejects names that cannot be represented unambiguously in the client. For example, `server/api/users/index.get.ts` (`api.users.get()`) cannot coexist with `server/api/users/get.post.ts` (`api.users.get.post()`), nor `server/rpc/users.ts` with `server/rpc/users/get.ts`. `server/api/index.<method>.ts` is rejected because it would produce an empty client key. Each diagnostic includes the conflicting paths; there are no silent overwrites.

`meeko check .` generates separate TypeScript projects for client, server and shared. It includes sources from layers declared in `meeko.config.ts` (including those added by modules), even if their paths do not use the conventional `layers/` name, and components from modules' `addComponentsDir` that live inside the project outside `node_modules`. An `app/` `*.server.ts` file is checked in the server project and a `*.shared.ts` in the shared project; files with a scope suffix retain that selection within `shared/` and `server/` too.

API and RPC errors are normalized on the server: an `ApiError` retains `code` and `status`, the response adds `requestId` and `x-request-id`, and an unknown failure is returned as `INTERNAL_ERROR` without exposing its message. The same normalization applies to local SSR dispatch and Node transport, even when Vite loads modules in different graphs. Navigation requesting `application/meeko+json` receives the same format; an HTML error page retains the HTTP status and `x-request-id` without including private details. The generated server observes 5xx failures: in production it logs type and ID, and in development it also shows the original error. Expected 4xx responses are not logged as internal failures.

### Public schemas

A contract's schemas (`input` and `output` of `defineRpc`; `params`, `query`, `body` and `response` of `defineApiRoute`) are public: they generate the `api` and `rpc` client types. The generator (`meeko routes`, `meeko check`, `meeko dev` and `meeko build`) neither executes nor imports the handler, which may contain private server code: it reads the contract as code and names each schema by its module, so `.meeko/types/server-contracts.d.ts` contains `typeof import("../../shared/schemas/user.js")["userSchema"]`. That is why a public schema lives in `shared/`, which contains no server code and can be imported by the browser; its dependencies cannot leave `shared/` either (except `node_modules` packages), and a schema local to the handler or from `server/` produces `output debe venir de shared/`.

Since `1.8`, the contract also accepts a **simple composition** of these schemas with package functions, such as `v.array(snapshotSchema)` or `v.optional(filterSchema)`: calls, property reads, literals, arrays and object literals whose names are imports from `shared/` or a package (`valibot`, `zod`…). The generator copies the expression, with those imports, into a `.meeko/types/contract-schemas/` module (`rpc.snapshots.list.output.ts`) from which only the type is read: it is never executed or included in the bundle.

```ts
// server/rpc/snapshots/list.ts
import * as v from 'valibot'
import { snapshotSchema } from '../../../shared/schemas/snapshot.js'

export default defineRpc({
	input: v.object({}),
	output: v.array(snapshotSchema),
	handler: () => listSnapshots(),
})
```

An expression containing anything else (a function like the one in `v.transform`, an operator, a local variable or a type argument) is rejected with the reason: `output debe ser un schema importado de shared/ o una composición simple de ellos (…); esta expresión contiene una función`. Define that schema in `shared/`, export it and import it in the contract. [WebSocket](framework-websocket.md#websocket) schemas do not accept compositions: the browser imports each one to validate messages, so they must be an export from `shared/`.

### Dynamic segments in `api.*`

Each `server/api` folder or file is a level of `api.*`, and each file contributes the method from its suffix. Since `1.2`, you call a dynamic segment with its parameters: `node({ nombre: valor })` returns that segment's client, and methods reached this way no longer receive `params`. `query`, `body` and `signal` remain unchanged, and the URL is built and encoded as with `params`.

```ts
// server/api/menu/categories/index.get.ts         → api.menu.categories.get()
// server/api/menu/categories/[id].patch.ts        → api.menu.categories({ id }).patch({ body })
// server/api/menu/categories/[id]/archive.post.ts → api.menu.categories({ id }).archive.post()
// server/api/orgs/[org]/users/[id].get.ts         → api.orgs({ org }).users({ id }).get()
const list = await api.menu.categories.get()
await api.menu.categories({ id }).patch({ body: { name } })
await api.menu.categories({ id }).archive.post()
const user = await api
	.orgs({ org })
	.users({ id })
	.get({ query: { tab: 'profile' } })
```

- The call receives an object with its segment's sole parameter, as a string: TypeScript rejects a missing parameter, an extra key, a non-text value and `params` in methods following the call. An object without the parameter or with a different one throws a `TypeError` on calling; an empty value, `.`, `..` or one containing `/` rejects the request just as with `params`.
- A level retains its methods and static children alongside the call: `api.menu.categories.get()` and `api.menu.categories({ id })` coexist. If a level has multiple dynamic child segments (`users/[id].get.ts` and `users/[slug]/posts.get.ts`), the parameter name selects the segment: `api.users({ id })` or `api.users({ slug }).posts.get()`.
- A catch-all `[...path]` receives, as in `params`, a string with segments joined by `/`: `api.files({ path: "docs/a b.txt" }).get()` requests `/api/files/docs/a%20b.txt`, with each segment encoded separately.
- `useApi` is unchanged: it still receives the bracketed path and `params`, such as `useApi("/api/menu/categories/[id]", { params: { id } })`.
- The editor completes the call, its parameters and the segment's methods, and hover and “go to definition” on `api.menu.categories({ id }).archive.post` lead to the handler.

In `clientKey`, the dynamic segment for `[id]` or `[...id]` is named `byId`: `by` followed by the parameter name with its first letter capitalized. This lets the client recognize which segment each parameter belongs to, including in an explicit `createApiClient` client. That is why the manifest rejects, with the conflicting paths, a static segment named the same as the dynamic segment at its level (`users/byId/` alongside `users/[id]`) or in its own route (`[id]/byId.get.ts`), and two parameters whose names differ only in the initial letter's case (`[id]` and `[Id]`) at the same level or in the same route.

The previous form, `api.menu.categories.byId.archive.post({ params: { id } })`, continues to work throughout the 1.x series and will be removed in `2.0`. It has been deprecated since `1.2`: the editor strikes through each method called through `byId` and its hover shows the replacement; there is no console warning. It only exists before the first segment call: `api.orgs({ org }).users.byId` does not exist.

### Form validation errors

Since `1.2`, when `params`, `query`, `body` or an RPC's `input` fails its schema, the `400` response (`INVALID_PARAMS`, `INVALID_QUERY`, `INVALID_BODY` or `INVALID_INPUT`) includes `issues`: a list of `{ path, message }` with at most 20 items. `path` is the Standard Schema issue path's keys joined by `.` (`"items.0.name"`), or `""` for the entire input; `message` is the schema's message. Only these two fields are transferred: never the received value, expected value or a stack trace. Issues without a message are omitted, and with none the response has no `issues`. A handler result failing `response` or `output` remains a `500` without details, because it is a server failure.

```ts
// shared/schemas/auth.ts
import * as v from 'valibot'
export const loginInput = v.object({
	email: v.pipe(v.string(), v.email('Enter a valid email address.')),
	password: v.pipe(v.string(), v.minLength(1, 'Enter your password.')),
})
```

```json
{ "code": "INVALID_INPUT", "status": 400, "requestId": "…", "issues": [{ "path": "password", "message": "Enter your password." }] }
```

On the client, `ClientError.issues` is this read-only list (type `ValidationIssue`), or `undefined` if the response does not include it. It arrives the same way from `api.*`, `rpc.*` and the `error` of `useApi`, `useRpcQuery` and `useRpcMutation`:

```ts
import { ClientError } from '@meekojs/meeko/framework'

const login = useRpcMutation('auth.login')
const fieldError = (path: string) => {
	const error = login.error.value
	return error instanceof ClientError ? error.issues?.find((issue) => issue.path === path)?.message : undefined
}
```

Write your own schema messages: some default Valibot messages quote the received value.

`useForm` sends these `issues` to each form field without custom code (see [Forms: `useForm`](#forms-useform)).

### Field errors: `ApiError` with `issues`

Since `1.5`, an error that is not a validation error but belongs to a field, such as an email already associated with an account, carries `issues` through the third argument of `ApiError`, which accepts `{ message, issues }` in addition to the usual internal message:

```ts
throw new ApiError('EMAIL_TAKEN', 409, {
	message: `duplicate key for ${body.email}`, // internal: never sent
	issues: [{ path: 'email', message: 'That email already has an account.' }],
})
```

```json
{ "code": "EMAIL_TAKEN", "status": 409, "requestId": "…", "issues": [{ "path": "email", "message": "That email already has an account." }] }
```

- `issues` have the same shape as those of a `400` (`{ path, message }`, with `path` joined by `.` or `""` for the whole form) and are sent the same way: at most 20, in API and RPC responses, including local SSR dispatch. They are public messages written for the user; the error's `message` remains internal.
- They are only sent with a `4xx` status: a `5xx` is a server failure and responds without them. An issue without a `path` or a text `message` throws a `TypeError` when creating the error.
- An `ApiError` from another module graph (Vite) retains its `issues` during normalization. Another error with the same shape, such as an SDK's `ApiError` or a `ClientError` from another Meeko service that the handler lets escape, does not send its `issues`: Meeko only forwards those of its own `ApiError`.
- On the client they arrive in `ClientError.issues`, and `useForm` distributes them like those of a `400`.

### Per-request values: `locals`

Since `1.2`, `defineApiRoute` and `defineRpc` accept `locals(context)`, which computes a per-request value (for example, the current user) and passes it to the handler as `locals`, with the type inferred from its return value. Without `locals`, the handler receives `locals: undefined`. `authorize` is unchanged and still returns a boolean.

The order of each request is: Origin (since `1.8`, on every mutation except with `origin: "none"`), session Origin and CSRF, `rateLimit` (since `1.2`), `auth`, `authorize`, input validation (`params`, `query` and `body`, or `input`), `locals`, handler and response validation. Thus, `locals` only runs with valid input and an already authorized request. If it throws an `ApiError`, that error is the response (for example, `401` if the session user no longer exists or `403` if they lost access); any other error is `500`.

```ts
// server/rpc/orders/create.ts
import { ApiError, defineRpc } from '@meekojs/meeko/server'
import { newOrder, orderSchema } from '../../../shared/schemas/order.js'
import { createOrder, findUser } from '../../utils/store.js'

export default defineRpc({
	input: newOrder,
	output: orderSchema,
	auth: 'required',
	locals: async ({ session }) => {
		const user = await findUser((session.current!.data as { userId: string }).userId)
		if (!user) throw new ApiError('UNAUTHENTICATED', 401)
		return { user }
	},
	handler: ({ input, locals }) => createOrder(locals.user, input),
})
```

Declare `locals` before `handler` in the object: if `locals` uses its parameter, TypeScript only infers its type for the handler when it appears first. With the session typed through [`MeekoSession`](framework-auth.md#session-types-meekosession), `session.current!.data.userId` does not need `as`.

### Response status: `status`

Since `1.2`, `defineApiRoute` accepts `status` to choose the status of a successful response without giving up JSON, `response` validation or the generated client's type:

| `status`        | Response                                        | `api.*` resolves to  |
| --------------- | ----------------------------------------------- | -------------------- |
| `200` (default) | JSON validated with `response`                  | the `response` value |
| `201`           | JSON validated with `response` (`201 Created`)  | the `response` value |
| `202`           | JSON validated with `response` (`202 Accepted`) | the `response` value |
| `204`           | no body or `content-type` (`204 No Content`)    | `undefined`          |

```ts
// server/api/orders/index.post.ts
import { defineApiRoute } from '@meekojs/meeko/server'
import { newOrder, orderSchema } from '../../../shared/schemas/order.js'
import { createOrder } from '../../utils/store.js'

export default defineApiRoute({
	body: newOrder,
	response: orderSchema,
	status: 201,
	handler: ({ body }) => createOrder(body),
})
```

```ts
// server/api/orders/[id].delete.ts
import { defineApiRoute } from '@meekojs/meeko/server'
import { orderParams } from '../../../shared/schemas/order.js'
import { deleteOrder } from '../../utils/store.js'

export default defineApiRoute({
	params: orderParams,
	status: 204,
	handler: async ({ params }) => {
		await deleteOrder(params.id)
	},
})
```

- `status` must be a literal (`status: 201`): the generator reads it without executing the handler and rejects any other value. A constant or expression does not work.
- With `204`, the handler returns nothing and `response` is not declared; returning a value responds with `500` `INVALID_RESPONSE`. In the generated contract the output is `undefined`, so `await api.orders({ id }).delete()` resolves to `undefined`, as does `useApi`.
- `status` cannot be combined with `contentType: "response"`: that handler already returns its own `Response` with whatever status it needs.
- An unsupported `status`, one combined with `contentType: "response"` or a `204` with `response` responds with `500` `INVALID_RESPONSE_STATUS` before reading the input, although the generator already rejects it in `meeko routes`, `meeko check` and `meeko dev`.
- Errors are unchanged: they still come from `ApiError` with their own status.
- `generateOpenApi` documents the declared status (`201 Created`, `202 Accepted` or `204 No Content`, the latter without `content`).
- The status is fixed per endpoint. To choose it per request (for example, `201` on creation and `200` on update in the same `PUT`), use `contentType: "response"` or two endpoints.
- RPC has no `status`: a procedure always responds with `200` and its `output`.

### Forms without JavaScript: `form`

Since `1.7`, an API endpoint can also handle a native `<form method="post">`, which works before JavaScript loads or without it. Enable it with `form`, and the form is validated with the **same `body` schema** as JSON:

```ts
// shared/schemas/feedback.ts
import * as v from 'valibot'
export const feedbackInput = v.object({
	page: v.pipe(v.string(), v.startsWith('/')),
	helpful: v.boolean('Choose yes or no.'),
	comment: v.optional(v.pipe(v.string(), v.maxLength(500, 'Use at most 500 characters.')), ''),
})
export const feedbackSaved = v.object({ id: v.string() })
```

```ts
// server/api/feedback.post.ts
import { defineApiRoute } from '@meekojs/meeko/server'
import { feedbackInput, feedbackSaved } from '../../shared/schemas/feedback.js'
import { saveFeedback } from '../utils/feedback.js'

export default defineApiRoute({
	body: feedbackInput,
	response: feedbackSaved,
	// Or { redirect: (saved) => `/graciasíid=${saved.id}` }. `echo` returns those fields' text after an error.
	form: { echo: ['comment'] },
	handler: ({ body }) => saveFeedback(body),
})
```

```html
<!-- app/components/Feedback.meeko -->
<script lang="ts">
	const route = useRoute()
	const form = useForm({
		schema: feedbackInput,
		initial: { page: route.path.value, helpful: false, comment: '' },
		action: '/api/feedback',
		submit: (values) => api.feedback.post({ body: values }),
	})
</script>
<template>
	<form
		method="post"
		action="/api/feedback"
		on:submit="form.submit"
		novalidate
	>
		<input
			type="hidden"
			name="return"
			bind:value="route.url.value"
		/>
		<input
			type="hidden"
			name="_csrf"
			bind:value="form.csrfToken"
		/>
		<input
			type="hidden"
			name="page"
			bind:value="form.fields.page.value"
		/>
		<p if:when="form.submitted.value">Thank you!</p>
		<p
			if:when="form.error.value"
			role="alert"
		>
			{form.error.value}
		</p>
		<button
			name="helpful"
			value="true"
			on:click="() => { form.fields.helpful.value = true; }"
		>
			Yes
		</button>
		<button
			name="helpful"
			value="false"
			on:click="() => { form.fields.helpful.value = false; }"
		>
			No
		</button>
		<textarea
			name="comment"
			model="form.fields.comment"
		></textarea>
		<p if:when="form.errors.value.comment">{form.errors.value.comment}</p>
	</form>
</template>
```

With JavaScript, `form.submit` cancels native submission and sends JSON with `submit`, as usual. Without it (or before hydration), the browser submits the form to `/api/feedback`, with the clicked button's `name` and `value`, and returns to the page with the result already rendered in the server HTML: `helpful` arrives as the text `"true"` and the schema receives it as `true` (see conversion below). The same definition serves both paths: each control needs its `name`, matching its field.

**Body.** With `form`, the endpoint accepts `application/x-www-form-urlencoded` and `multipart/form-data` as well as JSON. Without `form`, those types still respond with `415 UNSUPPORTED_MEDIA_TYPE`. JSON is unchanged and is never converted. Each `name` is an object key, passed through the `body` schema:

- A repeated name (`tag=a&tag=b`) or one ending in `[]` (`tags[]=a`) is a list; with `[]` it is a list even if only one value arrives, or none with an empty `<input type="file">`.
- Fields arrive as text. If the schema rejects some fields' text, Meeko validates it again **once** with the typed interpretation of those fields, and only those: `""` is `undefined` (an empty field was not provided), `"true"` and `"on"` (a checked checkbox) are `true`, `"false"` is `false` and a decimal number (`"4"`, `"-1.5"`, `"2e3"`) is a `number`; in a list, each item is converted, excluding empty ones. A field the schema accepts as text (`"42"` in a `v.string()`, a postal code `"01234"`) is never converted. Thus, `v.number()` and `v.boolean()` work without writing conversions; the schema's own conversions (`v.pipe(v.string(), v.toNumber())`) also work. An asynchronous schema (`v.pipeAsync`, `v.checkAsync`, which can query the database) runs **only once**, without a second attempt: its numeric or boolean fields must convert the text within the schema itself (`v.pipe(v.string(), v.toNumber())`).
- An unchecked checkbox sends nothing: declare it with a default value, `v.optional(v.boolean(), false)`, and a checkbox list with `v.optional(v.array(v.string()), [])`.
- If a converted field still fails the schema, its message is the one for its text, as entered by the user.
- `return` and `_csrf` are reserved fields: they never reach the schema.
- Nested objects are not constructed: `address.city` is a key with a dot.

**Response.** A successful submission (after validating `response`) responds with `303 See Other` to the path returned by `form.redirect(result, context)` or, without it, the `return` field's path, the `Referer` page if it belongs to this site, or `/`. `result` is the validated response, `undefined` with `status: 204` or the handler's `Response` with `contentType: "response"` (without `redirect`, that `Response` is the response). The path must belong to this application: a value with `//`, `\`, a scheme (`javascript:`, `https://otro.example`), control characters or dot segments that would leave `//` at the start is replaced with `/`, with the same checks as [`POST /_meeko/theme`](framework-rendering.md#lightdark-theme-without-flashing); an absolute URL of this same origin works as its path. The path works equally with an unencoded `/` (`return=/contacto`, as sent by `curl -d`) or an encoded one (`return=%2Fcontacto`, as sent by the browser), in `x-www-form-urlencoded` and `multipart/form-data`. When testing with `curl` from Git Bash on Windows, MSYS converts the argument `return=/contacto` to `return=C:/Program Files/Git/contacto` before sending it, and that path falls back to `/`; use `return=%2Fcontacto` or `MSYS_NO_PATHCONV=1`.

An error (validation, an `ApiError` from the handler or `locals`, `401`, `403 FORBIDDEN`, `429`, `413` or a `500`) also responds with `303`, back to the `return` field, `Referer` or `/`, never with the error's JSON. In both cases, the response sets a single-use, 60-second cookie, `__Host-meeko-form` (`meeko-form` without HTTPS), `HttpOnly`, `SameSite=Lax`, containing the result: code, status, `issues` (at most 20, as in a `400`) and, only for fields listed in `form.echo`, the submitted values. By default no values return: the form shows messages and its fields start from `initial`. Values travel in the cookie and page HTML, so `echo` must not include passwords, card numbers, PINs, IBANs or other sensitive data; even so, a field whose name contains `password`, `passcode`, `secret`, `token`, `cvc` or `cvv` never returns, nor do files. If it does not fit in the cookie, values are removed first, then the last `issues`.

**The page.** That page's `GET` reads the cookie, deletes it in the same response (`Max-Age=0`, `cache-control: no-store`) and renders the page even if it is prerendered. A `useForm` whose `action` matches the endpoint path takes the result during SSR, just as after a JavaScript submission: `form.echo` values in its fields, `errors` and `error` distributed by `issues`, `failure` holding a `ClientError` with the code and status (and `error` holding `errorMessage(failure)` if there are no `issues`), or `submitted` set to `true` after success. The result travels in page state, so hydration renders the same thing, and the browser uses it only once: when the form mounts again, it starts from `initial`. A field with a server message loses it on change, as after a JavaScript submission. A field still containing an error returns as text, exactly as entered.

Why a cookie: a signed query would leave values, sometimes personal, in the address bar, history, logs and `Referer`, and would need a secret shared between instances; storing the result in the session store would create a session for every anonymous visitor. A single-use `HttpOnly` cookie leaves no trace in the URL, needs no server state, works across multiple instances and, with the `__Host-` prefix, cannot be planted by any subdomain. Its contents are only rendered as escaped text, and it is not signed: whoever can write that cookie (the user's own browser) can only change what they themselves see.

**Security.**

- A form needs no _preflight_, so any site can submit one. That is why every native submission requires an allowed `Origin` (the application's or one from `SessionManager.allowedOrigins`), like any mutation since `1.8`: without it, it responds with `403 INVALID_ORIGIN` before reading the body. Since `1.8`, `origin: "none"` exempts it only without a session, for a webhook sending `application/x-www-form-urlencoded` without `Origin`; with a session, submission still needs `Origin` and `_csrf`. Browsers send `Origin` on every `POST`; a page served with `Referrer-Policy: no-referrer` sends it as `null` and cannot use native forms.
- With a session, the CSRF token JavaScript sends in `x-meeko-csrf` arrives in the hidden `_csrf` field: `form.csrfToken` supplies it in SSR and in the browser. Without it, `403 INVALID_CSRF`. These two `403` responses return error JSON without `303`: the request is not from this site. Everything else (`auth`, `authorize`, `rateLimit`, `locals`) works as with JSON, except the order of `rateLimit`: since `1.7`, a native submission is counted after `Origin` and **before reading the body**, so a flood of submissions is stopped without parsing each one; the CSRF token is in the body, so a submission with an invalid token also counts. A `429` returns to `Referer` or `/`, because the `return` field is in the unread body.
- The body has JSON's 1 MiB limit, changed by `form.maxBytes`; above it, `BODY_TOO_LARGE`.
- A `multipart/form-data` does not accept files except with `form.files: true`: they reach the `body` schema as `File` (for example, `v.instance(File)` or `v.file()`), and a file on an endpoint without `files` is `400 FILES_NOT_ALLOWED`. An empty `<input type="file">` does not count. Increase `maxBytes` according to the size you accept.

**Limitations.**

- It is handled by `dispatchApiRoute`, meaning `createServerApp` and every Meeko adapter. `executeApiRoute` still accepts JSON only, and a host rendering pages with `createFrameworkHandler` does not read the cookie.
- A shared cache in front of the server (a CDN) must pass through requests with the `meeko-form` cookie (or respect `Vary: Cookie`): if it serves a copy, the form does not show the result.
- A `render: "prerender"` page is rendered at build time, without a session, so its HTML has no CSRF token and `form.csrfToken` is empty until hydration. With JavaScript this does not matter (submission carries the token in `x-meeko-csrf`), but a user with a session submitting the native form without JavaScript receives `403 INVALID_CSRF`. If the form is for users with a session, use `render: "ssr"` (with `cache` if the page is expensive: a request with a session never uses the copy and carries its token).
- `generateOpenApi` describes the JSON body, not the form body.

### Data in components: `useApi`, `useRpcQuery` and `useRpcMutation`

Since `1.1`, a component can request its own data with composables auto-imported from the generated clients. They use the same contracts, types, session and CSRF as `api.*` and `rpc.*`:

| Composable                                              | Usage                                                            | Returns                                                     |
| ------------------------------------------------------- | ---------------------------------------------------------------- | ----------------------------------------------------------- |
| `useApi(ruta, opciones?, recarga?)`                     | Read a `GET` endpoint                                            | `{ data, error, pending, refreshing, refresh }`             |
| `useRpcQuery(procedimiento, input, recarga?)`           | Read through an RPC procedure                                    | `{ data, error, pending, refreshing, refresh }`             |
| `useRpcMutation(procedimiento, opciones?)`              | Write on demand through RPC                                      | `{ mutate(input), data, error, pending }`                   |
| `useApiMutation(ruta, método, opciones?)` (since `1.2`) | Write on demand to a `POST`, `PUT`, `PATCH` or `DELETE` endpoint | `{ mutate({ params, query, body }), data, error, pending }` |

`ruta` is the endpoint path as described by `server/api`, with dynamic segments in brackets: `"/api/users"` or `"/api/users/[id]"`. Only `GET` endpoints are supported. `procedimiento` is the dot-separated procedure ID: `server/rpc/users/get.ts` is `"users.get"`. The editor completes paths and procedures, and TypeScript checks `params`, `query` and `input` against the contract. `data`, `error` and `pending` are read-only signals; `error` is an `Error` or `null`.

```html
<!-- app/pages/users/[id].meeko -->
<script lang="ts">
	const props = defineProps<{ params: { id: string }; search: Record<string, string | string[]> }>()
	const tab = signal('profile')
	const user = await useApi('/api/users/[id]', { params: { id: props.params.id } })
	const activity = await useRpcQuery('users.activity', () => ({ id: props.params.id, tab: tab.value }))
	const rename = useRpcMutation('users.rename')
	async function save(name: string): Promise<void> {
		await rename.mutate({ id: props.params.id, name })
		await user.refresh()
	}
</script>
<template>
	<h1>{user.data.value.name}</h1>
	<p>{activity.data.value.length} events</p>
</template>
```

#### With and without `await`

- **With `await`.** The component does not render until data is available, including in SSR, and `data` is no longer nullable in its type. A failed request is treated as a page failure.
- **Without `await`.** The component renders immediately with `pending` set to `true` and `data` to `null`. The request does not run in SSR: it starts in the browser when the component mounts. This is the pattern for showing a loading indicator:

```html
<script lang="ts">
	const users = useApi('/api/users')
</script>
<template>
	<p if:when="users.pending.value">Loading…</p>
	<p if:when="users.error.value">Could not load users.</p>
	<ul if:when="users.data.value">
		<li
			each:of="users.data.value ?? []"
			each:as="user"
			each:key="user.id"
		>
			{user.name}
		</li>
	</ul>
</template>
```

The options for `useApi` and the `input` for `useRpcQuery` can contain signals in their fields, or be a function reading them. Once the component is mounted in the browser, a change to those signals requests data again and updates `data`, `pending` and `error`; an earlier request still in progress is canceled. `refresh()` requests data again with the current input. While new data arrives, `data` retains the previous data (see [Previous data during a reload](#previous-data-during-a-reload-keepprevious)). A failed reload or `refresh()` only updates `error`: it does not show the error page.

Options are optional when the contract requires nothing. `useApi(ruta)` allows omitting them if the endpoint has no `params` and its `query` is absent or has only optional fields. `useRpcQuery(procedimiento)` allows omitting `input` if the schema accepts `{}`, and then sends `{}`. The same applies to generated clients: `api.users.get()` is called without arguments when the endpoint has no `params`, required `query` or body. The `rpc.x(input)` signature is unchanged.

```ts
const stats = await useRpcQuery('stats.summary') // optional input: sends {}
const users = await useApi('/api/users') // optional query
const page = await api.users.get({ query: { page: '2' } }) // the query is still available
```

#### SSR and hydration

In SSR, the server renders the page and its layouts, records requests for each data `await`, waits for them and renders again with the data, until no pass suspends. Discarded passes are disposed of, with their state and effects, and each starts from the state left by the loader. Requests are dispatched locally through the same pipeline as `api.*` and `rpc.*` in SSR, retaining the session and request context. On a `render: "stream"` route, they resolve before the first byte, like the critical loader. `head` is computed with loader data or top-level `<script server>` code, not these composables' data: if `<title>` depends on a value, load it there.

Resolved data travels in the payload's `resources` field, keyed by request (method or procedure and input). During hydration, the browser reads it synchronously from there and does not repeat the request. A data `await`'s input must depend only on props, route data and state: if the browser requests a key the server did not load, hydration fails with a `MEEKO_RESOURCE_MISSING` error naming the request. A component requesting new data on every pass stops rendering after 10 passes with an error.

#### Navigation and `render: "client"`

Before committing a navigation, the browser renders the new page without displaying it to discover and load its data `await` calls. Meanwhile the previous page stays visible and `useNavigation().pending` is `true`. If navigation requested the payload from the server, data the server already resolved arrives in `resources` and is not requested again. A failure shows the nearest `+error.meeko`, or `app/error.meeko`, within the layouts, like a loader failure. `render: "client"` routes use the same mechanism, entirely in the browser. In SSR, a failed data `await` also shows the error page, with the same public message as a loader failure.

That preliminary render is a dry run. Setup for the new page and layouts that are not preserved executes, with provisional state that is later discarded, but:

- no `effect` runs (`computed` does compute its value);
- `onMounted` does not run and the continuation after a browser `await` does not start;
- `useSocket` and `socket.x` return a client that does not connect.

What repeats is setup's top-level code itself: a request with `api.*`, an external write or a counter incremented there runs once more per navigation. Move these to `onMounted` or a handler.

The pass is skipped if no component in the new tree can await data. The compiler marks each module with two static pieces of information: whether its script has a data `await` and which components its template renders. The browser traverses these marks from the new page and layouts and, if none await data, commits navigation without a preliminary pass; setup then runs only once. A component chosen at runtime (`<component is>` with a setup variable, an `each:` item or a snippet parameter) and an unmarked module (handwritten or compiled by an earlier version) count as potentially awaiting data. A layout's outlet (`<component is="props.outlet">`) is not traversed, because the browser already checks the page. Limitation: a component that is not a layout and uses `<component is="props.outlet">` to render a component received in a prop named `outlet` is not traversed either; if that component awaits data, it is not loaded before navigation commits and mounts later, as described next, without an error.

#### Components that mount later

A component appearing after hydration or page commitment (when an `if:` becomes true, in a new `each:` row, when the `<component is>` component changes or when receiving new props: a component with a top-level data `await` remounts with them rather than updating them in place like other components; see [Reactive props](api.md#reactive-props)) reuses data the application already loaded. If it uses a data `await` for data that is not cached:

- Its area stays empty, without an error, while data loads.
- Loading uses dry runs under the containing component's root, with the same context (`inject`), without effects, `onMounted` or socket connections.
- When they finish, the component renders, hydrates and runs its `onMounted`. Data stays in the application cache for subsequent mounts.
- If the component is disposed of first (the `if:` becomes false again or the row disappears), the request is aborted and nothing renders, `onMounted` does not run and no error is reported.
- If the request fails, the area stays empty and the error reaches the nearest `provideErrorHandler`, with source `"mounted"`, or, if there is none, the `onError` of `mountClientApp`.

To show an indicator in the meantime, use the composable without `await` and read `pending`, as in the previous example, or wrap the area in [`<MeekoAwait>`](#meekoawait), which can also reserve its height. The `MEEKO_SUSPENDED` error only appears when calling `renderToString` or `renderWithState` on a component with a data `await` outside the framework (see [api.md](api.md#generated-module)).

#### Previous data during a reload: `keepPrevious`

Since `1.1`, a reload does not clear `data`: both `refresh()` and changes to input signals set `pending` to `true` and retain previous data until the new data arrives, replacing it in the same update that sets `pending` back to `false`. A list does not disappear while reloading. Since `1.5`:

- **`refreshing`.** It is `true` during a reload while `data` retains a previous load. The first load is `pending` without `refreshing`. Use it for a subtle indicator (dimming the list, a spinning icon) without hiding data.
- **`keepPrevious`.** The last argument of `useApi` and `useRpcQuery` accepts `{ keepPrevious }` (and, since `1.7`, [`debounceMs` and `enabled`](#search-as-you-type-debouncems-and-enabled)). It defaults to `true`, the existing behavior. With `false`, an input change clears `data` and `error` and becomes a first load again: useful when showing another input's data would be confusing (another user's profile while the new one arrives). `refresh()` always retains data because it belongs to the same input, as does a resource awaited with `await`, whose `data` is never `null`.

```html
<script lang="ts">
	const props = defineProps<{ params: { id: string }; search: Record<string, string | string[]> }>()
	const page = signal('1')
	// By default: the previous page remains on screen while the next one loads.
	const orders = useApi('/api/orders', { query: { page } })
	// A different user: show a skeleton instead of the previous user's card.
	const user = useApi('/api/users/[id]', () => ({ params: { id: props.params.id } }), { keepPrevious: false })
</script>
<template>
	<ul
		bind:class="orders.refreshing.value ? 'dimmed' : undefined"
		bind:aria-busy="orders.pending.value ? 'true' : undefined"
	>
		<li
			each:of="orders.data.value ?? []"
			each:as="order"
			each:key="order.id"
		>
			{order.total}
		</li>
	</ul>
</template>
```

| Situation     | `data`                                             | `pending` | `refreshing`                                 |
| ------------- | -------------------------------------------------- | --------- | -------------------------------------------- |
| First load    | `null`                                             | `true`    | `false`                                      |
| `refresh()`   | Previous data                                      | `true`    | `true`                                       |
| Input change  | Previous data (with `keepPrevious: false`, `null`) | `true`    | `true` (with `keepPrevious: false`, `false`) |
| Failed reload | Previous data; `error` says why                    | `false`   | `false`                                      |

`<MeekoAwait>` relies on this behavior: during a reload it keeps showing its content and marks the area with `data-meeko-refreshing` and `aria-busy`.

#### Search as you type: `debounceMs` and `enabled`

Since `1.7`, the options in the last argument of `useApi` and `useRpcQuery` include `debounceMs` and `enabled`, for search that queries as you type without a request per keystroke:

```html
<script lang="ts">
	const query = signal('')
	const results = useRpcQuery('docs.search', () => ({ q: query.value.trim() }), {
		debounceMs: 200,
		enabled: () => query.value.trim().length >= 2,
	})
</script>
<template>
	<input
		type="search"
		model="query"
		aria-controls="results"
	/>
	<ul
		id="results"
		bind:aria-busy="results.pending.value ? 'true' : undefined"
	>
		<li
			each:of="results.data.value?.hits ?? []"
			each:as="hit"
			each:key="hit.url"
		>
			<a bind:href="hit.url">{hit.title}</a>
		</li>
	</ul>
</template>
```

- **`debounceMs`.** Milliseconds the input must remain unchanged before requesting data: a burst of changes makes a single request, with the latest input. Each change cancels the current request, whose result is discarded if it still arrives. During the wait `pending` is already `true` (and `refreshing` if there is data) and `data` retains the previous result; with `keepPrevious: false` it is cleared on the first change. It does not delay the browser's first load or `refresh()`. Default: `0`, so each change requests immediately, as through `1.6`.
- **`enabled`.** A boolean, signal or function reading signals. While it is `false`, no request runs, neither on mount nor with `refresh()` (which resolves without doing anything); any request in progress is canceled, `pending` and `refreshing` are `false` and `data` retains the last result, or `null` if there was none (`error` does not change either). When it becomes `true` again, data for the current input is requested (with `debounceMs`, after the wait), unless `data` already belongs to that input. An `enabled` change counts as an input change.
- **SSR.** Both options only act in the browser. A resource with `await` is requested immediately in SSR, without a wait, and its data travels in the payload for hydration, as usual. A resource with `await` starting with `enabled` set to `false` cannot have its data: it fails with an error saying so, on the server and in the browser. Without `await`, the request never runs in SSR, and a disabled resource renders with `pending` set to `false`.

#### `<MeekoAwait>`

Since `1.5`, `<MeekoAwait>` is a built-in Meeko tag, like `<MeekoLink>`: it is not imported and the compiler converts it into a component compiled and distributed by Meeko. It wraps the area for data arriving after the first render, the result of `useApi` or `useRpcQuery` without `await`:

```html
<!-- app/components/ItemsCard.meeko -->
<script lang="ts">
	const items = useApi('/api/items')
</script>
<template>
	<section class="card">
		<h2>Items</h2>
		<MeekoAwait
			for="items"
			reserve
		>
			<snippet name="pending"><ItemsSkeleton /></snippet>
			<snippet
				name="error"
				params="error, retry"
			>
				<p role="alert">
					Could not load.
					<button on:click="retry">Retry</button>
				</p>
			</snippet>
			<ItemsList bind:items="items.data.value" />
		</MeekoAwait>
	</section>
</template>
```

- **`for`.** The resource, as an expression (like `each:of`; `bind:for` also works), or a list: `for="[items, stats]"`. Missing or empty is error `MEEK116`; something that is not a resource is a type error in `meeko check` and the editor, and a `TypeError` at render time. Any object with `data`, `error`, `pending` and `refresh` works (the `AwaitResource` type).
- **States.** The tag's content (`default`) renders when all resources have data. The `pending` snippet renders during the first load: while a resource has no data and is loading (or has not started yet; without `await` the request starts on mount). The `error` snippet renders when a resource without data failed: it receives the error and `retry`, which requests the failed resources again and goes through `pending` once more. Without an `error` snippet, it renders `<p role="alert">` with “No se pudieron cargar los datos.” and a “Reintentar” button (translate these with `bind:messages="{ error, retry }"`). A failed resource takes precedence over another still loading, to offer `retry` as soon as possible.
- **Reloads.** A reload with data (`refresh()`, an input change) does not return to `pending`: the content stays mounted, with its DOM, focus and state, and the `default` snippet receives `refreshing` (`<snippet name="default" params="refreshing">`) for a subtle indicator. A failed reload retains the content; `items.error.value` says why. With `keepPrevious: false`, an input change clears data and the area returns to `pending`.
- **Types.** Within the content, `meeko check` and the editor read `items.data.value` as loaded: no `!` or `?.` is needed, as within `if:when="items.data.value"`. This applies to each `for` resource written as a name (`items`, `page.items`); with another expression, the content uses the usual type. `pending` and `error` are not narrowed. Props are `MeekoAwaitProps` and snippets are `MeekoAwaitSnippets`, from `@meekojs/meeko/framework`; `MeekoAwaitProps` is auto-imported like `MeekoLinkProps`.
- **Markup.** A `<div>` with `class` and `id` if passed, which never changes its element, and with `data-meeko-await="pending|error|ready"`, `aria-busy="true"` while loading or reloading, `data-meeko-refreshing` during a reload and, with `reserve`, `data-meeko-reserve` and `data-meeko-reserve-min`. It includes no styles.
- **Accessibility.** `aria-busy` tells screen readers the area is loading. The error is announced with `role="alert"`: the default message has it; add it to your `error` snippet too. If focus was inside a node disappearing on a state change (the “Reintentar” button, a focusable skeleton), it moves to the area (`tabindex="-1"`, without scrolling the page) instead of being lost in `<body>`; when data arrives, it stays there.
- **SSR.** Without `await`, the request does not run on the server: the HTML carries the `pending` snippet and `aria-busy`, and hydration changes nothing until data arrives. If the resource already has data on the server (an `await useApi`, which also works in `for`), the HTML carries the content.
- **Custom name.** A project component named `MeekoAwait` takes priority over Meeko's tag, with warning `MEEK106`.

##### Reserve height: `reserve`

With `reserve`, while the area waits it occupies the height it last had with data:

- **Memory.** When showing data, a `ResizeObserver` measures the area (after layout, without blocking rendering) and stores its height in `sessionStorage` (`meeko:await`) and memory, under a key combining the path, request key (the payload's: method or procedure and input) and the area's order among those for the same request on the page. It stores the 100 most recent areas. If the browser blocks `sessionStorage` (private mode, a sandbox), memory lasts while the page stays open.
- **Application.** While the area is `pending`, a CSS rule gives it `min-block-size` with the remembered height. The rule lives in a constructed stylesheet (`adoptedStyleSheets`) and the area receives it through its attributes: there is no `style="…"` in the HTML, so it works with a strict CSP without `'unsafe-inline'` in `style-src`. With data, the area returns to its natural height.
- **Explicit minimum.** `reserve="320px"` (any CSS length: `px`, `rem`, `vh`…) also sets a minimum, including on the first visit, and memory never reserves less. Its rule goes in a `<style>` in `<head>` with the request's nonce or, on a static site, allowed by its hash (`inlineStyleHashes`). Anything else is a `TypeError`.
- **Reactive.** With `bind:reserve` (for example, `bind:reserve="compact.value ? false : '320px'"`), enabling, removing or changing the minimum in the browser adds or removes the script and rules in `<head>` and starts or stops measuring the area.

What happens in each case:

| Situation                                                               | First render                                                                                                                                     | When data arrives                                                                                                            |
| ----------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------- |
| First visit in the tab (no memory)                                      | The skeleton, at its natural height (or the minimum from `reserve="320px"`)                                                                      | The area grows once to fit the content: the same shift as without `reserve`, which only a skeleton of the same height avoids |
| Full load of a page already visited in the tab (reload, opening a link) | The skeleton with its remembered height: an inline `<head>` script, running before the first render, reads `sessionStorage` and adopts the rules | No shift if the content has the same height                                                                                  |
| Client navigation to a previously visited page                          | The area is inserted with its remembered height: the component adopts the rules before inserting it                                              | No shift                                                                                                                     |
| Area mounting later (an `if:`, a tab)                                   | Same as navigation                                                                                                                               | No shift                                                                                                                     |
| Data reload                                                             | Content stays on screen                                                                                                                          | No shift, unless the new content has a different height                                                                      |

The `<head>` script always has the same text, so it has a single CSP hash; it carries the request's nonce and a static site allows it through the hashes in `inlineScriptHashes`. It only touches the CSSOM, never the DOM, so hydration finds the server HTML. Meeko only adds it to pages with `<MeekoAwait reserve>` (with `useHead`, also in the first flush on a `render: "stream"` route). Without constructed stylesheets (browsers before 2023), the area uses its natural height.

Height depends on width: if the window changes significantly between visits, memory adjusts on the next measurement. Two areas with the same request on the same page have different keys based on their order; if the order changes between visits, they swap heights.

##### An optional transition

`<MeekoAwait>` animates nothing. To smooth the height change when the area releases its reservation, in browsers with [`interpolate-size`](https://developer.mozilla.org/docs/Web/CSS/interpolate-size):

```css
@media (prefers-reduced-motion: no-preference) {
	[data-meeko-await] {
		interpolate-size: allow-keywords;
		transition: min-block-size 200ms ease-out;
	}
}
```

A size transition moves what follows on every frame and the browser counts it as a shift (CLS): it smooths perception, not the metric. For the metric, what matters is that the reserved height matches the content's height.

#### Prevent layout shifts (CLS)

A card whose data arrives after the first render is empty in the HTML and grows when the list arrives, pushing what follows: a layout shift, measured by Core Web Vitals as CLS. In order of preference:

1. **`await` on initial load.** With `await useApi(...)`, SSR waits for data and renders the list: nothing needs to grow. This is recommended for what is visible when the page loads.

   ```html
   <!-- app/components/ItemsCard.meeko -->
   <script lang="ts">
   	const items = await useApi('/api/items')
   </script>
   <template>
   	<section class="card">
   		<h2>Items</h2>
   		<ul>
   			<li
   				each:of="items.data.value"
   				each:as="item"
   				each:key="item.id"
   			>
   				{item.name}
   			</li>
   		</ul>
   	</section>
   </template>
   ```

2. **`<MeekoAwait reserve>`.** For what cannot block SSR: secondary data, offscreen areas, components mounting later or data changing with interaction. From the second visit in the tab, the area appears at its height (see [Reserve height](#reserve-height-reserve)).

   ```html
   <script lang="ts">
   	const items = useApi('/api/items')
   </script>
   <template>
   	<section class="card">
   		<h2>Items</h2>
   		<MeekoAwait
   			for="items"
   			reserve
   		>
   			<snippet name="pending">
   				<ul class="skeleton">
   					<li
   						each:of="[1, 2, 3, 4]"
   						each:as="row"
   					></li>
   				</ul>
   			</snippet>
   			<ul>
   				<li
   					each:of="items.data.value"
   					each:as="item"
   					each:key="item.id"
   				>
   					{item.name}
   				</li>
   			</ul>
   		</MeekoAwait>
   	</section>
   </template>
   ```

3. **Skeletons of the same height.** A `pending` snippet with the same rows and heights as the content also avoids the shift on the first visit. If the list has a known size (a page of 20), give the skeleton that size; otherwise, `reserve="320px"` sets a reasonable minimum.
4. **`keepPrevious`.** By default, `refresh()` and an input change retain the previous list until the new one arrives: do not clear it manually before reloading (see [Previous data during a reload](#previous-data-during-a-reload-keepprevious)).
5. **`content-visibility` and `contain-intrinsic-size`.** For long offscreen sections, `content-visibility: auto` with `contain-intrinsic-size: auto 320px` reserves a size and the browser remembers the last one it rendered (`auto`). This is application CSS; it combines well with `<MeekoAwait>`.
6. **`interpolate-size`.** A transition smooths the change but does not remove it from the metric (see [An optional transition](#an-optional-transition)).

`meeko check`, `meeko build` and the editor warn with `MEEK117` about a page or layout rendering data from a `useApi` or `useRpcQuery` without `await` in an `each:of` without handling its loading. It is a hint, never an error: it disappears when you await data with `await`, wrap the list in `<MeekoAwait>`, read the resource's `pending` or `refreshing` (a skeleton with `if:when="items.pending.value"`), place the list under an `if:when` reading its data or pass the whole resource to another component (`bind:items="items"`), which can handle its loading.

#### Mutations

`useRpcMutation(procedimiento)` makes no request until `mutate(input)` is called, never in SSR. `mutate` sends the CSRF token like `rpc.*`, updates `pending`, `data` and `error` and returns the procedure's output, or rejects with its error. You cannot use `await` on it at the top level (`MEEK055`): await `mutate` inside a handler.

Since `1.2`, each submission starts with `pending` set to `true` and `error` to `null` in a single update, and ends by writing `data` or `error` and `pending` set to `false` together: an `effect` reading several of these signals never sees a mixture of the previous attempt and the new one. The options `onSuccess(output, intento)` and `onError(error, intento)` are called afterward, with state already updated, once per attempt (see [Per-attempt notifications](#per-attempt-notifications-onsuccess-and-onerror)).

Since `1.2`, `useApiMutation(ruta, método)` does the same with a non-`GET` API endpoint. `ruta` is written as in `useApi` (`"/api/notes/[id]"`) and `método` is `"POST"`, `"PUT"`, `"PATCH"` or `"DELETE"`; TypeScript only accepts methods existing for that path. `mutate({ params, query, body })` receives the operation's input, checked against the contract, and can be called without arguments if the operation requires nothing. A `204` endpoint resolves to `undefined`.

```html
<script lang="ts">
	const props = defineProps<{ params: { id: string }; search: Record<string, string | string[]> }>()
	const note = await useApi('/api/notes/[id]', { params: { id: props.params.id } })
	const save = useApiMutation('/api/notes/[id]', 'PUT')
	const remove = useApiMutation('/api/notes/[id]', 'DELETE')
	async function rename(text: string): Promise<void> {
		await save.mutate({ params: { id: props.params.id }, body: { text } })
		await note.refresh()
	}
</script>
<template>
	<p if:when="save.error.value">Could not save.</p>
	<button
		bind:disabled="remove.pending.value"
		on:click="() => remove.mutate({ params: { id: props.params.id } })"
	>
		Delete
	</button>
</template>
```

Like `useRpcMutation`, it is called while the component script runs (at its top level), and `await useApiMutation(...)` produces `MEEK055`. Your own application export named `useApiMutation` takes priority over the auto-import.

#### Retry-safe mutations

A write left without a response (the network drops, the server responds with `5xx` or the process dies) may or may not have been applied. Retrying blindly can charge twice; discarding it can lose a sale. Since `1.2`, `useRpcMutation` and `useApiMutation` accept the `retrySafe` option, which handles this case on the client and leaves deduplication to the server:

```ts
const charge = useRpcMutation('sales.checkout', { retrySafe: { key: 'pos:sale' } })
const step = useApiMutation('/api/kitchen/items/[id]/steps', 'POST', { retrySafe: { key: 'kitchen:step', storage: 'session' } })
```

- **Keyed intent.** `mutate(input)` creates a new UUID (the idempotency key), stores the intent (input, key and time) in browser storage under `retrySafe.key`, then sends it with the header `Idempotency-Key: "<uuid>"`, in the Structured Fields string format defined by the IETF draft. If the page closes mid-request, the intent remains stored.
- **Without a response.** A network failure, a `5xx`, a `408` or a `429` retains the intent: `mutate` rejects with the error, `error` reflects it and `charge.uncertain.value` shows the intent (`{ idempotencyKey, input, startedAt }`). It is retried with the **same** key when the browser comes back online (`online` event), when a component using the mutation mounts (including after a reload) and when calling `charge.retry()`. While retrying, `uncertain` retains its value, `pending` is `true` and `error` returns to `null`.
- **With a response.** A `2xx` clears the intent and `mutate` or `retry()` resolve with the output. Any other `4xx` also clears it: the server answered, so there is nothing to retry; the `ClientError` reaches `error` and rejects the promise. `uncertain` returns to `null` in the same update that writes `data` or `error` and sets `pending` to `false`, including in other components using the same key: an `effect` watching `uncertain` already reads that attempt's result, never a previous `error`.
- **One intent at a time.** While there is an uncertain intent under that key, `mutate` rejects with a `MUTATION_UNCERTAIN` error without sending anything. The application decides: `retry()` retries it, `discard()` forgets it without sending it (ask the user for confirmation first, because it may have been recorded) and clears `error`, which described that intent's failure.
- **Never in SSR or dry runs.** The server never sends or reads it, nor do navigation dry runs: only the mounted component retries it.
- **Storage.** `storage: "local"` (default) survives reloads and closing the browser; `"session"` only survives reloads of that tab. If the browser blocks storage, the intent lives in memory and is retried while the page stays open. The intent uses [`useStorage`](#persistent-state-usestorage) internally, so another tab sees it arrive through the `storage` event; if two tabs retry it simultaneously, the server receives the same key twice and responds with the same result.

Use one storage key per mutation, including what distinguishes users or accounts sharing the browser (`` `pos:sale:${restaurant.slug}` ``). An intent stored by another mutation under the same key is never sent to this endpoint. Input is stored and resent as it travels, in JSON.

```html
<script lang="ts">
	const charge = useRpcMutation('sales.checkout', { retrySafe: { key: 'pos:sale' } })
	const failure = signal('')
	async function pay(input: SaleInput): Promise<void> {
		failure.value = ''
		try {
			const receipt = await charge.mutate(input)
			notify(`Venta #${receipt.number} cobrada.`)
		} catch (error) {
			// No response: remains uncertain and will retry with the same key.
			if (!charge.uncertain.value) failure.value = errorMessage(error)
		}
	}
	function discard(): void {
		if (window.confirm('Discard this sale only if you have confirmed it was not recorded.')) charge.discard()
	}
</script>
<template>
	<div
		role="alert"
		if:when="charge.uncertain.value"
	>
		<p>Sale pending verification: no response was received. It will retry with the same key, so it will not charge twice.</p>
		<button
			bind:disabled="charge.pending.value"
			on:click="() => charge.retry().catch(() => {})"
		>
			Retry now
		</button>
		<button on:click="discard">Discard</button>
	</div>
	<p if:when="failure.value">{failure.value}</p>
</template>
```

##### Per-attempt notifications: `onSuccess` and `onError`

An automatic retry (when the connection returns or the component mounts) has no promise to await. Since `1.2`, the `onSuccess` and `onError` options of `useRpcMutation` and `useApiMutation`, with or without `retrySafe`, are called once for each completed attempt, whoever sent it, after updating `data`, `error`, `pending` and `uncertain`:

```ts
const charge = useRpcMutation('sales.checkout', {
	retrySafe: { key: 'pos:sale' },
	onSuccess(receipt, attempt) {
		// Also after a background retry: the sale pending verification was confirmed.
		if (attempt.trigger !== 'mutate') notify(`Venta #${receipt.number} cobrada.`)
		ticket.clear()
	},
	onError(error, attempt) {
		// Only rejections with a response: without a response, the sale remains pending verification.
		if (!attempt.uncertain) notify(`The sale was not recorded: ${errorMessage(error)}`)
	},
})
```

- **`intento`.** Carries the submitted input (`input`), its key (`idempotencyKey`, `null` without `retrySafe`) and who sent it (`trigger`): `"mutate"`, `"retry"` (a call to `retry()`) or `"resume"` (the automatic retry). In `onError`, `uncertain` is `true` when there was no response and the intent is retained for retry; without `retrySafe` it is always `false`.
- **Once per attempt.** If `mutate` and `retry()` await the same request, or two components with the same key share it, each mutation notifies only once. The `mutate` and `retry()` promise still resolves or rejects as usual: use notifications for what must also happen after a background retry and the promise for what belongs to that specific call.
- **Errors.** A failure inside the notification (or its rejected promise if asynchronous) reaches the nearest `provideErrorHandler` with source `"event"`, like an `on:` handler; it changes neither mutation state nor the promise's result.

**On the server**, the key arrives validated as `context.idempotencyKey`: the lowercase UUID, or `undefined` if the header is missing or is not a UUID (accepted with or without quotes). Meeko does not deduplicate: the application stores the key alongside the result, with a unique constraint, and on a repeated key returns the result already recorded instead of applying the write again.

```sql
ALTER TABLE sales ADD COLUMN idempotency_key uuid;
CREATE UNIQUE INDEX sales_idempotency_key ON sales (restaurant_id, idempotency_key);
```

```ts
// server/rpc/sales/checkout.ts
export default defineRpc({
	input: saleInput,
	output: saleReceipt,
	auth: 'required',
	handler: async ({ input, context }) => {
		const key = context.idempotencyKey
		if (!key) throw new ApiError('IDEMPOTENCY_KEY_REQUIRED', 400)
		const { db, restaurantId } = context.services
		// Retrying an already recorded sale returns the same receipt without charging again.
		const existing = await db.sales.findByKey(restaurantId, key)
		if (existing) return existing.receipt
		// The unique constraint also covers two simultaneous retries: the second INSERT fails
		// and reads the first one's sale again.
		return db.sales.insertOrGet(restaurantId, key, input)
	},
})
```

Scope the key to the user or account, as in the index, and, if you want to follow the IETF draft exactly, respond with `422` when the same key arrives with different input. The header does not change security: the request still needs the usual session, CSRF token and `Origin`. On a same-origin request the browser sends it directly; if a cross-origin client calls the API with CORS, add `Idempotency-Key` to `Access-Control-Allow-Headers` in your proxy or middleware.

##### A custom key in `api.*` and `rpc.*`

Since `1.2`, a generated client call accepts `idempotencyKey`, a UUID traveling in the same `Idempotency-Key` header. It goes alongside `params`, `query`, `body` and `signal` in `api.*`, and in the options of `rpc.*`:

```ts
const key = crypto.randomUUID()
await api.sales.post({ body: sale, idempotencyKey: key })
await rpc.sales.checkout(sale, { idempotencyKey: key, signal: AbortSignal.timeout(10_000) })
```

A non-UUID value rejects with `TypeError` without sending the request. The key is neither stored nor retried: it is the same header, and deduplication remains the server's responsibility.

| Situation                                                                                                                               | Use                                                                                                           |
| --------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------- |
| A write from a component that must survive a network drop or reload, with an “under verification” notice                                | `useRpcMutation` / `useApiMutation` with `retrySafe`: Meeko creates the key, stores the intent and retries it |
| Non-component code (a script, your own queue, a service worker) or a key that already exists outside Meeko, such as an offline order ID | `api.*` / `rpc.*` with `idempotencyKey`: you store the key and repeat the call with it                        |
| Testing server deduplication                                                                                                            | `api.*` / `rpc.*` with `idempotencyKey`, without writing the header manually                                  |

#### `load` or composables

| Need                                                                               | Use                                                                                          |
| ---------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------- |
| Page data determining `head`, a redirect, session or HTTP status                   | Top-level `<script server>` code (or `load`)                                                 |
| Slow, secondary data on a `"stream"` route                                         | An export, or a `load` field, with `defer`                                                   |
| Data belonging to a reusable component or layout                                   | `await useApi` / `await useRpcQuery`                                                         |
| Data depending on component signals and reloading when they change                 | `useApi` / `useRpcQuery`, with or without `await`                                            |
| Data that can arrive after the first render, with a loading indicator              | `useApi` / `useRpcQuery` without `await`, with [`<MeekoAwait>`](#meekoawait) to avoid shifts |
| Writes                                                                             | `useRpcMutation` / `useApiMutation`, or `api.*`/`rpc.*` in a handler                         |
| Writes that must not apply twice if the response is lost (payments, kitchen steps) | `useRpcMutation` / `useApiMutation` with `retrySafe`                                         |
| Browser state that must survive a reload (an open ticket, the selected register)   | [`useStorage`](#persistent-state-usestorage)                                                 |
| Forms submitting data, with validation and per-field errors                        | `useForm` with `api.*`/`rpc.*` in its `submit`                                               |

These composables' top-level rules (`MEEK054`, `MEEK055`) are described in [api.md](api.md#top-level-composables-and-await). A custom host can create them with `createUseApi(manifest, options)`, `createUseRpcQuery(manifest, options)`, `createUseRpcMutation(manifest, options)` and, since `1.2`, `createUseApiMutation(manifest, options)` from `@meekojs/meeko/framework`, which is what generated clients do; the types `DataResource`, `LoadedResource`, `RpcMutation`, `UseApi`, `UseRpcQuery`, `UseRpcMutation`, `ApiQueryContract`, `ApiQueryOptions` and `Reactive`, since `1.2` `ApiMutation`, `ApiMutationInput`, `ApiMutationContract`, `UseApiMutation`, `MutationOptions`, `RetrySafeOptions`, `RetrySafeMutation` and `UncertainMutation`, and since `1.5` `DataResourceOptions`, describe their shape.

### Persistent state: `useStorage`

Since `1.2`, `useStorage(clave, inicial, opciones?)` returns a writable signal whose value is stored as JSON in `localStorage` (or in `sessionStorage` with `storage: "session"`). It is auto-imported in `.meeko` files from `@meekojs/meeko/framework`, like `useState`, and called while a component's script runs (at its top level or inside a composable it calls).

```html
<script lang="ts">
	const lines = useStorage('pos:ticket', [] as TicketLine[])
	const registerId = useStorage('pos:register', '')
	const add = (line: TicketLine): void => {
		lines.value = [...lines.value, line]
	}
</script>
<template><p>{lines.value.length} items on the receipt</p></template>
```

- **SSR and hydration without mismatches.** The server never reads storage: the HTML uses `inicial`, as does hydration. The stored value is applied just after page hydration finishes, before `onMounted`, like `model` with a control the user edited before hydration. A component mounting later (an `if:` opening, a page reached by browser navigation) already renders the stored value on its first render. The signal does not travel in payload state: its source is storage.
- **Writes.** Every assignment is stored immediately, as JSON. Assign new values (`lines.value = [...lines.value, line]`), as with any signal: mutating the object neither notifies nor stores. Assigning `undefined` deletes the key, and the next read returns to `inicial` (declare the type with `| undefined`, for example `useStorage<string | undefined>("draft", undefined)`).
- **Invalid reads.** A value that is not JSON or fails `schema` is ignored and the signal holds `inicial`. `schema` is a synchronous Standard Schema (Valibot, Zod…); with it, the signal's type comes from the schema:

  ```ts
  import * as v from 'valibot'
  const theme = useStorage('theme', 'light', { schema: v.picklist(['light', 'dark']) })
  ```

- **Blocked storage.** In private mode, without permission or with a full quota, it never throws: the signal keeps working in memory. Only an unexpected failure, such as a value JSON cannot represent (`BigInt`, cycles) or a `schema` that throws or is asynchronous, reaches the nearest `provideErrorHandler` or the application's `onError`.
- **Other tabs.** While any component uses the key, another tab's `storage` event updates the signal (with the same validation); a `localStorage.clear()` returns it to `inicial`. The listener is disposed of with the last component using it.
- **One signal per key.** Two components using the same key and storage share a single signal; the first to create it sets `inicial` and `schema`. When no component uses it anymore, the next one reads storage again.

| Need                                                       | Use                      |
| ---------------------------------------------------------- | ------------------------ |
| Shared application state, identical in SSR and the browser | `useState`               |
| Browser state surviving a reload or shared between tabs    | `useStorage`             |
| Data belonging to the server                               | `useApi` / `useRpcQuery` |

Do not store secrets or tokens: storage is readable by any script on the page. Include in the key what distinguishes users or accounts sharing a browser (`` `pos:ticket:${restaurant.slug}` ``).

### Forms: `useForm`

Since `1.2`, `useForm` brings together what each form repeats: a signal per field, browser validation, `pending`, the error message, `event.preventDefault()` and the `issues` from a server `400` mapped to each field. It is auto-imported from `@meekojs/meeko/framework` and validates with any Standard Schema, such as Valibot's. Its types `Form`, `FormField` and `FormSubmission` are also auto-imported as types in components and `app/` modules; they are not available in `<script server>`, `server/` or `shared/`.

```ts
// shared/schemas/menu.ts
import * as v from 'valibot'

export const categoryInput = v.object({
	name: v.pipe(v.string(), v.trim(), v.minLength(1, 'Enter a name.'), v.maxLength(60, 'Use at most 60 characters.')),
	description: v.pipe(v.string(), v.trim(), v.maxLength(200, 'Use at most 200 characters.')),
})
export const categorySchema = v.object({ id: v.string(), name: v.string(), description: v.string() })
```

```ts
// server/api/menu/categories/index.post.ts
import { ApiError, defineApiRoute } from '@meekojs/meeko/server'
import { categoryInput, categorySchema } from '../../../../shared/schemas/menu.js'
import { createCategory } from '../../../utils/menu.js'

export default defineApiRoute({
	body: categoryInput,
	response: categorySchema,
	status: 201,
	handler: async ({ body }) => {
		const category = await createCategory(body)
		if (!category) throw new ApiError('CATEGORY_EXISTS', 409)
		return category
	},
})
```

```html
<!-- app/components/TextField.meeko -->
<script lang="ts">
	const props = defineProps<{ label: string; error?: string | undefined }>()
	const value = defineModel<string>('value')
</script>
<template>
	<label>
		{props.label}
		<input
			model="value"
			bind:aria-invalid="props.error ? 'true' : null"
		/>
	</label>
	<p
		class="field-error"
		if:when="props.error"
	>
		{props.error}
	</p>
</template>
```

```html
<!-- app/pages/menu/categories/new.meeko -->
<script lang="ts">
	import { ClientError } from '@meekojs/meeko/framework'

	const form = useForm({
		schema: categoryInput,
		initial: { name: '', description: '' },
		submit: (values) => api.menu.categories.post({ body: values }),
		errorMessage: (failure) => (failure instanceof ClientError && failure.code === 'CATEGORY_EXISTS' ? 'A category with that name already exists.' : 'Could not save. Check your connection and try again.'),
	})
</script>
<template>
	<form
		on:submit="form.submit"
		novalidate
	>
		<p
			class="alert"
			role="alert"
			if:when="form.error.value"
		>
			{form.error.value}
		</p>
		<label>
			Name
			<input
				model="form.fields.name"
				bind:aria-invalid="form.errors.value.name ? 'true' : null"
			/>
		</label>
		<p
			class="field-error"
			if:when="form.errors.value.name"
		>
			{form.errors.value.name}
		</p>
		<TextField
			label="Description"
			model:value="form.fields.description"
			bind:error="form.errors.value.description"
		/>
		<button bind:disabled="form.pending.value">{form.pending.value ? "Saving…" : "Save"}</button>
		<p if:when="form.submitted.value">Category saved.</p>
	</form>
</template>
```

`useForm(options)` receives:

| Option                    | Usage                                                                                                                                                                                                                                                                       |
| ------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `schema`                  | Optional. Standard Schema validating fields on submission.                                                                                                                                                                                                                  |
| `initial`                 | Each field's initial value. With `schema`, one for every input key, including optional ones (`undefined` if there is no value).                                                                                                                                             |
| `submit(values)`          | Submits data: receives the schema output (or field values, without a schema) and returns the result, or rejects.                                                                                                                                                            |
| `errorMessage(failure)`   | Optional. `error` text for a failure without `issues`; defaults to `failure.message`, which for a `ClientError` is its `code`.                                                                                                                                              |
| `onSuccess(result, form)` | Optional, since `1.5`. Runs after a successful submission, with `submitted` already `true`: for example, `(saved, form) => form.commit({ name: saved.name })`.                                                                                                              |
| `focusInvalid`            | Optional, since `1.5`. With `true`, moves focus to the first invalid control after a submission with field errors (see [Focus the first error](#focus-the-first-error)).                                                                                                    |
| `action`                  | Optional, since `1.7`. Path of the endpoint with `form` to which the `<form method="post">` submits without JavaScript, such as `"/api/feedback"`: on return from that submission, SSR renders its result (see [Forms without JavaScript](#forms-without-javascript-form)). |

and returns a `Form`:

| Property            | Value                                                                                                                                                |
| ------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------- |
| `fields`            | A writable `Signal` per field, for `model` on an `<input>`, `<textarea>` or `<select>` and `model:nombre` on a component.                            |
| `errors`            | Signal with the first message of each path with an error (`errors.value.name`, `errors.value["items.0.name"]`); a field without an error has no key. |
| `error`             | Signal with the whole form's message, or `null`.                                                                                                     |
| `failure`           | Signal with the original error of the last failed submission (including the `ClientError` of a `400`), or `null`.                                    |
| `pending`           | `true` during asynchronous validation or while `submit` runs.                                                                                        |
| `submitted`         | `true` when the last submission succeeded.                                                                                                           |
| `dirty`             | `true` if any field differs from its initial value (arrays and objects are compared by content).                                                     |
| `submit(event?)`    | Submits the form; resolves with the return value of `submit`, or `undefined`. Never rejects.                                                         |
| `trySubmit(event?)` | Since `1.5`. Submits like `submit`, but resolves with a `FormSubmission` describing how it ended. Never rejects.                                     |
| `reset(values?)`    | Returns to `initial`, or `initial` combined with `values`; also accepts a `<form>`'s `reset` event.                                                  |
| `load(values)`      | Fills fields with a record to edit. Omitted keys retain their current value; loaded data is the `dirty` baseline.                                    |
| `commit(values?)`   | Since `1.5`. Writes `values` and takes field values as the new `dirty` baseline, without clearing `submitted`.                                       |
| `field(name)`       | Since `1.5`. A field's pieces for your own component: its signal, message and stable IDs (see [Field components](#field-components-formfield)).      |
| `csrfToken`         | Since `1.7`. The session's CSRF token for a native form's hidden `_csrf` field, or `undefined` without a session. It is not a signal.                |

All signals except `fields` are read-only (`csrfToken` is text, not a signal).

**Submission.** `form.submit(event)` calls `event.preventDefault()`, validates fields with the schema and, if valid, calls `submit` with the schema's output. While a submission is in progress, another `form.submit()` is ignored (resolves to `undefined`, and also prevents native browser submission). When a valid submission starts, `errors`, `error`, `failure` and `submitted` are cleared. `submit` can return a value or a promise; to do something with the result, wrap the call:

```ts
async function save(event: SubmitEvent): Promise<void> {
	const category = await form.submit(event)
	if (category) form.reset()
}
```

**Submission result.** `submit` resolves to `undefined` whether data is invalid, the network fails or `submit` returns `undefined`. Since `1.5`, `form.trySubmit(event)` submits the same way, but resolves with a `FormSubmission<Result>` discriminated by `ok` and `reason`:

| Result                                                     | When                                                                                                                                                                                  |
| ---------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `{ ok: true, result }`                                     | `submit` succeeded and returned `result`.                                                                                                                                             |
| `{ ok: false, reason: "invalid", errors, error, failure }` | Data failed the browser schema (`failure` is `null`) or the server responded with `issues` (`failure` is the `ClientError`). `errors` and `error` are the messages the form displays. |
| `{ ok: false, reason: "error", error, failure }`           | Submission failed without `issues`, such as a `409` or a network failure. `error` is the text from `errorMessage`, or `null` if a `reset` discarded it.                               |
| `{ ok: false, reason: "skipped" }`                         | Nothing was submitted: a submission was already in progress, the script is running only to produce HTML (SSR) or a `reset` discarded values while the schema was validating.          |

```ts
async function send(event: SubmitEvent): Promise<void> {
	const outcome = await form.trySubmit(event)
	if (outcome.ok) created.value = outcome.result.username
	else if (outcome.reason === 'error') console.warn(outcome.failure)
}
```

`submit` is unchanged: it still resolves with the result or `undefined`, and `on:submit="form.submit"` remains the short form when you do not need the result.

#### Focus the first error

With `focusInvalid: true`, a submission ending with field errors, from the schema or server `issues`, moves focus to the first invalid control once messages have rendered (in the next `requestAnimationFrame`). It searches in document order within the event's `<form>` (its `currentTarget`, or the submitting button's form), for a control whose `name` or `form.field` `id` matches a field with an error, or that has `aria-invalid="true"`. Without an event, it searches the entire document. A failure without `issues`, such as a `409` without them or a network failure, does not move focus.

```ts
const form = useForm({ schema: signupInput, initial: { email: '', password: '' }, submit: (values) => api.signup.post({ body: values }), focusInvalid: true })
```

**Validation.** The schema runs on submission, not while typing. Each issue goes to `errors` with its path joined by `.`, like server `issues`: `"name"`, or `"items.0.name"` for a nested field. If a path has several, the first is kept. An issue with path `""` (from a rule on the whole object) or for a key the form does not have goes to `error`. After an error, the field is validated again whenever it changes: its message updates or disappears as soon as it is valid, without waiting for the next submission. A field without an error is not validated until submission. If the schema is asynchronous, `pending` is `true` while it validates.

**Fields depending on others.** Since `1.5`, each change also revalidates other fields already showing a schema error, and the form message if it came from the schema (an issue with path `""`). The schema always runs over the entire form, so this costs no more. With a confirmation that Valibot forwards to its field using `v.forward(v.partialCheck([["password"], ["confirm"]], …), ["confirm"])`, changing the password removes “Las contraseñas no coinciden” from `confirm` as soon as they match, without touching confirmation. Rules still do not add messages to a field that had no error, and another field's server messages (an `issue` from a `400` or an `ApiError`) are not cleared by changing a different field: only when their own field changes. With an asynchronous schema, only the latest validation applies, covering all fields changed since the previous one.

**Server errors.** A `ClientError` with `issues` (the `400` response for input failing the server schema) is distributed the same way: each message in its field and the rest in `error`. This is useful without a browser schema, or when the server has rules the form does not check. Without a schema, changing a field clears its server messages:

```ts
// app/pages/ingresar.meeko: without a schema, only the server validates
const form = useForm({
	initial: { email: '', password: '' },
	submit: (values) => api.session.post({ body: values }),
	errorMessage: (failure) => (failure instanceof ClientError && failure.code === 'INVALID_CREDENTIALS' ? 'The details do not match any account.' : 'Could not connect to the server.'),
})
```

```json
{
	"code": "INVALID_BODY",
	"status": 400,
	"requestId": "…",
	"issues": [
		{ "path": "email", "message": "Enter a valid email address." },
		{ "path": "password", "message": "Enter your password." }
	]
}
```

With that response, `form.errors.value` is `{ email: "Enter a valid email address.", password: "Enter your password." }`, `form.error.value` is `null` and `form.failure.value` is the `ClientError`. A `401` `INVALID_CREDENTIALS` leaves `errors` empty and `error` with the text from `errorMessage`. To mark a field from `submit` itself (for example, after checking something in the browser), throw a `ClientError` with `issues`: `throw new ClientError("EMAIL_TAKEN", 409, undefined, [{ path: "email", message: "Ese correo ya tiene cuenta." }])`.

Since `1.5`, the server can also assign a non-validation error to a field, such as a `409` for an email that already exists: `new ApiError(code, status, { issues })` sends those `issues` with the same shape as those of a `400` (see [Field errors: `ApiError` with `issues`](#field-errors-apierror-with-issues)), and `useForm` distributes them the same way: the message in `errors.value.email`, `error` set to `null` and the `409`'s `ClientError` in `failure`.

```ts
// server/api/signup.post.ts
export default defineApiRoute({
	body: signupInput,
	response: signupResult,
	status: 201,
	handler: async ({ body }) => {
		if (await emailTaken(body.email)) throw new ApiError('EMAIL_TAKEN', 409, { issues: [{ path: 'email', message: 'That email already has an account.' }] })
		return createUser(body)
	},
})
```

`ClientError` and `isClientError` are auto-imported since `1.5` in components and `app/` modules (not in `server/`, where you throw `ApiError`), like `useForm`: `errorMessage: (failure) => isClientError(failure, "INVALID_CREDENTIALS") ? "…" : "…"` needs no import.

**Other failures.** An error without `issues` puts the text of `errorMessage(failure)` in `error` and the original error in `failure`, and `form.submit()` resolves to `undefined`. A `ClientError` is an expected server response and is not reported elsewhere. Any other error (a network failure, a programming error in `submit` or a schema that throws) also reaches the component's error observer, `provideErrorHandler` or the `onError` of `mountClientApp`, with source `"event"`; without an observer, it is written to the console. Thus an unexpected failure is never silently lost, even if the template does not show `error`.

**`reset`, `load` and `dirty`.** `reset()` always returns fields to `initial`, even after `load` or `commit`. `reset(values)` combines `values` with `initial` and takes that result as the `dirty` baseline. `load(values)` combines data with current fields and uses the result as the `dirty` baseline; use it when loading a record to edit, including after an asynchronous request: `form.load({ name: category.name, description: category.description })`. Both clear errors and the last submission's state, and discard earlier results still in progress (although `pending` stays `true` until completion). `reset` can also be connected to `on:reset="form.reset"`. As with any signal, replace arrays and objects instead of mutating them: `form.fields.items.value = [...form.fields.items.value, item]`.

**`commit`.** Since `1.5`, `commit(values?)` writes `values` to their fields and takes all field values as the new `dirty` baseline: `dirty` returns to `false`. `reset()` still returns to `initial`. Unlike `reset`, it does not clear `submitted`, `errors`, `error` or `failure`, nor discard an in-progress submission. Use it after saving, so saved data becomes the new baseline without losing the “Saved” state. Without `values`, it takes current values; if the user can keep typing during submission, pass what the server returned. With `onSuccess`, the form does this itself:

```ts
const profile = useForm({
	schema: profileInput,
	initial: { name: data.name, bio: data.bio },
	submit: (values) => api.profile.put({ body: values }),
	onSuccess: (saved, form) => form.commit({ name: saved.name, bio: saved.bio }),
})
```

```html
<p if:when="profile.submitted.value && !profile.dirty.value">Saved.</p>
```

**Types.** With `schema`, fields have the schema input's type and `submit` receives its output: with a `v.transform`, the field can be text (`price: Signal<string>`) and `submit` receive a number. Without a schema, fields and values have the type of `initial`. `meeko check` checks `initial` against the schema input, rejects a nonexistent field (`form.fields.nmae`) or a nonexistent `errors` path, and requires a `model` field to have the control's type (a `number` field does not work for a text `<input>`). The `Form<Values, Result>` type describes the result, for example to pass the form to a component.

#### Field components: `FormField`

Since `1.5`, `form.field(name)` returns what a field component needs, without receiving the entire form: a `FormField<Value>` typed by the field key (`form.field("nmae")` is a type error). It always returns the same object for the same field, so you can pass it as a prop in the template.

| Property                  | Value                                                                                                                                                                                                  |
| ------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `value`                   | The same `Signal` as `form.fields[name]`, for `model`.                                                                                                                                                 |
| `name`                    | The field name, for the `name` attribute (and for `focusInvalid`).                                                                                                                                     |
| `id`, `errorId`, `hintId` | IDs for the control, its message (`${id}-error`) and hint text (`${id}-hint`). They come from [`useId`](api.md#stable-ids-useid): they match between SSR and hydration and do not repeat across forms. |
| `error`                   | Signal with the field's first message (or a nested path's, such as `items.0.name`), or `undefined`.                                                                                                    |
| `invalid`                 | Signal: `true` if the field has any error.                                                                                                                                                             |
| `describedBy`             | Signal: `errorId` while there is an error, or `undefined`; the value for `aria-describedby`.                                                                                                           |

```html
<!-- app/components/AppField.meeko -->
<script lang="ts">
	import type { FormField } from '@meekojs/meeko/framework'
	const props = defineProps<{ field: FormField<string>; label: string; hint?: string }>()
	const describedBy = computed(() => [props.hint ? props.field.hintId : '', props.field.describedBy.value ?? ''].filter(Boolean).join(' ') || null)
</script>
<template>
	<div class="field">
		<label bind:for="props.field.id">{props.label}</label>
		<input
			bind:id="props.field.id"
			bind:name="props.field.name"
			model="props.field.value"
			bind:aria-invalid="props.field.invalid.value ? 'true' : null"
			bind:aria-describedby="describedBy.value"
		/>
		<p
			if:when="props.hint"
			class="field-hint"
			bind:id="props.field.hintId"
		>
			{props.hint}
		</p>
		<p
			if:when="props.field.error.value"
			class="field-error"
			bind:id="props.field.errorId"
		>
			{props.field.error.value}
		</p>
	</div>
</template>
```

```html
<form
	on:submit="form.submit"
	novalidate
>
	<AppField
		bind:field="form.field('email')"
		label="Email"
	/>
	<AppField
		bind:field="form.field('password')"
		label="Password"
		hint="At least 10 characters."
	/>
</form>
```

**A field with `field` or `model`.** A reusable field component can work inside a form, with `bind:field`, and outside it, with `model` or nothing. Declare `field` as optional and the default model with unnamed options, `defineModel<string>({ default: "" })`, so it is optional too (see [Component models](api.md#component-models-definemodel-and-model)); with `defineModel<string>()`, `<AppTextField bind:field="…" />` produces `TS2741` because the model would be required. Choose between the two within a `computed`:

```html
<!-- app/components/AppTextField.meeko -->
<script lang="ts">
	import type { FormField } from '@meekojs/meeko/framework'
	const props = defineProps<{ field?: FormField<string>; label: string; hint?: string; error?: string }>()
	// Without field, the value is the model: the parent's signal (model="señal") or its own.
	const model = defineModel<string>({ default: '' })
	const ownId = useId()
	const id = computed(() => props.field?.id ?? ownId)
	const hintId = computed(() => `${id.value}-hint`)
	const errorId = computed(() => `${id.value}-error`)
	const value = computed(() => props.field?.value ?? model)
	const error = computed(() => (props.field ? props.field.error.value : props.error))
	const describedBy = computed(() => [props.hint ? hintId.value : '', error.value ? errorId.value : ''].filter(Boolean).join(' ') || null)
</script>
<template>
	<div class="field">
		<label bind:for="id.value">{props.label}</label>
		<input
			bind:id="id.value"
			bind:name="props.field?.name"
			model="value.value"
			bind:aria-invalid="error.value ? 'true' : null"
			bind:aria-describedby="describedBy.value"
		/>
		<p
			if:when="props.hint"
			class="field-hint"
			bind:id="hintId.value"
		>
			{props.hint}
		</p>
		<p
			if:when="error.value"
			class="field-error"
			bind:id="errorId.value"
		>
			{error.value}
		</p>
	</div>
</template>
```

```html
<form
	on:submit="form.submit"
	novalidate
>
	<AppTextField
		bind:field="form.field('email')"
		label="Email"
	/>
</form>
<AppTextField
	model="query"
	label="Search"
	hint="By name or email."
/>
<AppTextField label="Notes" />
```

`model="value.value"` binds the signal chosen by the `computed`: the field's or the model's. Field IDs come from `form.field` and, without it, from `useId`, with the same `-hint` and `-error` suffixes as `hintId` and `errorId`. `const value = props.field?.value ?? model` in setup would produce warning `MEEK101`, correctly: setup runs once and, with reactive props, the parent can change fields without remounting the child (`bind:field="editing.value ? form.field('email') : form.field('phone')"`). `form.field` returns the same object for the same field, but the prop can switch to another; within a `computed`, the value and IDs follow that change. Use `untrack(() => props.field)` only if that instance's field never changes.

For a field of another type, declare the prop with its type (`FormField<boolean>` for a checkbox). IDs from `form.field` take the `document.idPrefix` prefix. Call `useForm` at the script's top level, like `useId`, so its IDs match during hydration.

**SSR and hydration.** In SSR, the form renders with `initial` and never submits: events do not exist on the server, and `form.submit()` does nothing if called while the script runs solely to produce HTML (SSR or a navigation dry run). Fields are component state that does not travel in the payload: they are part of neither transferred state nor state preserved by HMR, because `form` is not a signal. During hydration, the browser runs `useForm` again with the same `initial`, so `initial` must depend only on props, route data and state, like the input of an `await useApi`. Anything the user types before page hydration is preserved: `model` copies it to the field signal when hydration finishes. Since `1.7`, with `action`, the result of a submission without JavaScript does travel in page state, so hydration renders the same as SSR (see [Forms without JavaScript](#forms-without-javascript-form)).

Call `useForm` at the top level of `<script>`, like any component state. Unlike `useApi`, it has no `MEEK054` restriction and does not accept `await`.
