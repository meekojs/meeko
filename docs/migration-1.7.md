# Actualizar de 1.6 a 1.7

`1.7` es un minor: lo nuevo (la CSP y las cabeceras en los adaptadores con servidor, la caché de páginas SSR con `cache`, los formularios sin JavaScript con `form` y `useForm({ action })`, `rateLimit` en SQL, `clientAddress`, `sitemapEntries`, los `services` tipados y `debounceMs`/`enabled` en `useApi` y `useRpcQuery`) es opcional. Tres cambios se publican como [excepciones aprobadas](stability.md#excepciones-aprobadas) a la política de estabilidad: una conversión directa de `context.services` a un tipo incompatible es un error de tipos, asignar `computed(...).value` lanza y `PageInputError.name` es `"PageInputError"`. Además, algunos cambios se notan al actualizar: los hashes de CSP sólo cubren el código que escribe Meeko, comprobaciones nuevas en `meeko check` y en el editor, nombres nuevos que se autoimportan, avisos nuevos y mensajes en español. Esta guía los reúne con lo que conviene revisar en cada uno y explica cómo adoptar cada función. La lista completa, con lo añadido y corregido, está en el [CHANGELOG](../packages/meeko/CHANGELOG.md); los compromisos de compatibilidad, en la [política de estabilidad](stability.md).

## Orden recomendado

1. Actualice `@meekojs/meeko` a la versión exacta `1.7.0` y vuelva a compilar o construir, incluidas las páginas prerenderizadas: el código generado y el runtime deben tener la misma versión, y el índice de prerender de `1.7` lleva los hashes de CSP calculados sólo sobre el código que escribe Meeko (véase [Hashes de CSP sólo del código de Meeko](#hashes-de-csp-sólo-del-código-de-meeko)). Si usa la extensión de VS Code, actualícela a `1.7.0`; Meeko DevTools no cambia (sigue en `1.0.0`).
2. Ejecute `meeko check`. Revise los [errores de tipos nuevos](#errores-de-tipos-y-de-comprobación-nuevos): las conversiones de `context.services`, las asignaciones a las props, los manejadores `on*` de `useHead` y `MEEK073` en las funciones del head.
3. Busque asignaciones a `.value` de un `computed`, sobre todo en JavaScript sin tipos (véase [Asignar `computed().value` lanza](#asignar-computedvalue-lanza)), y comparaciones con `error.name === "Error"` para reconocer un `PageInputError`.
4. Si usa `contentSecurityPolicy` con el adaptador `static` o los `scriptHashes` del índice de prerender, compruebe que ninguna página depende de un `<script>` o un `<style>` escrito dentro de la plantilla (véase [Hashes de CSP sólo del código de Meeko](#hashes-de-csp-sólo-del-código-de-meeko)).
5. Lea los [avisos nuevos](#avisos-nuevos) de `meeko dev`, `meeko build` y `meeko check`: una clave de `meeko.config.ts` que nadie lee y `MEEK119`.

## Excepciones aprobadas

### `context.services` tipado y conversiones

Con `server/runtime.ts` en TypeScript, `meeko check`, `meeko dev` y el editor generan `.meeko/types/services.d.ts`, y `RequestContext.services` sin tipo escrito pasa a ser `AppServices`, el tipo de lo que devuelve su `services`, en lugar de `unknown`. Una conversión directa a un tipo que no encaja con ese tipo es ahora el error `TS2352` en `meeko check`, `meeko build` y el editor:

```ts
// server/api/report.get.ts
export default defineApiRoute({
  contentType: "response",
  // TS2352: Conversion of type '{ db: Database; … }' to type 'ReportServices' may be a mistake…
  handler: ({ context }) => Response.json(buildReport(context.services as ReportServices)),
});
```

Es sólo de tipos: el objeto `services` es el mismo que en `1.6`. Qué cambiar:

- **Lo habitual**: quitar la conversión, porque el tipo ya es el de `server/runtime.ts` (`context.services.db` compila sin `as unknown as MisServicios`).
- **Si el tipo de la conversión estaba mal**, corregirlo; el error señala justo eso.
- **Si la conversión es intencionada**, escribir `as unknown as Otro` o tipar el contexto con `RequestContext<Otro>`, que sigue ganando, como `any`.

Un contexto con otros servicios, como el de un test (`createRequestContext(request, { db: falso }, session)`), se sigue aceptando donde se espera un `RequestContext` sin argumento, como el handler de una ruta sin tipo escrito: `RequestContext` compara por su tipo de servicios. Para recibir el contexto de una ruta en una función, escriba `RequestContext` sin argumento (sus `services` ya son `AppServices`); `RequestContext<AppServices>` no lo acepta. Sin `server/runtime.ts`, con uno en JavaScript o sin `services`, el tipo sigue siendo `unknown`, como en `1.6`. Véase [Tipos de los servicios](framework.md#tipos-de-los-servicios).

### Asignar `computed().value` lanza

`computed(...)` devuelve un `ReadonlySignal`, así que TypeScript ya rechazaba `total.value = 0` (`TS2540`). En JavaScript sin tipos, o tras una conversión, la escritura sustituía el valor derivado hasta el siguiente recálculo. Desde `1.7` lanza siempre, como una escritura en las props:

```text
TypeError: Meeko computed values are read-only: change the signals it reads, or use a signal
```

Cambie las señales de las que depende el `computed` o, si el valor se escribe a mano, use un `signal`.

### `PageInputError.name`

`PageInputError.name` es `"PageInputError"`, como el de `ClientError` y `ApiError`; antes era `"Error"`. Sólo cambia quien comparaba `error.name === "Error"` para reconocerlo: use `instanceof PageInputError` o `error.code`, que no cambian, como el mensaje.

## Cambios que se notan al actualizar

### Hashes de CSP sólo del código de Meeko

Desde `1.3`, `scriptHashes` y `styleHashes` del índice de prerender y la CSP del adaptador `static` se calculaban sobre el documento entero, así que un `<script>` o un `<style>` que llegara dentro de la página (contenido de un CMS leído en el build, `html="…"` sin sanear) quedaba autorizado. Desde `1.7` sólo cuentan los que Meeko escribe fuera de la página: el `<head>` (el tema, la reserva de `<MeekoAwait>`, `useHead`, `document.head` y los `<style>` de los componentes), el payload si no es un bloque de datos, la entrada del cliente y `document.bodyEnd`. Un `<script>` o un `<style>` dentro de `#app` o de un teleport queda bloqueado, como ya pasaba con el nonce.

Si una página prerenderizada o del adaptador `static` tenía un `<script>` o un `<style>` escrito en la plantilla y una CSP sin `'unsafe-inline'`, muévalo a `useHead` (o a `document.head` en `meeko.config.ts`) o a un archivo. Un `.html` propio de `public/` se sigue leyendo entero, y `inlineScriptHashes` e `inlineStyleHashes` de `@meekojs/meeko/build` siguen leyendo todo el documento que reciben. Vuelva a construir para que el índice lleve los hashes nuevos.

### `contentSecurityPolicy()` y `script-src-elem`

Con `script-src-elem` en la política, los hashes de scripts van a esa directiva, que es la que el navegador consulta para los elementos `<script>`, como los de estilos a `style-src-elem` desde `1.4`. Hasta `1.6` iban siempre a `script-src`, donde no autorizaban nada.

### Cookies y cachés compartidas

Toda respuesta de `createServerApp` con `Set-Cookie` y un `Cache-Control` `public` o con `s-maxage` (de la respuesta o añadido por `server.headers`) sale como `private, no-store` y sin `ETag`, para que ninguna caché compartida guarde la cookie con la página. Si una respuesta pública ponía una cookie a propósito, quite la cookie o sirva esa respuesta como privada.

### `useSocketClient` en SSR

`useSocketClient` (y `useSocket`, `useSocketChannel`) ya no lanza en el render del servidor: sin `await`, devuelve un cliente inerte que se queda en `"connecting"`, cuyo `on` no registra nada y cuyo `emit` rechaza. El navegador abre la conexión al montar, como antes. Una comprobación de `window` alrededor sigue funcionando y ya no hace falta.

### Páginas prerenderizadas con nonce del host

Con `server.contentSecurityPolicy`, una página prerenderizada se sirve desde su archivo aunque el host pase `DocumentOptions.nonce`, con los hashes de su índice. Sin ella, como antes, un nonce del host la renderiza con SSR.

### `handleProcessErrors` una vez por aplicación

Junto a `serveNode` o `serveDeno` con `handleSignals`, una segunda llamada a `handleProcessErrors` añadía otros listeners: cada fallo se informaba dos veces y dos cierres competían. Desde `1.7` no añade nada y devuelve su propia función de retirada; si sus opciones son distintas de las de la primera, se ignoran con un aviso. Use una sola de las dos.

### RPC con un método no admitido

`GET` (u otro método que no sea `POST`) a `/_meeko/rpc/...` responde `405` con `Allow: POST`, como prometía su JSDoc.

### La CLI

- `meeko <comando> --help` (y `meeko help <comando>`) imprime la ayuda de ese comando.
- `meeko routes` prepara `.meeko/` como `meeko check`, así que `tsc -p .meeko/tsconfig.server.json` funciona después; `buildProject` hace lo mismo en un proyecto limpio en lugar de fallar con `Tsconfig not found`.
- `meeko check-app ./no-existe` falla con `No existe el directorio …` en lugar de imprimir `OK`; un componente que falta da `No existe el archivo …`. Un script que contaba con la salida `0` de una ruta que no existe debe corregir la ruta.
- `meeko init` e `init-framework` aceptan una carpeta con sólo `.git`, e `init-framework` acepta `bun.lock` y `bun.lockb`.
- `meeko types`, `compile` y `check <componente>` usan las mayúsculas del archivo en disco: en Windows y macOS, `meeko types src/app.meeko` con el archivo `App.meeko` escribe `App.d.meeko.ts`.
- Un segundo `meeko dev` del mismo proyecto avisa al arrancar de que el primero sigue en marcha, sin sustituir ni borrar su registro (`.meeko/dev/server.json`).

### Nombres nuevos que se autoimportan

`useNavigation` (de `@meekojs/meeko/framework`) y `createRoot` (de `@meekojs/meeko`) se autoimportan como `useRoute` y `effect`; `defer`, en el código de servidor (`<script server>`, los sidecars `*.route.ts`, `server/` y los `*.server.ts`). Un export propio con uno de esos nombres, o un import o una declaración del archivo, tiene prioridad. Con `defer` autoimportado, un `export const x = defer(...)` llega a la plantilla como `Deferred<T>` con su tipo exacto: `x.value.value` deja de compilar y los elementos de una lista en `x.value` ya no son `unknown`.

### Errores de tipos y de comprobación nuevos

Todos señalan código que ya fallaba en ejecución o que no hacía lo que parecía:

| Qué | Dónde se ve |
| --- | --- |
| `props.x = …` es `TS2540`: el script ve `defineProps<T>()` como `Readonly<T>`. En ejecución ya lanzaba un `TypeError`. | `meeko check`, `meeko build` y el editor |
| Un manejador `on*` de los eventos del DOM en `htmlAttrs` o `bodyAttrs` de `useHead` es un error de tipos. En ejecución ya lanzaba un `TypeError`. | `meeko check`, `meeko build` y el editor |
| `usePage()`, `redirect()` o `notFound()` dentro de `export const head = () => …` o de la función de `useHead(() => …)` y `useSeoMeta(() => …)` en `<script server>` son `MEEK073`. Fallaban en cada petición con `500`. | `meeko check`, `meeko build` y el editor |
| Una ruta dinámica `render: "prerender"` sin `prerenderEntries` detiene el descubrimiento (`Dynamic prerender route /posts/[id] requires prerenderEntries`). Hasta ahora sólo fallaba `meeko build`. | `meeko check` y `meeko dev` |
| `meeko check componente.meeko` comprueba lo mismo que el del proyecto: `MEEK044`, `MEEK100` y los errores de tipos de su `<script server>`. | `meeko check <componente>` y el editor |

`meeko check` acepta además `export default definePage(...)` en `<script server>` y en un sidecar `*.route.ts`, que antes fallaba con `has no exported member 'route'`, y `signal(props.x ?? 0)` ya no da `MEEK101`.

### Avisos nuevos

- **Claves de configuración desconocidas.** Una clave de `meeko.config.ts` que ni Meeko ni un módulo (`meta.configKey`) leen da un aviso una vez por configuración, con la clave más parecida (`¿Quisiste decir "sitemap"?`); antes se ignoraba en silencio. No es un error, porque esa configuración cargaba en `1.6`.
- **`LocalSocketPubSub` en producción.** Una aplicación con canales de Socket y sin `socket.pubsub` avisa una vez de que el broker es el de la memoria de cada instancia. `new LocalSocketPubSub()` explícito en `server/runtime.ts` lo quita; con varias instancias, use `RedisSocketPubSub`.
- **`MEEK119`.** Un atributo `each:*` o `if:*` que ninguna directiva del nodo lee (`each:by` junto a `each:of`, `if:else` junto a `if:when`) se escribía en silencio como atributo HTML literal; ahora `meeko check`, `meeko build` y el editor lo avisan. El HTML generado no cambia: quite el atributo o escriba la directiva que quería.

### Mensajes en español

La validación de `meeko.config.ts` y del tema (`server.port debe ser un entero entre 0 y 65535`, `campo desconocido …`), `meeko init` y `meeko init-framework` (`El destino no está vacío`), la contraseña vacía o demasiado larga de `meeko auth hash` por tubería, el build que falta en `meeko prerender` y la carga de la configuración (`No se puede cargar <archivo>: …`) dan sus mensajes en español. Si un script o un test busca el texto en inglés de alguno de ellos, actualícelo. Los errores de las API (`contentSecurityPolicy: invalid source …`, los códigos de `ApiError`) no cambian.

## Adoptar las funciones nuevas

### CSP y cabeceras en los adaptadores con servidor

`server.contentSecurityPolicy` y `server.headers`, que hasta `1.6` sólo tenía el adaptador `static`, existen también con `adapter: "node"`, `"bun"`, `"deno"` y `"cloudflare"`:

```ts
// meeko.config.ts
export default defineMeekoConfig({
  server: {
    adapter: "node",
    contentSecurityPolicy: {
      "default-src": ["'self'"],
      "script-src": ["'self'"],
      "style-src": ["'self'", "'unsafe-inline'"], // atributos style="…" de un resaltador
      "object-src": ["'none'"],
      "base-uri": ["'none'"],
      "frame-ancestors": ["'none'"],
    },
    headers: {
      "X-Content-Type-Options": "nosniff",
      "/admin/*": { "X-Robots-Tag": "noindex" },
    },
  },
});
```

En producción, Meeko completa la política de cada respuesta: los hashes del índice en una página prerenderizada (que se sigue sirviendo desde su archivo), un nonce nuevo por respuesta en el resto del SSR, los hashes del código de Meeko en una página con `cache` y `default-src 'none'; frame-ancestors 'none'` en el JSON de API, RPC y navegación. Nunca añade un nonce ni un hash a una directiva con `'unsafe-inline'`, salvo que tenga `'strict-dynamic'`. Al adoptarla:

- Empiece por la política del ejemplo y compruebe en el navegador que no hay bloqueos. En `meeko dev` la CSP no se aplica (Vite inyecta scripts sin nonce): pruébela con `meeko build` y `meeko preview`.
- Un atributo `on*` o una URL `javascript:` en el HTML se bloquean con nonce y con hashes: muévalos a un script o a `on:` del componente.
- Un endpoint con `contentType: "response"` que devuelve HTML necesita su propia `Content-Security-Policy`, porque todo `/api/` recibe la política de JSON.
- Con `'strict-dynamic'`, la entrada del cliente sólo carga con nonce, así que las páginas con `cache` o prerenderizadas, que usan hashes, no hidratan.
- Sin `contentSecurityPolicy`, el Worker de Cloudflare no incluye el analizador HTML de los hashes (unos 240 KB menos).

Véase [CSP y cabeceras en los adaptadores con servidor](framework.md#csp-y-cabeceras-en-los-adaptadores-con-servidor).

### Caché de páginas SSR: `cache`

`definePage({ cache })` revalida y cachea una página `"ssr"` o `"stream"` sin ejecutar su loader ni su render en cada petición:

```ts
export const route = definePage({
  cache: {
    etag: async ({ params }) => (await docs.updatedAt(params.slug))?.toISOString(),
    maxAge: 60,
    staleWhileRevalidate: 600,
    memory: { maxEntries: 500 },
  },
  load: ({ params }) => docs.get(params.slug),
});
```

`etag` debe ser barato (la fecha de modificación, no el documento) y cambiar con todo lo que cambia el HTML salvo el tema. La caché sólo se aplica en producción y nunca a una petición con sesión o con `Authorization`, ni a una respuesta que pone una cookie. Si la página personaliza el HTML con una cookie propia (idioma, moneda, un test A/B), incluya su valor en `etag` y no use `memory`, o no use `cache` en esa página. Véase [Caché de páginas SSR](framework.md#caché-de-páginas-ssr).

### Formularios sin JavaScript: `form` y `useForm({ action })`

Un endpoint de API con `form` atiende también un `<form method="post">` nativo, validado con el mismo schema de `body`:

```ts
// server/api/feedback.post.ts
export default defineApiRoute({
  body: feedbackInput,
  response: feedbackSaved,
  form: { redirect: (saved) => `/gracias?id=${saved.id}`, echo: ["comment"] },
  handler: ({ body }) => saveFeedback(body),
});
```

En el componente, `useForm({ action: "/api/feedback", … })` pinta en el SSR el resultado del envío nativo (`errors`, `error`, `failure` o `submitted`), y el formulario lleva `method="post"`, `action`, un campo oculto `return` con `useRoute().url.value` y otro `_csrf` con `form.csrfToken`. Con JavaScript, `on:submit="form.submit"` sigue enviando JSON con la misma definición. Al adoptarlo:

- Cada control necesita el `name` de su campo. Una casilla sin marcar no envía nada: declárela con `v.optional(v.boolean(), false)`.
- Tras un error, por defecto no vuelve ningún valor enviado, sólo el código y los mensajes. Liste en `form.echo` los campos que el usuario no debería volver a escribir, nunca contraseñas, números de tarjeta ni otros datos sensibles: viajan en una cookie y en el HTML.
- Un schema asíncrono se ejecuta una sola vez: convierta el texto de sus campos numéricos o booleanos en el propio schema.
- Un formulario para usuarios con sesión va en una página `"ssr"`: el HTML de una página prerenderizada no lleva el token CSRF, así que el envío sin JavaScript recibiría `403 INVALID_CSRF`.
- Todo envío nativo exige un `Origin` permitido; una página servida con `Referrer-Policy: no-referrer` no puede usar formularios nativos.

Véase [Formularios sin JavaScript](framework.md#formularios-sin-javascript-form).

### `rateLimit` en SQL

Sin Redis, los contadores de `rateLimit` se comparten entre instancias con la base de datos: implemente el método opcional `rateLimit(key, windowMs, now)` en su `SqlSessionDriver`, con una sola sentencia atómica que devuelva la fila `{ count, windowEndsAt }` (tipo `SqlRateLimitRow`); `SqlSessionStore` delega en él. La guía documenta la tabla `UNLOGGED` de referencia para PostgreSQL y su `INSERT … ON CONFLICT DO UPDATE … RETURNING`. En Cloudflare, `D1SessionDriver` lo implementa con la opción `rateLimitTable`, cuyo esquema devuelve `D1SessionDriver.rateLimitSchema()`; es opcional porque necesita una migración. Sin `rateLimit` en el driver todo sigue como en `1.6`. Véase [Rate limit en SQL](framework.md#rate-limit-en-sql).

### `clientAddress`

`clientAddress(request, env?)` de `@meekojs/meeko/server` da la IP del cliente donde no hay `RequestContext`, como en `defineServerMiddleware` o en un handler de `addServerHandler`, con la misma política que `context.clientAddress` y `rateLimit`: la IP de la conexión o, con `MEEKO_TRUST_PROXY`, la entrada de `X-Forwarded-For` que añadió el proxy de confianza más externo. Si un middleware leía `X-Forwarded-For` a mano, que cualquier cliente puede falsificar, cámbielo por `clientAddress(request)`. Véase [IP del cliente tras un proxy](framework.md#ip-del-cliente-tras-un-proxy).

### Rutas dinámicas en el sitemap: `sitemapEntries`

Una ruta dinámica con SSR (`/docs/[slug]`) no aparecía en `sitemap.xml`. `definePage({ sitemapEntries })` declara sus URL: una lista de `{ params, lastmod?, changefreq?, priority? }` o una función, síncrona o asíncrona, que `meeko build` evalúa una vez después de prerenderizar. En una ruta `render: "prerender"` sólo completa sus páginas prerenderizadas con esos campos. Véase [Rutas dinámicas en el sitemap](framework.md#rutas-dinámicas-en-el-sitemap-sitemapentries).

### `services` tipados

Con `server/runtime.ts` en TypeScript no hay nada que hacer: tras `meeko check` o `meeko dev`, `context.services` tiene el tipo de lo que devuelve su `services`. Quite las conversiones `as unknown as MisServicios`; para una función que recibe los servicios, use el tipo `AppServices`. Un host propio sin las declaraciones generadas amplía `GeneratedServices` a mano. Véase [Tipos de los servicios](framework.md#tipos-de-los-servicios).

### Búsqueda mientras se escribe: `debounceMs` y `enabled`

`useApi` y `useRpcQuery` aceptan `debounceMs` (una sola petición por ráfaga, cancelando la que estaba en curso) y `enabled` (un booleano, una señal o una función; mientras vale `false` no pide nada y conserva `data`):

```ts
const results = useRpcQuery("docs.search", () => ({ q: query.value.trim() }), {
  debounceMs: 200,
  enabled: () => query.value.trim().length >= 2,
});
```

Si tenía un `setTimeout` propio o un `if` alrededor de la consulta, puede quitarlo. Véase [Búsqueda mientras se escribe](framework.md#búsqueda-mientras-se-escribe-debouncems-y-enabled).

## La referencia de la API

El sitio tiene una referencia nueva en [`/docs/reference`](https://meeko.diegootayza.com/docs/reference): una página por símbolo (componentes, macros, composables, reactividad, utilidades, sintaxis, servidor, adaptadores, comandos y configuración), con su tipo exacto tomado del código, ejemplos y los errores comunes con su mensaje real, y la lista de todos los exports por módulo en [`/docs/reference/exports`](https://meeko.diegootayza.com/docs/reference/exports). Sus fuentes están en [`docs/reference`](reference/README.md).

## Editor

La extensión de VS Code `1.7.0` incluye el servidor de lenguaje de Meeko `1.7`: `context.services` con el tipo de `server/runtime.ts`, los autoimports nuevos, el aviso `MEEK119`, la comprobación de un componente con las reglas del proyecto y los errores de tipos nuevos. Con `meeko.languageServer.preferWorkspace` (activado por defecto) usa el servidor del `@meekojs/meeko` del proyecto, así que lo nuevo llega al actualizar el paquete a `1.7`. Véase [Editores](editors.md).
