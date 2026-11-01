# Meeko UI

El módulo `@meekojs/ui` pertenece al ecosistema Meeko y se distribuye como un paquete con versión propia. Su instalación y API se describen en el [README del paquete](../packages/ui/README.md). Actívalo en la configuración:

```ts
import { defineMeekoConfig } from '@meekojs/meeko/framework'

export default defineMeekoConfig({
	modules: ['@meekojs/ui'],
	theme: true,
})
```

## Container

`UIContainer` centra contenido con tamaños desde `sm` hasta `4k` (240rem, 3840px CSS con raíz de 16px), además de `full`. Sus gutters fluidos admiten RTL y `as` permite elegir la etiqueta semántica. El ancho por defecto es `xl`; puedes combinar superficies amplias con contenedores menores para lectura. Consulta la [API de Container](../packages/ui/README.md#container) y la guía interactiva `/container` en la web de UI.

## Componentes por categoría

- **Estructura:** `UIContainer`, con anchos fluidos hasta 4K.
- **Controles:** `UIButton`, `UIInput`, `UIField`.
- **Navegación:** `UILink` para acciones con semántica de enlace y `UILinkCard` para tarjetas de navegación.
- **Datos y metadatos:** `UITable` y `UIBadge`.
- **Superficies y modales:** `UICard`, `UIModal` y el host `UIApp`.

`UILink` comparte las variantes `primary`, `secondary`, `outline` y `ghost`, los tamaños `sm`, `md`, `lg` y las formas `rounded`, `pill` con `UIButton`. Requiere `href`; no simula un botón. `UILinkCard` requiere `to` o `href`, y `title`, con descripción y contenido opcionales. `UIBadge` tiene tonos `neutral`, `accent` y `danger`, sin añadir interacción o anuncios.

Registra `UIContainer`, `UIApp`, `UIModal`, `UITable`, `UICard`, `UIButton`, `UIInput`, `UIField` y, desde UI 0.2, `UIPopover`, `UISelect` y `UIThemeToggle`, y añade su CSS mediante `meeko.addStylesheet`. La hoja pasa por Vite y la configuración PostCSS del proyecto, con imports, assets, HMR en desarrollo y nombres de assets con hash en producción. Se carga antes de `app/styles/main.css`, donde la aplicación puede sobrescribir los estilos. Desde core 1.8, `MeekoSelect`, `MeekoPopover` y `MeekoThemeToggle` están obsoletos (`MEEK121`, retirada en 2.0). UI 0.2 registra `UISelect`, `UIPopover` y `UIThemeToggle`, con las mismas props, snippets y atributos `data-meeko-*`. `useTheme`, `useThemeToggle`, la configuración del tema y `POST /_meeko/theme` permanecen en el framework. UI 0.2 necesita Meeko `>=1.8 <2`. Véase [Migración a 1.8](migration-1.8.md).

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

`UIButton` admite `type`, `disabled`, `class`, `variant="primary|secondary"` y el evento `click`; su tipo por defecto es `button`. `UIInput` comparte un modelo de texto y admite `id`, `name`, `type`, `placeholder`, `required`, `disabled`, `invalid`, `describedBy` y `class`. `UIField` exige `id` y `label`, admite `description`, `error`, `required` y `class`, y entrega el ID del control y su descripción al snippet. El control debe recibir también `invalid` cuando tenga un error y `required` si es obligatorio.

Personaliza las variables `--meeko-ui-*` desde el CSS de la aplicación: `accent`, `accent-hover`, `on-accent`, `surface`, `surface-hover`, `text`, `muted`, `border`, `danger`, `focus`, `radius` y `font`. El tema oscuro usa `data-theme="dark"`; los temas propios pueden definir los mismos tokens con su selector. La hoja sólo estiliza controles UI y las tres etiquetas mencionadas; la aplicación define su layout y tipografía general.

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

Define esas variables en los estilos de tu aplicación. Las referencias CSS siguen sus temas claro/oscuro sin copiar la paleta. `primary` permite que las acciones tengan un color distinto de `accent`; si no se configura, sigue usando el acento. La precedencia es props explícitas, defaults del módulo y valores de base. Los defaults se proporcionan por aplicación y petición SSR. Los tokens se procesan en la hoja de UI mediante Vite/PostCSS, sin generar estilos inline ni escribir en `node_modules`. Consulta la [lista completa de opciones](../packages/ui/README.md#opciones-tipadas-y-marca-existente).

La web pública `apps/meeko` consume UI en los enlaces de acción de portada, cabecera y errores, en las tarjetas del índice documental y en los badges de referencia. Su configuración conserva la paleta existente: píldoras neutras, superficies de grises y azul para foco/acento.

Para modales, monta `<UIApp><MeekoOutlet /></UIApp>` en `app/app.meeko`. `useModal().open<R>(nombre, props)` carga un componente `Modal…` y devuelve su resultado o `undefined` al cancelar. El componente utiliza `UIModal` y `useModalInstance<R>().close(resultado)` o `.dismiss()`. Nombres y props se comprueban contra el registro generado; `R` es el contrato declarado por el consumidor. También puedes controlar `UIModal` directamente con un modelo booleano. Consulta la [API de modales](../packages/ui/README.md#modales).

`UITable` genera las filas a partir de `rows`, `columns` y `rowKey` obligatorios. El genérico se infiere desde las filas; `TableColumn<T>`, importado desde `@meekojs/ui/runtime`, comprueba las claves y los formateadores de cada columna. Admite pies por columna, estado vacío, snippets opcionales para el contenido de las celdas y `layout="native|grid"` (nativo por defecto), con desplazamiento horizontal. Consulta la [API de tablas](../packages/ui/README.md#tablas).

`UICard` ofrece las variantes `outline`, `soft`, `solid` y `elevated`, con título y descripción por props, y snippets de cabecera, cuerpo y pie. Consulta la [API de cards](../packages/ui/README.md#cards).

La web pública de Meeko UI se publica en <https://ui.meekojs.com> y vive en `apps/ui`. Incluye instalación, temas, catálogo por categorías y guías con API, código copiable y ejemplos interactivos. Conserva `/modals`, `/tables`, `/cards` y `/transitions`. Desde la raíz, ejecuta `pnpm ui:dev`; para generar el sitio de producción usa `pnpm ui:build`. No requiere una base de datos.

Las fuentes de UI están en `src/app/components` y `src/app/styles`. Sus componentes y declaraciones se incluyen en `dist/app/components` al construir `@meekojs/ui`, y los CSS se distribuyen desde `src/app/styles` para procesarlos con Vite/PostCSS. El plugin de integración vive en `src/app/plugins/modal.ts`: el módulo registra su archivo compilado y conecta un alias privado con el registro de componentes del consumidor. UI no genera código de plugin en el proyecto ni escribe dentro de la instalación de Meeko.
