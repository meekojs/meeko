# Datos y renderizado: detalles técnicos

Contratos completos del código de servidor, los modos de render, streaming y la caché. Para elegir lo habitual, empieza por la [guía breve](routing-data.md).

## Página de error de la aplicación (`app/error.meeko`)

`app/error.meeko`, junto a `app/app.meeko`, es la página de error de toda la aplicación. Recibe las mismas props que `+error.meeko`, `{ status: number; message: string }`, y `meeko check` las comprueba igual. Se usa en dos casos:

- **URL sin ruta.** Una petición de página (GET o HEAD con `accept: text/html`, o la navegación con `accept: application/meeko+json`) responde `404` con `app/error.meeko` dentro de los layouts raíz: `app/app.meeko` y `app/layouts/default.meeko` (o `app/pages/+layout.meeko`). Las props son `{ status: 404, message: "NOT_FOUND" }`. Como la página de error de una ruta, el documento se titula `Error` (`<title>` en SSR y `document.title` al navegar a una URL sin ruta). El documento lleva el payload de hidratación, así que el navegador lo hidrata y la navegación posterior funciona. En el navegador, un enlace o `navigate()` a una URL sin ruta carga el documento: esa URL puede pertenecer a middleware de servidor, a un archivo o a una redirección, y consultarla antes con `fetch` ejecutaría dos veces un `GET` con efectos. Si nada más la atiende, el servidor responde con `app/error.meeko`. Por la misma razón, volver con el historial a una entrada sin ruta recarga el documento; la navegación desde la página `404` hacia rutas de la aplicación sí es del cliente.
- **Página que falla.** El `+error.meeko` más cercano sigue ganando; si no hay ninguno, se usa `app/error.meeko`. Lo mismo vale para el loader de una ruta `render: "client"` en el navegador.

`/api/...`, `/_meeko/...`, los assets y las peticiones que no son de página mantienen sus respuestas `404` (JSON o texto). Sin `app/error.meeko` nada cambia: una URL sin ruta responde `404` en texto plano y el navegador recarga el documento. `app/error.meeko` y `app/pages/+error.meeko` definirían el mismo nivel, por eso tenerlos a la vez es un error de descubrimiento. En un layer o módulo, `app/error.meeko` respalda sus propias páginas; la `404` usa la del proyecto. Un host propio pasa la página con `errorPage` a `createFrameworkHandler` y a `mountClientApp` (`AppManifest.errorPage` en `createServerApp`).

## Código de servidor de la página

Una página declara su código de servidor en un bloque `<script server lang="ts">` dentro del propio `.meeko`, de modo que `app/pages` sólo contiene archivos `.meeko`. El bloque admite dos formas. Pueden convivir en el mismo bloque, salvo `load`, que no se combina con código de nivel superior:

