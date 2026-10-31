# Meeko UI

El módulo `@meekojs/ui` pertenece al mismo paquete y versión que Meeko. Actívalo en la configuración:

```ts
import { defineMeekoConfig } from '@meekojs/meeko/framework'

export default defineMeekoConfig({
  modules: ['@meekojs/ui'],
  theme: true,
})
```

Registra `UiButton`, `UiInput` y `UiField`, y sirve `/_meeko/ui.css`. La hoja añade una apariencia a `MeekoSelect`, `MeekoPopover` y `MeekoThemeToggle`, cuyas etiquetas y exports existentes siguen funcionando sin activar UI. Las primitivas sin estilos conservan sus fuentes en `packages/meeko/src/app/components`; `useTheme` y la configuración del tema siguen en el framework.

```html
<script lang="ts">
const name = signal('')
</script>

<template>
  <UiField id="name" label="Nombre" description="Como aparecerá en tu perfil.">
    <snippet name="default" params="id, describedBy">
      <UiInput bind:id="id" bind:describedBy="describedBy" model="name" />
    </snippet>
  </UiField>
  <UiButton on:click="() => console.log(name.value)">Guardar</UiButton>
</template>
```

`UiButton` admite `type`, `disabled`, `class`, `variant="primary|secondary"` y el evento `click`; su tipo por defecto es `button`. `UiInput` comparte un modelo de texto y admite `id`, `name`, `type`, `placeholder`, `required`, `disabled`, `invalid`, `describedBy` y `class`. `UiField` exige `id` y `label`, admite `description`, `error`, `required` y `class`, y entrega el ID del control y su descripción al snippet. El control debe recibir también `invalid` cuando tenga un error y `required` si es obligatorio.

Personaliza las variables `--meeko-ui-*` desde el CSS de la aplicación: `accent`, `accent-hover`, `on-accent`, `surface`, `surface-hover`, `text`, `muted`, `border`, `danger`, `focus`, `radius` y `font`. El tema oscuro usa `data-theme="dark"`; los temas propios pueden definir los mismos tokens con su selector. La hoja sólo estiliza controles UI y las tres etiquetas mencionadas; la aplicación define su layout y tipografía general.

La app `apps/ui-demo` muestra esta primera base. Desde la raíz, ejecuta `pnpm -F meeko-ui-demo run dev`. Sus componentes y declaraciones se incluyen en `dist/components` al construir `@meekojs/ui`, por lo que un consumidor no necesita escribir archivos dentro de la instalación de Meeko.
