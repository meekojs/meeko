# Actualizar de 1.5 a 1.6

`1.6` es un minor: lo nuevo (el middleware de ruta con nombre, que las rutas piden con `middleware` en `definePage` y en `+group.ts`, y el middleware de ruta de servidor, `app/middleware/*.server.ts` con `defineServerRouteMiddleware`) es opcional. Dos cambios se publican como [excepciones aprobadas](stability.md#excepciones-aprobadas) a la política de estabilidad: los archivos `*.server.ts` de `app/middleware`, que hasta `1.5` se ignoraban, son middleware de ruta de servidor, y un spread en las opciones de una página que puede llevar `middleware` exige declararlo después. Además, algunos cambios se notan al actualizar: el orden del middleware global en el navegador, la URL del render en el payload, `<MeekoThemeToggle>` en las páginas servidas en otra URL, la redirección de `POST /_meeko/theme`, un nombre nuevo que se autoimporta y errores de descubrimiento nuevos. Esta guía los reúne con lo que conviene revisar en cada uno y explica cómo adoptar cada función. La lista completa, con lo añadido y corregido, está en el [CHANGELOG](../packages/meeko/CHANGELOG.md); los compromisos de compatibilidad, en la [política de estabilidad](stability.md).

## Orden recomendado

1. Actualice `@meekojs/meeko` a la versión exacta `1.6.0` y vuelva a compilar o construir, incluidas las páginas prerenderizadas: el código generado y el runtime deben tener la misma versión, y los documentos de `1.6` llevan la URL del render en el payload (véase [La URL del render en el payload](#la-url-del-render-en-el-payload)). Si usa la extensión de VS Code, actualícela a `1.6.0`; Meeko DevTools no cambia (sigue en `1.0.0`).
2. Busque archivos `*.server.ts` en `app/middleware` (también en subcarpetas). Si alguno es un helper, muévalo a `server/utils` antes de arrancar: el descubrimiento se detiene (véase [Los `.server.ts` de `app/middleware` son middleware de servidor](#los-serverts-de-appmiddleware-son-middleware-de-servidor)).
3. Busque opciones de página con spread (`definePage({ ...comun, … })`) y declare `middleware` después del último spread donde el objeto venga de un import (véase [Un spread en las opciones de la página](#un-spread-en-las-opciones-de-la-página)).
4. Ejecute `meeko check`. Revise los [errores de descubrimiento nuevos](#errores-de-descubrimiento-nuevos), que también detienen `meeko dev` y `meeko build`.
5. Si sirve la aplicación con un host propio sobre `createFrameworkHandler` y adopta el middleware de ruta, pásele los cargadores nuevos (véase [Host propio](#host-propio)).

## Excepciones aprobadas

### Los `.server.ts` de `app/middleware` son middleware de servidor

Hasta `1.5`, el descubrimiento de middleware de ruta excluía los archivos `app/middleware/*.server.ts`, así que algunos proyectos guardaban allí código de servidor. Desde `1.6` son [middleware de ruta de servidor](framework.md#middleware-de-ruta-de-servidor): su export por defecto debe ser una llamada a `defineServerRouteMiddleware(...)`, directa o a través de una constante del archivo (`as const` incluido), de un import con alias (`import { defineServerRouteMiddleware as guard } …`) o de `export { auth as default }`.

Cualquier otra forma detiene `meeko dev`, `meeko build` y `meeko check` con el archivo, en lugar de ejecutarse en cada petición de página como middleware global de servidor:

```text
app/middleware/cookies.server.ts: un middleware de ruta de servidor debe exportar por defecto defineServerRouteMiddleware(...); desde 1.6, los archivos *.server.ts de app/middleware son middleware de ruta de servidor, así que mueve los helpers a server/utils
```

Le pasa a un archivo sin export por defecto (`export const parse = …`), a uno con `export default function parseCookies(…)`, `export default class`, `export default parseCookies`, un objeto o la llamada a otra función, y a `export { default } from "./otro"`. Qué cambiar:

- **Un helper de servidor**: muévalo a `server/utils` (se autoimporta en el código de servidor) o impórtelo con `#server/…`.
- **Cualquier otro código de servidor** que viviera allí: sáquelo de `app/middleware`. No le quite sólo el sufijo, porque un `app/middleware/*.ts` es middleware isomórfico, se ejecuta en cada ruta y se empaqueta para el navegador.

Los `*.ts` de `app/middleware` no cambian: un export por defecto que no es `defineRouteMiddleware(...)` sigue siendo middleware global, como en `1.5`.

### Un spread en las opciones de la página

Meeko lee las opciones de ruta (`render`, `layout` y, desde `1.6`, `middleware`) sin ejecutar el archivo. Un spread que puede llevar `middleware` no llegaba al manifiesto, y la página se servía sin él aunque los tipos lo aceptaran:

```ts
// Antes: protegida trae middleware: ["auth"], pero el build no lo veía
const protegida = { middleware: ["auth"] } as const;
export const route = definePage({ ...protegida, render: "ssr", load });
```

Desde `1.6`, si el spread puede llevar `middleware` (un objeto importado, el resultado de una llamada o una constante del archivo que lo tiene) y `middleware` no se declara de forma explícita después del último spread, el descubrimiento se detiene:

```text
app/pages/panel.meeko: el spread protegida puede llevar middleware, que Meeko no lee durante el build y la ruta se serviría sin él; declara middleware de forma explícita después del último spread (middleware: ["auth"], o middleware: [] si no añade ninguno)
```

Escriba `middleware` después del último spread, con los nombres o con `middleware: []`:

```ts
import { comun } from "./comun";

export const route = definePage({ ...comun, render: "ssr", middleware: ["auth"] });
```

El spread de una constante del mismo archivo sin `middleware` sigue valiendo. Un `+group.ts` no admite spreads, como en `1.5`. Si una página declara un middleware que su manifiesto no lista (por ejemplo, un build anterior), la petición falla con `500` antes del loader, como ya pasaba con `layout`: vuelva a construir.

## Cambios que se notan al actualizar

### Orden del middleware global en el navegador

Hasta `1.5`, la entrada del cliente ordenaba los middleware globales de `app/middleware` con `localeCompare` y el servidor por código de carácter. Sólo difería con nombres que mezclan mayúsculas, `-` o `_`. Ahora el navegador usa el orden del servidor, así que en esos casos el orden de la navegación del navegador puede cambiar. Si dos middleware globales dependen de su orden, use prefijos numéricos (`10-locale.ts`, `20-auth.ts`).

### La URL del render en el payload

El payload del documento lleva el campo opcional `url`: la ruta y la query para las que se renderizó (`/?utm=mail`, o la URL del `404.html` del adaptador `static`). El navegador hidrata `useRoute()` con ella y, justo después, pasa a su propia URL. Un payload sin `url`, como los de `1.5`, sigue siendo válido e hidrata con la URL del navegador. Vuelva a construir las páginas prerenderizadas para que lo lleven.

### `<MeekoThemeToggle>` en páginas servidas en otra URL

El `404.html` del adaptador `static`, que el hosting sirve en cualquier URL inexistente, y una página prerenderizada servida con una query string fallaban al hidratar con `Hydration mismatch` si algo pintaba `useRoute()`: el navegador hidrataba con su URL y no con la del render. Le pasaba a `<MeekoThemeToggle>`, cuyo campo oculto `return` lleva `useRoute().url`, y podía pasarle a `<MeekoAwait reserve>` y al `aria-current` de `<MeekoLink>`. Con `url` en el payload ya hidratan, y el formulario sin JavaScript del tema vuelve a la página en la que está el visitante. Si tenía un rodeo (por ejemplo, no pintar `<MeekoThemeToggle>` en la página de error), puede quitarlo.

### Redirección de `POST /_meeko/theme`

Un `return` con segmentos de punto (`/.//evil.example`, `/a/..//evil.example`) se normalizaba a `//evil.example`, una `Location` relativa al protocolo que lleva a otro sitio. Ahora vuelve a `/`. La comprobación de `Origin` ya impedía usarlo desde otro sitio. Los formularios de `<MeekoThemeToggle>` no cambian.

### Nombre nuevo que se autoimporta

`defineServerRouteMiddleware` se autoimporta en los `*.server.ts` y en todo `server/`, como las definiciones de servidor. Un export propio con el mismo nombre, o un import o una declaración del archivo, tiene prioridad.

### Tipos de `middleware`

Con las declaraciones de `.meeko/types/routes.d.ts` (`meeko check`, `meeko dev`), `middleware` se tipa con la unión `RouteMiddlewareName`. En una aplicación sin middleware con nombre la unión está vacía, así que cualquier nombre (`middleware: ["typo"]`) es un error de tipos; `middleware: []` y `middleware: false` siguen valiendo. En una página `render: "client"`, `middleware` no admite los nombres de servidor.

## Adoptar las funciones nuevas

### Middleware con nombre

Un middleware de `app/middleware` sin opciones sigue siendo global. Con `{ global: false }` es un middleware con nombre, que sólo se ejecuta en las rutas que lo piden. El nombre es la ruta del archivo sin `.ts` ni el prefijo numérico de orden: `auth.ts` y `10-auth.ts` son `"auth"`, y `admin/20-role.ts` es `"admin/role"`.

```ts
// app/middleware/auth.ts
export default defineRouteMiddleware(({ url, phase, request }) => {
  // Una cookie pública que indica la sesión: la cookie de sesión de Meeko es HttpOnly.
  const cookies = phase === "server" ? request?.headers.get("cookie") ?? "" : document.cookie;
  if (!cookies.includes("signed-in=1")) return Response.redirect(new URL("/login", url));
}, { global: false });
```

```ts
// app/pages/(dashboard)/+group.ts: todas las páginas del grupo
export default defineGroup({ layout: "dashboard", middleware: ["auth"] });
```

Se acumula de los `+group.ts` exteriores a la página, sin repetir, y `middleware: false` quita los heredados. Se ejecuta después de los globales, en el orden declarado, en SSR, en la navegación del navegador, en `render: "client"`, en el prerender y en el adaptador `static`. Cada middleware con nombre es un chunk que el navegador carga la primera vez que navega a una de sus rutas. Véase [Middleware con nombre](framework.md#middleware-con-nombre).

### Middleware de servidor

Un `app/middleware/*.server.ts` con `defineServerRouteMiddleware` sólo se ejecuta en el servidor, con la sesión de la petición, y nunca llega al bundle del navegador: puede importar `server/` y `#server/…`. Es la forma de expresar «este grupo exige sesión» sin repetir la comprobación en el `<script server>` de cada página. Así lo adoptó diegootayza para su panel, con su propia comprobación `isOwner(context)` de `server/auth.ts`, que lee la sesión del `RequestContext`:

```ts
// app/middleware/auth.server.ts
import { redirect } from "@meekojs/meeko/framework";
import { isOwner } from "#server/auth";

export default defineServerRouteMiddleware(({ context }) => {
  if (!isOwner(context)) redirect("/login");
}, { global: false });
```

```ts
// app/pages/(dashboard)/+group.ts: todas las páginas del grupo exigen sesión
export default defineGroup({ layout: "dashboard", middleware: ["auth"] });
```

Sin sesión, la página del documento responde `302` a `/login`, y al navegar el navegador sigue la misma redirección, que llega en la petición de datos de la página. Se ejecuta después de todo el middleware isomórfico y antes del `<script server>` o el `load`; en `render: "stream"`, antes del primer byte. Corta con `redirect()`, `notFound()`, un error o devolviendo un `Response`. Sin opciones, un `*.server.ts` es global. Véase [Middleware de ruta de servidor](framework.md#middleware-de-ruta-de-servidor).

### Cuándo usar cada uno

- **El isomórfico (`*.ts`) mejora la navegación**: decide en el navegador, sin una petición. Se empaqueta para el navegador, así que no puede leer la sesión (su cookie es HttpOnly) ni importar código de servidor.
- **El de servidor (`*.server.ts`) protege la página**: comprueba la sesión antes de que el servidor renderice o envíe sus datos. No se ejecuta en las páginas `render: "client"` ni `"prerender"`, que no piden sus datos al servidor en cada petición: pedir uno con nombre en ellas detiene el descubrimiento.
- **Ninguno protege `server/api` ni el RPC**: los endpoints y los procedimientos necesitan sus propias guardas (`auth: "required"` o comprobaciones en el handler), aunque sólo los llamen páginas protegidas.

### Host propio

Si sirve la aplicación con `createServerApp` (los adaptadores de Meeko), no tiene que hacer nada. Un host propio sobre `createFrameworkHandler` con rutas de `discoverRoutes` o `composeFrameworkRoutes` pasa:

- `loadNamedMiddleware(file)`, para los archivos de `RouteRecord.middleware` (también en `mountClientApp`);
- `loadServerMiddleware(file)`, para los de `RouteRecord.serverMiddleware`, que es la cadena completa de servidor de la ruta: los globales y después los con nombre.

Sin ellos, una ruta que lista alguno, aunque sea sólo un middleware global de servidor, falla con `500` en lugar de saltárselo. `discoverRouteMiddleware` de `@meekojs/meeko/build` separa los globales isomórficos (`global`), los globales de servidor (`serverGlobal`) y los con nombre (`named`).

## Errores de descubrimiento nuevos

Detienen `meeko dev`, `meeko build` y `meeko check` con el archivo:

| Mensaje (extracto) | Qué lo provoca |
| --- | --- |
| `el middleware "nowhere" no existe; crea app/middleware/nowhere.ts …` | Un nombre de `middleware` que no es de ningún middleware con nombre. El mensaje lista los disponibles. |
| `el middleware "locale" (…) es global y ya se ejecuta en todas las rutas` | Un nombre de `middleware` que es de un middleware global. |
| `"…" no es un nombre de middleware válido` | Un nombre fuera de letras, dígitos, `-`, `_` y `/` entre carpetas. |
| `… y … declaran el mismo middleware "auth"` | Dos archivos que dan el mismo nombre si uno es con nombre, también `auth.ts` y `auth.server.ts`. |
| `las opciones de defineRouteMiddleware deben ser un objeto literal…`, `global debe ser el literal true o false…`, `opción de middleware desconocida…` | Unas opciones de middleware que Meeko no puede leer sin ejecutar el archivo. |
| `middleware debe ser un array literal de nombres de app/middleware, o false…` | Un `middleware` calculado en `definePage` o en un `+group.ts`. |
| `el spread … puede llevar middleware…` | Véase [Un spread en las opciones de la página](#un-spread-en-las-opciones-de-la-página). |
| `un middleware de ruta de servidor debe exportar por defecto defineServerRouteMiddleware(...)…` | Véase [Los `.server.ts` de `app/middleware` son middleware de servidor](#los-serverts-de-appmiddleware-son-middleware-de-servidor). |
| `un archivo *.server.ts de app/middleware es middleware de ruta de servidor; decláralo con defineServerRouteMiddleware…` | `defineRouteMiddleware` en un `*.server.ts`. |
| `defineServerRouteMiddleware sólo se admite en un archivo *.server.ts de app/middleware…` | `defineServerRouteMiddleware` en un `*.ts`; el mensaje propone el nombre `*.server.ts`. |
| `el middleware de servidor "auth" (…) necesita una página con datos del servidor…` | Una página `render: "client"` o `"prerender"` que pide un middleware de servidor con nombre, también heredado de un `+group.ts`. Quítelo con `middleware: false` o use `render: "ssr"` o `"stream"`. |

## Editor

La extensión de VS Code `1.6.0` incluye el servidor de lenguaje de Meeko `1.6`: en `definePage` y en `defineGroup` completa los nombres de `middleware: [...]`, el hover de un nombre muestra su archivo de `app/middleware` y sus páginas (o avisa de que es global o no existe), Ctrl+clic lo abre, y un middleware de servidor se marca como «sólo servidor». Con `meeko.languageServer.preferWorkspace` (activado por defecto) usa el servidor del `@meekojs/meeko` del proyecto, así que lo nuevo llega al actualizar el paquete a `1.6`. Véase [Editores](editors.md).
