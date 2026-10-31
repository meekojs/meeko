# @meekojs/ui

Componentes visuales y estilos para Meeko. Es un paquete del mismo ecosistema, con versión propia, que se activa como módulo del framework.

## Instalación

En una aplicación de este monorepo, añade la dependencia de workspace a su `package.json`:

```json
{
	"dependencies": {
		"@meekojs/meeko": "workspace:*",
		"@meekojs/ui": "workspace:*"
	}
}
```

Después ejecuta `pnpm install` desde la raíz. Para instalar una versión publicada del paquete en un consumidor externo:

```sh
pnpm add @meekojs/ui
```

La aplicación necesita `@meekojs/meeko` y Node.js 24 o superior. La compatibilidad declarada del módulo es Meeko `>=1.7 <2`; en este workspace se valida contra el núcleo local.

## Configuración

```ts
// meeko.config.ts
import { defineMeekoConfig } from '@meekojs/meeko/framework'

export default defineMeekoConfig({
	modules: ['@meekojs/ui'],
	theme: true,
})
```

El módulo registra los componentes con el prefijo `Ui` y su hoja CSS mediante `meeko.addStylesheet`. Vite la procesa con el PostCSS del proyecto, resuelve sus imports y genera los assets del build. En desarrollo, los cambios de CSS usan HMR. No hace falta importar el CSS manualmente ni enlazar una URL fija. `theme: true` activa los temas del framework; el módulo UI también puede utilizarse sin esa opción.

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
	<UiField
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
			<UiInput
				bind:id="id"
				bind:describedBy="describedBy"
				bind:invalid="Boolean(error.value)"
				model="name"
				required
			/>
		</snippet>
	</UiField>

	<UiButton on:click="save">Guardar</UiButton>
</template>
```

`UiField` entrega el ID del control y el ID de su descripción o error al snippet. Pasa esos valores al control, junto con `invalid` y `required` cuando corresponda: el campo no los propaga automáticamente.

## Componentes

| Componente | API                                                                                                                                                                                                                                                 |
| ---------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `UiButton` | `type` (`button`, `submit`, `reset`), `variant` (`primary`, `secondary`), `disabled`, `class`, evento `click` y contenido mediante el snippet `default`. Por defecto usa `type="button"` y `variant="primary"`.                                     |
| `UiInput`  | Modelo de texto con `model`. Props: `id`, `name`, `type`, `placeholder`, `required`, `disabled`, `invalid`, `describedBy` y `class`. Tipos admitidos: `text`, `email`, `password`, `search`, `url`, `tel`. Por defecto usa `text` y un valor vacío. |
| `UiField`  | Requiere `id`, `label` y el snippet `default(id, describedBy)`. Props opcionales: `description`, `error`, `required`, `class`. El error tiene prioridad sobre la descripción y se anuncia con `role="alert"`.                                       |

El directorio también contiene `UiApp`, actualmente un contenedor vacío, sin props ni snippets de composición.

La hoja de UI da apariencia a `MeekoSelect`, `MeekoPopover` y `MeekoThemeToggle`. Sus implementaciones pertenecen al núcleo de Meeko y sus etiquetas se pueden usar sin activar este módulo. No se renombran con el prefijo `Ui`.

## Personalización

Las hojas del módulo se cargan antes de `app/styles/main.css`. Sobrescribe las variables CSS desde esa hoja de la aplicación:

```css
:root {
	--meeko-ui-accent: #6750a4;
	--meeko-ui-accent-hover: #503d85;
	--meeko-ui-radius: 0.75rem;
}

:root[data-theme='dark'] {
	--meeko-ui-accent: #d0bcff;
	--meeko-ui-accent-hover: #e2d3ff;
}
```

Los tokens disponibles usan el prefijo `--meeko-ui-`: `accent`, `accent-hover`, `on-accent`, `surface`, `surface-hover`, `text`, `muted`, `border`, `danger`, `focus`, `radius` y `font`. El tema oscuro usa `data-theme="dark"` en el elemento raíz. La aplicación define su layout y su tipografía general.

## Desarrollo

Desde la raíz del monorepo:

```sh
pnpm build
pnpm -F @meekojs/ui run check
pnpm -F meeko-ui-demo run dev
```

Las fuentes de la aplicación del módulo se organizan así:

```text
src/
  app/
    components/
    styles/
      main.css
      tokens.css
  index.ts
  module.ts
```

El build de UI genera ESM, declaraciones TypeScript y los componentes con sus declaraciones adyacentes en `dist/app/components`. Las hojas se distribuyen directamente desde `src/app/styles/`: `main.css` importa `tokens.css`, y el consumidor las procesa con Vite/PostCSS. En el workspace, editar estos CSS actualiza el demo mediante HMR sin reconstruir el paquete. Los consumidores no necesitan generar archivos dentro de `node_modules`.

Más información en la [guía de UI](../../docs/ui.md) y en la [aplicación de demostración](../../apps/ui-demo).
