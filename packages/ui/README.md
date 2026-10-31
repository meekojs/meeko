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

El módulo registra los componentes con el prefijo `UI` y su hoja CSS mediante `meeko.addStylesheet`. Vite la procesa con el PostCSS del proyecto, resuelve sus imports y genera los assets del build. En desarrollo, los cambios de CSS usan HMR. No hace falta importar el CSS manualmente ni enlazar una URL fija. `theme: true` activa los temas del framework; el módulo UI también puede utilizarse sin esa opción.

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

| Componente | API                                                                                                                                                                                                                                                 |
| ---------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `UIButton` | `type` (`button`, `submit`, `reset`), `variant` (`primary`, `secondary`), `disabled`, `class`, evento `click` y contenido mediante el snippet `default`. Por defecto usa `type="button"` y `variant="primary"`.                                     |
| `UIInput`  | Modelo de texto con `model`. Props: `id`, `name`, `type`, `placeholder`, `required`, `disabled`, `invalid`, `describedBy` y `class`. Tipos admitidos: `text`, `email`, `password`, `search`, `url`, `tel`. Por defecto usa `text` y un valor vacío. |
| `UIField`  | Requiere `id`, `label` y el snippet `default(id, describedBy)`. Props opcionales: `description`, `error`, `required`, `class`. El error tiene prioridad sobre la descripción y se anuncia con `role="alert"`.                                       |