- **Código de nivel superior** (desde `1.1`). El bloque es código de servidor normal: lee la petición, consulta la base de datos, redirige o responde `404`, y cada `export const` es un dato de la página que llega tipado al `<script>` y a la plantilla.
- **Opciones de ruta.** `export const route = definePage({ params, search, render, prerenderEntries, load, head })`, la forma de `1.0`, que sigue funcionando sin cambios; desde `1.5`, también `layout` y `layoutProps` (véase [Layouts con nombre](routing-layouts.md#layouts-con-nombre)), y desde `1.7`, `sitemapEntries` (véase [Rutas dinámicas en el sitemap](framework.md#rutas-dinámicas-en-el-sitemap-sitemapentries)).

### Código de nivel superior y datos exportados

```html
<!-- app/pages/users/[id].meeko -->
<script
	server
	lang="ts"
>
	import { definePage } from '@meekojs/meeko/framework'
	import * as v from 'valibot'

	export const route = definePage({ params: v.object({ id: v.string() }) })

	const { params, context } = usePage() // la petición en curso, tipada por route.params
	if (!context.session.current) redirect('/login')
	const row = await db.users.findById(params.id) // db: un autoimport de server/utils; row no sale del servidor
	if (!row) notFound()
	export const user = { id: row.id, name: row.name } // se envía a la página
	export const head = { title: `Perfil de ${user.name}` }
</script>

<script lang="ts">
	const name = signal(user.name) // `user` está en ámbito y tipado
</script>

<template>
	<h1>{user.name}</h1>
	<input model="name" />
</template>
```

- **Cuándo se ejecuta.** Las sentencias del bloque que no son imports, tipos ni `export const route` se ejecutan en cada petición: en SSR y en la petición de datos de cada navegación cliente, después del middleware y de validar `params` y `search` con `route`, igual que `load`. Admiten `await` de nivel superior. Los imports, los tipos y las opciones de ruta se evalúan una vez por módulo.
- **Exports.** Cada `export const` o `export let` (también desestructurado, `export const { a, b } = ...`) salvo `route` y `head` es un campo de datos de la página. Sólo cruzan los nombres exportados: el resto del bloque, sus imports y sus variables privadas no llegan al bundle cliente ni al payload. Un export que es una promesa se espera antes de renderizar.
- **En la página.** El `<script>` y la plantilla ven cada export como un valor normal, de sólo lectura en profundidad, con el tipo del export ya esperado. No es una señal: llega en el payload y se sustituye en cada navegación, cuando el bloque vuelve a ejecutarse. Para estado editable, cree una señal a partir de él (`signal(user.name)`). Declarar en el `<script>` un nombre que ya exporta el bloque da `MEEK075`. La página no necesita declarar `data` en `defineProps`; si lo declara, `meeko check` comprueba que sea compatible con los exports.
- **`export const head`.** Fija el `<head>` de la página como `route.head`: un objeto `{ title, description }` o una función sin argumentos que lo devuelve, calculada en el servidor con los valores del bloque. No forma parte de los datos. Declarar a la vez `export const head` y `route.head` da `MEEK072`. Desde `1.2`, `useHead` y `useSeoMeta` en el nivel superior del bloque son una alternativa, y `export const head` gana sobre ellas (véase [Head del documento](framework.md#head-del-documento-document-usehead-y-useseometa)).
- **API de la petición.** `usePage()` devuelve `{ url, params, search, request, context, signal }`: `params` y `search` salen de los schemas de `route` o, sin schema, de los segmentos del ID de ruta; `context` es el contexto de la petición (sesión, servicios, plataforma) y `signal` se aborta si el cliente se desconecta, se revoca la sesión o se cancela la respuesta. `redirect(url, status?)` detiene el bloque y responde con una redirección (`302` por defecto; admite `301`, `302`, `303`, `307` y `308`), que una navegación cliente sigue como la de un loader. `notFound()` detiene el bloque y responde `404` con la página de error más cercana (`+error.meeko` o `app/error.meeko`). Las tres se importan de `@meekojs/meeko/framework` o se usan sin import dentro del bloque. Valen mientras se ejecuta el código de nivel superior: también dentro de un helper del bloque al que ese código llama (`function requireAdmin() { … redirect("/login") }`), aunque sea `async`. Donde no hay página en curso dan `MEEK073`, y en ejecución lanzan un error con ese código: en las opciones de ruta, en un bloque sin código de nivel superior, en el `<script>` del componente (desde `1.3`, también sin import en el `<script>` y en la plantilla) y, desde `1.7`, en una función que Meeko llama al calcular el head, cuando el código de nivel superior ya terminó (`export const head = () => …` y la función de `useHead(() => …)` o `useSeoMeta(() => …)`); lea allí los valores que obtuvo el nivel superior. `meeko check` no puede saber si una función del bloque se llama más tarde (desde un temporizador, por ejemplo): en ese caso el error sólo aparece en ejecución.
- **Serialización.** Los exports viajan en JSON, como los datos de `load`. `meeko check` da un error de tipos en un export que no se puede serializar: funciones, `undefined`, `bigint`, símbolos e instancias de clase como `Date` o `Map`. En ejecución, un valor que `serializeJson` rechaza hace fallar la respuesta con `500`, como un loader.
- **Estado entre peticiones.** Como el bloque se ejecuta en cada petición, una variable de nivel superior (`const cache = new Map()`) es nueva cada vez. Un valor que deba compartirse entre peticiones vive en un módulo importado.

Meeko considera que un bloque tiene código de nivel superior si exporta con `export const` o `export let` un nombre distinto de `route` (incluido `head`), o si usa `usePage`, `redirect` o `notFound` (desde `1.2`, también `useHead` o `useSeoMeta`) fuera de cualquier función y fuera de las opciones de ruta. Un bloque sin ninguna de las dos cosas mantiene el comportamiento de `1.0`: se evalúa una vez como módulo y admite `export default`, `export function` o una constante privada usada por `load`. Con código de nivel superior se aplican estas reglas:

| Código    | Causa                                                                                                                                                                                                                                                                             |
| --------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `MEEK070` | Código de nivel superior y `route.load` a la vez: los exports son los datos de la página. Elija uno.                                                                                                                                                                              |
| `MEEK071` | `export function`, `export class`, `export enum`, `export default`, `export { ... }` o `export const route` junto a otras declaraciones en la misma sentencia.                                                                                                                    |
| `MEEK072` | `export const head` y `route.head` a la vez.                                                                                                                                                                                                                                      |
| `MEEK073` | `usePage`, `redirect` o `notFound` donde no hay página en curso: en las opciones de ruta, en un bloque sin código de nivel superior, en el `<script>` y la plantilla del componente y, desde `1.7`, en `export const head = () => …` o en la función de `useHead` y `useSeoMeta`. |
| `MEEK074` | Código de nivel superior en una página `render: "client"`, cuyo bloque se ejecuta en el navegador. Use `useApi` o `useRpcQuery`, o renderice en el servidor.                                                                                                                      |
| `MEEK075` | Un nombre exportado por el bloque se declara también en el `<script>`.                                                                                                                                                                                                            |
| `MEEK076` | Las opciones de ruta leen un nombre declarado por el código de nivel superior, que se ejecuta después y en cada petición. Mueva el valor compartido a un módulo importado.                                                                                                        |

El editor da a los exports su tipo en el `<script>` y en la plantilla, y «ir a definición» sobre `user` lleva al `export` del bloque.

### Opciones de ruta con `definePage`

```html
<!-- app/pages/users/[id].meeko -->
<script
	server
	lang="ts"
>
	import { definePage } from '@meekojs/meeko/framework'
	import * as v from 'valibot'

	export const route = definePage({
		params: v.object({ id: v.string() }),
		load: async ({ params, signal }) => ({ id: params.id, signalAborted: signal.aborted }),
		head: ({ data }) => ({ title: data.id }),
	})
</script>

<script lang="ts">
	export interface Props {
		params: { id: string }
		search: Record<string, string | string[]>
		data: { id: string; signalAborted: boolean }
	}
	const props = defineProps<Props>()
</script>

<template><h1>{props.data.id}</h1></template>
```

### Reglas comunes

El bloque es un módulo TypeScript independiente del componente:

- **Sólo servidor.** El componente compilado nunca lo incluye. Se ejecuta en el servidor con los autoimports de `server/utils` y puede importar `server/` y módulos `*.server.*`; sus imports relativos se resuelven desde la carpeta de la página. Sólo una ruta `render: "client"` lo envía al navegador (véase «Modos de render»).
- **Opciones de ruta.** Igual que un sidecar: `export const route = definePage({ ... })` o, sin código de nivel superior, `export default`. `render` y, desde `1.5`, `layout` deben ser literales que `meeko build` pueda leer sin ejecutarlo.
- **Sólo en páginas.** Un `<script server>` en un componente, un layout, `+layout.meeko` o `+error.meeko` es un error (`MEEK044`). Un segundo bloque da `MEEK004`, sin `lang="ts"` da `MEEK006` y con un valor (`server="..."`) da `MEEK043`.
- **Comprobación.** `meeko check` comprueba el bloque con TypeScript en el ámbito del servidor y compara su loader, o sus exports, con las props de la página; los errores señalan la línea y columna del `.meeko`.

`head({ data })`, o `export const head`, devuelve el `title` de la página y, desde `1.1`, su `description`. En SSR, `title` va en `<title>` y `description` en `<meta name="description">`, antes del `<head>` del host; en una navegación se aplican a `document.title` y a esa meta. Una página sin `title` o sin `description` deja los que aporta el host en `document.head`, o ninguno, igual en SSR que al navegar. Desde `1.2`, el `head` de la ruta admite también las etiquetas y atributos de `useHead` (`meta`, `link`, `script`, `style`, `htmlAttrs`, `bodyAttrs` y `titleTemplate` como cadena) y tiene la máxima prioridad frente a `useHead` y a `document` de la configuración; el título y la descripción del host quedan detrás del head que gestiona Meeko (véase [Head del documento](framework.md#head-del-documento-document-usehead-y-useseometa)).

Como alternativa, las opciones de ruta pueden vivir en un sidecar `*.route.ts` junto a la página (`app/pages/users/[id].route.ts`), la forma disponible desde `1.0`. Un sidecar no admite código de nivel superior. Una página no puede declarar ambos: Meeko detiene el descubrimiento de rutas con un error que nombra los dos.

Las opciones de ruta validan params y search antes del loader y del código de nivel superior. El loader puede devolver un `Response` para redirigir; el código de nivel superior usa `redirect()`. En una navegación cliente, si la petición de datos responde `404` (por `notFound()` o por un `ApiError` con estado `404` del loader), el navegador muestra el `+error.meeko` más cercano, o `app/error.meeko`, con `{ status: 404, message }`, donde `message` es el código público del error (`NOT_FOUND`), igual que el documento SSR. `meeko check .` compara el `ComponentProps` de cada página con los `params`, `search` y datos que entrega su sidecar; un error de contrato identifica ambos archivos. También comprueba que `app/app.meeko` y los layouts acepten el `outlet` suministrado por Meeko, y que `+error.meeko` y `app/error.meeko` acepten `status` y `message`. Estos contratos rechazan props declaradas como `any`, `never` o `unknown`. Los datos del loader son obligatorios para la página cuando el sidecar declara `load`; una query repetida sin schema puede producir `string[]`, además de `string`. El handler SSR crea el estado de `useState` y el contexto de sesión por petición; transfiere sólo props, estado público y datos de ruta serializables. El navegador hidrata ese payload y pide datos al servidor durante la navegación, por lo que un sidecar privado no entra al bundle cliente; sólo los sidecars `render: "client"` son públicos (véase «Modos de render»). `mountClientApp` gestiona historial, cancelación y limpieza. Si un host usa `loadRoute` directamente en cliente, su loader recibe un estado provisional: Meeko aplica sus cambios al confirmar la ruta y los descarta al cancelar o fallar. Las señales de ese estado deben usarse durante `load`, sin conservar referencias después de retornar. Se puede usar `render: "prerender"` con `prerenderEntries` para rutas dinámicas; sin ellas, `meeko build` falla (`Dynamic prerender route /posts/[id] requires prerenderEntries`) y, desde `1.7`, también `meeko check` y `meeko dev` al descubrir las rutas, salvo que un spread de las opciones pueda traerlas, que se deja al build. `meeko build` lee `render` del sidecar sin ejecutarlo: debe ser un literal de texto dentro de `definePage({ ... })`, de un objeto exportado o de una constante local del mismo archivo; un valor calculado, una clave computada (`["render"]` o `[clave]`) que no vaya seguida de un `render` literal, un spread sin `render` explícito posterior o una reexportación detienen el build con el archivo afectado. El build escribe el HTML y el payload de navegación bajo `.meeko/output/node/prerender/` (`meeko prerender .` repite ese paso sobre un build existente). El servidor sirve esas páginas pasando por el middleware de servidor, el contexto de sesión y el middleware de ruta; inserta la meta CSRF de la sesión en `<head>` sin reescribir el documento. Sin sesión responde con `ETag`, `Vary: cookie` y `cache-control: public, max-age=0, must-revalidate`, y devuelve `304` ante `If-None-Match`; con sesión responde `private, no-store`. Una CDN o caché compartida delante del servidor debe respetar `Vary: cookie` o no almacenar respuestas de peticiones con cookie; si ignora `Vary`, configúrela para omitir la caché cuando la petición traiga la cookie de sesión, porque de lo contrario podría entregar la versión anónima a un usuario con sesión y dejarlo sin meta CSRF. `PrerenderedPage.headOffset` del índice `prerender/manifest.json` se mide en unidades de código UTF-16 del HTML almacenado leído como texto (índices de cadena de JavaScript), no en bytes: un adaptador debe leer el archivo como texto UTF-8 y usar el valor tal cual, sin calcularlo a partir de bytes. Una URL con query string, una entrada dinámica no generada o un host con nonce CSP propio (sin `server.contentSecurityPolicy`, que desde `1.7` sirve el archivo con sus hashes) se renderizan con SSR.
La comprobación del loader cubre tanto `definePage({ load() { /* ... */ } })` como `definePage(options)` cuando el tipo de `options` conserva un `load` obligatorio.

### Dónde se usa cada API

El `<script>` y la plantilla de un componente se ejecutan en SSR y también en el navegador; `<script server>` y los sidecars `*.route.ts` se ejecutan en el servidor, fuera del componente. Desde `1.3`, `meeko check`, `meeko build` y el editor señalan cada API en el lugar donde no existe, con un mensaje que dice dónde se usa, y el autocompletado del `<script>` y de la plantilla deja de ofrecer las de servidor:

| API                                                                                                                                                  | `<script server>`                                | `<script>` y plantilla                                                   | Sidecar `*.route.ts` | `server/`                  |
| ---------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------ | ------------------------------------------------------------------------ | -------------------- | -------------------------- |
| `definePage`                                                                                                                                         | Sí: `export const route`                         | No tiene efecto: aviso `MEEK109`, error en `2.0`                         | Sí                   | No tiene efecto            |
| `usePage`, `redirect`, `notFound`                                                                                                                    | Sí, en el nivel superior; fuera de él, `MEEK073` | No: `MEEK073`                                                            | No: lanzan `MEEK073` | No: lanzan `MEEK073`       |
| `defineApiRoute`, `defineRpc`, `defineServerMiddleware`, `defineSocketChannel`, `defineServerRuntime`, `ApiError`                                    | Sí, sin import                                   | No: `MEEK108`. En el navegador, un error de API llega como `ClientError` | Sí                   | Sí, cada una en su carpeta |
| Autoimports de `server/utils`, de `imports.serverDirs` y de los `*.server.ts` de cualquier carpeta de autoimports (también las de `imports.appDirs`) | Sí                                               | No: `MEEK108`. Pida los datos con `useApi` o `useRpcQuery`               | Sí                   | Sí                         |
| Imports de `server/` y de módulos `*.server.*`                                                                                                       | Sí                                               | No: `MEEK108`; `import type` sí                                          | Sí                   | Sí                         |
| Imports de valores de `@meekojs/meeko/server` y `/cloudflare`                                                                                        | Sí                                               | No: `MEEK108`; `import type` sí                                          | Sí                   | Sí                         |
| Imports de valores de `@meekojs/meeko/node`, `/bun`, `/deno`, `/password` y `/build`                                                                 | Sí                                               | Aviso `MEEK109`, error en `2.0`; `import type` sí                        | Sí                   | Sí                         |
| `defineProps`, `defineEmits`, `defineExpose`, `defineModel`, `defineSnippets`, `useElementRef`, `onMounted`                                          | No: `MEEK108`                                    | Sí                                                                       | No                   | No                         |

Desde `1.6`, un [middleware de ruta de servidor](routing-middleware.md#middleware-de-ruta-de-servidor) (`app/middleware/*.server.ts`) es código de servidor como `server/`: usa `redirect()` y `notFound()` mientras se ejecuta, como el nivel superior de `<script server>`, y `defineServerRouteMiddleware` se autoimporta allí; en el `<script>` o la plantilla de un componente es `MEEK108`.

Con `render: "client"`, el bloque o el sidecar se ejecutan en el navegador (véase [Modos de render](#modos-de-render)) y no pueden usar las APIs de servidor de la tabla: un autoimport de servidor, un import de `server/` o uno de `*.server.*` detienen el build, y el editor marca el autoimport con `MEEK_AUTOIMPORT`. Un componente dentro de `server/` (una plantilla de correo, por ejemplo) sólo se renderiza en el servidor, así que puede usar las APIs de servidor. El build y `meeko dev` sólo aplican `MEEK108` al bundle del navegador: un componente fuera de `server/` que sólo importa código de servidor (una plantilla en `app/emails/` que renderiza una ruta de API) sigue compilando, como en `1.2`. `meeko check` y el editor, que no conocen el grafo de imports, comprueban todo componente fuera de `server/` como código del navegador, igual que en `1.2`; para que lo acepten, ponga esos componentes en `server/`.

`MEEK108` señala código que ya fallaba antes de `1.3`: el autoimport de servidor no se resolvía en el bundle del navegador, `@meekojs/meeko/server` y `/cloudflare` no se pueden cargar allí, un import de `server/` detenía `meeko build`, y las macros y `onMounted` no existen fuera del `<script>`. `MEEK109` es un aviso porque ese código compila y se carga: `definePage` en el componente no configura la ruta, y las funciones de `/node`, `/bun`, `/deno`, `/password` y `/build` sólo fallan al llamarlas en el navegador (véase [Política de estabilidad](stability.md#apis-deprecadas)).

## Modos de render

`render` del sidecar elige cómo llega cada página al navegador:

| Modo                  | HTML del servidor                                                         | Loader y `head`            | Uso                                                 |
| --------------------- | ------------------------------------------------------------------------- | -------------------------- | --------------------------------------------------- |
| `"ssr"` (por defecto) | Página completa en cada petición                                          | Servidor                   | Contenido indexable o personalizado                 |
| `"stream"`            | Página sin los valores `defer`, que llegan después por la misma respuesta | Servidor                   | Páginas con datos lentos y secundarios              |
| `"prerender"`         | Página completa generada en `meeko build`                                 | Servidor, durante el build | Contenido estático                                  |
| `"client"`            | Sólo los layouts, con el outlet vacío                                     | Navegador                  | Paneles y vistas interactivas sin requisitos de SEO |

El código de nivel superior de `<script server>` sigue el modo como un loader: con `"ssr"` y `"stream"` se ejecuta en cada petición y con `"prerender"` una vez por entrada durante `meeko build`. En `"stream"`, un export creado con `defer(...)` llega después de la página, como un valor diferido del loader (véase [Streaming SSR](#streaming-ssr-render-stream)). Con `"client"` no se admite (`MEEK074`), porque el bloque se ejecuta en el navegador.

```html
<!-- app/pages/notes/index.meeko: el bloque se ejecuta en el navegador -->
<script
	server
	lang="ts"
>
	import { definePage } from '@meekojs/meeko/framework'

	export const route = definePage({
		render: 'client',
		load: async ({ url, params, search, signal, state }) => api.notes.list({ signal }),
		head: ({ data }) => ({ title: `${data.length} notas` }),
	})
</script>
```

Con `render: "client"` el bloque `<script server>` (o el sidecar) es público: entra en el bundle del navegador con los autoimports de cliente, aunque su etiqueta diga `server`.

Con `render: "client"` el servidor ejecuta el middleware de servidor y de ruta, crea el contexto de sesión y valida `params` y `search` con los schemas del sidecar (una entrada inválida responde `400`). Después renderiza `app/app.meeko` y los layouts con un outlet vacío, sin llamar a `load` ni a `head`, y envía un payload con `render: "client"` y sólo `params` y `search`. Sin layouts, `#app` queda vacío. En el navegador, Meeko hidrata los layouts, ejecuta `load` con `ClientPageLoadContext` (`url`, `params`, `search`, `signal` y `state`, sin `request` ni `context`) y confirma la página por la misma vía transaccional que una navegación; `head` se ejecuta después de `load` y su `title` se aplica a `document.title`. Un fallo del loader muestra el `+error.meeko` más cercano dentro de los layouts, con el mismo mensaje público que el servidor (`500` informa al observador de errores de navegación; un `ClientError` 4xx conserva su estado y código).

La navegación funciona en ambos sentidos entre páginas SSR y de cliente y conserva los layouts comunes: cada ruta elige su origen de datos. Las páginas `"client"` usan su sidecar en el navegador y las demás piden su payload al servidor. Sólo los sidecars `"client"` entran al bundle cliente, mediante el módulo virtual `virtual:meeko-client-routes`; la entrada generada los carga con `mountClientApp({ loadClientRoute })`. Por eso el build aplica la misma frontera que al resto del código cliente: importar `server/` o un módulo `*.server.*` desde ese sidecar detiene `meeko build`, y en el navegador sólo hay autoimports de cliente, por lo que usar un util de `server/utils` falla con un error que nombra el autoimport.

Compromisos de `"client"`:

- **SEO.** El HTML inicial no contiene los datos ni el `<title>` de la página. Los buscadores que no ejecutan JavaScript sólo ven los layouts. Use `"ssr"` o `"prerender"` para contenido indexable.
- **Seguridad de los datos.** El sidecar es público: no puede contener secretos ni comprobar permisos. Los datos llegan por API o RPC, y cada endpoint debe aplicar sus propias guardas (sesión, CSRF, autorización y validación). El middleware de ruta protege la navegación, pero no los datos.
- **Prerender.** Una página `"client"` no se puede prerenderizar: declarar `prerenderEntries` junto a `render: "client"` detiene `meeko check`/`meeko build` con un error explícito.
- **Build coherente.** El servidor compara el `render` del sidecar con el del manifiesto del build y responde con error si difieren; vuelva a ejecutar `meeko build` (o reinicie `meeko dev`) al cambiar el modo de una ruta.

## Streaming SSR (`render: "stream"`)

Un loader marca con `defer` los datos que pueden llegar después de la página. `defer(promise, { timeoutMs })` o `defer((signal) => promise, { timeoutMs })` devuelve un `Deferred<T>` con `status` (`"pending"`, `"resolved"` o `"rejected"`), `value` y `error` (`{ code, status }`). Leer esos campos en una plantilla o un `effect` se suscribe al resultado, porque están respaldados por señales.

Con una fábrica, Meeko la invoca cuando el loader devuelve y le pasa un `AbortSignal` que se aborta cuando el valor deja de esperarse: al agotar `timeoutMs`, si el cliente se desconecta, si se revoca la sesión, si el stream se cancela, en una petición `HEAD` o, en el navegador, al salir de la ruta. Pásela a `fetch` o a su cliente de base de datos para cancelar de verdad el trabajo. Una promesa ya iniciada no se puede cancelar: Meeko sólo deja de esperarla, salvo que el propio trabajo use `context.signal` del loader, que también se aborta en esos casos (salvo el timeout, que es propio de cada valor).

```ts
// app/pages/posts/[id].route.ts
import { defer, definePage } from '@meekojs/meeko/framework'

export const route = definePage({
	render: 'stream',
	load: async ({ params }) => ({
		post: await api.posts.get({ params }), // crítico: entra en el HTML inicial
		comments: defer((signal) => api.comments.list({ params, signal }), { timeoutMs: 5_000 }),
	}),
	head: ({ data }) => ({ title: data.post.title }),
})
```

```html
<p if:when="props.data.comments.status === 'pending'">Cargando comentarios…</p>
<ul if:when="props.data.comments.status === 'resolved'">
	…
</ul>
<p if:when="props.data.comments.status === 'rejected'">No se pudieron cargar ({props.data.comments.error?.code}).</p>
```

**Fase 0, antes del primer byte.** El servidor resuelve la ruta, crea el contexto y la sesión, ejecuta el middleware, valida `params` y `search`, espera el loader crítico (todo lo que no está en `defer`), renderiza de forma síncrona la página y todos sus layouts con los diferidos en `pending` y calcula `head`, que ve el estado escrito durante el render. Después sella el estado (`StateStore.seal()`: una escritura posterior lanza `STATE_SEALED` y el valor diferido que la provocó se rechaza con `500`), espera los cambios de sesión que sigan en curso (`create`, `rotate` o `revoke` iniciados por el loader) y llama a `context.session.verify()`; una sesión revocada mientras corría el loader responde `401` en lugar de un `200` parcial. Estado, cabeceras, cookies, token CSRF y `<title>` quedan fijados ahí: no se puede redirigir ni cambiar la sesión desde trabajo diferido. Desde ese momento `create`, `rotate` y `revoke` fallan con `SESSION_LOCKED`/`500` antes de tocar el almacén, de modo que la sesión del navegador sigue siendo válida: sólo se rechaza el valor diferido que lo intentó, el fallo llega a `onError` y los demás valores siguen llegando.

El sellado se aplica a todos los modos de render, no sólo a `"stream"`. Una escritura de estado desde una promesa que nadie espera (ni el loader con `await` ni un `defer`) lanza `STATE_SEALED` dentro de esa promesa; si no la captura, es un rechazo no manejado y Node termina el proceso con su configuración por defecto. Espere ese trabajo en el loader o devuélvalo con `defer`.

**Fase 1, el stream.** La respuesta lleva `cache-control: no-store, no-transform` y `x-accel-buffering: no`. Primero se envía el documento hasta `#app`, el payload `#meeko-payload` (con `deferred: [{ id, path, status: "pending" }]` y `null` en cada `path`) y la entrada cliente con `<script type="module" async>`, que respeta el nonce CSP del host. Por cada valor que se resuelve, en el orden en que se resuelve, sigue un `<script type="application/json" data-meeko-deferred="N">{"deferred":N,"value":…}</script>` (o `"error":{"code","status"}`), y al final `</body></html>`. Son bloques de datos, no scripts ejecutables, así que una CSP estricta sin `'unsafe-inline'` no necesita excepciones.

**Errores y cancelación.** Un rechazo se serializa sólo como `{ code, status }` con las mismas reglas que la API: un `ApiError` conserva su código y estado; cualquier otro error se convierte en `INTERNAL_ERROR`/`500` y su causa privada se envía a `onError` con el `requestId` de la respuesta. Un valor que no termina en `timeoutMs` (10 s por defecto) se rechaza con `DEFERRED_TIMEOUT`/`504`. Los diferidos siguen `RequestContext.signal`: si el cliente se desconecta o falla una escritura del adaptador, el stream se cancela, Meeko deja de esperar los diferidos pendientes y aborta la señal de sus fábricas y la `signal` del loader, sin informar a `onError`; si se revoca la sesión, los que quedan se envían como `SESSION_REVOKED`/`401`. Una petición `HEAD` recibe las cabeceras finales sin cuerpo y aborta igualmente esas señales. Una promesa pasada directamente a `defer` sigue ejecutándose hasta terminar por su cuenta.

**Navegador.** El cliente hidrata con todos los diferidos en `pending`, como los renderizó el servidor, y aplica los valores ya llegados sólo cuando termina la hidratación. Encuentra los bloques que ya estaban en el documento y los que añade el parser después mediante un `MutationObserver` sobre `<body>`. Sólo acepta los bloques que son hijos directos de `<body>` y están después de `#meeko-payload`, donde los escribe el servidor; un bloque con el mismo aspecto dentro de `#app` (por ejemplo, HTML de usuario) se ignora. Si el documento termina sin el bloque de algún valor (por ejemplo, porque falló una escritura), ese valor se rechaza con `DEFERRED_INCOMPLETE`/`502`. En una navegación cliente a una ruta `"stream"`, Meeko pide `accept: application/meeko+json` y el servidor responde `application/meeko+ndjson`: la primera línea es el payload, con el que se confirma la ruta, y cada línea siguiente es `{ "deferred": id, "value" | "error" }`. Una línea mal formada se informa a `onError` y no detiene la lectura; si la conexión falla a mitad, el fallo se informa y los valores que no llegaron se rechazan con `DEFERRED_INCOMPLETE`/`502`. Navegar a otra ruta cancela la lectura pendiente. Las demás rutas siguen respondiendo `application/meeko+json`.

**`stream` frente a `ssr`.** Con `render: "ssr"` o `"prerender"`, un `defer` se espera dentro del servidor antes de renderizar: el HTML siempre contiene el valor resuelto (o su error) y es seguro para SEO, así que una página puede pasar de un modo a otro sin cambiar la plantilla. Con `"prerender"`, un valor rechazado no se guarda: la petición responde `500` y `meeko build` se detiene indicando la ruta y el `path` del valor. El HTML prerenderizado y su `index.meeko.json` salen de la misma ejecución del loader. Use `"stream"` cuando una parte secundaria de la página (comentarios, recomendaciones, métricas) es lenta y no debe retrasar el primer pintado ni la interactividad. Compromisos:

- **SEO.** El contenido diferido no está en el HTML inicial del SSR, sino en bloques de datos posteriores que sólo se muestran al ejecutar JavaScript. Lo que deba indexarse tiene que ir en el loader crítico o en una página `"ssr"`.
- **Proxies y CDN.** Un proxy, balanceador o CDN que almacena la respuesta completa antes de reenviarla anula el streaming: el usuario espera igual que con `"ssr"`. Meeko envía `x-accel-buffering: no` (respetado por nginx) y `cache-control: no-store, no-transform`: `no-transform` pide a los intermediarios que no compriman ni reescriban el cuerpo, porque una compresión o reescritura con buffer retendría los bloques. En Cloudflare, `no-transform` desactiva la compresión hacia el visitante y las funciones que modifican el HTML, pero no la inspección de sólo lectura: si una zona la tiene activa, cree una Configuration Rule con «Response Body Buffering» en «None» para esas rutas. En local, `wrangler dev` y `meeko preview --adapter cloudflare` (Miniflare) comprimen con gzip las respuestas `text/html` aunque lleven `no-transform` y sólo escriben el cuerpo comprimido al terminar, así que una página `"stream"` parece llegar entera al final salvo que el cliente envíe `accept-encoding: identity`. En producción, la compresión de Cloudflare sí respeta `no-transform`. Otros intermediarios o funciones serverless sin respuestas en streaming deben configurarse aparte. Los adaptadores Node, Bun y Deno escriben cada bloque en cuanto se produce; la suite de conformidad comprueba que el primer byte llega antes que el valor diferido.
- **Cabeceras finales.** Redirecciones, cookies, CSRF y `<title>` dependen sólo de los datos críticos. Mover algo a `defer` lo saca de esas decisiones.
- **Loaders en el navegador.** Un sidecar `"client"` (o un host que usa `loadRoute`) también puede devolver `defer`: el navegador aplica el mismo `timeoutMs`, el valor se actualiza cuando su promesa termina y la señal de una fábrica se aborta al agotar el plazo o al salir de la ruta.
- **Claves.** Un valor diferido puede estar bajo cualquier clave propia, incluidas `constructor` y `prototype`, salvo `__proto__`: el servidor responde `500` al renderizar.

## Caché de páginas SSR

Desde `1.7`, `cache` de `definePage` permite revalidar y cachear una página `"ssr"` o `"stream"` sin ejecutar su loader ni su render en cada petición:

```html
<!-- app/pages/docs/[...slug].meeko -->
<script
	server
	lang="ts"
>
	import { definePage } from '@meekojs/meeko/framework'

	export const route = definePage({
		cache: {
			// Barato: una consulta de la fecha de modificación, no del documento.
			etag: async ({ params }) => (await docs.updatedAt(params.slug))?.toISOString(),
			maxAge: 60,
			staleWhileRevalidate: 600,
			memory: { maxEntries: 500 },
		},
		load: ({ params }) => docs.get(params.slug),
	})
</script>
```

- **`etag(ctx)`** devuelve la versión del contenido (una cadena o un número) y se llama antes del loader y del render, con `url`, `params` y `search` ya validados, `request`, `signal` y `context`. Meeko la combina con el tema de la petición (cookie y client hint), el build y el tipo de respuesta (documento o payload de navegación) en un `ETag` débil, `W/"…"`. Si coincide con `If-None-Match`, responde `304` sin loader, sin plugins y sin render. Debe cambiar con todo lo que cambia el HTML salvo el tema: si la página lee una cabecera o un parámetro de búsqueda que no está en `params`, inclúyalo. `undefined` deja esa respuesta sin `ETag`.
- **`maxAge`** y **`staleWhileRevalidate`** (segundos) escriben `Cache-Control: public, max-age=N, stale-while-revalidate=M`. Sin `maxAge`, `public, max-age=0, must-revalidate`: el navegador revalida cada vez, y el `ETag` le ahorra el cuerpo.
- **`memory`** (`true` o `{ maxEntries, maxBytes }`, por defecto 1000 entradas y 32 MiB por ruta y proceso) guarda el HTML y el payload renderizados en una LRU, con la clave URL, tema y tipo de respuesta, y el `ETag` con el que se renderizaron. Desde `1.7`, en una ruta con schema `search`, la parte de la URL tras `?` es el `search` validado: un parámetro que la ruta no declara (`?utm_source=…`, un número aleatorio para saltarse la caché) comparte la copia en lugar de llenar la LRU; sin schema, cuenta la query tal como llega, porque la página la recibe entera. Mientras `etag` devuelva lo mismo, Meeko sirve la copia sin loader ni render; cuando cambia, la copia se descarta y la página se renderiza otra vez. Necesita `etag`. Dos peticiones simultáneas que no encuentran copia renderizan las dos.

La respuesta lleva `Vary: Accept, Cookie` (y `Sec-CH-Prefers-Color-Scheme` con el tema en `"system"`), porque el documento y el payload comparten URL y el HTML depende del tema y de la sesión. Con `server.contentSecurityPolicy`, el documento de una página con `cache` no lleva nonce y su CSP lleva los hashes del código en línea que escribe Meeko, nunca los de un `<script>` o un `<style>` que llegue dentro de la página (véase [CSP y cabeceras en los adaptadores con servidor](framework.md#csp-y-cabeceras-en-los-adaptadores-con-servidor)); el `304` no lleva CSP, así que el navegador conserva la de su copia.

**Qué nunca se cachea.** La caché sólo se aplica en producción (en `meeko dev` cada petición renderiza lo que acaba de compilar) y a peticiones `GET` y `HEAD` sin sesión:

- una petición con la cookie de sesión, aunque haya caducado, o con `session.current`, sale como siempre, con `no-store` y sin `ETag`: su HTML lleva el token CSRF de esa sesión;
- una respuesta que pone una cookie (un loader que crea la sesión, por ejemplo) sale con `no-store`, sin `ETag` y sin copia en memoria; en desarrollo, Meeko lo avisa una vez por ruta en la consola;
- desde `1.7`, una petición con la cabecera `Authorization` sale con `no-store` y sin `ETag`, sin leer ni escribir la copia: se responde para esas credenciales;
- un host con su propio nonce (`DocumentOptions.nonce` sin `server.contentSecurityPolicy`) no cachea: la copia llevaría el nonce de otra respuesta;
- una petición con la cookie de un solo uso del resultado de un formulario sin JavaScript (`__Host-meeko-form`, o `meeko-form` sin HTTPS) no recibe `304` ni la copia en memoria, no se guarda y, en una página prerenderizada, se renderiza en lugar de servir el archivo;
- y, en cualquier respuesta de la aplicación, `Set-Cookie` con un `Cache-Control` `public` o, desde `1.7`, con `s-maxage` (también si lo añade `server.headers`) se convierte en `private, no-store` sin `ETag`.

**Personalizar con cookies propias.** Meeko sólo reconoce su cookie de sesión. Una página con `cache` que personaliza el HTML con otra cookie (idioma, moneda, un carrito anónimo, un test A/B) lo comparte: `etag` no la ve si no la lee, y `memory` sirve la misma copia a todos. `Vary: Cookie` sólo evita que una caché compartida mezcle respuestas con cookies distintas. Si el HTML depende de una cookie propia, incluya su valor en lo que devuelve `etag` y no use `memory`, o no use `cache` en esa página.

**Middleware.** El middleware de ruta (isomórfico y de servidor) se ejecuta siempre, antes del `304` y de la copia en memoria: una guarda nunca se salta por la caché. Con `memory`, los plugins de aplicación no se ejecutan en una petición servida desde la copia.

**`render: "stream"`.** Sólo usa el `ETag` y el `304`: su cuerpo sale mientras se resuelven los valores `defer`, así que guardarlo obligaría a esperar a todos (lo contrario de un stream) y fijaría valores que pueden cambiar en cada petición. Su `Cache-Control` añade `no-transform`, como siempre, y su CSP lleva los hashes del documento sin los valores diferidos, que son bloques de datos JSON. Con `"prerender"`, `cache` sólo afecta al SSR de las URL que no se prerenderizaron; una página `"client"` no admite `cache` (error de tipos y `TypeError` al definirla).

`cache` se lee al ejecutar la ruta, como `load`: `meeko build` no la lee del archivo. `definePage` la valida al cargar el módulo (un campo desconocido, un número negativo o `memory` sin `etag` lanzan `TypeError`).
