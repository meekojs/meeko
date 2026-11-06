# Renderizar páginas y layouts

Esta guía desarrolla [la visión general del framework](framework.md).

## Routing, layouts y SSR

Consulta el [índice de Routing](routing.md) para páginas, datos, layouts, navegación y middleware.

### `<MeekoOutlet />` y `<MeekoLink>`

La explicación está en [Navegación](routing-navigation.md#meekooutlet--y-meekolink).

### `<MeekoTeleport>`

Desde `1.5`, `<MeekoTeleport to="…">` pinta su contenido en otro lugar del documento sin sacarlo del componente que lo declara. Tampoco se importa. El caso típico es que una página ponga sus acciones en la barra de su layout:

```html
<!-- app/layouts/default.meeko -->
<template>
	<header class="bar">
		<MeekoLink to="/">Inicio</MeekoLink>
		<div id="toolbar"></div>
	</header>
	<main><MeekoOutlet /></main>
</template>

<!-- app/pages/notes/[id].meeko -->
<script lang="ts">
	const isMobile = signal(false)
	async function save(): Promise<void> {
		/* … */
	}
</script>
<template>
	<MeekoTeleport
		to="#toolbar"
		bind:disabled="isMobile.value"
	>
		<AppButton on:click="save">Guardar</AppButton>
	</MeekoTeleport>
	<article>…</article>
</template>
```

- **Destino.** `to="body"` añade el contenido al final de `<body>` y `to="#id"`, dentro del elemento con ese `id`, después de lo que ya tiene. Sólo se admiten esas dos formas: `body`, o `#` seguido de una letra y de letras ASCII, dígitos, `-` o `_`. Meeko busca el `id` con `getElementById` y nunca interpreta `to` como selector CSS ni como HTML. Un `to` estático que no cumple esa forma da `MEEK114`; `bind:to` acepta una expresión de tipo ``"body" | `#${string}` `` (`MeekoTeleportTarget`) que se valida al renderizar. `<MeekoTeleport>` admite `to`, `bind:to`, `disabled`, `bind:disabled`, `if:when` y `each:of`; cualquier otro atributo da `MEEK114`.
- **Ámbito del autor.** El contenido se compila en la plantilla del componente que lo declara, como el de un `if:when`: lee sus señales, sus eventos llaman a sus funciones, recibe su `provide`/`inject` y sus manejadores de errores, puede usar sus snippets y conserva el atributo de su `<style scoped>`. Se libera con el componente: al desmontarlo, al cambiar de página o cuando su `if:when` o su fila de `each:of` desaparecen, y sus nodos salen del destino con él.
- **Primer HTML.** En SSR, `"stream"` y `"prerender"` (también con el adaptador `static`), el HTML ya trae el contenido en su destino, sin saltos al hidratar: el de `to="body"` va tras la aplicación y antes de los scripts de Meeko, y el de `to="#id"` dentro de ese elemento, se renderice éste antes o después que el teleport. Varios teleports al mismo destino conservan el orden en que aparecen en la página. La hidratación encuentra el contenido por sus marcadores (`<!--meeko:portal:…-->`) y no cambia el DOM.
- **Destino inexistente.** Si la página no renderiza el elemento del `#id` (o es un elemento sin contenido, como `<input>`), el render falla con un error claro en desarrollo. En producción el contenido se pinta en su sitio, donde se hidrata, y el servidor avisa una vez con `console.warn`. En el navegador, un destino que no existe deja el contenido en su sitio con un aviso; el siguiente cambio de `to` o `disabled` vuelve a buscarlo.
- **`disabled`.** Con `disabled` (o mientras `bind:disabled` es verdadero) el contenido se pinta en su sitio. Cambiarlo mueve los mismos nodos entre el destino y su sitio, sin volver a renderizarlos, así que conservan su estado; el elemento que tenía el foco lo pierde, como en cualquier movimiento del DOM.
- **Navegador.** Lo que el navegador renderiza (una navegación, un `if:when` que aparece, una fila nueva o un hijo diferido) se pinta primero en su sitio y pasa a su destino al terminar ese montaje, antes del siguiente pintado, y se añade al final del destino. El destino debe vivir al menos tanto como el teleport: un elemento del layout o de `app/app.meeko` para una página, o del propio componente.

Para modales, menús y tooltips no hace falta teleport: `<dialog>` con `showModal()` y el atributo `popover` ya los muestran en la _top layer_ del navegador, por encima de todo y sin problemas de `z-index` u `overflow`, con el foco y `Escape` resueltos. Use `<MeekoTeleport>` cuando el contenido deba vivir en otro sitio del layout, como una barra de acciones, unas migas de pan o un aviso al final de `<body>`.

Las páginas, los layouts, `app/app.meeko` y `app/error.meeko` no pueden ser [componentes genéricos](api.md#componentes-genéricos-generic): Meeko les pasa sus props y no puede elegir sus parámetros de tipo, así que `generic` en su `<script>` da `MEEK100`. Lleve el contenido genérico a un componente de `app/components` y úselo desde la página.

Si una página falla y existe `+error.meeko`, Meeko la carga y renderiza con el mismo contexto de petición y estado SSR. El observador del servidor recibe el fallo original con su `requestId`; el HTML muestra un mensaje público y no incluye detalles privados. Si también falla la página de error, el servidor registra ese segundo fallo y entrega una respuesta segura.

### Layouts con nombre

La explicación está en [Layouts](routing-layouts.md#layouts-con-nombre).

#### Opciones por carpeta: `+group.ts`

Consulta [Opciones por carpeta](routing-layouts.md#opciones-por-carpeta-groupts).

#### Layouts de layers y módulos

Consulta [Layouts de layers y módulos](routing-layouts.md#layouts-de-layers-y-módulos).

### Props del layout desde la página

La explicación está en [Layouts](routing-layouts.md#props-del-layout-desde-la-página).

### Página de error de la aplicación (`app/error.meeko`)

La explicación está en [Datos y renderizado](routing-data.md#página-de-error-de-la-aplicación-apperrormeeko).

### Código de servidor de la página

La explicación está en [Datos y renderizado](routing-data.md#código-de-servidor-de-la-página).

#### Código de nivel superior y datos exportados

Consulta [Código de nivel superior y datos exportados](routing-data.md#código-de-nivel-superior-y-datos-exportados).

#### Opciones de ruta con `definePage`

Consulta [Opciones de ruta](routing-data.md#opciones-de-ruta-con-definepage).

#### Reglas comunes

Consulta [Reglas comunes](routing-data.md#reglas-comunes).

#### Dónde se usa cada API

Consulta [Dónde se usa cada API](routing-data.md#dónde-se-usa-cada-api).

### Modos de render

La explicación está en [Datos y renderizado](routing-data.md#modos-de-render).

### Streaming SSR (`render: "stream"`)

La explicación está en [Datos y renderizado](routing-data.md#streaming-ssr-render-stream).

### Caché de páginas SSR

La explicación está en [Datos y renderizado](routing-data.md#caché-de-páginas-ssr).

### Enlaces, anclas y scroll

La explicación está en [Navegación](routing-navigation.md#enlaces-anclas-y-scroll).

### View Transitions nativas

La explicación está en [Navegación](routing-navigation.md#view-transitions-nativas).

### Estado de navegación

La explicación está en [Navegación](routing-navigation.md#estado-de-navegación).

### Ruta actual

La explicación está en [Navegación](routing-navigation.md#ruta-actual).

### Head del documento: `document`, `useHead` y `useSeoMeta`

Desde `1.2`, Meeko gestiona el `<head>` de cada documento y los atributos de `<html>` y `<body>` a partir de tres fuentes, que se combinan con una sola regla de prioridad:

- **`document` en `meeko.config.ts`.** El documento común de la aplicación: `lang` y un `head` con etiquetas y atributos. Se renderiza en todos los documentos HTML: SSR, `"stream"`, `"prerender"`, la página `404` de `app/error.meeko`, el documento de error de una ruta que falla y el shell de una ruta `"client"`. Se fija en el build (y también llega al bundle del navegador, porque termina en el HTML), así que debe ser serializable: `titleTemplate` sólo puede ser una cadena (su tipo, `DocumentHead`, no admite una función, así que el editor y `meeko check` la marcan como error de tipos en `meeko.config.ts`) y `meeko build` rechaza una función. Su `title` es el título del sitio: lo muestran, tal cual y sin plantilla, las páginas sin título propio (véase **Título** más abajo). Los módulos de Meeko añaden su head antes del de la aplicación, que gana.
- **`useHead(input)`.** En páginas, layouts, `app/app.meeko`, `app/error.meeko`, componentes y composables, en el nivel superior del script o en un composable que éste llama. También en el código de nivel superior de `<script server>`, como alternativa a `export const head` (véase más abajo). `input` puede ser un objeto, un getter o una señal; con un getter o una señal, el navegador actualiza el documento cuando cambian los valores que lee.
- **`useSeoMeta(input)`.** Atajo tipado sobre `useHead`: `description`, `robots`, `themeColor`, `colorScheme`, `author`, `keywords`, `applicationName`, `referrer` y los campos `twitter*` producen `<meta name>`; los `og*` (`ogTitle`, `ogDescription`, `ogImage`, `ogImageAlt`, `ogImageWidth`, `ogImageHeight`, `ogUrl`, `ogType`, `ogSiteName`, `ogLocale`) producen `<meta property>`; `title` es el título y `canonical`, `<link rel="canonical">`. Un campo `undefined` o `null` no produce nada.

```ts
// meeko.config.ts
import { defineMeekoConfig } from '@meekojs/meeko/framework'

export default defineMeekoConfig({
	document: {
		lang: 'es',
		head: {
			// «Zapatillas · Mi tienda» en una página titulada; «Mi tienda» en una sin título.
			title: 'Mi tienda',
			titleTemplate: '%s · Mi tienda',
			link: [{ rel: 'icon', href: '/favicon.svg', type: 'image/svg+xml' }],
			// Se ejecuta mientras el navegador lee <head>, antes de pintar; la hidratación no lo repite.
			// (Para un tema claro/oscuro, use theme: Meeko trae el script, la cookie y useTheme().)
			script: [{ children: 'document.documentElement.dataset.theme = localStorage.getItem("theme") ?? "light"' }],
		},
	},
})
```

```html
<!-- app/pages/products/[id].meeko -->
<script
	server
	lang="ts"
>
	const { params } = usePage()
	export const product = await findProduct(params.id)
</script>

<script lang="ts">
	const quantity = signal(1)
	useSeoMeta({
		title: product.name,
		description: product.summary,
		ogImage: product.image,
		twitterCard: 'summary_large_image',
		canonical: `https://tienda.example/products/${product.id}`,
	})
	useHead(() => ({ title: `${product.name} (${quantity.value})` }))
</script>
```

`HeadInput` admite `title`, `titleTemplate` (`"%s · Sitio"` o `(title) => string`; en `document.head`, `meeko.addHead` y el `head` de la ruta, sólo la cadena), `meta`, `link`, `script` (externo con `src` o en línea con `children`; `async`, `defer`, `module` y `type`), `style` (con `children` y `media`), `htmlAttrs` y `bodyAttrs` (`lang`, `dir`, `class`, `data-*`; un valor `undefined` no aporta nada y los atributos `on*` se rechazan).

**Prioridad.** De menor a mayor: `document` de la configuración, `app/app.meeko`, cada layout (el más interno gana), la página con sus componentes y, por último, el `head` de la ruta (`export const head`, `route.head` o `useHead` en `<script server>`). Dentro de un mismo nivel gana la llamada posterior, de modo que un componente de la página que se monta después (por ejemplo, tras un `if:`) sustituye a lo que fijó la página. Los atributos de `<html>` y `<body>` se combinan por nombre con la misma prioridad.

**Título.** `titleTemplate` es el de la entrada de más prioridad que lo declara, y se aplica al título de más prioridad de `app/app.meeko`, los layouts, la página y el `head` de la ruta, también al de las páginas de error: `"Error"` o, por encima, el que declare con `useHead` la propia página de error (`app/error.meeko` o `+error.meeko`), a la que no ganan los títulos de sus layouts. El `title` de `document.head` (o el que añade un módulo con `meeko.addHead`) es distinto: es el título del sitio y nunca pasa por la plantilla. Una página sin título propio muestra ese título tal cual, y lo mismo una cuyo título ganador es una cadena vacía, en lugar de una plantilla alrededor de nada. Sin título del sitio, una página sin título no tiene `<title>` gestionado (queda el del host, si lo hay) y un título vacío se escribe vacío. La regla es la misma en el SSR, al hidratar y al navegar en el cliente. Con la configuración del ejemplo:

| Título de la página | `<title>`                |
| ------------------- | ------------------------ |
| `"Zapatillas"`      | `Zapatillas · Mi tienda` |
| ninguno             | `Mi tienda`              |
| `""`                | `Mi tienda`              |

**Deduplicación.** Cada etiqueta tiene una clave: `key` si la declara o, si no, su clave natural. En `meta`, `name` (sin distinguir mayúsculas), `property` o `httpEquiv`, junto con su `media` si lo tiene (dos `theme-color` para claro y oscuro conviven); en `link`, `rel` y `href`, salvo `rel: "canonical"` y `rel: "icon"`, que son únicos aunque cambie `href`; en `script`, `src` o el código; en `style`, el CSS. Con la misma clave sólo queda la etiqueta de más prioridad, en el lugar donde apareció la primera. Así, un `icon` de `document` sustituye al `<link rel="icon" href="data:,">` que Meeko escribe por defecto, y un `meta name="viewport"` sustituye al viewport por defecto.

**SSR y CSP.** El servidor escribe `<html lang="…">` y los atributos como atributos reales, escapados. Dentro de `<head>`, tras la meta CSRF y los estilos de los componentes, el título y las etiquetas gestionadas van entre los comentarios `<!--meeko:head-->` y `<!--/meeko:head-->`, antes del HTML de confianza del host (`DocumentOptions.head`, que conserva su propio `<title>` como título por defecto). Los valores de los atributos se escapan; el contenido de `script` y `style` en línea no se escapa, pero no puede cerrar su etiqueta: `</` se escribe `<\/` (y `<!--`, `<\!--` en un script), y en los scripts JSON (`application/ld+json`, `application/json`, `importmap`, `speculationrules`) cada `<` se escribe `\u003c`. El nonce CSP de la petición (`DocumentOptions.nonce`) se añade a los `<script>` y `<style>` gestionados. Una página prerenderizada conserva el head y recibe la meta CSRF justo después de `<meta charset>` y de las etiquetas por defecto que la aplicación no sustituyó.

**Navegador.** Al hidratar, Meeko adopta las etiquetas del SSR sin duplicarlas ni volver a ejecutar los scripts. Cuando cambia un getter o una señal de `useHead`, actualiza el título, los atributos y las etiquetas. Al navegar, las entradas de los componentes que se desmontan desaparecen y vuelve lo que habían sustituido (por ejemplo, el `canonical` del layout o la `description` de `app/app.meeko`); al volver atrás, la página restaura las suyas. Las etiquetas nuevas se insertan antes de `<!--/meeko:head-->` con el nonce CSP del documento; un script que cambia es un elemento nuevo, que el navegador ejecuta. El `head` de la ruta viaja en el payload de navegación, igual que `title` y `description` en `1.1`. Fuera de una aplicación de Meeko (por ejemplo, en una prueba unitaria con `renderToString`), `useHead` no hace nada. Un host propio que pasa `DocumentOptions.config` a `createFrameworkHandler` debe pasar el mismo valor a `mountClientApp({ document })`; la entrada que genera Meeko ya lo hace.

**`<script server>`.** `useHead` y `useSeoMeta` en el código de nivel superior hacen que el bloque tenga código de nivel superior, como `usePage`. Sus entradas forman el `head` de la ruta junto con `export const head` (o `route.head`), que gana sobre ellas. Como viajan en el payload, su `titleTemplate` debe ser una cadena.

#### Canónica y Open Graph por página

Desde `1.3`, `document.seo` añade a cada documento las etiquetas que dependen de la página y que, sin él, cada página tendría que repetir con `useSeoMeta`:

```ts
// meeko.config.ts
import { defineMeekoConfig } from '@meekojs/meeko/framework'

export default defineMeekoConfig({
	site: 'https://example.com',
	document: { seo: true, head: { titleTemplate: '%s · Mi sitio' } },
})
```

| Opción          | Etiqueta                           | Valor                                                                                     |
| --------------- | ---------------------------------- | ----------------------------------------------------------------------------------------- |
| `canonical`     | `<link rel="canonical">`           | El origen y la ruta de la página, sin la query string: `https://example.com/docs/api`.    |
| `ogUrl`         | `<meta property="og:url">`         | La misma URL.                                                                             |
| `ogTitle`       | `<meta property="og:title">`       | El título final, con `titleTemplate` aplicado.                                            |
| `ogDescription` | `<meta property="og:description">` | La `description` de la página (la del `head` de la ruta, `useSeoMeta` o `document.head`). |

`seo: true` las activa todas; un objeto desactiva las que valen `false` (`seo: { ogDescription: false }`). El origen es `site` o, sin él, `MEEKO_PUBLIC_ORIGIN` del entorno del build; con `canonical` u `ogUrl` activos y sin ninguno de los dos, `meeko build` falla con un mensaje que lo pide. Se fija en el build (`seo.origin` del manifiesto), así que una página renderizada con SSR usa el mismo origen que una prerenderizada. En `meeko dev` sin origen esas dos etiquetas no se escriben.

Son las etiquetas de menor prioridad: una página o un layout que declara la misma etiqueta (con `useSeoMeta`, `useHead` o el `head` de la ruta, con cualquier `key`) la sustituye, igual que a las de `document.head`. Las páginas de error (`app/error.meeko`, `+error.meeko` y el `404.html` del adaptador `static`) no reciben `canonical` ni `og:url`, porque se sirven en cualquier URL. Al navegar en el cliente, las etiquetas siguen a la página confirmada. Un host propio que pasa `DocumentOptions.config` con `seo` debe incluir `seo.origin`.

### Tema claro/oscuro sin parpadeo

Desde `1.4`, Meeko trae el tema claro/oscuro (y temas propios): la elección se guarda en una cookie, el servidor escribe el tema en `<html>` desde el primer byte y los componentes pintan en el HTML del servidor los iconos correctos, sin esperar a JavaScript. Cuando el servidor no puede saberlo (una página prerenderizada, el adaptador `static` o el modo `"system"` sin client hint), un script mínimo y bloqueante de `<head>` lo aplica antes del primer pintado.

```ts
// meeko.config.ts
import { defineMeekoConfig } from '@meekojs/meeko/framework'

export default defineMeekoConfig({
	theme: true, // light y dark, "system" por defecto, data-theme y la cookie meeko-theme
})
```

```css
/* app/styles/main.css: los colores de cada tema, con color-scheme también sin JavaScript. */
:root {
	color-scheme: light;
	--bg: #fff;
	--ink: #111;
}
:root[data-theme='dark'] {
	color-scheme: dark;
	--bg: #111;
	--ink: #eee;
}
/* Sin atributo (modo "system" que el servidor no pudo resolver y sin JavaScript), manda el sistema. */
@media (prefers-color-scheme: dark) {
	:root:not([data-theme]) {
		color-scheme: dark;
		--bg: #111;
		--ink: #eee;
	}
}
```

Sin `theme`, nada cambia: no hay script ni estilo en `<head>`, ni cookie, ni cabeceras, ni `POST /_meeko/theme`. `theme` acepta `true` o un objeto:

| Opción        | Por defecto                      | Qué hace                                                                                                                                                             |
| ------------- | -------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `themes`      | `["light", "dark"]`              | Los temas. Cada nombre usa letras, dígitos, `-` o `_` y no puede ser `"system"`.                                                                                     |
| `default`     | `"system"`                       | La elección de quien no eligió: `"system"` o un tema (el primero si `system: false`).                                                                                |
| `system`      | `true`                           | El modo `"system"`, que sigue a `prefers-color-scheme`. `true` usa `light` y `dark`; `{ light: "day", dark: "night" }` elige otros temas; `false` lo desactiva.      |
| `darkThemes`  | el oscuro de `system` (o `dark`) | Los temas que reciben `color-scheme: dark`.                                                                                                                          |
| `attribute`   | `"data-theme"`                   | Dónde va el tema en `<html>`: un atributo `data-*` o `"class"` (añade el nombre del tema a las clases y quita el de otro tema).                                      |
| `colorScheme` | `true`                           | Aplica `color-scheme` a `<html>` por CSSOM (`style.colorScheme`).                                                                                                    |
| `cookie`      | `"meeko-theme"`                  | La cookie de la elección.                                                                                                                                            |
| `storageKey`  | el valor de `cookie`             | La clave de `localStorage`, que avisa a las otras pestañas: por defecto, el nombre de la cookie (`"meeko-theme"` si no cambia `cookie`); `false` usa sólo la cookie. |
| `clientHints` | `true`                           | Pide y lee `Sec-CH-Prefers-Color-Scheme` para resolver `"system"` en el servidor.                                                                                    |

Las cookies son por host, no por puerto: en desarrollo, todas las aplicaciones Meeko de `localhost` (o `127.0.0.1`), en cualquier puerto, comparten la cookie `meeko-theme`, así que elegir tema en una lo cambia en las demás al recargar (`localStorage` sí es por puerto). Para separarlas, dé a cada aplicación su propio nombre con `cookie`, por ejemplo `theme: { cookie: "mi-app-theme" }`.

#### `useTheme()`

`useTheme()` se autoimporta en los `.meeko` (un export propio con ese nombre tiene prioridad) y se llama mientras se ejecuta el script de un componente. Devuelve:

- `theme`: la elección, `"system"` incluido. Es una señal editable: asignarla equivale a `set`, y sirve para `model="theme"`.
- `resolved`: el tema efectivo, de sólo lectura; en `"system"`, el de `prefers-color-scheme`.
- `themes`: la lista de temas, sin `"system"`.
- `set(theme)`: cambia la elección. Actualiza el atributo (o la clase) de `<html>`, `color-scheme`, la cookie y `localStorage`. Un nombre que no es un tema ni `"system"` lanza `TypeError`.

En `"system"`, `resolved` sigue a los cambios de `prefers-color-scheme` mientras la página está abierta, y un cambio en otra pestaña llega por el evento `storage` de `localStorage`. La navegación en el cliente conserva el tema, porque no recarga `<html>`. En el servidor, `theme` y `resolved` son los de la petición y no se pueden cambiar (`set` lanza un error). Sin `theme` en la configuración, `useTheme()` lanza un error que lo pide.

`meeko check` tipa los temas con la configuración: con `themes: ["light", "dark", "sepia"]`, `resolved` es `"light" | "dark" | "sepia"` y `set("purple")` es un error de tipos. Las declaraciones se generan en `.meeko/types/routes.d.ts` (`GeneratedTheme`); sin ellas, los temas son `string`. El editor no las necesita: declara `GeneratedTheme` a partir de `theme` leído sin ejecutar `meeko.config.ts`, también antes del primer `meeko check`, cuando su valor es un literal (`true` o un objeto con valores literales).

#### Iconos que no saltan

La forma más corta es [`<MeekoThemeToggle>`](#meekothemetoggle), que ya hace lo que sigue. A mano hay dos formas de pintar los iconos, y las dos salen bien en el HTML del servidor cuando éste conoce el tema (la cookie, o el client hint en `"system"`):

- **Desde el CSS (recomendada).** El componente pinta los dos iconos y el CSS muestra uno según el atributo de `<html>`. Nunca salta, ni siquiera cuando el servidor no conoce el tema (una página prerenderizada, el adaptador `static` o `"system"` sin client hint), porque el script de `<head>` pone el atributo antes de pintar y el CSS lo lee desde el primer frame.
- **Desde `resolved`.** `{resolved.value === "dark" ? "luna" : "sol"}` o un `if:` sobre `resolved`. Sale bien siempre que el servidor conoce el tema; cuando no lo conoce, el HTML del servidor y la hidratación pintan el tema claro de `system` y el icono cambia al terminar la hidratación.

```html
<!-- app/components/ThemeToggle.meeko -->
<script lang="ts">
	const { resolved, set } = useTheme()
	const toggle = (): void => set(resolved.value === 'dark' ? 'light' : 'dark')
</script>

<template>
	<button
		type="button"
		class="theme-toggle"
		aria-label="Tema oscuro"
		bind:aria-pressed="String(resolved.value === 'dark')"
		on:click="toggle"
	>
		<svg
			class="sun"
			viewBox="0 0 24 24"
			aria-hidden="true"
		>
			<circle
				cx="12"
				cy="12"
				r="5"
			/>
		</svg>
		<svg
			class="moon"
			viewBox="0 0 24 24"
			aria-hidden="true"
		>
			<path d="M20 14.5A8 8 0 0 1 9.5 4a8 8 0 1 0 10.5 10.5Z" />
		</svg>
	</button>
</template>

<style>
	.theme-toggle .moon {
		display: none;
	}
	:root[data-theme='dark'] .theme-toggle .sun {
		display: none;
	}
	:root[data-theme='dark'] .theme-toggle .moon {
		display: inline;
	}
</style>
```

`aria-pressed` depende de `resolved`, así que en el caso desconocido cambia al hidratar; no se ve, y un lector de pantalla lo anuncia ya con la página interactiva. Un selector de tres opciones (sistema, claro, oscuro) usa `theme` con `model`:

```html
<script lang="ts">
	const { theme } = useTheme()
</script>
<template>
	<select
		aria-label="Tema"
		model="theme"
	>
		<option value="system">Sistema</option>
		<option value="light">Claro</option>
		<option value="dark">Oscuro</option>
	</select>
</template>
```

<a id="data-theme-choice"></a>**`data-theme-choice`.** Desde `1.4`, `<html>` lleva además la elección, `"system"` incluido: `data-theme-choice="system"` mientras `data-theme` dice el tema efectivo (`dark`). La escribe siempre el script de `<head>`, antes del primer pintado, y el servidor cuando la conoce por la cookie; el runtime la actualiza con cada cambio. Sirve para el CSS propio, use o no `<MeekoThemeToggle>`: un icono de «sistema» que no salta, o el radio marcado de un selector.

```css
.theme-toggle .icon {
	display: none;
}
:root[data-theme-choice='light'] .theme-toggle .sun,
:root[data-theme-choice='dark'] .theme-toggle .moon,
:root[data-theme-choice='system'] .theme-toggle .monitor {
	display: inline;
}
```

Sin cookie, el HTML del servidor no la lleva (no sabe si `localStorage` guarda otra elección, y una página prerenderizada es la misma para todos); el script la escribe antes de pintar. Sin JavaScript, un selector `:root:not([data-theme-choice])` corresponde a `default`.

#### Selector de tema propio

Desde `1.8`, `useThemeToggle()` de `@meekojs/meeko/framework` es la API pública para construir un selector. Llámalo en el script de un componente con `theme` activo en `meeko.config.ts`; sin esa configuración o fuera de una aplicación, lanza `MEEK111`. No recibe parámetros y devuelve un `ThemeToggleState`, compartido por toda la aplicación:

| Miembro       | Descripción                                                                                                                                                                                                                                                       |
| ------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `theme`       | El mismo `ThemeState` de `useTheme()`: `theme`, `resolved`, `themes` y `set(choice)`.                                                                                                                                                                             |
| `choices`     | Lista de elecciones de la configuración, en orden, con `"system"` si está activo. Sólo lectura.                                                                                                                                                                   |
| `system`      | `ThemeToggleSystem`: `{ light, dark }`, los nombres de temas de `"system"`; `undefined` sin modo sistema.                                                                                                                                                         |
| `known`       | `ReadonlySignal<boolean>`: el servidor conoce la elección si recibió la cookie; en el navegador pasa a `true` al terminar la hidratación. Mientras vale `false`, usa un nombre accesible neutro, como «Cambiar tema», sin anunciar una elección que no se conoce. |
| `interactive` | `ReadonlySignal<boolean>`: `false` durante SSR e hidratación; `true` cuando los handlers del navegador ya responden. Usa el formulario nativo mientras vale `false`.                                                                                              |

El formulario envía `POST /_meeko/theme` con `theme` (la elección válida) y `return` (la URL actual). El endpoint valida el tema y el `Origin`, guarda la cookie y devuelve `303` a una ruta del mismo origen. En el adaptador `static` no hay endpoint: el cambio necesita JavaScript. Este ejemplo usa botones de envío nativos, con nombre accesible propio, sin implementar un grupo de radios:

```html
<script lang="ts">
	import { useRoute, useThemeToggle } from '@meekojs/meeko/framework'

	const toggle = useThemeToggle()
	const route = useRoute()
</script>

<template>
	<form
		method="post"
		action="/_meeko/theme"
	>
		<input
			type="hidden"
			name="return"
			bind:value="route.url.value"
		/>
		<button
			each:of="toggle.choices"
			each:as="choice"
			each:key="choice"
			type="submit"
			name="theme"
			bind:value="choice"
			on:click="(event) => { if (toggle.interactive.value) { event.preventDefault(); toggle.theme.set(choice); } }"
		>
			Usar {choice}
		</button>
	</form>
</template>
```

Para un botón cíclico con iconos, pinta todos los iconos y marca cada uno con `data-meeko-theme-icon="light"`, `"dark"`, `"system"` o el nombre de un tema propio. La regla que `theme` añade a `<head>` muestra el de la elección de `<html>` desde el primer frame: no elijas un único icono con un condicional sobre `resolved`. Si el selector omite `"system"`, añade el token `system-light` o `system-dark` al icono del tema correspondiente (por ejemplo, `data-meeko-theme-icon="light system-light"`); `toggle.system` indica esos temas. Estos iconos decorativos llevan `aria-hidden="true"`; el botón necesita texto o `aria-label`.

La configuración `theme`, la cookie, el script de `<head>`, esta regla de iconos y `POST /_meeko/theme` permanecen en core. Para un control completo con teclado y accesibilidad usa `UIThemeToggle` de `@meekojs/ui` 0.2. Véase la [referencia de useThemeToggle](reference/composables/usethemetoggle.md).

#### `<MeekoThemeToggle>`

> **Obsoleto desde 1.8; retirada en 2.0.** Usa `<UIThemeToggle>` del módulo `@meekojs/ui` 0.2 con las mismas props, snippets y marcado. En 1.x sigue funcionando y emite `MEEK121`. Véase [Migración a 1.8](migration-1.8.md).

Desde `1.4`, con `theme` en `meeko.config.ts`, Meeko trae su propio selector de tema: una etiqueta integrada, como `<MeekoLink>`, sin import.

```html
<MeekoThemeToggle>
	<snippet name="light"><IconSun /></snippet>
	<snippet name="dark"><IconMoon /></snippet>
	<snippet name="system"><IconMonitor /></snippet>
</MeekoThemeToggle>
<MeekoThemeToggle mode="select" />
<MeekoThemeToggle
	bind:themes="['light', 'dark']"
	bind:labels="{ light: 'Claro', dark: 'Oscuro', system: 'Sistema' }"
	class="toggle"
/>
```

| Prop          | Por defecto                  | Qué hace                                                                                                                                                                |
| ------------- | ---------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `mode`        | `"cycle"`                    | `"cycle"`: un botón que pasa a la elección siguiente de la lista. `"select"`: un grupo de radios.                                                                       |
| `themes`      | los temas y `"system"`       | Las elecciones y su orden (`bind:themes="['light', 'dark']"`).                                                                                                          |
| `labels`      | «Claro», «Oscuro», «Sistema» | El nombre de cada elección; un tema propio, sin etiqueta, se llama como el tema.                                                                                        |
| `messages`    | en español                   | Los textos accesibles: `cycle(current, next)` (el `aria-label` del botón), `unknown` («Cambiar tema») y `group` («Tema»), para traducirlos. Tipo `ThemeToggleMessages`. |
| `class`, `id` | —                            | Del `<form>` raíz. Otros atributos no pasan: envuelva la etiqueta si los necesita.                                                                                      |

Cada snippet (`light`, `dark`, `system` o el nombre de un tema propio) es el icono de esa elección; sin snippet se pinta su etiqueta. `meeko check` y el editor tipan los snippets, `themes` y `labels` con los temas de `meeko.config.ts` (`system` sólo si está activo) y `mode` como `"cycle" | "select"`; el editor completa la etiqueta, sus props y sus snippets, y su hover muestra la ficha de la etiqueta. El tipo de sus props es `MeekoThemeToggleProps`, autoimportado como `MeekoLinkProps`. No tiene estilos visuales propios: el botón y los radios son elementos nativos que estiliza la aplicación (`.toggle button`, `[role="radio"][aria-checked="true"]`, `[data-meeko-theme-option="dark"]`). Para marcar el radio elegido también antes de hidratar, cuando la elección no se conoce y no hay `aria-checked`, use `data-theme-choice`, como los iconos: `[data-theme-choice="dark"] [data-meeko-theme-option="dark"]`.

**Iconos que nunca saltan.** El componente pinta todos los iconos, cada uno en `<span data-meeko-theme-icon="light|dark|system|…">`, y no elige ninguno: con `theme` activo, Meeko añade a `<head>` una regla CSS mínima, sólo `display: none`, que oculta todos salvo el de `data-theme-choice`. Como el script de `<head>` escribe ese atributo antes del primer pintado, el icono sale bien desde el primer frame en todos los casos (con cookie, en `"system"` sin cookie ni client hint, en una página prerenderizada o en `static`), sin JavaScript en el componente, y hidratar no cambia ningún nodo del componente. Una lista sin `system` (`bind:themes="['light', 'dark']"`) muestra en modo sistema el icono del tema efectivo, según `prefers-color-scheme`, como el script. En `mode="select"` cada radio lleva su icono y todos se ven.

**Accesibilidad.** En `mode="cycle"` es un `<button>` cuyo `aria-label` dice la elección y la siguiente, «Tema: oscuro. Cambiar a sistema», y se actualiza con cada cambio. Cuando el HTML se genera sin conocer la elección (sin la cookie, una página prerenderizada), el `aria-label` es neutro, «Cambiar tema», hasta que termina la hidratación: así no anuncia algo falso ni provoca un desajuste de hidratación, porque la hidratación pinta lo mismo que el servidor. En `mode="select"` es un `role="radiogroup"` con un `aria-label` («Tema») y un botón `role="radio"` por elección con `aria-checked` y el nombre de la elección. Cuando el HTML no conoce la elección, ningún radio lleva `aria-checked`, ni `"true"` ni `"false"`: un grupo con todos en `"false"` diría que no hay ninguno marcado, y marcar el de `default` diría algo falso a quien eligió otro tema, porque la página prerenderizada es la misma para todos. Al terminar la hidratación cada radio recibe su `aria-checked` una sola vez, y el estado visual lo da antes el CSS con `data-theme-choice`; con JavaScript, las flechas, `Inicio` y `Fin` mueven el foco y la elección, con un `tabindex` itinerante, como un grupo de radios nativo. Sin JavaScript cada radio es un botón que se alcanza con el tabulador.

**Sin JavaScript (mejora progresiva).** El componente es un `<form method="post" action="/_meeko/theme">`: el botón de `"cycle"` envía la elección siguiente y cada radio, la suya, junto con la URL de la página (`return`). Con JavaScript, el envío se intercepta y el cambio es inmediato, con `useTheme().set()`, sin navegar. Sin él, el servidor atiende el formulario:

- `POST /_meeko/theme` existe sólo con `theme` activo (en los demás métodos responde `405`).
- Acepta sólo `application/x-www-form-urlencoded` de hasta 2 KB; `theme` debe ser un tema de `themes` o `"system"` (con el modo sistema activo); si no, `400 INVALID_THEME`, sin escribir nada.
- Escribe la cookie como el runtime del navegador (`Path=/`, un año, `SameSite=Lax`, `Secure` en HTTPS) y responde `303` a `return`, que debe ser una ruta de este origen (`/docs?tab=a`). Una URL absoluta, `//otro.sitio`, una barra invertida o caracteres de control vuelven a `/`: nunca hay una redirección abierta. El siguiente documento SSR ya trae el tema nuevo.
- **CSRF.** No usa la sesión ni el token CSRF (`x-meeko-csrf`, que sólo existe con JavaScript): sólo cambia la cookie del tema. Como una mutación de API, exige un `Origin` igual al de la petición, que tras `createServerApp` es el `publicOrigin` configurado; un `Origin` ausente, `null` o de otro sitio responde `403 INVALID_ORIGIN` antes de leer el cuerpo. Los navegadores envían `Origin` en todo `POST`; una página con `Referrer-Policy: no-referrer` lo envía como `null`, así que ahí el formulario sin JavaScript no funciona (con JavaScript sí). Detrás de un proxy, configure el origen público, como para las mutaciones con sesión.
- **Prerender con Node.** El endpoint existe también en el servidor de una aplicación cuyas páginas son prerenderizadas, y escribe la cookie; pero el HTML prerenderizado es el mismo para todos y, sin JavaScript, no aplica la cookie (lo hace el script de `<head>`), así que la página sigue mostrando el tema por defecto. Sin JavaScript, el cambio sólo se ve en las páginas SSR.
- **Adaptador `static`.** No hay servidor: el formulario se renderiza igual (el HTML es el que generó el prerender, común a todos los adaptadores) y con JavaScript funciona, pero sin él el `POST` llega al hosting, que lo rechaza. Es una limitación documentada; en un sitio estático, el selector necesita JavaScript.

Usar `<MeekoThemeToggle>` sin `theme` es el error `MEEK111`. `meeko dev` y `meeko build` lo saben por la configuración, que ejecutan; `meeko check` y el editor leen `theme` de `meeko.config.*` sin ejecutarlo. Cuando así no se sabe (`theme: variable`, una configuración que no es un literal, o una carpeta sin `meeko.config.*`, como un layer con su propio `package.json`), no avisan, y el componente da el mismo error al renderizarse. Un componente del proyecto llamado `MeekoThemeToggle` tiene prioridad sobre la etiqueta de Meeko, con el aviso `MEEK106`, como con `MeekoLink`.

#### Cómo se evita el parpadeo en cada caso

| Caso                                                   | Quién pone el tema en `<html>`                                                                                                                       | `useTheme()` en el HTML del servidor                                                   |
| ------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------- |
| SSR con la cookie (`light`, `dark`, un tema propio)    | El servidor, desde el primer byte.                                                                                                                   | El tema de la cookie. Hidratar no cambia nada.                                         |
| SSR en `"system"` con `Sec-CH-Prefers-Color-Scheme`    | El servidor, con el client hint.                                                                                                                     | El tema del sistema. Hidratar no cambia nada.                                          |
| SSR en `"system"` sin el client hint (Firefox, Safari) | El script de `<head>`, antes del primer pintado; el HTML no lleva atributo, así que el CSS de `prefers-color-scheme` también acierta sin JavaScript. | `resolved` vale el tema claro de `system`; cambia al hidratar si el sistema es oscuro. |
| Página prerenderizada o adaptador `static`             | El script de `<head>`, con la cookie o `localStorage`.                                                                                               | El valor por defecto del build; cambia al hidratar si el usuario eligió otro.          |

El script lee la cookie, después `localStorage` (así una elección guardada sólo allí, como la de un sitio que antes usaba `localStorage`, sigue valiendo y vuelve a la cookie) y por último `default`; en `"system"` consulta `prefers-color-scheme`. Escribe el tema y [`data-theme-choice`](#data-theme-choice). Una cookie que escribió el servidor (el formulario de `<MeekoThemeToggle>` sin JavaScript) pasa a `localStorage` y a las otras pestañas en la siguiente carga con JavaScript. Se ejecuta siempre y es idempotente: donde el servidor ya escribió el tema, escribe el mismo. Va entre las etiquetas gestionadas de `<head>`, justo después de las `meta` (así también le aplica una CSP en `<meta http-equiv>`) y antes de todas las hojas de estilo enlazadas, las de `document.head` y `useHead` y las del build, así que no espera a ninguna.

**Client Hints.** Una respuesta SSR lleva `Accept-CH: Sec-CH-Prefers-Color-Scheme` y, cuando la elección es `"system"`, `Critical-CH: Sec-CH-Prefers-Color-Scheme`. Chromium recuerda `Accept-CH` para el origen y, la primera vez, ante `Critical-CH`, repite la petición con el hint antes de mostrar nada: una sola vez por origen, con un viaje de ida y vuelta más en esa primera visita. Firefox y Safari no envían el hint y usan el script. Con `clientHints: false`, Meeko no pide ni lee el hint.

**Hidratación.** El navegador hidrata con los valores que renderizó el servidor (viajan en el estado de la página, `sharedState["meeko:theme"]`) y recibe los suyos al terminar la hidratación, antes de `onMounted`, como `useStorage`. Por eso nunca hay un desajuste de hidratación, y sólo cambia lo que dependía de un tema que el servidor no conocía.

**Seguridad.** El servidor sólo acepta en la cookie un tema de `themes` (o `"system"`); cualquier otro valor se ignora y nunca se escribe en el HTML. El navegador escribe la cookie con `Path=/`, `SameSite=Lax`, un año de duración y `Secure` en HTTPS; no es `HttpOnly`, porque la escribe el cliente, y no contiene nada privado.

#### CSP

- **SSR.** El script y el `<style>` de los iconos de `<MeekoThemeToggle>` llevan el nonce de `DocumentOptions.nonce` o, desde `1.7`, el que genera Meeko con `server.contentSecurityPolicy`, como cualquier script o estilo de `useHead`. Una página con [`cache`](#caché-de-páginas-ssr) no lleva nonce: sus hashes entran en la CSP de esa respuesta ([CSP y cabeceras en los adaptadores con servidor](framework-deployment.md#csp-y-cabeceras-en-los-adaptadores-con-servidor)).
- **Prerender y `static`.** El script y el estilo están en el HTML de cada página, así que sus hashes entran en `scriptHashes` y `styleHashes` del índice de prerender y en la CSP que escribe el adaptador `static` ([CSP con hashes](framework-deployment.md#csp-con-hashes)). Sus textos sólo dependen de `theme`: son los mismos en todas las páginas y cambian de hash sólo si cambia la configuración.
- **Por qué un `<style>` con hash.** La regla de los iconos tiene que estar antes del primer pintado y funcionar sin JavaScript (el formulario de `<MeekoThemeToggle>`), así que no puede aplicarla el script por CSSOM. Un `<style>` en línea con nonce (SSR) o con hash (prerender y `static`) lo permite una CSP sin `'unsafe-inline'`, sin un archivo más que pedir. El hash sólo se añade a una directiva sin `'unsafe-inline'`: con un hash, el navegador ignoraría `'unsafe-inline'` y bloquearía los atributos `style="…"` que la política permitía.
- **`color-scheme`.** No es un atributo `style` del HTML, que una CSP sin `'unsafe-inline'` en `style-src` bloquearía: el script y el runtime lo aplican por CSSOM (`style.colorScheme`), que la CSP permite. Para que la página tenga el esquema correcto también sin JavaScript, declárelo en su CSS por tema, como en el ejemplo de arriba.

#### Caché

Un documento SSR depende de la cookie y del client hint, así que lleva `Vary: Cookie, Sec-CH-Prefers-Color-Scheme` (sin `clientHints`, `Vary: Cookie`). Las respuestas SSR son `cache-control: no-store` salvo las de una página con [`cache`](#caché-de-páginas-ssr), cuyo `ETag` ya incluye el tema; si un proxy o una CDN cachea sus páginas, debe incluir la cookie del tema en la clave o no cachearlas, o servirá a un usuario el tema de otro. Muchas CDN no varían por `Cookie` y no cachean una respuesta con `Vary: Cookie`. Las páginas prerenderizadas y el adaptador `static` no varían por el tema: el mismo archivo sirve a todos y el script aplica el tema de cada visitante, así que se cachean igual que antes. Una página prerenderizada servida por `meeko start` sí varía por la sesión, como sin tema: sin sesión responde con `Vary: cookie` y `cache-control: public, max-age=0, must-revalidate`, y con sesión, `private, no-store`, porque inserta la meta CSRF de la sesión (véase [Reglas comunes](#reglas-comunes)).

Un host propio que pasa `DocumentOptions.config` a `createFrameworkHandler` pone el tema en `config.theme` (lo mismo que `mountClientApp({ document })`); el build lo copia allí desde `theme` de `meeko.config.ts`, donde `document.theme` no se admite.

## Middleware de rutas y servidor

El middleware de rutas tiene su [guía](routing-middleware.md). El middleware HTTP general permanece aquí.

### Middleware con nombre

La explicación está en [Middleware de rutas](routing-middleware.md#middleware-con-nombre).

### Middleware de ruta de servidor

La explicación está en [Middleware de rutas](routing-middleware.md#middleware-de-ruta-de-servidor).

### Middleware de servidor

Para interceptar HTTP en el servidor antes del handler de página o API/RPC, coloque middleware en `server/middleware/*.ts` y use `defineServerMiddleware` desde `@meekojs/meeko/server`. Recibe `Request` y `next(request)`; debe devolver un `Response`. Puede continuar, modificar una respuesta o cortocircuitar. Meeko ejecuta los archivos por nombre, de fuera hacia dentro; `next()` sólo se puede llamar una vez. El middleware se ejecuta antes de crear el contexto de sesión de la petición, también para las páginas prerenderizadas; los archivos públicos del build se sirven antes del middleware. Los controles integrados de autenticación, autorización, contratos y CSRF de API/RPC siguen ejecutándose dentro del handler.

```ts
// server/middleware/10-request-header.ts
import { defineServerMiddleware } from '@meekojs/meeko/server'

export default defineServerMiddleware(async (request, next) => {
	const response = await next()
	const headers = new Headers(response.headers)
	headers.set('x-content-type-options', 'nosniff')
	return new Response(response.body, {
		status: response.status,
		statusText: response.statusText,
		headers,
	})
})
```

El middleware de servidor no tiene `RequestContext`: para la IP del cliente use `clientAddress(request)` (desde `1.7`), que aplica `MEEKO_TRUST_PROXY` como `context.clientAddress` y `rateLimit`; nunca lea `X-Forwarded-For` a mano (véase [IP del cliente tras un proxy](framework-auth.md#ip-del-cliente-tras-un-proxy)).

Este pipeline envuelve páginas SSR y `/api` y `/_meeko/rpc`; los assets estáticos, el servidor de desarrollo Vite y los upgrades WebSocket tienen sus propios handlers. Los archivos `*.test.ts`, `*.spec.ts`, `*.d.ts` y `*.client.ts` se excluyen. El descubrimiento automático de middleware se limita por ahora al proyecto raíz: los layers aportan rutas, autoimports y plugins, pero sus carpetas `app/middleware` y `server/middleware` no participan. Un módulo añade middleware de servidor con `meeko.addServerMiddleware`, que se ejecuta antes que el del proyecto (véase [Módulos](framework-configuration.md#módulos)). Editar un archivo de middleware existente invalida módulos y recarga el navegador en desarrollo; al añadir o quitar uno, `meeko dev` recrea la aplicación sin reiniciar (véase [Configuración](framework-configuration.md#configuración)). `npm run check` comprueba los tipos en sus ámbitos respectivos.

Los callbacks `onNavigationError` pueden devolver una promesa: si el observador falla, Meeko registra tanto el fallo del observador como el error de navegación original sin generar un rechazo sin manejar. Los observadores `onError` del servidor tampoco modifican la respuesta cuando lanzan o rechazan; el registro de respaldo incluye el `requestId` disponible y categorías de error, sin mensajes privados.

Los eventos de componentes pueden observarse por raíz con `provideErrorHandler` en el `<script>` de `app/app.meeko` o de un layout; se autoimporta y el callback recibe `unknown` y su `ErrorSource`. Los hijos heredan el observador más cercano, también después de un reemplazo HMR. `mountClientApp({ onError })` define el observador de toda la aplicación: recibe la navegación, los canales Socket, los eventos, efectos y limpiezas que no tienen un `provideErrorHandler` más cercano y, desde `1.3`, las excepciones no capturadas y las promesas rechazadas sin manejar de la página ([Fallos globales del navegador](framework-server.md#fallos-globales-del-navegador)). Sin `onError`, navegación, Socket y esos fallos globales consultan el primer proveedor activo de esa aplicación cuando no existe un `onNavigationError` u `onError` explícito del canal. Ese proveedor se desregistra al liberar su raíz; un fallo del observador se registra con el error original. Las llamadas directas a `app.navigate()` y `socket.emit()` mantienen sus rechazos para el código que las espera. En SSR no hay eventos de navegador ni conexiones Socket.

Si un middleware servidor llama a `next()`, Meeko espera también ese trabajo aunque el middleware olvide esperar la promesa. Un fallo del tramo siguiente se propaga al handler HTTP; si fallan ambos, se conserva cada error en un `AggregateError`. El middleware debe devolver una respuesta del pipeline o una respuesta propia.
