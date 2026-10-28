# Actualizar de 1.2 a 1.3

`1.3` es un minor: lo nuevo (el adaptador `static`, `site`, `sitemap`, `robots`, `document.seo`, la CSP con hashes, `trustHtml`, `isClientError`, `imports.appDirs` e `imports.sharedDirs`, el completado de clases CSS en el editor, el orden de clases con Prettier…) es opcional. Un cambio, sólo de tipos, se publica como [excepción aprobada](stability.md#excepciones-aprobadas) a la política de estabilidad: las declaraciones de `@meekojs/meeko/postcss` tipadas con csstype. Además, algunos cambios se notan al actualizar: diagnósticos nuevos, la salida del formato de Prettier, el tratamiento de los fallos globales en el navegador y en el servidor, y los logs del servidor en la consola del navegador durante `meeko dev`. Esta guía los reúne con lo que conviene revisar en cada uno. La lista completa, con lo añadido y corregido, está en el [CHANGELOG](../packages/meeko/CHANGELOG.md); los compromisos de compatibilidad, en la [política de estabilidad](stability.md).

## Orden recomendado

1. Actualice `@meekojs/meeko` a la versión exacta `1.3.0` y vuelva a compilar o construir, incluidas las páginas prerenderizadas: el código generado y el runtime deben tener la misma versión. Si usa la extensión de VS Code, actualícela a `1.3.0`; Meeko DevTools no cambia (sigue en `1.0.0`).
2. Ejecute `meeko check`. Corrija los errores `MEEK108`, que señalan código que ya fallaba, y revise los avisos `MEEK107` y `MEEK109`, que no hacen fallar la comprobación (véase [Diagnósticos nuevos](#diagnósticos-nuevos)).
3. Si usa `@meekojs/meeko/postcss`, compruebe sus módulos de `@utilities` con TypeScript (véase [Declaraciones de `@meekojs/meeko/postcss` tipadas con csstype](#declaraciones-de-meekojsmeekopostcss-tipadas-con-csstype)).
4. Si formatea con el plugin de Prettier, ejecute `prettier --write` una vez y guarde el resultado en un commit propio: la salida del formato cambia (véase [Formato con Prettier](#formato-con-prettier)).
5. Revise el `onError` de `mountClientApp` y el de `server/runtime.ts`, y los `switch` sobre `ErrorSource`: reciben fallos que antes no les llegaban, y un rechazo sin manejar ya no termina el proceso del servidor (véase [Errores](#errores)).
6. Si `meeko.config.ts` tiene una entrada de `imports.serverDirs` fuera de `server/`, corríjala: ahora la configuración no carga (véase [Carpetas de autoimports](#carpetas-de-autoimports)).

## Excepción aprobada

### Declaraciones de `@meekojs/meeko/postcss` tipadas con csstype

El objeto de declaraciones de `rule()` y `atRule()` (`UtilityDeclarations`) usa los tipos de [csstype](https://github.com/frenic/csstype) en lugar de aceptar cualquier clave con una cadena o un número. El editor autocompleta las propiedades estándar y con prefijo de proveedor, en camelCase y en kebab-case, y las palabras clave de cada valor. El CSS que genera el plugin no cambia: es una corrección sólo de tipos, y casi todo lo que ahora se rechaza ya fallaba en el navegador, que descarta en silencio una propiedad desconocida o un `padding: 4`. `csstype` pasa a ser una dependencia del paquete, sólo de tipos.

Qué revisar al comprobar los módulos de `@utilities` con TypeScript:

- **Una propiedad que csstype no conoce** (`backgroundColr`) es un error: corrija el nombre. Para una propiedad o una at-rule recientes que csstype todavía no incluye, escriba el CSS con `` css`…` ``.
- **Las longitudes y los tiempos son cadenas con unidad**, salvo el `0`: `padding: 4`, que el plugin escribía sin unidad, es un error. Escriba `padding: "4px"`. Los números siguen valiendo donde CSS los admite sin unidad (`opacity`, `zIndex`, `flexGrow`, `lineHeight`, `fontWeight`…).
- **Un objeto construido fuera de la llamada** pierde las palabras clave: `const base = { position: "absolute" }` es `{ position: string }`, que ya no es asignable. Anótelo con `UtilityDeclarations` o use `as const`.
- **Leer las declaraciones con una clave `string`** (`decls[key]` dentro de un `for` sobre `Object.keys(decls)`) es el error `TS7053` con `noImplicitAny` (incluido en `strict`), porque `UtilityDeclarations` ya no tiene la firma de índice `[property: string]`. Use `Object.entries(decls)` o una clave `keyof UtilityDeclarations`.

```ts
// app/styles/utilities/surface.ts
import { defineUtilities } from "@meekojs/meeko/postcss";
import type { UtilityDeclarations } from "@meekojs/meeko/postcss";

// Antes: compilaba, pero el navegador descartaba «padding: 4»
const base = { position: "absolute", padding: 4 };

// Después
const base: UtilityDeclarations = { position: "absolute", padding: "4px" };
// o: const base = { position: "absolute", padding: "4px" } as const;

export default defineUtilities(({ rule }) => [rule(".surface", base)]);
```

Siguen compilando las propiedades `--*`, las claves en kebab-case, los arrays de respaldo (también con `as const`), `undefined`, `!important` y las claves dinámicas de `Object.fromEntries` o de un `Record<string, string>`. `atRule()` acepta además los descriptores de `@font-face`, `@property`, `@page`, `@counter-style`, `@font-palette-values` y `@view-transition`, con el nuevo tipo `UtilityAtRuleDeclarations`. Véase [Utilidades generadas con TypeScript](framework.md#utilidades-generadas-con-typescript).

## Diagnósticos nuevos

### `MEEK107`: `html="..."` sin `trustHtml`

`meeko check`, `meeko build` y el editor avisan con `MEEK107` cuando el valor de `html="..."` no es asignable a `TrustedHtml | null | undefined`: un `string`, `string | undefined`, una concatenación con un `string` o `any` (por ejemplo, el resultado de `JSON.parse` o de `response.json()`). Es un aviso: no hace fallar la comprobación y no cambia el SSR, la hidratación ni el código generado. Insertar un `string` sin marcar está deprecado y en `2.0` será un error de `meeko check`.

Marque el HTML donde se produce, no justo antes de la plantilla. `trustHtml` no sanea, sólo declara: sanee antes el HTML que viene de usuarios o de terceros. Para mostrar texto, `{expr}` escapa y no necesita nada de esto.

```ts
// server/content/articles.ts
import DOMPurify from "isomorphic-dompurify";
import { trustHtml } from "@meekojs/meeko";
import type { TrustedHtml } from "@meekojs/meeko";

export function commentHtml(input: string): TrustedHtml {
  return trustHtml(DOMPurify.sanitize(input));
}
```

- `TrustedHtml` y `trustHtml` se importan de `@meekojs/meeko`; no son autoimports.
- La marca llega a la plantilla desde `<script server>`, `load` y `ServerData<T>`: declare `TrustedHtml` en los tipos compartidos de esos datos.
- No avisan los tipos literales de texto y sus uniones (`html="'<br>'"`). Una constante del `<script>` sin anotación, como `const icon = "<svg>…</svg>"`, llega a la plantilla como `string`: escriba `as const` o márquela con `trustHtml`.

Véase [HTML de confianza](api.md#html-de-confianza-trustedhtml-y-trusthtml).

### `MEEK108` y `MEEK109`: cada API en su sitio

El `<script>` y la plantilla de un componente se ejecutan en SSR y también en el navegador; `<script server>` y los sidecars `*.route.ts`, sólo en el servidor. `meeko check`, `meeko build` (también el plugin de Vite en `meeko dev`) y el editor señalan ahora, con un mensaje que dice dónde se usa, cada API escrita donde no existe:

- **Error `MEEK108`.** En el `<script>` o la plantilla: un autoimport de servidor (`defineApiRoute`, `defineRpc`, `defineServerMiddleware`, `defineSocketChannel`, `defineServerRuntime`, `ApiError` o uno de `server/utils`, de `imports.serverDirs` o un `*.server.ts`), un import de valores de `@meekojs/meeko/server` o `/cloudflare`, o un import de `server/` o de un módulo `*.server.*`. En `<script server>`: una macro del componente (`defineProps`, `defineEmits`, `defineExpose`, `defineModel`, `defineSnippets`, `useElementRef`) y `onMounted`. Todo eso ya fallaba antes de `1.3` (el autoimport no se resolvía en el bundle del navegador, `/server` y `/cloudflare` lanzan al cargarse allí, un import de `server/` detenía `meeko build`); ahora el error llega antes y en su línea. Pida los datos con `useApi` o `useRpcQuery`, o mueva el código a `<script server>`.
- **Aviso `MEEK109`.** En el `<script>` o la plantilla: `definePage`, que ahí no configura la ruta, y los imports de valores de `@meekojs/meeko/node`, `/bun`, `/deno`, `/password` o `/build`, cuyas funciones sólo funcionan en el servidor. Ese código compila y se carga, así que es un aviso; está deprecado y en `2.0` será un error.
- `usePage`, `redirect` y `notFound` sin import en el `<script>` dan `MEEK073`, como ya ocurría al importarlos.

Los `import type` siguen admitidos en todos los casos, y un componente dentro de `server/` (una plantilla de correo, por ejemplo) puede usarlo todo. El build y `meeko dev` sólo aplican `MEEK108` al bundle del navegador, así que un componente fuera de `server/` que sólo importa código de servidor sigue compilando; `meeko check` y el editor, que no conocen el grafo de imports, lo comprueban como código del navegador: para que lo acepten, póngalo en `server/`.

```html
<!-- Antes: app/pages/about.meeko. definePage no tenía efecto aquí (MEEK109) -->
<script lang="ts">
const route = definePage({ render: "prerender" });
</script>

<!-- Después -->
<script server lang="ts">
export const route = definePage({ render: "prerender" });
</script>
```

Además, el autocompletado del `<script>` y de la plantilla ya no ofrece los exports de `@meekojs/meeko/server`, `/node`, `/bun`, `/deno`, `/password`, `/build` y `/cloudflare`, los módulos de `server/` y `*.server.*`, ni `definePage`, `usePage`, `redirect` y `notFound`; `<script server>` los sigue ofreciendo. Véase [Dónde se usa cada API](framework.md#dónde-se-usa-cada-api).

## Formato con Prettier

Los dos primeros cambios afectan a la salida del formato, que la [política de estabilidad](stability.md) permite cambiar en un minor. `prettier --check` puede marcar archivos que pasaban con `1.2`, y el formato al guardar del editor puede cambiar líneas que no se han tocado. Formatee el proyecto una vez tras actualizar y guarde el resultado en un commit propio, para que no se mezcle con otros cambios.

### Atributo `class` normalizado

En la plantilla de los `.meeko`, el valor de cada `class="…"` estático de un elemento se normaliza siempre, sin opción, como hace Prettier con el HTML suelto: se quitan los espacios del principio y del final, cualquier secuencia de espacios, tabuladores o saltos de línea queda en un espacio y una clase repetida desaparece (se conserva la primera). Las clases del elemento no cambian, porque los atributos estáticos de Meeko no interpolan `{expr}`. No se tocan `bind:class`, el `class` de una etiqueta de componente (`<Card class="…">`, una prop estática) ni un valor con referencias de carácter (`&amp;`).

### Arrays: `meekoPreserveArrayBreaks`

La nueva opción `meekoPreserveArrayBreaks`, activa por defecto, aplica a los arrays la regla de `objectWrap: "preserve"` de los objetos: un array, un patrón de desestructuración o una tupla con un salto de línea entre `[` y su primer elemento se imprime con un elemento por línea aunque quepa en `printWidth`. Sin ese salto decide Prettier; para colapsar un array, una `[` con el primer elemento y vuelva a formatear.

El plugin sustituye para ello el printer `estree` de Prettier, así que, con el plugin en la configuración del proyecto, la regla alcanza a todo el JavaScript y TypeScript que formatee Prettier (`.ts`, `.js`, `.tsx`, `.mjs`…), no sólo a los `.meeko`. El printer delega en el `estree` del Prettier que lo ejecuta, aunque sea otra versión 3.x que la que instala Meeko. Si otro plugin de la configuración también sustituye `estree`, Prettier usa sólo el del último de la lista `plugins`. Para recuperar exactamente la salida de Prettier, desactívela en la configuración de Prettier del proyecto, que también lee el editor (el servidor de lenguaje no tiene un ajuste propio):

```json
{ "plugins": ["@meekojs/meeko/prettier"], "meekoPreserveArrayBreaks": false }
```

### Orden de clases: `meekoSortClasses`

Es opcional y está desactivado (`"off"`). `"alphabetical"` ordena las clases de cada `class="…"` estático por código de carácter, y `"stylesheet"` por su primera aparición en `app/styles/main.css` (procesada con el Vite y el PostCSS del proyecto, como en `meeko dev`) y después en el `<style>` del componente, como `prettier-plugin-tailwindcss`. En la CLI, la opción sólo se reconoce si el plugin se pasa con `--plugin` (`--plugin @meekojs/meeko/prettier --meeko-sort-classes stylesheet`). Si la hoja no existe o falla, las clases sólo se normalizan y se avisa una vez en la salida de errores. En un workspace no confiable de VS Code no se ordena, porque procesar la hoja ejecuta código del proyecto. La caché de `prettier --cache` no conoce la hoja: tras cambiarla, ejecute la CLI sin `--cache`. Véase [Orden por la hoja global](editors.md#orden-por-la-hoja-global).

## Errores

### Fallos globales del navegador

Mientras la aplicación está montada, `mountClientApp` escucha `error` y `unhandledrejection` en `window`. Las excepciones no capturadas y las promesas rechazadas sin manejar del código que no pasa por Meeko (un `setTimeout` que lanza, un `fetch().then()` sin `catch`, una librería) llegan a `onError` y a `app.onError` de los plugins, con las fuentes nuevas `"uncaught"` y `"rejection"`; si no hay ninguno, al primer `provideErrorHandler` activo. Qué revisar:

- **Más fallos en los observadores.** Un `onError` que envía cada error a un servicio de registro recibe ahora también los de las librerías y del código asíncrono suelto. Lo mismo un `provideErrorHandler` de `app/app.meeko` en una aplicación sin `onError`.
- **Menos mensajes en la consola.** Cuando un observador recibe el fallo, Meeko llama a `preventDefault()` y el navegador no lo repite en la consola. Si contaba con verlo allí, escríbalo usted desde el observador. Sin ningún observador, el navegador lo muestra como siempre.
- Un error que ya recibió un observador de Meeko no se informa otra vez, y el `"Script error."` opaco de un script de otro origen cargado sin CORS se deja a la consola.

Véase [Fallos globales del navegador](framework.md#fallos-globales-del-navegador).

### `ErrorSource` gana `"uncaught"` y `"rejection"`

`ErrorSource`, el segundo argumento de los observadores del navegador, es una unión que Meeko entrega a la aplicación, así que, según la [política de estabilidad](stability.md#api-pública), puede ganar miembros en un minor. Un `switch` exhaustivo que comprueba `never` deja de compilar: añada una rama por defecto.

```ts
provideErrorHandler((error, source) => {
  switch (source) {
    case "navigation":
      showNavigationError(error);
      break;
    case "uncaught":
    case "rejection":
      report(error, { global: true });
      break;
    default:
      report(error);
  }
});
```

Para refinar el error en esos observadores, que reciben `unknown`, `isClientError(error, "UNAUTHENTICATED")` de `@meekojs/meeko/framework` comprueba un `ClientError` y su código, también el de otra copia de Meeko en la página, donde `instanceof` falla.

### Fallos fuera de una petición: `processErrors`

En el servidor, una promesa que nadie espera dentro de un handler, un `setTimeout` que lanza o el callback de una librería quedan fuera del `try` de la petición. Hasta `1.2`, Node, Bun y Deno terminaban el proceso con el primer rechazo sin manejar o la primera excepción no capturada, también en `meeko dev`. Desde `1.3`, `meeko dev`, las salidas de `meeko build` (Node, Bun, Deno y Workers) y `serveNode` y `serveDeno` con `handleSignals` aplican por defecto esta política:

- **Un rechazo sin manejar** llega al `onError` de `server/runtime.ts` y **el servidor sigue atendiendo**.
- **Una excepción no capturada** llega a `onError` y el servidor se cierra de forma ordenada: deja de aceptar conexiones, espera las respuestas abiertas y las tareas de `waitUntil`, cierra la aplicación y **sale con código 1**.

Qué revisar:

- Si el despliegue confiaba en que un rechazo reiniciara el proceso (un supervisor, `restart: always`), declare `processErrors: { unhandledRejection: "shutdown" }`.
- `onError` recibe estos fallos con un tercer argumento, `{ kind, inRequest }` (tipo `ServerErrorInfo`); los fallos de una petición no lo llevan. El ID es el de la petición (`x-request-id`) cuando el runtime conserva su contexto asíncrono hasta el evento; si no, es un ID nuevo. Sin `onError`, Meeko escribe el error completo en la consola.
- Si la aplicación registró sus propios `process.on("uncaughtException" | "unhandledRejection")`, Meeko sólo informa a `onError` y deja que ella decida.
- En Cloudflare Workers no hay proceso que cerrar: sólo se informan los rechazos.

```ts
// server/runtime.ts
export default defineServerRuntime(() => ({
  processErrors: { unhandledRejection: "shutdown" }, // o false para el comportamiento del runtime
  onError(error, requestId, info) {
    if (info) logger.fatal({ kind: info.kind, inRequest: info.inRequest, requestId }, error);
    else logger.error({ requestId }, error);
  },
}));
```

`processErrors: false` desactiva los dos casos y deja decidir al runtime, como en `1.2`; `"off"` en uno de ellos lo hace sólo para ese caso. Un host propio que no usa `serveNode` ni `serveDeno` puede aplicar la misma política con `handleProcessErrors(app, { close })` de `@meekojs/meeko/server`. Véase [Fallos fuera de una petición](framework.md#fallos-fuera-de-una-petición).

## Desarrollo

### Logs del servidor en la consola del navegador

En `meeko dev`, lo que el código de servidor escribe con `console.log`, `info`, `warn`, `error` o `debug` mientras atiende una petición aparece también en la consola del navegador, agrupado por petición y con la insignia `server`, como `features.devLogs` de Nuxt. La terminal lo sigue mostrando igual. Sólo existe en desarrollo, nunca en `meeko build`, `meeko start` ni `meeko preview`, y sólo llega al navegador del propio equipo: las peticiones desde loopback, a un host de loopback y sin cabeceras de proxy, así que tampoco a los visitantes de un túnel como ngrok o cloudflared.

Si una prueba de extremo a extremo contra `meeko dev` falla ante cualquier mensaje de error en la consola del navegador, ahora también verá los `console.error` del servidor. Para desactivarlo:

```ts
// meeko.config.ts
export default defineMeekoConfig({ dev: { serverLogs: false } });
```

El puerto del WebSocket de HMR (`MEEKO_HMR_PORT`) no debe publicarse por un túnel: quien se conecte a él recibe los logs de todas las peticiones. Véase [Logs del servidor en la consola del navegador](framework.md#logs-del-servidor-en-la-consola-del-navegador).

### `.meeko/styles/main.css`

`meeko dev` escribe `app/styles/main.css` ya procesada (con los `@import` resueltos y las `@utilities` expandidas) en `.meeko/styles/main.css`, para que el editor complete las clases generadas. Es un archivo nuevo dentro de `.meeko/`, que ya contiene otros archivos generados: no lo edite ni lo versione. Vite no lo vigila, así que escribirlo no recarga la página; `meeko build` no lo escribe y `meeko clean` lo elimina. Su contenido no es contrato, pero su ruta se mantiene durante `1.x`, de modo que puede nombrarlo en `"css.styleSheets"` de extensiones como HTML CSS Support. Véase [Hoja global procesada para el editor](framework.md#hoja-global-procesada-para-el-editor).

## Configuración y build

### Carpetas de autoimports

`imports.appDirs` e `imports.sharedDirs` añaden, junto a `imports.serverDirs`, carpetas de autoimports dentro de `app/` (con el ámbito de `app/`: navegador y SSR) y de `shared/` (con el ámbito de `shared/`). Son opcionales:

```ts
// meeko.config.ts
export default defineMeekoConfig({
  imports: {
    appDirs: ["app/services"],
    sharedDirs: ["shared/validators"],
    serverDirs: ["server/services"],
  },
});
```

Al adoptarlas, un export de esas carpetas con el mismo nombre que otro autoimport de su ámbito produce el error de colisión, como en las carpetas por defecto, y un `*.server.ts` de una carpeta de `appDirs` es código de servidor (un componente que lo usa da `MEEK108`).

Lo que cambia sin adoptarlas es la validación: cada entrada de `imports` debe ser una ruta relativa dentro de su carpeta, sin `.` ni `..`, y se comprueba al cargar `meeko.config.ts`. Una entrada no válida de `serverDirs` (`"lib/services"`, `"../shared"`, una ruta absoluta), que hasta `1.2` se rechazaba al leer los autoimports, detiene ahora la carga de la configuración, y por tanto todos los comandos que la leen, con un error que nombra la entrada: `imports.serverDirs[0] must be a relative path inside server/: lib/services`. Un `imports` que no es un objeto también es un error. El editor, en un workspace de confianza, marca la entrada con `MEEK_CONFIG`. Si un script buscaba el texto anterior (`serverDir de autoimports debe ser…`), haga que use el código de salida. Véase [Carpetas de autoimports](framework.md#carpetas-de-autoimports).

### Sitio estático, `site`, `sitemap`, `robots` y `document.seo`

Son opcionales y no cambian nada mientras no se activan:

- **Adaptador `static`.** `meeko build --adapter static` (o `server: { adapter: "static" }`) escribe en `.meeko/output/static/` un sitio para cualquier hosting estático, con cada página como `<ruta>/index.html`, su payload `<ruta>/index.meeko.json` y `404.html` desde `app/error.meeko`. Todas las páginas deben ser `render: "prerender"`, y el build falla, antes de compilar, con la lista de lo que necesita un servidor (páginas `"ssr"`, `"stream"` o `"client"`, API, RPC, Socket, middleware de servidor y handlers de servidor de los módulos). Véase [Sitio estático](framework.md#sitio-estático).
- **`site`.** El origen público de las URL absolutas que escribe el build; sin él, se usa `MEEKO_PUBLIC_ORIGIN` del entorno del build. No cambia las comprobaciones de `Origin`, que siguen leyendo `MEEKO_PUBLIC_ORIGIN` o `publicOrigin` al ejecutarse.
- **`sitemap` y `robots`.** Generan `sitemap.xml` y `robots.txt` en el build, para todos los adaptadores. Con `sitemap` y sin origen, el build falla. Si el proyecto ya tiene un `public/sitemap.xml` o `public/robots.txt`, quítelo antes de activar la opción correspondiente: el build falla si chocan. Véase [`sitemap.xml` y `robots.txt`](framework.md#sitemapxml-y-robotstxt).
- **`document.seo`.** Añade `<link rel="canonical">`, `og:url`, `og:title` y `og:description` a cada documento. Una página o un layout que ya declara la misma etiqueta la sustituye, así que las etiquetas propias se conservan. Con `canonical` u `ogUrl` activos y sin origen, `meeko build` falla. Véase [Canónica y Open Graph por página](framework.md#canónica-y-open-graph-por-página).

### CSP con hashes

`prerender/manifest.json` gana en cada página el campo opcional `scriptHashes`, con las fuentes `'sha256-…'` de sus scripts en línea; un lector propio del índice debe tolerar el campo. `inlineScriptHashes(html)` de `@meekojs/meeko/build` y `contentSecurityPolicy(policy, hashes)` de `@meekojs/meeko/server` permiten construir la cabecera en un host propio, y el adaptador `static` lo hace con `server.contentSecurityPolicy`, `server.headers` y `server.headerFiles`. Con `server.contentSecurityPolicy` en el adaptador `static`, un atributo `on*` o una URL `javascript:` en una página hacen fallar el build, porque un hash no puede permitirlos: use un script o `on:` del componente. `meeko start` no añade esa cabecera: para las páginas con SSR la vía sigue siendo el nonce de `DocumentOptions.nonce`. Véase [CSP con hashes](framework.md#csp-con-hashes).

## Tipos

### `definePage` con una firma

Una firma nueva, la primera, cuya opción es la unión de `PageDefinition` y `ClientPageDefinition`, resuelve las llamadas sin argumentos de tipo. Con un `render` todavía incompleto, el editor ofrece ahora `"ssr"`, `"stream"`, `"prerender"` y `"client"`, en lugar de sólo `"client"`. La inferencia no cambia (el contexto de `load` según el modo, los datos de `head` y el `load` obligatorio en el resultado), pero sí dos cosas visibles:

- **El mensaje de error** de `render: "client"` con `prerenderEntries` empieza ahora por «No overload matches this call» y señala `render`, `prerenderEntries` y `load` como incompatibles. Si una prueba de tipos comprobaba el texto anterior, actualícela.
- **El hover** muestra la firma nueva, con un parámetro de tipo más, `T`.

Las cuatro sobrecargas de `1.2` siguen detrás para las llamadas que escriben los argumentos de tipo hasta `D` (`definePage<P, S, D, C>(…)`, la forma de tipar el contexto `C`): el resultado sigue siendo el tipo del modo de `render`, con `load` obligatorio si se declara. Una llamada con argumentos de tipo parciales (`definePage<P>(…)` o `definePage<P, S>(…)`) sigue comprobando sus opciones según su modo, pero su resultado es ahora `PageDefinition<P, S, unknown, unknown>`, aunque `render` sea `"client"`, y `load` es opcional en el tipo. Si su código lee el tipo del resultado, quite los argumentos de tipo, que se infieren de las opciones, o escríbalos hasta `D`.

## Editor

La extensión de VS Code `1.3.0` incluye el servidor de lenguaje y el plugin de Prettier de Meeko `1.3`. Cambios visibles:

- **Completado de clases CSS** en `class="…"` y en las cadenas de `bind:class`: las clases del `<style>` del componente, de los `<style>` sin `scoped` de los demás componentes y de `app/styles/main.css` con sus `@import` locales, más las de `.meeko/styles/main.css` si `meeko dev` la ha escrito. El hover muestra la regla e ir a definición lleva al selector. Funciona en workspaces sin confianza, porque sólo lee CSS. Si usaba HTML CSS Support sólo para esto, ya no la necesita. Véase [Completado de clases CSS](editors.md#completado-de-clases-css).
- **Formato al guardar:** la normalización de `class`, `meekoPreserveArrayBreaks` y, si la configuración de Prettier del proyecto lo pide, `meekoSortClasses` (véase [Formato con Prettier](#formato-con-prettier)). El servidor incluido en la extensión no empaqueta Vite: con `"stylesheet"`, carga el Vite del proyecto y, si no lo encuentra, sólo normaliza.
- **Diagnósticos `MEEK107`, `MEEK108` y `MEEK109`** en su línea, y un completado del `<script>` y de la plantilla sin APIs de servidor (véase [Diagnósticos nuevos](#diagnósticos-nuevos)).
- **`imports.appDirs` e `imports.sharedDirs`** se leen también en un workspace no confiable, como arrays literales de cadenas, igual que `imports.serverDirs`.
