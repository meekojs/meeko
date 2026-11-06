# Navegación: detalles técnicos

Contratos completos y casos especiales. Para los usos habituales, empieza por la [guía breve](routing-navigation.md).

## `<MeekoOutlet />` y `<MeekoLink>`

Desde `1.2`, Meeko incluye estas etiquetas sin import. `<MeekoLink>` no reemplaza al `<a>`: el router intercepta ambos por su `href` cuando apuntan a una ruta interna. La etiqueta aporta construcción y comprobación de rutas, además de `aria-current` automático.

- **`<MeekoOutlet />`** pinta, en `app/app.meeko` y en los layouts (`app/layouts/*.meeko` o `+layout.meeko`), el layout o la página que van dentro. Lee el `outlet` que Meeko pasa, así que el layout no necesita declarar `defineProps<{ outlet }>()`. Hasta `1.4`, si declaraba sus props, `outlet` debía estar entre ellas; desde `1.5`, un layout con `<MeekoOutlet />` declara sólo las suyas (`defineProps<{ title?: string }>()`) y Meeko añade `outlet` a su `ComponentProps`. Equivale a `<component is="props.outlet">`: el navegador conserva el layout entre rutas y sólo cambia lo que hay dentro. En otro componente, o con atributos o contenido, da `MEEK104`.
- **`<MeekoLink to="/users/[id]" bind:params="{ id: user.id }" bind:search="{ tab: 'perfil' }">`** renderiza un `<a>` cuyo `href` construye `href()`: `to` sólo admite rutas que existen, las rutas dinámicas exigen `bind:params` con sus claves y `bind:search` añade la query string. `meeko check` y el editor marcan el error en el atributo (`Argument of type '"/nowhere"' is not assignable…`). En la ruta activa (la misma ruta sin query ni fragmento) añade `aria-current="page"`, que la navegación actualiza; con `match="prefix"`, también marca su sección (véase más abajo). El resto de atributos y los hijos pasan al `<a>` tal cual: `class`, `target`, `rel`, `aria-*`, `data-*` y `on:click`. `href` y `bind:href` no se admiten, porque el enlace lo construye `to` (`MEEK105`).
- **`match`: la página o la sección.** Desde `1.5`, `match="exact"` (por defecto) marca el enlace sólo en su ruta, y `match="prefix"`, también en las rutas que están por debajo. En su propia ruta el enlace lleva `aria-current="page"`, y en una ruta por debajo, `aria-current="true"`, que significa «el elemento actual de un conjunto»: la sección en la que está la página. La comparación es por segmentos completos, sobre las rutas codificadas como `href()` y sin query ni fragmento: `/dashboard` cubre `/dashboard/stats` y `/dashboard/r%201`, pero no `/dashboards`; `/dash` no cubre `/dashboard`. `to="/"` sólo coincide exacta, también con `match="prefix"`, porque si no marcaría todas las páginas. En una ruta dinámica, la sección es la de sus `params`: `<MeekoLink to="/users/[id]" bind:params="{ id: '7' }" match="prefix">` cubre `/users/7/posts`, no `/users/8/posts`. `match` admite `bind:match` con una expresión de tipo `"exact" | "prefix"`; otro valor estático es `MEEK105`. El valor sale en el HTML del servidor, la hidratación no lo cambia y la navegación lo actualiza, también en un layout que el navegador conserva.
- **Resolvedores de enlaces: idioma y otros prefijos.** Desde `1.8`, el `href` pasa por los resolvedores que registran los plugins y módulos con [`app.resolveLink`](framework.md#plugins-de-aplicación). Con `@meekojs/i18n`, `<MeekoLink to="/guide">` apunta a `/en/guide` en una página `/en/…` y a `/guide` en el idioma por defecto, sin escribir el prefijo; `hreflang="es"` (o `bind:hreflang`, o la clave `hreflang` de `bind`) fuerza otro idioma y queda además en el `<a>`. `bind:resolve="false"` deja el `href` de `href()` tal cual, para un enlace que no debe cambiar; `resolve="false"` estático es `MEEK105`. El tipado de `to`, `params` y `search`, `aria-current` (con el `href` resuelto, así que `/guide` está activo en `/en/guide`) y la navegación del cliente no cambian. Sin resolvedores, el `href` es el de `href()`.

```html
<!-- /en/guide en una página /en/…, /guide en el idioma por defecto -->
<MeekoLink to="/guide">Guía</MeekoLink>
<!-- /guide en cualquier idioma -->
<MeekoLink
	to="/guide"
	hreflang="es"
>
	Versión en español
</MeekoLink>
<MeekoLink
	to="/admin"
	bind:resolve="false"
>
	Administración
</MeekoLink>
```

- **Tipos de sus props.** Desde `1.4`, `@meekojs/meeko/framework` exporta `MeekoLinkProps<K>` (`to`, `params` y `search` de la ruta `K`; desde `1.5`, también `match`, y desde `1.8`, `resolve`), `MeekoOutletProps` (sin props) y `MeekoThemeToggleProps` (las de [`<MeekoThemeToggle>`](framework.md#meekothemetoggle)), y `RouteId`, el ID de cualquier ruta de la aplicación (el tipo de `to`). Todos se autoimportan: los tipos de las props donde se usan los componentes, como los [tipos de cada componente](framework.md#tipos-de-cada-componente), y `RouteId` en todo el proyecto, como `href`. El editor muestra las props en el hover de las etiquetas y abre su tipo con «Ir a definición». Sirven para tipar un componente que recibe una ruta, sin import:

```html
<!-- app/components/NavLink.meeko -->
<script lang="ts">
	const props = defineProps<{ href: MeekoLinkProps['to']; label: string }>()
</script>
<template><a bind:href="href(props.href)">{props.label}</a></template>
```

`MeekoLinkProps["to"]` y `RouteId` son el mismo tipo: la unión de las rutas que declara `.meeko/types/routes.d.ts` (`meeko check`, `meeko dev`), o `string` sin esas declaraciones. `<NavLink href="/nowhere">` es un error de tipos en el padre. Un tipo del proyecto con uno de esos nombres (por ejemplo, en `app/types`) tiene prioridad.

```html
<!-- app/layouts/default.meeko -->
<template>
	<header>
		<MeekoLink
			to="/"
			class="brand"
		>
			Inicio
		</MeekoLink>
		<MeekoLink
			to="/users/[id]"
			bind:params="{ id: session.userId }"
		>
			Mi perfil
		</MeekoLink>
	</header>
	<main><MeekoOutlet /></main>
</template>

<style scoped>
	a[aria-current='page'] {
		font-weight: 700;
	}
</style>
```

Un menú de secciones marca la sección en todas sus páginas y, de forma distinta, la página exacta. El CSS distingue los dos valores de `aria-current`, los mismos que leen los lectores de pantalla:

```html
<!-- app/layouts/default.meeko -->
<template>
	<nav aria-label="Secciones">
		<MeekoLink
			to="/"
			match="prefix"
		>
			Inicio
		</MeekoLink>
		<MeekoLink
			to="/dashboard"
			match="prefix"
		>
			Panel
		</MeekoLink>
		<MeekoLink
			to="/users"
			match="prefix"
		>
			Usuarios
		</MeekoLink>
		<MeekoLink
			to="/settings"
			match="prefix"
		>
			Ajustes
		</MeekoLink>
	</nav>
	<main><MeekoOutlet /></main>
</template>

<style scoped>
	/* La sección de la página actual: /dashboard/stats marca «Panel». */
	nav a[aria-current='true'] {
		border-bottom: 2px solid currentColor;
	}
	/* La página exacta: /dashboard marca «Panel» con más peso. */
	nav a[aria-current='page'] {
		border-bottom: 2px solid currentColor;
		font-weight: 700;
	}
</style>
```

En `/dashboard/stats`, «Panel» lleva `aria-current="true"`; en `/dashboard`, `aria-current="page"`; en `/dashboards`, ninguno de los dos, y «Inicio» sólo se marca en `/`. Para un enlace o un componente propio, `useRoute().isActive()` aplica la misma regla (véase [Ruta actual](#ruta-actual)).

En el editor, `to="` sugiere las rutas del proyecto y lleva a su página con Ctrl+clic. `meeko init-framework` genera el shell y el layout con estas etiquetas.

Un proyecto anterior a `1.2` con un componente propio llamado `MeekoLink` o `MeekoOutlet` (en `app/components`, de un módulo o importado o declarado en el `<script>`) lo conserva: la etiqueta es ese componente, con sus props, y no la de Meeko. `meeko check`, `meeko build` y el editor lo avisan con `MEEK106`; renombre el componente para usar la etiqueta propia.

## Enlaces, anclas y scroll

`mountClientApp` convierte en navegación cliente los clics en enlaces del mismo origen hacia una ruta de la aplicación, también los del HTML insertado con `html`. Un enlace a un fragmento de la página actual (`#seccion`, o `/docs#seccion` estando en `/docs`) no se intercepta: el navegador desplaza la página y añade la entrada al historial sin volver a pedir ni renderizar la página, y volver atrás o adelante entre esos fragmentos tampoco la renderiza. `app.navigate("#seccion")` hace lo mismo.

Una navegación nueva empieza arriba de la página o, si su URL tiene un fragmento que nombra un elemento (`id` o `name`), en ese elemento, de forma inmediata aunque la página use `scroll-behavior: smooth`. Una navegación con `replace` sólo se desplaza al fragmento, si lo hay. Si la petición de datos de una navegación recibe HTML en lugar de un payload (un hosting estático que sirve el `index.html` prerenderizado, un proxy o una CDN), Meeko carga ese documento en vez de fallar.

Atrás y adelante devuelven al lector a la posición que tenía en cada entrada del historial, aunque tenga un fragmento; una entrada sin posición guardada va a su fragmento, si lo hay. La posición se aplica junto con el DOM de la página, antes del primer frame y dentro de la View Transition. Si aún no cabe porque falta contenido, como un valor de `defer`, Meeko espera hasta 10 s a que llegue, y lo deja si el lector u otro código mueven la página o si se navega a otra. Al recargar o volver desde otro documento, restaura el navegador.

Para ello Meeko pone `history.scrollRestoration` en `manual`, añade `meekoEntry` a `history.state` y guarda las posiciones en `sessionStorage`, y conserva lo demás que haya en `history.state`. Si escribes en él, mantén lo que ya hay: `history.replaceState({ ...history.state, propio: 1 }, '')`. Solo se recuerda el desplazamiento de la ventana, no el de un contenedor propio. No hay una opción para controlar este desplazamiento: si necesitas otra posición, desplázate después de que termine `app.navigate()`.

## View Transitions nativas

Activa las transiciones de navegación cliente en `meeko.config.ts`:

```ts
export default defineMeekoConfig({
	viewTransitions: true,
})
```

La opción es booleana y está desactivada por defecto. Meeko carga la página, sus módulos y sus datos antes de iniciar `document.startViewTransition()`, y coloca dentro del callback el cambio de DOM y de head. No anima SSR, la hidratación inicial ni los cambios de fragmento de la página actual. Funciona con enlaces internos y atrás/adelante. Sin la API, con la pestaña oculta o con `prefers-reduced-motion: reduce`, navega normalmente.

Tampoco anima una página demasiado grande: por encima de 4.000 elementos, en la página de origen o en la de destino, navega sin transición. En un documento así, con una pantalla de alta densidad o en un teléfono, cada frame de la transición bloquea la página durante segundos. Si la grande es la de destino, Meeko captura la página de origen y salta la animación al aplicar el cambio. Si llamas a `document.startViewTransition()` por tu cuenta, comprueba lo mismo con [`isTooLargeToAnimate`](reference/utils/istoolargetoanimate.md).

El navegador proporciona una transición básica; personaliza la animación desde `app/styles/main.css` con CSS nativo:

```css
.project-surface {
	view-transition-name: project-surface;
}

::view-transition-group(project-surface) {
	animation-duration: 280ms;
	animation-timing-function: cubic-bezier(0.16, 1, 0.3, 1);
}
```

Usa el mismo `view-transition-name` en el elemento de origen y destino. Cada nombre debe ser único entre los elementos visibles de una página; los duplicados pueden impedir la animación, aunque la navegación se completa. No se necesita una directiva ni un componente envolvente. Consulta la [API nativa](https://developer.mozilla.org/en-US/docs/Web/API/Document/startViewTransition).

Desde `1.8`, la transición de una navegación lleva el tipo `meeko-route`, así el CSS la distingue de la que inicia un componente. Da nombre a un elemento sólo durante las navegaciones:

```css
html:active-view-transition-type(meeko-route) .tabs-indicator {
	view-transition-name: tabs-indicator;
}
```

Un navegador sin tipos de transición (Chrome anterior a 125, Safari anterior a 18.2, Firefox anterior a 147) anima igual la navegación e ignora esas reglas.

Para desactivar o activar una navegación concreta, usa `app.navigate('/projects', { viewTransition: false })` en un host que dispone del `ClientApp` devuelto por `mountClientApp`. Los enlaces admiten un atributo HTML estándar, tanto en `<MeekoLink>` como en `<a>`:

```html
<MeekoLink
	to="/projects"
	data-meeko-view-transition="false"
>
	Abrir sin transición
</MeekoLink>
```

`data-meeko-view-transition="true"` activa ese enlace aunque la opción global esté desactivada; movimiento reducido sigue teniendo prioridad. La promesa de navegación espera al cambio de DOM, sin esperar al final de la animación. Una navegación posterior o desmontar la aplicación omite la animación anterior; una actualización abortada no puede sustituir la página nueva. Los fallos de animación no se convierten en fallos de navegación; los errores del render siguen propagándose como antes.

Esta opción controla cambios dentro del mismo documento. Las navegaciones a documentos nuevos pueden usar `@view-transition { navigation: auto; }` en las hojas de ambas páginas del mismo origen, sujeto al soporte del navegador y a las reglas de esa API. Los modales de UI mantienen sus animaciones locales y no necesitan capturas de toda la página. El ejemplo `/transitions` de la web pública `apps/ui` incluye una superficie compartida entre lista y detalle, además de enlaces sin transición.

## Estado de navegación

`useNavigation()` devuelve `{ pending }`, una señal de sólo lectura que vale `true` desde que empieza una navegación hasta que su página se confirma, falla o se cancela, incluida la primera carga de una página `"client"` y la carga de los `await useApi`/`await useRpcQuery` de la página nueva (véase [Navegación y `render: "client"`](framework.md#navegación-y-render-client)). En SSR y fuera de `mountClientApp` vale siempre `false`. Desde `1.7` se autoimporta, como `useRoute` (un export propio con ese nombre tiene prioridad).

```ts
import { useNavigation } from '@meekojs/meeko/framework'

const nav = useNavigation()
// <p if:when="nav.pending.value">Cargando…</p>
```

## Ruta actual

Desde `1.2`, `useRoute()` devuelve la ruta confirmada que renderiza el componente, con una señal de sólo lectura por valor (tipo `RouteState`):

| Campo                                | Valor                                                                                                                                                                                                                 |
| ------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `url`                                | URL relativa al origen, como cadena: `pathname`, `search` y, en el navegador, el fragmento (`/users/42?tab=a#bio`). No lleva el origen, así que coincide en un HTML prerenderizado en otro dominio.                   |
| `path`                               | `pathname`, codificado como en `location.pathname` (`/users/42`).                                                                                                                                                     |
| `id`                                 | ID de la ruta en el manifiesto (`"/users/[id]"`), o `null` en la página `404` de `app/error.meeko` para una URL sin ruta.                                                                                             |
| `params`                             | Parámetros de la ruta, con la misma forma que recibe la página (validados por su schema).                                                                                                                             |
| `search`                             | Parámetros de búsqueda, con la misma forma que recibe la página; en la página `404`, la query string con las claves repetidas en arrays.                                                                              |
| `isActive(to, { params?, prefix? })` | Desde `1.5`, una función, no una señal: si la ruta `to` está activa, con la regla de `<MeekoLink match>`. Devuelve `"page"` en la ruta exacta y, con `prefix: true`, `"true"` en una ruta por debajo; si no, `false`. |

Se autoimporta en las aplicaciones (un export propio llamado `useRoute` en `app/composables` u otra carpeta de autoimports tiene prioridad sobre el del framework) y, como `useNavigation`, puede llamarse también desde código anidado que se ejecuta con el componente (un composable, un `computed`, un `effect` u `onMounted`), pero no desde un manejador de eventos, un temporizador ni el callback de una promesa, donde no hay raíz activa: ahí lanza (`useNavigation` devuelve un estado fijo con `pending` en `false`); pídela en el script y úsala en el manejador. Funciona en páginas, layouts, `app/app.meeko`, `app/error.meeko` y sus componentes:

- **SSR.** Los valores son los de la petición, también en las rutas `"prerender"` y `"stream"` y en los layouts de una ruta `"client"`. El servidor no recibe el fragmento, así que en SSR `url` nunca lo lleva.
- **Hidratación.** El navegador hidrata con los mismos valores que el SSR, sin desajustes, también cuando el HTML se renderizó para otra URL: el `404.html` del adaptador `static`, que el hosting sirve en cualquier URL inexistente, o una página prerenderizada que un hosting estático sirve con cualquier query string. El payload lleva la URL del render (campo opcional `url`, desde `1.6`). Justo después de la hidratación, `url` y `path` pasan a ser los de la dirección del navegador, con su `#fragmento`; en la página `404` también `search`, y en una página, `params` y `search` siguen siendo los que validó el servidor.
- **Navegación.** Los valores cambian sólo cuando una navegación se confirma, a la vez que el outlet, nunca mientras `useNavigation().pending` vale `true`; la página anterior se libera antes de que se actualicen los efectos que leen la ruta. También cambian al volver atrás o adelante en el historial y en una navegación sólo de fragmento, donde `path` se mantiene y cambia `url`. El render previo que carga los `await` de datos de la página nueva ya ve la ruta de destino.
- **Fuera de una aplicación.** Fuera de un render del framework o de `mountClientApp` (por ejemplo, en una prueba unitaria con `renderToString`), `useRoute()` lanza un error que lo explica, en lugar de inventar una ruta; pase la ruta al componente como prop en esas pruebas.

**`isActive`.** Desde `1.5`, `route.isActive(to, { params, prefix })` dice si una ruta está activa con la misma regla que [`<MeekoLink match>`](#meekooutlet--y-meekolink), para los enlaces y componentes propios. `to` es un `RouteId` y `params`, los de esa ruta, con el tipo de `href()`: obligatorios en una ruta dinámica, no admitidos en las demás, y una ruta que no existe es un error de tipos. Devuelve `"page"` cuando la ruta confirmada es la de `to`, `"true"` con `prefix: true` cuando está por debajo de ella por segmentos completos, y `false` en otro caso; `"/"` sólo coincide exacta. Ignora la query string y el fragmento y compara las rutas codificadas. El resultado sirve tal cual para `bind:aria-current`, porque `bind:` elimina el atributo cuando el valor es `false`, y como condición, porque `"page"` y `"true"` son verdaderos. Lee `path`, así que la plantilla, un `computed` o un `effect` que lo usan se actualizan al navegar; en SSR y al hidratar devuelve lo mismo, sin desajustes.

Un layout con barra lateral marca así la sección activa, igual en el HTML del servidor y después de cada navegación:

```html
<!-- app/layouts/default.meeko -->
<script lang="ts">
	const route = useRoute()
	const links = [
		{ to: '/', label: 'Inicio' },
		{ to: '/users', label: 'Usuarios' },
		{ to: '/settings', label: 'Ajustes' },
	] as const
	const inSettings = computed(() => route.isActive('/settings', { prefix: true }) !== false)
</script>

<template>
	<aside>
		<nav>
			<a
				each:of="links"
				each:as="link"
				each:key="link.to"
				bind:href="href(link.to)"
				bind:aria-current="route.isActive(link.to, { prefix: true })"
			>
				{link.label}
			</a>
		</nav>
		<p if:when="inSettings.value">Los cambios se guardan al salir.</p>
	</aside>
	<main><MeekoOutlet /></main>
</template>
```

Los componentes recibidos como props mantienen la dirección del contrato: un componente que exige `label` no satisface un outlet que puede renderizarlo sin `label`. `meeko check` diagnostica la expresión que pasa el componente. Al guardar un módulo TypeScript importado por un `.meeko` abierto, la extensión de VS Code vuelve a comprobar sus diagnósticos y tokens semánticos.
