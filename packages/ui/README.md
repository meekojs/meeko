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

La aplicación necesita `@meekojs/meeko` y Node.js 24 o superior. UI 0.2 requiere Meeko `>=1.8 <2` porque `UIThemeToggle` usa `useThemeToggle()`. Antes de publicar 0.2.0 debe actualizarse la compatibilidad declarada del módulo; en este workspace se valida contra el núcleo local.

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

`UIOptions`, `UITokens` y `UIDefaults` se exportan como tipos de `@meekojs/ui`. Los defaults son por aplicación y petición SSR; no hay estado mutable global. Las props explícitas ganan sobre `ui.defaults`, y éstos sobre los valores de base. Los defaults disponibles son `button` y `link` (`variant`, `size`, `shape`), y `card` (`variant`). Sin opciones se conserva la configuración original y no se instala el plugin de defaults.

`tokens` admite `accent`, `accentHover`, `onAccent`, `primary`, `primaryHover`, `onPrimary`, `accentSoft`, `accentText`, `surface`, `surfaceHover`, `text`, `textSoft`, `muted`, `border`, `borderStrong`, `danger`, `focus`, `radius`, `font`, `controlHeight`, `controlPadding`, `controlWeight` y `controlFontSize`. Cada clave se convierte a `--meeko-ui-*` con guiones. `primary` controla las acciones; `accent` puede seguir teniendo otro color para foco y estados. Si no se configura `primary`, utiliza el acento como antes. Las referencias `var(...)` siguen los temas de la aplicación sin duplicar sus colores.

Las opciones se validan al cargar el módulo. Los tokens se añaden a la hoja CSS de UI antes de pasar por PostCSS; no se generan estilos inline ni archivos en `node_modules`. Las hojas de la aplicación se cargan después y pueden sobrescribirlos.

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

Puedes sobrescribir `--meeko-ui-container-max-width` y `--meeko-ui-container-gutter` desde una clase. Los tipos `UIContainerSize`, `UIContainerGutter` y `UIContainerTag` se exportan desde `@meekojs/ui`. La web pública usa Container en su estructura y documenta su API en `/container`.

### Controles básicos