También incluye `UIApp` y `UIModal` para [modales](#modales), `UITable` para [tablas](#tablas) y `UICard` para [cards](#cards).

La hoja de UI da apariencia a `MeekoSelect`, `MeekoPopover` y `MeekoThemeToggle`. Sus implementaciones pertenecen al núcleo de Meeko y sus etiquetas se pueden usar sin activar este módulo. Conservan sus nombres `Meeko…`.

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

## Modales

El módulo instala un gestor independiente por aplicación (y por petición SSR). Monta un único `UIApp`, preferiblemente en `app/app.meeko`, para mantener el host durante las navegaciones:

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

La apertura dura 220 ms y el cierre 160 ms, con opacidad, desplazamiento y escala. Los diálogos de atrás conservan su DOM y estado, se reducen ligeramente y no reciben interacción; al volver al frente recuperan tamaño y foco. El componente se desmonta y `open()` se resuelve al terminar la salida. El gestor mantiene el primer resultado si se repite el cierre. Desmontar el host o disponer el proveedor cancela inmediatamente los pendientes. Los modales declarativos pueden reabrirse durante la salida sin desmontarse. Con movimiento reducido no se ejecutan estas animaciones. La demo `/modals` abre una pila `lg → md → sm` para observar cada capa.

Sólo `useModal` y `useModalInstance` se autoimportan en componentes y código de aplicación. Para imports explícitos utiliza `@meekojs/ui/runtime`, que no carga las herramientas de configuración del módulo. Los tipos públicos `ModalContext`, `ModalInstanceContext` y `ModalDismissReason` requieren `import type` explícito; no se añaden a los globals. Llama a los composables durante el setup, antes de cualquier `await`. Abrir modales durante SSR o sin un `UIApp` montado produce un rechazo explícito.

`UIModal` también funciona sin el gestor con `model="opened"`, siendo `opened` una señal booleana. Admite:

| Prop                               | Comportamiento                                                       |
| ---------------------------------- | -------------------------------------------------------------------- |
| `title`                            | Obligatoria; proporciona el nombre accesible del diálogo.            |
| `description`                      | Descripción accesible opcional.                                      |
| `size`                             | `sm`, `md` (predeterminado) o `lg`.                                  |
| `closeOnEscape`, `closeOnBackdrop` | Permiten cancelar por teclado o fondo; ambos `true` por defecto.     |
| `closeButton`, `closeLabel`        | Botón de cierre visible por defecto, etiquetado como `Cerrar modal`. |
| `class`                            | Clases adicionales del diálogo.                                      |

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
| `gridColumns` | Definición CSS de columnas para grid; por defecto genera una columna `minmax(160px, 1fr)` por cada entrada de `columns`.                                  |
| `caption`     | Título visible y nombre de la región desplazable, opcional.                                                                                               |
| `hideHeader`  | Oculta la cabecera; `false` por defecto.                                                                                                                  |
| `emptyText`   | Mensaje cuando `rows` está vacío; por defecto `No hay datos.`                                                                                             |
| `class`       | Clases adicionales sobre `<table>`.                                                                                                                       |

`format` devuelve texto, número, booleano o un valor vacío (`null`/`undefined`). Sin formateador, los valores se convierten a texto y los vacíos se muestran como una cadena vacía. El contenido se escapa como cualquier interpolación Meeko. Para objetos o fechas, proporciona un formateador. `footer` admite los mismos valores o una función que recibe todas las filas; el pie aparece cuando alguna columna lo define.

Los snippets son opcionales y personalizan el **contenido** de cada celda; la tabla conserva las etiquetas y sus roles accesibles:

| Snippet  | Parámetros                                                                   |
| -------- | ---------------------------------------------------------------------------- |
| `header` | `column: TableColumn<T>`                                                     |
| `cell`   | `row: T`, `column: TableColumn<T>`, `value: T[keyof T]`, `index: number`     |
| `footer` | `column: TableColumn<T>`, `rows: readonly T[]`; fuerza la aparición del pie. |
| `empty`  | Sin parámetros; reemplaza `emptyText`.                                       |

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

El snippet `cell` sustituye el formateador y recibe el valor original. Su valor es la unión de los tipos de campo de la fila; para un valor específico usa `row.age`, o el `format` de esa columna. No escribas `<tr>` ni `<td>` en estos snippets.

Los estilos se procesan con el PostCSS de Meeko. El contenedor admite foco y desplazamiento horizontal con teclado. Puedes personalizar `--table-border`, `--table-background` y `--table-hover` mediante una clase; define las columnas con `gridColumns`. Los colores admiten `--color-border`, `--color-surface`, `--color-text` y `--color-text-muted`, con respaldo en los tokens de UI. La demo `/tables` muestra ambos layouts, formateadores, pies calculados, celdas personalizadas y estado vacío.

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

| Prop          | Comportamiento                                                             |
| ------------- | -------------------------------------------------------------------------- |
| `variant`     | `outline` por defecto, `soft`, `solid` o `elevated`.                       |
| `title`       | Título opcional, renderizado como `<h2>` y nombre accesible de la sección. |
| `description` | Texto opcional bajo el título.                                             |
| `class`       | Clases adicionales sobre la sección.                                       |

`outline` usa superficie y borde; `soft`, un fondo tenue sin borde visible; `solid`, el color de acento y su texto de contraste; `elevated`, superficie con sombra sin borde visible. Todas responden a los tokens y al tema de UI. `--card-padding` permite ajustar el espacio interno mediante una clase; `--meeko-ui-card-shadow` personaliza la sombra.

El snippet `header` sustituye por completo `title` y `description`; proporciona un encabezado con el nivel adecuado para tu página si lo usas. El pie aparece sólo al suministrar `footer`. Sin título, descripción ni snippet de cabecera, no se genera el `<header>`. El contenedor conserva su semántica de sección y no añade comportamiento de botón: utiliza enlaces y botones en su contenido para las acciones. La demo `/cards` muestra las variantes y la composición.

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

El build de UI genera ESM, declaraciones TypeScript y los componentes con sus declaraciones adyacentes en `dist/app/components`. El módulo registra el plugin estático `dist/app/plugins/modal.js` y enlaza su alias privado `virtual:meeko-ui-components` con el registro de componentes que genera Meeko para el consumidor; UI no escribe un plugin en `.meeko/generated`. Las hojas se distribuyen directamente desde `src/app/styles/`: `main.css` importa `tokens.css`, y el consumidor las procesa con Vite/PostCSS. En el workspace, editar estos CSS actualiza el demo mediante HMR sin reconstruir el paquete. Los consumidores no necesitan generar archivos dentro de `node_modules`.

Más información en la [guía de UI](../../docs/ui.md) y en la [aplicación de demostración](../../apps/ui-demo).
