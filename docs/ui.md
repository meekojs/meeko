# Meeko UI

## Empezar en una aplicación

Instala los paquetes publicados en una aplicación Meeko con Node.js 24 o superior:

```sh
pnpm add @meekojs/meeko @meekojs/ui tailwindcss
```

Activa el módulo en `meeko.config.ts`:

```ts
import { defineMeekoConfig } from '@meekojs/meeko/framework'

export default defineMeekoConfig({
	modules: ['@meekojs/ui'],
	theme: true,
})
```

Importa Tailwind y la entrada CSS de UI al principio de **`app/styles/main.css`**, la hoja global que Meeko carga sola:

```css
@import 'tailwindcss';
@import '@meekojs/ui';
```

La aplicación compila con Tailwind 4 los estilos de UI junto con sus propias clases, en una sola pasada. El módulo registra `@tailwindcss/vite`, salvo que la aplicación ya lo registre, y la entrada trae los tokens, el tema y los `@source` de los componentes de UI. Ese tema se suma al de Tailwind por defecto: los colores semánticos llegan con sus doce pasos (`bg-surface`, `text-text-soft`, `bg-primary-9`, `text-danger-11`…), los breakpoints `phone`, `compact`, `tablet`, `sidebar` y `desktop` se añaden a los de Tailwind, y la aplicación conserva sus colores (`bg-red-500`…), sus breakpoints (`md:`…) y el resto de nombres. Pero UI redefine algunos valores del tema de Tailwind para que lean los tokens `--ui-*`, y con ellos cambian también las clases de la aplicación que los usan: `--spacing` (la rejilla de `p-4`, `gap-2`…, sobre `--ui-space-1`), `--font-sans` y `--font-mono`, los tamaños `--text-xs` a `--text-6xl` (con `--text-base` igual a `--text-md`), los interlineados `--leading-none`, `-tight`, `-snug`, `-normal` y `-relaxed`, los pesos `--font-weight-thin` a `--font-weight-black` (`normal` es `regular`), `--tracking-normal` y `--tracking-tight`, los radios `--radius-xs` a `--radius-3xl`, las sombras `--shadow-xs` a `--shadow-2xl`, `--blur-md`, las curvas `--ease-in`, `--ease-out` y `--ease-in-out`, los contenedores `--container-sm` a `--container-3xl` (`max-w-xl`…) y `--animate-spin`. Además deja sin valor (`initial`) el interlineado de cada tamaño (`--text-*--line-height`: `text-sm` fija sólo el tamaño, y el interlineado va con `leading-*`), la duración y la curva por defecto de `transition-*` (UI las da con `duration-*` y `ease-*`) y las fuentes por defecto del preflight (`--default-font-family`, `--default-mono-font-family` y sus ajustes; la base de UI fija la de la página). Añade los tuyos con un `@theme` después de los dos imports. `@import '@meekojs/ui/hues';`, opcional y tras ellos, trae también las escalas de Radix Colors (`bg-crimson-9`…) y genera las clases de las combinaciones de tonos crudos. Sin esta hoja, `meeko dev` avisa de que los componentes no tendrán estilos; el aviso sigue también los `@import` locales de la hoja (`@import './ui.css'`, si es ella la que importa UI).

