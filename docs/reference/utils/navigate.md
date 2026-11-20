---
title: navigate
group: utils
since: 1.10.0
description: Navega desde el código del navegador por el router de la aplicación, con el destino tipado de MeekoLink o una URL, y devuelve si la página nueva se confirmó.
symbols:
  - "@meekojs/meeko/framework#navigate"
types:
  - "@meekojs/meeko/framework#NavigateTarget"
  - "@meekojs/meeko/framework#NavigateRoute"
  - "@meekojs/meeko/framework#NavigateOptions"
related:
  - "syntax:meekolink"
  - "@meekojs/meeko/framework#href"
  - "@meekojs/meeko/framework#useSearchParam"
  - "@meekojs/meeko/framework#useNavigation"
  - "@meekojs/meeko/framework#redirect"
  - docs/routing-navigation-reference.md#navegación-programática
---

`navigate(target, options)` cambia de página desde el código de un componente o un composable, por la misma navegación que un clic en `<MeekoLink>`: ejecuta el middleware de ruta, carga los datos de la página nueva, activa `useNavigation().pending`, actualiza el historial y conserva los layouts compartidos. Si algo falla, la página anterior sigue visible. Sustituye a `window.location.assign`, que recarga el documento entero.

Recibe el destino tipado de `<MeekoLink>` (`to`, `params`, `search` y `hash`), que `meeko check` comprueba con las rutas de la aplicación, o una URL como texto. Se autoimporta en el código de `app/` y, a diferencia de los composables, puede llamarse en un manejador de eventos, un temporizador o después de un `await`. Sólo funciona en el navegador: en el servidor se usa [`redirect()`](/docs/reference/redirect).

## Uso

```html
<!-- app/pages/users/new.meeko -->
<script lang="ts">
	const name = signal('')
	async function create() {
		const user = await api.users.post({ body: { name: name.value } })
		await navigate({ to: '/users/[id]', params: { id: user.id } })
	}
</script>

<template>
	<input model="name" />
	<button on:click="create">Crear</button>
</template>
```

## Parámetros

| Parámetro                | Tipo                     | Por defecto | Descripción                                                                                                         |
| ------------------------ | ------------------------ | ----------- | ------------------------------------------------------------------------------------------------------------------- |
| `target`                 | `NavigateTarget` o texto | obligatorio | Destino tipado o URL de destino, relativa a la página actual o absoluta.                                            |
| `target.to`              | `RouteId`                | obligatorio | ID de una ruta que existe, como `"/users/[id]"`. Una ruta inexistente es un error de tipos.                         |
| `target.params`          | `RouteParams` de `to`    | ninguno     | Los segmentos dinámicos, como en `href()`. Obligatorios en una ruta dinámica y prohibidos en las demás.             |
| `target.search`          | `Record<string, …>`      | ninguno     | Query string. Admite textos, números y booleanos; omite `null` y `undefined`.                                       |
| `target.hash`            | `string`                 | ninguno     | Fragmento, sin `#`: `"bio"` da `#bio`.                                                                              |
| `target.hreflang`        | `string`                 | ninguno     | Idioma para los resolvedores de enlaces (`app.resolveLink`), como el atributo de `<MeekoLink>`.                     |
| `target.resolve`         | `boolean`                | `true`      | `false` deja la URL de `href()` sin pasar por los resolvedores de enlaces.                                          |
| `options.replace`        | `boolean`                | `false`     | Sustituye la entrada actual del historial en lugar de añadir otra: el botón atrás no vuelve a la página de partida. |
| `options.viewTransition` | `boolean`                | ninguno     | Activa o desactiva la View Transition de esta navegación. Sin ella, decide `viewTransitions` de `meeko.config.ts`.  |

## Valor devuelto

Una `Promise<boolean>`:

- `true` cuando la página nueva se confirma (está en pantalla y la URL ya cambió).
- `false` cuando la navegación no termina en el cliente: la cancela otra navegación, un plugin con `beforeNavigate` o un middleware que bloquea, o la URL se carga como documento (otro origen o una URL sin página).
- Rechaza con el error si la navegación falla (un loader que lanza sin página de error, una ruta desconocida o unos `params` inválidos en el destino tipado, o un esquema que no es `http:` ni `https:`). La página anterior sigue visible.

Lanza al momento, sin devolver una promesa, si se llama en el servidor o fuera de una aplicación montada con `mountClientApp`.

## Ejemplos

### Volver a la página de origen después de iniciar sesión