| Componente | API                                                                                                                                                                                                                                                                                             |
| ---------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `UIButton` | Ruta (`to`, `params`, `search`), enlace (`href`, `target`, `rel`, `download`) o botón (`type`, `disabled`); véase [UIButton](#uibutton-ruta-enlace-o-botón). Siempre `variant`, `size`, `shape`, `class`, evento `click` y snippet `default`. Por defecto `button`, `primary`, `md`, `rounded`. |
| `UIInput`  | Modelo de texto con `model`. Props: `id`, `name`, `type`, `placeholder`, `required`, `disabled`, `invalid`, `describedBy` y `class`. Tipos admitidos: `text`, `email`, `password`, `search`, `url`, `tel`. Por defecto usa `text` y un valor vacío.                                             |
| `UIField`  | Requiere `id`, `label` y el snippet `default(id, describedBy)`. Props opcionales: `description`, `error`, `required`, `class`. El error tiene prioridad sobre la descripción y se anuncia con `role="alert"`.                                                                                   |

También incluye `UIApp` y `UIModal` para [modales](#modales), `UITable` para [tablas](#tablas), `UICard` para [cards](#cards), y los componentes de navegación y etiquetas siguientes.

### UIButton: ruta, enlace o botón

`UIButton` pinta el elemento que corresponde a lo que hace, con el mismo aspecto (`.meeko-ui-button` con `data-variant`, `data-size` y `data-shape`), también en hover, foco y con los estilos de enlace de la aplicación:

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

- **Combinaciones inválidas.** `to` con `href`, `type` o `disabled` en un enlace, `target`, `rel` o `download` en un botón, una ruta inexistente y unos `params` que no son los de la ruta son errores de tipos en `meeko check` y en el editor.
- **Un enlace no se deshabilita.** `<a>` no tiene `disabled` nativo y emularlo con `aria-disabled` deja el `href` navegable con el teclado, el clic central o sin JavaScript; quitar el `href` lo saca del orden de tabulación. Por eso `disabled` sólo existe sin `to` ni `href`: si la acción no está disponible, no pinte el enlace o use un botón deshabilitado.
- **Atributos.** `id`, `title`, `tabindex`, `aria-*` y `data-*` llegan al elemento en las tres formas (`UIForwardedAttributes`: los comunes a `<a>` y `<button>`). `on:click` recibe el `MouseEvent` en las tres; en un enlace, `event.preventDefault()` cancela la navegación.
- **Tipos.** `UIButtonProps`, `UILinkProps`, `UIRouteTarget`, `UIForwardedAttributes` y `UIActionAppearance` se importan desde `@meekojs/ui/runtime`.

### Navegación y etiquetas

- `UILink` da apariencia de acción a un `<a>` real, con los defaults de `ui.defaults.link`. Recibe `href` (cualquier URL, con `target` y `rel`) o `to` (una ruta de la aplicación con `params` y `search` tipados, como en `UIButton`, con navegación del cliente); uno de los dos, no ambos. Comparte `variant`, `size` y `shape` con `UIButton`, y admite `ariaLabel`, `class`, `id`, `title`, `aria-*`, `data-*` y evento `click`. No simula botones ni utiliza roles artificiales. Para `target="_blank"` añade `noopener noreferrer` si no se especifica `rel`.
- `UILinkCard` es una superficie enlazada: requiere `href` y `title`, con `description`, `class` y snippet `default` opcionales. El contenido no debe incluir otros enlaces ni botones porque toda la card es un único enlace.
- `UIBadge` muestra metadatos, con `tone="neutral|accent|danger"` (`neutral` por defecto), `class` y snippet `default` obligatorio. Conserva semántica de texto; no añade anuncios o interacción.

```html
<UILink
	to="/docs"
	variant="primary"
>
	Empezar
</UILink>
<UILinkCard
	href="/docs/framework"
	title="Framework"
	description="Rutas, SSR y datos."
/>
<UIBadge tone="accent">Función</UIBadge>
```

La web pública `apps/meeko` consume estas acciones en su portada, cabecera y errores; `UILinkCard` compone el índice documental y `UIBadge` los metadatos de referencia. Su `meeko.config.ts` enlaza los tokens con la paleta actual, incluidas las acciones neutras y el foco azul.

Desde UI 0.2, `UIPopover`, `UISelect` y `UIThemeToggle` son componentes del módulo UI. Sustituyen a `MeekoPopover`, `MeekoSelect` y `MeekoThemeToggle`, obsoletos desde core 1.8 y con retirada en 2.0. Conservan el contrato y el marcado `data-meeko-*`; véase [Migración a 1.8](../../docs/migration-1.8.md).

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

La apertura dura 220 ms y el cierre 160 ms, con opacidad, desplazamiento y escala. Los diálogos de atrás conservan su DOM y estado, se reducen ligeramente y no reciben interacción; al volver al frente recuperan tamaño y foco. El componente se desmonta y `open()` se resuelve al terminar la salida. El gestor mantiene el primer resultado si se repite el cierre. Desmontar el host o disponer el proveedor cancela inmediatamente los pendientes. Los modales declarativos pueden reabrirse durante la salida sin desmontarse. Con movimiento reducido no se ejecutan estas animaciones. El ejemplo de `/modals` abre una pila `lg → md → sm` para observar cada capa.

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

| Snippet          | Parámetros                                                                                  |
| ---------------- | ------------------------------------------------------------------------------------------- |
| `cell-<clave>`   | `row: T`, `value: T[clave]`: el valor con el tipo exacto de esa columna. Desde Meeko `1.8`. |
| `header-<clave>` | `column: TableColumn<T>`: la cabecera de esa columna. Desde Meeko `1.8`.                    |
| `header`         | `column: TableColumn<T>`                                                                    |
| `cell`           | `row: T`, `column: TableColumn<T>`, `value: T[keyof T]`, `index: number`                    |
| `footer`         | `column: TableColumn<T>`, `rows: readonly T[]`; fuerza la aparición del pie.                |
| `empty`          | Sin parámetros; reemplaza `emptyText`.                                                      |

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
		<UIBadge bind:tone="value === 'Publicado' ? 'accent' : 'neutral'">{value}</UIBadge>
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

Los estilos se procesan con el PostCSS de Meeko. El contenedor admite foco y desplazamiento horizontal con teclado. Puedes personalizar `--table-border`, `--table-background` y `--table-hover` mediante una clase; define las columnas con `gridColumns`. Los colores admiten `--color-border`, `--color-surface`, `--color-text` y `--color-text-muted`, con respaldo en los tokens de UI. La guía `/tables` muestra ambos layouts, formateadores, pies calculados, celdas personalizadas y estado vacío.

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

El snippet `header` sustituye por completo `title` y `description`; proporciona un encabezado con el nivel adecuado para tu página si lo usas. El pie aparece sólo al suministrar `footer`. Sin título, descripción ni snippet de cabecera, no se genera el `<header>`. El contenedor conserva su semántica de sección y no añade comportamiento de botón: utiliza enlaces y botones en su contenido para las acciones. La guía `/cards` muestra las variantes y la composición.

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

El build de UI genera ESM, declaraciones TypeScript y los componentes con sus declaraciones adyacentes en `dist/app/components`. El módulo registra el plugin estático `dist/app/plugins/modal.js` y enlaza su alias privado `virtual:meeko-ui-components` con el registro de componentes que genera Meeko para el consumidor; UI no escribe un plugin en `.meeko/generated`. Las hojas se distribuyen directamente desde `src/app/styles/`: `main.css` importa `tokens.css`, y el consumidor las procesa con Vite/PostCSS. En el workspace, editar estos CSS actualiza la web de UI mediante HMR sin reconstruir el paquete. Los consumidores no necesitan generar archivos dentro de `node_modules`.

Más información en la [guía de UI](../../docs/ui.md) y en la [web pública de Meeko UI](https://ui.meekojs.com), con instalación, personalización, API y ejemplos interactivos. En el monorepo se inicia mediante `pnpm ui:dev`.

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

Meeko pinta un `<button>` con `popovertarget`, `aria-expanded`, `aria-controls` y `aria-haspopup` (según `role`), cuyo contenido es el snippet `trigger`, y el contenido suelto dentro de un elemento con `popover` y `data-meeko-popover`. Con `popovertarget`, el botón abre y cierra el contenido incluso antes de hidratar.

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

**Tooltip.** `mode="hint"` usa `popover="hint"`: se abre al pasar el puntero (tras `delay`) o al enfocar el disparador, se queda abierto mientras el puntero está sobre él o sobre el contenido, se cierra con `Esc` o al perder el foco y nunca toma el foco. El disparador lleva `aria-describedby` con el contenido, que es `role="tooltip"`.

```html
<UIPopover mode="hint">
	<snippet name="trigger">?</snippet>
	El código está en el reverso de la tarjeta.
</UIPopover>
```

**Posición.** El contenido usa `position-anchor`, `position-area` y `position-try-fallbacks: flip-block, flip-inline`, así que se coloca al otro lado si no cabe. En un navegador sin anchor positioning, Meeko lo marca con `data-meeko-popover-fallback` y calcula su posición en JavaScript al abrirse y con cada `resize` o `scroll`: también se da la vuelta y nunca sale del viewport, y el lado elegido queda en `data-side`. El contenido abierto lleva `data-open`.

**Disparador propio.** El snippet `anchor` sustituye el botón: recibe en `trigger` (tipo `PopoverTrigger`) los atributos que el disparador debe llevar, con el nombre de cada atributo como clave, así que basta con [`bind="trigger"`](../../docs/api.md). `<UIPopover>` encuentra el elemento por su `id` al montarse y le añade el teclado y el anclaje:

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

Un disparador que no es un `<button>` (sin `popovertarget`) abre el contenido con el modelo: `on:click="() => open.value = !open.value"`.

### Props de UIPopover

Tipos públicos de `@meekojs/ui/runtime`.

| Prop           | Tipo               | Descripción                                                                                                  |
| -------------- | ------------------ | ------------------------------------------------------------------------------------------------------------ |
| `mode`         | `PopoverMode`      | `"auto"` (por defecto), `"manual"` o `"hint"`; véase {@link PopoverMode}.                                    |
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

## UISelect

Un select accesible construido sobre `<UIPopover>`. `model` es el valor y su tipo sale de `options`:

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
	<UISelect
		id="color"
		model="color"
		bind:options="colors"
		placeholder="Elige un color"
		name="color"
	/>

	<UISelect
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
	</UISelect>

	<UISelect
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
| `clearable`, `clearLabel`                   | Botón junto al disparador que quita la selección (`null`, o `[]` con `multiple`); `clearLabel` es su `aria-label` («Quitar selección» por defecto).                                      |
| `filter`                                    | Búsqueda propia, síncrona o asíncrona.                                                                                                                                                   |
| `max`                                       | Con `multiple`, cuántas opciones se pueden elegir como mucho.                                                                                                                            |
| `field`                                     | El campo de `useForm`: `bind:field="form.field('color')"`.                                                                                                                               |
| `id`, `label`, `describedBy`, `invalid`     | `id` del disparador (para `<label for>`), su `aria-label`, `aria-describedby` y `aria-invalid`.                                                                                          |
| `class`, `listClass`, `placement`, `offset` | Clases de la raíz y de la lista, y la posición de la lista.                                                                                                                              |

`on:change` emite el valor nuevo con cada elección del usuario. Los snippets son `option` (`[option, state]`, con `state.selected`, `state.active` y `state.disabled`), `value` (cómo se ve cada valor elegido en el disparador; sin él, las etiquetas separadas por comas), `group` (el encabezado de un grupo), `empty` (sin opciones; por defecto, «Sin resultados») y `loading` (mientras carga una búsqueda asíncrona).

**Tipos.** `meeko check` y el editor infieren de la etiqueta el tipo de las opciones (`T`) y si es múltiple: el modelo de un select simple es una `Signal<T | null>` y el de uno múltiple, `Signal<T[]>`; `by`, `labelBy` y `groupBy` sólo admiten claves de `T`, y los parámetros de los snippets tienen el tipo `T`. El tipo `SelectModel<T, Multiple>` describe el valor.

**ARIA y teclado.** El disparador es un `role="combobox"` (un `<button>` o, con `searchable`, un `<input>` con `aria-autocomplete="list"`) con `aria-expanded`, `aria-controls`, `aria-haspopup="listbox"` y `aria-activedescendant`: el foco nunca sale de él. La lista es un `role="listbox"` (con `aria-multiselectable` en un select múltiple) de `role="option"` con `aria-selected` y `aria-disabled`, agrupadas en `role="group"` con `groupBy`. Un `<label for>` externo nombra el disparador por su `id`. El patrón ARIA del combobox no define cómo vaciar la selección, así que `clearable` añade, fuera del combobox, un `<button type="button">` con `aria-label` («Quitar selección»): entra en el orden de tabulación justo después del disparador, sólo existe mientras hay algo elegido y al activarlo cierra la lista, emite `change` con `null` (o `[]`) y devuelve el foco al disparador.

- `↓`, `↑`, `Intro` o `Espacio` abren la lista sobre la opción elegida (o la primera); `Inicio` y `Fin` abren en un extremo; las letras abren y buscan.
- Con la lista abierta, las flechas, `Inicio`, `Fin`, `RePág` y `AvPág` mueven la opción activa (sin dar la vuelta, saltando las deshabilitadas) y la desplazan hasta verla; las letras buscan por el principio de la etiqueta, sin distinguir acentos.
- `Intro` elige la opción activa; `Espacio` también, salvo con `searchable`, donde escribe un espacio. En un select simple, elegir cierra la lista; en uno múltiple, alterna la opción y la lista sigue abierta. `Alt+↑` elige y cierra.
- `Esc` cierra sin cambiar el valor y `Tab` cierra. Pulsar fuera o mover el foco fuera también cierran.
- Con el ratón, un clic en una opción la elige; pasar el puntero la activa. Pulsar en la lista no quita el foco al disparador.

Con `max`, en cuanto hay `max` opciones elegidas las demás quedan `aria-disabled="true"` y `data-disabled` hasta que se quite una.

**Atributos de estado.** Las opciones llevan `data-active`, `data-selected` y `data-disabled`, y la raíz (`data-meeko-select`) `data-open`, `data-multiple`, `data-disabled` y `data-loading`. La lista mide al menos lo que el disparador (`anchor-size(width)` o, sin anchor positioning, el ancho calculado), tiene una altura máxima y se desplaza; ambas reglas están en la capa `meeko`, así que su CSS las sustituye:

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
	<UISelect
		model="city"
		bind:options="[]"
		by="code"
		searchable
		bind:filter="search"
		placeholder="Busca una ciudad"
	>
		<snippet name="loading">Buscando…</snippet>
		<snippet name="empty">Ninguna ciudad con ese nombre</snippet>
	</UISelect>
</template>
```

**Formularios.** Con `name`, el select envía un `<input type="hidden">` por valor (uno vacío en un select simple sin valor, ninguno en uno múltiple vacío), como un `<select>` nativo; con `disabled` no envía nada. El valor de cada opción es su clave de `by`, el propio primitivo o su etiqueta. `required` impide enviar el `<form>` sin valor: el disparador recibe el foco y `aria-invalid="true"` hasta que se elige una opción. Con `useForm`, `model="form.fields.color"` funciona como en cualquier control, y `bind:field="form.field('color')"` da además el valor, el `id` del campo (para su `<label for>`), el `name`, `aria-invalid` y `aria-describedby` con el mensaje de error; `focusInvalid` lleva el foco al select cuando falla la validación. El valor inicial `""` de un campo cuenta como «sin valor» (salvo que una opción sea `""`).

```html
<form
	on:submit="form.submit"
	novalidate
>
	<label bind:for="form.field('country').id">País</label>
	<UISelect
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

**Listas largas.** `<UISelect>` pinta todas las opciones (en el HTML del servidor también). Para miles de opciones, use `searchable` con un `filter` que devuelva sólo las primeras coincidencias; una lista virtual que sólo pinte las visibles (`virtual`) no está disponible en UI `0.2`.

**Alternativa nativa.** Para un caso simple, sin búsqueda ni opciones con contenido propio, un `<select>` nativo con `model` sigue siendo la opción más ligera. En los navegadores que lo admiten, `appearance: base-select` permite estilizarlo por completo y conserva el teclado, la accesibilidad y el envío del formulario del navegador:

```css
select,
::picker(select) {
	appearance: base-select;
}
```

### Props de UISelect

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
| `filter`      | `SelectFilter<T>`                                      | Búsqueda propia, síncrona o asíncrona; por defecto, la etiqueta contiene el texto, sin distinguir acentos ni mayúsculas. |
| `max`         | `number`                                               | Con `multiple`, cuántas opciones se pueden elegir como mucho.                                                            |
| `field`       | `SelectField<SelectModel<T, Multiple>>`                | El campo de `useForm` (`form.field('x')`): su `id`, su `name`, su valor, `aria-invalid` y `aria-describedby`.            |
| `id`          | `string`                                               | `id` del disparador, para un `<label for>`; por defecto, el del campo o uno de `useId`.                                  |
| `label`       | `string`                                               | `aria-label` del disparador y de la lista, sin `<label>`.                                                                |
| `describedBy` | `string`                                               | `aria-describedby` del disparador.                                                                                       |
| `invalid`     | `boolean`                                              | Marca el disparador con `aria-invalid="true"`.                                                                           |
| `class`       | `string`                                               | Clases del elemento raíz.                                                                                                |
| `listClass`   | `string`                                               | Clases de la lista, el elemento con `popover`.                                                                           |
| `placement`   | `PopoverPlacement`                                     | Dónde se abre la lista; `"bottom-start"` por defecto.                                                                    |
| `offset`      | `number`                                               | Separación en píxeles entre el disparador y la lista.                                                                    |

## UIThemeToggle

Desde UI `0.2`, con el módulo UI activo y `theme` en `meeko.config.ts`, `UIThemeToggle` permite cambiar el tema. Requiere core `1.8` y usa su API pública `useThemeToggle()`.

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

| Prop          | Por defecto                  | Qué hace                                                                                                                                                                |
| ------------- | ---------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `mode`        | `"cycle"`                    | `"cycle"`: un botón que pasa a la elección siguiente de la lista. `"select"`: un grupo de radios.                                                                       |
| `themes`      | los temas y `"system"`       | Las elecciones y su orden (`bind:themes="['light', 'dark']"`).                                                                                                          |
| `labels`      | «Claro», «Oscuro», «Sistema» | El nombre de cada elección; un tema propio, sin etiqueta, se llama como el tema.                                                                                        |
| `messages`    | en español                   | Los textos accesibles: `cycle(current, next)` (el `aria-label` del botón), `unknown` («Cambiar tema») y `group` («Tema»), para traducirlos. Tipo `ThemeToggleMessages`. |
| `class`, `id` | —                            | Del `<form>` raíz. Otros atributos no pasan: envuelva la etiqueta si los necesita.                                                                                      |

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
