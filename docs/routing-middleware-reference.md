# Middleware de rutas: detalles técnicos

Contratos completos y casos especiales. Para los usos habituales, empieza por la [guía breve](routing-middleware.md).

## Middleware con nombre

Un guard que sólo afecta a una parte de la aplicación se declara con nombre y lo piden las rutas que lo necesitan, sin comparar `match.route.id` ni rutas de archivo:

```ts
// app/middleware/auth.ts
export default defineRouteMiddleware(
	({ url, phase, request }) => {
		// Una cookie pública que indica la sesión: la cookie de sesión de Meeko es HttpOnly.
		const cookies = phase === 'server' ? (request.headers.get('cookie') ?? '') : document.cookie
		if (!cookies.includes('signed-in=1')) {
			const login = new URL('/login', url)
			login.searchParams.set('next', url.pathname)
			return Response.redirect(login)
		}
	},
	{ global: false },
)
```

```ts
// app/pages/(dashboard)/+group.ts: todas las páginas del grupo
export default defineGroup({ layout: 'dashboard', middleware: ['auth'] })
```

```html
<!-- app/pages/(dashboard)/admin/users.meeko: la página añade el suyo -->
<script
	server
	lang="ts"
>
	export const route = definePage({ middleware: ['admin'] })
</script>
<template><h1>Usuarios</h1></template>
```

- **Nombre.** Es la ruta del archivo dentro de `app/middleware`, sin `.ts` ni el prefijo numérico de orden de cada parte: `auth.ts` y `10-auth.ts` son `"auth"`, y `admin/20-role.ts` es `"admin/role"`. Letras, dígitos, `-` y `_`, y `/` entre carpetas. Dos archivos que dan el mismo nombre, si uno de ellos es con nombre, detienen el descubrimiento.
- **Herencia.** `middleware` se acumula de fuera hacia dentro: los `+group.ts` exteriores, los interiores y la página, sin repetir (cuenta la primera aparición). `middleware: false` en un grupo o en una página quita los heredados; los grupos interiores y la página pueden volver a añadir. `middleware: []` no cambia nada.
- **Orden.** Primero todos los globales, en su orden de siempre; después los de la ruta, en el orden declarado. El primero que devuelve un `Response` detiene la ruta y los siguientes no se ejecutan. Es el mismo contrato en SSR, en la navegación del navegador, en `render: "client"`, en el prerender y en el adaptador `static`.
- **Literales.** Como `render` y `layout`, Meeko lo lee sin ejecutar el archivo: `{ global: false }` debe ser un objeto literal con el literal `true` o `false`, y `middleware`, un array literal de textos o `false`. Un valor calculado da `las opciones de defineRouteMiddleware deben ser un objeto literal…` o `middleware debe ser un array literal…` con el archivo. Un spread en las opciones de la página que puede llevar `middleware` (un objeto importado, o una constante del archivo que lo tiene) exige declarar `middleware` después del último spread: `definePage({ ...protegida, render: "ssr", middleware: ["auth"] })`, o `middleware: []` si no añade ninguno. Si no, el descubrimiento se detiene con `el spread protegida puede llevar middleware…`, porque la ruta se serviría sin él. Si una página declara un middleware que su manifiesto no lista (un build antiguo), la petición falla con `500` antes del loader, como con `layout`.
- **Errores.** Detienen `meeko dev`, `meeko build` y `meeko check`, con el archivo que declara el nombre: `el middleware "nowhere" no existe; crea app/middleware/nowhere.ts con defineRouteMiddleware(..., { global: false }) (middleware con nombre disponibles: "admin", "auth"), o app/middleware/nowhere.server.ts…` y, para un global, `el middleware "locale" (…/10-locale.ts) es global y ya se ejecuta en todas las rutas`.
- **Tipos y editor.** `middleware` se tipa con la unión de los middleware con nombre (`RouteMiddlewareName`, que declara `.meeko/types/routes.d.ts`), con completado en el editor. En una aplicación sin middleware con nombre la unión está vacía (`never`), así que `middleware: ["typo"]` ya es un error de tipos. El hover de un nombre en `definePage` muestra su archivo y sus páginas, y Ctrl+clic lo abre.
- **Bundle.** Los globales viajan con la entrada del navegador. Cada middleware con nombre que usa alguna ruta es un chunk aparte, que el navegador carga la primera vez que navega a una de sus rutas; uno que ninguna ruta usa no llega al navegador. La hidratación no los ejecuta: el servidor ya lo hizo.
- **Manifiesto.** Cada ruta guarda sus middleware con nombre resueltos en `RouteRecord.middleware` (archivos, en orden de ejecución); `AppManifest.routeMiddleware` sigue listando sólo los globales. Un host propio que use `createFrameworkHandler` o `mountClientApp` con rutas que los declaran pasa `loadNamedMiddleware(file)`; sin él, esas rutas fallan en lugar de saltarse sus guards. `discoverRouteMiddleware` de `@meekojs/meeko/build` separa los globales de los con nombre.
- **Desarrollo.** Crear, borrar o renombrar un middleware, cambiar su `{ global }` o el `middleware` de una página o un `+group.ts` hace que `meeko dev` vuelva a descubrir las rutas y cree de nuevo la aplicación.
- **Layers y módulos.** Como hasta ahora, sólo cuenta `app/middleware` del proyecto: las páginas de los layers eligen entre los middleware con nombre del proyecto, y los módulos no añaden middleware de ruta.