```html
<!-- app/pages/login.meeko -->
<script lang="ts">
	const route = useRoute()
	const form = useForm({
		schema: loginInput,
		initial: { email: '', password: '' },
		submit: async (values) => {
			await api.auth.login.post({ body: values })
			const next = route.search.value.next
			await navigate(typeof next === 'string' && next.startsWith('/') ? next : '/', { replace: true })
		},
	})
</script>
```

`replace: true` quita el formulario del historial: atrás no vuelve a él. Compruebe que `next` es una ruta de la aplicación antes de seguirlo, como haría con cualquier dato de la URL.

### Cambiar de pestaña sin animación

```html
<script lang="ts">
	const props = defineProps<{ userId: string }>()
	const open = (tab: string) => navigate({ to: '/users/[id]', params: { id: props.userId }, search: { tab } }, { viewTransition: false })
</script>

<template>
	<button on:click="() => open('activity')">Actividad</button>
</template>
```

Para un valor de la query que es estado de la página (una pestaña, un filtro, la página de una lista), [`useSearchParam`](/docs/reference/usesearchparam) es más directo.

### Saber si la navegación terminó

```ts
import { navigate } from '@meekojs/meeko/framework'

async function openReport(id: string): Promise<void> {
	const committed = await navigate(`/reports/${encodeURIComponent(id)}`)
	if (!committed) console.info('La navegación se canceló o se cargó como documento')
}
```

## Errores comunes

### Una ruta que no existe, o sin sus `params`

```ts bad
void navigate({ to: '/nowhere' })
void navigate({ to: '/users/[id]' })
```

`meeko check` da `TS2769: No overload matches this call` con `Type '"/nowhere"' is not assignable to type '"/about" | "/users/[id]"'` en la primera y `Property 'params' is missing in type '{ to: "/users/[id]"; }'` en la segunda.

<!-- no-check -->

```ts good
void navigate({ to: '/users/[id]', params: { id: '7' } })
```

### Navegar durante el render del servidor

```html bad
<script lang="ts">
	const props = defineProps<{ user?: string }>()
	if (!props.user) navigate('/login')
</script>
```

El script del componente también se ejecuta en SSR, donde lanza `Error: navigate() sólo funciona en el navegador, en una aplicación que monta mountClientApp. En el servidor (SSR, loaders, código de nivel superior o middleware) usa redirect() para enviar a otra URL.` Una redirección que depende de la petición va en el servidor, antes de renderizar:

```ts good
// app/middleware/auth.server.ts
import { defineServerRouteMiddleware, redirect } from '@meekojs/meeko/framework'

export default defineServerRouteMiddleware(
	({ session }) => {
		if (!session.current) redirect('/login')
	},
	{ global: false },
)
```

### Pasar un destino tipado como texto

```ts bad
void navigate('/users/[id]')
```

El texto es una URL, no un ID de ruta: no se comprueba y navega a la dirección literal `/users/[id]`, el usuario cuyo `id` es `"[id]"`. Use el destino tipado:

<!-- no-check -->

```ts good
void navigate({ to: '/users/[id]', params: { id: user.id } })
```

## Notas

- **Navegador.** Pasa por el router transaccional de `mountClientApp`: middleware de ruta (`defineRouteMiddleware` y los de servidor en la petición de datos), loaders o código de nivel superior, `await` de datos de la página nueva, `beforeNavigate` de los plugins, `useNavigation().pending`, historial, scroll y View Transitions, como un enlace.
- **Documento.** Otro origen o una URL sin página de la aplicación se cargan con `location.assign` (o `location.replace` con `replace: true`), igual que un enlace normal, y la promesa resuelve `false`.
- **Seguridad.** Sólo sigue URL `http:` y `https:`. Otro esquema, como `javascript:` o `data:`, rechaza con `TypeError` sin navegar: un destino que viene de la URL o de un dato del servidor no puede ejecutar código en la página. Igual que en las redirecciones de middleware.
- **Servidor.** En SSR, en un loader, en el código de nivel superior o en un middleware de servidor lanza un error que remite a `redirect()`.
- **Resolvedores de enlaces.** El destino tipado pasa por los de `app.resolveLink`, como `<MeekoLink>`: con `@meekojs/i18n`, `{ to: "/guide" }` lleva a `/en/guide` desde una página en inglés. Una URL como texto se usa tal cual.
- **Varias aplicaciones.** Navega la última aplicación montada con `mountClientApp`, como `href(id)`. Una llamada durante la hidratación (en un `onMounted`) espera a que el router esté listo.
