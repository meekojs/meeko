# Crear API y RPC

Esta guía desarrolla [la visión general del framework](framework.md).

## API y RPC

Los archivos `server/api/users/index.get.ts`, `index.post.ts` y `[id].get.ts` crean `/api/users` y `/api/users/:id`. Los procedimientos bajo `server/rpc/users/get.ts` crean `/_meeko/rpc/users/get`. Los schemas públicos residen en `shared/`. Los handlers usan `defineApiRoute` y `defineRpc`, y el servidor valida entrada, salida, sesión, autorización, CSRF y, desde `1.8`, el `Origin` de toda mutación (véase [Origin en mutaciones anónimas](framework-auth.md#origin-en-mutaciones-anónimas)).

**Validador: Standard Schema, Valibot por defecto.** Meeko valida con cualquier biblioteca que implemente [Standard Schema](https://standardschema.dev), como Valibot, Zod o ArkType, en API, RPC, Socket, rutas, `useForm` y `useStorage`. Los ejemplos de esta documentación usan Valibot (`import * as v from "valibot"`, desde la versión 1), el validador recomendado: es pequeño y modular, así que el bundle del navegador sólo incluye las funciones que usan los schemas de `shared/` que comparten servidor y cliente. Elegir otra biblioteca no cambia ninguna API de Meeko; sólo la exportación OpenAPI necesita el conversor a JSON Schema de esa biblioteca (para Valibot, `@valibot/to-json-schema`).

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
// app/pages/users/index.meeko, sin imports manuales
const loadUsers = async () => {
	const users = await api.users.get()
	const user = await api.users({ id: '123' }).get()
	const result = await rpc.users.get({ id: '123' })
	return { users, user, result }
}
```

Esos símbolos también funcionan en `.ts` según el ámbito. `meeko routes .` genera `.meeko/generated/clients.client.ts` y `clients.server.ts` con descriptores públicos y tipos inferidos; no importan handlers privados. En SSR, los clientes consultan el contexto actual en cada llamada y despachan localmente por el mismo pipeline HTTP si el host suministra `createLocalServerFetch`. El starter ya lo conecta. Credenciales, sesión, servicios, estado y `requestId` quedan ligados a la petición original. Fuera de un contexto SSR, una llamada al cliente servidor falla con un error claro. En navegador se usa `fetch` same-origin y se lee el token CSRF de la meta `meeko-csrf-token`, que se actualiza tras respuestas y navegación. `createApiClient` y `createRpcClient` siguen disponibles para clientes explícitos o externos. Las respuestas no JSON requieren `contentType: "response"`.

Una respuesta API/RPC iniciada antes de un cambio de token no puede restaurar un token CSRF ya eliminado por logout ni sobrescribir el token aplicado por navegación. El cliente compara el documento y el token actuales con los que tenía al iniciar la petición antes de aplicar la cabecera de respuesta.

Los schemas `params` de API deben describir exactamente los segmentos dinámicos de la ruta como cadenas obligatorias. Una ruta estática no declara `params`. Los inputs de `query` deben aceptar cadenas o listas de cadenas, con campos opcionales si la clave puede faltar. Si se necesitan números, conviértalos dentro del schema desde texto; el generador rechaza un contrato que exige directamente un número que la URL no puede entregar.

Los schemas públicos de API, RPC y Socket deben exponer tipos Standard Schema concretos: la generación rechaza `any`, `unknown` y `never` tanto en la entrada como en la salida, incluso cuando aparecen anidados, y también parámetros genéricos que no quedan resueltos en el contrato exportado. Concrete esos parámetros y modele explícitamente el tipo público antes de generar clientes. El manifiesto también rechaza nombres que no puedan representarse sin ambigüedad en el cliente. Por ejemplo, `server/api/users/index.get.ts` (`api.users.get()`) no puede coexistir con `server/api/users/get.post.ts` (`api.users.get.post()`), ni `server/rpc/users.ts` con `server/rpc/users/get.ts`. `server/api/index.<method>.ts` se rechaza porque produciría una clave cliente vacía. Cada diagnóstico incluye las rutas en conflicto; no hay sobrescrituras silenciosas.

`meeko check .` genera proyectos TypeScript separados para cliente, servidor y shared. Incluye las fuentes de los layers declarados en `meeko.config.ts` (también los que añaden los módulos), aunque sus rutas no usen el nombre convencional `layers/`, y los componentes de `addComponentsDir` de los módulos que viven dentro del proyecto fuera de `node_modules`. Un archivo `*.server.ts` de `app/` se comprueba en el proyecto servidor y uno `*.shared.ts` en el proyecto shared; los archivos con sufijo de ámbito conservan esa selección también dentro de `shared/` y `server/`.

Los errores de API y RPC se normalizan en el servidor: un `ApiError` conserva `code` y `status`, la respuesta añade `requestId` y `x-request-id`, y un fallo desconocido se devuelve como `INTERNAL_ERROR` sin exponer su mensaje. La misma normalización se aplica al despacho local SSR y al transporte Node, incluso cuando Vite carga módulos en grafos distintos. La navegación que solicita `application/meeko+json` recibe el mismo formato; una página HTML de error conserva el estado HTTP y `x-request-id` sin incluir detalles privados. El servidor generado observa los fallos 5xx: en producción registra tipo e ID, y en desarrollo muestra también el error original. Las respuestas 4xx esperadas no se registran como fallos internos.

### Schemas públicos

Los schemas de un contrato (`input` y `output` de `defineRpc`; `params`, `query`, `body` y `response` de `defineApiRoute`) son públicos: con ellos se generan los tipos de los clientes `api` y `rpc`. El generador (`meeko routes`, `meeko check`, `meeko dev` y `meeko build`) no ejecuta ni importa el handler, que puede llevar código privado del servidor: lee el contrato como código y nombra cada schema por su módulo, de modo que `.meeko/types/server-contracts.d.ts` contiene `typeof import("../../shared/schemas/user.js")["userSchema"]`. Por eso un schema público vive en `shared/`, que no contiene código de servidor y que el navegador puede importar; sus dependencias tampoco pueden salir de `shared/` (salvo paquetes de `node_modules`), y un schema local del handler o de `server/` da `output debe venir de shared/`.

Desde `1.8`, el contrato admite además una **composición simple** de esos schemas con funciones de paquetes, como `v.array(snapshotSchema)` o `v.optional(filterSchema)`: llamadas, lecturas de propiedades, literales, arrays y objetos literales cuyos nombres son imports de `shared/` o de un paquete (`valibot`, `zod`…). El generador copia la expresión, con esos imports, a un módulo de `.meeko/types/contract-schemas/` (`rpc.snapshots.list.output.ts`) del que sólo se lee el tipo: nunca se ejecuta ni llega al bundle.

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

Una expresión con otra cosa (una función como la de `v.transform`, un operador, una variable local o un argumento de tipo) se rechaza con el motivo: `output debe ser un schema importado de shared/ o una composición simple de ellos (…); esta expresión contiene una función`. Defina ese schema en `shared/`, expórtelo e impórtelo en el contrato. Los schemas de [WebSocket](framework-websocket.md#websocket) no admiten composiciones: el navegador importa cada uno para validar los mensajes, así que deben ser un export de `shared/`.

### Segmentos dinámicos en `api.*`

Cada carpeta o archivo de `server/api` es un nivel de `api.*`, y cada archivo aporta el método de su sufijo. Desde `1.2`, un segmento dinámico se llama con sus parámetros: `node({ nombre: valor })` devuelve el cliente de ese segmento, y los métodos que se alcanzan así ya no reciben `params`. `query`, `body` y `signal` siguen igual, y la URL se construye y se codifica como con `params`.

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

- La llamada recibe un objeto con el único parámetro de su segmento, como cadena: TypeScript rechaza que falte, una clave de más, un valor que no es texto y `params` en los métodos que siguen a la llamada. Un objeto sin el parámetro o con otro lanza un `TypeError` al llamar; un valor vacío, `.`, `..` o con `/` rechaza la petición igual que con `params`.
- Un nivel conserva sus métodos y sus hijos estáticos junto a la llamada: `api.menu.categories.get()` y `api.menu.categories({ id })` conviven. Si un nivel tiene varios segmentos dinámicos hijos (`users/[id].get.ts` y `users/[slug]/posts.get.ts`), el nombre del parámetro elige el segmento: `api.users({ id })` o `api.users({ slug }).posts.get()`.
- Un catch-all `[...path]` recibe, como en `params`, una cadena con los segmentos unidos por `/`: `api.files({ path: "docs/a b.txt" }).get()` pide `/api/files/docs/a%20b.txt`, con cada segmento codificado por separado.
- `useApi` no cambia: sigue recibiendo la ruta con corchetes y `params`, como `useApi("/api/menu/categories/[id]", { params: { id } })`.
- El editor completa la llamada, sus parámetros y los métodos del segmento, y el hover y "ir a la definición" de `api.menu.categories({ id }).archive.post` llevan al handler.

En `clientKey`, el segmento dinámico de `[id]` o `[...id]` se llama `byId`: `by` seguido del nombre del parámetro con la inicial en mayúscula. El cliente reconoce así el segmento al que corresponde cada parámetro, también en un cliente explícito de `createApiClient`. Por eso el manifiesto rechaza, con las rutas en conflicto, un segmento estático que se llame igual que el segmento dinámico de su nivel (`users/byId/` junto a `users/[id]`) o de su propia ruta (`[id]/byId.get.ts`), y dos parámetros cuyo nombre sólo cambia en la inicial (`[id]` y `[Id]`) en el mismo nivel o en la misma ruta.

La forma anterior, `api.menu.categories.byId.archive.post({ params: { id } })`, sigue funcionando durante toda la serie 1.x y se retirará en `2.0`. Está obsoleta desde `1.2`: el editor tacha cada método que se llama a través de `byId` y su hover indica el reemplazo; no hay aviso de consola. Sólo existe antes de la primera llamada de segmento: `api.orgs({ org }).users.byId` no existe.

### Errores de validación en formularios

Desde `1.2`, cuando `params`, `query`, `body` o el `input` de un RPC no superan su schema, la respuesta `400` (`INVALID_PARAMS`, `INVALID_QUERY`, `INVALID_BODY` o `INVALID_INPUT`) incluye `issues`: una lista de `{ path, message }` con, como mucho, 20 elementos. `path` son las claves de la ruta del issue de Standard Schema unidas con `.` (`"items.0.name"`), o `""` para la entrada completa; `message` es el mensaje del schema. Sólo viajan esos dos campos: nunca el valor recibido, lo esperado ni una traza. Los issues sin mensaje se omiten, y sin ninguno la respuesta no lleva `issues`. Un resultado del handler que no supera `response` u `output` sigue siendo `500` sin detalle, porque es un fallo del servidor.

```ts
// shared/schemas/auth.ts
import * as v from 'valibot'
export const loginInput = v.object({
	email: v.pipe(v.string(), v.email('Escribe un correo válido.')),
	password: v.pipe(v.string(), v.minLength(1, 'Escribe tu contraseña.')),
})
```

```json
{ "code": "INVALID_INPUT", "status": 400, "requestId": "…", "issues": [{ "path": "password", "message": "Escribe tu contraseña." }] }
```

En el cliente, `ClientError.issues` es esa lista de sólo lectura (tipo `ValidationIssue`), o `undefined` si la respuesta no la trae. Llega igual desde `api.*`, `rpc.*` y el `error` de `useApi`, `useRpcQuery` y `useRpcMutation`:

```ts
import { ClientError } from '@meekojs/meeko/framework'

const login = useRpcMutation('auth.login')
const fieldError = (path: string) => {
	const error = login.error.value
	return error instanceof ClientError ? error.issues?.find((issue) => issue.path === path)?.message : undefined
}
```

Escriba mensajes propios en el schema: algunos mensajes por defecto de Valibot citan el valor recibido.

`useForm` lleva estos `issues` a cada campo del formulario sin código propio (véase [Formularios: `useForm`](#formularios-useform)).

### Errores de un campo: `ApiError` con `issues`

Desde `1.5`, un error que no es de validación pero pertenece a un campo, como un correo que ya tiene cuenta, lleva `issues` con el tercer argumento de `ApiError`, que acepta `{ message, issues }` además del mensaje interno de siempre:

```ts
throw new ApiError('EMAIL_TAKEN', 409, {
	message: `duplicate key for ${body.email}`, // interno: nunca se envía
	issues: [{ path: 'email', message: 'Ese correo ya tiene una cuenta.' }],
})
```

```json
{ "code": "EMAIL_TAKEN", "status": 409, "requestId": "…", "issues": [{ "path": "email", "message": "Ese correo ya tiene una cuenta." }] }
```

- Los `issues` tienen la forma de los de un `400` (`{ path, message }`, con `path` unido con `.` o `""` para el formulario completo) y se envían igual: como mucho 20, en las respuestas de API y RPC, también en el despacho local SSR. Son mensajes públicos, escritos para el usuario; el `message` del error sigue siendo interno.
- Sólo viajan con un estado `4xx`: un `5xx` es un fallo del servidor y responde sin ellos. Un issue sin `path` o sin `message` de texto lanza un `TypeError` al crear el error.
- Un `ApiError` de otro grafo de módulos (Vite) conserva sus `issues` en la normalización. Otro error con la misma forma, como el `ApiError` de un SDK o un `ClientError` de otro servicio Meeko que el handler deja escapar, no envía sus `issues`: Meeko sólo reenvía los de su propio `ApiError`.
- En el cliente llegan en `ClientError.issues`, y `useForm` los reparte como los de un `400`.

### Valores por petición: `locals`

Desde `1.2`, `defineApiRoute` y `defineRpc` aceptan `locals(context)`, que calcula un valor por petición (por ejemplo, el usuario actual) y se lo entrega al handler como `locals`, con el tipo inferido de lo que devuelve. Sin `locals`, el handler recibe `locals: undefined`. `authorize` no cambia y sigue devolviendo un booleano.

El orden de cada petición es: Origin (desde `1.8`, en toda mutación salvo con `origin: "none"`), Origin y CSRF de la sesión, `rateLimit` (desde `1.2`), `auth`, `authorize`, validación de la entrada (`params`, `query` y `body`, o `input`), `locals`, handler y validación de la respuesta. Así, `locals` sólo se ejecuta con una entrada válida y una petición ya autorizada. Si lanza un `ApiError`, ese error es la respuesta (por ejemplo, `401` si el usuario de la sesión ya no existe o `403` si perdió el acceso); cualquier otro error es `500`.

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

Declare `locals` antes de `handler` en el objeto: si `locals` usa su parámetro, TypeScript sólo infiere su tipo para el handler cuando aparece antes. Con la sesión tipada mediante [`MeekoSession`](framework-auth.md#tipos-de-la-sesión-meekosession), `session.current!.data.userId` no necesita `as`.

### Estado de la respuesta: `status`

Desde `1.2`, `defineApiRoute` acepta `status` para elegir el estado de una respuesta correcta sin renunciar a JSON, a la validación con `response` ni al tipo del cliente generado:

| `status`            | Respuesta                                       | `api.*` resuelve       |
| ------------------- | ----------------------------------------------- | ---------------------- |
| `200` (por defecto) | JSON validado con `response`                    | el valor de `response` |
| `201`               | JSON validado con `response` (`201 Created`)    | el valor de `response` |
| `202`               | JSON validado con `response` (`202 Accepted`)   | el valor de `response` |
| `204`               | sin cuerpo ni `content-type` (`204 No Content`) | `undefined`            |

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

- `status` debe ser un literal (`status: 201`): el generador lo lee sin ejecutar el handler y rechaza otro valor. Una constante o una expresión no sirven.
- Con `204`, el handler no devuelve nada y no se declara `response`; devolver un valor responde `500` `INVALID_RESPONSE`. En el contrato generado la salida es `undefined`, así que `await api.orders({ id }).delete()` resuelve `undefined`, igual que `useApi`.
- `status` no se combina con `contentType: "response"`: ese handler ya devuelve su propio `Response` con el estado que quiera.
- Un `status` no admitido, combinado con `contentType: "response"` o un `204` con `response` responde `500` `INVALID_RESPONSE_STATUS` antes de leer la entrada, aunque el generador ya lo rechaza en `meeko routes`, `meeko check` y `meeko dev`.
- Los errores no cambian: siguen saliendo de `ApiError` con su propio estado.
- `generateOpenApi` documenta el estado declarado (`201 Created`, `202 Accepted` o `204 No Content`, este sin `content`).
- El estado es fijo por endpoint. Para elegirlo en cada petición (por ejemplo, `201` al crear y `200` al actualizar en un mismo `PUT`), use `contentType: "response"` o dos endpoints.
- RPC no tiene `status`: un procedimiento siempre responde `200` con su `output`.

### Formularios sin JavaScript: `form`

Desde `1.7`, un endpoint de API puede atender también un `<form method="post">` nativo, que funciona antes de que cargue el JavaScript o sin él. Se activa con `form`, y el formulario se valida con el **mismo schema** de `body` que el JSON:

```ts
// shared/schemas/feedback.ts
import * as v from 'valibot'
export const feedbackInput = v.object({
	page: v.pipe(v.string(), v.startsWith('/')),
	helpful: v.boolean('Elige sí o no.'),
	comment: v.optional(v.pipe(v.string(), v.maxLength(500, 'Usa como mucho 500 caracteres.')), ''),
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
	// O { redirect: (saved) => `/graciasíid=${saved.id}` }. `echo` devuelve tras un error el texto de esos campos.
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
		<p if:when="form.submitted.value">¡Gracias!</p>
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
			Sí
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

Con JavaScript, `form.submit` cancela el envío nativo y manda JSON con `submit`, como siempre. Sin él (o antes de hidratar), el navegador envía el formulario a `/api/feedback`, con el `name` y el `value` del botón pulsado, y vuelve a la página con el resultado ya pintado en el HTML del servidor: `helpful` llega como el texto `"true"` y el schema lo recibe como `true` (véase la conversión, más abajo). La misma definición sirve para los dos caminos: cada control necesita su `name`, el de su campo.

**Cuerpo.** Con `form`, el endpoint acepta `application/x-www-form-urlencoded` y `multipart/form-data` además de JSON. Sin `form`, esos tipos siguen respondiendo `415 UNSUPPORTED_MEDIA_TYPE`. El JSON no cambia y nunca se convierte. Cada `name` es una clave del objeto, que pasa por el schema de `body`:

- Un nombre repetido (`tag=a&tag=b`) o terminado en `[]` (`tags[]=a`) es una lista; con `[]` es una lista aunque llegue un solo valor, o ninguno con un `<input type="file">` vacío.
- Los campos llegan como texto. Si el schema rechaza el texto de algunos campos, Meeko lo vuelve a validar **una vez** con la lectura tipada de esos campos, y sólo de ellos: `""` es `undefined` (un campo vacío no se dio), `"true"` y `"on"` (una casilla marcada) son `true`, `"false"` es `false` y un número decimal (`"4"`, `"-1.5"`, `"2e3"`) es un `number`; en una lista, cada elemento, sin los vacíos. Un campo que el schema acepta como texto (`"42"` en un `v.string()`, un código postal `"01234"`) nunca se convierte. Así, `v.number()` y `v.boolean()` funcionan sin escribir conversiones; las conversiones del propio schema (`v.pipe(v.string(), v.toNumber())`) también. Un schema asíncrono (`v.pipeAsync`, `v.checkAsync`, que puede consultar la base de datos) se ejecuta **una sola vez**, sin segundo intento: sus campos numéricos o booleanos deben convertir el texto en el propio schema (`v.pipe(v.string(), v.toNumber())`).
- Una casilla sin marcar no envía nada: declárela con un valor por defecto, `v.optional(v.boolean(), false)`, y una lista de casillas con `v.optional(v.array(v.string()), [])`.
- Si un campo convertido sigue sin superar el schema, su mensaje es el de su texto, el que escribió el usuario.
- `return` y `_csrf` son campos reservados: nunca llegan al schema.
- Los objetos anidados no se construyen: `address.city` es una clave con un punto.

**Respuesta.** Un envío correcto (tras validar `response`) responde `303 See Other` a la ruta que devuelve `form.redirect(result, context)` o, sin ella, a la del campo `return`, a la página de `Referer` si es de este sitio, o a `/`. `result` es la respuesta validada, `undefined` con `status: 204` o el `Response` del handler con `contentType: "response"` (sin `redirect`, ese `Response` es la respuesta). La ruta debe ser de esta aplicación: un valor con `//`, `\`, un esquema (`javascript:`, `https://otro.example`), caracteres de control o segmentos de punto que dejarían `//` al principio se sustituye por `/`, con las mismas comprobaciones que [`POST /_meeko/theme`](framework-rendering.md#tema-clarooscuro-sin-parpadeo); una URL absoluta de este mismo origen vale como su ruta. La ruta vale igual con la `/` sin codificar (`return=/contacto`, como la envía `curl -d`) o codificada (`return=%2Fcontacto`, como la envía el navegador), en `x-www-form-urlencoded` y en `multipart/form-data`. Al probarlo con `curl` desde Git Bash en Windows, MSYS convierte el argumento `return=/contacto` en `return=C:/Program Files/Git/contacto` antes de enviarlo, y esa ruta vuelve a `/`; usa `return=%2Fcontacto` o `MSYS_NO_PATHCONV=1`.

Un error (de validación, un `ApiError` del handler o de `locals`, `401`, `403 FORBIDDEN`, `429`, `413` o un `500`) también responde `303`, de vuelta al campo `return`, a `Referer` o a `/`, nunca con el JSON del error. En los dos casos, la respuesta deja una cookie de un solo uso, `__Host-meeko-form` (`meeko-form` sin HTTPS), `HttpOnly`, `SameSite=Lax`, de 60 segundos, con el resultado: el código, el estado, los `issues` (como mucho 20, como en un `400`) y, sólo en los campos que lista `form.echo`, los valores enviados. Por defecto ningún valor vuelve: el formulario muestra los mensajes y sus campos parten de `initial`. Los valores viajan en la cookie y en el HTML de la página, así que `echo` no debe incluir contraseñas, números de tarjeta, PIN, IBAN ni otros datos sensibles; aun así, un campo cuyo nombre contiene `password`, `passcode`, `secret`, `token`, `cvc` o `cvv` nunca vuelve, y los archivos tampoco. Si no cabe en la cookie, primero se quitan los valores y después los últimos `issues`.

**La página.** El `GET` de esa página lee la cookie, la borra en la misma respuesta (`Max-Age=0`, `cache-control: no-store`) y renderiza la página aunque esté prerenderizada. Un `useForm` con `action` igual a la ruta del endpoint toma el resultado durante el SSR, igual que tras un envío con JavaScript: los valores de `form.echo` en sus campos, `errors` y `error` repartidos por los `issues`, `failure` con un `ClientError` del código y el estado (y `error` con `errorMessage(failure)` si no hay `issues`) o `submitted` en `true` tras un envío correcto. El resultado viaja en el estado de la página, así que la hidratación pinta lo mismo, y el navegador lo usa una sola vez: al volver a montar el formulario, empieza de `initial`. Un campo con un mensaje del servidor lo pierde al cambiar, como tras un envío con JavaScript. Un campo que sigue con error vuelve como texto, tal como se escribió.

Por qué una cookie: una query firmada dejaría los valores, a veces personales, en la barra de direcciones, el historial, los logs y el `Referer`, y necesitaría un secreto compartido entre instancias; guardar el resultado en el store de sesiones crearía una sesión para cada visitante anónimo. Una cookie `HttpOnly` de un solo uso no deja rastro en la URL, no necesita estado en el servidor, funciona con varias instancias y, con el prefijo `__Host-`, ningún subdominio puede plantarla. Su contenido sólo se pinta como texto escapado, y no se firma: quien puede escribir esa cookie (el propio navegador del usuario) sólo puede cambiar lo que él mismo ve.

**Seguridad.**

- Un formulario no necesita _preflight_, así que cualquier sitio puede enviar uno. Por eso todo envío nativo exige un `Origin` permitido (el de la aplicación o uno de `SessionManager.allowedOrigins`), como cualquier mutación desde `1.8`: sin él responde `403 INVALID_ORIGIN` antes de leer el cuerpo. Desde `1.8`, `origin: "none"` lo exime sólo sin sesión, para un webhook que envía `application/x-www-form-urlencoded` sin `Origin`; con sesión, el envío sigue necesitando `Origin` y `_csrf`. Los navegadores envían `Origin` en cada `POST`; una página servida con `Referrer-Policy: no-referrer` lo envía como `null` y no puede usar formularios nativos.
- Con una sesión, el token CSRF que JavaScript envía en `x-meeko-csrf` llega en el campo oculto `_csrf`: `form.csrfToken` lo da en el SSR y en el navegador. Sin él, `403 INVALID_CSRF`. Estos dos `403` responden con el JSON de error y sin `303`: la petición no es de este sitio. Lo demás (`auth`, `authorize`, `rateLimit`, `locals`) funciona igual que con JSON, salvo el orden de `rateLimit`: desde `1.7`, en un envío nativo se cuenta tras `Origin` y **antes de leer el cuerpo**, así que un aluvión de envíos se corta sin analizar cada uno; el token CSRF va en el cuerpo, de modo que un envío con un token no válido también cuenta. Un `429` vuelve a `Referer` o a `/`, porque el campo `return` está en el cuerpo sin leer.
- El cuerpo tiene el límite de 1 MiB del JSON, que `form.maxBytes` cambia; por encima, `BODY_TOO_LARGE`.
- Un `multipart/form-data` no admite archivos salvo con `form.files: true`: llegan al schema de `body` como `File` (por ejemplo, `v.instance(File)` o `v.file()`), y un archivo en un endpoint sin `files` es `400 FILES_NOT_ALLOWED`. Un `<input type="file">` vacío no cuenta. Suba `maxBytes` según el tamaño que acepte.

**Límites.**

- Lo atiende `dispatchApiRoute`, es decir, `createServerApp` y todos los adaptadores de Meeko. `executeApiRoute` sigue aceptando sólo JSON, y un host que renderiza las páginas con `createFrameworkHandler` no lee la cookie.
- Una caché compartida delante del servidor (un CDN) debe dejar pasar las peticiones con la cookie `meeko-form` (o respetar `Vary: Cookie`): si sirve una copia, el formulario no muestra el resultado.
- Una página `render: "prerender"` se renderiza en el build, sin sesión, así que su HTML no lleva el token CSRF y `form.csrfToken` está vacío hasta que hidrata. Con JavaScript no importa (el envío lleva el token en `x-meeko-csrf`), pero un usuario con sesión que envía el formulario nativo sin JavaScript recibe `403 INVALID_CSRF`. Si el formulario es para usuarios con sesión, use `render: "ssr"` (con `cache` si la página es costosa: una petición con sesión nunca usa la copia y lleva su token).
- `generateOpenApi` describe el cuerpo JSON, no el de formulario.

### Datos en componentes: `useApi`, `useRpcQuery` y `useRpcMutation`

Desde `1.1`, un componente puede pedir sus propios datos con composables autoimportados desde los clientes generados. Usan los mismos contratos, tipos, sesión y CSRF que `api.*` y `rpc.*`:

| Composable                                              | Uso                                                                     | Devuelve                                                    |
| ------------------------------------------------------- | ----------------------------------------------------------------------- | ----------------------------------------------------------- |
| `useApi(ruta, opciones?, recarga?)`                     | Lectura de un endpoint `GET`                                            | `{ data, error, pending, refreshing, refresh }`             |
| `useRpcQuery(procedimiento, input, recarga?)`           | Lectura mediante un procedimiento RPC                                   | `{ data, error, pending, refreshing, refresh }`             |
| `useRpcMutation(procedimiento, opciones?)`              | Escritura bajo demanda mediante RPC                                     | `{ mutate(input), data, error, pending }`                   |
| `useApiMutation(ruta, método, opciones?)` (desde `1.2`) | Escritura bajo demanda en un endpoint `POST`, `PUT`, `PATCH` o `DELETE` | `{ mutate({ params, query, body }), data, error, pending }` |

`ruta` es la ruta del endpoint tal como la describe `server/api`, con los segmentos dinámicos entre corchetes: `"/api/users"` o `"/api/users/[id]"`. Sólo se admiten endpoints `GET`. `procedimiento` es el ID del procedimiento con puntos: `server/rpc/users/get.ts` es `"users.get"`. El editor completa rutas y procedimientos, y TypeScript comprueba `params`, `query` e `input` contra el contrato. `data`, `error` y `pending` son señales de sólo lectura; `error` es un `Error` o `null`.

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
	<p>{activity.data.value.length} eventos</p>
</template>
```

#### Con y sin `await`

- **Con `await`.** El componente no se renderiza hasta tener los datos, también en SSR, y `data` deja de ser nulo en su tipo. Un fallo de la petición se trata como un fallo de la página.
- **Sin `await`.** El componente se renderiza enseguida con `pending` en `true` y `data` en `null`. La petición no se ejecuta en SSR: empieza en el navegador cuando el componente se monta. Es el patrón para mostrar un indicador de carga:

```html
<script lang="ts">
	const users = useApi('/api/users')
</script>
<template>
	<p if:when="users.pending.value">Cargando…</p>
	<p if:when="users.error.value">No se pudieron cargar los usuarios.</p>
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

Las opciones de `useApi` y el `input` de `useRpcQuery` pueden contener señales en sus campos, o ser una función que las lee. Cuando el componente ya está montado en el navegador, un cambio de esas señales vuelve a pedir los datos y actualiza `data`, `pending` y `error`; una petición anterior que sigue en curso se cancela. `refresh()` vuelve a pedir los datos con la entrada actual. Mientras llegan los datos nuevos, `data` conserva los anteriores (véase [Datos anteriores durante una recarga](#datos-anteriores-durante-una-recarga-keepprevious)). Un fallo de una recarga o de `refresh()` sólo actualiza `error`: no muestra la página de error.

Las opciones son opcionales cuando el contrato no exige nada. `useApi(ruta)` admite omitirlas si el endpoint no tiene `params` y su `query` no existe o sólo tiene campos opcionales. `useRpcQuery(procedimiento)` admite omitir el `input` si el schema acepta `{}`, y entonces envía `{}`. Lo mismo vale para los clientes generados: `api.users.get()` se llama sin argumentos cuando el endpoint no tiene `params`, ni `query` obligatoria, ni cuerpo. La firma de `rpc.x(input)` no cambia.

```ts
const stats = await useRpcQuery('stats.summary') // input opcional: envía {}
const users = await useApi('/api/users') // query opcional
const page = await api.users.get({ query: { page: '2' } }) // la query sigue disponible
```

#### SSR e hidratación

En SSR, el servidor renderiza la página y sus layouts, registra las peticiones de cada `await` de datos, las espera y vuelve a renderizar con los datos, hasta que ninguna pasada se suspende. Las pasadas descartadas se liberan, con su estado y sus efectos, y cada una parte del estado que dejó el loader. Las peticiones se despachan localmente por el mismo pipeline que `api.*` y `rpc.*` en SSR, así que conservan la sesión y el contexto de la petición. En una ruta `render: "stream"` se resuelven antes del primer byte, como el loader crítico. `head` se calcula con los datos del loader o del código de nivel superior de `<script server>`, no con los de estos composables: si el `<title>` depende de un dato, cárguelo allí.

Los datos resueltos viajan en el campo `resources` del payload, por clave de petición (método o procedimiento y entrada). Al hidratar, el navegador los lee de ahí de forma síncrona y no repite la petición. La entrada de un `await` de datos debe depender sólo de props, datos de la ruta y estado: si el navegador pide una clave que el servidor no cargó, la hidratación falla con un error `MEEKO_RESOURCE_MISSING` que nombra la petición. Un componente que en cada pasada pide datos nuevos detiene el render tras 10 pasadas con un error.

#### Navegación y `render: "client"`

Antes de confirmar una navegación, el navegador renderiza la página nueva sin mostrarla para descubrir y cargar sus `await` de datos. Mientras tanto la página anterior sigue visible y `useNavigation().pending` vale `true`. Si la navegación pidió el payload al servidor, los datos que este ya resolvió llegan en `resources` y no se piden otra vez. Un fallo muestra el `+error.meeko` más cercano, o `app/error.meeko`, dentro de los layouts, como un fallo del loader. Las rutas `render: "client"` usan el mismo mecanismo, entero en el navegador. En SSR, un fallo de un `await` de datos también muestra la página de error, con el mismo mensaje público que un fallo del loader.

Ese render previo es una pasada en seco. El setup de la página nueva y de los layouts que no se conservan se ejecuta, con un estado provisional que después se descarta, pero:

- ningún `effect` se ejecuta (`computed` sí calcula su valor);
- `onMounted` no se ejecuta y la continuación tras un `await` de navegador no empieza;
- `useSocket` y `socket.x` devuelven un cliente que no conecta.

Lo que se repite es el propio código del nivel superior del setup: una petición con `api.*`, una escritura externa o un contador que se incrementa ahí se ejecutan una vez más por navegación. Llévelos a `onMounted` o a un handler.

La pasada se salta si ningún componente del árbol nuevo puede esperar datos. El compilador marca cada módulo con dos datos estáticos: si su script tiene un `await` de datos y qué componentes pinta su plantilla. El navegador recorre esas marcas desde la página y los layouts nuevos y, si ninguno espera datos, confirma la navegación sin pasada previa; el setup se ejecuta entonces una sola vez. Cuentan como que pueden esperar datos un componente elegido en tiempo de ejecución (`<component is>` con una variable del setup, un elemento de `each:` o un parámetro de un snippet) y un módulo sin marcas (escrito a mano o compilado por una versión anterior). El outlet de un layout (`<component is="props.outlet">`) no se recorre, porque el navegador ya comprueba la página. Límite: un componente que no es un layout y pinta con `<component is="props.outlet">` un componente recibido en una prop llamada `outlet` tampoco se recorre; si ese componente espera datos, no se carga antes de confirmar la navegación y se monta tarde, como se describe a continuación, sin error.

#### Componentes que se montan más tarde

Un componente que aparece después de hidratar o confirmar la página (cuando un `if:` pasa a ser verdadero, en una fila nueva de `each:`, al cambiar el componente de `<component is>` o al recibir props nuevas: un componente con un `await` de datos en el nivel superior se vuelve a montar con ellas, en lugar de actualizarlas en su sitio como los demás; véase [Props reactivas](api.md#props-reactivas)) reutiliza los datos que la aplicación ya cargó. Si hace un `await` de datos que no están en caché:

- Su zona queda vacía, sin error, mientras los datos se cargan.
- La carga usa pasadas en seco bajo la raíz del componente que lo contiene, con su mismo contexto (`inject`), sin efectos, sin `onMounted` y sin conexiones de socket.
- Cuando terminan, el componente se renderiza, se hidrata y ejecuta su `onMounted`. Los datos quedan en la caché de la aplicación para los montajes siguientes.
- Si el componente se libera antes (el `if:` vuelve a ser falso o la fila desaparece), la petición se aborta y no se pinta nada, ni se ejecuta `onMounted`, ni se informa un error.
- Si la petición falla, la zona queda vacía y el error llega, con la fuente `"mounted"`, al `provideErrorHandler` más cercano o, si no hay ninguno, al `onError` de `mountClientApp`.

Para mostrar un indicador mientras tanto, use el composable sin `await` y lea `pending`, como en el ejemplo anterior, o envuelva la zona en [`<MeekoAwait>`](#meekoawait), que además puede reservar su altura. El error `MEEKO_SUSPENDED` sólo aparece al llamar a `renderToString` o `renderWithState` de un componente con un `await` de datos fuera del framework (véase [api.md](api.md#módulo-generado)).

#### Datos anteriores durante una recarga: `keepPrevious`

Desde `1.1`, una recarga no vacía `data`: tanto `refresh()` como un cambio de las señales de la entrada ponen `pending` en `true` y dejan los datos anteriores hasta que llegan los nuevos, que los sustituyen en la misma actualización que `pending` vuelve a `false`. Una lista no desaparece mientras se recarga. Desde `1.5`:

- **`refreshing`.** Es `true` mientras hay una recarga y `data` conserva una carga anterior. La primera carga es `pending` sin `refreshing`. Sirve para un indicador discreto (atenuar la lista, un icono girando) sin ocultar los datos.
- **`keepPrevious`.** El último argumento de `useApi` y `useRpcQuery` acepta `{ keepPrevious }` (y, desde `1.7`, [`debounceMs` y `enabled`](#búsqueda-mientras-se-escribe-debouncems-y-enabled)). Por defecto vale `true`, el comportamiento de siempre. Con `false`, un cambio de la entrada vacía `data` y `error` y vuelve a ser una primera carga: sirve cuando mostrar los datos de otra entrada confundiría (la ficha de otro usuario mientras llega la nueva). `refresh()` conserva siempre los datos, porque son de la misma entrada, y un recurso esperado con `await`, cuyo `data` nunca es `null`, también.

```html
<script lang="ts">
	const props = defineProps<{ params: { id: string }; search: Record<string, string | string[]> }>()
	const page = signal('1')
	// Por defecto: la página anterior sigue en pantalla mientras llega la siguiente.
	const orders = useApi('/api/orders', { query: { page } })
	// Otro usuario: mejor el esqueleto que la ficha del anterior.
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

| Situación            | `data`                                          | `pending` | `refreshing`                                |
| -------------------- | ----------------------------------------------- | --------- | ------------------------------------------- |
| Primera carga        | `null`                                          | `true`    | `false`                                     |
| `refresh()`          | La anterior                                     | `true`    | `true`                                      |
| Cambio de la entrada | La anterior (con `keepPrevious: false`, `null`) | `true`    | `true` (con `keepPrevious: false`, `false`) |
| Recarga fallida      | La anterior; `error` dice por qué               | `false`   | `false`                                     |

`<MeekoAwait>` se apoya en este comportamiento: durante una recarga sigue mostrando su contenido y marca la zona con `data-meeko-refreshing` y `aria-busy`.

#### Búsqueda mientras se escribe: `debounceMs` y `enabled`

Desde `1.7`, las opciones del último argumento de `useApi` y `useRpcQuery` incluyen `debounceMs` y `enabled`, para una búsqueda que consulta mientras se escribe sin una petición por tecla:

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

- **`debounceMs`.** Milisegundos que la entrada debe quedarse quieta antes de pedir los datos: una ráfaga de cambios hace una sola petición, con la última entrada. Cada cambio cancela la petición en curso, cuyo resultado, si aún llega, se descarta. Durante la espera `pending` ya vale `true` (y `refreshing`, si hay datos) y `data` conserva el resultado anterior; con `keepPrevious: false` se vacía en el primer cambio. No retrasa la primera carga del navegador ni `refresh()`. Por defecto, `0`: cada cambio pide enseguida, como hasta `1.6`.
- **`enabled`.** Un booleano, una señal o una función que lee señales. Mientras vale `false` no hay petición, ni al montar ni con `refresh()` (que resuelve sin hacer nada); la que estaba en curso se cancela, `pending` y `refreshing` valen `false` y `data` conserva el último resultado, o `null` si no lo hubo (`error` tampoco cambia). Al volver a `true` se piden los datos de la entrada actual (con `debounceMs`, tras la espera), salvo que `data` ya sea de esa entrada. Un cambio de `enabled` cuenta como un cambio de la entrada.
- **SSR.** Las dos opciones sólo actúan en el navegador. Un recurso con `await` se pide enseguida en el SSR, sin espera, y sus datos viajan en el payload para hidratar, como siempre. Un recurso con `await` que empieza con `enabled` en `false` no puede tener sus datos: falla con un error que lo dice, en el servidor y en el navegador. Sin `await`, la petición nunca se hace en el SSR, y un recurso desactivado se renderiza con `pending` en `false`.

#### `<MeekoAwait>`

Desde `1.5`, `<MeekoAwait>` es una etiqueta propia de Meeko, como `<MeekoLink>`: no se importa y el compilador la convierte en un componente que Meeko compila y distribuye. Envuelve la zona de unos datos que llegan después del primer pintado, el resultado de `useApi` o `useRpcQuery` sin `await`:

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
					No se pudo cargar.
					<button on:click="retry">Reintentar</button>
				</p>
			</snippet>
			<ItemsList bind:items="items.data.value" />
		</MeekoAwait>
	</section>
</template>
```

- **`for`.** El recurso, como expresión (igual que `each:of`; también vale `bind:for`), o una lista: `for="[items, stats]"`. Falta o vacío es el error `MEEK116`; algo que no es un recurso, un error de tipos en `meeko check` y en el editor, y un `TypeError` al renderizar. Vale cualquier objeto con `data`, `error`, `pending` y `refresh` (el tipo `AwaitResource`).
- **Estados.** El contenido de la etiqueta (`default`) se pinta cuando todos los recursos tienen datos. El snippet `pending`, en la primera carga: mientras un recurso no tiene datos y carga (o aún no empezó; sin `await` la petición empieza al montar). El snippet `error`, cuando un recurso sin datos falló: recibe el error y `retry`, que vuelve a pedir los recursos que fallaron y pasa otra vez por `pending`. Sin snippet `error`, pinta `<p role="alert">` con «No se pudieron cargar los datos.» y un botón «Reintentar» (tradúzcalos con `bind:messages="{ error, retry }"`). Un fallo de un recurso gana a otro que todavía carga, para ofrecer `retry` cuanto antes.
- **Recargas.** Una recarga con datos (`refresh()`, un cambio de la entrada) no vuelve a `pending`: el contenido sigue montado, con su DOM, su foco y su estado, y el snippet `default` recibe `refreshing` (`<snippet name="default" params="refreshing">`) para un indicador discreto. Una recarga fallida conserva el contenido; `items.error.value` dice por qué. Con `keepPrevious: false`, un cambio de la entrada vacía los datos y la zona vuelve a `pending`.
- **Tipos.** Dentro del contenido, `meeko check` y el editor leen `items.data.value` como cargado: no hace falta `!` ni `?.`, como dentro de `if:when="items.data.value"`. Vale para cada recurso de `for` escrito como nombre (`items`, `page.items`); con otra expresión, el contenido usa el tipo de siempre. `pending` y `error` no se estrechan. Las props son `MeekoAwaitProps` y los snippets, `MeekoAwaitSnippets`, de `@meekojs/meeko/framework`; `MeekoAwaitProps` se autoimporta como `MeekoLinkProps`.
- **Marcado.** Un `<div>` con `class` e `id` si se pasan, que nunca cambia de elemento, y con `data-meeko-await="pending|error|ready"`, `aria-busy="true"` mientras carga o recarga, `data-meeko-refreshing` durante una recarga y, con `reserve`, `data-meeko-reserve` y `data-meeko-reserve-min`. No trae estilos.
- **Accesibilidad.** `aria-busy` avisa a los lectores de pantalla de que la zona carga. El error se anuncia con `role="alert"`: el aviso por defecto lo lleva; póngalo también en su snippet `error`. Si el foco estaba dentro de un nodo que desaparece al cambiar de estado (el botón «Reintentar», un esqueleto enfocable), pasa a la zona (`tabindex="-1"`, sin desplazar la página) en lugar de perderse en `<body>`; al llegar los datos sigue ahí.
- **SSR.** Sin `await`, la petición no se hace en el servidor: el HTML lleva el snippet `pending` y `aria-busy`, y la hidratación no cambia nada hasta que llegan los datos. Si el recurso ya tiene datos en el servidor (un `await useApi`, que también vale en `for`), el HTML lleva el contenido.
- **Nombre propio.** Un componente del proyecto llamado `MeekoAwait` tiene prioridad sobre la etiqueta de Meeko, con el aviso `MEEK106`.

##### Reservar la altura: `reserve`

Con `reserve`, mientras la zona espera ocupa la altura que tuvo con datos la última vez:

- **Memoria.** Al mostrar datos, un `ResizeObserver` mide la zona (después del layout, sin bloquear el render) y guarda su altura en `sessionStorage` (`meeko:await`) y en memoria, bajo una clave que combina la ruta, la clave de la petición (la del payload: método o procedimiento y entrada) y el orden de la zona entre las de la misma petición en la página. Guarda las 100 zonas más recientes. Si el navegador bloquea `sessionStorage` (modo privado, un sandbox), la memoria vive mientras la página está abierta.
- **Aplicación.** Mientras la zona está en `pending`, una regla CSS le da `min-block-size` con la altura recordada. La regla vive en una hoja de estilos construida (`adoptedStyleSheets`) y la zona la recibe por sus atributos: no hay `style="…"` en el HTML, así que funciona con una CSP estricta sin `'unsafe-inline'` en `style-src`. Con datos, la zona vuelve a su altura natural.
- **Mínimo explícito.** `reserve="320px"` (cualquier longitud CSS: `px`, `rem`, `vh`…) fija además un mínimo, también en la primera visita, y la memoria nunca reserva menos. Su regla va en un `<style>` de `<head>` con el nonce de la petición o, en un sitio estático, permitido por su hash (`inlineStyleHashes`). Otra cosa es un `TypeError`.
- **Reactivo.** Con `bind:reserve` (por ejemplo, `bind:reserve="compact.value ? false : '320px'"`), activarlo, quitarlo o cambiar el mínimo en el navegador añade o quita el script y las reglas de `<head>` y empieza o deja de medir la zona.

Qué pasa en cada caso:

| Situación                                                                         | Primer pintado                                                                                                                                          | Al llegar los datos                                                                                                        |
| --------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------- |
| Primera visita de la pestaña (sin memoria)                                        | El esqueleto, con su altura natural (o el mínimo de `reserve="320px"`)                                                                                  | La zona crece una vez hasta el contenido: el mismo salto que sin `reserve`, que sólo evita un esqueleto de la misma altura |
| Carga completa de una página ya visitada en la pestaña (recarga, abrir un enlace) | El esqueleto con la altura recordada: un script en línea de `<head>`, que se ejecuta antes del primer pintado, lee `sessionStorage` y adopta las reglas | Sin salto si el contenido mide lo mismo                                                                                    |
| Navegación en el cliente a una página ya visitada                                 | La zona se inserta con la altura recordada: el componente adopta las reglas antes de insertarla                                                         | Sin salto                                                                                                                  |
| Zona que se monta más tarde (un `if:`, una pestaña)                               | Igual que la navegación                                                                                                                                 | Sin salto                                                                                                                  |
| Recarga de datos                                                                  | El contenido sigue en pantalla                                                                                                                          | Sin salto, salvo que el contenido nuevo mida distinto                                                                      |

El script de `<head>` es siempre el mismo texto, así que tiene un único hash para la CSP; lleva el nonce de la petición y un sitio estático lo permite con los hashes de `inlineScriptHashes`. Sólo toca el CSSOM, nunca el DOM, así que la hidratación encuentra el HTML del servidor. Meeko lo añade sólo a las páginas con `<MeekoAwait reserve>` (con `useHead`, en una ruta `render: "stream"` también en el primer envío). Sin hojas de estilos construidas (navegadores anteriores a 2023) la zona usa su altura natural.

La altura depende del ancho: si la ventana cambia mucho entre visitas, la memoria se ajusta en la siguiente medida. Dos zonas con la misma petición en la misma página tienen claves distintas por su orden; si el orden cambia entre visitas, intercambian sus alturas.

##### Una transición opcional

`<MeekoAwait>` no anima nada. Si quiere suavizar el cambio de altura cuando la zona deja la reserva, en los navegadores con [`interpolate-size`](https://developer.mozilla.org/docs/Web/CSS/interpolate-size):

```css
@media (prefers-reduced-motion: no-preference) {
	[data-meeko-await] {
		interpolate-size: allow-keywords;
		transition: min-block-size 200ms ease-out;
	}
}
```

Una transición de tamaño mueve lo que viene después en cada fotograma y el navegador lo cuenta como salto (CLS): suaviza la percepción, no la métrica. Para la métrica, lo que cuenta es que la altura reservada coincida con la del contenido.

#### Evitar saltos de altura (CLS)

Una card cuyos datos llegan después del primer pintado sale vacía en el HTML y crece al llegar la lista, empujando lo que viene después: un salto de diseño, que Core Web Vitals mide como CLS. En orden de preferencia:

1. **`await` en la carga inicial.** Con `await useApi(...)`, el SSR espera los datos y pinta la lista: no hay nada que crezca. Es la recomendación para lo que se ve al cargar la página.

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

2. **`<MeekoAwait reserve>`.** Para lo que no puede esperar el SSR: datos secundarios, zonas fuera de pantalla, componentes que se montan más tarde o datos que cambian con la interacción. Desde la segunda visita de la pestaña la zona sale con su altura (véase [Reservar la altura](#reservar-la-altura-reserve)).

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

3. **Esqueletos de la misma altura.** El snippet `pending` con las mismas filas y alturas que el contenido evita también el salto de la primera visita. Si la lista tiene un tamaño conocido (una página de 20), dé al esqueleto ese tamaño; si no, `reserve="320px"` fija un mínimo razonable.
4. **`keepPrevious`.** Por defecto, `refresh()` y un cambio de la entrada conservan la lista anterior hasta que llega la nueva: no la vacíe a mano antes de recargar (véase [Datos anteriores durante una recarga](#datos-anteriores-durante-una-recarga-keepprevious)).
5. **`content-visibility` y `contain-intrinsic-size`.** Para secciones largas fuera de pantalla, `content-visibility: auto` con `contain-intrinsic-size: auto 320px` reserva un tamaño y el navegador recuerda el último que pintó (`auto`). Es CSS de la aplicación; combina bien con `<MeekoAwait>`.
6. **`interpolate-size`.** Una transición suaviza el cambio, pero no lo quita de la métrica (véase [Una transición opcional](#una-transición-opcional)).

`meeko check`, `meeko build` y el editor avisan con `MEEK117` de una página o un layout que pinta en un `each:of` los datos de un `useApi` o un `useRpcQuery` sin `await` sin ocuparse de su carga. Es una pista, nunca un error: desaparece al esperar los datos con `await`, envolver la lista en `<MeekoAwait>`, leer `pending` o `refreshing` del recurso (un esqueleto con `if:when="items.pending.value"`), poner la lista bajo un `if:when` que lea sus datos o pasar el recurso entero a otro componente (`bind:items="items"`), que puede ocuparse de su carga.

#### Mutaciones

`useRpcMutation(procedimiento)` no hace ninguna petición hasta que se llama `mutate(input)`, nunca en SSR. `mutate` envía el token CSRF como `rpc.*`, actualiza `pending`, `data` y `error` y devuelve la salida del procedimiento, o rechaza con su error. No se puede esperar con `await` en el nivel superior (`MEEK055`): espere `mutate` dentro de un handler.

Desde `1.2`, cada envío empieza con `pending` en `true` y `error` en `null` en una sola actualización, y termina escribiendo a la vez `data` o `error` y `pending` en `false`: un `effect` que lee varias de esas señales nunca ve una mezcla del intento anterior y del nuevo. Las opciones `onSuccess(output, intento)` y `onError(error, intento)` se llaman después, con el estado ya actualizado, una vez por intento (véase [Avisos de cada intento](#avisos-de-cada-intento-onsuccess-y-onerror)).

Desde `1.2`, `useApiMutation(ruta, método)` hace lo mismo con un endpoint de API que no es `GET`. `ruta` se escribe como en `useApi` (`"/api/notes/[id]"`) y `método` es `"POST"`, `"PUT"`, `"PATCH"` o `"DELETE"`; TypeScript sólo acepta los métodos que existen para esa ruta. `mutate({ params, query, body })` recibe la entrada de la operación, comprobada contra el contrato, y se puede llamar sin argumentos si la operación no exige nada. Un endpoint `204` resuelve con `undefined`.

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
	<p if:when="save.error.value">No se pudo guardar.</p>
	<button
		bind:disabled="remove.pending.value"
		on:click="() => remove.mutate({ params: { id: props.params.id } })"
	>
		Borrar
	</button>
</template>
```

Igual que `useRpcMutation`, se llama mientras se ejecuta el script del componente (en su nivel superior) y `await useApiMutation(...)` da `MEEK055`. Un export propio de la aplicación llamado `useApiMutation` tiene prioridad sobre el autoimport.

#### Mutaciones seguras ante reintentos

Una escritura que se queda sin respuesta (se cae la red, el servidor responde `5xx` o el proceso muere) puede haberse aplicado o no. Reintentarla a ciegas puede cobrar dos veces; descartarla puede perder una venta. Desde `1.2`, `useRpcMutation` y `useApiMutation` aceptan la opción `retrySafe`, que resuelve ese caso en el cliente y deja la deduplicación al servidor:

```ts
const charge = useRpcMutation('sales.checkout', { retrySafe: { key: 'pos:sale' } })
const step = useApiMutation('/api/kitchen/items/[id]/steps', 'POST', { retrySafe: { key: 'kitchen:step', storage: 'session' } })
```

- **Intención con clave.** `mutate(input)` crea un UUID nuevo (la clave de idempotencia), guarda la intención (la entrada, la clave y la hora) en el almacenamiento del navegador bajo `retrySafe.key` y después la envía con la cabecera `Idempotency-Key: "<uuid>"`, con el formato de cadena de Structured Fields que define el borrador del IETF. Si la página se cierra a mitad de la petición, la intención sigue guardada.
- **Sin respuesta.** Un fallo de red, un `5xx`, un `408` o un `429` conservan la intención: `mutate` rechaza con el error, `error` lo refleja y `charge.uncertain.value` muestra la intención (`{ idempotencyKey, input, startedAt }`). Se reintenta con la **misma** clave cuando el navegador vuelve a estar en línea (evento `online`), cuando se monta un componente que usa la mutación (también después de recargar) y al llamar a `charge.retry()`. Mientras se reintenta, `uncertain` conserva su valor, `pending` vale `true` y `error` vuelve a `null`.
- **Con respuesta.** Un `2xx` borra la intención y `mutate` o `retry()` resuelven con la salida. Cualquier otro `4xx` también la borra: el servidor contestó, así que no hay nada que reintentar; el `ClientError` llega a `error` y rechaza la promesa. `uncertain` vuelve a `null` en la misma actualización que escribe `data` o `error` y pone `pending` en `false`, también en los demás componentes que usan la misma clave: un `effect` que mira `uncertain` lee ya el resultado de ese intento, nunca un `error` anterior.
- **Una intención a la vez.** Mientras haya una intención incierta bajo esa clave, `mutate` rechaza con un error `MUTATION_UNCERTAIN` sin enviar nada. La aplicación decide: `retry()` la reintenta, `discard()` la olvida sin enviarla (pida antes confirmación al usuario, porque pudo registrarse) y vacía `error`, que describía el fallo de esa intención.
- **Nunca en SSR ni en seco.** El servidor nunca la envía ni la lee, y las pasadas en seco de una navegación tampoco: sólo la reintenta el componente ya montado.
- **Almacenamiento.** `storage: "local"` (por defecto) sobrevive a recargas y a cerrar el navegador; `"session"`, sólo a recargas de esa pestaña. Si el navegador bloquea el almacenamiento, la intención vive en memoria y se reintenta mientras la página siga abierta. La intención usa [`useStorage`](#estado-persistente-usestorage) por dentro, así que otra pestaña la ve llegar por el evento `storage`; si dos pestañas la reintentan a la vez, el servidor recibe la misma clave dos veces y responde lo mismo.

Use una clave de almacenamiento por mutación, que incluya lo que la distinga entre usuarios o cuentas que comparten el navegador (`` `pos:sale:${restaurant.slug}` ``). Una intención que guardó otra mutación bajo la misma clave nunca se envía a este endpoint. La entrada se guarda y se reenvía tal como viaja, en JSON.

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
			// Sin respuesta: queda en verificación y se reintentará con la misma clave.
			if (!charge.uncertain.value) failure.value = errorMessage(error)
		}
	}
	function discard(): void {
		if (window.confirm('Descarta esta venta sólo si comprobaste que no se registró.')) charge.discard()
	}
</script>
<template>
	<div
		role="alert"
		if:when="charge.uncertain.value"
	>
		<p>Venta en verificación: no tuvo respuesta. Se reintentará con la misma clave, así que no se cobrará dos veces.</p>
		<button
			bind:disabled="charge.pending.value"
			on:click="() => charge.retry().catch(() => {})"
		>
			Reintentar ahora
		</button>
		<button on:click="discard">Descartar</button>
	</div>
	<p if:when="failure.value">{failure.value}</p>
</template>
```

##### Avisos de cada intento: `onSuccess` y `onError`

Un reintento automático (al volver la conexión o al montarse el componente) no tiene una promesa a la que esperar. Desde `1.2`, las opciones `onSuccess` y `onError` de `useRpcMutation` y `useApiMutation`, con o sin `retrySafe`, se llaman una vez por cada intento que termina, lo haya enviado quien sea, después de actualizar `data`, `error`, `pending` y `uncertain`:

```ts
const charge = useRpcMutation('sales.checkout', {
	retrySafe: { key: 'pos:sale' },
	onSuccess(receipt, attempt) {
		// También tras un reintento en segundo plano: la venta en verificación se confirmó.
		if (attempt.trigger !== 'mutate') notify(`Venta #${receipt.number} cobrada.`)
		ticket.clear()
	},
	onError(error, attempt) {
		// Sólo los rechazos con respuesta: sin respuesta, la venta sigue en verificación.
		if (!attempt.uncertain) notify(`La venta no se registró: ${errorMessage(error)}`)
	},
})
```

- **`intento`.** Lleva la entrada enviada (`input`), su clave (`idempotencyKey`, `null` sin `retrySafe`) y quién lo envió (`trigger`): `"mutate"`, `"retry"` (una llamada a `retry()`) o `"resume"` (el reintento automático). En `onError`, `uncertain` es `true` cuando no hubo respuesta y la intención se conserva para reintentarla; sin `retrySafe` siempre es `false`.
- **Una vez por intento.** Si `mutate` y `retry()` esperan la misma petición, o dos componentes con la misma clave la comparten, cada mutación avisa una sola vez. La promesa de `mutate` y `retry()` sigue resolviendo o rechazando como siempre: use los avisos para lo que también debe pasar tras un reintento en segundo plano y la promesa para lo propio de esa llamada.
- **Errores.** Un fallo dentro del aviso (o la promesa que rechaza si es asíncrono) llega al `provideErrorHandler` más cercano con la fuente `"event"`, como un manejador `on:`; no cambia el estado de la mutación ni el resultado de la promesa.

**En el servidor**, la clave llega validada como `context.idempotencyKey`: el UUID en minúsculas, o `undefined` si la cabecera falta o no es un UUID (se acepta con o sin comillas). Meeko no deduplica: la aplicación guarda la clave junto al resultado, con una restricción única, y ante una clave repetida devuelve el resultado que ya registró en lugar de aplicar la escritura otra vez.

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
		// Un reintento de una venta ya registrada devuelve el mismo recibo, sin cobrar otra vez.
		const existing = await db.sales.findByKey(restaurantId, key)
		if (existing) return existing.receipt
		// La restricción única cubre también dos reintentos simultáneos: el segundo INSERT falla
		// y vuelve a leer la venta del primero.
		return db.sales.insertOrGet(restaurantId, key, input)
	},
})
```

Acote la clave al usuario o a la cuenta, como en el índice, y, si quiere seguir el borrador del IETF al pie de la letra, responda `422` cuando la misma clave llega con otra entrada. La cabecera no cambia la seguridad: la petición sigue necesitando la sesión, el token CSRF y el `Origin` de siempre. En una petición del mismo origen el navegador la envía sin más; si un cliente de otro origen llama a la API con CORS, añada `Idempotency-Key` a `Access-Control-Allow-Headers` en su proxy o middleware.

##### Una clave propia en `api.*` y `rpc.*`

Desde `1.2`, una llamada de los clientes generados acepta `idempotencyKey`, un UUID que viaja en la misma cabecera `Idempotency-Key`. Va junto a `params`, `query`, `body` y `signal` en `api.*`, y en las opciones de `rpc.*`:

```ts
const key = crypto.randomUUID()
await api.sales.post({ body: sale, idempotencyKey: key })
await rpc.sales.checkout(sale, { idempotencyKey: key, signal: AbortSignal.timeout(10_000) })
```

Un valor que no es un UUID rechaza con `TypeError` sin enviar la petición. La clave no se guarda ni se reintenta: es la misma cabecera, y la deduplicación sigue siendo del servidor.

| Situación                                                                                                                                                     | Use                                                                                                          |
| ------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------ |
| Una escritura desde un componente que debe sobrevivir a una caída de red o a una recarga, con aviso de «en verificación»                                      | `useRpcMutation` / `useApiMutation` con `retrySafe`: Meeko crea la clave, guarda la intención y la reintenta |
| Código que no es un componente (un script, una cola propia, un service worker) o una clave que ya existe fuera de Meeko, como el id de un pedido sin conexión | `api.*` / `rpc.*` con `idempotencyKey`: usted guarda la clave y repite la llamada con ella                   |
| Pruebas de la deduplicación del servidor                                                                                                                      | `api.*` / `rpc.*` con `idempotencyKey`, sin escribir la cabecera a mano                                      |

#### `load` o composables

| Necesidad                                                                                       | Use                                                                                    |
| ----------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------- |
| Datos de la página que determinan `head`, una redirección, la sesión o el estado HTTP           | Código de nivel superior de `<script server>` (o `load`)                               |
| Datos lentos y secundarios en una ruta `"stream"`                                               | Un export, o un campo de `load`, con `defer`                                           |
| Datos que pertenecen a un componente reutilizable o a un layout                                 | `await useApi` / `await useRpcQuery`                                                   |
| Datos que dependen de señales del componente y se recargan al cambiar                           | `useApi` / `useRpcQuery`, con o sin `await`                                            |
| Datos que pueden llegar después del primer pintado, con un indicador de carga                   | `useApi` / `useRpcQuery` sin `await`, con [`<MeekoAwait>`](#meekoawait) para no saltar |
| Escrituras                                                                                      | `useRpcMutation` / `useApiMutation`, o `api.*`/`rpc.*` en un handler                   |
| Escrituras que no deben aplicarse dos veces si se pierde la respuesta (cobros, pasos de cocina) | `useRpcMutation` / `useApiMutation` con `retrySafe`                                    |
| Estado del navegador que debe sobrevivir a una recarga (un ticket abierto, la caja elegida)     | [`useStorage`](#estado-persistente-usestorage)                                         |
| Formularios que envían datos, con validación y errores por campo                                | `useForm` con `api.*`/`rpc.*` en su `submit`                                           |

Las reglas de nivel superior de estos composables (`MEEK054`, `MEEK055`) se describen en [api.md](api.md#composables-de-nivel-superior-y-await). Un host propio puede crearlos con `createUseApi(manifest, options)`, `createUseRpcQuery(manifest, options)`, `createUseRpcMutation(manifest, options)` y, desde `1.2`, `createUseApiMutation(manifest, options)` de `@meekojs/meeko/framework`, que es lo que hacen los clientes generados; los tipos `DataResource`, `LoadedResource`, `RpcMutation`, `UseApi`, `UseRpcQuery`, `UseRpcMutation`, `ApiQueryContract`, `ApiQueryOptions` y `Reactive`, desde `1.2` `ApiMutation`, `ApiMutationInput`, `ApiMutationContract`, `UseApiMutation`, `MutationOptions`, `RetrySafeOptions`, `RetrySafeMutation` y `UncertainMutation`, y desde `1.5` `DataResourceOptions`, describen su forma.

### Estado persistente: `useStorage`

Desde `1.2`, `useStorage(clave, inicial, opciones?)` devuelve una señal editable cuyo valor se guarda en JSON en `localStorage` (o en `sessionStorage` con `storage: "session"`). Se autoimporta en los `.meeko` desde `@meekojs/meeko/framework`, como `useState`, y se llama mientras se ejecuta el script de un componente (en su nivel superior o dentro de un composable que este llama).

```html
<script lang="ts">
	const lines = useStorage('pos:ticket', [] as TicketLine[])
	const registerId = useStorage('pos:register', '')
	const add = (line: TicketLine): void => {
		lines.value = [...lines.value, line]
	}
</script>
<template><p>{lines.value.length} productos en el ticket</p></template>
```

- **SSR e hidratación sin desajustes.** El servidor nunca lee el almacenamiento: el HTML usa `inicial`, y la hidratación también. El valor guardado se aplica justo al terminar de hidratar la página, antes de `onMounted`, igual que `model` con un control que el usuario editó antes de hidratar. Un componente que se monta después (un `if:` que se abre, la página de una navegación en el navegador) ya pinta el valor guardado en su primer render. La señal no viaja en el estado del payload: su fuente es el almacenamiento.
- **Escrituras.** Cada asignación se guarda al momento, en JSON. Asigne valores nuevos (`lines.value = [...lines.value, line]`), como con cualquier señal: mutar el objeto no avisa ni guarda. Asignar `undefined` borra la clave, y la siguiente lectura vuelve a `inicial` (declare el tipo con `| undefined`, por ejemplo `useStorage<string | undefined>("draft", undefined)`).
- **Lecturas inválidas.** Un valor que no es JSON o que no cumple `schema` se ignora y la señal vale `inicial`. `schema` es un Standard Schema síncrono (Valibot, Zod…); con él, el tipo de la señal sale del schema:

  ```ts
  import * as v from 'valibot'
  const theme = useStorage('theme', 'light', { schema: v.picklist(['light', 'dark']) })
  ```

- **Almacenamiento bloqueado.** En modo privado, sin permiso o con la cuota llena, nunca lanza: la señal sigue funcionando en memoria. Sólo un fallo inesperado, como un valor que JSON no puede representar (`BigInt`, ciclos) o un `schema` que lanza o es asíncrono, llega al `provideErrorHandler` más cercano o al `onError` de la aplicación.
- **Otras pestañas.** Mientras algún componente usa la clave, el evento `storage` de otra pestaña actualiza la señal (con la misma validación); un `localStorage.clear()` la devuelve a `inicial`. El listener se libera con el último componente que la usa.
- **Una señal por clave.** Dos componentes que usan la misma clave y el mismo almacenamiento comparten una sola señal; el primero que la crea fija `inicial` y `schema`. Cuando ya ningún componente la usa, el siguiente vuelve a leer el almacenamiento.

| Necesidad                                                                     | Use                      |
| ----------------------------------------------------------------------------- | ------------------------ |
| Estado compartido de la aplicación, igual en SSR y en el navegador            | `useState`               |
| Estado del navegador que sobrevive a una recarga o se comparte entre pestañas | `useStorage`             |
| Datos que pertenecen al servidor                                              | `useApi` / `useRpcQuery` |

No guarde secretos ni tokens: el almacenamiento es legible por cualquier script de la página. Incluya en la clave lo que distinga a usuarios o cuentas que comparten navegador (`` `pos:ticket:${restaurant.slug}` ``).

### Formularios: `useForm`

Desde `1.2`, `useForm` reúne lo que repite cada formulario: una señal por campo, la validación en el navegador, `pending`, el mensaje de error, `event.preventDefault()` y los `issues` de un `400` del servidor llevados a cada campo. Se autoimporta desde `@meekojs/meeko/framework` y valida con cualquier Standard Schema, como los de Valibot. Sus tipos `Form`, `FormField` y `FormSubmission` también se autoimportan como tipos en componentes y módulos de `app/`; no están disponibles en `<script server>`, `server/` ni `shared/`.

```ts
// shared/schemas/menu.ts
import * as v from 'valibot'

export const categoryInput = v.object({
	name: v.pipe(v.string(), v.trim(), v.minLength(1, 'Escribe un nombre.'), v.maxLength(60, 'Usa como mucho 60 caracteres.')),
	description: v.pipe(v.string(), v.trim(), v.maxLength(200, 'Usa como mucho 200 caracteres.')),
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
		errorMessage: (failure) => (failure instanceof ClientError && failure.code === 'CATEGORY_EXISTS' ? 'Ya existe una categoría con ese nombre.' : 'No se pudo guardar. Revisa la conexión e inténtalo de nuevo.'),
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
			Nombre
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
			label="Descripción"
			model:value="form.fields.description"
			bind:error="form.errors.value.description"
		/>
		<button bind:disabled="form.pending.value">{form.pending.value ? "Guardando…" : "Guardar"}</button>
		<p if:when="form.submitted.value">Categoría guardada.</p>
	</form>
</template>
```

`useForm(options)` recibe:

| Opción                    | Uso                                                                                                                                                                                                                                                             |
| ------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `schema`                  | Opcional. Standard Schema que valida los campos al enviar.                                                                                                                                                                                                      |
| `initial`                 | Valor inicial de cada campo. Con `schema`, uno por cada clave de su entrada, también las opcionales (`undefined` si no hay valor).                                                                                                                              |
| `submit(values)`          | Envía los datos: recibe la salida del schema (o los valores de los campos, sin schema) y devuelve el resultado, o rechaza.                                                                                                                                      |
| `errorMessage(failure)`   | Opcional. Texto de `error` para un fallo sin `issues`; por defecto, `failure.message`, que en un `ClientError` es su `code`.                                                                                                                                    |
| `onSuccess(result, form)` | Opcional, desde `1.5`. Se ejecuta tras un envío correcto, con `submitted` ya en `true`: por ejemplo, `(saved, form) => form.commit({ name: saved.name })`.                                                                                                      |
| `focusInvalid`            | Opcional, desde `1.5`. Con `true`, tras un envío con errores en los campos mueve el foco al primer control inválido (véase [Foco en el primer error](#foco-en-el-primer-error)).                                                                                |
| `action`                  | Opcional, desde `1.7`. Ruta del endpoint con `form` al que se envía el `<form method="post">` sin JavaScript, como `"/api/feedback"`: al volver de ese envío, el SSR pinta su resultado (véase [Formularios sin JavaScript](#formularios-sin-javascript-form)). |

y devuelve un `Form`:

| Propiedad           | Valor                                                                                                                                                               |
| ------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `fields`            | Una `Signal` escribible por campo, para `model` en un `<input>`, `<textarea>` o `<select>` y `model:nombre` en un componente.                                       |
| `errors`            | Señal con el primer mensaje de cada ruta con error (`errors.value.name`, `errors.value["items.0.name"]`); un campo sin error no tiene clave.                        |
| `error`             | Señal con el mensaje del formulario completo, o `null`.                                                                                                             |
| `failure`           | Señal con el error original del último envío fallido (también el `ClientError` de un `400`), o `null`.                                                              |
| `pending`           | `true` mientras se valida de forma asíncrona o se ejecuta `submit`.                                                                                                 |
| `submitted`         | `true` cuando el último envío terminó bien.                                                                                                                         |
| `dirty`             | `true` si algún campo difiere de los valores iniciales (los arrays y objetos se comparan por contenido).                                                            |
| `submit(event?)`    | Envía el formulario; resuelve con lo que devuelve `submit`, o con `undefined`. Nunca rechaza.                                                                       |
| `trySubmit(event?)` | Desde `1.5`. Envía igual que `submit`, pero resuelve con un `FormSubmission` que dice cómo terminó. Nunca rechaza.                                                  |
| `reset(values?)`    | Vuelve a `initial`, o a `initial` combinado con `values`; también acepta el evento `reset` de un `<form>`.                                                          |
| `load(values)`      | Llena los campos con un registro para editar. Las claves omitidas conservan su valor actual; lo cargado es la referencia de `dirty`.                                |
| `commit(values?)`   | Desde `1.5`. Escribe `values` y toma los valores de los campos como nueva referencia de `dirty`, sin borrar `submitted`.                                            |
| `field(name)`       | Desde `1.5`. Las piezas de un campo para un componente propio: su señal, su mensaje e IDs estables (véase [Componentes de campo](#componentes-de-campo-formfield)). |
| `csrfToken`         | Desde `1.7`. El token CSRF de la sesión para el campo oculto `_csrf` de un formulario nativo, o `undefined` sin sesión. No es una señal.                            |

Todas las señales salvo `fields` son de sólo lectura (`csrfToken` es un texto, no una señal).

**Envío.** `form.submit(event)` llama a `event.preventDefault()`, valida los campos con el schema y, si son válidos, llama a `submit` con la salida del schema. Mientras hay un envío en curso, otro `form.submit()` se ignora (resuelve `undefined`, y también evita el envío nativo del navegador). Al empezar un envío válido se borran `errors`, `error`, `failure` y `submitted`. `submit` puede devolver un valor o una promesa; para hacer algo con el resultado, envuelva la llamada:

```ts
async function save(event: SubmitEvent): Promise<void> {
	const category = await form.submit(event)
	if (category) form.reset()
}
```

**Resultado del envío.** `submit` resuelve `undefined` tanto si los datos no son válidos como si falla la red o si `submit` devuelve `undefined`. Desde `1.5`, `form.trySubmit(event)` envía igual, pero resuelve con un `FormSubmission<Result>` discriminado por `ok` y `reason`:

| Resultado                                                  | Cuándo                                                                                                                                                                                                    |
| ---------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `{ ok: true, result }`                                     | `submit` terminó bien y devolvió `result`.                                                                                                                                                                |
| `{ ok: false, reason: "invalid", errors, error, failure }` | Los datos no superaron el schema del navegador (`failure` es `null`) o el servidor respondió con `issues` (`failure` es el `ClientError`). `errors` y `error` son los mensajes que muestra el formulario. |
| `{ ok: false, reason: "error", error, failure }`           | El envío falló sin `issues`, como un `409` o un fallo de red. `error` es el texto de `errorMessage`, o `null` si un `reset` lo descartó.                                                                  |
| `{ ok: false, reason: "skipped" }`                         | No se envió nada: ya había un envío en curso, el script se ejecuta sólo para producir HTML (SSR) o un `reset` descartó los valores mientras el schema validaba.                                           |

```ts
async function send(event: SubmitEvent): Promise<void> {
	const outcome = await form.trySubmit(event)
	if (outcome.ok) created.value = outcome.result.username
	else if (outcome.reason === 'error') console.warn(outcome.failure)
}
```

`submit` no cambia: sigue resolviendo con el resultado o con `undefined`, y `on:submit="form.submit"` sigue siendo la forma corta cuando no hace falta el resultado.

#### Foco en el primer error

Con `focusInvalid: true`, un envío que termina con errores en los campos, del schema o de los `issues` del servidor, mueve el foco al primer control inválido una vez que los mensajes se han pintado (en el siguiente `requestAnimationFrame`). Busca, en el orden del documento dentro del `<form>` del evento (su `currentTarget`, o el formulario del botón que lo envió), un control cuyo `name` o cuyo `id` de `form.field` sea el de un campo con error, o que tenga `aria-invalid="true"`. Sin evento, busca en todo el documento. Un fallo sin `issues`, como un `409` sin ellos o un fallo de red, no mueve el foco.

```ts
const form = useForm({ schema: signupInput, initial: { email: '', password: '' }, submit: (values) => api.signup.post({ body: values }), focusInvalid: true })
```

**Validación.** El schema se ejecuta al enviar, no mientras se escribe. Cada issue va a `errors` con su ruta unida con `.`, como los `issues` del servidor: `"name"`, o `"items.0.name"` en un campo anidado. Si una ruta tiene varios, se conserva el primero. Un issue con ruta `""` (de una regla sobre el objeto completo) o de una clave que el formulario no tiene va a `error`. Tras un error, el campo se vuelve a validar cada vez que cambia: su mensaje se actualiza o desaparece en cuanto es válido, sin esperar al siguiente envío. Un campo sin error no se valida hasta el envío. Si el schema es asíncrono, `pending` vale `true` mientras valida.

**Campos que dependen de otros.** Desde `1.5`, cada cambio vuelve a validar también los demás campos que ya muestran un error del schema, y el mensaje del formulario si vino del schema (un issue con ruta `""`). El schema se ejecuta siempre sobre el formulario entero, así que no cuesta más. Con una confirmación que Valibot lleva a su campo con `v.forward(v.partialCheck([["password"], ["confirm"]], …), ["confirm"])`, cambiar la contraseña quita el «Las contraseñas no coinciden» de `confirm` en cuanto coinciden, sin tocar la confirmación. Las reglas siguen sin añadir mensajes a un campo que no tenía error, y los mensajes del servidor de otro campo (un `issue` de un `400` o de un `ApiError`) no se borran por cambiar un campo distinto: sólo cuando cambia su propio campo. Con un schema asíncrono, sólo se aplica la validación más reciente, que cubre todos los campos cambiados desde la anterior.

**Errores del servidor.** Un `ClientError` con `issues` (la respuesta `400` de una entrada que no supera el schema del servidor) se reparte igual: cada mensaje en su campo y los demás en `error`. Es útil sin schema en el navegador, o cuando el servidor tiene reglas que el formulario no comprueba. Sin schema, cambiar un campo borra sus mensajes del servidor:

```ts
// app/pages/ingresar.meeko: sin schema, valida sólo el servidor
const form = useForm({
	initial: { email: '', password: '' },
	submit: (values) => api.session.post({ body: values }),
	errorMessage: (failure) => (failure instanceof ClientError && failure.code === 'INVALID_CREDENTIALS' ? 'Los datos no coinciden con ninguna cuenta.' : 'No se pudo conectar con el servidor.'),
})
```

```json
{
	"code": "INVALID_BODY",
	"status": 400,
	"requestId": "…",
	"issues": [
		{ "path": "email", "message": "Escribe un correo válido." },
		{ "path": "password", "message": "Escribe tu contraseña." }
	]
}
```

Con esa respuesta, `form.errors.value` vale `{ email: "Escribe un correo válido.", password: "Escribe tu contraseña." }`, `form.error.value` vale `null` y `form.failure.value` es el `ClientError`. Un `401` `INVALID_CREDENTIALS` deja `errors` vacío y `error` con el texto de `errorMessage`. Para marcar un campo desde el propio `submit` (por ejemplo, tras comprobar algo en el navegador), lance un `ClientError` con `issues`: `throw new ClientError("EMAIL_TAKEN", 409, undefined, [{ path: "email", message: "Ese correo ya tiene cuenta." }])`.

Desde `1.5`, el servidor también puede atribuir a un campo un error que no es de validación, como un `409` de un correo que ya existe: `new ApiError(code, status, { issues })` envía esos `issues` con la misma forma que los de un `400` (véase [Errores de un campo: `ApiError` con `issues`](#errores-de-un-campo-apierror-con-issues)), y `useForm` los reparte igual: el mensaje en `errors.value.email`, `error` en `null` y el `ClientError` del `409` en `failure`.

```ts
// server/api/signup.post.ts
export default defineApiRoute({
	body: signupInput,
	response: signupResult,
	status: 201,
	handler: async ({ body }) => {
		if (await emailTaken(body.email)) throw new ApiError('EMAIL_TAKEN', 409, { issues: [{ path: 'email', message: 'Ese correo ya tiene una cuenta.' }] })
		return createUser(body)
	},
})
```

`ClientError` e `isClientError` se autoimportan desde `1.5` en los componentes y en los módulos de `app/` (no en `server/`, donde se lanza `ApiError`), como `useForm`: `errorMessage: (failure) => isClientError(failure, "INVALID_CREDENTIALS") ? "…" : "…"` no necesita import.

**Otros fallos.** Un error sin `issues` pone en `error` el texto de `errorMessage(failure)` y en `failure` el error original, y `form.submit()` resuelve `undefined`. Un `ClientError` es una respuesta prevista del servidor y no se informa en otro sitio. Cualquier otro error (un fallo de red, un error de programación en `submit` o un schema que lanza) llega además al observador de errores del componente, `provideErrorHandler` o el `onError` de `mountClientApp`, con la fuente `"event"`; sin observador, se escribe en la consola. Así un fallo inesperado nunca se pierde en silencio, aunque la plantilla no muestre `error`.

**`reset`, `load` y `dirty`.** `reset()` siempre devuelve los campos a `initial`, incluso después de `load` o `commit`. `reset(values)` combina `values` con `initial` y toma ese resultado como referencia de `dirty`. `load(values)` combina los datos con los campos actuales y usa el resultado como referencia de `dirty`; sirve al cargar un registro para editar, incluso después de una petición asíncrona: `form.load({ name: category.name, description: category.description })`. Ambos limpian errores y el estado del último envío, y descartan resultados anteriores en curso (aunque `pending` sigue en `true` hasta que termine). `reset` también puede conectarse a `on:reset="form.reset"`. Como con cualquier señal, sustituya los arrays y objetos en lugar de mutarlos: `form.fields.items.value = [...form.fields.items.value, item]`.

**`commit`.** Desde `1.5`, `commit(values?)` escribe `values` en sus campos y toma los valores de todos los campos como la nueva referencia de `dirty`: `dirty` vuelve a `false`. `reset()` sigue regresando a `initial`. A diferencia de `reset`, no borra `submitted`, `errors`, `error` ni `failure`, ni descarta un envío en curso. Sirve tras guardar, para que lo guardado sea la nueva referencia sin perder el «Guardado». Sin `values`, toma los valores actuales; si el usuario puede seguir escribiendo durante el envío, pase lo que devolvió el servidor. Con `onSuccess`, el formulario lo hace solo:

```ts
const profile = useForm({
	schema: profileInput,
	initial: { name: data.name, bio: data.bio },
	submit: (values) => api.profile.put({ body: values }),
	onSuccess: (saved, form) => form.commit({ name: saved.name, bio: saved.bio }),
})
```

```html
<p if:when="profile.submitted.value && !profile.dirty.value">Guardado.</p>
```

**Tipos.** Con `schema`, los campos tienen el tipo de la entrada del schema y `submit` recibe su salida: con un `v.transform`, el campo puede ser texto (`price: Signal<string>`) y `submit` recibir un número. Sin schema, los campos y los valores tienen el tipo de `initial`. `meeko check` comprueba `initial` contra la entrada del schema, rechaza un campo que no existe (`form.fields.nmae`) o una ruta de `errors` que no existe, y exige que el campo de un `model` tenga el tipo del control (un campo `number` no sirve para un `<input>` de texto). El tipo `Form<Values, Result>` describe el resultado, por ejemplo para pasar el formulario a un componente.

#### Componentes de campo: `FormField`

Desde `1.5`, `form.field(name)` devuelve lo que un componente de campo necesita, sin recibir el formulario entero: un `FormField<Value>` tipado por la clave del campo (`form.field("nmae")` es un error de tipos). Devuelve siempre el mismo objeto para el mismo campo, así que se puede pasar como prop en la plantilla.

| Propiedad                 | Valor                                                                                                                                                                                                     |
| ------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `value`                   | La misma `Signal` que `form.fields[name]`, para `model`.                                                                                                                                                  |
| `name`                    | El nombre del campo, para el atributo `name` (y para `focusInvalid`).                                                                                                                                     |
| `id`, `errorId`, `hintId` | IDs del control, de su mensaje (`${id}-error`) y de un texto de ayuda (`${id}-hint`). Salen de [`useId`](api.md#ids-estables-useid): coinciden entre SSR e hidratación y no se repiten entre formularios. |
| `error`                   | Señal con el primer mensaje del campo (o de una ruta anidada, como `items.0.name`), o `undefined`.                                                                                                        |
| `invalid`                 | Señal: `true` si el campo tiene algún error.                                                                                                                                                              |
| `describedBy`             | Señal: `errorId` mientras hay error, o `undefined`; el valor de `aria-describedby`.                                                                                                                       |

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
		label="Correo"
	/>
	<AppField
		bind:field="form.field('password')"
		label="Contraseña"
		hint="Al menos 10 caracteres."
	/>
</form>
```

**Un campo con `field` o con `model`.** Un componente de campo reutilizable puede servir dentro de un formulario, con `bind:field`, y fuera de él, con `model` o sin nada. Declare `field` opcional y el modelo por defecto con opciones sin nombre, `defineModel<string>({ default: "" })`, para que también sea opcional (véase [Modelos de componente](api.md#modelos-de-componente-definemodel-y-model)); con `defineModel<string>()`, `<AppTextField bind:field="…" />` da `TS2741` porque el modelo sería obligatorio. Elija entre los dos dentro de un `computed`:

```html
<!-- app/components/AppTextField.meeko -->
<script lang="ts">
	import type { FormField } from '@meekojs/meeko/framework'
	const props = defineProps<{ field?: FormField<string>; label: string; hint?: string; error?: string }>()
	// Sin field, el valor es el modelo: la señal del padre (model="señal") o una propia.
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
		label="Correo"
	/>
</form>
<AppTextField
	model="query"
	label="Buscar"
	hint="Por nombre o correo."
/>
<AppTextField label="Notas" />
```

`model="value.value"` enlaza la señal que elige el `computed`: la del campo o la del modelo. Los IDs del campo salen de `form.field` y, sin él, de `useId`, con los mismos sufijos `-hint` y `-error` que `hintId` y `errorId`. `const value = props.field?.value ?? model` en el setup daría el aviso `MEEK101`, y con razón: el setup se ejecuta una vez y, con props reactivas, el padre puede cambiar de campo sin volver a montar el hijo (`bind:field="editing.value ? form.field('email') : form.field('phone')"`). `form.field` devuelve el mismo objeto para el mismo campo, pero la prop puede pasar a otro; dentro de un `computed`, el valor y los IDs siguen ese cambio. Use `untrack(() => props.field)` sólo si el campo de esa instancia no cambia nunca.

Para un campo de otro tipo, declare la prop con su tipo (`FormField<boolean>` en una casilla). Los IDs de `form.field` toman el prefijo de `document.idPrefix`. Llame a `useForm` en el nivel superior del script, como `useId`, para que sus IDs coincidan al hidratar.

**SSR e hidratación.** En SSR el formulario se renderiza con `initial` y nunca envía: los eventos no existen en el servidor, y `form.submit()` no hace nada si se llama mientras el script se ejecuta para producir sólo HTML (SSR o la pasada en seco de una navegación). Los campos son estado del componente que no viaja en el payload: no forman parte del estado transferido ni del que conserva HMR, porque `form` no es una señal. Al hidratar, el navegador vuelve a ejecutar `useForm` con el mismo `initial`, así que `initial` debe depender sólo de props, datos de la ruta y estado, como la entrada de un `await useApi`. Lo que el usuario escriba antes de que la página se hidrate se conserva: `model` lo copia a la señal del campo al terminar la hidratación. Desde `1.7`, con `action`, el resultado de un envío sin JavaScript sí viaja en el estado de la página, para que la hidratación pinte lo mismo que el SSR (véase [Formularios sin JavaScript](#formularios-sin-javascript-form)).

Llame a `useForm` en el nivel superior del `<script>`, como cualquier estado del componente. A diferencia de `useApi`, no tiene la restricción `MEEK054` ni admite `await`.