**A tener en cuenta: el preflight de Tailwind.** `@import 'tailwindcss'` incluye el preflight, el reset de Tailwind: quita los márgenes de todos los elementos, las viñetas de las listas y el tamaño y el peso de los encabezados (`h1`…`h6`), y hace bloque las imágenes. Los componentes de UI no dependen de él, pero una aplicación que antes no usaba Tailwind cambia de aspecto con él. Para conservar el de antes, importa sólo el tema y las utilidades de Tailwind, en las capas de su propia entrada, como indica [la documentación de Tailwind](https://tailwindcss.com/docs/preflight#disabling-preflight):

```css
@layer theme, base, components, utilities;
@import 'tailwindcss/theme.css' layer(theme);
@import 'tailwindcss/utilities.css' layer(utilities);
@import '@meekojs/ui';
```

La base de UI sigue en su sitio (`ui: { base: false }` la quita), y `ui.tokens`, el aviso de `meeko dev` y `@meekojs/ui/hues` funcionan igual con las dos formas. Las webs de este repositorio usan la segunda.

Después, **archivo `app/pages/index.meeko`** en una aplicación nueva:

```meeko
<script server lang="ts">
export const route = definePage({ render: "prerender" });
</script>

<template>
  <h1>Contacto</h1>
  <UIBadge tone="success">Disponible</UIBadge>
  <UIButton type="button">Guardar</UIButton>
</template>
```

Verás el título, un badge y un botón con los estilos de UI. `UIButton` usa `<MeekoLink>` con `to`, un `<a>` con `href` y un `<button>` sin destino. `UILink` también acepta `to` o `href`, siempre como enlace. `UISelect` es nativo; usa `UICombobox` para búsqueda o selección múltiple. La [referencia de UI](ui-api.md) detalla las props.

El módulo `@meekojs/ui` pertenece al ecosistema Meeko y tiene versión propia.

## Container

`UIContainer` centra contenido con tamaños desde `sm` hasta `4k` (240rem, 3840px CSS con raíz de 16px), además de `full`. Sus gutters fluidos admiten RTL y `as` permite elegir la etiqueta semántica. El ancho por defecto es `xl`; puedes combinar superficies amplias con contenedores menores para lectura. Consulta la [API de Container](ui-api.md#container) y la guía interactiva `/container` en la web de UI.

## Componentes por categoría

- **Estructura:** `UIContainer`, `UIPage`, `UIPageHeader`, `UIHeader` y `UIFooter`.
- **Acciones:** `UIButton`, `UIIconButton`, `UICopyButton`, `UILink`, `UILinkCard`, `UIBadge` y `UIThemeToggle`.
- **Formularios:** `UIField`, `UIInput`, `UITextarea`, `UICheckbox`, `UIRadioGroup`, `UISwitch`, `UISlider`, `UISelect` y `UICombobox`. `UIMarkdownEditor`, en su propio módulo `@meekojs/ui/editor`.
- **Navegación:** `UINavigationTree`, `UINavigationTabs`, `UITabs`, `UIBreadcrumb`, `UIPageNavigation`, `UIPagination`, `UITableOfContents`, `UILocaleSwitcher` y `UILocaleSuggestion`.
- **Datos y contenido:** `UICard`, `UITable`, `UIStat`, `UIAvatar`, `UIDescriptionList`, `UIDisclosure`, `UIDiff`, `UICodeBlock` y `UIProse`.
- **Avisos:** `UIAlert`, `UIToast`, `UIEmpty` y `UISkeleton`.
- **Superposiciones:** `UIModal`, `UIDrawer`, `UIPopover`, `UITooltip`, `UICommandPalette` y el host `UIApp`.
- **Elementos nativos:** la base da estilo con tokens a `<progress>`, `<meter>` e `<input type="file">`, y la hoja pinta una barra de progreso arriba mientras el router navega (`data-navigating` en `<html>`). Véase [Progreso, medidor y archivos nativos](ui-api.md#progreso-medidor-y-archivos-nativos) y [Barra de progreso de navegación](ui-api.md#barra-de-progreso-de-navegación).

`UILink` comparte con `UIButton` el tratamiento (`variant`: `solid`, `soft`, `surface`, `outline`, `subtle`, `ghost` o `link`), el color semántico (`color`: `primary`, `secondary`, `neutral`, `success`, `info`, `warning` o `danger`), los tamaños `xs` a `xl` y el radio (`radius`, de `none` a `full`). Requiere `to` o `href`; no simula un botón. `UILinkCard` requiere `to` o `href`, y `title`, con descripción y contenido opcionales. `UIBadge` tiene tonos `neutral`, `info`, `success`, `warning` y `danger`, y `dot`, sin añadir interacción o anuncios. `UIAvatar` pinta la foto de una persona o sus iniciales, en tres tamaños y dos formas (véase [UIAvatar](ui-api.md#uiavatar)). `UIInput type="password" reveal` añade un botón que muestra u oculta la contraseña.

Registra todos estos componentes, salvo `UIMarkdownEditor`, la base global (`ui: { base: false }` la omite) y la fuente Inter. El resto de su CSS es la entrada `@import '@meekojs/ui'`, que `app/styles/main.css` compila con Tailwind 4 a través de Vite y la configuración PostCSS del proyecto, con HMR en desarrollo y nombres de assets con hash en producción. Las capas siguen el orden de Tailwind: el preflight (`base`), si la hoja lo importa, queda bajo la base de UI y los componentes, así que no borra sus bordes ni sus fondos; las reglas escritas a mano de UI van en `components`, y sus utilidades, junto con las de la aplicación, en `utilities`. `ui.tokens` se inserta tras los imports de esa hoja, antes de sus reglas, también cuando llega a UI a través de una hoja local suya (`@import './ui.css'`, hasta ocho niveles). La aplicación puede sobrescribir los estilos en esa misma hoja: cualquier regla sin capa gana a la de un componente, y `class` y la prop `ui` le dan clases propias a cada parte, que se fusionan con Tailwind Merge y sustituyen a las de la receta en conflicto (véase [Clases por slot](ui-api.md#clases-por-slot)). Desde core 1.8, `MeekoSelect`, `MeekoPopover` y `MeekoThemeToggle` están obsoletos (`MEEK121`, retirada en 2.0): UI 1.9 registra `UISelect`, `UICombobox`, `UIPopover` y `UIThemeToggle`. `UISelect` es un `<select>` nativo; para buscar o elegir varias opciones, `UICombobox`. `useTheme`, `useThemeToggle`, la configuración del tema y `POST /_meeko/theme` permanecen en el framework. UI 1.9 necesita Meeko `>=1.8 <2`. Véase [Migración a 1.8](migration-1.8.md).

```html
<script lang="ts">
	const name = signal('')
</script>

<template>
	<UIField
		id="name"
		label="Nombre"
		description="Como aparecerá en tu perfil."
	>
		<snippet
			name="default"
			params="id, describedBy"
		>
			<UIInput
				bind:id="id"
				bind:describedBy="describedBy"
				model="name"
			/>
		</snippet>
	</UIField>
	<UIButton on:click="() => console.log(name.value)">Guardar</UIButton>
</template>
```

`UIButton` admite `type`, `disabled`, `class`, `variant` (`solid`, `soft`, `surface`, `outline`, `subtle`, `ghost` o `link`), `color` (`primary`, `secondary`, `neutral`, `success`, `info`, `warning` o `danger`), `size`, `radius` y el evento `click`; su tipo por defecto es `button` y su aspecto, `solid` y `primary`. `UIInput` comparte un modelo de texto y admite `id`, `name`, `type`, `placeholder`, `required`, `disabled`, `invalid`, `describedBy` y `class`. `UIField` exige `id` y `label`, admite `description`, `error`, `required` y `class`, y entrega el ID del control y su descripción al snippet. El control debe recibir también `invalid` cuando tenga un error y `required` si es obligatorio.

Personaliza los tokens `--ui-*` desde el CSS de la aplicación: `--ui-color-primary-9`, `--ui-radius-md`, `--ui-font-sans`… El [contrato visual](../packages/ui/DESIGN.md) dice qué token usar para cada cosa. El tema oscuro usa `data-theme="dark"` y los tokens cambian solos. La base global (`ui: { base: false }` la omite) pone el reset, el `body`, la escala fluida y el foco; la aplicación define su disposición.

## Textos e idiomas

Con `@meekojs/i18n` activo no hay que configurar nada: `UIModal`, `UITable`, `UISelect` y `UIThemeToggle` siguen `useI18n().locale`. UI no depende de ese paquete: lee su contexto si existe. Las opciones `ui.locale` y `ui.messages` son opcionales:

```ts
// meeko.config.ts
ui: {
	// Sin i18n: el idioma de los textos ('es' por defecto). Con i18n: el respaldo de un idioma sin textos.
	locale: 'en',
	// Sobrescribe textos del paquete o añade idiomas; todo es opcional dentro de cada idioma.
	messages: {
		en: { table: { empty: 'Nothing here yet.' } },
		fr: { modal: { close: 'Fermer' }, themeToggle: { group: 'Thème', cycle: 'Thème : {current}. Passer à {next}' } },
	},
}
```

- **Idioma elegido:** `useI18n().locale`, después `ui.locale` y después `es`. Lo que falta en un idioma se completa con su idioma base (`pt` para `pt-BR`), `ui.locale` y español.
- **Prioridad:** la prop o el snippet del componente, después `ui.messages` y después los textos del paquete.
- **Textos disponibles:** `modal.close`, `table.empty`, `select.empty`, `select.clear` y `themeToggle` (`labels`, `unknown`, `group` y `cycle`, con `{current}` y `{next}`). Un idioma, sección o texto desconocidos, un valor vacío o una función detienen la carga con un error `ui:`.
- **Tipos:** `UIMessages` y `UIMessageOverrides`, exportados de `@meekojs/ui`. Sin `locale` ni `messages` no se instala ningún plugin.

`UILinkCard` acepta `to` como `UILink`, con localización automática, `hreflang`, `resolve`, navegación de cliente y rutas tipadas:

```html
<UILinkCard
	to="/theming"
	title="Temas"
	description="Variables y modo oscuro"
/>
<UILinkCard
	to="/users/[id]"
	bind:params="{ id }"
	title="Perfil"
/>
<UILinkCard
	href="https://example.com"
	target="_blank"
	title="Externo"
/>
```

## Adaptar UI a una marca existente

El módulo declara `configKey: 'ui'` y exporta `UIOptions`, `UITokens` y `UIDefaults` desde `@meekojs/ui`. Se registra por su nombre y la clave `ui` tiene tipado sin importar nada (Meeko carga sus tipos en `.meeko/types/config.d.ts`; véase [Módulos](framework.md#módulos)):

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
			text: 'var(--ink)',
			font: 'var(--font-ui)',
		},
		defaults: { link: { radius: 'full' }, button: { radius: 'full' } },
	},
})
```

Define esas variables en los estilos de tu aplicación. Las referencias CSS siguen sus temas claro/oscuro sin copiar la paleta. `primary` permite que las acciones tengan un color distinto de `accent`; si no se configura, sigue usando el acento. La precedencia es props explícitas, defaults del módulo y valores de base. Los defaults se proporcionan por aplicación y petición SSR. Los tokens se procesan en la hoja de UI mediante Vite/PostCSS, sin generar estilos inline ni escribir en `node_modules`. Consulta la [lista completa de opciones](ui-api.md#opciones-tipadas-y-marca-existente).

Las webs `apps/meeko`, `apps/ui`, `apps/i18n` y `apps/dashboard` usan estos componentes y tokens, sin diseño propio: mismos colores, tamaños y fuentes. Sólo pueden diferir en imágenes y efectos.

Para modales, monta `<UIApp><MeekoOutlet /></UIApp>` en `app/app.meeko`. `useModal().open<R>(nombre, props)` carga un componente `Modal…` y devuelve su resultado o `undefined` al cancelar. El componente utiliza `UIModal` y `useModalInstance<R>().close(resultado)` o `.dismiss()`. Nombres y props se comprueban contra el registro generado; `R` es el contrato declarado por el consumidor. Para una simple confirmación no hace falta un componente: `await useModal().confirm({ title, description, tone: 'danger' })` devuelve `true` o `false`. También puedes controlar `UIModal` directamente con un modelo booleano. Consulta la [API de modales](ui-api.md#modales).

`UITable` genera las filas a partir de `rows`, `columns` y `rowKey` obligatorios. El genérico se infiere desde las filas; `TableColumn<T>`, importado desde `@meekojs/ui/runtime`, comprueba las claves y los formateadores de cada columna. Admite pies por columna, estado vacío, snippets opcionales para el contenido de las celdas y `layout="native|grid"` (nativo por defecto), con desplazamiento horizontal. Consulta la [API de tablas](ui-api.md#tablas).

`UICard` combina un tratamiento (`surface`, `outline`, `soft`, `subtle`, `solid`, `glass` o `plain`) con un color semántico, un radio y una sombra, la receta `cardTheme` de `@meekojs/ui/theme`, con título y descripción por props, y snippets de cabecera, cuerpo y pie. Consulta la [API de cards](ui-api.md#cards).

La web pública de Meeko UI se publica en <https://ui.meekojs.com> y vive en `apps/ui`. Incluye instalación, temas, catálogo por categorías y, en español e inglés, una guía con demo, API y código copiable para cada componente: `/forms`, `/controls`, `/select` (también `UICombobox`), `/editor`, `/cards`, `/tables`, `/content`, `/feedback`, `/page`, `/navigation`, `/modals`, `/popover`, `/overlays`, `/container`, `/buttons`, `/links`, `/badges`, `/icons`, `/theme-toggle`, `/app` y `/transitions`. Desde la raíz, ejecuta `pnpm dev:ui`; para generar el sitio de producción usa `pnpm build --filter=meeko-ui-site`. No requiere una base de datos.

Las fuentes de UI están en `src/app/components` y `src/app/styles`. Sus componentes y declaraciones se incluyen en `dist/app/components` al construir `@meekojs/ui`. `src/app/styles/main.css` es la entrada CSS que exporta el paquete (condición `style` de `exports`): sus `@source` apuntan a los componentes, variantes y recetas de `src/` y de `dist/`, de modo que sirve en el workspace y publicada, y el paquete no compila ninguna hoja. El plugin de integración vive en `src/app/plugins/modal.ts`: el módulo registra su archivo compilado y conecta un alias privado con el registro de componentes del consumidor. UI no genera código de plugin en el proyecto ni escribe dentro de la instalación de Meeko.
