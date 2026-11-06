# Router: páginas y navegación

El router conecta una URL con una página de `app/pages`, carga sus datos y la muestra dentro de sus layouts. El servidor y el navegador usan el mismo manifiesto de rutas. Este recorrido parte de la [primera aplicación](primeros-pasos.md) y no necesita base de datos ni un host propio.

## 1. Crear las páginas

Los archivos definen las URL:

| Archivo bajo `app/pages` | URL                   | Parámetros                  |
| ------------------------ | --------------------- | --------------------------- |
| `index.meeko`            | `/`                   | ninguno                     |
| `users/index.meeko`      | `/users`              | ninguno                     |
| `users/new.meeko`        | `/users/new`          | ninguno                     |
| `users/[id].meeko`       | `/users/42`           | `{ id: '42' }`              |
| `docs/[...slug].meeko`   | `/docs/guide/install` | `{ slug: 'guide/install' }` |
| `(admin)/reports.meeko`  | `/reports`            | ninguno                     |

`[id]` captura un segmento; `[...slug]` captura uno o más y debe ir al final. Los grupos `(admin)` organizan páginas sin añadir segmentos a la URL. Las rutas estáticas tienen prioridad sobre las dinámicas: `/users/new` no se interpreta como el usuario `new`. Dos páginas con la misma forma de URL, como `users/[id]` y `users/[name]`, producen una colisión.

Para el ejemplo, crea esta página de entrada:

```html
<!-- app/pages/users/index.meeko -->
<template>
	<h1>Usuarios</h1>
	<MeekoLink to="/users/[id]" bind:params="{ id: '42' }" bind:search="{ tab: 'activity' }">
		Ver usuario 42
	</MeekoLink>
</template>
```

`<MeekoLink>` genera un `<a href="/users/42?tab=activity">` real. `to` es el ID del archivo, sin query ni fragmento; `params` rellena los segmentos y `search` añade la query string. El editor y `meeko check` comprueban las rutas y sus parámetros. Un `<a href="/users/42">` normal también participa en la navegación cliente.

## 2. Validar y cargar los datos

Esta página usa datos de ejemplo en el propio bloque, sin servicios externos:

```html
<!-- app/pages/users/[id].meeko -->
<script server lang="ts">
	export const route = definePage({ layout: 'default' })
	const { params, search } = usePage()
	if (params.id !== '42') notFound()

	export const user = { id: params.id, name: 'Ada' }
	export const tab = search.tab === 'activity' ? 'activity' : 'profile'
	export const head = { title: `Usuario ${user.name}` }
</script>

<template>
	<h1>{user.name}</h1>
	<p>ID: {user.id}. Pestaña: {tab}.</p>
	<a href="/users">Volver a usuarios</a>
</template>
```

`usePage()` lee la petición en curso. El código de nivel superior se ejecuta en el servidor por petición con el modo SSR predeterminado, también al pedir los datos de una navegación cliente. Los datos exportados llegan a la página; las variables privadas permanecen en el servidor. Deben poder serializarse en JSON.

Aquí el ejemplo comprueba el ID manualmente. Para entradas reales, `definePage({ params, search })` admite schemas de Standard Schema que validan y transforman antes de ejecutar el código de datos; una entrada inválida responde `400`. También puedes cargar datos con `definePage({ load })`, cuyo resultado llega como `props.data`. Elige `load` o código de nivel superior, sin combinarlos en la misma página. Un archivo compañero `*.route.ts` permite separar las opciones de ruta del componente. Véanse [definePage](reference/macros/definepage.md) y [el bloque de servidor](reference/syntax/script-server.md).

## 3. Compartir el layout y mostrar la carga

Sustituye el contenido del layout del starter por:

```html
<!-- app/layouts/default.meeko -->
<script lang="ts">
	const route = useRoute()
	const navigation = useNavigation()
</script>

<template>
	<nav>
		<MeekoLink to="/">Inicio</MeekoLink>
		<MeekoLink to="/users" match="prefix">Usuarios</MeekoLink>
	</nav>
	<p>Ruta actual: {route.path.value}</p>
	<p if:when="navigation.pending.value" role="status">Cargando página…</p>
	<main bind:aria-busy="navigation.pending.value ? 'true' : null">
		<MeekoOutlet />
	</main>
</template>
```

`<MeekoOutlet />` muestra la página o el siguiente layout. Al pasar de `/users` a `/users/42`, Meeko conserva los layouts compartidos y su estado, y libera la página saliente. El indicador sólo aparece si la navegación sigue pendiente cuando el navegador pinta; una transición rápida puede terminar sin mostrarlo.

`useRoute()` ofrece señales `url`, `path`, `id`, `params` y `search`, y el método `isActive()`. Describe la página confirmada; mientras carga la siguiente sigue mostrando la anterior. `useNavigation()` sólo ofrece la señal `pending`, que en SSR vale `false`: no tiene un método `navigate`. Pide ambos composables en el script y utiliza sus resultados en los eventos. Para obtener los datos precisos de una página, usa sus exports o props; los parámetros de `useRoute()` son generales y sus valores son `unknown`.

`match="prefix"` marca «Usuarios» también en `/users/42` mediante `aria-current="true"`; en `/users` usa `"page"`. La query y el fragmento no afectan a esta comparación. Consulta [MeekoLink](reference/components/meekolink.md), [useRoute](reference/composables/useroute.md) y [useNavigation](reference/composables/usenavigation.md).

## 4. Elegir layouts y proteger grupos

Cualquier `app/layouts/<nombre>.meeko` es un layout con nombre. Puedes elegirlo en `definePage({ layout: 'dashboard' })` o compartirlo mediante `+group.ts`:

