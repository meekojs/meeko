# Meeko UI

El módulo `@meekojs/ui` pertenece al ecosistema Meeko y se distribuye como un paquete con versión propia. Su instalación y API se describen en el [README del paquete](../packages/ui/README.md). Actívalo en la configuración:

```ts
import { defineMeekoConfig } from '@meekojs/meeko/framework'

export default defineMeekoConfig({
	modules: ['@meekojs/ui'],
	theme: true,
})
```

Registra `UIApp`, `UIModal`, `UITable`, `UICard`, `UIButton`, `UIInput` y `UIField`, y añade su CSS mediante `meeko.addStylesheet`. La hoja pasa por Vite y la configuración PostCSS del proyecto, con imports, assets, HMR en desarrollo y nombres de assets con hash en producción. Se carga antes de `app/styles/main.css`, donde la aplicación puede sobrescribir los estilos. La hoja añade una apariencia a `MeekoSelect`, `MeekoPopover` y `MeekoThemeToggle`, cuyas etiquetas y exports existentes siguen funcionando sin activar UI. Las primitivas sin estilos conservan sus fuentes en `packages/meeko/src/app/components`; `useTheme` y la configuración del tema siguen en el framework.

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

Para modales, monta `<UIApp><MeekoOutlet /></UIApp>` en `app/app.meeko`. `useModal().open<R>(nombre, props)` carga un componente `Modal…` y devuelve su resultado o `undefined` al cancelar. El componente utiliza `UIModal` y `useModalInstance<R>().close(resultado)` o `.dismiss()`. Nombres y props se comprueban contra el registro generado; `R` es el contrato declarado por el consumidor. También puedes controlar `UIModal` directamente con un modelo booleano. Consulta la [API de modales](../packages/ui/README.md#modales).

`UITable` genera las filas a partir de `rows`, `columns` y `rowKey` obligatorios. El genérico se infiere desde las filas; `TableColumn<T>`, importado desde `@meekojs/ui/runtime`, comprueba las claves y los formateadores de cada columna. Admite pies por columna, estado vacío, snippets opcionales para el contenido de las celdas y `layout="native|grid"` (nativo por defecto), con desplazamiento horizontal. Consulta la [API de tablas](../packages/ui/README.md#tablas).

`UICard` ofrece las variantes `outline`, `soft`, `solid` y `elevated`, con título y descripción por props, y snippets de cabecera, cuerpo y pie. Consulta la [API de cards](../packages/ui/README.md#cards).

La app `apps/ui-demo` muestra esta base, los modales en `/modals` las tablas en `/tables` y las cards en `/cards`. Desde la raíz, ejecuta `pnpm -F meeko-ui-demo run dev`. Las fuentes de UI están en `src/app/components` y `src/app/styles`. Sus componentes y declaraciones se incluyen en `dist/app/components` al construir `@meekojs/ui`, y los CSS se distribuyen desde `src/app/styles` para procesarlos con Vite/PostCSS. El plugin de integración vive en `src/app/plugins/modal.ts`: el módulo registra su archivo compilado y conecta un alias privado con el registro de componentes del consumidor. UI no genera código de plugin en el proyecto ni escribe dentro de la instalación de Meeko.