`app/middleware/*.ts` se empaqueta también para el navegador, el middleware con nombre incluido: no importe allí `server/`, secretos ni lógica de autorización que deba ser obligatoria en servidor. Un guard de ruta isomórfico, global o con nombre, mejora la navegación, pero nunca sustituye la validación de sesión y autorización del loader, API o RPC; para proteger la página con la sesión, use un [middleware de ruta de servidor](#middleware-de-ruta-de-servidor). Los archivos `*.test.ts`, `*.spec.ts`, `*.d.ts` y `*.client.ts` se excluyen del descubrimiento de middleware de rutas; desde `1.6`, los `*.server.ts` son middleware de ruta de servidor.

## Middleware de ruta de servidor

Desde `1.6`, un archivo `app/middleware/*.server.ts` es middleware de ruta **sólo de servidor**: se declara con `defineServerRouteMiddleware` (de `@meekojs/meeko/framework`; se autoimporta en los `*.server.ts` y en todo `server/`, como las demás definiciones de servidor), recibe la sesión de la petición y nunca llega al bundle del navegador. Es la forma de expresar «este grupo exige sesión» sin repetir la comprobación en el `<script server>` de cada página:

```ts
// app/middleware/auth.server.ts
import { redirect } from '@meekojs/meeko/framework'

export default defineServerRouteMiddleware(
	({ session, url }) => {
		if (!session.current) redirect(`/login?next=${encodeURIComponent(url.pathname)}`)
	},
	{ global: false },
)
```

```ts
// app/pages/(dashboard)/+group.ts: todas las páginas del grupo exigen sesión
export default defineGroup({ layout: 'dashboard', middleware: ['auth'] })
```

- **Global o con nombre.** La misma regla que el isomórfico: sin opciones es global y se ejecuta en todas las rutas; con `{ global: false }` (leído sin ejecutar el archivo) es un middleware con nombre, y `auth.server.ts` (o `10-auth.server.ts`) es `"auth"`. `middleware: ["auth"]` en `definePage` o en un `+group.ts` resuelve a `auth.ts` o a `auth.server.ts`, con la misma herencia y `middleware: false`; si los dos existen y alguno es con nombre, el nombre está duplicado y el descubrimiento se detiene. El export por defecto de un `*.server.ts` debe ser una llamada a `defineServerRouteMiddleware(...)`, directa o a través de una constante del archivo (`as const` incluido), de un import con alias o de `export { auth as default }`. Hasta `1.5` esos archivos se ignoraban, así que un helper que viviera allí, sin export por defecto o con otro (`export default function parseCookies…`), detiene el descubrimiento con `un middleware de ruta de servidor debe exportar por defecto defineServerRouteMiddleware(...)… mueve los helpers a server/utils` en lugar de ejecutarse en cada petición como middleware global. Cada clase de archivo usa su definición: `defineRouteMiddleware` en un `*.server.ts`, o `defineServerRouteMiddleware` en un `*.ts`, es un error con el archivo.
- **Contexto.** El de `usePage()` en el `<script server>`: `url`, `params`, `search`, `request`, `signal` y `context` (el `RequestContext`), con `session`, `services`, `platform` y `requestId` a mano, además de `match`. La IP del cliente, tras el proxy si `MEEKO_TRUST_PROXY` lo permite, es `context.clientAddress`. `params` y `search` son los de la URL, sin validar todavía con los schemas de la página, porque el middleware se ejecuta antes que su `<script server>` o su `load`. `defineServerRouteMiddleware<Services>` tipa `services`, y `session` sigue a `MeekoSession`. Con `createFrameworkHandler` sin `createContext`, leer `context` o `session` lanza un error.
- **Cómo corta.** Igual que el `<script server>`: `redirect()`, `notFound()` o un error, y también devolviendo un `Response`. Devolver `undefined` continúa.
- **Cuándo se ejecuta.** En la petición del documento (SSR), y al navegar en el navegador dentro de la petición de los datos de la página, la misma que ejecuta el `<script server>`: una redirección o un error llegan al navegador igual que los de un `redirect()` del `<script server>`, y la navegación los sigue. En `render: "stream"`, antes del primer byte, como el loader crítico.
- **Orden.** Siempre el mismo: primero el middleware isomórfico (los globales y después los con nombre, en el orden declarado) y después el de servidor (los globales y después los con nombre, en el orden declarado). Al navegar, el navegador ejecuta el isomórfico y la petición de datos vuelve a ejecutarlo en el servidor antes del de servidor, como hasta ahora. El primero que corta detiene la ruta.
- **`render: "client"` y `render: "prerender"`.** Una página `render: "client"` no pide sus datos al servidor al navegar, y una prerenderizada se renderiza en el build, sin la petición ni la sesión de cada visitante. Pedir un middleware de servidor con nombre en una de ellas (también heredado de un `+group.ts`) detiene el descubrimiento: `el middleware de servidor "auth" (…) necesita una página con datos del servidor, pero … usa render: "client"…`; quítelo de esa página con `middleware: false` o use `render: "ssr"` o `"stream"`. Los globales de servidor no se ejecutan en esas páginas, tampoco en su primera carga, para que su comportamiento no dependa de cómo se llegó a ellas. El adaptador `static`, que sólo admite páginas prerenderizadas, avisa de que no los ejecuta.
- **Límite de seguridad.** El plugin de Vite rechaza cualquier `*.server.*` que alcance el grafo del navegador, y el módulo virtual del middleware del cliente nunca los incluye; el manifiesto del navegador tampoco lleva sus rutas. Pueden importar `server/` y `#server/…` sin `MEEK108`, y `meeko check` los comprueba con los tipos del servidor.
- **Tipos y editor.** `RouteMiddlewareName` incluye sus nombres, salvo en el `middleware` de una página `render: "client"`, que sólo admite los isomórficos; el hover de un nombre en `definePage` o `defineGroup` muestra el archivo, que es «sólo servidor», y sus páginas. Un nombre inexistente o global da los mismos errores en `meeko dev`, `meeko build` y `meeko check`.
- **Manifiesto y host propio.** Cada ruta guarda en `RouteRecord.serverMiddleware` su cadena completa de servidor, en orden de ejecución: los globales y después los con nombre (las rutas `render: "client"` y `"prerender"` no la llevan). Un host propio que use `createFrameworkHandler` pasa `loadServerMiddleware(file)`, que carga cada archivo de esa lista; sin él, una ruta que lista alguno, aunque sea sólo un global, falla en lugar de saltárselo. Las rutas de un módulo programático de `composeFrameworkRoutes` reciben también los globales del proyecto.
- **Desarrollo.** Crear o borrar uno, o cambiar su `{ global }`, hace que `meeko dev` vuelva a descubrir las rutas.

Cuándo usar cada uno:

- **El isomórfico (`*.ts`) mejora la navegación**: decide en el navegador, sin una petición, y redirige antes de pedir nada. No puede leer la sesión (su cookie es HttpOnly) ni importar código de servidor.
- **El de servidor (`*.server.ts`) protege la página**: comprueba la sesión antes de que el servidor renderice o envíe sus datos.
- **Ninguno protege `server/api` ni el RPC.** El middleware de ruta sólo se ejecuta para las páginas: los endpoints de API y los procedimientos RPC necesitan sus propias guardas (`auth: "required"`, comprobaciones en el handler o middleware de servidor), aunque sólo los llamen páginas protegidas.
