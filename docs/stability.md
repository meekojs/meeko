# Política de estabilidad 1.x

A partir de `1.0.0`, `@meekojs/meeko` sigue [Semantic Versioning](https://semver.org/lang/es/). Esta página define qué cubre esa promesa, qué queda fuera, cómo se retira una API y en qué entornos se ejecuta Meeko. Los cambios de cada versión se registran en el [CHANGELOG](../packages/meeko/CHANGELOG.md); la actualización desde `0.1.0` se explica en la [guía de migración a 1.0](migration-1.0.md), la de `1.0` a `1.1`, en [Actualizar de 1.0 a 1.1](migration-1.1.md), la de `1.1` a `1.2`, en [Actualizar de 1.1 a 1.2](migration-1.2.md), la de `1.2` a `1.3`, en [Actualizar de 1.2 a 1.3](migration-1.3.md), la de `1.3` a `1.4`, en [Actualizar de 1.3 a 1.4](migration-1.4.md), y la de `1.4` a `1.5`, en [Actualizar de 1.4 a 1.5](migration-1.5.md).

| Versión | Puede incluir |
| --- | --- |
| Patch (`1.0.x`) | Correcciones compatibles y documentación. |
| Minor (`1.x.0`) | API, opciones, diagnósticos y convenciones nuevas que no rompen código existente, y deprecaciones con su reemplazo. |
| Major (`2.0.0`) | Cambios incompatibles y retirada de lo deprecado. |

Las prereleases (`1.1.0-rc.1`) se publican en el dist-tag `next` de npm y no forman parte de la promesa hasta su versión final.

## Un solo paquete

Compilador, runtime, framework, adaptadores, CLI y servidor de lenguaje se publican juntos en `@meekojs/meeko`, con una única versión. Durante 1.x no se separarán en paquetes que haya que coordinar.

El código que genera el compilador (módulos `.meeko` compilados, entradas bajo `.meeko/` y builds de `meeko build`) importa `@meekojs/meeko/internal`, y ambos deben tener **exactamente la misma versión**. Por eso `meeko init` y `meeko init-framework` fijan la versión exacta en el `package.json` generado. Al actualizar Meeko, vuelva a compilar o construir: no mezcle código generado por una versión con el runtime de otra, aunque ambas sean `1.x`.

## API pública

Lo que se enumera a continuación sólo cambia de forma incompatible en una versión major.

### Entradas del paquete

Las subrutas declaradas en `exports` de `package.json` y **todos** los símbolos y tipos que exportan, estén o no descritos en esta guía, [api.md](api.md), [framework.md](framework.md), [devtools.md](devtools.md) y [editors.md](editors.md); su referencia exacta son las declaraciones `.d.ts` publicadas. Las funciones de bajo nivel para hosts propios (por ejemplo `matchRoute`, `createNavigator`, `createSocketHub`, `dispatchApiRoute`, `dispatchRpc` o `createRequestContext`) también forman parte del contrato:

| Entrada | Contenido |
| --- | --- |
| `@meekojs/meeko` | Reactividad (`signal`, `computed`, `effect`, `batch`, `untrack`, `createRoot`, `onCleanup`), ciclo de vida (`onMounted`, desde `1.1`), contexto (`createContext`, `provide`, `inject`), `provideErrorHandler`, `serializeJson`, `trustHtml` (desde `1.3`), `useId` (desde `1.5`) y sus tipos, incluidos `TrustedHtml` (desde `1.3`), `TagName` y `ElementAttributes` (desde `1.5`, los tipos de las etiquetas que acepta `<component is>` y de los atributos de `bind="…"`) y los de componentes y del protocolo DevTools. Desde `1.5`, `useId` garantiza el mismo ID en el render del servidor y en la hidratación de la misma versión, único por instancia, con el prefijo de `document.idPrefix`; la forma concreta del ID no es contrato. |
| `@meekojs/meeko/framework` | Configuración, rutas, páginas, `defer`, estado (`useState` y, desde `1.2`, `useStorage` con sus tipos `StorageOptions` y `StorageArea`), navegación (`useNavigation` y, desde `1.2`, `useRoute` con su tipo `RouteState`, que gana el método `isActive` en `1.5`), formularios (`useForm` y su tipo `Form`, desde `1.2`; desde `1.5`, las opciones `onSuccess` y `focusInvalid`, los miembros `trySubmit`, `commit` y `field` de `Form`, los tipos `FormSubmission` y `FormField`, y la revalidación de los campos con error del schema en cada cambio), head del documento (`useHead`, `useSeoMeta` y los tipos `HeadInput`, `HeadMeta`, `HeadLink`, `HeadScript`, `HeadStyle`, `SeoMetaInput`, `DocumentConfig` y `DocumentHead`, desde `1.2`, `DocumentSeo`, desde `1.3`, y `DocumentConfig.idPrefix`, desde `1.5`), los tipos de configuración `SitemapConfig`, `RobotsConfig` y `StaticHeaderFile` (desde `1.3`), el tema (`useTheme` y los tipos `ThemeConfig`, `ThemeState`, `ThemeName`, `ThemeChoice`, `GeneratedTheme`, `ThemeToggleMessages` y `ThemeToggleSnippets`, desde `1.4`), los tipos de las props de las etiquetas propias (`MeekoLinkProps`, `MeekoOutletProps` y `MeekoThemeToggleProps`, desde `1.4`; `MeekoLinkProps` gana `match` en `1.5`, `MeekoAwaitProps`, con `AwaitResource`, `AwaitMessages` y `MeekoAwaitSnippets`, desde `1.5`; y `MeekoPopoverProps` y `MeekoSelectProps`, desde `1.5`, con `PopoverPlacement`, `PopoverMode`, `PopoverRole`, `PopoverTrigger`, `PopoverToggleEvent`, `PopoverSnippets`, `PopoverExposed`, `SelectModel`, `SelectOptionState`, `SelectFilter`, `SelectFilterContext`, `SelectSnippets` y `SelectField`) y `RouteId`, el ID de cualquier ruta de la aplicación (desde `1.4`), los layouts con nombre (`useLayout`, `defineGroup` y los tipos `LayoutName`, `LayoutProps`, `LayoutHandle`, `LayoutPropsInput`, `PageLayout`, `PageLayoutOptions`, `GroupDefinition`, `GeneratedLayouts`, `GeneratedPageLayouts` y `NamedLayoutRecord`, desde `1.5`), autoimportados, middleware de rutas, clientes API, RPC y Socket (`createSocketClient`, `createSocketRegistry`, `useSocketChannel`, `useSocketClient` desde `1.1` y su alias obsoleto `useSocket`), `isClientError` para los errores de esos clientes (desde `1.3`), las fábricas de los composables de datos (`createUseApi`, `createUseRpcQuery`, `createUseRpcMutation` y sus tipos, desde `1.1`; `createUseApiMutation`, las opciones `retrySafe` y sus tipos `ApiMutation`, `ApiMutationInput`, `ApiMutationContract`, `UseApiMutation`, `MutationOptions`, `MutationAttempt`, `MutationFailure`, `RetrySafeOptions`, `RetrySafeMutation` y `UncertainMutation`, desde `1.2`; `refreshing` y la opción `keepPrevious` con su tipo `DataResourceOptions`, desde `1.5`) y la API del código de nivel superior de `<script server>` (`usePage`, `redirect`, `notFound` y los tipos `PageRequest`, `PageRequestOf`, `PageBodyHead`, `ServerData`, `JsonShape` y `SerializableExport`, desde `1.1`). Desde `1.2`, el sistema de módulos y plugins: `defineMeekoModule` con sus tipos (`MeekoModule`, `MeekoModuleDefinition`, `MeekoModuleMeta`, `MeekoModuleEntry`, `MeekoModuleContext`, `MeekoHooks`, `MeekoHookable`, `ModuleAutoImport`, `ModulePlugin` y `ModuleServerHandler`) y `definePlugin` con los suyos (`MeekoPlugin`, `PluginApp`, `PluginErrorHandler`, `PluginErrorInfo` y `PluginRegistration`). Son contrato los miembros del objeto `meeko` de `setup`, los nombres de los hooks y sus contextos, y el orden de ejecución documentado de módulos y plugins; un minor puede añadir miembros, hooks y campos de contexto. |
| `@meekojs/meeko/vite` | Plugin `meeko()` de Vite. |
| `@meekojs/meeko/server` | Núcleo de servidor portable: `createServerApp`, `defineServerRuntime`, contratos API/RPC, sesiones y stores, middleware, Socket y sus brokers, `createSocketUpgradeHandler` y OpenAPI. Desde `1.2`, la aumentación de módulo de la interfaz `MeekoSession`, que tipa `RequestContext.session` (tipo `SessionData`), también es contrato. Desde `1.5`, el tercer argumento `{ message, issues }` de `ApiError`, su propiedad `issues` y los tipos `ApiErrorOptions` y `ApiErrorIssue`: los `issues` de un `ApiError` con estado `4xx` viajan en la respuesta de API y RPC con la forma de los de un `400` (como mucho 20) y nunca con un `5xx`. Desde `1.3`, `contentSecurityPolicy` y su tipo `ContentSecurityPolicy` (desde `1.4`, con el tercer argumento `styleHashes`), y la política de fallos del proceso: `processErrors` de `ServerRuntime` (tipo `ProcessErrorPolicy`), `handleProcessErrors` (tipo `ProcessErrorOptions`) y el tercer argumento opcional de `ServerErrorObserver` (tipo `ServerErrorInfo`); son contrato los valores por defecto documentados (un rechazo se informa y el servidor sigue; una excepción se informa y cierra con código 1). |
| `@meekojs/meeko/node` | Adaptador Node: `serveNode`, `toNodeListener`, `createNodeAssetReader`, `attachNodeWebSocketServer` y `createNodeSocketUpgradeHandler`. |
| `@meekojs/meeko/password` | Desde `1.2`: `hashPassword`, `verifyPassword` y `needsRehash`, con scrypt de `node:crypto` (Node, Bun y Deno). Es contrato el formato `scrypt$<N>$<r>$<p>$<sal>$<hash>`: un minor puede subir los parámetros por defecto, y `verifyPassword` acepta siempre los hashes escritos antes. |
| `@meekojs/meeko/bun` | Adaptador Bun: `createBunServer` y `createBunAssetReader`. |
| `@meekojs/meeko/deno` | Adaptador Deno: `serveDeno` y `createDenoAssetReader`. |
| `@meekojs/meeko/cloudflare` | Adaptador Cloudflare Workers: `createWorker`, `createSocketRoomClass`, `DurableObjectSocketPubSub`, `socketRoomName`, `D1SessionDriver`, `createCloudflareAssetReader`, `createCloudflarePrerenderSource` y sus tipos estructurales. |
| `@meekojs/meeko/build` | Herramientas de build para Node: descubrimiento, configuración, prerender y `buildProject`. Desde `1.3`, `inlineScriptHashes` y su tipo `InlineScriptReport` (desde `1.4`, también `inlineStyleHashes` y `styleHashes` en `PrerenderIndex`), y los tipos de configuración `SitemapConfig`, `RobotsConfig` y `StaticHeaderFile`, los mismos que exporta `@meekojs/meeko/framework`. Desde `1.5`, `discoverLayouts`, la opción `layouts` de `discoverRoutes`, de `composeFrameworkRoutes` y del nuevo segundo argumento de `discoverErrorPage`, y los tipos `DiscoverErrorPageOptions`, `StaticRouteOptions` y `StaticGroupOptions`. |
| `@meekojs/meeko/devtools-ui` | Panel DevTools integrado (`mountDevtoolsPanel`). |
| `@meekojs/meeko/prettier` | Plugin de Prettier para `.meeko` (desde `1.1`): el parser `meeko` y las opciones `meekoIndentSections`, `meekoPreserveArrayBreaks` (desde `1.3`; también sustituye el printer `estree` de Prettier) y `meekoSortClasses` (desde `1.3`, con los valores `off`, `stylesheet` y `alphabetical`). El nombre del parser y de las opciones son estables; la salida exacta del formato puede mejorar en un minor, como la de Prettier. |
| `@meekojs/meeko/postcss` | Plugin de PostCSS `meekoUtilities()` (desde `1.2`): la at-rule `@utilities "<ruta>" [layer(<nombre>)]`, `defineUtilities`, los helpers `rule`, `atRule` y `css` y sus tipos, con `UtilityAtRuleDeclarations` desde `1.3` y la opción `autoImports` desde `1.4`. Sólo se ejecuta en Node, en desarrollo y en el build. El formato exacto del CSS generado (espacios, saltos de línea) puede cambiar en un minor. |

`tests/package-boundaries.test.ts` fija la lista exacta de exports de la raíz y de las subrutas de `package.json`.

Los tipos forman parte del contrato. Hay dos matices:

- Una unión que Meeko **entrega** a la aplicación puede ganar miembros en un minor: por ejemplo `ErrorSource` (que gana `"uncaught"` y `"rejection"` en `1.3`), `PageRender`, `DeferredStatus`, `DevtoolsReadKind`, `DevtoolsEventKind`, el estado de un `SocketClient` (que gana `"unauthorized"` en `1.1`) o los códigos de error. Un `switch` exhaustivo sobre ellas debe tener una rama por defecto. Una unión que la aplicación **pasa** a Meeko no se estrecha en 1.x.
- Una interfaz de un objeto que Meeko **entrega** a la aplicación puede ganar miembros en un minor: por ejemplo `RouteState`, que devuelve `useRoute()` (gana `isActive` en `1.5`), `DataResource` y `LoadedResource`, de `useApi` y los recursos (ganan `refreshing` en `1.5`), o `Form` (gana `trySubmit`, `commit` y `field` en `1.5`). Léalas y desestructúrelas con normalidad, pero no las implemente a mano (`const route: RouteState = { … }`), porque un minor puede añadir un miembro obligatorio. En una prueba, un doble parcial con `Partial<RouteState>` o una conversión `as RouteState` sigue compilando. Las interfaces que la aplicación **pasa** a Meeko (opciones, configuración, contratos) sólo ganan miembros opcionales.
- Una corrección de tipos que rechaza código que ya fallaba en ejecución puede publicarse en un minor o un patch, con su entrada en el CHANGELOG.

#### Excepciones aprobadas

Cambios que rechazan código válido en ejecución y que se publican en un minor por decisión explícita, cada uno con su migración:

| Versión | Cambio | Motivo y migración |
| --- | --- | --- |
| `1.1` | `meeko check` y el editor comprueban las props de cada etiqueta de componente (`<Etiqueta>` o `<component is>`) sólo contra las que declara el hijo: una prop desconocida es un error aunque la acompañen props válidas. | En `1.0`, una prop sobrante pasaba la comprobación y en ejecución se ignoraba, así que no fallaba: el cambio no es una corrección de un fallo en ejecución, sino una excepción aceptada para detectar errores de escritura y props obsoletas. Basta con borrar la prop o declararla en el hijo; el comportamiento en ejecución no cambia. Véase [Actualizar de 1.0 a 1.1](migration-1.1.md#props-de-componente-más-estrictas). |
| `1.1` | `html="..."` y `model="..."` en un elemento HTML estándar (`<div>`, `<input>`…) son directivas: el valor es una expresión, y los usos no admitidos dan `MEEK095` y `MEEK065`. En los elementos personalizados (etiqueta con guion, como `<x-markdown html="intro">`) siguen siendo atributos HTML literales, como en `1.0`. | En `1.0` se escribían como atributos literales, pero `html` y `model` no son atributos válidos de ningún elemento HTML estándar, así que el navegador los ignoraba. Si una hoja de estilos o un script leía ese atributo, escríbalo como `data-html`/`data-model` o con `bind:html="'texto'"`, que sigue siendo un atributo. |
| `1.1` | El handshake de Socket ya no responde `401` ni `403` a un rechazo de sesión o de autorización del canal: los adaptadores de Meeko hacen el upgrade y cierran en seguida con `4401` o `4403`. El Origin no permitido sigue respondiendo `403` por HTTP. En `createSocketUpgradeHandler`, la acción `reject` de `SocketUpgrade` gana el campo opcional `close` con el código y el motivo. | El `WebSocket` del navegador no expone el estado HTTP de un handshake rechazado, así que el cliente reintentaba sin fin. Un cliente propio que esperaba el `401`/`403` HTTP debe tratar los cierres `4401`/`4403` como rechazo definitivo; el cliente de Meeko ya lo hace. La unión no gana miembros, de modo que un adaptador propio escrito para `1.0` sigue funcionando y responde `status` por HTTP mientras no atienda `close`. Véase [Actualizar de 1.0 a 1.1](migration-1.1.md#socket-cierres-4401-y-4403-en-el-handshake). |
| `1.2` | Un hijo compilado que recibe props nuevas sigue montado y sólo actualiza los bindings que leen la prop: el setup no se vuelve a ejecutar, así que un valor que copia una prop (`const { label } = props`, `props.title.toUpperCase()` o la entrada de `useApi(ruta, { query: { q: props.q } })`) conserva el valor inicial, y escribir en `props` lanza `TypeError`. Los componentes con un `await` de datos en el nivel superior se siguen montando de nuevo. | Reconstruir el hijo reemplazaba el `<input>` que el usuario estaba escribiendo, con su foco, su cursor y su composición, y los snippets que había recibido. Lea la prop donde se usa (`{props.label}`), derive con `computed(() => ...)` o pase una función a `useApi`/`useRpcQuery`; para cambiar un valor del padre, use un evento o un modelo. Véase [Props reactivas](api.md#props-reactivas) y [Actualizar de 1.1 a 1.2](migration-1.2.md#props-reactivas-lo-que-el-setup-copia-de-una-prop). |
| `1.2` | `context.session.create()` en una petición `POST`, `PUT`, `PATCH` o `DELETE` rechaza con `403 INVALID_ORIGIN` si su `Origin` falta o no está permitido, salvo que la ruta declare `origin: "none"`. | Corrección de seguridad (*login CSRF*): hasta `1.1`, una ruta de inicio de sesión sin comprobación propia que aceptara un formulario u otro cuerpo sin *preflight* de CORS dejaba que otra web iniciara sesión en el navegador de la víctima con una cuenta del atacante, y la opción `origin: "required"` no existía. No se puede corregir de forma compatible, así que se aplica la excepción de vulnerabilidades de la [política de deprecación](#deprecación): el cambio mínimo, con una salida explícita. Los navegadores ya envían `Origin` en esas peticiones, así que las aplicaciones web no cambian; un script o una app nativa debe enviar `Origin` o la ruta declarar `origin: "none"`, documentado como inseguro. Una aplicación detrás de un proxy que termina TLS y sin `MEEKO_PUBLIC_ORIGIN` (ni `publicOrigin`) ve su inicio de sesión rechazado con `403`, porque el servidor recibe `http://` y el navegador envía un `Origin` `https://`; esa misma aplicación ya fallaba en `1.1` en toda mutación autenticada, que comprueba el mismo Origin, así que no funcionaba antes y la corrección es la misma: fijar `MEEKO_PUBLIC_ORIGIN` con el origen público. Véase [framework.md](framework.md#origin-en-mutaciones-anónimas) y [Actualizar de 1.1 a 1.2](migration-1.2.md#sessioncreate-exige-un-origin-permitido). |
| `1.2` | En un elemento HTML o SVG de la plantilla, `event.currentTarget` de `on:evento` tiene el tipo del elemento de la etiqueta (`HTMLInputElement` en `<input>`) y `event`, el de `HTMLElementEventMap` (o `SVGElementEventMap`) para ese nombre. Una conversión explícita a un elemento no relacionado, como `event.currentTarget as HTMLSelectElement` en un `<input>`, es ahora un error de tipos (`TS2352`) en `meeko check`, `meeko build` y el editor. | Es una corrección sólo de tipos, sin cambio en ejecución: el código generado y el valor de `currentTarget` son los mismos que en `1.1`. Hasta `1.1`, `currentTarget` era un `EventTarget` genérico, así que cualquier conversión pasaba, incluida la que nombra otro elemento y lee una propiedad que el elemento real no tiene (`selectedIndex` en un `<input>`, que da `undefined`): el error que ahora aparece señala ese fallo. No se puede tipar el elemento sin rechazar esas conversiones. Migración: quitar la conversión, porque el tipo ya es el del elemento (`event.currentTarget.value`), o corregirla al elemento de la etiqueta. Las etiquetas de componente no cambian. |
| `1.3` | `UtilityDeclarations`, las declaraciones de `rule()` y `atRule()` de `@meekojs/meeko/postcss`, se tipan con csstype en lugar de aceptar cualquier clave con una cadena o un número: una propiedad que csstype no conoce (`backgroundColr`), una longitud o un tiempo numéricos distintos de `0` (`padding: 4`) y, en las propiedades que sólo admiten palabras clave (`position`, `boxSizing`…), una cadena que no es una de ellas o un `string` sin literal (`const base = { position: "absolute" }`) son errores de tipos. `atRule()` acepta los descriptores que csstype conoce mediante el nuevo `UtilityAtRuleDeclarations`. | Es una corrección sólo de tipos, sin cambio en ejecución: el plugin genera el mismo CSS que en `1.2`. Casi todo lo que ahora se rechaza ya fallaba en el navegador, que descarta en silencio una propiedad desconocida o `padding: 4`; el resto (una propiedad o un descriptor recientes que csstype aún no incluye, o un `string` ensanchado) es el coste aceptado de autocompletar y comprobar los nombres. Migración: corregir el nombre, escribir la unidad (`"4px"`), anotar el objeto con `UtilityDeclarations` o usar `as const`, y escribir con `` css`…` `` lo que csstype no conozca. Las claves dinámicas (`Object.fromEntries`, `Record<string, string>`), las propiedades `--*`, las claves en kebab-case, los arrays de respaldo y `!important` siguen compilando. Al desaparecer la firma de índice `[property: string]`, leer un objeto `UtilityDeclarations` con una clave `string` (`decls[key]` dentro de un `for` sobre `Object.keys(decls)`) es el error `TS7053` con `noImplicitAny` (incluido en `strict`); migración: tipar la clave como `keyof UtilityDeclarations` (`decls[key as keyof UtilityDeclarations]`) o, para iterar, usar `Object.entries(decls)`. Véase [framework.md](framework.md#utilidades-generadas-con-typescript) y [Actualizar de 1.2 a 1.3](migration-1.3.md#declaraciones-de-meekojsmeekopostcss-tipadas-con-csstype). |
| `1.4` | Un módulo cuyo `meta.configKey` es una clave propia de `MeekoConfig` (`layers`, `extends`, `modules`, `imports`, `server`, `css`, `document`, `dev`, `site`, `sitemap`, `robots` o `theme`) hace fallar la carga de la configuración con un mensaje que pide otra clave. Con `theme`, unas opciones que no son las del tema (`theme: { initial: "dark" }`) fallan con `unknown field`, y el mensaje apunta a ese conflicto. | Desde `1.4`, `theme` es la opción del tema claro/oscuro de Meeko, y el ejemplo de módulos de la guía de `1.3` usaba `configKey: "theme"`. Ese módulo leería como sus opciones las del tema de Meeko, su aumentación `MeekoConfig.theme` choca con el tipo de Meeko (`TS2717`) y unas opciones suyas en `theme` activarían el tema de Meeko o no pasarían su validación: no hay forma compatible de que convivan. Basta con dar al módulo otra clave (por ejemplo, `acmeTheme`), mover sus opciones a ella en `meeko.config.ts` y renombrar su aumentación de `MeekoConfig`; un módulo sin `configKey`, o con una clave que no es de Meeko, no cambia. Véase [Actualizar de 1.3 a 1.4](migration-1.4.md#un-módulo-con-configkey-theme). |
| `1.5` | `bind="..."` (sin nombre) en un elemento HTML estándar o en una etiqueta de componente es la directiva de [atributos en bloque](api.md#atributos-en-bloque-con-bind): el valor es una expresión. Hasta `1.4` era un atributo HTML literal `bind` o, en un componente, la prop estática `bind` con el texto. | Es la sintaxis que mejor encaja con `bind:nombre`, y `bind` no es un atributo HTML: en un elemento sólo podía escribir un atributo que el navegador ignora. Migración: escriba la prop o el atributo `bind` con `bind:bind="'texto'"`. Los elementos personalizados no cambian. Véase [Actualizar de 1.4 a 1.5](migration-1.5.md#bind-sin-nombre). |
| `1.5` | `alias` es una clave propia de `MeekoConfig`: un módulo con `meta.configKey: "alias"` hace fallar la carga de la configuración, como las demás claves de Meeko desde `1.4`. | Desde `1.5`, `alias` configura los [aliases de ruta](framework.md#aliases-de-ruta) de Meeko; las opciones de un módulo en esa clave se leerían como aliases y su aumentación de `MeekoConfig.alias` chocaría con el tipo de Meeko. Migración: dé al módulo otra clave y mueva sus opciones a ella en `meeko.config.ts`; véase [Actualizar de 1.4 a 1.5](migration-1.5.md#un-módulo-con-configkey-alias). |

### Formato `.meeko` y módulo generado

- Las secciones `<script lang="ts">`, `<template>` y `<style>` (con `scoped` y `:global(...)`), y en las páginas `<script server lang="ts">` (desde `1.1`), con sus dos formas: las opciones de ruta y el código de nivel superior cuyos `export const` son los datos de la página, con la regla que decide cuándo un bloque tiene código de nivel superior. Desde `1.1`, el `<script lang="ts">` es opcional y admite el atributo `generic` con los parámetros de tipo del componente, que no se permite en páginas, layouts, `app.meeko` ni `error.meeko`.
- La macro `defineProps<Props>()`, con o sin defaults, y desde `1.1` las macros `defineEmits<T>()`, `defineExpose(value)`, `defineModel<T>(name?, options?)`, `defineSnippets<T>()` y `useElementRef("name")`.
- Las directivas `{expression}`, `on:event`, `bind:name`, `if:when`, `each:of`/`each:as`/`each:key`/`each:index` y `<component is>`. Desde `1.1`:
  - `each:key` es opcional y sin él la clave es el índice;
  - `on:event` en `<component>` y en las etiquetas de componente equivale a la prop `onEvent`;
  - las etiquetas de componente con nombre en mayúscula (`<AppButton />`), cuyo contenido son snippets;
  - las props estáticas en componentes (`variant="primary"` pasa un literal de texto y un atributo sin valor, `true`), con `is`, `ref`, `html`, los nombres con guiones y los que llevan `:` sin ser directivas reservados;
  - la directiva `ref:name`. `ref="x"` y `bind:ref` conservan su comportamiento de `1.0`;
  - `model` y `model:name` en las etiquetas de componente, `model` en `<input>`, `<textarea>` y `<select>`, y los elementos `<snippet name params>` y `<render snippet args />`;
  - la directiva `html="expression"`, que inserta HTML sin escapar, normalizado para que encaje en el elemento y sin ejecutar nunca sus `<script>` al insertarlo en el navegador;
  - `html` y `model` son directivas sólo en los elementos HTML estándar; en los elementos personalizados (etiqueta con guion) son atributos literales;
  - `<component is="..." />` se cierra solo, como `<Etiqueta />`.
- Desde `1.4`, `if:when` en `<snippet>`: el padre pasa ese snippet sólo mientras la condición es verdadera, y sólo si el hijo lo declara opcional.
- Desde `1.5`, la etiqueta propia `<MeekoTeleport>` con `to` (`"body"` o `"#id"`, este último con una letra seguida de letras ASCII, dígitos, `-` o `_`), `bind:to`, `disabled` y `bind:disabled`, y los tipos `MeekoTeleportProps` y `MeekoTeleportTarget` de `@meekojs/meeko/framework`. Son contrato el destino del contenido en el HTML del servidor (dentro del elemento del `id`, tras su contenido, o tras la aplicación y antes de los scripts de Meeko con `body`), el orden de varios teleports al mismo destino, que conserve el ámbito del componente que lo declara, el movimiento de los mismos nodos al cambiar `disabled` y el comportamiento con un destino inexistente descrito en [framework.md](framework.md#meekoteleport). Los comentarios que marcan el contenido son internos.
- Desde `1.5`, `<component is>` acepta una etiqueta HTML (un literal, una expresión cuyo tipo es una unión de etiquetas, o una unión de etiquetas y componentes) y contenido: hijos con una etiqueta, snippets con un componente. Las etiquetas admitidas son el tipo público `TagName`; un atributo que no es global sólo se escribe mientras la etiqueta del momento lo admite según los datos HTML de Meeko (sin `type` en `<a>` ni en `<area>`). Al cambiar la etiqueta, los hijos se mueven al elemento nuevo con su estado. La directiva `bind="obj"` escribe un objeto como atributos de un elemento o como props de un componente, sin claves `on*`; los atributos explícitos ganan y `class` y `style` se combinan. `bind` sigue siendo un atributo literal en los elementos personalizados y ya no es una prop estática.
- Desde `1.4`, `defineSnippets<T>` acepta en cada clave de `T` una tupla de parámetros o un `Snippet<Args>`, que cuenta como `Args`, de modo que `T` puede derivar del mapa de snippets de otro componente con `Omit`, `Pick` o `&` conservando parámetros y opcionalidad. Una declaración con tuplas conserva el mismo tipo.
- Desde `1.4`, con `theme` en `meeko.config.ts`, la etiqueta propia `<MeekoThemeToggle>`: sus props (`mode`, `themes`, `labels`, `messages`, `class`, `id`), un snippet por elección, el marcado que estiliza la aplicación (el `<form method="post" action="/_meeko/theme">` raíz con `data-meeko-theme-toggle`, el `<button>` de `mode="cycle"`, los `<span data-meeko-theme-icon>` de los iconos, el `role="radiogroup"` y sus botones `role="radio"` con `aria-checked` y `data-meeko-theme-option` de `mode="select"`), el atributo `data-theme-choice` de `<html>` con la elección, la regla de `<head>` que muestra el icono de la elección, y el endpoint `POST /_meeko/theme` con las reglas de [framework.md](framework.md#meekothemetoggle) (temas válidos, `Origin` del propio sitio, `303` sólo a una ruta del mismo origen). Los textos por defecto y el CSS de la regla pueden cambiar en un minor.
- Desde `1.5`, la etiqueta propia `<MeekoAwait>`: sus props (`for`, como expresión o con `bind:for`, `reserve`, `messages`, `class`, `id`), sus snippets (`default` con `refreshing`, `pending` y `error` con `error` y `retry`), los estados descritos en [framework.md](framework.md#meekoawait), el estrechamiento de los datos de `for` en su contenido, y el marcado que estiliza la aplicación: un `<div>` con `data-meeko-await` (`pending`, `error` o `ready`), `aria-busy="true"` mientras carga o recarga, `data-meeko-refreshing` durante una recarga y, con `reserve`, `data-meeko-reserve` y `data-meeko-reserve-min`. Son contrato que la reserva sólo aplica `min-block-size` en `pending`, sin atributos `style`, y que la memoria vive en `sessionStorage`; la clave de cada zona, el formato guardado, el texto del script de `<head>`, los textos por defecto y el número de zonas recordadas pueden cambiar en un minor.
- Desde `1.5`, las etiquetas propias `<MeekoPopover>` y `<MeekoSelect>` (véase [Componentes integrados](api.md#componentes-integrados)): sus props, sus snippets (`trigger`, `anchor` y el contenido; `option`, `value`, `group`, `empty` y `loading`), su modelo, sus eventos (`toggle` con `{ open }`, `change`) y lo expuesto (`show`, `hide`, `toggle`); el marcado que estiliza la aplicación (`data-meeko-popover` y `data-meeko-popover-trigger`, `data-meeko-select` con `data-open`, `data-multiple`, `data-disabled` y `data-loading`, las opciones `role="option"` con `data-active`, `data-selected` y `data-disabled`); los roles y atributos ARIA documentados; el teclado documentado; los `<input type="hidden">` de `name`, y que no usen atributos `style="…"`. Son detalle de implementación, y pueden cambiar en un minor, las reglas de la capa de cascada `meeko`, las propiedades personalizadas `--meeko-popover-*`, los textos por defecto y la forma de los IDs.
- Las reglas del setup desde `1.1`: `useElementRef`, `useApi`, `useRpcQuery` y `useRpcMutation` sólo en el nivel superior; `await` de nivel superior sólo sobre `useApi`, `useRpcQuery`, `useElementRef`, `useSocket` y `useSocketClient`; la división del setup en el primer `await` de navegador, cuya continuación sólo se ejecuta en el navegador y admite sentencias de expresión y de control de flujo.
- La forma de cada módulo compilado: `ComponentProps`, `ComponentExposed`, `ComponentModels` y `ComponentSnippets` (desde `1.1`), `css`, `renderWithState`, `renderToString`, `hydrate` y `hydrateScope`, cuya función de liberación lleva `exposed`. En un componente con `generic`, los tipos y las funciones llevan sus parámetros de tipo. Las marcas `hasDataAwait`, `__meekoChildren`, `__meekoReactiveProps` (desde `1.2`), `__meekoChannels` y `__meekoTag` son internas.
- El tipo `Component<Props>`.

El código JavaScript generado no es público; véase [Fuera del contrato](#fuera-del-contrato).

### CLI

Los comandos y opciones que muestra `meeko --help`:

| Comando | Opciones |
| --- | --- |
| `meeko dev [directorio]` | |
| `meeko check [directorio \| componente.meeko]` | `--json` (sólo para un componente) |
| `meeko build [directorio]` | `--adapter <node\|bun\|deno\|cloudflare\|static>` o `--adapter=<nombre>` (`static`, desde `1.3`) |
| `meeko start [directorio]` | |
| `meeko preview [directorio]` | `--adapter <node\|bun\|deno\|cloudflare\|static>` (`static`, desde `1.3`) |
| `meeko check-app <directorio>`, `meeko routes <directorio>`, `meeko prerender <directorio>` | |
| `meeko compile <componente.meeko> <salida.ts>`, `meeko types <componente.meeko>` | |
| `meeko init <directorio>`, `meeko init-framework <directorio>` | |
| `meeko clean [directorio]` (desde `1.1`) | `--all`, `--dry-run`. Son contrato las opciones y qué se borra en cada modo; el texto exacto de la salida no. |
| `meeko auth hash` (desde `1.2`) | Sin opciones. Lee la contraseña sin eco en una terminal (dos veces) o de stdin en una tubería, y escribe en stdout sólo la línea del hash. |
| `meeko lsp` | `--stdio`, `--node-ipc`, `--socket=<puerto>` o `--pipe=<nombre>` |
| `meeko --help` (`-h`), `meeko --version` (`-v`) | |

También forman parte del contrato:

- el bin `meeko-language-server`, con los mismos transportes que `meeko lsp`;
- el código de salida `1` ante errores;
- los códigos de diagnóstico (`MEEK0xx`, `MEEK1xx` y `MEEK_*`; véase [Códigos de diagnóstico](#códigos-de-diagnóstico));
- la forma `{ code, message, filename, location }` de `meeko check --json`.

El texto de los mensajes puede mejorar en cualquier versión; desde `1.1` está en español. Un minor puede añadir diagnósticos para código que ya fallaba en ejecución o violaba un contrato documentado, y puede dejar de emitir uno cuando el código que señalaba pasa a ser válido. Un código retirado no se reutiliza con otro significado.

#### Códigos de diagnóstico

| Código | Tema |
| --- | --- |
| `MEEK001` | HTML del componente no válido. |
| `MEEK002` | Contenido de nivel superior que no es `<script>`, `<template>` ni `<style>`, incluida una etiqueta de componente fuera de las secciones. |
| `MEEK003`, `MEEK004` | Sección sin etiqueta de cierre o duplicada. |
| `MEEK005` | **Retirado en `1.1`.** Señalaba la falta de `<script lang="ts">`, que pasa a ser opcional. |
| `MEEK006` | `<script>` o `<script server>` sin `lang="ts"`. |
| `MEEK007` | Falta `<template>`. |
| `MEEK008` | HTML de la plantilla no válido, incluido un cierre de etiqueta de componente sin apertura. |
| `MEEK009`, `MEEK010` | Expresión de plantilla vacía o sin cerrar. |
| `MEEK011` | Nombre de evento no válido. |
| `MEEK012` | Atributo dinámico o directiva no admitidos. |
| `MEEK013` | Error de sintaxis del `<script>`. |
| `MEEK014`, `MEEK015` | Más de una variable por sentencia, o una desestructuración del resultado de `defineProps` o `useElementRef` (desde `1.2`; antes, cualquier desestructuración). |
| `MEEK016`, `MEEK017` | `defineProps` repetido o fuera de su propia declaración, o sin argumento de tipo. |
| `MEEK018` | Sentencia de nivel superior no admitida en el `<script>` o en la continuación de navegador: un `export` de valor, una clase, un `enum`, un `namespace`, `import =` o un `return`, `throw`, `break` o `continue` suelto. Desde `1.2` el setup síncrono admite cualquier sentencia de expresión y control de flujo, como la continuación. |
| `MEEK019` | `:global(...)` no válido en `<style scoped>`. |
| `MEEK020` | Error de sintaxis de una expresión de la plantilla. |
| `MEEK021`, `MEEK022` | `if:when` y `each:of` en el mismo nodo; `each:as` o `each:index` no válidos o repetidos. |
| `MEEK023` | **Retirado en `1.1`.** Señalaba una lista sin `each:key`, que pasa a ser opcional. |
| `MEEK024` | Directiva de plantilla incompleta. |
| `MEEK030`, `MEEK031` | `<component>` sin `is`, o con contenido. Desde `1.5`, `<component is>` admite contenido y `MEEK031` sólo señala contenido en una etiqueta vacía (`img`, `input`, `hr`…): un error de compilación si es un literal de `is` y un error de tipos de `meeko check` y del editor si viene del tipo de `is`. |
| `MEEK032` | Atributo de componente que no es una prop: `is` en una etiqueta, `ref="x"`, `html` y los nombres con guiones o con `:` que no son directivas. Desde `1.1`, cualquier otro atributo con nombre de identificador es una [prop estática](api.md#props-estáticas) en lugar de este error. Desde `1.5`, en un `<component is>` cuya expresión puede dar una etiqueta, esos atributos son del elemento y, si el tipo de `is` admite un componente, el error de tipos `MEEK112`. |
| `MEEK033`, `MEEK034` | Import de componente que no es una ruta `.meeko` relativa (desde `1.5`, ni un [alias de ruta](framework.md#aliases-de-ruta)), o que no existe. |
| `MEEK040` a `MEEK042` | Valores por defecto de `defineProps`. |
| `MEEK043`, `MEEK044` | `<script server>` con valor, o fuera de una página. |
| `MEEK045` a `MEEK048` | `defineEmits`, y `on:x` junto a `bind:onX` (o la misma prop dos veces). |
| `MEEK049` | **Retirado en `1.1`.** Señalaba contenido en una etiqueta de componente, que pasa a ser sus snippets. |
| `MEEK050`, `MEEK051` | `defineExpose`. |
| `MEEK052`, `MEEK053` | La directiva `ref:` y los nombres repetidos. |
| `MEEK054` a `MEEK058` | Composables de nivel superior, `await` y la continuación de navegador; `MEEK056`, los argumentos de `useElementRef`. |
| `MEEK059` a `MEEK062` | `defineSnippets`, `<snippet>` y `<render>`. |
| `MEEK063` a `MEEK066` | `defineModel`, `model` en controles de formulario y `model`/`model:name` en componentes. |
| `MEEK070` a `MEEK076` | Código de nivel superior de `<script server>`. |
| `MEEK080` | `await useElementRef(...)` sobre un componente sin `defineExpose`. |
| `MEEK090` | La misma prop como texto estático y con `bind:` u `on:`. |
| `MEEK095` | La directiva `html`: hijos, elementos vacíos o de texto, `<template>`, `model` o valor vacío. |
| `MEEK100` | El atributo `generic`: lista no válida, modificadores, nombres reservados o repetidos, ubicación no admitida y tipos del script que usan sus parámetros. |
| `MEEK101` | Aviso (desde `1.2`): una lectura de `props` que el setup ejecuta una sola vez. |
| `MEEK104`, `MEEK105` | Desde `1.2`, `<MeekoOutlet />` fuera de `app.meeko` y los layouts o con atributos o contenido, y un `<MeekoLink>` sin `to`, con `href` o con `params`/`search` sin `bind:`; desde `1.5`, también un `match` estático que no es `"exact"` ni `"prefix"`. |
| `MEEK106` | Aviso (desde `1.2`): un componente del proyecto llamado `MeekoLink` o `MeekoOutlet` (desde `1.4`, también `MeekoThemeToggle`; desde `1.5`, `MeekoAwait`, `MeekoTeleport`, `MeekoPopover` y `MeekoSelect`) sustituye a la etiqueta propia de Meeko. |
| `MEEK107` | Aviso (desde `1.3`): el valor de `html="..."` es un `string` (o `any`) sin la marca `TrustedHtml` de `trustHtml`. Pasará a ser un error en `2.0`; véase [APIs deprecadas](#apis-deprecadas). |
| `MEEK108` | Desde `1.3`, una API que no existe donde se usa: en el `<script>` o la plantilla de un componente (que también se ejecutan en el navegador), un autoimport de servidor (`defineApiRoute`, `defineRpc`, `defineServerMiddleware`, `defineSocketChannel`, `defineServerRuntime`, `ApiError` o uno de `server/utils`), un import de valores de `@meekojs/meeko/server` o `/cloudflare`, o un import de `server/` o de un módulo `*.server.*`; en `<script server>`, las macros del componente (`defineProps`, `defineEmits`, `defineExpose`, `defineModel`, `defineSnippets`, `useElementRef`) y `onMounted`. Todo eso ya fallaba en el build o en ejecución; véase [framework.md](framework.md#dónde-se-usa-cada-api). Desde `1.5`, también un import por `#server/` (o por un alias propio de una carpeta de `server/`) en un componente, en un `.ts` de `app/` o en `shared/`, aunque sea `import type`, y un import de `server/` por `~/`; véase [Ámbitos de los aliases](framework.md#ámbitos-de-los-aliases). |
| `MEEK109` | Aviso (desde `1.3`): en el `<script>` o la plantilla de un componente, `definePage`, que ahí no tiene efecto, o un import de valores de `@meekojs/meeko/node`, `/bun`, `/deno`, `/password` o `/build`, cuyas funciones sólo funcionan en el servidor. Pasará a ser un error en `2.0`; véase [APIs deprecadas](#apis-deprecadas). |
| `MEEK110` | Desde `1.4`, error de tipos: `if:when` en un `<snippet>` que llena un snippet obligatorio del hijo. |
| `MEEK111` | Desde `1.4`, `<MeekoThemeToggle>` sin `theme` en `meeko.config.ts` (en `meeko dev`, `meeko build`, `meeko check`, el editor y, si sólo ejecutando la configuración se sabe, al renderizar). |
| `MEEK112` | Desde `1.5`, `<component is>` con una etiqueta HTML: una etiqueta que no puede renderizar (`script`, `iframe`, desconocida o dentro de `<svg>`), un `string` cualquiera, un atributo que no admite ninguna de las etiquetas posibles, `model` con etiquetas, o un atributo que sólo vale con una etiqueta (o sólo con un componente) cuando `is` admite el otro tipo. Es un error de compilación para un literal de `is` y un error de tipos de `meeko check` y del editor en los demás casos; en ejecución, un valor no permitido lanza `TypeError` antes de escribir HTML. |
| `MEEK113` | Desde `1.5`, `bind="obj"`: sin valor, en `<template>`, una clave `on*` o `data-meeko*`, una clave que no es un atributo de la etiqueta o una prop del componente. Las claves no válidas son errores de tipos; en ejecución, una clave `on*` lanza `TypeError`. |
| `MEEK114` | Desde `1.5`, `<MeekoTeleport>` sin `to`, con un `to` estático que no es `"body"` ni `"#id"`, con `disabled` con valor, con un atributo repetido (`to` y `bind:to`) o con un atributo que no admite. |
| `MEEK115` | Aviso (desde `1.5`): un `+group.ts` fuera de `app/pages`, donde no configura nada. |
| `MEEK116` | Desde `1.5`, `<MeekoAwait>` sin `for` o con `for` vacío. |
| `MEEK117` | Aviso (desde `1.5`): una página o un layout pinta en un `each:of` los datos de un `useApi` o un `useRpcQuery` sin `await` sin ocuparse de su carga (`<MeekoAwait>`, `pending`, `refreshing` o un `if:when` sobre sus datos), lo que hace saltar el diseño al llegar los datos. |
| `MEEK118` | Desde `1.5`, un import por `@/` (o por un alias propio de una carpeta de `app/`) en `shared/` o en un `*.shared.ts`, que no ve `app/`; véase [Ámbitos de los aliases](framework.md#ámbitos-de-los-aliases). |
| `MEEK_PAGE_PROPS`, `MEEK_LAYOUT_PROPS`, `MEEK_ERROR_PROPS` | Contratos de props de páginas, layouts y páginas de error. |
| `MEEK_PAGE_LAYOUT_PROPS` | Desde `1.5`, las `layoutProps` de un `+group.ts` o de una página que hereda su layout no coinciden con las props de ese layout. |
| `MEEK_AUTOIMPORT`, `MEEK_CHECK`, `MEEK_PROJECT_CHECK` | Servidor de lenguaje: autoimport ambiguo o no disponible, fallo al comprobar el componente y fallo al comprobar los contratos del proyecto. |

Los códigos a partir de `MEEK043` son nuevos en `1.1`. Los errores de TypeScript conservan su código `TSxxxx`, que puede cambiar al actualizar TypeScript o la forma del código que comprueba: en `1.1`, una prop obligatoria que falta en una etiqueta de componente da `TS2345` en lugar de `TS2769`.

La versión de TypeScript que incluye el paquete puede actualizarse en un minor. Si eso cambia los diagnósticos de `meeko check`, el CHANGELOG lo indica.

### Convenciones de proyecto

- `meeko.config.ts` con `defineMeekoConfig`: `extends`, `modules`, `imports.serverDirs`, la unión discriminada `server` (`node`, `bun`, `deno` y `cloudflare`, con sus campos documentados, y desde `1.3` `static`, con `contentSecurityPolicy`, `headers` y `headerFiles`) y, desde `1.2`, `css.scopeAttribute`, `layers`, `document` (`lang` y `head`) y las claves de opciones de los módulos (`meta.configKey`; desde `1.4`, una clave propia de `MeekoConfig` hace fallar la carga, véase [Excepciones aprobadas](#excepciones-aprobadas)). Desde `1.3`, `site`, `sitemap` (`true` o `{ exclude }`), `robots` (`true` o `{ allow, disallow }`) y `document.seo` (`true` o `{ canonical, ogUrl, ogTitle, ogDescription, origin }`), con las etiquetas, archivos y prioridades descritos en [framework.md](framework.md#sitio-estático), `dev.serverLogs`, `imports.appDirs` e `imports.sharedDirs`, estas dos con el ámbito y las reglas de rutas de [Carpetas de autoimports](framework.md#carpetas-de-autoimports). Desde `1.4`, `theme` (`true` o `{ themes, default, system, darkThemes, attribute, colorScheme, cookie, storageKey, clientHints }`), con el comportamiento de [Tema claro/oscuro sin parpadeo](framework.md#tema-clarooscuro-sin-parpadeo): el atributo o la clase de `<html>`, el script en línea de `<head>` y su orden de lectura (cookie, `localStorage`, valor por defecto). Desde `1.2`, `modules` lista módulos de `defineMeekoModule` (un módulo, un paquete, una ruta o `[módulo, opciones]`); `extends` es un alias de `layers`.
- El documento HTML que renderiza el servidor: desde `1.2`, el título y las etiquetas que gestiona Meeko van entre los comentarios `<!--meeko:head-->` y `<!--/meeko:head-->`, antes del HTML de `DocumentOptions.head`, y la meta CSRF sigue a `<meta charset>` y a las etiquetas por defecto (viewport e icono) que la aplicación no sustituye. La prioridad y la deduplicación de `useHead` descritas en [framework.md](framework.md#head-del-documento-document-usehead-y-useseometa) son estables.
- `app/`:
  - `app.meeko`, `error.meeko`, `pages/`, `layouts/default.meeko`, `middleware/`, `components/`, `composables/`, `utils/`, `stores/` y `styles/main.css`;
  - páginas `index.meeko`, `[id].meeko`, `[...slug].meeko` y grupos `(group)`, con `+layout.meeko`, `+error.meeko` y las opciones de ruta en `<script server>` o en sidecars `*.route.ts`;
  - desde `1.5`, los layouts con nombre `layouts/<nombre>.meeko` (también en subcarpetas: `layouts/admin/panel.meeko` es `"admin/panel"`), que las páginas eligen con `layout` en `definePage`, y los archivos `+group.ts` de las carpetas de `pages`, con `export default defineGroup({ layout, layoutProps })` en literales.
- `server/`:
  - `api/` (`<nombre>.<método>.ts`), `rpc/`, `socket/`, `middleware/` y `utils/`;
  - `server/runtime.ts`, cuyo export por defecto es `defineServerRuntime(...)`.
- `shared/`, `public/`, layers y módulos.
- Desde `1.5`, los [aliases de ruta](framework.md#aliases-de-ruta) `~/` (la raíz del proyecto), `@/` (`app/`), `#shared/` (`shared/`) y `#server/` (`server/`, sólo en el código de servidor), sus ámbitos, su búsqueda en el proyecto y después en cada layer, y la opción `alias` de `meeko.config.ts` (un prefijo terminado en `/` con una carpeta del proyecto o `false`). Son contrato la prioridad de los `paths` del `tsconfig.json` del proyecto y de un `resolve.alias` de Vite sobre ellos, y que un `imports` de `package.json` con el mismo prefijo `#` gane y desactive el alias. La forma de los `paths` en los `tsconfig` generados no es contrato.
- Desde `1.2`, `app/plugins/*.ts` en la aplicación y sus layers, con los sufijos `.client.ts` (sólo navegador, antes de hidratar) y `.server.ts` (sólo servidor, una vez por petición de página).
- Los sufijos `.client.ts`, `.server.ts` y `.shared.ts`, y las exclusiones `*.test.ts`, `*.spec.ts` y `*.d.ts`.
- Los autoimports `api`, `rpc`, `socket`, `useSocket`, `useState`, `href` y `provideErrorHandler`, y desde `1.1` `onMounted`, `useApi`, `useRpcQuery` y `useRpcMutation`, y desde `1.2` `useRoute`, `useForm`, `useStorage`, `useApiMutation`, `useHead` y `useSeoMeta`, y desde `1.4` `useTheme`, y desde `1.5` `useId` (de `@meekojs/meeko`), `useLayout`, `defineGroup` y `ClientError` e `isClientError` (sólo en los componentes y en los módulos de `app/`, no en `server/`, `*.server.ts` ni los archivos de ruta) (un export propio con uno de esos nombres tiene prioridad sobre el del framework). Desde `1.4`, los tipos de cada componente autoimportado: su nombre de etiqueta (la regla de nombres de `app/components` y de `addComponentsDir`, prefijo incluido) seguido de `Props`, `Snippets`, `Models` y `Exposed` (`AppCardProps`…), iguales a `ComponentProps`, `ComponentSnippets`, `ComponentModels` y `ComponentExposed` de su módulo, `null` incluido, con el ámbito del componente; un autoimport del proyecto con el mismo nombre tiene prioridad (véase [Tipos de cada componente](framework.md#tipos-de-cada-componente)). En el código de nivel superior de `<script server>`, `usePage`, `redirect` y `notFound` se pueden usar sin import, y desde `1.2` también `useHead` y `useSeoMeta`.
- Las variables de entorno `MEEKO_HOST`, `MEEKO_PORT` (con `PORT` como respaldo permanente), `MEEKO_PUBLIC_ORIGIN`, `MEEKO_HMR_PORT` y, desde `1.2`, `MEEKO_REDIS_URL`, `MEEKO_REDIS_PREFIX`, `MEEKO_SESSION_TTL`, `MEEKO_SESSION_SAMESITE` y `MEEKO_TRUST_PROXY`, y el prefijo `MEEKO_`, reservado para las variables que lee Meeko. `HOST` y `PUBLIC_ORIGIN` están obsoletas desde `1.2`.

### Salidas de build

| Adaptador | Carpeta | Se ejecuta con |
| --- | --- | --- |
| Node | `.meeko/output/node/` | `index.mjs`, mediante `meeko start` o `node` |
| Bun | `.meeko/output/bun/` | `index.js` |
| Deno | `.meeko/output/deno/` | `main.js` |
| Cloudflare Workers | `.meeko/output/cloudflare/` | `worker.js` y `wrangler.jsonc` |
| Sitio estático (desde `1.3`) | `.meeko/output/static/` | Cualquier hosting estático, o `meeko preview` |

En el sitio estático también son estables:

- `<ruta>/index.html` y `<ruta>/index.meeko.json` por página, `404.html`, `sitemap.xml` y `robots.txt` en la raíz;
- `_headers` (bloque `/*`) y `_meeko/headers.conf` (una línea `add_header <Nombre> "<valor>" always;` por cabecera), con los que choca un archivo de `public/` del mismo nombre.

En Cloudflare también son estables:

- el binding `MEEKO_SOCKET`;
- la migración `meeko-socket-v1`, que no se renombra;
- la reserva de `public/_meeko/`;
- los campos de `wrangler.jsonc` que pertenecen a Meeko.

El contenido de `chunks/`, los nombres de archivos con hash y el resto de `.meeko/` no son públicos.

### Formatos de red y persistidos

Estos formatos permiten clientes externos, proxies, CSP y despliegues graduales:

- **Payload de página.** Versión `v: 2`, con `render`, `head` (`title` y, desde `1.1`, `description`) y `deferred`:
  - el documento lo lleva en `<script id="meeko-payload" type="application/json">`, dentro de un HTML con `<div id="app">`;
  - la navegación lo pide con `accept: application/meeko+json`, y la respuesta es `application/meeko+json` o, en una ruta `"stream"`, `application/meeko+ndjson` (el payload en la primera línea y un valor `{ "deferred", "value" | "error" }` en cada línea siguiente); desde `1.3`, el cliente del adaptador `static` lo pide como el archivo `<ruta>/index.meeko.json`, sin `accept`;
  - desde `1.3`, un documento con un payload `error: true` hidrata `app/error.meeko` en cualquier URL, también en una que coincide con una ruta (el `404.html` de un hosting estático);
  - con `app/error.meeko`, una URL sin ruta responde `404` con un payload `error: true`, sin `route` y con props `{ status, message }`;
  - desde `1.1`, el campo opcional `resources` lleva los datos de los `await useApi(...)` y `await useRpcQuery(...)` que leyó el render, como objeto por clave de petición. El formato de esas claves es interno y puede cambiar en cualquier versión: sólo el servidor y el navegador de la misma versión lo interpretan. Un payload sin `resources` sigue siendo válido;
  - desde `1.5`, el campo opcional `layoutProps` lleva las props con que el servidor renderizó el layout con nombre de la página (las de sus `+group.ts`, sus `layoutProps` y lo que escribió con `useLayout()`), y el manifiesto de rutas (`RouteRecord`, `ErrorPageRecord`, `.meeko/manifests/routes.json` y el de `virtual:meeko-manifest/client`) el campo opcional `layout` (`{ name, file, props? }`). Un payload o un manifiesto sin ellos siguen siendo válidos.
- **Streaming.** Los bloques `<script type="application/json" data-meeko-deferred="N">`, hijos directos de `<body>` y posteriores a `#meeko-payload`.
- **Endpoints.** `/api/...` según los archivos de `server/api`, `POST /_meeko/rpc/<ruta>` con cuerpo JSON y `/_meeko/socket/<canal>?room=<sala>`, cuyos mensajes de texto son `{ event, payload }`. Los errores tienen la forma `{ code, status, requestId }`; desde `1.2`, un `400` por entrada no válida puede añadir `issues: [{ path, message }]`, y `rateLimit` responde `429` `RATE_LIMITED` con `Retry-After` en segundos. Desde `1.2`, las mutaciones `retrySafe` y las llamadas de `api.*` y `rpc.*` con `idempotencyKey` envían la cabecera `Idempotency-Key` con un UUID como cadena de Structured Fields (`"…"`), y el servidor la expone validada en `RequestContext.idempotencyKey`.
- **Cabeceras:**
  - `x-meeko-csrf` en las mutaciones;
  - `x-meeko-csrf-token` y `x-request-id` en las respuestas;
  - `cache-control: no-store` y `x-accel-buffering: no` en los streams.
- **Meta y cookie.** La meta `meeko-csrf-token` y la cookie de sesión, que por defecto es `__Host-meeko.sid` (o `meeko.sid` sin `Secure`) y se configura con `cookieName`. Desde `1.4`, con `theme`, la cookie del tema (`meeko-theme` por defecto, `theme.cookie`) y la clave de `localStorage` (`theme.storageKey`) guardan el nombre del tema o `system` en texto plano.
- **Tema.** Desde `1.4`, con `theme`, los documentos que renderiza el servidor llevan `Vary: Cookie, Sec-CH-Prefers-Color-Scheme`, `Accept-CH: Sec-CH-Prefers-Color-Scheme` y, cuando la elección es `system`, `Critical-CH: Sec-CH-Prefers-Color-Scheme` (sin `clientHints`, sólo `Vary: Cookie`). El payload de una página que lee el tema lleva lo que renderizó el servidor en la clave `meeko:theme` de `sharedState`.
- **Socket.**
  - Los códigos de cierre documentados: `1003`, `1008`, `1009`, `1011` y `1013`, y desde `1.1` `4401` (sesión rechazada) y `4403` (autorización del canal rechazada).
  - Las respuestas del handshake: `400`, `403` `INVALID_ORIGIN`, `404` y las de los límites por HTTP. Desde `1.1`, un rechazo de sesión (`401`) o de autorización del canal (`403`) completa el upgrade y cierra en seguida con `4401` o `4403`, con un motivo fijo y sin llamar a los handlers. Véase [framework.md](framework.md#websocket).
- **Redis:**
  - el canal `<prefix>socket:<canal>:<sala>` con el sobre `{ v: 1, event, payload }`;
  - el canal de revocaciones `<prefix>revoked`;
  - desde `1.2`, los contadores de `rateLimit` en `<prefix>ratelimit:<resumen>` (el resumen de la ruta y el sujeto no es contrato);
  - los registros de sesión que escriben `RedisSessionStore` y `SqlSessionStore`;
  - el esquema de referencia de `D1SessionDriver.schema()`.
- **Prerender.** El índice `prerender/manifest.json` (`{ version: 1, pages }`); desde `1.3`, cada página tiene el campo opcional `scriptHashes`, las fuentes CSP `'sha256-…'` de sus scripts en línea, y desde `1.4` `styleHashes`, las de sus `<style>` en línea.

Un minor sólo puede añadir campos opcionales a estos formatos. Debe aceptar lo que escribió cualquier `1.x` anterior y no cambia la versión de un formato. Durante un despliegue gradual pueden convivir instancias de dos minors con el mismo Redis o la misma base. El navegador y el servidor de una misma aplicación deben salir del mismo build; un payload con otra versión se rechaza con un mensaje explícito.

### DevTools y editor

- **Protocolo DevTools 1.**
  - El hook `window.__MEEKO_DEVTOOLS__` (sólo en desarrollo), con `protocolVersion: 1`.
  - Sus métodos `snapshot`, `subscribe`, `select`, `highlight`, `setBreakpoint` y `setSignal`.
  - Los tipos `Devtools*` de la raíz.
  - Un minor puede añadir campos o tipos de evento. Pasar a otra versión del protocolo requiere una major. La extensión de Chrome mantiene su propio número de versión.
  - Desde `1.1`, `DevtoolsInstance` tiene el campo opcional `signalSites` (tipo `DevtoolsSignalSite`), con la declaración de cada señal. Es un campo añadido dentro del protocolo 1: un hook o una captura sin él siguen siendo válidos.
- **Servidor de lenguaje.**
  - El arranque con `meeko lsp --stdio` o `meeko-language-server`.
  - Las `initializationOptions` `trusted`, `projectContracts` y `diagnosticsDelay`.
  - Las capacidades LSP estándar que anuncia. Un minor puede añadir capacidades y acciones rápidas.

## Fuera del contrato

- **`@meekojs/meeko/internal`.** Es el contrato entre el compilador y su runtime. Sólo está garantizado dentro de la **misma versión exacta** y puede cambiar en cualquier patch. No lo importe a mano. Lo mismo vale, desde `1.5`, para `@meekojs/meeko/builtins/*`, los módulos compilados de `<MeekoThemeToggle>`, `<MeekoAwait>`, `<MeekoPopover>` y `<MeekoSelect>` que el compilador importa en los componentes que usan esas etiquetas.
- **El código y los archivos generados.**
  - Lo que hay bajo `.meeko/`: tipos, manifiestos, entradas, `tsconfig` por ámbito, builds intermedios y `chunks/`.
  - El contenido de `.meeko/styles/main.css`, la hoja global procesada que escribe `meeko dev` para el editor: sigue a lo que Vite y PostCSS generan en desarrollo y puede cambiar en cualquier versión. Su ruta sí se mantiene durante 1.x, para que la configuración del editor que la nombra (`css.styleSheets`) siga funcionando. Véase [framework.md](framework.md#hoja-global-procesada-para-el-editor).
  - Los módulos virtuales de Vite (`virtual:meeko-*`).
  - El JavaScript que emite el compilador.
  - Una entrada propia que importe esos módulos debe fijar la versión exacta de Meeko.
- **El puente del editor.** El protocolo de valores en vivo entre el navegador, `meeko dev` y el editor (eventos `meeko:live*` de HMR, los descriptores `.meeko/dev/editor-bridge-<puerto>.json`, uno por servidor de desarrollo, la ruta `/__meeko/editor-bridge` y sus mensajes, incluido el campo `alias`) es sólo de desarrollo y no forma parte del contrato público: puede cambiar en cualquier versión. La extensión de VS Code ignora un descriptor con otra versión del protocolo. Véase [devtools.md](devtools.md#puente-del-editor).
- **Los logs del servidor en el navegador.** Lo que `meeko dev` añade para reenviar la consola del servidor (desde `1.3`): los bloques `<script type="application/json" data-meeko-server-logs>`, el campo `devServerLogs` de los payloads de navegación, el evento `meeko:server-logs` de HMR, sus módulos `/@id/__x00__meeko:server-logs*` y la forma serializada de los valores. Sólo existen en desarrollo, nunca en `meeko build` ni en `meeko start`, y pueden cambiar en cualquier versión. Lo estable es la opción `dev.serverLogs`. Véase [framework.md](framework.md#logs-del-servidor-en-la-consola-del-navegador).
- **Las extensiones propias del servidor de lenguaje.** La petición LSP `meeko/executionZones` y los modificadores de token semántico propios de Meeko (`signal`, `computed`, `resource` y `reactive`; `modification` es el estándar de LSP) son internos de la extensión de VS Code, que se publica junto al servidor. No son contrato público: pueden cambiar o desaparecer en un minor. Otro cliente LSP puede usarlos, pero debe tolerar esos cambios. Véase [editors.md](editors.md#funciones-propias-de-meeko).
- **La presentación.** El texto de mensajes de error y diagnósticos, el HTML y los estilos de los paneles DevTools, los títulos de CodeLens, hovers y zonas del editor, la salida de consola y el formato de los logs.
- **El repositorio.** Los ejemplos, pruebas, benchmarks y scripts no se publican en npm.
- **El rendimiento.** Las cifras de rendimiento y tamaño, que pueden mejorar o variar entre versiones.

## Deprecación

1. Una API pública sólo se depreca en un minor y siempre con un reemplazo documentado, salvo que la funcionalidad desaparezca por completo; en ese caso se explica el motivo.
2. La deprecación se anuncia en el CHANGELOG, en la documentación y con `@deprecated` en el JSDoc, para que el editor la marque.
3. Donde es viable, el uso deprecado emite además un aviso:
   - un aviso de `meeko check` o del servidor de lenguaje para sintaxis y convenciones;
   - un aviso de consola en desarrollo, una vez por proceso, para APIs de runtime.
4. Lo deprecado sigue funcionando durante toda la serie 1.x y sólo se retira en la siguiente major, cuya guía de migración lo recoge.

### APIs deprecadas

| API | Desde | Reemplazo | Se retira en |
| --- | --- | --- | --- |
| `useSocket(url, contract, options)` de `@meekojs/meeko/framework` | `1.1` | `useSocketClient`, con la misma firma y los mismos tipos | `2.0` |
| Segmentos `byId` de `api.*` y de `ApiClient` (`api.users.byId.get({ params: { id } })`) | `1.2` | La llamada del segmento dinámico: `api.users({ id }).get()` | `2.0` |
| Carpetas de layer (con `app/pages` y sin módulo) listadas en `modules` de `meeko.config.ts` | `1.2` | La misma cadena en `layers` | `2.0` |
| Variables de entorno `HOST` y `PUBLIC_ORIGIN` | `1.2` | `MEEKO_HOST` y `MEEKO_PUBLIC_ORIGIN`. `PORT` no está obsoleta | `2.0` |
| `html="..."` con un `string` sin marcar (aviso `MEEK107`) | `1.3` | Un `TrustedHtml`: el HTML propio o saneado, marcado con `trustHtml(…)` donde se produce; para texto, `{expr}` | `2.0`, como error de `meeko check` |
| `definePage` en el `<script>` o la plantilla de un componente, e imports de valores de `@meekojs/meeko/node`, `/bun`, `/deno`, `/password` o `/build` allí (aviso `MEEK109`) | `1.3` | Las opciones de ruta en `<script server>` o en un sidecar `*.route.ts`; el código de servidor en `<script server>` o en `server/`, con `import type` para los tipos | `2.0`, como error de `meeko check` y del build |

El alias `useSocket` es la misma función que `useSocketClient`, así que no emite aviso de consola: el editor lo marca por su `@deprecated`. No afecta al autoimport `useSocket("canal", opciones)` de los clientes generados, que no está deprecado. Véase [framework.md](framework.md#clientes-con-url-y-contrato-explícitos).

Los segmentos `byId` construyen las mismas peticiones que la llamada del segmento y tampoco emiten aviso de consola: el editor tacha cada método que se llama a través de ellos. La clave `clientKey` del manifiesto, `createLocalCalls().api("users.byId", ...)` y `useApi` no cambian ni están deprecados. Véase [framework.md](framework.md#segmentos-dinámicos-en-api).

Una carpeta de layer listada en `modules` se sigue aplicando como layer, en la misma posición que antes, y `meeko dev`, `meeko build` y `meeko check` escriben un aviso una vez por proceso. `extends` no está deprecado: es un alias de `layers`. Véase [framework.md](framework.md#carpetas-en-modules-deprecado).

`MEEK107` es sólo un aviso de `meeko check`, `meeko build` y el servidor de lenguaje: en `1.x` no cambia el SSR, la hidratación ni el código generado, y un `string` sin marcar se sigue insertando igual. En `2.0`, el valor de `html` tendrá que ser asignable a `TrustedHtml | null | undefined` y el aviso pasará a ser un error. Los tipos literales de texto (`html="'<br>'"`) siguen admitidos. Véase [api.md](api.md#html-de-confianza-trustedhtml-y-trusthtml).

`MEEK109` es sólo un aviso de `meeko check`, `meeko build` y el servidor de lenguaje, y en `1.x` el código generado no cambia. Esos usos compilan y se cargan en el navegador, pero no hacen nada (`definePage` fuera de `<script server>` y de los sidecars no configura la ruta) o fallan al llamarlos allí (las funciones de los adaptadores, de `/password` y de `/build` necesitan Node, Bun o Deno). Lo que ya fallaba antes de `1.3` es el error `MEEK108` directamente: un autoimport de servidor no se resolvía en el bundle del navegador, `@meekojs/meeko/server` y `/cloudflare` no se pueden cargar allí (crean un `AsyncLocalStorage` de `node:async_hooks`), un import de `server/` detenía `meeko build`, y las macros y `onMounted` no existen fuera del `<script>`. Véase [framework.md](framework.md#dónde-se-usa-cada-api).

`HOST` y `PUBLIC_ORIGIN` sólo se leen cuando falta `MEEKO_HOST` o `MEEKO_PUBLIC_ORIGIN`, y entonces `meeko dev`, `start`, `preview` y las salidas de `meeko build` escriben un aviso una vez por proceso que nombra la variable nueva. Véase [framework.md](framework.md#crear-una-aplicación).

Una vulnerabilidad que no se pueda corregir de forma compatible es la única excepción. En ese caso, el cambio mínimo necesario puede publicarse en un patch o un minor, con su explicación y migración en el CHANGELOG.

### Cambios previstos para 2.0

Además de retirar lo deprecado, `2.0` cambiará estos valores por defecto. En `1.x` cada uno se puede activar antes con su opción.

| Comportamiento | Opción | Desde | Por defecto en 1.x | Por defecto en 2.0 |
| --- | --- | --- | --- | --- |
| Elementos que reciben el atributo de `<style scoped>` | `css.scopeAttribute` de `meeko.config.ts` (`scopeAttribute` de `compile()`) | `1.2` | `"all"`: todos los de la plantilla | `"matched"`: sólo los que algún selector con ámbito puede seleccionar |

Con `"matched"`, una clase o un atributo que el script añade con la API del DOM a un elemento sin `ref:` ni `on:` deja de recibir los estilos con ámbito si ese elemento se quedó sin el atributo. Véase [api.md](api.md#qué-elementos-reciben-el-atributo).

## Entornos soportados

| Entorno | Versión |
| --- | --- |
| Node.js | `>=24` (`engines` de `package.json`). Ejecuta la CLI, el build, el prerender, Vite, el servidor de lenguaje y el adaptador Node. CI usa Node 24 en Windows y Ubuntu. |
| Bun | Bun 1.x, con la salida `meeko build --adapter bun`. La suite de conformidad se ejecuta en CI con Bun 1.4.4. |
| Deno | Deno 2.x, con la salida `meeko build --adapter deno`. La suite de conformidad se ejecuta en CI con Deno 2.9.8. |
| Cloudflare Workers | `wrangler.jsonc` usa por defecto la fecha de compatibilidad `2026-10-19`, configurable con `server.compatibilityDate`, y el flag `nodejs_als` (también vale `nodejs_compat`). La suite de conformidad se ejecuta con workerd 1.20261019.1 (Wrangler 4.152.0). Socket requiere Durable Objects, y las sesiones D1 o Redis por la API REST de Upstash. |
| TypeScript | El paquete incluye TypeScript 7.0.2 para `meeko check` y los tipos. Las aplicaciones comprueban sus declaraciones con TypeScript 7. |
| Vite | Peer opcional `^8.3.5`. |

Las versiones de Bun, Deno y workerd de la tabla son las que se prueban. Pueden actualizarse en un minor y el CHANGELOG lo indica. Dejar de admitir Node 24 requiere una major.

### Navegadores

El runtime se publica compilado a ES2022, sin polyfills. Usa, entre otros, `Object.hasOwn`, `Array.prototype.at`, `MutationObserver`, `fetch` con cuerpos `ReadableStream` (navegación a rutas `"stream"`) y `WebSocket` (Socket). El bundle cliente de una aplicación usa el objetivo por defecto de Vite 8, `baseline-widely-available`. Se admiten los navegadores que cumplen ese objetivo.

Las pruebas E2E se ejecutan con Chrome y con Chromium, Firefox y WebKit de Playwright. WebKit de Playwright no equivale a una prueba en Safari real.

## Seguridad

Las vulnerabilidades se informan de forma privada desde la pestaña **Security** de [meekojs/meeko](https://github.com/meekojs/meeko/security/advisories/new), nunca en un issue abierto. [SECURITY.md](../SECURITY.md) detalla las versiones con soporte, qué incluir en el informe y los plazos de respuesta.