```ts
// app/pages/(dashboard)/+group.ts
export default defineGroup({ layout: 'dashboard', middleware: ['auth'] })
```

Para usar este grupo, crea `app/layouts/dashboard.meeko` con un `<MeekoOutlet />` y coloca sus páginas dentro de `(dashboard)`. El middleware siguiente requiere que la aplicación ya tenga un flujo de inicio de sesión en `/login`:

```ts
// app/middleware/auth.server.ts
import { redirect } from '@meekojs/meeko/framework'

export default defineServerRouteMiddleware(
	({ session }) => {
		if (!session.current) redirect('/login')
	},
	{ global: false },
)
```

`*.server.ts` permanece en el servidor y tiene acceso a la sesión. Sin `{ global: false }`, el middleware es global; con esa opción sólo se aplica a las páginas que lo seleccionan. Los middleware de `defineRouteMiddleware` se ejecutan también en el navegador. Protege además los datos de cada API y RPC: un guard de navegación no sustituye su autorización.

Los `+group.ts` se heredan de fuera hacia dentro y después gana la página. `middleware: false` elimina los middleware con nombre heredados, no los globales. `layout: false` quita el layout con nombre, conservando `app/app.meeko` y los `+layout.meeko` de las carpetas. Las props del layout se pasan con `layoutProps` y se pueden actualizar con `useLayout().set(...)`. Véanse [defineGroup](reference/macros/definegroup.md) y [middleware de rutas](routing-middleware.md).

## 5. Resolver errores y comprobar el recorrido

Añade una página de error general:

```html
<!-- app/error.meeko -->
<script lang="ts">
	const props = defineProps<{ status: number; message: string }>()
</script>

<template>
	<h1>Error {props.status}</h1>
	<p>{props.message}</p>
	<a href="/users">Volver a usuarios</a>
</template>
```

Abre `/users`, visita el perfil y vuelve con el botón atrás. `/users/99` ejecuta `notFound()` y muestra el error `404`; una URL sin ruta también usa `app/error.meeko`. Un `+error.meeko` más cercano tiene prioridad para los errores de sus páginas. `redirect('/login')` detiene el código de servidor y responde con una redirección (`302` por defecto).

Ejecuta `npm run check` para generar los tipos y comprobar el proyecto del starter. `pnpm exec meeko routes .` permite inspeccionar `.meeko/manifests/routes.json`. Véanse [errores](routing-data.md#página-de-error-de-la-aplicación-apperrormeeko) y [meeko routes](reference/commands/meeko-routes.md).

## Qué ocurre al navegar

La primera carga SSR entrega HTML y datos que el navegador hidrata. En las siguientes navegaciones, Meeko resuelve la ruta, ejecuta los controles aplicables, carga los módulos y datos, y confirma la nueva página junto con el estado de ruta y el historial. Si empieza otra navegación, aborta la anterior para que una respuesta antigua no sustituya la nueva.

| Modo de `definePage({ render })` | Origen del contenido                                              |
| -------------------------------- | ----------------------------------------------------------------- |
| `ssr` (predeterminado)           | Servidor, por petición                                            |
| `stream`                         | Servidor, con valores diferidos que llegan después                |
| `prerender`                      | Build, con entradas explícitas para parámetros dinámicos          |
| `client`                         | Navegador; el HTML inicial contiene los layouts y un outlet vacío |

Con `client`, el loader y sus opciones se envían al navegador y no pueden importar secretos ni servicios de servidor; no se admite el código de nivel superior del ejemplo de datos. Los otros modos piden datos al servidor durante la navegación; el hosting estático usa los payloads generados junto al HTML. Consulta los [modos de render](routing-data.md#modos-de-render).

Los clics modificados, enlaces externos, descargas y destinos en otra pestaña siguen el comportamiento del navegador. Una URL sin ruta se carga como documento. Cambiar sólo `#seccion` no vuelve a ejecutar los datos. Atrás y adelante restauran el scroll de la ventana; las View Transitions son opcionales. Véanse [enlaces y scroll](routing-navigation.md#enlaces-anclas-y-scroll) y [View Transitions](routing-navigation.md#view-transitions-nativas).

## APIs para código e integraciones

| API                               | Responsabilidad                                                                                        |
| --------------------------------- | ------------------------------------------------------------------------------------------------------ |
| `href(id, options)`               | Construir una URL tipada sin navegar                                                                   |
| `app.navigate(url, { replace? })` | Navegar desde la instancia que devuelve `mountClientApp`; `replace` sustituye la entrada del historial |
| `createRouteManifest(records)`    | Validar, ordenar y congelar las rutas                                                                  |
| `matchRoute(routes, pathname)`    | Encontrar la ruta y sus parámetros, sin query ni fragmento                                             |
| `createNavigator(routes, render)` | Gestionar historial y cancelación con un callback de render propio                                     |
| `mountClientApp(options)`         | Hidratar y conectar enlaces, datos, layouts y navegación                                               |

En una aplicación del starter el arranque ya está generado; no necesitas montar otro cliente. Dentro de componentes, usa enlaces para navegar. `useNavigation()` lee el estado de carga. Para integraciones propias, `app.navigate` permite navegación programática; llama a `app.dispose()` al desmontar el host para liberar sus recursos. `createNavigator` por sí solo no hidrata ni carga datos. Consulta [href](reference/utils/href.md), [createNavigator](reference/advanced/createnavigator.md), [matchRoute](reference/advanced/matchroute.md) y [mountClientApp](reference/advanced/mountclientapp.md).
