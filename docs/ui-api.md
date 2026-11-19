# API de Meeko UI

Referencia completa de `@meekojs/ui`. La [guía de Meeko UI](ui.md) la resume y la [web de Meeko UI](https://ui.meekojs.com) tiene una demo de cada componente.

Componentes visuales y estilos para Meeko. Es un paquete del mismo ecosistema, con versión propia, que se activa como módulo del framework.

## Instalación

En una aplicación externa de Meeko con Node.js 24 o superior, instala ambos paquetes publicados:

```sh
pnpm add @meekojs/meeko @meekojs/ui
```

Activa el módulo con la configuración siguiente. Después, en `app/pages/index.meeko`, puedes pintar `<UIButton>Guardar</UIButton>`; sin `to` ni `href` es un botón nativo de tipo `button`. Consulta el [ejemplo de aplicación](#uso) para un campo y una acción completos.

UI requiere Meeko `>=1.8 <2`. Para contribuir **dentro de este monorepo**, usa las dependencias `workspace:*` y ejecuta `pnpm install` desde su raíz; esa sintaxis no corresponde a una aplicación externa.

## Configuración

```ts
// meeko.config.ts
import { defineMeekoConfig } from '@meekojs/meeko/framework'

export default defineMeekoConfig({
	modules: ['@meekojs/ui'],
	theme: true,
})
```

El módulo registra los componentes con el prefijo `UI` y su hoja CSS mediante `meeko.addStylesheet`. Esa hoja ya viene compilada con Tailwind 4 (`dist/styles/main.css`), así que la aplicación no necesita Tailwind. Vite la procesa con el PostCSS del proyecto, resuelve sus imports y genera los assets del build. En desarrollo, los cambios de CSS usan HMR. No hace falta importar el CSS manualmente ni enlazar una URL fija. `theme: true` activa los temas del framework; el módulo UI también puede utilizarse sin esa opción.

### Opciones tipadas y marca existente

Registra el módulo por su nombre y escribe sus opciones en la clave `ui`, tipada sin importar nada: Meeko carga sus tipos en `.meeko/types/config.d.ts`. No necesitas copiar la paleta de UI: sus tokens pueden apuntar a las variables que ya tiene tu web.

```ts
import { defineMeekoConfig } from '@meekojs/meeko/framework'

export default defineMeekoConfig({
	modules: ['@meekojs/ui'],
	ui: {
		tokens: {
			primary: 'var(--pill)',
			primaryHover: 'var(--pill-hover)',
			onPrimary: 'var(--on-pill)',
			accent: 'var(--accent)',
			focus: 'var(--accent)',
			surface: 'var(--surface)',
			surfaceHover: 'var(--surface-2)',
			text: 'var(--ink)',
			muted: 'var(--muted)',
			border: 'var(--line)',
			font: 'var(--font-ui)',
		},
		defaults: {
			button: { shape: 'pill' },
			link: { shape: 'pill', variant: 'outline' },
			card: { variant: 'soft' },
		},
	},
})
```

`UIOptions`, `UITokens` y `UIDefaults` se exportan como tipos de `@meekojs/ui`. Los defaults son por aplicación y petición SSR; no hay estado mutable global. Las props explícitas ganan sobre `ui.defaults`, y éstos sobre los valores de base. Cada componente admite `class` y `ui`, que se suman a las de sus instancias, y unos pocos, variantes: véase [Clases y variantes por defecto](#clases-y-variantes-por-defecto). Sin opciones se conserva la configuración original y no se instala el plugin de defaults.

`tokens` admite `primary`, `primaryHover`, `onPrimary`, `accentSoft`, `accentText`, `surface`, `surfaceHover`, `text`, `textSoft`, `muted`, `border`, `borderStrong`, `danger`, `focus`, `radius`, `font`, `controlHeight`, `controlPadding`, `controlWeight` y `controlFontSize`. Cada clave asigna tokens `--ui-*`: `primary` es `--ui-color-primary`, `text` es `--ui-color-text`, y `surface`, a la vez, las superficies y los controles. Las referencias `var(...)` siguen los temas de la aplicación sin duplicar sus colores.

`base: false` omite la base global de UI (véase [Personalización](#personalización)).

Las opciones se validan al cargar el módulo. Los tokens se añaden a la hoja CSS de UI antes de pasar por PostCSS; no se generan estilos inline ni archivos en `node_modules`. Las hojas de la aplicación se cargan después y pueden sobrescribirlos.

### Textos e idiomas

`UIModal`, `UITable`, `UISelect` y `UIThemeToggle` pintan unos pocos textos por su cuenta. El paquete los trae en español e inglés y elige así:

1. **Con `@meekojs/i18n`**, el idioma del documento (`useI18n().locale`), sin configurar nada. UI no depende de ese paquete: lee su contexto si existe.
2. **Sin él**, `ui.locale`.
3. **Sin ninguno**, español, como hasta ahora.

```ts
export default defineMeekoConfig({
	modules: ['@meekojs/ui'],
	ui: {
		// Sin @meekojs/i18n, el idioma de los textos; con él, el respaldo de un idioma sin textos.
		locale: 'en',
		messages: {
			en: { table: { empty: 'Nothing here yet.' } },
			fr: {
				modal: { close: 'Fermer' },
				table: { empty: 'Aucune donnée.' },
				select: { empty: 'Aucun résultat', clear: 'Effacer la sélection' },
				themeToggle: {
					labels: { light: 'Clair', dark: 'Sombre', system: 'Système' },
					unknown: 'Changer de thème',
					group: 'Thème',
					cycle: 'Thème : {current}. Passer à {next}',
				},
			},
		},
	},
})
```

| Texto                 | Español                             | Inglés                               | Lo sustituye en un componente |
| --------------------- | ----------------------------------- | ------------------------------------ | ----------------------------- |
| `modal.close`         | `Cerrar modal`                      | `Close modal`                        | `closeLabel`                  |
| `table.empty`         | `No hay datos.`                     | `No data.`                           | `emptyText`, snippet `empty`  |
| `select.empty`        | `Sin resultados`                    | `No results`                         | snippet `empty`               |
| `select.clear`        | `Quitar selección`                  | `Clear selection`                    | `clearLabel`                  |
| `themeToggle.labels`  | `Claro`, `Oscuro`, `Sistema`        | `Light`, `Dark`, `System`            | `labels`                      |
| `themeToggle.unknown` | `Cambiar tema`                      | `Change theme`                       | `messages.unknown`            |
| `themeToggle.group`   | `Tema`                              | `Theme`                              | `messages.group`              |
| `themeToggle.cycle`   | `Tema: {current}. Cambiar a {next}` | `Theme: {current}. Switch to {next}` | `messages.cycle`              |

- **Prioridad.** Una prop o un snippet del componente ganan sobre todo lo demás. Después, `ui.messages` gana sobre los textos del paquete en ese idioma.
- **Idiomas.** `ui.locale` y las claves de `ui.messages` se validan al cargar y se leen en su forma canónica: `EN` es `en` y `pt-br` es `pt-BR`. Una etiqueta inválida, como `en-u`, es un error de configuración.
- **Lo que falta** se toma del idioma base (`pt` para `pt-BR`), de `ui.locale` y, por último, del español. Un idioma de `@meekojs/i18n` sin textos de UI, como `ar`, se muestra en el idioma de `ui.locale`, o en español sin él.
- **`themeToggle.cycle`** es una plantilla de texto, porque las opciones se serializan al cliente: `{current}` y `{next}` son las etiquetas en minúsculas. Para otra forma, usa la función `messages.cycle` del componente. `themeToggle.labels` admite también el nombre de un tema propio.
- **Hidratación.** El idioma sale de la URL o de la configuración y no cambia sin un documento nuevo, así que SSR, prerender e hidratación eligen el mismo texto. `document.lang` y `Accept-Language` no intervienen.

Los tipos `UIMessages` y `UIMessageOverrides` se exportan desde `@meekojs/ui`. Un idioma, una sección o un texto desconocidos, o un valor vacío, detienen el arranque con un error `ui:`.

## Uso

```html
<script lang="ts">
	const name = signal('')
	const error = signal<string | undefined>(undefined)

	function save() {
		error.value = name.value.trim() ? undefined : 'Escribe tu nombre.'
	}
</script>

<template>
	<UIField
		id="user-name"
		label="Nombre"
		description="Como aparecerá en tu perfil."
		bind:error="error.value"
		required
	>
		<snippet
			name="default"
			params="id, describedBy"
		>
			<UIInput
				bind:id="id"
				bind:describedBy="describedBy"
				bind:invalid="Boolean(error.value)"
				model="name"
				required
			/>
		</snippet>
	</UIField>

	<UIButton on:click="save">Guardar</UIButton>
</template>
```

`UIField` entrega el ID del control y el ID de su descripción o error al snippet. Pasa esos valores al control, junto con `invalid` y `required` cuando corresponda: el campo no los propaga automáticamente.

## Componentes

### Container

`UIContainer` centra contenido con un ancho máximo y gutters fluidos, desde móvil hasta 4K. Se registra automáticamente con el módulo.

```html
<UIContainer
	as="section"
	size="4k"
	gutter="md"
	ariaLabel="Proyectos"
>
	<h2>Proyectos del equipo</h2>
</UIContainer>
```

- `size`: `sm` (40rem), `md` (48rem), `lg` (64rem), `xl` (80rem, por defecto), `2xl` (96rem), `3xl` (120rem), `4k` (240rem) o `full` (sin máximo).
- `gutter`: `none`, `sm`, `md` (por defecto) o `lg`. El padding lateral está incluido en el ancho exterior y usa propiedades lógicas para RTL. `md` equivale a `clamp(1rem, 2vw, 4rem)`; `sm`, a `clamp(0.75rem, 1vw, 1.5rem)`; `lg`, a `clamp(1.5rem, 3vw, 6rem)`.
- `as`: `div` por defecto; también `section`, `main`, `article`, `header`, `footer`, `nav` y `aside`.
- `id`, `ariaLabel` y `class`: identidad, nombre accesible y personalización. Requiere el snippet `default`.

Con una raíz de 16px, `4k` admite hasta 3840px CSS. Siempre respeta el ancho del padre y se centra en pantallas mayores; `full` permite ocupar todo el espacio disponible. Para lectura o formularios usa un límite menor, o anida un contenedor con `gutter="none"`. El componente no recorta el contenido ni evita el scroll de sus hijos.

Puedes sobrescribir `--ui-container-max-width` y `--ui-container-gutter` desde una clase del propio contenedor. Los tipos `UIContainerSize`, `UIContainerGutter` y `UIContainerTag` se exportan desde `@meekojs/ui`. La web pública usa Container en su estructura y documenta su API en `/container`.

### Controles básicos

| Componente | API                                                                                                                                                                                                                                                                                            |
| ---------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `UIButton` | Ruta (`to`, `params`, `search`), enlace (`href`, `target`, `rel`, `download`) o botón (`type`, `disabled`); véase [UIButton](#uibutton-ruta-enlace-o-botón). Admite `variant`, `size`, `shape`, `class`, evento `click` y snippet `default`. Por defecto `button`, `primary`, `md`, `rounded`. |
| `UIInput`  | Modelo de texto con `model`. Props: `id`, `name`, `type`, `placeholder`, `required`, `disabled`, `invalid`, `describedBy` y `class`. Tipos admitidos: `text`, `email`, `password`, `search`, `url`, `tel`. Por defecto usa `text` y un valor vacío.                                            |
| `UIField`  | Requiere `id`, `label` y el snippet `default(id, describedBy)`. Props opcionales: `description`, `error`, `required`, `class`. El error tiene prioridad sobre la descripción y se anuncia con `role="alert"`.                                                                                  |

También incluye `UIApp` y `UIModal` para [modales](#modales), `UITable` para [tablas](#tablas), `UICard` para [cards](#cards), y los componentes de navegación y etiquetas siguientes.

### UIButton: ruta, enlace o botón

`UIButton` pinta el elemento que corresponde a lo que hace, con el mismo aspecto (el de `variant`, `size`, `shape` y `tone`, más tu `class`), también en hover, foco y con los estilos de enlace de la aplicación:

- **Con `to`**, un `<MeekoLink>`: un enlace a una ruta de la aplicación que navega sin recargar. `to` sólo admite rutas que existen; `params` es obligatorio en una ruta dinámica, con sus claves, y no se admite en una estática; `search` es la query string.
- **Con `href`**, un `<a>` a cualquier URL, con `target`, `rel` y `download`. Con `target="_blank"` y sin `rel`, añade `rel="noopener noreferrer"`.
- **Sin ninguno**, un `<button>` con `type` (`button` por defecto, así que nunca envía un formulario sin pedirlo) y `disabled`.

```html
<UIButton
	to="/users/[id]"
	bind:params="{ id: user.id }"
	bind:search="{ tab: 'actividad' }"
>
	Perfil
</UIButton>
<UIButton
	href="https://github.com/meekojs/meeko"
	target="_blank"
	variant="outline"
>
	GitHub
</UIButton>
<UIButton
	type="submit"
	bind:disabled="saving.value"
	on:click="save"
>
	Guardar
</UIButton>
```

- **Combinaciones inválidas.** `to` con `href`, `type` o `disabled` en un enlace, `target`, `rel`, `download` o `hreflang` en un botón, `resolve` sin `to`, una ruta inexistente y unos `params` que no son los de la ruta son errores de tipos en `meeko check` y en el editor.
- **Un enlace no se deshabilita.** `<a>` no tiene `disabled` nativo y emularlo con `aria-disabled` deja el `href` navegable con el teclado, el clic central o sin JavaScript; quitar el `href` lo saca del orden de tabulación. Por eso `disabled` sólo existe sin `to` ni `href`: si la acción no está disponible, no pinte el enlace o use un botón deshabilitado.
- **Atributos.** `id`, `title`, `lang`, `tabindex`, `aria-*` y `data-*` llegan al elemento en las tres formas (`UIForwardedAttributes`: los comunes a `<a>` y `<button>`). Un enlace, con `to` o con `href`, acepta además `target`, `rel`, `download` y los atributos propios de `<a>` (`UIAnchorAttributes`: `hreflang`, `ping`, `referrerpolicy`…). `on:click` recibe el `MouseEvent` en las tres; en un enlace, `event.preventDefault()` cancela la navegación.
- **Enlaces localizados.** Con `to`, el `href` pasa por los resolvedores de enlaces de la aplicación, como `<MeekoLink>`: con `@meekojs/i18n`, `<UIButton to="/guide">` apunta a `/en/guide` en una página en inglés, `hreflang="es"` elige otro idioma y `bind:resolve="false"` deja la ruta tal cual.
- **Tipos.** `UIButtonProps`, `UILinkProps`, `UIRouteTarget`, `UIForwardedAttributes`, `UIAnchorAttributes` y `UIActionAppearance` se importan desde `@meekojs/ui/runtime`.

### UIIconButton y UIHint

`UIIconButton` es una acción de sólo icono con las tres formas de `UIButton` (`to`, `href` o un `<button>`), sus `variant`, `size`, `shape`, `tone`, `loading`, `disabled`, `type` y evento `click`. Es cuadrada y `ghost` por defecto. `label` es obligatorio: es su nombre accesible (`aria-label`) y el texto de su `UITooltip`, que no se anuncia como descripción para no leerlo dos veces; `tooltip="false"` lo quita si el contexto ya explica la acción. El icono es `icon`, el nombre de un icono del paquete (`UIIconName`: `close`, `menu`, `check`, `info`…) o el trazo `d` de un `<path>` en una rejilla de 16 por 16, o el snippet `default`, con un `<svg aria-hidden="true">` propio.

```html
<UIIconButton
	label="Cerrar"
	icon="close"
	on:click="close"
/>
<UIIconButton
	label="Fijar el panel"
	variant="outline"
	bind:pressed="pinned.value"
	on:click="() => (pinned.value = !pinned.value)"
>
	<svg
		viewBox="0 0 16 16"
		aria-hidden="true"
	>
		<path d="M8 2v12" />
	</svg>
</UIIconButton>
<UIIconButton
	label="Ajustes"
	to="/settings"
	icon="menu"
/>
```

`UIHint` es un ⓘ con una ayuda en un tooltip, para ponerlo junto a un texto o dentro de un encabezado. Toma el tamaño y el color del texto que lo rodea (`em`), se alcanza con el teclado y abre la ayuda con el puntero, con el foco y al pulsarlo, también en táctil. Es un `<button>` nombrado por `label` (por defecto el texto `hint.label` de los mensajes, «Más información») y descrito por la ayuda (`aria-describedby`). La ayuda es `text` o el snippet `default`; `placement` dice dónde se abre (`top` por defecto).

```html
<h2>Ingresos <UIHint text="Importe cobrado, sin impuestos ni devoluciones." /></h2>
<p>
	Margen bruto
	<UIHint
		label="Qué es el margen"
		placement="right"
	>
		Ingresos menos los
		<em>costes directos</em>
	</UIHint>
</p>
```

- **Contenido de frase.** Los dos pintan sólo un botón o un enlace y un `<span>` con `popover`, así que valen dentro de `<p>`, `<h2>` o `<label>` sin romper la hidratación.
- **Conmutadores.** `pressed` sólo existe en un `<button>`: pinta `aria-pressed` y el aspecto de activo. Un enlace con `pressed` es un error de tipos.
- **Deshabilitados.** Un `<button disabled>` no recibe foco y algunos navegadores no le dan eventos de puntero, así que su tooltip puede no abrirse: si el motivo importa, explícalo fuera del botón.
- **Defaults.** `ui.defaults.iconButton` admite `variant`, `size`, `shape`, `class` y los slots `base`, `icon` y `tooltip`; `ui.defaults.hint`, `class` y los mismos slots.
- **Tipos.** `UIIconButtonProps`, `UIIconName`, `UIHintProps` y `HintSnippets` se importan desde `@meekojs/ui/runtime`.

### Navegación y etiquetas

- `UILink` da apariencia de acción a un `<a>` real, con los defaults de `ui.defaults.link`. Recibe `href` (cualquier URL) o `to` (una ruta de la aplicación con `params` y `search` tipados, como en `UIButton`, con navegación del cliente y el `href` localizado con `@meekojs/i18n`); uno de los dos, no ambos. Con los dos acepta `target`, `rel`, `download`, `hreflang` y `lang`. Comparte `variant`, `size` y `shape` con `UIButton`, y admite `ariaLabel`, `class`, `id`, `title`, `aria-*`, `data-*` y evento `click`. No simula botones ni utiliza roles artificiales. Para `target="_blank"` añade `noopener noreferrer` si no se especifica `rel`.
- `UILinkCard` es una superficie enlazada: requiere `title` y un destino, `href` (cualquier URL) o `to` (una ruta de la aplicación con `params`, `search` y `resolve`, como en `UILink`, con navegación del cliente y el `href` localizado con `@meekojs/i18n`), con `description`, `class` y snippet `default` opcionales. Acepta `target`, `rel`, `download`, `hreflang`, `lang`, `id`, `aria-*`, `data-*` y evento `click`; `title` es el texto de la card, no el atributo HTML. El contenido no debe incluir otros enlaces ni botones porque toda la card es un único enlace.
- `UIBadge` muestra metadatos, con `tone="neutral|info|success|warning|danger"` (`neutral` por defecto), `dot`, `class` y snippet `default` obligatorio. Conserva semántica de texto; no añade anuncios o interacción.

```html
<UILink
	to="/docs"
	variant="primary"
>
	Empezar
</UILink>
<UILinkCard
	to="/docs/framework"
	title="Framework"
	description="Rutas, SSR y datos."
/>
<UIBadge tone="info">Función</UIBadge>
```

La web pública `apps/meeko` consume estas acciones en su portada, cabecera y errores; `UILinkCard` compone el índice documental y `UIBadge` los metadatos de referencia. Su `meeko.config.ts` enlaza los tokens con la paleta actual, incluidas las acciones neutras y el foco azul.

Desde UI 1.8, `UIPopover`, `UISelect`, `UICombobox` y `UIThemeToggle` están en el módulo UI. `MeekoPopover`, `MeekoSelect` y `MeekoThemeToggle` quedaron obsoletos en core 1.8 y se retirarán en 2.0. Para sustituir `MeekoSelect`, usa `UISelect` si necesitas un `<select>` nativo o `UICombobox` si necesitas búsqueda o selección múltiple; no tienen el mismo contrato. Véase [Migración a 1.8](migration-1.8.md).

## Personalización

[`DESIGN.md`](../packages/ui/DESIGN.md) es el contrato visual: qué token usar para cada cosa, tamaños, tipografía y estados. Las hojas del módulo se cargan antes de `app/styles/main.css`. Sobrescribe las variables CSS desde esa hoja de la aplicación:

```css
:root {
	--ui-color-primary-9: #6750a4;
	--ui-color-primary-10: #503d85;
	--ui-radius-md: 0.75rem;
}

:root[data-theme='dark'] {
	--ui-color-primary-9: #7c5cff;
	--ui-color-primary-10: #8a6eff;
}
```

El tema oscuro usa `data-theme="dark"` en el elemento raíz.

El módulo carga además la base global en la capa `ui-base`: la [escala fluida](../packages/ui/DESIGN.md#escala-fluida) de la raíz, reset, `body` con fondo, texto y fuente, `color-scheme`, `::selection`, barras de desplazamiento y foco. Sirve también Inter en `/_meeko-ui/fonts/`, con su `preload`, de modo que la aplicación no necesita copiar la fuente. Cualquier regla de la aplicación gana a esa capa; `ui: { base: false }` la omite por completo.

### Clases por slot

Los componentes se pintan con clases de Tailwind 4 con el prefijo `ui:`, compiladas por UI: tu aplicación no necesita Tailwind y esas clases no chocan con las suyas. Leen los tokens `--ui-*`, así que `ui.tokens`, el tema oscuro y redefinir un token cambian también los componentes.

Para retocar un componente concreto, dale tus clases:

- **`class`** llega al elemento raíz, como siempre. En `UITable` llega a la `<table>`.
- **`ui`** añade clases a cada parte, por el nombre de su slot. `class` equivale a `ui.base` y se añade después. Sólo la tienen los componentes con varias partes; `UIButton`, `UILink`, `UIInput`, `UITextarea` y `UIContainer` usan `class`.

```html
<UICard
	title="Plan Pro"
	class="pricing-card"
	bind:ui="{ header: 'pricing-header', title: 'pricing-title', footer: 'pricing-footer' }"
>
	…
</UICard>
<UIField
	id="email"
	label="Correo"
	bind:ui="{ label: 'form-label', error: 'form-error' }"
>
	…
</UIField>
<UIBadge
	tone="success"
	dot
	bind:ui="{ dot: 'pulse' }"
>
	Publicado
</UIBadge>
```

```ts
useToast().add({ text: 'Guardado', ui: { base: 'toast-wide' } })
```

Los nombres de los slots están en el JSDoc de cada tipo de props (`UICardProps`, `UIFieldProps`…), y el editor los completa. `UIThemeProps` y `UIVariantSlots`, de `@meekojs/ui/runtime`, describen las props de un componente con sus variantes y su `ui`.

**Qué gana.** Tus clases se suman a las del componente, sin fusionarlas ni quitar ninguna: decide la cascada. La hoja de UI tiene tres capas, `ui-base` (la base global), `ui.components` (lo que aún se escribe a mano, como las View Transitions) y `ui.utilities` (las clases `ui:*`), y se carga antes que las hojas de la aplicación. Por eso cualquier regla sin capa de tu CSS gana a las tres, sea cual sea su especificidad, y también la de una capa que declare tu aplicación. Una regla sobre un elemento, como `a { color: … }`, también gana a un enlace de UI: limítala a tu contenido si no quieres cambiar los componentes.

```css
/* app/styles/main.css, sin @layer */
.pricing-title {
	color: var(--ui-color-primary-text);
}
.form-error {
	font-weight: var(--ui-font-weight-semibold);
}
```

### Clases y variantes por defecto

`ui.defaults` da a todas las instancias de un componente las mismas clases, sin repetirlas en cada una: así cambia una aplicación la densidad de todo su panel. La clave es el nombre del componente en camelCase sin el prefijo `UI` (`card`, `table`, `stat`, `alert`, `descriptionList`, `modal`, `drawer`…), y cada componente que acepta `class` o `ui` admite aquí las dos:

```ts
export default defineMeekoConfig({
	modules: ['@meekojs/ui'],
	ui: {
		defaults: {
			card: { padding: 'sm', ui: { header: 'panel-card-header' } },
			table: { density: 'compact', class: 'panel-table' },
			stat: { ui: { value: 'panel-stat-value' } },
		},
	},
})
```

- **`class` y `ui` se suman.** Las clases de `ui.defaults` se añaden a las de cada instancia, no las sustituyen: van primero las del componente, después las de `ui.defaults` y al final las de la instancia. `class` llega donde llega la prop de la instancia: en `UITable`, a la `<table>`. Sin fusión de clases, en un conflicto decide la cascada, como explica [Qué gana](#clases-por-slot): una regla sin capa de tu aplicación gana a las de UI, y entre dos reglas tuyas deciden su especificidad y su orden en tu hoja, no el orden de las clases en el atributo.
- **Variantes.** Unas pocas admiten un valor de base: `variant`, `size` y `shape` en `button`, `link` e `iconButton`; `variant`, `padding`, `density` y `actionsWrap` en `card`, y `density` en `table`. La prop explícita de la instancia gana siempre. En `card`, un `padding` o una `density` de la instancia ganan a los dos de `ui.defaults`, y en cada nivel `padding` gana a `density`. Las demás variantes no tienen default porque dependen de cada instancia: el `tone` de `UIAlert`, `UIBadge` o `UIToast` dice qué es el mensaje, y `layout`, `side`, `sticky`, `size` de `UIModal` o `columns` siguen a la estructura y el contenido de cada página. Su aspecto se retoca con `class` y `ui`.
- **Componentes.** `UIButton`, `UILink`, `UIInput`, `UITextarea`, `UIContainer`, `UIProse`, `UIPopover` y `UITooltip` no tienen slots: sólo admiten `class`. `toast` sólo admite `ui` y también se aplica a los avisos de `useToast()`. `markdownEditor` es `UIMarkdownEditor`, de `@meekojs/ui/editor`. El tipo `UIDefaults` describe cada componente con sus slots reales, y el editor los completa.
- **Validación.** Un componente, una opción o un slot desconocidos, una clase vacía o un valor de variante que no existe hacen fallar la carga del módulo con un error que dice qué se admite, como `ui: unknown slot head in defaults.card.ui; its slots are base, header, title, description, actions, body, footer`.
- **Cliente.** Los defaults viajan con el JavaScript de cada página, como una copia plana de los valores validados: pon ahí clases, no datos.

### Migración desde las clases retiradas

Antes, los componentes llevaban clases `.meeko-ui-*` y atributos `data-*` que sólo servían para darles estilo, y una aplicación podía seleccionarlos en su CSS. Ya no existen: una regla como `.meeko-ui-card-title { … }` o `.meeko-ui-button[data-variant='outline'] { … }` deja de aplicarse sin dar error. Para migrar:

1. Busca en tus hojas y plantillas `meeko-ui-` y los selectores de atributo de componentes de UI (`[data-variant]`, `[data-tone]`, `[data-size]`…).
2. Pon un nombre tuyo en el componente, con `class` o con la parte que corresponda de `ui`, según la tabla.
3. Cambia el selector de tu regla por ese nombre. Si la regla dependía de una variante (`[data-variant='outline']`), pon la clase sólo donde usas esa variante, o pásala desde el mismo sitio que la prop.
4. Deja tu regla sin `@layer`: así gana a la de UI.

| Clase o atributo retirado                                                                                                                            | Ahora                                                                                                                                                     |
| ---------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `.meeko-ui-button` y sus `data-variant`, `data-size`, `data-shape`, `data-tone`                                                                      | `class` de `UIButton` o `UILink`; la variante, con las props `variant`, `size`, `shape` y `tone`.                                                         |
| `.meeko-ui-badge`, `-badge-dot`                                                                                                                      | `UIBadge`: `class` (o `ui.base`) y `ui.dot`.                                                                                                              |
| `.meeko-ui-input`, `-textarea`                                                                                                                       | `class` de `UIInput` o `UITextarea`.                                                                                                                      |
| `.meeko-ui-field`, `-field-label`, `-field-description`, `-field-error`, `-field-meta`, `-counter`                                                   | `UIField`: `ui.base`, `ui.label`, `ui.description`, `ui.error`, `ui.meta`, `ui.counter`.                                                                  |
| `.meeko-ui-choice`, `-choice-content`, `-choice-description`, `-switch`                                                                              | `UICheckbox` o `UISwitch`: `ui.base`, `ui.content`, `ui.description`; el control, `ui.input`.                                                             |
| `.meeko-ui-radio-group`, `-radio-options` y su `data-variant`                                                                                        | `UIRadioGroup`: `ui.base`, `ui.options`, `ui.option`, `ui.legend`, `ui.input`; la prop `variant`.                                                         |
| `.meeko-ui-slider`                                                                                                                                   | `UISlider`: `ui.base` y `ui.input`.                                                                                                                       |
| `.meeko-ui-card`, `-card-header`, `-card-title`, `-card-description`, `-card-actions`, `-card-body`, `-card-footer` y `data-variant`, `data-padding` | `UICard`: `ui.base`, `ui.header`, `ui.title`, `ui.description`, `ui.actions`, `ui.body`, `ui.footer`; las props `variant` y `padding`.                    |
| `.meeko-ui-link-card`, `-link-card-title`, `-link-card-description`                                                                                  | `UILinkCard`: `ui.base`, `ui.title`, `ui.description`.                                                                                                    |
| `.meeko-ui-table-scroll`, `.meeko-ui-table`, `-table-empty` y `data-layout`, `data-density`, `data-numeric`                                          | `UITable`: `ui.base` (el contenedor), `class` o `ui.table`, `ui.empty`, `ui.headerCell`, `ui.cell`, `ui.footerCell`, `ui.bodyRow`.                        |
| `--table-border`, `--table-background`, `--table-hover`                                                                                              | Una regla tuya sobre `ui.table`, `ui.cell` o `ui.bodyRow`.                                                                                                |
| `.meeko-ui-stat`, `-stat-value`, `-stat-detail`                                                                                                      | `UIStat`: `ui.base`, `ui.label`, `ui.value`, `ui.detail`.                                                                                                 |
| `.meeko-ui-description-list` y `data-columns`                                                                                                        | `UIDescriptionList`: `ui.base`, `ui.item`, `ui.label`, `ui.value`, `ui.code`, `ui.detail`; la prop `columns`.                                             |
| `.meeko-ui-modal`, `-modal-heading`, `-modal-body`, `-modal-footer`, `-modal-close` y `data-size`                                                    | `UIModal`: `ui.base`, `ui.heading`, `ui.title`, `ui.description`, `ui.body`, `ui.footer`, `ui.close`; la prop `size`.                                     |
| `.meeko-ui-drawer`, `-drawer-trigger`, `-drawer-panel`, `-drawer-heading`, `-drawer-body`, `-drawer-footer`, `-drawer-close` y `data-side`           | `UIDrawer`: `ui.base`, `ui.trigger`, `ui.panel`, `ui.heading`, `ui.title`, `ui.body`, `ui.footer`, `ui.close`.                                            |
| `.meeko-ui-alert`, `-alert-icon`, `-alert-content`, `-alert-title`, `-alert-description`, `-feedback-actions`, `-dismiss` y `data-tone`              | `UIAlert`: `ui.base`, `ui.icon`, `ui.content`, `ui.title`, `ui.description`, `ui.actions`, `ui.dismiss`; la prop `tone`.                                  |
| `.meeko-ui-toast`, `-toast-content`, `-toast-message`                                                                                                | `UIToast` o `useToast().add()`: `ui.base`, `ui.content`, `ui.message`, `ui.actions`, `ui.dismiss`.                                                        |
| `.meeko-ui-empty`, `-empty-title`, `-empty-description`                                                                                              | `UIEmpty`: `ui.base`, `ui.title`, `ui.description`, `ui.actions`.                                                                                         |
| `.meeko-ui-skeleton`; `.meeko-ui-disclosure`, `-disclosure-body`                                                                                     | `UISkeleton`: `ui.base`, `ui.line`. `UIDisclosure`: `ui.base`, `ui.summary`, `ui.body`.                                                                   |
| `.meeko-ui-tabs`, `-tabs-list`, `-tabs-tab`, `-tabs-panel`, `-tabs-indicator`                                                                        | `UITabs`: `ui.base`, `ui.list`, `ui.tab`, `ui.panel`, `ui.indicator`.                                                                                     |
| `.meeko-ui-page`, `-page-body`, `-page-sidebar`, `-page-main`, `-page-aside`, `-page-bar`, `-page-notices`, `-skip-link`                             | `UIPage`: `ui.base`, `ui.body`, `ui.sidebar`, `ui.main`, `ui.aside`, `ui.bar`, `ui.notices`, `ui.skip`.                                                   |
| `.meeko-ui-page-header`, `-page-header-row`, `-page-header-text`, `-page-header-actions`                                                             | `UIPageHeader`: `ui.base`, `ui.row`, `ui.text`, `ui.title`, `ui.description`, `ui.actions`.                                                               |
| `.meeko-ui-container` y `data-size`, `data-gutter`                                                                                                   | `class` de `UIContainer`; las props `size` y `gutter`.                                                                                                    |
| `.meeko-ui-header`, `-header-bar`, `-header-nav`, `-header-actions`, `-header-toggle`, `-header-menu` y `data-sticky`                                | `UIHeader`: `ui.base`, `ui.bar`, `ui.nav`, `ui.link`, `ui.actions`, `ui.toggle`, `ui.menu`; la prop `sticky`.                                             |
| `.meeko-ui-footer`, `-footer-inner`, `-footer-about`, `-footer-groups`, `-footer-title`, `-footer-actions`, `-footer-legal`                          | `UIFooter`: `ui.base`, `ui.inner`, `ui.about`, `ui.groups`, `ui.title`, `ui.list`, `ui.link`, `ui.actions`, `ui.legal`.                                   |
| `.meeko-ui-nav-tree`, `-nav-group`, `-nav-group-title`, `-nav-link`, `-nav-label`, `-nav-chevron`, `-nav-empty`                                      | `UINavigationTree`: `ui.base`, `ui.group`, `ui.title`, `ui.link`, `ui.label`, `ui.chevron`, `ui.empty`.                                                   |
| `.meeko-ui-nav-tabs`, `-nav-tabs-indicator` y su `data-variant`                                                                                      | `UINavigationTabs`: `ui.base`, `ui.link`, `ui.indicator`; la prop `variant`.                                                                              |
| `.meeko-ui-breadcrumb`; `.meeko-ui-pagination`, `-pagination-count`; `.meeko-ui-page-nav`, `-page-nav-link`                                          | `UIBreadcrumb`: `ui.base`, `ui.list`, `ui.item`, `ui.link`. `UIPagination`: `ui.base`, `ui.count`, `ui.action`. `UIPageNavigation`: `ui.base`, `ui.link`. |
| `.meeko-ui-toc`, `-toc-title`, `-toc-collapsible` y `data-nested`, `data-tracking`                                                                   | `UITableOfContents`: `ui.base`, `ui.title`, `ui.list`, `ui.link`, `ui.collapsible`.                                                                       |
| `.meeko-ui-locale-switcher`; `.meeko-ui-locale-suggestion`, `-locale-suggestion-actions`                                                             | `UILocaleSwitcher`: `ui.base`, `ui.link`. `UILocaleSuggestion`: `ui.base`, `ui.message`, `ui.actions`.                                                    |
| `.meeko-ui-command`, `-command-trigger`, `-command-field`, `-command-icon`, `-command-close`, `-command-status`, `-command-list`, `-command-row`     | `UICommandPalette`: `ui.base` (el diálogo), `ui.trigger`, `ui.field`, `ui.icon`, `ui.input`, `ui.close`, `ui.status`, `ui.list`, `ui.row`.                |
| `.meeko-ui-command-excerpt`; `[data-active]` en una fila de la paleta                                                                                | Un `<small>` en tu snippet `item`; `[aria-selected='true']`.                                                                                              |
| `.meeko-ui-tooltip`, `-tooltip-trigger` y `data-placement`, `data-match-width`                                                                       | `class` y `triggerClass` de `UITooltip` o `UIPopover`; las props `placement` y `matchWidth`.                                                              |
| `data-clearable` de `UISelect` y `UICombobox`                                                                                                        | `UISelect` o `UICombobox`: `class` (la raíz), `ui.trigger`, `ui.clear` y el resto de sus slots.                                                           |

Los atributos que lee JavaScript siguen ahí y puedes seguir usándolos en un selector: `data-meeko-*` (`data-meeko-popover`, `data-meeko-select-trigger`…), el `data-open` del contenido de un popover, los estados de `UIModal` y `UIToast` y todos los atributos ARIA (`aria-current`, `aria-selected`, `aria-expanded`, `aria-invalid`…).

`MeekoSelect`, `MeekoPopover` y `MeekoThemeToggle`, obsoletos en el núcleo, ya no reciben aspecto de la hoja de UI: cámbialos por `UISelect` o `UICombobox`, `UIPopover` y `UIThemeToggle` ([Migración a 1.8](migration-1.8.md)).

`UICodeBlock`, `UIDiff`, los iconos y el marco de `UIMarkdownEditor` también dejan sus clases (`.meeko-ui-code-block` y las `.meeko-ui-code-*`, `.meeko-ui-diff*`, `.meeko-ui-icon` y las `ui-markdown-editor-*` del marco) y sus `data-*` de estilo: personalízalos con `class` y `ui`. Siguen siendo API pública la clase `meeko-ui-prose`, que viste Markdown en cualquier elemento, y la utilidad `meeko-ui-sr-only`, porque una aplicación no compila Tailwind; también `data-kind` en cada línea de `UIDiff` y la clase `ui-markdown-editor`, de la que cuelga el tema de Crepe.

## Modales

El módulo instala un gestor independiente por aplicación (y por petición SSR). Monta un único `UIApp`, preferiblemente en `app/app.meeko`, para mantener el host durante las navegaciones. También puede ir en cada layout raíz: al navegar de uno a otro, el `UIApp` nuevo releva al anterior y los modales abiertos pasan a él, pero el contenido de los layouts se vuelve a crear. Dos `UIApp` a la vez son un error en SSR o anidados, y un `console.error` en el navegador:

```html
<template>
	<UIApp><MeekoOutlet /></UIApp>
</template>
```

Los componentes que se abren por nombre deben empezar por `Modal`, por ejemplo `app/components/Modal/UserCreate.meeko` se registra como `ModalUserCreate`.

```ts
const modal = useModal()

async function createUser() {
	const user = await modal.open<User>('ModalUserCreate', { organizationId: 1 })
	if (user !== undefined) users.value = [...users.value, user]
}
```

Dentro del componente modal, utiliza `UIModal` y el contexto de su instancia:

```html
<script lang="ts">
	const props = defineProps<{ organizationId: number }>()
	const modal = useModalInstance<boolean>()
</script>

<template>
	<UIModal
		title="Crear usuario"
		description="Confirma la creación en esta organización."
	>
		<p>Organización {props.organizationId}</p>
		<snippet name="footer">
			<UIButton
				variant="secondary"
				on:click="() => modal.dismiss()"
			>
				Cancelar
			</UIButton>
			<UIButton on:click="() => modal.close(true)">Confirmar</UIButton>
		</snippet>
	</UIModal>
</template>
```

Este último ejemplo devuelve `boolean`; quien lo abre debe usar `open<boolean>`. Los nombres y props se infieren del registro generado. El resultado `R` es un contrato declarado por el consumidor, no se infiere del componente: debe coincidir con `useModalInstance<R>()`.

`open<R>()` devuelve `Promise<R | undefined>`. Cancelar, Escape, clic en el fondo o desmontar el host resuelven con `undefined`; los errores de carga rechazan la promesa. `undefined` queda reservado para cancelación. `useModal()` expone `instances` como señal de un mapa de sólo lectura, `dismiss(id)` y `dismissAll()`. Las cargas concurrentes conservan el orden de apertura; una carga cancelada no monta contenido al terminar. Los resolvers son privados.

Al apilar modales, sólo el superior pinta el fondo oscuro: la intensidad no se acumula al abrir más instancias. Al cerrar el superior, el anterior recupera el fondo; el foco, Escape y el bloqueo de interacción siguen siendo nativos. Este comportamiento también funciona al combinar modales declarativos y programáticos.

La apertura dura 220 ms y el cierre 160 ms, con opacidad, desplazamiento y escala. Los diálogos de atrás conservan su DOM y estado, se reducen ligeramente y no reciben interacción; al volver al frente recuperan tamaño y foco. El componente se desmonta y `open()` se resuelve al terminar la salida. El gestor mantiene el primer resultado si se repite el cierre. Desmontar el host o disponer el proveedor cancela inmediatamente los pendientes. Los modales declarativos pueden reabrirse durante la salida sin desmontarse. Con movimiento reducido no se ejecutan estas animaciones. El ejemplo de `/modals` abre una pila `lg → md → sm` para observar cada capa.

Sólo `useModal` y `useModalInstance` se autoimportan en componentes y código de aplicación. Para imports explícitos utiliza `@meekojs/ui/runtime`, que no carga las herramientas de configuración del módulo. Los tipos públicos `ModalContext`, `ModalInstanceContext` y `ModalDismissReason` requieren `import type` explícito; no se añaden a los globals. Llama a los composables durante el setup, antes de cualquier `await`. Abrir modales durante SSR o sin un `UIApp` montado produce un rechazo explícito.

`UIModal` también funciona sin el gestor con `model="opened"`, siendo `opened` una señal booleana. Admite:

| Prop                               | Comportamiento                                                                                           |
| ---------------------------------- | -------------------------------------------------------------------------------------------------------- |
| `title`                            | Obligatoria; proporciona el nombre accesible del diálogo.                                                |
| `description`                      | Descripción accesible opcional.                                                                          |
| `size`                             | `sm`, `md` (predeterminado) o `lg`.                                                                      |
| `closeOnEscape`, `closeOnBackdrop` | Permiten cancelar por teclado o fondo; ambos `true` por defecto.                                         |
| `closeButton`, `closeLabel`        | Botón de cierre visible por defecto, con `modal.close` de [los textos](#textos-e-idiomas) como etiqueta. |
| `class`                            | Clases adicionales del diálogo.                                                                          |

El snippet `default` es obligatorio y `footer` opcional. El evento `dismiss` recibe `escape`, `backdrop`, `button` o `native`; cambiar el modelo a `false` cierra sin emitir ese evento. Si desactivas las vías de cancelación, proporciona una acción explícita de cierre. La base usa `<dialog>` y `showModal()`, con nombre accesible, foco y capa modal nativos. `components/internal/ModalInstance.meeko` es infraestructura del host y sólo se importa explícitamente: no forma parte del registro ni genera nombres globales de componente o props.

`provideModal`, el gestor, los resolvers y los tipos auxiliares pertenecen a la implementación interna y no tienen una entrada pública de paquete. El plugin estático `app/plugins/modal.ts` los importa directamente. Los tipos auxiliares que describen retornos públicos siguen distribuyéndose en las declaraciones TypeScript, sin convertirse en exports nombrados de `runtime` ni autoimports.

## Tablas

`UITable` genera la cabecera, las filas y el pie a partir de `columns` y `rows`. El tipo de fila se infiere desde las props; `TableColumn<T>` comprueba las claves y el tipo del valor que recibe cada formateador. Sus tipos se importan explícitamente desde `@meekojs/ui/runtime`.

```html
<script lang="ts">
	import type { TableColumn } from '@meekojs/ui/runtime'

	interface User {
		id: number
		name: string
		age: number
	}

	const users = signal<User[]>([{ id: 1, name: 'Ana', age: 28 }])
	const columns = [
		{ key: 'name', label: 'Nombre', footer: 'Total' },
		{
			key: 'age',
			label: 'Edad',
			format: (value) => value.toFixed(0), // value: number
			footer: (rows) => rows.length + ' usuarios',
		},
	] satisfies TableColumn<User>[]
</script>

<template>
	<UITable
		caption="Usuarios"
		bind:columns="columns"
		bind:rows="users.value"
		rowKey="id"
		layout="grid"
		gridColumns="minmax(180px, 2fr) 120px"
	/>
</template>
```

| Prop          | Comportamiento                                                                                                                                            |
| ------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `rows`        | Array de filas, acepta arrays de sólo lectura. Obligatorio.                                                                                               |
| `columns`     | Array de `TableColumn<T>`, obligatorio. Cada columna define `key`, `label`, y opcionalmente `format(value, row)` y `footer`.                              |
| `rowKey`      | Propiedad de la fila cuyo valor sea `string` o `number`, o función `(row) => string \| number`. Obligatoria y única por fila para preservar su identidad. |
| `layout`      | `native` por defecto; `grid` usa CSS subgrid y conserva el modo nativo si no está disponible.                                                             |
| `gridColumns` | Definición CSS de columnas para grid; por defecto genera una columna `minmax(var(--ui-table-column-min), 1fr)` por cada entrada de `columns`.             |
| `caption`     | Título visible y nombre de la región desplazable, opcional.                                                                                               |
| `hideHeader`  | Oculta la cabecera; `false` por defecto.                                                                                                                  |
| `emptyText`   | Mensaje cuando `rows` está vacío; por defecto, `table.empty` de [los textos](#textos-e-idiomas).                                                          |
| `class`       | Clases adicionales sobre `<table>`.                                                                                                                       |

`format` devuelve texto, número, booleano o un valor vacío (`null`/`undefined`). Sin formateador, los valores se convierten a texto y los vacíos se muestran como una cadena vacía. El contenido se escapa como cualquier interpolación Meeko. Para objetos o fechas, proporciona un formateador. `footer` admite los mismos valores o una función que recibe todas las filas; el pie aparece cuando alguna columna lo define.

Los snippets son opcionales y personalizan el **contenido** de cada celda; la tabla conserva las etiquetas y sus roles accesibles:

| Snippet          | Parámetros                                                                                  |
| ---------------- | ------------------------------------------------------------------------------------------- |
| `cell-<clave>`   | `row: T`, `value: T[clave]`: el valor con el tipo exacto de esa columna. Desde Meeko `1.8`. |
| `header-<clave>` | `column: TableColumn<T>`: la cabecera de esa columna. Desde Meeko `1.8`.                    |
| `header`         | `column: TableColumn<T>`                                                                    |
| `cell`           | `row: T`, `column: TableColumn<T>`, `value: T[keyof T]`, `index: number`                    |
| `footer`         | `column: TableColumn<T>`, `rows: readonly T[]`; fuerza la aparición del pie.                |
| `empty`          | Sin parámetros; reemplaza `emptyText`.                                                      |
| `caption`        | Sin parámetros; reemplaza `caption` y da también el nombre de la región desplazable.        |

Cada clave de la fila tiene sus propios snippets, `cell-<clave>` y `header-<clave>`. Una clave que la fila no tiene (`name="cell-email"` con filas sin `email`) es un error de tipos, igual que unos `params` de más. En cada celda gana `cell-<clave>`, después `cell` y por último el `format` de la columna; en la cabecera, `header-<clave>`, después `header` y por último `label`.

```html
<UITable
	bind:columns="columns"
	bind:rows="projects.value"
	rowKey="id"
>
	<!-- value es string: el tipo de Project['status']. -->
	<snippet
		name="cell-status"
		params="row, value"
	>
		<UIBadge bind:tone="value === 'Publicado' ? 'success' : 'neutral'">{value}</UIBadge>
	</snippet>
	<snippet
		name="header-name"
		params="column"
	>
		<abbr title="Nombre del proyecto">{column.label}</abbr>
	</snippet>
</UITable>
```

El snippet genérico `cell` sigue sirviendo para todas las columnas a la vez:

```html
<UITable
	bind:columns="columns"
	bind:rows="users.value"
	rowKey="id"
>
	<snippet
		name="cell"
		params="row, column, value"
	>
		<strong if:when="column.key === 'name'">{row.name}</strong>
		<span if:when="column.key !== 'name'">{String(value)}</span>
	</snippet>
</UITable>
```

El snippet `cell` sustituye el formateador y recibe el valor original. Su valor es la unión de los tipos de campo de la fila; para un valor con el tipo de su columna usa `cell-<clave>`, `row.age` o el `format` de esa columna. Los snippets por columna requieren `@meekojs/meeko` `1.8` o posterior. No escribas `<tr>` ni `<td>` en estos snippets.

El contenedor admite foco y desplazamiento horizontal con teclado. `class` llega a la `<table>`; las demás partes se personalizan con la prop `ui`: `base` (el contenedor que desplaza), `table`, `caption`, `section`, `row`, `bodyRow`, `headerCell`, `cell`, `footerCell` y `empty` (véase [Clases por slot](#clases-por-slot)). Define las columnas con `gridColumns`. La guía `/tables` muestra ambos layouts, formateadores, pies calculados, celdas personalizadas y estado vacío.

## Cards

`UICard` compone cabecera, cuerpo y pie con cuatro variantes tipadas. El cuerpo es el snippet `default`, obligatorio; `header` y `footer` son opcionales.

```html
<UICard
	title="Datos del proyecto"
	description="Información compartida con tu equipo."
	variant="outline"
>
	<p>Contenido de la card.</p>
	<snippet name="footer">
		<UIButton on:click="save">Guardar</UIButton>
	</snippet>
</UICard>
```

| Prop          | Comportamiento                                                                |
| ------------- | ----------------------------------------------------------------------------- |
| `variant`     | `outline` por defecto, `soft`, `solid` o `elevated`.                          |
| `title`       | Título opcional, renderizado como `<h2>` y nombre accesible de la sección.    |
| `description` | Texto opcional bajo el título.                                                |
| `headingId`   | `id` del título, que recibe `tabindex="-1"` para llevarle el foco por código. |
| `actionsWrap` | Dónde van las acciones: `inline` por defecto, `below` o `auto`.               |
| `class`       | Clases adicionales sobre la sección.                                          |

Los demás atributos, como `id` o `aria-label`, llegan a la `<section>`. El snippet `actions` va junto al título, y una `UITable` sola en el cuerpo llega hasta el borde de la card, que le sirve de marco.

`actionsWrap` decide dónde van esas acciones. Con `inline`, el valor por defecto, ocupan una columna junto al título y la descripción; con `below` van siempre debajo, en una fila propia; con `auto` van al lado mientras quepan y bajan bajo el título cuando la cabecera de la card mide menos de `24rem`, el tamaño de contenedor `card-narrow` del tema. `auto` mira el ancho de la card con una container query sobre su cabecera, no el de la ventana, así que una card estrecha en una pantalla ancha también las baja. Es CSS puro: el HTML del servidor ya tiene su forma final y no hay saltos al hidratar. El orden del DOM no cambia (título, descripción y acciones), y con él el del foco y el de lectura. Con `auto`, la cabecera no aporta ancho intrínseco a la card, que toma su ancho del contenedor o del cuerpo. `ui.defaults.card.actionsWrap` fija el valor de toda la aplicación, y la prop de la instancia gana sobre él.

```html
<UICard
	title="Pedidos"
	description="Los últimos 30 días."
	actionsWrap="auto"
>
	<snippet name="actions">
		<UIButton variant="secondary">Exportar</UIButton>
		<UIButton>Nuevo pedido</UIButton>
	</snippet>
	<p>Contenido de la card.</p>
</UICard>
```

`outline` usa superficie y borde; `soft`, un fondo tenue sin borde visible; `solid`, el color de acento y su texto de contraste; `elevated`, superficie con sombra sin borde visible. Todas responden a los tokens y al tema de UI. `--card-padding` permite ajustar el espacio interno mediante una clase; `--ui-card-shadow` personaliza la sombra.

El snippet `header` sustituye por completo `title` y `description`; proporciona un encabezado con el nivel adecuado para tu página si lo usas. El pie aparece sólo al suministrar `footer`. Sin título, descripción ni snippet de cabecera, no se genera el `<header>`. El contenedor conserva su semántica de sección y no añade comportamiento de botón: utiliza enlaces y botones en su contenido para las acciones. La guía `/cards` muestra las variantes y la composición.

## Editor de Markdown

`<UIMarkdownEditor>` edita Markdown con [Crepe](https://milkdown.dev) y un modo código. Va en su propio módulo, `@meekojs/ui/editor`, porque Crepe pesa 347 KB de JS en gzip: el registro de componentes de Meeko genera un `import()` por cada componente, y dentro del módulo principal sería un chunk de cualquier web.

```sh
pnpm add @milkdown/crepe @milkdown/kit @codemirror/language @codemirror/view @codemirror/lang-javascript @codemirror/lang-html @codemirror/lang-css @codemirror/lang-json @lezer/highlight
```

```ts
// meeko.config.ts
export default defineMeekoConfig({
	modules: ['@meekojs/ui', '@meekojs/ui/editor'],
})
```

```html
<UIMarkdownEditor
	label="Contenido"
	model="markdown"
	model:mode="mode"
/>
```

Son dependencias opcionales de `@meekojs/ui`: una aplicación sin el módulo no las instala. El JavaScript de Crepe se carga con `import()` en el navegador, al montar el componente, y nunca entra en el bundle del servidor. Hasta entonces, el HTML del servidor pinta un marcador con la altura definitiva.

| Prop          | Tipo      | Para qué                                                        |
| ------------- | --------- | --------------------------------------------------------------- |
| `label`       | `string`  | Etiqueta visible y nombre accesible. Obligatoria.               |
| `id`          | `string`  | `id` del área de texto del modo código.                         |
| `readonly`    | `boolean` | Se puede leer y seleccionar, pero no cambiar.                   |
| `disabled`    | `boolean` | Como `readonly`, y además se ve deshabilitado.                  |
| `describedBy` | `string`  | `id` del texto que lo describe.                                 |
| `placeholder` | `string`  | Texto del documento vacío, si no se quiere el de `ui.messages`. |
| `class`       | `string`  | Clase de la raíz.                                               |

- **Modelos:** `model` es el texto y `model:mode`, `'visual'` o `'code'`. Si el padre escribe otro texto, el editor vuelve a empezar con él.
- **Snippet:** `tools` va en la barra, entre la etiqueta y el conmutador.
- **Altura:** `--ui-markdown-editor-height`. El contenido se desplaza dentro.
- **Textos:** `ui.messages.<idioma>.markdownEditor`, también los de los menús de Crepe.

### Guardado por bloques

Crepe serializa un documento en su propio formato, así que guardar su salida reescribiría tablas y líneas en blanco que nadie tocó. Por eso el modelo sólo cambia con una edición real, y entonces conserva los bytes del original fuera de los bloques editados:

- Sin editar, `model` sigue siendo el texto recibido, byte a byte. Escribir y deshacer, o pulsar Intro sin escribir, también.
- Un bloque editado sale de Crepe. Una lista es un solo bloque: cambiar una palabra en una lista larga la reescribe entera.
- Los saltos CRLF pasan a LF sólo si se edita el documento.
- El frontmatter nunca llega a Crepe: se conserva tal cual.
- El evento espera a una pausa al escribir, y se adelanta al salir del editor, antes de que un clic en «guardar» lea el modelo.
- Si un documento no casa bloque a bloque con su serialización, se abre en modo código con un aviso. Ningún documento de `docs/` lo necesita.

Los bloques de código conservan su `meta` (` ```ts bad `), también al copiarlos. Las imágenes pegadas se ignoran: sin destino, se guardarían como una dirección `blob:` de la pestaña. No hay LaTeX ni bloque de imagen.

`splitMarkdownSource` y `createMarkdownSplicer` se exportan de `@meekojs/ui/editor`, sin Crepe, para quien los necesite aparte.

## Desarrollo

Desde la raíz del monorepo:

```sh
pnpm build
pnpm -F @meekojs/ui run check
pnpm -F meeko-ui-site run dev
```

Las fuentes de la aplicación del módulo se organizan así:

```text
src/
  app/
    components/
      internal/
        ModalInstance.meeko
    composables/
      useModal.ts
    plugins/
      modal.ts
    types/
      modal.ts
    utils/
      modal-dialog.ts
    styles/
      main.css
      tokens.css
  index.ts
  module.ts
  runtime.ts
```

El build de UI genera ESM, declaraciones TypeScript y los componentes con sus declaraciones adyacentes en `dist/app/components`. El módulo registra el plugin estático `dist/app/plugins/modal.js` y enlaza su alias privado `virtual:meeko-ui-components` con el registro de componentes que genera Meeko para el consumidor; UI no escribe un plugin en `.meeko/generated`. `scripts/build-styles.mjs` compila `src/app/styles/main.css` con Tailwind 4 en `dist/styles/main.css`, la hoja que añade el módulo: toma las clases de `src/app/components` y `src/app/variants`, nunca de la aplicación. En el workspace, `pnpm -F @meekojs/ui run build:styles` la recompila al editar un componente, una variante o una hoja, y la web de UI la recibe por HMR. Los consumidores no necesitan generar archivos dentro de `node_modules`.

Más información en la [guía de UI](ui.md) y en la [web pública de Meeko UI](https://ui.meekojs.com), con instalación, personalización, API y ejemplos interactivos. En el monorepo se inicia mediante `pnpm ui:dev`.

## UIPopover

Un contenido en la capa superior del navegador (la API `popover`), anclado a su disparador con _CSS anchor positioning_:

```html
<script lang="ts">
	const open = signal(false)
</script>
<template>
	<UIPopover
		placement="bottom-start"
		bind:offset="8"
		model="open"
		role="menu"
		on:toggle="(event) => console.log(event.open)"
	>
		<snippet name="trigger">Opciones ▾</snippet>
		<button
			role="menuitem"
			on:click="rename"
		>
			Renombrar
		</button>
		<button
			role="menuitem"
			on:click="duplicate"
		>
			Duplicar
		</button>
		<button
			role="menuitem"
			on:click="remove"
		>
			Eliminar
		</button>
	</UIPopover>
</template>
```

Meeko pinta un `<button>` con `popovertarget`, `aria-expanded`, `aria-controls` y `aria-haspopup` (según `role`), cuyo contenido es el snippet `trigger`, y el contenido suelto dentro de un elemento con `popover` y `data-meeko-popover`. El botón tiene aspecto de control y los elementos con `role="menuitem"`, de opción de menú: `triggerClass`, `class` o cualquier regla de tu CSS los sustituyen. Con `popovertarget`, el botón abre y cierra el contenido incluso antes de hidratar.

| Prop                    | Por defecto      | Qué hace                                                                                                                                |
| ----------------------- | ---------------- | --------------------------------------------------------------------------------------------------------------------------------------- |
| `mode`                  | `"auto"`         | `"auto"` se cierra al pulsar fuera y con `Esc`; `"manual"` sólo desde el disparador, `Esc` o el modelo; `"hint"` es un tooltip (abajo). |
| `placement`             | `"bottom-start"` | `top`, `bottom`, `left` o `right`, con `-start` o `-end` para alinearlo con un borde del disparador.                                    |
| `offset`                | `0`              | Separación en píxeles con el disparador.                                                                                                |
| `role`                  | —                | `"menu"`, `"dialog"` o `"tooltip"` (por defecto con `mode="hint"`): el patrón ARIA del contenido.                                       |
| `label`                 | —                | `aria-label` del contenido; sin ella, un menú o un diálogo se nombran con el disparador (`aria-labelledby`).                            |
| `class`, `triggerClass` | —                | Clases del contenido y del botón.                                                                                                       |
| `triggerId`             | `useId`          | `id` del disparador; con un disparador propio, el `id` que lleva.                                                                       |
| `matchWidth`            | `false`          | El contenido mide al menos lo que el disparador (`anchor-size(width)`).                                                                 |
| `delay`, `closeDelay`   | `300`, `150`     | Con `mode="hint"`, milisegundos antes de abrir y de cerrar con el puntero.                                                              |

`model` (el modelo por defecto) es la señal de apertura: asignarla abre o cierra el contenido, y el usuario la cambia al abrirlo o cerrarlo. `on:toggle` emite `{ open }` (tipo `PopoverToggleEvent`) con cada cambio. Una `ref:` recibe `show()`, `hide()` y `toggle()`.

**Teclado y foco.**

- `Esc` cierra y devuelve el foco al disparador. Pulsar fuera cierra un `mode="auto"` sin mover el foco.
- Con `role="menu"`, el contenido sigue el patrón de menú: `Intro`, `Espacio` o `↓` en el disparador abren el menú con el foco en el primer `menuitem` (`↑`, en el último); las flechas lo mueven (dando la vuelta), `Inicio` y `Fin` van a los extremos y las primeras letras buscan un elemento. Los elementos con `disabled` o `aria-disabled="true"` se saltan. Elegir un `role="menuitem"` cierra el menú y devuelve el foco; un `menuitemcheckbox` o `menuitemradio` lo deja abierto. `Tab` cierra el menú. Marque los elementos con `role="menuitem"`: Meeko no cambia el rol de su contenido.
- Con `role="dialog"`, el foco entra en el primer control (o en el elemento con `autofocus`) al abrirse.

**Tooltip.** `mode="hint"` usa `popover="hint"`: se abre al pasar el puntero (tras `delay`) o al enfocar el disparador, se queda abierto mientras el puntero está sobre él o sobre el contenido, se cierra con `Esc` o al perder el foco y nunca toma el foco. El disparador lleva `aria-describedby` con el contenido, que es `role="tooltip"`. En táctil no es fiable: según el navegador, aparece al tocar, sólo mientras se mantiene pulsado o no aparece, así que no pongas en él nada imprescindible.

Un `<button>` activo o un enlace con `href` llevan además `interestfor`: donde el navegador tiene Interest Invokers (Chromium 142 o posterior; Firefox y Safari aún no, en noviembre de 2026), es él quien abre y cierra el tooltip, sin temporizadores de JavaScript y también antes de hidratar. En cualquier otro caso lo hace `<UIPopover>`. `delay`, `closeDelay`, el modelo, `Esc`, el toque y `aria-describedby` funcionan igual en los dos caminos, con dos diferencias en el nativo: al perder el foco se cierra tras `closeDelay`, no al instante, y un clic antes de `delay` no adelanta la apertura.

```html
<UIPopover mode="hint">
	<snippet name="trigger">?</snippet>
	El código está en el reverso de la tarjeta.
</UIPopover>
```

**Posición.** El contenido usa `position-anchor: auto`, `position-area` y `position-try-fallbacks: flip-block, flip-inline`, así que se coloca al otro lado si no cabe, sin JavaScript. Esas reglas son clases `ui:*` de la capa `ui.utilities`, así que cualquier regla sin capa de tu CSS gana. Un navegador sin anchor positioning lo abre sin anclar. El contenido abierto lleva `data-open`.

**Disparador propio.** El snippet `anchor` sustituye el botón: recibe en `trigger` (tipo `PopoverTrigger`) los atributos que el disparador debe llevar, con el nombre de cada atributo como clave, así que basta con [`bind="trigger"`](api.md). `<UIPopover>` encuentra el elemento por su `id` al montarse y le añade el teclado y el anclaje:

```html
<UIPopover role="menu">
	<snippet
		name="anchor"
		params="trigger"
	>
		<button
			type="button"
			class="avatar"
			bind="trigger"
		>
			<img
				src="/me.png"
				alt="Mi cuenta"
			/>
		</button>
	</snippet>
	<a
		role="menuitem"
		href="/perfil"
	>
		Perfil
	</a>
</UIPopover>
```

Con un componente propio, `<AppButton bind="trigger">` le pasa esas claves como props: el componente debe declararlas (por ejemplo, `defineProps<Partial<PopoverTrigger> & { variant?: "ghost" }>()`) y ponerlas en su `<button>`, que es el elemento que lleva el `id`.

Con `mode="hint"`, un disparador sin `interestfor`, como un `<span>` o un componente que no lo reenvía, sigue funcionando con el JavaScript de `<UIPopover>`. Un `<a>` de SVG no sirve como disparador de un tooltip: `showPopover` no lo admite como origen, y no se abre.

Un disparador que no es un `<button>` (sin `popovertarget`) abre el contenido con el modelo: `on:click="() => open.value = !open.value"`.

### Props de UIPopover

Tipos públicos de `@meekojs/ui/runtime`.

| Prop           | Tipo               | Descripción                                                                                                  |
| -------------- | ------------------ | ------------------------------------------------------------------------------------------------------------ |
| `mode`         | `PopoverMode`      | `"auto"` (por defecto), `"manual"` o `"hint"`; véase `PopoverMode`.                                          |
| `placement`    | `PopoverPlacement` | Dónde se abre respecto al disparador; `"bottom-start"` por defecto.                                          |
| `offset`       | `number`           | Separación en píxeles entre el disparador y el contenido; `0` por defecto.                                   |
| `role`         | `PopoverRole`      | Patrón ARIA del contenido; con `mode="hint"`, `"tooltip"` por defecto.                                       |
| `label`        | `string`           | `aria-label` del contenido. Sin ella, un menú o un diálogo se nombran con el disparador.                     |
| `class`        | `string`           | Clases del contenido, el elemento con `popover`.                                                             |
| `triggerClass` | `string`           | Clases del `<button>` disparador que pinta Meeko.                                                            |
| `triggerId`    | `string`           | `id` del disparador; por defecto, uno de `useId`. Con un disparador propio, el `id` que lleva.               |
| `matchWidth`   | `boolean`          | Con `true`, el contenido mide al menos lo que el disparador (`anchor-size(width)`).                          |
| `delay`        | `number`           | Con `mode="hint"`, milisegundos que el puntero espera sobre el disparador antes de abrir; `300` por defecto. |
| `closeDelay`   | `number`           | Con `mode="hint"`, milisegundos antes de cerrar al salir el puntero; `150` por defecto.                      |

## UIMenu

`<UIMenu>` es un menú de acciones con el patrón _Menu Button_ del APG, sobre `<UIPopover role="menu">`: el disparador lleva `aria-haspopup="menu"`, `aria-expanded` y `popovertarget`, así que abre la lista sin JavaScript, y la lista (`role="menu"`) se ancla con CSS en la capa superior. Las flechas recorren los ítems y saltan los desactivados, `Inicio` y `Fin` van a los extremos, una letra salta al ítem que empieza por ella, `Esc` cierra, `Tab` sale y el foco vuelve al disparador al cerrar o al elegir.

```html
<UIMenu
	triggerLabel="Acciones"
	bind:items="[
		{ label: 'Renombrar', shortcut: 'F2', onSelect: rename },
		{ label: 'Ajustes', to: '/settings' },
		{ separator: true },
		{ label: 'Eliminar', tone: 'danger', onSelect: remove },
	]"
	on:select="(item) => log(item.label)"
/>
```

**Un panel que no es un menú.** Las notificaciones, la cuenta de usuario o unos filtros contienen controles, enlaces o texto, no una lista de acciones: no van en `UIMenu`, cuyo `role="menu"` obliga a que cada elemento sea un `menuitem` y quita la navegación con `Tab`. Usa `<UIPopover role="dialog" label="Notificaciones">` con el disparador que quieras (por ejemplo un `UIIconButton` en el snippet `anchor`): el foco entra en el panel, `Tab` recorre sus controles y `Esc` lo cierra y devuelve el foco.

Cada entrada de `items` (`UIMenuEntry`) es una acción (`UIMenuAction`: un `<button role="menuitem">` con `onSelect`), un enlace (`UIMenuLink`: un `<a role="menuitem">` con `href`, o con `to`, `params` y `search` tipados, que navega con `<MeekoLink>`) o un separador (`{ separator: true }`, con `role="separator"`). Un ítem admite además `value`, `tone: 'danger'`, `disabled` (sigue visible, con `aria-disabled`, y no se puede elegir), `icon` (trazo SVG de 16 por 16) y `shortcut` (un recordatorio tras el texto; el atajo lo implementa la aplicación). El evento `select` recibe el ítem elegido, después de su `onSelect`.

Sin `triggerLabel` ni snippet `trigger`, el disparador es un botón de sólo icono con tres puntos, para el menú de una fila, nombrado con `menu.trigger` de los mensajes («Más acciones», «More actions») salvo que se pase `ariaLabel`. Los snippets son `trigger` (contenido del botón), `anchor` (un disparador propio, como en `UIPopover`), `item` (interior de cada ítem de `items`) y `default` (ítems propios con `role="menuitem"` tras los de `items`). La lista sólo pinta contenido de frase, así que el componente es válido dentro de un `<p>`.

| Prop           | Tipo                     | Descripción                                                                                       |
| -------------- | ------------------------ | ------------------------------------------------------------------------------------------------- |
| `items`        | `readonly UIMenuEntry[]` | Ítems y separadores, en orden.                                                                    |
| `triggerLabel` | `string`                 | Texto del disparador, seguido de un chevron.                                                      |
| `ariaLabel`    | `string`                 | Nombre accesible del disparador; en el de sólo icono, «Más acciones» por defecto.                 |
| `label`        | `string`                 | `aria-label` de la lista. Sin ella, el menú se nombra con su disparador.                          |
| `variant`      | `UIActionVariant`        | Variante del disparador: `"secondary"` por defecto, `"ghost"` en el de sólo icono.                |
| `size`         | `UIActionSize`           | Tamaño del disparador; `"md"` por defecto.                                                        |
| `disabled`     | `boolean`                | Desactiva el disparador.                                                                          |
| `placement`    | `PopoverPlacement`       | Dónde se abre; `"bottom-start"` por defecto.                                                      |
| `offset`       | `number`                 | Separación en píxeles con el disparador; `4` por defecto.                                         |
| `triggerId`    | `string`                 | `id` del disparador; por defecto, uno de `useId`.                                                 |
| `class`        | `string`                 | Clases de la lista; equivale a `ui.base`.                                                         |
| `ui`           | objeto                   | Clases por slot: `base`, `trigger`, `chevron`, `item`, `icon`, `label`, `shortcut` y `separator`. |

El modelo por defecto (`model="open"`) es la apertura. `ui.defaults.menu` acepta `class` y `ui`. Los tipos `UIMenuProps`, `UIMenuEntry`, `UIMenuItem`, `UIMenuAction`, `UIMenuLink`, `UIMenuSeparator` y `MenuSnippets` se exportan desde `@meekojs/ui/runtime`.

## UISelect

Un `<select>` nativo con `appearance: base-select`: el navegador trae la lista, el teclado y el valor de formulario. Para buscar, filtrar en un servidor o elegir varias opciones, usa [`UICombobox`](#uicombobox); `multiple`, `searchable`, `filter` y `max` en `UISelect` son un error de tipos que lo indica.

```html
<UISelect
	id="owner"
	name="owner"
	by="id"
	labelBy="name"
	groupBy="team"
	placeholder="Asigna una persona"
	clearable
	model="owner"
	bind:options="members"
>
	<snippet
		name="option"
		params="member, state"
	>
		{member.name}
		<em if:when="state.selected">(elegida)</em>
	</snippet>
</UISelect>
```

Acepta `options`, `by`, `labelBy`, `disabledBy`, `groupBy`, `placeholder`, `name`, `required`, `disabled`, `clearable`, `clearLabel`, `field`, `id`, `label`, `describedBy`, `invalid`, `class`, `listClass`, `placement` y `offset`; emite `change`. Los snippets son `option` (`[option, state]`, con `selected` y `disabled`), `value` y `group`.

- **Navegadores.** Chrome, Edge y Safari 27 pintan la lista con los tokens de UI, con entrada animada. Firefox y los navegadores antiguos muestran su lista propia, y en ellos `value`, `group` y el contenido rico de `option` quedan en su texto.
- **Disparador.** Usa `<selectedcontent>`. Con el snippet `option`, muestra `value` o la etiqueta, porque `<selectedcontent>` copiaría toda la opción. No pongas `id` dentro de `option`, porque la copia lo duplicaría.
- **Teclado.** Es el del navegador. `Intro` o `Espacio` abren la lista, y las flechas y las letras se mueven por ella. Con la lista cerrada varía según el motor: en WebKit, las flechas no abren.
- **Sin elegir.** Una opción oculta al principio representa el `placeholder`, o un valor que ya no está en `options`: el modelo lo conserva y el formulario lo sigue enviando.
- **`required`.** Un formulario sin valor no se envía: el `<select>` recibe el foco y `aria-invalid="true"`, sin el aviso del navegador.
- **`listClass`.** Va en el `<select>`: dale estilo con `.mi-clase::picker(select)`.

## UICombobox

Lo que el `<select>` nativo de `UISelect` no cubre: buscar, filtrar en un servidor y elegir varias opciones. Es una lista propia sobre `<UIPopover>`, con más JavaScript: úsalo sólo si necesitas `searchable`, `filter`, `multiple` o `max`. `model` es el valor y su tipo sale de `options`:

```html
<script lang="ts">
	interface User {
		id: number
		name: string
		team: string
	}
	const colors = ['Rojo', 'Verde', 'Azul']
	const color = signal<string | null>(null)
	const users = signal<User[]>([])
	const user = signal<User | null>(null)
	const tags = signal<string[]>([])
</script>
<template>
	<label for="color">Color</label>
	<UICombobox
		id="color"
		model="color"
		bind:options="colors"
		placeholder="Elige un color"
		name="color"
	/>

	<UICombobox
		model="user"
		bind:options="users.value"
		by="id"
		label="Responsable"
	>
		<snippet
			name="option"
			params="user, state"
		>
			{user.name}
			<span if:when="state.selected">✓</span>
		</snippet>
		<snippet
			name="value"
			params="user"
		>
			{user.name}
		</snippet>
	</UICombobox>

	<UICombobox
		model="tags"
		multiple
		searchable
		bind:options="colors"
		bind:max="2"
		name="tags"
	/>
</template>
```

| Prop                                        | Qué hace                                                                                                                                                                                 |
| ------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `options`                                   | Las opciones, primitivos u objetos. Es reactiva.                                                                                                                                         |
| `multiple`                                  | El modelo es un array y cada opción se alterna.                                                                                                                                          |
| `by`                                        | Cómo se compara una opción con el valor: una clave (`by="id"`) o una función `(a, b) => boolean`. Por defecto, `Object.is`.                                                              |
| `labelBy`, `disabledBy`, `groupBy`          | La etiqueta (por defecto, el texto del primitivo o `label`/`name` del objeto), si está deshabilitada (por defecto, `disabled: true`) y el grupo de cada opción: una clave o una función. |
| `placeholder`                               | Texto sin valor elegido.                                                                                                                                                                 |
| `name`                                      | `name` de los `<input type="hidden">` que se envían con el `<form>`.                                                                                                                     |
| `required`, `disabled`                      | Como en un control nativo.                                                                                                                                                               |
| `searchable`                                | El disparador es un `<input>` que filtra las opciones.                                                                                                                                   |
| `clearable`, `clearLabel`                   | Botón junto al disparador que quita la selección (`null`, o `[]` con `multiple`); `clearLabel` es su `aria-label` (por defecto, `select.clear` de [los textos](#textos-e-idiomas)).      |
| `filter`                                    | Búsqueda propia, síncrona o asíncrona.                                                                                                                                                   |
| `max`                                       | Con `multiple`, cuántas opciones se pueden elegir como mucho.                                                                                                                            |
| `field`                                     | El campo de `useForm`: `bind:field="form.field('color')"`.                                                                                                                               |
| `id`, `label`, `describedBy`, `invalid`     | `id` del disparador (para `<label for>`), su `aria-label`, `aria-describedby` y `aria-invalid`.                                                                                          |
| `class`, `listClass`, `placement`, `offset` | Clases de la raíz y de la lista, y la posición de la lista.                                                                                                                              |

`on:change` emite el valor nuevo con cada elección del usuario. Los snippets son `option` (`[option, state]`, con `state.selected`, `state.active` y `state.disabled`), `value` (cómo se ve cada valor elegido en el disparador; sin él, las etiquetas separadas por comas), `group` (el encabezado de un grupo), `empty` (sin opciones; por defecto, `select.empty` de [los textos](#textos-e-idiomas)) y `loading` (mientras carga una búsqueda asíncrona).

**Tipos.** `meeko check` y el editor infieren de la etiqueta el tipo de las opciones (`T`) y si es múltiple: el modelo de un select simple es una `Signal<T | null>` y el de uno múltiple, `Signal<T[]>`; `by`, `labelBy` y `groupBy` sólo admiten claves de `T`, y los parámetros de los snippets tienen el tipo `T`. El tipo `ComboboxModel<T, Multiple>` describe el valor.

**ARIA y teclado.** El disparador es un `role="combobox"` (un `<button>` o, con `searchable`, un `<input>` con `aria-autocomplete="list"`) con `aria-expanded`, `aria-controls`, `aria-haspopup="listbox"` y `aria-activedescendant`: el foco nunca sale de él. La lista es un `role="listbox"` (con `aria-multiselectable` en un select múltiple) de `role="option"` con `aria-selected` y `aria-disabled`, agrupadas en `role="group"` con `groupBy`. Un `<label for>` externo nombra el disparador por su `id`. El patrón ARIA del combobox no define cómo vaciar la selección, así que `clearable` añade, fuera del combobox, un `<button type="button">` con `aria-label` («Quitar selección»): entra en el orden de tabulación justo después del disparador, sólo existe mientras hay algo elegido y al activarlo cierra la lista, emite `change` con `null` (o `[]`) y devuelve el foco al disparador.

- `↓`, `↑`, `Intro` o `Espacio` abren la lista sobre la opción elegida (o la primera); `Inicio` y `Fin` abren en un extremo; las letras abren y buscan.
- Con la lista abierta, las flechas, `Inicio`, `Fin`, `RePág` y `AvPág` mueven la opción activa (sin dar la vuelta, saltando las deshabilitadas) y la desplazan hasta verla; las letras buscan por el principio de la etiqueta, sin distinguir acentos.
- `Intro` elige la opción activa; `Espacio` también, salvo con `searchable`, donde escribe un espacio. En un select simple, elegir cierra la lista; en uno múltiple, alterna la opción y la lista sigue abierta. `Alt+↑` elige y cierra.
- `Esc` cierra sin cambiar el valor y `Tab` cierra. Pulsar fuera o mover el foco fuera también cierran.
- Con el ratón, un clic en una opción la elige; pasar el puntero la activa. Pulsar en la lista no quita el foco al disparador.

Con `max`, en cuanto hay `max` opciones elegidas las demás quedan `aria-disabled="true"` y `data-disabled` hasta que se quite una.

**Atributos de estado.** Las opciones llevan `data-active`, `data-selected` y `data-disabled`, y la raíz (`data-meeko-select`) `data-open`, `data-multiple`, `data-disabled` y `data-loading`. La lista mide al menos lo que el disparador (`anchor-size(width)`), tiene una altura máxima y se desplaza; su CSS las sustituye:

```css
[data-meeko-select] [role='option'][data-active] {
	background: var(--hover);
}
[data-meeko-select] [role='option'][data-selected]::after {
	content: ' ✓';
}
[data-meeko-select] [data-meeko-popover] {
	max-height: 16rem;
}
```

**Búsqueda.** Con `searchable`, escribir filtra las opciones cuya etiqueta contiene el texto, sin distinguir mayúsculas ni acentos («amb» encuentra «Ámbar»). `filter(query, { options, signal })` sustituye ese filtro: devuelve las opciones que se muestran o una promesa de ellas para buscar en el servidor. Mientras la promesa no resuelve, la raíz lleva `data-loading`, la lista `aria-busy="true"` y se muestra el snippet `loading`; una búsqueda nueva aborta la anterior (`signal`) y descarta su respuesta. Con la búsqueda vacía se muestran `options`, sin llamar a `filter`, así que la búsqueda nunca se ejecuta en el servidor.

```html
<script lang="ts">
	interface City {
		code: string
		name: string
	}
	const city = signal<City | null>(null)
	const search = (query: string, { signal }: { signal: AbortSignal }): Promise<City[]> => fetch(`/api/cities?q=${encodeURIComponent(query)}`, { signal }).then((response) => response.json())
</script>
<template>
	<UICombobox
		model="city"
		bind:options="[]"
		by="code"
		searchable
		bind:filter="search"
		placeholder="Busca una ciudad"
	>
		<snippet name="loading">Buscando…</snippet>
		<snippet name="empty">Ninguna ciudad con ese nombre</snippet>
	</UICombobox>
</template>
```

**Formularios.** Con `name`, el `<select>` nativo envía su valor (vacío sin elegir) y la lista propia, un `<input type="hidden">` por valor (ninguno en uno múltiple vacío); con `disabled` no envía nada. El valor de cada opción es su clave de `by`, el propio primitivo o su etiqueta. `required` impide enviar el `<form>` sin valor: el disparador recibe el foco y `aria-invalid="true"` hasta que se elige una opción. Con `useForm`, `model="form.fields.color"` funciona como en cualquier control, y `bind:field="form.field('color')"` da además el valor, el `id` del campo (para su `<label for>`), el `name`, `aria-invalid` y `aria-describedby` con el mensaje de error; `focusInvalid` lleva el foco al select cuando falla la validación. El valor inicial `""` de un campo cuenta como «sin valor» (salvo que una opción sea `""`).

```html
<form
	on:submit="form.submit"
	novalidate
>
	<label bind:for="form.field('country').id">País</label>
	<UICombobox
		bind:field="form.field('country')"
		bind:options="countries"
		placeholder="Elige un país"
	/>
	<p
		if:when="form.errors.value.country"
		bind:id="form.field('country').errorId"
	>
		{form.errors.value.country}
	</p>
	<button>Guardar</button>
</form>
```

**Listas largas.** `<UICombobox>` pinta todas las opciones (en el HTML del servidor también). Para miles de opciones, use `searchable` con un `filter` que devuelva sólo las primeras coincidencias; una lista virtual que sólo pinte las visibles (`virtual`) no está disponible en UI `1.8`.

**Alternativa nativa.** Para un caso simple, sin búsqueda ni opciones con contenido propio, un `<select>` nativo con `model` sigue siendo la opción más ligera. En los navegadores que lo admiten, `appearance: base-select` permite estilizarlo por completo y conserva el teclado, la accesibilidad y el envío del formulario del navegador:

```css
select,
::picker(select) {
	appearance: base-select;
}
```

### Props de UICombobox

Tipos públicos de `@meekojs/ui/runtime`.

| Prop          | Tipo                                                   | Descripción                                                                                                              |
| ------------- | ------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------ |
| `options`     | `readonly T[]`                                         | Las opciones, primitivos u objetos. Es reactiva: una lista nueva actualiza la lista abierta.                             |
| `multiple`    | `Multiple`                                             | Con `true`, el modelo es un array y cada opción se alterna.                                                              |
| `by`          | `SelectKey<T> \| ((a: T, b: T) => boolean)`            | Cómo se comparan las opciones con el valor: una clave (`by="id"`) o una función; por defecto, `Object.is`.               |
| `labelBy`     | `SelectKey<T> \| ((option: T) => string)`              | Etiqueta de cada opción: una clave o una función; por defecto, el texto del primitivo o `label`/`name` del objeto.       |
| `disabledBy`  | `SelectKey<T> \| ((option: T) => boolean)`             | Qué opciones están deshabilitadas: una clave o una función; por defecto, las que tienen `disabled: true`.                |
| `groupBy`     | `SelectKey<T> \| ((option: T) => string \| undefined)` | Grupo de cada opción, con un encabezado por grupo: una clave (`groupBy="category"`) o una función.                       |
| `placeholder` | `string`                                               | Texto del disparador sin valor elegido.                                                                                  |
| `name`        | `string`                                               | `name` de los `<input type="hidden">` que se envían con el `<form>`, uno por valor.                                      |
| `required`    | `boolean`                                              | Exige un valor al enviar el `<form>`.                                                                                    |
| `disabled`    | `boolean`                                              | Deshabilita el disparador; los `<input type="hidden">` no se envían.                                                     |
| `searchable`  | `boolean`                                              | Convierte el disparador en un combobox con `<input>` que filtra las opciones.                                            |
| `filter`      | `ComboboxFilter<T>`                                    | Búsqueda propia, síncrona o asíncrona; por defecto, la etiqueta contiene el texto, sin distinguir acentos ni mayúsculas. |
| `max`         | `number`                                               | Con `multiple`, cuántas opciones se pueden elegir como mucho.                                                            |
| `field`       | `SelectField<ComboboxModel<T, Multiple>>`              | El campo de `useForm` (`form.field('x')`): su `id`, su `name`, su valor, `aria-invalid` y `aria-describedby`.            |
| `id`          | `string`                                               | `id` del disparador, para un `<label for>`; por defecto, el del campo o uno de `useId`.                                  |
| `label`       | `string`                                               | `aria-label` del disparador y de la lista, sin `<label>`.                                                                |
| `describedBy` | `string`                                               | `aria-describedby` del disparador.                                                                                       |
| `invalid`     | `boolean`                                              | Marca el disparador con `aria-invalid="true"`.                                                                           |
| `class`       | `string`                                               | Clases del elemento raíz.                                                                                                |
| `listClass`   | `string`                                               | Clases de la lista, el elemento con `popover`.                                                                           |
| `placement`   | `PopoverPlacement`                                     | Dónde se abre la lista; `"bottom-start"` por defecto.                                                                    |
| `offset`      | `number`                                               | Separación en píxeles entre el disparador y la lista.                                                                    |

## UIThemeToggle

Desde UI `1.8`, con el módulo UI activo y `theme` en `meeko.config.ts`, `UIThemeToggle` permite cambiar el tema. Requiere core `1.8` y usa su API pública `useThemeToggle()`.

Con `icons`, el botón pinta un icono de `light`, `dark` y `system` en lugar de su nombre, que sigue en el `aria-label`: `<UIThemeToggle icons />`. Un snippet con el nombre de la elección gana sobre el icono, y otro tema muestra su nombre. Es lo que usan las cabeceras de las webs de Meeko.

```html
<UIThemeToggle>
	<snippet name="light"><IconSun /></snippet>
	<snippet name="dark"><IconMoon /></snippet>
	<snippet name="system"><IconMonitor /></snippet>
</UIThemeToggle>
<UIThemeToggle mode="select" />
<UIThemeToggle
	bind:themes="['light', 'dark']"
	bind:labels="{ light: 'Claro', dark: 'Oscuro', system: 'Sistema' }"
	class="toggle"
/>
```

| Prop          | Por defecto            | Qué hace                                                                                                                                                           |
| ------------- | ---------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `mode`        | `"cycle"`              | `"cycle"`: un botón que pasa a la elección siguiente de la lista. `"select"`: un grupo de radios.                                                                  |
| `themes`      | los temas y `"system"` | Las elecciones y su orden (`bind:themes="['light', 'dark']"`).                                                                                                     |
| `labels`      | los de `ui.messages`   | El nombre de cada elección; un tema propio, sin etiqueta, se llama como el tema.                                                                                   |
| `messages`    | los de `ui.messages`   | Los textos accesibles: `cycle(current, next)` (el `aria-label` del botón), `unknown` y `group`, sobre [los textos](#textos-e-idiomas). Tipo `ThemeToggleMessages`. |
| `class`, `id` | —                      | Del `<form>` raíz. Otros atributos no pasan: envuelva la etiqueta si los necesita.                                                                                 |

Cada snippet (`light`, `dark`, `system` o el nombre de un tema propio) es el icono de esa elección; sin snippet se pinta su etiqueta. `meeko check` y el editor tipan los snippets, `themes` y `labels` con los temas de `meeko.config.ts` (`system` sólo si está activo) y `mode` como `"cycle" | "select"`; el editor completa la etiqueta, sus props y sus snippets, y su hover muestra la ficha de la etiqueta. El tipo de sus props es `UIThemeToggleProps`, exportado desde `@meekojs/ui/runtime`. No tiene estilos visuales propios: el botón y los radios son elementos nativos que estiliza la aplicación (`.toggle button`, `[role="radio"][aria-checked="true"]`, `[data-meeko-theme-option="dark"]`). Para marcar el radio elegido también antes de hidratar, cuando la elección no se conoce y no hay `aria-checked`, use `data-theme-choice`, como los iconos: `[data-theme-choice="dark"] [data-meeko-theme-option="dark"]`.

**Iconos que nunca saltan.** El componente pinta todos los iconos, cada uno en `<span data-meeko-theme-icon="light|dark|system|…">`, y no elige ninguno: con `theme` activo, Meeko añade a `<head>` una regla CSS mínima, sólo `display: none`, que oculta todos salvo el de `data-theme-choice`. Como el script de `<head>` escribe ese atributo antes del primer pintado, el icono sale bien desde el primer frame en todos los casos (con cookie, en `"system"` sin cookie ni client hint, en una página prerenderizada o en `static`), sin JavaScript en el componente, y hidratar no cambia ningún nodo del componente. Una lista sin `system` (`bind:themes="['light', 'dark']"`) muestra en modo sistema el icono del tema efectivo, según `prefers-color-scheme`, como el script. En `mode="select"` cada radio lleva su icono y todos se ven.

**Accesibilidad.** En `mode="cycle"` es un `<button>` cuyo `aria-label` dice la elección y la siguiente, «Tema: oscuro. Cambiar a sistema», y se actualiza con cada cambio. Cuando el HTML se genera sin conocer la elección (sin la cookie, una página prerenderizada), el `aria-label` es neutro, «Cambiar tema», hasta que termina la hidratación: así no anuncia algo falso ni provoca un desajuste de hidratación, porque la hidratación pinta lo mismo que el servidor. En `mode="select"` es un `role="radiogroup"` con un `aria-label` («Tema») y un botón `role="radio"` por elección con `aria-checked` y el nombre de la elección. Cuando el HTML no conoce la elección, ningún radio lleva `aria-checked`, ni `"true"` ni `"false"`: un grupo con todos en `"false"` diría que no hay ninguno marcado, y marcar el de `default` diría algo falso a quien eligió otro tema, porque la página prerenderizada es la misma para todos. Al terminar la hidratación cada radio recibe su `aria-checked` una sola vez, y el estado visual lo da antes el CSS con `data-theme-choice`; con JavaScript, las flechas, `Inicio` y `Fin` mueven el foco y la elección, con un `tabindex` itinerante, como un grupo de radios nativo. Sin JavaScript cada radio es un botón que se alcanza con el tabulador.

**Sin JavaScript (mejora progresiva).** El componente es un `<form method="post" action="/_meeko/theme">`: el botón de `"cycle"` envía la elección siguiente y cada radio, la suya, junto con la URL de la página (`return`). Con JavaScript, el envío se intercepta y el cambio es inmediato, con `useTheme().set()`, sin navegar. Sin él, el servidor atiende el formulario:

- `POST /_meeko/theme` existe sólo con `theme` activo (en los demás métodos responde `405`).
- Acepta sólo `application/x-www-form-urlencoded` de hasta 2 KB; `theme` debe ser un tema de `themes` o `"system"` (con el modo sistema activo); si no, `400 INVALID_THEME`, sin escribir nada.
- Escribe la cookie como el runtime del navegador (`Path=/`, un año, `SameSite=Lax`, `Secure` en HTTPS) y responde `303` a `return`, que debe ser una ruta de este origen (`/docs?tab=a`). Una URL absoluta, `//otro.sitio`, una barra invertida o caracteres de control vuelven a `/`: nunca hay una redirección abierta. El siguiente documento SSR ya trae el tema nuevo.
- **CSRF.** No usa la sesión ni el token CSRF (`x-meeko-csrf`, que sólo existe con JavaScript): sólo cambia la cookie del tema. Como `origin: "required"` de una ruta de API, exige un `Origin` igual al de la petición, que tras `createServerApp` es el `publicOrigin` configurado; un `Origin` ausente, `null` o de otro sitio responde `403 INVALID_ORIGIN` antes de leer el cuerpo. Los navegadores envían `Origin` en todo `POST`; una página con `Referrer-Policy: no-referrer` lo envía como `null`, así que ahí el formulario sin JavaScript no funciona (con JavaScript sí). Detrás de un proxy, configure el origen público, como para las mutaciones con sesión.
- **Prerender con Node.** El endpoint existe también en el servidor de una aplicación cuyas páginas son prerenderizadas, y escribe la cookie; pero el HTML prerenderizado es el mismo para todos y, sin JavaScript, no aplica la cookie (lo hace el script de `<head>`), así que la página sigue mostrando el tema por defecto. Sin JavaScript, el cambio sólo se ve en las páginas SSR.
- **Adaptador `static`.** No hay servidor: el formulario se renderiza igual (el HTML es el que generó el prerender, común a todos los adaptadores) y con JavaScript funciona, pero sin él el `POST` llega al hosting, que lo rechaza. Es una limitación documentada; en un sitio estático, el selector necesita JavaScript.

Usar `<UIThemeToggle>` sin `theme` produce `MEEK111` al renderizarse, a través de `useThemeToggle()`. Los conflictos con componentes propios llamados `UIThemeToggle` se resuelven como los de los demás componentes registrados por módulos.

**Eventos.** No declara eventos de componente; el cambio actualiza el estado compartido de `useTheme()`. Los snippets se nombran por elección (`light`, `dark`, `system` o un tema propio). `ThemeToggleMessages` y `ThemeToggleSnippets` permanecen en `@meekojs/meeko/framework`.

## Estructura y navegación

Componentes para el armazón de una web y su navegación, con HTML nativo y CSS: los enlaces, los menús, el panel lateral y el índice funcionan sin hidratar. Sus textos por defecto están en `ui.messages`, en español e inglés. Los tipos se importan de `@meekojs/ui/runtime`.

Todo enlace de una lista acepta `href` (cualquier URL) o `to` (una ruta con `params` y `search` tipados), además de `target`, `rel`, `download`, `hreflang`, `lang` y `title`. Con `to` navega con `<MeekoLink>`, pasa por los resolvedores de enlaces (con `@meekojs/i18n` apunta al idioma del documento o al de `hreflang`) y `aria-current` lo decide la ruta activa; `match: 'prefix'` marca también sus rutas hijas y `resolve: false` deja el `href` tal cual. Con `href`, el enlace es el actual si coincide con la prop `current` del componente. En los dos casos manda el `current` del propio enlace: `true` lo marca y `false` lo desmarca.

```html
<UIPage layout="docs">
	<snippet name="header">
		<UIHeader
			bind:brand="brand"
			bind:items="items"
		>
			<snippet name="actions"><UILocaleSwitcher bind:items="locales" /></snippet>
		</UIHeader>
	</snippet>
	<snippet name="bar">
		<UIDrawer
			title="Contenidos"
			triggerLabel="Contenidos"
		>
			<UINavigationTree bind:groups="groups" />
		</UIDrawer>
	</snippet>
	<snippet name="sidebar"><UINavigationTree bind:groups="groups" /></snippet>
	<snippet name="aside"><UITableOfContents bind:entries="toc" /></snippet>
	<UITableOfContents
		bind:entries="toc"
		variant="collapsible"
	/>
	<UIPageHeader
		title="Instalación"
		description="Añade el paquete a tu aplicación."
	/>
	<UIProse
		as="article"
		bind:html="doc.html"
	/>
	<UIPageNavigation bind:next="{ label: 'Rutas', to: '/routes' }" />
	<snippet name="footer"><UIFooter bind:brand="brand" /></snippet>
</UIPage>
```

| Componente           | Props                                                                                                                                                                                                                  | Snippets y eventos                                                  |
| -------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------- |
| `UIPage`             | `layout` (`docs`, `dashboard`, `landing`), `mainId` (`contenido`), `mainLang`, `skipLabel`, `class` y atributos como `lang` o `dir`                                                                                    | `default`, `header`, `notices`, `bar`, `sidebar`, `aside`, `footer` |
| `UIPageHeader`       | `title`, `description`, `layout`, `class`                                                                                                                                                                              | `breadcrumb`, `actions`, `default`                                  |
| `UIHeader`           | `brand`, `items`, `current`, `label`, `menuLabel`, `sticky` (`true`), `size` (`2xl`), `class`                                                                                                                          | `brand`, `nav`, `actions`, `menu`                                   |
| `UIFooter`           | `brand`, `description`, `groups`, `items`, `label`, `size` (`2xl`), `class`                                                                                                                                            | `brand`, `about`, `actions`, `legal`                                |
| `UINavigationTree`   | `groups` (`title`, `icon`, `open`, `items` con `icon`, `code`, `featured`, `aliases`), `current`, `label`, `collapsible` (`true`), `featuredLabel`, `emptyText`, `class`                                               | `item(item, current)`, `icon(entry)`, `empty`                       |
| `UIDrawer`           | `title`, `id`, `side` (`start`, `end`), `triggerLabel`, `closeLabel`, `closedBy` (`any`, `closerequest`, `none`), `closeOnNavigate` (`true`), `class`; modelo `open` con `model`                                       | `default`, `footer`, `trigger(id)`; evento `close`                  |
| `UINavigationTabs`   | `items` (con `badge`, `badgeTone`, `badgeDot`), `current`, `label`, `variant` (`underline`, `segmented`), `class`                                                                                                      | evento `select(event, item)`                                        |
| `UIBreadcrumb`       | `items` (el último es la página actual; sin destino es texto), `label`, `class`                                                                                                                                        |                                                                     |
| `UIPageNavigation`   | `previous`, `next`, `label`, `previousLabel`, `nextLabel`, `class`                                                                                                                                                     |                                                                     |
| `UIPagination`       | `shown`, `total`, `countText`, `hasMore`, `busy`, `moreLink`, `loadMoreLabel`, `loadingLabel`, `label`, `class`                                                                                                        | `default`; evento `loadMore`                                        |
| `UITableOfContents`  | `entries` (`id`, `text`, `level`), `active`, `variant` (`aside`, `collapsible`), `label`, `class`                                                                                                                      |                                                                     |
| `UILocaleSwitcher`   | `items` (`code`, `label`, `href` o `to`, `current`), `label`, `class`                                                                                                                                                  |                                                                     |
| `UILocaleSuggestion` | `items`, `suggested`, `label`, `message`, `goLabel`, `stayLabel`, `class`                                                                                                                                              | evento `stay`                                                       |
| `UICodeBlock`        | `code`, `html`, `label`, `lang`, `verdict` (`good`, `bad`), `verdictLabel`, `mode` (`code`, `log`), `copy`, `copyLabel`, `copyAriaLabel`, `copiedLabel`, `copyFailedLabel`, `uiLang`, `labelLang`, `textLang`, `class` | `default`                                                           |
| `UIProse`            | `as` (`div`, `article`, `section`), `html`, `class` y atributos                                                                                                                                                        | `default`                                                           |
| `UIDiff`             | `diff`, `label`, `emptyText`, `lineLabels`, `class`                                                                                                                                                                    |                                                                     |

- **`UIPage`** pinta un único `<main>` enfocable y el enlace para saltar a él, y coloca `sidebar` y `aside` en columnas fijas al desplazarse. Por debajo de 75rem oculta `aside`, y por debajo de 54rem oculta `sidebar` y muestra `bar`, donde va el `UIDrawer`. Con un `UIHeader` fijo, los anclajes dejan libre su altura.
- **`notices`** de `UIPage` va bajo la cabecera, con el ancho de la página, y no ocupa sitio si su contenido no pinta nada.
- **`UIHeader`** tiene una altura fija, `--ui-header-height`. En pantallas estrechas sus enlaces pasan a un menú con `popover`, que flota y no mueve la página. Una imagen de `brand` declara `width` y `height` para reservar su espacio.
- **`UIDrawer`** es un `<dialog>` modal con `command`, `commandfor` y `closedby`: abre, cierra y devuelve el foco sin JavaScript en los navegadores que los admiten; donde no, lo hace al hidratar. Ya hidratado, sale con la misma View Transition que `UIModal`, por su propio lado; al seguir un enlace se cierra al instante, porque la navegación ya es la transición.
- **`UINavigationTabs`** son enlaces, no un `tablist`. El indicador sigue al actual con posicionamiento por ancla; sin él, el enlace se marca solo. Para paneles en la misma página, no sirve este componente. `variant="segmented"` da a la fila la forma de un `UIRadioGroup` segmentado, para filtros en la URL y sin indicador, así que varias filas conviven en una página. `badge` añade un contador junto al texto, y el evento `select` recibe el clic y la pestaña: con `event.preventDefault()`, la página filtra sin navegar.
- **`UITableOfContents`** pinta la entrada activa con `scroll-target-group`, sin script, donde existe. Un `IntersectionObserver` mínimo mantiene `aria-current="location"` en todos los navegadores, y es lo que se pinta donde no existe esa propiedad. `active` entrega el control a la aplicación. Usa `variant="aside"` en la columna y `variant="collapsible"` en el contenido: `UIPage` muestra cada uno sólo cuando corresponde.
- **`UILocaleSwitcher` y `UILocaleSuggestion`** son presentación: reciben los destinos ya calculados y no leen rutas ni cookies. Con menos de dos idiomas, el selector no pinta nada. La sugerencia va escrita en el idioma que ofrece y el botón `stay`, en el actual; la aplicación decide cuándo mostrarla, tras montar, y qué guarda.
- **`UICodeBlock`** recibe en `html` un `<pre>` ya resaltado (Shiki con `--shiki-light` y `--shiki-dark`) y en `code` lo que se copia. El botón de copiar es el único script y queda oculto hasta hidratar. `mode="log"` usa `role="log"`, parte las líneas y no muestra el botón salvo con `copy`.
- **`UIProse`** viste Markdown renderizado. La clase `meeko-ui-prose` también sirve en cualquier elemento, y dentro de ella se visten `.heading-anchor`, `.table-wrap`, `.callout`, `.code-block` y `.shiki`, las clases de un snapshot. El componente atiende los botones `button[data-copy]` de ese HTML. Un componente de UI dentro del texto conserva su aspecto: los estilos de lectura terminan en él (`@scope`).
- **Hojas sueltas.** `@meekojs/ui/styles/prose.css` y `@meekojs/ui/styles/code.css` son esas mismas reglas como archivos, para un documento que no recibe las de la página, como un `<iframe sandbox srcdoc>`. Leen `var(--ui-*)`: ese documento tiene que declarar sus valores.
- **`UIDiff`** recibe un diff unificado y marca cada línea con `data-kind` (`add`, `remove`, `hunk`, `file`, `context`) y un texto para lectores de pantalla.

### Paneles propios y el canal de la barra

La base reserva el canal de la barra de desplazamiento con `scrollbar-gutter: stable`, así que la página no se mueve al cambiar de largo. En esa franja Chromium sólo pinta el color de fondo de `<html>`: un panel `position: fixed`, un `<dialog>` modal y su `::backdrop` se recortan antes de ella aunque se extiendan con un `inset` negativo, y `100vw` ya la descuenta. Por eso el módulo mide su ancho y lo escribe en `<html>` como `--ui-scrollbar-gutter` (`0px` sin barra, con barras superpuestas, en el servidor o sin JavaScript), y lo actualiza al redimensionar, al cambiar el zoom y al aparecer o desaparecer la barra. `data-meeko-ui-scrollbar-gutter` dice en qué lado está (`right`, o `left` en un navegador que la pasa a la izquierda en una página de derecha a izquierda).

Al bloquear el desplazamiento, `UIDrawer` y `useScrollLock()` devuelven el canal a la ventana y dan a `<html>` ese ancho como relleno en su lado: la página no se mueve, y el panel y el fondo llegan hasta el borde de la ventana. Mientras dura el bloqueo, la variable conserva el ancho de antes. Sin el ancho medido, como antes de hidratar, el canal sigue reservado y `UIDrawer`, `UIModal` y `UICommandPalette` dan a `<html>` el color de lo que lo toca. `UIModal` y `UICommandPalette` no bloquean la página: su barra sigue ahí y lleva ese color.

Un panel propio sólo necesita `useScrollLock()` mientras está abierto: con `right: 0` o `inset-inline-end: 0` cubre la franja.

```html
<script lang="ts">
	import { useScrollLock } from '@meekojs/ui/runtime'

	const open = defineModel<boolean>({ default: false })
	const snippets = defineSnippets<{ default: [] }>()
	useScrollLock(() => open.value)
</script>

<template>
	<aside
		if:when="open.value"
		class="sheet"
	>
		<render snippet="snippets.default" />
	</aside>
</template>

<style scoped>
	.sheet {
		position: fixed;
		inset-block: 0;
		inset-inline-end: 0;
		inline-size: min(24rem, 100%);
		background: var(--ui-color-surface-raised);
	}
</style>
```

Un elemento fijo que no deba moverse durante el bloqueo, como una barra con `right: 0` y contenido alineado al final, puede apartar ese contenido con `padding-inline-end: var(--ui-scrollbar-gutter)` mientras el panel está abierto. Fuera de un bloqueo, el canal sigue reservado y la ventana de un elemento fijo ya lo descuenta: no le sumes la variable.

## Plataforma y View Transitions

`UIModal`, `UIDrawer`, `UIPopover`, `UITabs`, `UIThemeToggle` y `UISelect` usan `<dialog>`, `popover`, anclaje CSS, `appearance: base-select`, `@starting-style` y View Transitions. Los navegadores antiguos funcionan sin animación y con el `<select>` más básico, igual que Firefox, que aún muestra su lista nativa. Lo que la plataforma no cubre está en `UICombobox`, sobre `UIPopover`.

Para tus propias transiciones, usa `withViewTransition()`:

```ts
import { withViewTransition } from '@meekojs/ui/runtime'

withViewTransition(() => (section.value = 'team'), { types: ['app-section'] })
```

Por encima de 4.000 elementos en el documento, antes o después del cambio, ni estos componentes ni `withViewTransition()` animan: el cambio se aplica sin transición, porque en una página así, con una pantalla de alta densidad o en un teléfono, cada frame bloquea la página durante segundos.

Las reglas y los nombres reservados están en [`DESIGN.md`](../packages/ui/DESIGN.md#movimiento).

## Pestañas, tooltips y paleta

```html
<UITabs
	model="tab"
	label="Ajustes"
	bind:items="[{ value: 'account', label: 'Cuenta' }, { value: 'team', label: 'Equipo' }]"
>
	<snippet name="panel-account">Tu cuenta</snippet>
	<snippet name="panel-team">Tu equipo</snippet>
</UITabs>

<UITooltip text="Se publica al guardar"><snippet name="trigger">?</snippet></UITooltip>

<UICommandPalette
	model:query="query"
	bind:results="results.value"
	bind:status="status.value"
	hrefBy="url"
	labelBy="title"
	childrenBy="sections"
	on:open="preload"
/>
```

`UICommandPalette` no busca: lee `query` en tu código, busca donde quieras (Pagefind, un servidor o una lista local) y pásale `results` y `status`.

Para abrirla o cerrarla desde el padre, asigna su `model` o llama a `show()` y `hide()` con una referencia: `<UICommandPalette ref:palette … />` y `palette.value?.show()`.

## Formularios y estados

Los controles nuevos conservan el HTML nativo, el teclado y el envío de formularios. Todos los modelos se enlazan con una señal (`model="field"`), no con `bind:model`.

| Componente          | Contrato                                                                                                                                                                                                                |
| ------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `UITextarea`        | Modelo string; atributos nativos `rows`, `name`, `maxlength`, `required`, `disabled`; `invalid`, `describedBy`.                                                                                                         |
| `UICheckbox`        | Modelo booleano; `label`, `description`, `name`, `value`, `required`, `disabled`, `invalid`, `describedBy`.                                                                                                             |
| `UIRadioGroup`      | Modelo string; `legend`, `options` (`value`, `label`, `disabled`), `name`, `required`, `disabled`; `variant="default"` o `"segmented"`. Flechas y selección nativas.                                                    |
| `UISwitch`          | Modelo booleano y contrato de Checkbox, con `role="switch"`.                                                                                                                                                            |
| `UISlider`          | Modelo numérico; `label`, `name`, `min`, `max`, `step`, `disabled` y atributos nativos.                                                                                                                                 |
| `UIAlert`           | `tone`, `title`, `description`, `icon` (snippet), `dismiss`, `closeLabel`, `role`; snippets `default`, `icon`, `actions`; evento `dismiss`. Danger usa `alert`; los demás, `note`; puede elegirse `status`.             |
| `UIDisclosure`      | `summary`, `open`, `class`; snippet `default`. `<details>` nativo: abre con el teclado y sin JavaScript.                                                                                                                |
| `UIEmpty`           | `title`, `description`, `variant="inline"` o `"panel"`; snippets `default` y `actions`.                                                                                                                                 |
| `UISkeleton`        | `lines`, `widths` (`full`, `long`, `short`), `label`; anuncia carga una vez y respeta movimiento reducido.                                                                                                              |
| `UIStat`            | `label`, `value`, `detail`, con `dl/dt/dd`; los snippets `value` y `detail` admiten marcado, como un enlace. Con `change`, `period`, `trend`, `href` o `to`, una [cifra clave](#uistat-como-cifra-clave-y-uisparkline). |
| `UIDescriptionList` | `items` (`label`, `labelLang`, `value`, `detail`, `code`, `title`), `columns` (1, 2 o 3), una columna en móvil. `code` pinta el valor en `<code>`.                                                                      |
| `UIToast`           | `text`, `tone`, `duration`, `closeLabel`, `actions` (snippet o prop); evento `dismiss`. Popover nativo manual, sin tomar el foco.                                                                                       |

`UISegmentedControl` es una selección única compacta con radios nativos, que funciona sin JavaScript: modelo string; `options`, `legend` con `hideLegend` (sólo para lectores de pantalla) o `ariaLabel`, `size="sm"` o `"md"` (la altura de un control de ese tamaño), `name`, `required` y `disabled`. Si las opciones no caben, se desplaza en horizontal sin partirlas ni ensanchar la página. `ui.defaults.segmentedControl` admite `size`, y `ui`, sus slots `base`, `legend`, `options`, `option` e `input`. Para un conmutador compacto, prefiérelo a `UIRadioGroup variant="segmented"`, que se parte en varias líneas.

Los tipos de props, `UIDensity`, `UITone` y `UIToastContext` se exportan desde `@meekojs/ui/runtime`. Los textos predeterminados se configuran en `ui.messages.<locale>.feedback` (`close`, `empty`, `loading`); hay español e inglés.

`UIButton` añade `tone="danger"`, `loading`, `iconOnly` y `ariaLabel`. Al usar sólo un icono, proporciona siempre `ariaLabel` o `aria-label`. `loading` conserva el texto y añade el spinner; anuncia `aria-busy` y `aria-disabled`, e impide activar la acción sin quitarle el foco. Con `iconOnly`, el icono mide `--ui-icon-size`. El botón de envío conserva `name`, `value` y `form`.

`UIBadge` añade tonos `info`, `success`, `warning` y `dot`. `UIInput` admite `date`, `datetime-local` y atributos nativos como `autocomplete`, `autocapitalize`, `spellcheck`, `min`, `max` y `step`. `UIField` añade `hint` y `counter` (string o número); los IDs de ambos se incluyen en el `describedBy` que recibe su snippet.

`UICard` y `UITable` aceptan `density="compact" | "normal" | "comfortable"`. Card añade `padding="none" | "sm" | "md" | "lg"`, que gana sobre density. Las columnas de Table admiten `numeric` (alineación al final) y `rowHeader` (`th scope="row"`), también en el layout grid. `hideCaption` oculta el título de una tabla a la vista, cuando un encabezado ya lo dice, y sigue nombrándola.

### UIStat como cifra clave y UISparkline

Con `change`, `period`, `trend`, `href` o `to`, `UIStat` es una cifra clave («KPI»). Sin esas props pinta el mismo marcado y las mismas clases que antes.

```html
<UIStat
	label="Ingresos"
	value="12 400 €"
	bind:change="12.5"
	period="frente a los 30 días anteriores"
	bind:trend="[8.2, 9.1, 8.7, 10.4, 11.2, 10.9, 12.4]"
	to="/ingresos"
/>
<UIStat
	label="Tiempo de respuesta"
	value="180 ms"
	bind:change="-8"
	good="down"
/>
<UIStat
	label="Pedidos"
	bind:value="320"
	change="−8 pedidos"
	period="este mes"
/>
```

- **Variación.** `change` es un número, que se formatea con `Intl.NumberFormat` en el idioma del documento y con signo: con `changeFormat="percent"` (por defecto) `12.5` es «+12,5 %»; con `"number"`, el número tal cual. También puede ser un texto ya formateado: se pinta tal cual, y su signo inicial da la dirección (`-` o `−` baja; `+` o cualquier cifra distinta de cero sube; si no, no cambia). `changeDirection` (`up`, `down` o `flat`) gana sobre el signo. Un número que se redondea a cero no cambia.
- **Tono.** `good` dice qué dirección es buena: `up` por defecto, `down` para un tiempo de respuesta o una tasa de error. La dirección buena tiene el tono de éxito, la otra el de peligro y una variación nula es neutra. La flecha (↑, ↓ o →) es un icono decorativo; la cifra con signo se oculta a los lectores de pantalla, que leen en su lugar «Sube 12,5 %», «Baja 3 %» o «Sin cambios» (mensajes `stat.up`, `stat.down` y `stat.flat`, con `{change}` sin signo). El tono no se anuncia: la etiqueta ya dice qué se mide.
- **Periodo.** `period` va tras la variación, en texto suave: «frente a los 30 días anteriores».
- **Tendencia.** `trend` dibuja un `UISparkline` con área junto al valor, del tono de la variación (sin ella, el de acento). Su nombre accesible resume la serie; `trendLabel` lo sustituye.
- **Enlace.** `href` (cualquier URL) o `to` (una ruta con `params`, `search` y `resolve`, con `<MeekoLink>`), con `target` y `rel`, pintan un enlace propio, «Ver detalle» (mensaje `stat.link`) o `linkLabel`. Con el texto por defecto, su nombre accesible añade la etiqueta del dato (`stat.linkName`: «Ver detalle: Ingresos»), porque una página con varias cifras tendría varios «Ver detalle» iguales en la lista de enlaces; un `linkLabel` es el nombre tal cual. No es toda la tarjeta: su nombre sería todo su contenido, los snippets `value` y `detail` no podrían llevar enlaces propios y el texto dejaría de seleccionarse.
- **Modo compacto.** La `<dl>` de una cifra clave es un contenedor (`container-type: inline-size`): por debajo del tamaño de contenedor `stat-narrow` del tema (`--container-stat-narrow`, 20rem) el sparkline deja la columna junto al valor y baja bajo la variación, a todo el ancho, y el valor pasa de `2xl` a `xl`. Sigue el ancho de la cifra, no el de la ventana, y es CSS puro: sin saltos al hidratar. Como un contenedor no aporta el ancho de su contenido, la cifra toma `--ui-stat-intrinsic-width` (12rem) donde nada le da ancho, como una fila flex sin `flex-basis`; en un grid o un bloque ocupa su espacio. El ancho del sparkline junto al valor es `--ui-stat-trend-width` (7rem).
- **Slots.** `ui` admite, además de `base`, `label`, `value` y `detail`, `change` (el `<dd>` de la variación), `delta` (flecha y cifra), `icon`, `period`, `trend` (el `<dd>` del sparkline), `action` (el `<dd>` del enlace) y `link`. `tone`, `direction`, `kpi` y `chart` no son props: el componente los decide.

`UISparkline` dibuja una serie (`values`) como línea, con `area` opcional, en un `<svg>` sin dependencias. Ocupa el ancho de su contenedor y la altura de `--ui-sparkline-height` (2rem) con un `viewBox` de 100 por 32 y `preserveAspectRatio="none"`; el trazo no se deforma (`vector-effect: non-scaling-stroke`, de `--ui-sparkline-stroke-width`). El tamaño no depende de JavaScript, así que el SSR no salta. Es `role="img"` y su `aria-label` resume la serie con el formato del idioma: «Tendencia: mínimo 8,2, máximo 12,4, último 12,4» (mensaje `sparkline.label`, o `sparkline.empty` sin valores); `label` lo sustituye y `format` (opciones de `Intl.NumberFormat`) da formato a esos números. `tone` (`neutral`, `accent`, `info`, `success`, `warning` o `danger`) colorea la línea; sin él, `currentColor`. `min` y `max` fijan el eje vertical, como `bind:min="0"`. Los valores que no son números finitos se omiten. Al aparecer, la serie se descubre de izquierda a derecha una vez, salvo con `prefers-reduced-motion`. Es un `<svg>` con `display: block`: dentro de una frase, dale tu propio ancho y `display: inline-block`.

```html
<UISparkline
	bind:values="visits"
	area
	tone="accent"
	bind:min="0"
/>
```

- **Defaults.** `ui.defaults.stat` admite los slots nuevos, y `ui.defaults.sparkline`, `class` y los slots `base`, `area` y `line`; el sparkline de `UIStat trend` también los recibe.
- **Ayuda junto a la etiqueta.** `hint` pinta un `UIHint` (ⓘ) tras la etiqueta, con su clase extra en `ui.hint`: `<UIStat label="Ingresos" hint="Ventas cobradas, sin impuestos" … />`. El snippet `label` sustituye el texto de la etiqueta en pantalla; `label` sigue nombrando el enlace y el sparkline.
- **Tipos.** `UISparklineProps`, `UISparklineTone` y `UIStatDirection` se importan desde `@meekojs/ui/runtime`, como `UIStatProps`.

### Notificaciones desde una página

El módulo instala un proveedor por aplicación; `<UIApp>` aloja las notificaciones. Llámalo durante el setup y añade avisos desde una acción del cliente. No se pueden añadir durante SSR. No hay estado compartido entre peticiones.

```html
<script lang="ts">
	import { useToast } from '@meekojs/ui/runtime'
	const toast = useToast()
</script>
<template>
	<UIButton on:click="() => toast.add({ text: 'Cambios guardados', tone: 'success', duration: 5000 })">Guardar</UIButton>
</template>
```

`useToast` se autoimporta como `useModal`. `add` devuelve un ID para `remove(id)`; `clear()` cierra todos. `duration: 0` conserva el aviso hasta cerrarlo. La cuenta se pausa con el cursor o el foco dentro del aviso; los temporizadores se liberan al desmontar. El host apila avisos sin solaparlos y desaparecen al desmontar UIApp. También puede usarse `UIToast` declarativamente con el snippet `actions`.

Entra con `@starting-style` y sale con una View Transition de tipo `ui-toast-close`. Si se añade con un `UIModal` o un `UIDrawer` abierto, el host vuelve a la cima de la capa superior para que se vea, pero sigue inerte como el resto de la página: no recibe clics hasta cerrar el modal, y un aviso con `duration` se cierra solo.
