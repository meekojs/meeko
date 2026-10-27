# Actualizar de 1.1 a 1.2

`1.2` es un minor: lo nuevo (módulos, `document` y `useHead`, `<MeekoLink>` y `<MeekoOutlet />`, sesiones sin configuración, contraseñas, `rateLimit`, `useForm`, `useStorage`, utilidades de PostCSS…) es opcional. Dos cambios de comportamiento se publican como [excepciones aprobadas](stability.md#excepciones-aprobadas) a la política de estabilidad: las props reactivas y la protección contra el *login CSRF* en `session.create()`. Además, algunos cambios se notan al actualizar. Esta guía los reúne con lo que conviene revisar en cada uno. La lista completa, con lo añadido y corregido, está en el [CHANGELOG](../packages/meeko/CHANGELOG.md); los compromisos de compatibilidad, en la [política de estabilidad](stability.md).

## Orden recomendado

1. Actualice `@meekojs/meeko` a la versión exacta `1.2.0` y vuelva a compilar o construir, incluidas las páginas prerenderizadas: el código generado y el runtime deben tener la misma versión. Si usa la extensión de VS Code, actualícela a `1.2.0`; Meeko DevTools no cambia.
2. Ejecute `meeko check` y revise los avisos `MEEK101`: señalan las copias de props que dejan de seguir a la prop (véase [Props reactivas](#props-reactivas-lo-que-el-setup-copia-de-una-prop)).
3. Si un script, una prueba o una app nativa inicia sesión sin enviar `Origin`, ajústelo (véase [`session.create()` exige un `Origin` permitido](#sessioncreate-exige-un-origin-permitido)).
4. Cambie `HOST` y `PUBLIC_ORIGIN` por `MEEKO_HOST` y `MEEKO_PUBLIC_ORIGIN` en el entorno de despliegue, y revise el `.env` de la raíz, que ahora se carga (véase [Variables de entorno](#variables-de-entorno)).
5. Mueva a `layers` las carpetas de layer que liste en `modules`, y sustituya `byId` en las llamadas de `api.*` cuando le convenga: ambos siguen funcionando durante `1.x`.
6. Si alguna prueba compara el HTML del servidor, revise [El HTML del documento](#el-html-del-documento).

## Excepciones aprobadas

### Props reactivas: lo que el setup copia de una prop

Cuando el padre cambia una prop, el hijo compilado sigue montado y sólo se actualizan los bindings que la leen: se conservan el DOM, el foco, el cursor y la composición de un `<input>`, el estado y los snippets. En `1.1`, el hijo se reconstruía con cada cambio y volvía a ejecutar el setup.

Por eso, lo que el setup copia de una prop conserva el valor inicial: `const { label } = props`, `props.title.toUpperCase()` en el nivel superior, `signal(props.initial)` o la entrada de `useApi(ruta, { query: { q: props.q } })`. Además, `props` es de sólo lectura en el navegador: asignar, borrar o definir una propiedad lanza `TypeError`. Los componentes con un `await` de datos en el nivel superior, los cambios de `<component is>`, de la señal de un `model` y la aparición o desaparición de un snippet siguen montando el hijo de nuevo. El SSR y la hidratación no cambian.

`meeko check`, `meeko build` y el editor avisan de esas lecturas con `MEEK101`, y el editor ofrece convertirlas en `computed` o declararlas con `untrack`. Para seguir la prop, léala donde se usa, derive con `computed` o pase una función a `useApi`/`useRpcQuery`:

```html
<script lang="ts">
const props = defineProps<{ title: string; q: string }>();

// Antes: se recalculaba porque el hijo se reconstruía con cada cambio
const upper = props.title.toUpperCase();
const results = useApi("/api/search", { query: { q: props.q } });

// Después
const upper = computed(() => props.title.toUpperCase());
const results = useApi("/api/search", () => ({ query: { q: props.q } }));
</script>
```

Si sólo interesa el valor inicial (por ejemplo, una clave que no cambia), `untrack(() => props.id)` lo declara y quita el aviso. Para cambiar un valor del padre, emita un evento (`defineEmits`) o use un modelo (`defineModel`) en lugar de escribir en `props`. Véase [Props reactivas](api.md#props-reactivas).

### `session.create()` exige un `Origin` permitido

En una petición `POST`, `PUT`, `PATCH` o `DELETE`, `context.session.create()` sólo crea la sesión si el `Origin` de la petición ya se comprobó (con la nueva opción `origin: "required"` de `defineApiRoute` y `defineRpc`, o en una mutación autenticada que superó Origin y CSRF) o está permitido en ese momento. Si falta o no está permitido, rechaza con `403 INVALID_ORIGIN` sin tocar el store ni enviar la cookie. Hasta `1.1`, una ruta de inicio de sesión sin comprobación propia dejaba que otra web iniciara sesión en el navegador de la víctima con una cuenta del atacante.

Los navegadores envían `Origin` en toda petición `POST`, así que un inicio de sesión desde la propia aplicación no cambia. Qué revisar:

- **Scripts, pruebas y apps nativas** que inician sesión sin la cabecera `Origin`, por ejemplo una prueba que hace `fetch` o `request.post` contra `/api/auth/login`: reciben `403`. Envíe el `Origin` de la aplicación (el de la petición, `MEEKO_PUBLIC_ORIGIN` o uno de `SessionManager({ allowedOrigins })`).
- **`origin: "none"`** en la ruta desactiva la comprobación. Es **inseguro**: deja la ruta expuesta al *login CSRF*, así que úselo sólo si la petición prueba de otra forma que no viene de otra web (por ejemplo, con un secreto de la app que el navegador no tiene). En desarrollo, el primer rechazo escribe un aviso con las dos salidas.
- `GET`, `HEAD` y `OPTIONS` no se comprueban: los callbacks de OAuth y los enlaces mágicos siguen funcionando y deben validar su propio `state` o token de un solo uso.
- Un `SessionHandle` construido a mano, sin `SessionManager.load`, crea la sesión como antes.

Declare además `origin: "required"` en las rutas de inicio de sesión: exige el `Origin` antes de validar la entrada y de ejecutar el handler.

```ts
// server/api/auth/login.post.ts
export default defineApiRoute({
  body: loginInput,
  response: okResult,
  origin: "required",
  handler: async ({ body, context }) => {
    // …
    await context.session.create({ user: body.username });
    return { ok: true as const };
  },
});
```

Véase [Origin en mutaciones anónimas](framework.md#origin-en-mutaciones-anónimas).

## Variables de entorno

### Prefijo `MEEKO_`

Todas las variables que lee Meeko empiezan por `MEEKO_`. `MEEKO_HOST`, `MEEKO_PORT` y `MEEKO_PUBLIC_ORIGIN` sustituyen a `HOST`, `PORT` y `PUBLIC_ORIGIN` en `meeko dev`, `start` y `preview`, en las salidas de Node, Bun y Deno y en el Worker de Cloudflare:

| Antes | Desde `1.2` | Estado del nombre anterior |
| --- | --- | --- |
| `HOST` | `MEEKO_HOST` | Obsoleto: se lee si falta `MEEKO_HOST`, con un aviso por proceso, y dejará de leerse en `2.0`. |
| `PUBLIC_ORIGIN` | `MEEKO_PUBLIC_ORIGIN` | Obsoleto, igual que `HOST`. |
| `PORT` | `MEEKO_PORT` | No está obsoleto: es el respaldo permanente de `MEEKO_PORT`, porque lo inyectan plataformas como Coolify, Railway o Cloud Run. |

Cambie el nombre en el entorno del despliegue, en los Dockerfile y en `vars` de `wrangler.jsonc`:

```jsonc
// Antes
"vars": { "PUBLIC_ORIGIN": "https://mi-app.example" }

// Después
"vars": { "MEEKO_PUBLIC_ORIGIN": "https://mi-app.example" }
```

El aviso de un nombre anterior es `[meeko] La variable HOST está obsoleta desde Meeko 1.2; usa MEEKO_HOST. HOST dejará de leerse en Meeko 2.0.` El prefijo `MEEKO_` queda reservado para Meeko: las variables propias de la aplicación deben usar otro nombre. Véase [Variables de entorno y `.env`](framework.md#variables-de-entorno-y-env).

### `.env` del proyecto

`meeko dev`, `build`, `start`, `preview` y `check` cargan el `.env` de la raíz del proyecto en `process.env`. Una variable que ya define el entorno tiene prioridad, y la salida de `meeko build` ejecutada directamente (`node .meeko/output/node/index.mjs`, un contenedor) no lee `.env`. Si el `.env` de la raíz contiene valores que no eran para esos comandos, como un `PORT` o un `MEEKO_*` de otro uso, ahora se aplican: revíselo. Cambiar `.env` exige reiniciar `meeko dev`.

### Puerto libre en `meeko dev`

Sin `MEEKO_PORT`, `PORT` ni `server.port`, `meeko dev` usa el primer puerto libre desde `4173` (hasta `4192`) y avisa del cambio. Un puerto fijado que está ocupado termina con un mensaje que lo nombra. Si un script esperaba que un segundo `meeko dev` fallara en `4173`, fije el puerto.

## Comprobación de tipos

### Resolución de módulos `Bundler`

`meeko check`, el editor y los `tsconfig` que genera Meeko usan `"module": "ESNext"` y `"moduleResolution": "Bundler"` en lugar de `NodeNext`, como Vite y Nuxt: un import relativo ya no necesita `.js` (`import { format } from "../utils/format"`). Los imports con `.js` siguen funcionando, así que no hay que cambiar nada. `meeko init-framework` genera el `tsconfig.json` nuevo; en un proyecto existente, cambie sus dos líneas para que el editor también acepte los imports sin extensión en los `.ts`:

```jsonc
// tsconfig.json
"module": "ESNext",           // antes "NodeNext"
"moduleResolution": "Bundler" // antes "NodeNext"
```

### Avisos en `meeko check`

`MEEK101` es el primer diagnóstico de tipo aviso: se muestra, pero no hace fallar `meeko check` ni `meeko build`, y el código de salida sólo es `1` con errores. En la API, `CompileDiagnostic` gana `severity: "warning"` y `CompileResult` gana `warnings`. La salida de `meeko check --json` incluye los avisos con `severity: "warning"`: si una herramienta trataba cada elemento como un error, haga que filtre por ese campo.

### Eventos tipados por elemento

En un elemento HTML o SVG, el manejador de `on:evento` recibe el tipo del evento para ese nombre y `event.currentTarget` tiene el tipo del elemento de la etiqueta. Un manejador válido en `1.1` lo sigue siendo; sólo una conversión explícita a otro elemento (`event.currentTarget as HTMLSelectElement` en un `<input>`) puede dar ahora un error de tipos. Quite la conversión, que ya no hace falta.

### Autoimports nuevos

`definePage`, `defineRouteMiddleware` y `definePlugin` se autoimportan, y en `server/` y `<script server>` también `defineApiRoute`, `defineRpc`, `defineServerMiddleware`, `defineSocketChannel`, `defineServerRuntime` y `ApiError`. Los imports explícitos siguen funcionando y prevalecen, así que quitarlos es opcional. Los tipos de `app/types` también se autoimportan.

Si la aplicación exporta desde una carpeta de autoimports un símbolo con uno de esos nombres (por ejemplo, su propio `ApiError` en `server/utils`) y lo usa sin import, el nombre pasa a ser ambiguo y el build falla con `Autoimport ambiguo`: impórtelo explícitamente o cámbiele el nombre. Sólo `useRoute`, `useForm`, `useStorage`, `useApiMutation`, `useHead` y `useSeoMeta` ceden ante un export propio.

## Plantilla y componentes

### `<MeekoOutlet />` y `<MeekoLink>`

Dos etiquetas propias que el compilador reconoce sin import. Adoptarlas es opcional: `<component is="props.outlet">` y `<a bind:href="href(...)">` siguen funcionando.

```html
<!-- Antes: app/layouts/default.meeko -->
<script lang="ts">
import type { Component } from "@meekojs/meeko";
const props = defineProps<{ outlet: Component<Record<string, unknown>> }>();
</script>
<template>
  <a bind:href="href('/about')">Acerca de</a>
  <main><component is="props.outlet"></component></main>
</template>

<!-- Después -->
<template>
  <MeekoLink to="/about">Acerca de</MeekoLink>
  <main><MeekoOutlet /></main>
</template>
```

`<MeekoOutlet />` sólo vale en `app/app.meeko` y en los layouts, sin atributos ni contenido (`MEEK104`). `<MeekoLink>` exige `bind:params` en las rutas dinámicas (`<MeekoLink to="/users/[id]" bind:params="{ id: user.id }">`), no admite `href` ni `bind:href` (`MEEK105`) y añade `aria-current="page"` en la ruta activa. Los nombres `MeekoLink` y `MeekoOutlet` quedan reservados: si la aplicación tenía un componente con uno de ellos, el compilador usa la etiqueta propia; cambie el nombre del componente. Véase [`<MeekoOutlet />` y `<MeekoLink>`](framework.md#meekooutlet--y-meekolink).

## El HTML del documento

Estos cambios no afectan a una aplicación que hidrata su propio HTML; sólo a pruebas, hojas de estilos o scripts que leían el HTML del servidor.

- **Un marcador de hidratación por elemento.** Cada elemento con bindings lleva un único `data-meeko="N"` en lugar de un atributo por binding (`data-meeko-a-N`, `data-meeko-e-N`, `data-meeko-m-N` y `data-meeko-r-N`). Los atributos son internos: una prueba no debería depender de ellos, sino del contenido o de atributos propios (`data-testid`).
- **Head gestionado.** El título y las etiquetas que gestiona Meeko, incluidos el `title` y la `description` de la ruta, van entre los comentarios `<!--meeko:head-->` y `<!--/meeko:head-->`, antes del HTML de `DocumentOptions.head`, y la meta CSRF sigue a `<meta charset>` y a las etiquetas por defecto (viewport e icono).
- **`<MeekoLink>` estático.** Con un `to` sin segmentos dinámicos ni `bind:params`/`bind:search`, el SSR escribe el `href` directamente.

## Head del documento

`document` en `meeko.config.ts`, `useHead` y `useSeoMeta` son nuevos en `1.2` (véase [Head del documento](framework.md#head-del-documento-document-usehead-y-useseometa)). Al adoptarlos, tenga en cuenta dos reglas:

- **`titleTemplate` de `document.head` es una cadena.** `document.head` y `meeko.addHead` de los módulos se fijan en el build como JSON y llegan también al navegador, así que su tipo, `DocumentHead`, no admite una función: `meeko check` y el editor la marcan como error de tipos en la línea de `titleTemplate`, y `meeko build` la rechaza. `useHead` sigue admitiendo `(title) => string`.
- **El título del sitio no pasa por la plantilla.** El `title` de `document.head` es el título del sitio: una página sin título propio, o con un título vacío, lo muestra tal cual, y la plantilla sólo se aplica a los títulos de `app.meeko`, los layouts, las páginas, `useHead` y el `head` de la ruta.

```ts
// meeko.config.ts
export default defineMeekoConfig({
  document: {
    head: {
      title: "Mi tienda",            // una página sin título: «Mi tienda»
      titleTemplate: "%s · Mi tienda", // una página titulada «Zapatillas»: «Zapatillas · Mi tienda»
    },
  },
});
```

Si probó la rama de desarrollo de `1.2` con una función en `document.head.titleTemplate`, cámbiela por la cadena, o lleve la función a un `useHead` de `app/app.meeko`.

## Servidor y sesiones

### Sesiones sin configuración: `server/runtime.ts` opcional

Un `server/runtime.ts` que devuelve `sessions` sigue funcionando sin cambios, y sus `sessions` siempre ganan. Lo nuevo es que el archivo es opcional: sin él, o si no devuelve `sessions`, Meeko crea las sesiones en memoria en desarrollo y, en producción (Node, Bun y Deno), en Redis con `MEEKO_REDIS_URL`. `ServerRuntime.sessions` pasa a ser opcional.

Para pasar a las sesiones sin configuración:

1. Instale el cliente `redis` en la aplicación (`npm install redis`): el build sólo lo incluye si está instalado.
2. Defina `MEEKO_REDIS_URL` (`redis://` o `rediss://`) y, si lo necesita, `MEEKO_REDIS_PREFIX` (por defecto, `meeko:<name de package.json>:prod:`), `MEEKO_SESSION_TTL` y `MEEKO_SESSION_SAMESITE`.
3. Quite `sessions` de `server/runtime.ts`, o el archivo entero si no hace nada más.

Las claves de las sesiones existentes dependen del prefijo: si quiere conservarlas, use el mismo prefijo que tenía su `RedisSessionStore`. Sin store persistente, la producción sigue sin arrancar, como en `1.1`. En Workers no hay TCP: declare un `SessionManager` con D1 o con Upstash. Si declara `sessions` propias, las variables `MEEKO_SESSION_*` no se aplican y Meeko lo avisa una vez. Un host propio que llama a `createServerApp` sin `sessions` debe pasar `loadRedis` para usar `MEEKO_REDIS_URL` (sin él, el arranque falla pidiendo el paquete `redis`) y `appName` para el prefijo por defecto (sin él, `meeko:app:prod:`); la entrada que genera Meeko ya los pasa. Véase [Sesiones sin configuración](framework.md#sesiones-sin-configuración).

### Contraseñas, `rateLimit` y `MeekoSession`

Son opcionales y no cambian nada por sí mismos; sustituyen código que muchas aplicaciones escribían a mano:

- **`@meekojs/meeko/password`**: `hashPassword`, `verifyPassword` y `needsRehash` con scrypt, y `meeko auth hash` para obtener un hash sin escribir código. `verifyPassword` acepta los hashes con el formato `scrypt$<N>$<r>$<p>$<sal>$<hash>` escritos antes a mano, sin regenerarlos. Importa `node:crypto`: sirve en Node, Bun y Deno, no en Workers. Véase [Contraseñas](framework.md#contraseñas).
- **`rateLimit: { limit, window, key? }`** en `defineApiRoute` y `defineRpc` responde `429 RATE_LIMITED` con `Retry-After`. Tras un proxy, defina `MEEKO_TRUST_PROXY` para contar por la IP del cliente. Un `SessionStore` propio puede implementar el método opcional `rateLimit`; sin él, los contadores viven en la memoria de cada instancia. Véase [Límite de peticiones](framework.md#límite-de-peticiones-ratelimit).
- **`MeekoSession`**: una aumentación de módulo de `@meekojs/meeko/server` tipa `context.session.current.data` y `session.create(data)` en toda la aplicación y permite quitar los `as`. Sin ella, los datos siguen siendo `unknown`. Véase [Tipos de la sesión](framework.md#tipos-de-la-sesión-meekosession).

### Respuestas `400` y estado de las mutaciones

- Las respuestas `400` de `INVALID_PARAMS`, `INVALID_QUERY`, `INVALID_BODY` e `INVALID_INPUT` añaden `issues: [{ path, message }]` con los mensajes del schema. Un cliente propio que validaba el cuerpo del error de forma estricta debe admitir ese campo.
- En `useRpcMutation` y `useApiMutation`, cada envío vacía `error` al empezar, y `discard()` también lo vacía. Si la interfaz mostraba el error anterior mientras se reintentaba, ahora desaparece al enviar.

## Configuración y build

### Carpetas de layer en `modules`

`modules` es ahora para módulos de `defineMeekoModule`. Una carpeta con `app/pages` listada en `modules` sigue funcionando como layer durante `1.x`, con un aviso por proceso en `meeko dev`, `meeko build` y `meeko check`. Muévala a `layers` (`extends` sigue siendo un alias de `layers`, sin aviso):

```ts
// Antes
export default defineMeekoConfig({ modules: ["./modules/auth"] });

// Después
export default defineMeekoConfig({ layers: ["./modules/auth"] });
```

Si esa carpeta tiene un `package.json` con entrada o un `index.ts` (o `.mts`, `.js`, `.mjs`) en su raíz, Meeko la carga como módulo y no como layer: muévala a `layers` antes de actualizar. Véase [Carpetas en `modules`](framework.md#carpetas-en-modules-deprecado).

### Segmentos dinámicos de `api.*`

`api.users.byId.get({ params: { id } })` está obsoleto y se retirará en `2.0`; el editor lo tacha. El reemplazo es llamar al segmento: `api.users({ id }).get()`. `useApi` no cambia. El manifiesto rechaza ahora, con las rutas en conflicto, una carpeta o un archivo estático con el mismo nombre que el segmento dinámico de su nivel (`server/api/users/byId/` junto a `users/[id]`) y dos parámetros que sólo cambian en la inicial (`[id]` y `[Id]`): cambie el nombre de uno de ellos. Véase [Segmentos dinámicos en `api.*`](framework.md#segmentos-dinámicos-en-api).

### CSS de los componentes

El CSS del `<style>` de un componente es ahora el módulo `Componente.meeko?meeko-style=<hash>&lang.css`, junto al archivo del componente, en lugar de un módulo virtual cuyo id empezaba por un byte nulo (`\0virtual:meeko-style:…`). Así, los plugins de PostCSS resuelven `@reference` y los `@import` relativos desde la carpeta del componente, como Tailwind 4 con `@apply`. El id es interno ([fuera del contrato](stability.md#fuera-del-contrato)), pero un plugin de Vite que reconocía el prefijo anterior debe reconocer la query `meeko-style`, y uno que filtra por `.meeko` puede recibir también estos módulos de CSS.

Para generar utilidades con TypeScript, el nuevo `@meekojs/meeko/postcss` ofrece el plugin `meekoUtilities()` y la at-rule `@utilities`, que va antes de `@tailwindcss/postcss`. Es opcional. Véase [Utilidades generadas con TypeScript](framework.md#utilidades-generadas-con-typescript).

### Errores del prerender

Una página que lanza durante el prerender de `meeko build` o `meeko prerender` sigue haciendo fallar el build, pero el mensaje ya no es `Prerender <url> returned HTTP 500 instead of HTML 200`, sino `Prerender <url> (<archivo de la ruta>) failed:` seguido del error con su pila y la cadena de `cause`. `prerenderRoutes` hace lo mismo cuando su `handler` rechaza, con el error original en `cause`. Si un script buscaba el texto anterior, haga que use el código de salida. Las peticiones de producción no cambian: el observador por defecto sigue registrando sólo el nombre del error y el ID de la petición.

## Editor

La extensión de VS Code `1.2.0` necesita el servidor de lenguaje de Meeko `1.2` para el completado de HTML, CSS y directivas. Cambios visibles:

- El modificador `reactive` ya no pone en cursiva las expresiones que leen un valor reactivo. Para recuperarla, añada `"*.reactive": { "italic": true }` en `rules` de `editor.semanticTokenColorCustomizations`.
- `editor.linkedEditing` está activado por defecto en los `.meeko`: la etiqueta de apertura y la de cierre se renombran juntas. Las etiquetas se cierran al escribir `>` o `</`; el ajuste `meeko.autoClosingTags` lo desactiva.
- Las directivas de control, los eventos y las etiquetas propias de Meeko tienen colores nuevos.
