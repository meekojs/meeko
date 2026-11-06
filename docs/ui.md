# Meeko UI

## Empezar en una aplicación

Instala los paquetes publicados en una aplicación Meeko con Node.js 24 o superior:

```sh
pnpm add @meekojs/meeko @meekojs/ui
```

Activa el módulo en `meeko.config.ts`:

```ts
import { defineMeekoConfig } from '@meekojs/meeko/framework'

export default defineMeekoConfig({
	modules: ['@meekojs/ui'],
	theme: true,
})
```

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
- **Acciones:** `UIButton`, `UILink`, `UILinkCard`, `UIBadge` y `UIThemeToggle`.
- **Formularios:** `UIField`, `UIInput`, `UITextarea`, `UICheckbox`, `UIRadioGroup`, `UISwitch`, `UISlider`, `UISelect` y `UICombobox`. `UIMarkdownEditor`, en su propio módulo `@meekojs/ui/editor`.
- **Navegación:** `UINavigationTree`, `UINavigationTabs`, `UITabs`, `UIBreadcrumb`, `UIPageNavigation`, `UIPagination`, `UITableOfContents`, `UILocaleSwitcher` y `UILocaleSuggestion`.
- **Datos y contenido:** `UICard`, `UITable`, `UIStat`, `UIDescriptionList`, `UIDisclosure`, `UIDiff`, `UICodeBlock` y `UIProse`.
- **Avisos:** `UIAlert`, `UIToast`, `UIEmpty` y `UISkeleton`.
- **Superposiciones:** `UIModal`, `UIDrawer`, `UIPopover`, `UITooltip`, `UICommandPalette` y el host `UIApp`.

`UILink` comparte las variantes `primary`, `secondary`, `outline` y `ghost`, los tamaños `sm`, `md`, `lg` y las formas `rounded`, `pill` con `UIButton`. Requiere `to` o `href`; no simula un botón. `UILinkCard` requiere `to` o `href`, y `title`, con descripción y contenido opcionales. `UIBadge` tiene tonos `neutral`, `info`, `success`, `warning` y `danger`, y `dot`, sin añadir interacción o anuncios.

Registra todos estos componentes, salvo `UIMarkdownEditor`, y añade su CSS mediante `meeko.addStylesheet`, además de la base global y la fuente Inter. La hoja pasa por Vite y la configuración PostCSS del proyecto, con imports, assets, HMR en desarrollo y nombres de assets con hash en producción. Se carga antes de `app/styles/main.css`, donde la aplicación puede sobrescribir los estilos. Desde core 1.8, `MeekoSelect`, `MeekoPopover` y `MeekoThemeToggle` están obsoletos (`MEEK121`, retirada en 2.0): UI 1.9 registra `UISelect`, `UICombobox`, `UIPopover` y `UIThemeToggle`. `UISelect` es un `<select>` nativo; para buscar o elegir varias opciones, `UICombobox`. `useTheme`, `useThemeToggle`, la configuración del tema y `POST /_meeko/theme` permanecen en el framework. UI 1.9 necesita Meeko `>=1.8 <2`. Véase [Migración a 1.8](migration-1.8.md).

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

`UIButton` admite `type`, `disabled`, `class`, `variant="primary|secondary|outline|ghost"` y el evento `click`; su tipo por defecto es `button`. `UIInput` comparte un modelo de texto y admite `id`, `name`, `type`, `placeholder`, `required`, `disabled`, `invalid`, `describedBy` y `class`. `UIField` exige `id` y `label`, admite `description`, `error`, `required` y `class`, y entrega el ID del control y su descripción al snippet. El control debe recibir también `invalid` cuando tenga un error y `required` si es obligatorio.

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
		defaults: { link: { shape: 'pill' }, button: { shape: 'pill' } },
	},
})
```

Define esas variables en los estilos de tu aplicación. Las referencias CSS siguen sus temas claro/oscuro sin copiar la paleta. `primary` permite que las acciones tengan un color distinto de `accent`; si no se configura, sigue usando el acento. La precedencia es props explícitas, defaults del módulo y valores de base. Los defaults se proporcionan por aplicación y petición SSR. Los tokens se procesan en la hoja de UI mediante Vite/PostCSS, sin generar estilos inline ni escribir en `node_modules`. Consulta la [lista completa de opciones](ui-api.md#opciones-tipadas-y-marca-existente).

Las webs `apps/meeko`, `apps/ui`, `apps/i18n` y `apps/dashboard` usan estos componentes y tokens, sin diseño propio: mismos colores, tamaños y fuentes. Sólo pueden diferir en imágenes y efectos.

Para modales, monta `<UIApp><MeekoOutlet /></UIApp>` en `app/app.meeko`. `useModal().open<R>(nombre, props)` carga un componente `Modal…` y devuelve su resultado o `undefined` al cancelar. El componente utiliza `UIModal` y `useModalInstance<R>().close(resultado)` o `.dismiss()`. Nombres y props se comprueban contra el registro generado; `R` es el contrato declarado por el consumidor. También puedes controlar `UIModal` directamente con un modelo booleano. Consulta la [API de modales](ui-api.md#modales).

`UITable` genera las filas a partir de `rows`, `columns` y `rowKey` obligatorios. El genérico se infiere desde las filas; `TableColumn<T>`, importado desde `@meekojs/ui/runtime`, comprueba las claves y los formateadores de cada columna. Admite pies por columna, estado vacío, snippets opcionales para el contenido de las celdas y `layout="native|grid"` (nativo por defecto), con desplazamiento horizontal. Consulta la [API de tablas](ui-api.md#tablas).

`UICard` ofrece las variantes `outline`, `soft`, `solid` y `elevated`, con título y descripción por props, y snippets de cabecera, cuerpo y pie. Consulta la [API de cards](ui-api.md#cards).

La web pública de Meeko UI se publica en <https://ui.meekojs.com> y vive en `apps/ui`. Incluye instalación, temas, catálogo por categorías y, en español e inglés, una guía con demo, API y código copiable para cada componente: `/forms`, `/controls`, `/select` (también `UICombobox`), `/editor`, `/cards`, `/tables`, `/content`, `/feedback`, `/page`, `/navigation`, `/modals`, `/popover`, `/overlays`, `/container`, `/buttons`, `/links`, `/badges`, `/icons`, `/theme-toggle`, `/app` y `/transitions`. Desde la raíz, ejecuta `pnpm ui:dev`; para generar el sitio de producción usa `pnpm ui:build`. No requiere una base de datos.

Las fuentes de UI están en `src/app/components` y `src/app/styles`. Sus componentes y declaraciones se incluyen en `dist/app/components` al construir `@meekojs/ui`, y los CSS se distribuyen desde `src/app/styles` para procesarlos con Vite/PostCSS. El plugin de integración vive en `src/app/plugins/modal.ts`: el módulo registra su archivo compilado y conecta un alias privado con el registro de componentes del consumidor. UI no genera código de plugin en el proyecto ni escribe dentro de la instalación de Meeko.
