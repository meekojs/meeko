# Eventos, modelos y snippets

## Eventos de componente: `defineEmits` y `on:`

Un componente declara sus eventos con la macro `defineEmits<T>()`, donde cada clave de `T` es un evento y su valor es la tupla de argumentos. Devuelve una función `emit(evento, ...argumentos)` tipada:

```html
<!-- TodoItem.meeko -->
<script lang="ts">
	const props = defineProps<{ id: number; title: string }>()
	const emit = defineEmits<{ save: [id: number]; close: [] }>()
</script>
<template>
	<p>{props.title}</p>
	<button on:click="() => emit('save', props.id)">Guardar</button>
	<button on:click="() => emit('close')">Cerrar</button>
</template>
```

El padre escucha con `on:evento` en la etiqueta del hijo, igual en `<TodoItem>` que en `<component is>`:

```html
<TodoItem
	bind:id="todo.id"
	bind:title="todo.title"
	on:save="save"
	on:close="() => open.value = false"
/>
```

No hay un canal de eventos aparte: cada evento `save` es la prop de callback opcional `onSave` del hijo, y `emit("save", id)` llama a la que pasa el padre en ese momento. Por eso `on:save="save"` equivale a `bind:onSave="save"`, que sigue funcionando como en `1.0`, y un `emit` sin listener no hace nada. TypeScript comprueba los argumentos de `emit` en el hijo y la firma del handler en el padre; un evento que el hijo no declara es un error de tipos.

- `defineEmits` debe aparecer una sola vez, en su propia declaración `const` de nivel superior con un nombre simple (`MEEK045`), con un argumento de tipo (`MEEK046`) y sin argumentos en tiempo de ejecución (`MEEK047`).
- Las props que declara `defineEmits` (`onSave`) no pueden declararse también en `defineProps`: es un error de tipos.
- Desde `1.8`, `props` no enumera esas props: `Object.keys(props)`, `'onSave' in props`, `{ ...props }` y el resto de `const { id, ...rest } = props` no incluyen `onSave`, como su tipo, así que `bind="rest"` no recibe manejadores (antes lanzaba `MEEK113`). `props.onSave` se sigue leyendo y `emit` llama al callback como siempre. Vale cuando el script escribe los eventos: un tipo literal (`defineEmits<{ save: [] }>()`) o una `interface` o un `type` locales sin `extends` ni parámetros; con un tipo importado o derivado, `props` los enumera como antes.
- En un componente, el nombre del evento es un identificador (`on:save`, `on:saveDraft`); `on:save-draft` da `MEEK011`. Escribir `on:save` y `bind:onSave` en la misma etiqueta da `MEEK048`.
- En un elemento HTML, `on:click` sigue siendo un listener del DOM.

Un callback declarado directamente en `defineProps` (`onSave: (id: number) => void`, que el hijo llama con `props.onSave(id)`) sigue siendo válido; `defineEmits` evita declararlo a mano y lo hace opcional.

## Modelos de componente: `defineModel` y `model`

Desde `1.1`, un componente declara con la macro `defineModel<T>()` un valor que el padre comparte con él en los dos sentidos. Devuelve una `Signal<T>` escribible:

```html
<!-- AppInput.meeko -->
<script lang="ts">
	const value = defineModel<string>() // modelo por defecto
	const open = defineModel<boolean>('open', { default: false }) // modelo con nombre, opcional
	// Para que el modelo por defecto sea opcional: defineModel<string>({ default: "" })
</script>
<template>
	<input model="value" />
	<button on:click="() => open.value = !open.value">Opciones</button>
</template>
```

El padre pasa sus señales con `model` (el modelo por defecto) y `model:nombre`, igual en una etiqueta de componente que en `<component is>`:

```html
<AppInput
	model="name"
	model:open="settingsOpen"
/>
```

- **La señal del padre.** Si el padre pasa una señal, `defineModel` devuelve esa misma señal: leer y escribir en el hijo lee y escribe la del padre. El padre es su dueño, así que la señal no forma parte del estado que el hijo transfiere en SSR ni del que conserva en HMR.
- **Obligatorio u opcional.** Un modelo sin `default` es obligatorio: el padre pasa `model` o `bind:modelValue`, y omitir los dos es un error de tipos y, en ejecución, lanza un `TypeError`. Con `{ default: valor }` es opcional; si el padre no lo pasa, el hijo usa una señal local con ese valor inicial.
- **Modelo por defecto opcional.** Las opciones van sin nombre para el modelo por defecto: `defineModel<string>({ default: "" })` lo hace opcional, igual que `defineModel<string>("default", { default: "" })`, que es la misma declaración con el nombre escrito. Con `defineModel<string>()`, en cambio, un padre que no pasa `model` (por ejemplo, porque el campo recibe un `FormField` en `bind:field`) da `TS2741` («Falta el modelo obligatorio de este componente: pásalo con model="señal" o bind:modelValue="valor"»). No hay ambigüedad entre las dos formas: el nombre es siempre un literal de texto y las opciones, un objeto literal.
- **Señal escribible.** La expresión del padre debe ser una `Signal<T>` escribible. Un `computed`, una señal de sólo lectura o un valor normal es un error de tipos y, en ejecución, un `TypeError`.
- **La señal no es una prop.** La señal va en `ComponentModels`. El SSR lee su valor y la hidratación conecta la misma señal.
- **También por prop y evento.** Desde `1.8`, el padre puede pasar el valor con `bind:modelValue` (`bind:nombre` en un modelo con nombre), también dentro de `bind="objeto"`, y escuchar `on:update:modelValue` (`on:update:nombre`). `ComponentProps`, `<Nombre>Props` y `<Nombre>Emits` los conocen, y `next` tiene el tipo del modelo.

| El padre pasa                              | El valor del hijo                | Cuando el hijo escribe                                                                   |
| ------------------------------------------ | -------------------------------- | ---------------------------------------------------------------------------------------- |
| `model="señal"`                            | La señal del padre               | Escribe en esa señal                                                                     |
| `bind:modelValue` y `on:update:modelValue` | Sigue a la prop                  | Llama al evento; el valor sólo cambia si el padre cambia la prop, y si no, vuelve a ella |
| Sólo `bind:modelValue`, o dentro de `bind` | Valor inicial, y sigue a la prop | Se queda en el hijo hasta que la prop cambie                                             |
| Sólo `on:update:modelValue`                | `default`, en una señal local    | Se queda en el hijo y llama al evento                                                    |
| Nada                                       | `default`, en una señal local    | Se queda en el hijo                                                                      |

Si el manejador devuelve una promesa, lo escrito se mantiene hasta que termine la última y su rechazo llega al manejador de errores. Con esas formas el hijo sigue recibiendo una `Signal<T>`, y no sabe cuál usó el padre. El HTML del servidor sale con el valor de la prop, que no viaja en el estado del hijo. La prop y el evento no aparecen en `Object.keys(props)` ni en `...rest`. Véase [`defineModel`](reference/macros/definemodel.md#por-prop-y-evento).

`defineModel` va en su propia declaración `const` de nivel superior, con un nombre simple, y cada nombre de modelo aparece una vez (`MEEK063`); su prop y su evento no se declaran también en el script (`MEEK063`). Recibe un argumento de tipo, un nombre opcional como literal de texto y unas opciones que sólo admiten `default` (`MEEK064`). En el padre, un nombre de modelo que no es un identificador, el mismo modelo dos veces, un `model` sin valor o `model:x` junto a `bind:x` u `on:update:x` dan `MEEK066`.

## Snippets con `defineSnippets`

Desde `1.1`, un componente recibe contenido del padre en snippets con nombre, que declara con la macro `defineSnippets<T>()`. Cada clave de `T` es un snippet, su valor es la tupla de parámetros y `?` lo hace opcional:

```html
<!-- AppDialog.meeko -->
<script lang="ts">
	const snippets = defineSnippets<{ default: []; title?: []; actions?: [close: () => void] }>()
	const open = signal(true)
	function close(): void {
		open.value = false
	}
</script>
<template>
	<section if:when="open.value">
		<h2 if:when="snippets.title"><render snippet="snippets.title" /></h2>
		<render snippet="snippets.default" />
		<footer>
			<render
				snippet="snippets.actions"
				args="close"
			/>
		</footer>
	</section>
</template>
```

```html
<AppDialog>
	<p>{message.value}</p>
	<snippet name="title">Confirmar</snippet>
	<snippet
		name="actions"
		params="close"
	>
		<button on:click="close">Cerrar</button>
	</snippet>
</AppDialog>
```

- **En el padre.** El contenido suelto de la etiqueta llena `default`. `<snippet name="x" params="a, b">` llena el snippet `x`; `params` nombra sus parámetros, separados por comas, con los tipos de la tupla del hijo. El contenido usa el ámbito del padre (sus señales y funciones) y sigue siendo reactivo, también ante cambios de los argumentos.
- **En el hijo.** `<render snippet="expresión" args="a, b" />` pinta un snippet con esos argumentos; `args` es una lista de expresiones. `if:when="snippets.title"` comprueba si el padre pasó un snippet opcional, y un `<render>` de un snippet opcional ausente no pinta nada.
- **Tipos.** No pasar un snippet obligatorio, pasar uno que el hijo no declara o usar parámetros que no coinciden con su tupla son errores de tipos en el padre. Los snippets no son props: no aparecen en `ComponentProps`, y el módulo compilado exporta su tipo en `ComponentSnippets`. Cada snippet es un `Snippet<Args>`, tipo que exporta `@meekojs/meeko`.
- **SSR e hidratación.** El snippet se pinta dentro del DOM del hijo, entre marcadores de comentario, pero pertenece al ámbito reactivo del padre: se libera cuando se libera el padre o el hijo.
- **Reenvío.** Un componente puede pasar a otro un snippet que recibió: `<Inner><snippet name="x" params="a"><render snippet="snippets.x" args="a" /></snippet></Inner>`.
- **Snippets condicionales.** Desde `1.4`, `<snippet name="x" if:when="expresión">` pasa el snippet sólo mientras la expresión es verdadera. Con la condición falsa, para el hijo el snippet no existe: `snippets.x` es `undefined`, su `if:when="snippets.x"` es falso y un `<render>` no pinta nada. Sirve para reenviar un snippet opcional; sin `if:when`, la card de este ejemplo recibiría siempre `footer` y su `<footer if:when="snippets.footer">` pintaría un contenedor vacío cuando el panel no recibe `actions`:

  ```html
  <!-- AppPanel.meeko: defineSnippets<{ default: []; actions?: [close: () => void] }>() -->
  <AppCard>
  	<render snippet="snippets.default" />
  	<snippet
  		name="footer"
  		if:when="snippets.actions"
  	>
  		<render
  			snippet="snippets.actions"
  			args="close"
  		/>
  	</snippet>
  </AppCard>
  ```

  La condición se evalúa en el ámbito del padre (no ve los `params` del propio snippet), igual en el servidor y al hidratar, y es reactiva: cuando cambia, el hijo sigue montado, con su DOM, su estado y su foco, y sólo se actualizan los bindings que leen `snippets.x` (los hijos sin props reactivas se vuelven a montar; véase [Props reactivas](component-basics.md#props-reactivas)). Mientras sigue verdadera, el hijo conserva el mismo snippet. Como con las props, un valor que el setup del hijo copia de `snippets.x` (`const hasFooter = Boolean(snippets.footer)`) conserva el inicial: léalo en la plantilla o en un `computed`. Sólo vale para un snippet que el hijo declara opcional (`x?:`): en uno obligatorio es el error de tipos `MEEK110`. Como `if:when` en un elemento, estrecha los tipos dentro del contenido del snippet. Vale también en `<snippet name="default">`; el contenido suelto, que llena `default` sin etiqueta, no admite condición.

- **Reutilizar los snippets de otro componente.** Desde `1.4`, el valor de una clave de `T` también puede ser un `Snippet<Args>`, que cuenta como su tupla `Args`. Así, `T` puede partir del mapa de snippets de otro componente, `AppCardSnippets` (el tipo con nombre de cada componente autoimportado; véase [Tipos de cada componente](framework.md#tipos-de-cada-componente)) o el `ComponentSnippets` de su módulo, y recortarlo o ampliarlo con `Omit`, `Pick` o `&`. Cada snippet conserva sus parámetros y su `?`: un modal que envuelve una card declara los de la card salvo `footer`, añade `actions` y los reenvía con `<snippet if:when>`:

  ```html
  <!-- app/components/App/Card.meeko -->
  <script lang="ts">
  	const snippets = defineSnippets<{ header?: []; default: []; footer?: [] }>()
  </script>

  <!-- app/components/App/Modal.meeko -->
  <script lang="ts">
  	const open = defineModel<boolean>()
  	const snippets = defineSnippets<Omit<AppCardSnippets, 'footer'> & { actions?: [close: () => void] }>()
  	function close(): void {
  		open.value = false
  	}
  </script>
  <template>
  	<AppCard>
  		<snippet
  			name="header"
  			if:when="snippets.header"
  		>
  			<render snippet="snippets.header" />
  		</snippet>
  		<render snippet="snippets.default" />
  		<snippet
  			name="footer"
  			if:when="snippets.actions"
  		>
  			<render
  				snippet="snippets.actions"
  				args="close"
  			/>
  		</snippet>
  	</AppCard>
  </template>
  ```

  Para quien usa `<AppModal>`, `header` y `actions` son opcionales, `default` es obligatorio, `footer` no existe y `actions` entrega `close`: `meeko check` y el editor lo comprueban en sus etiquetas como en cualquier otro componente, también en uno genérico (`Pick<ListSnippets<T>, "row">`). Las tuplas de siempre no cambian: `defineSnippets<{ item: [name: string] }>()` tiene el mismo tipo que antes y puede mezclarse con entradas `Snippet`. Un valor que no es una tupla ni un `Snippet` sigue siendo el error `TS2344`.

- **Nombres de snippet.** El `name` de un `<snippet>` es un identificador (`title`) o, desde `1.8`, segmentos de caracteres de identificador unidos por guiones (`cell-email`, `header-created-at`, `cell-2024`): la regla es `/^[A-Za-z_$][\w$]*(?:-[\w$]+)*$/`, sin guion final ni doble. En el hijo, un nombre con guion se lee como propiedad entre corchetes: `snippets['cell-email']`.
- **Snippets dinámicos tipados por un genérico.** Desde `1.8`, las claves de `T` pueden salir de un parámetro de tipo con un tipo mapeado y un template literal, como los slots `#name-cell` de otras librerías. El padre escribe un snippet por cada clave de sus filas, y `meeko check` y el editor lo comprueban contra el tipo que infieren sus props: `value` tiene el tipo de esa columna, una clave que la fila no tiene es un error (`TS2353`) y unos `params` de más también. El editor completa los nombres posibles (con `bind:rows` conocido, las claves concretas; si no, el prefijo, como `cell-`) y muestra su firma en el hover:

  ```html
  <!-- AppGrid.meeko -->
  <script
  	lang="ts"
  	generic="Row extends object"
  >
  	import type { Snippet } from '@meekojs/meeko'

  	type Column<R extends object> = { key: Extract<keyof R, string>; label: string }
  	const props = defineProps<{ rows: readonly Row[]; columns: readonly Column<Row>[] }>()
  	const snippets = defineSnippets<
  		{ [K in Extract<keyof Row, string> as `cell-${K}`]?: [row: Row, value: Row[K]] } & {
  			[K in Extract<keyof Row, string> as `header-${K}`]?: [column: Column<Row>]
  		} & { cell?: [row: Row, column: Column<Row>, value: unknown] }
  	>()
  	// Sobre Row, TypeScript no lee un nombre calculado: el hijo lo lee de una vista.
  	const byName = snippets as { readonly [name: string]: Snippet<never> | undefined }
  	function cellOf(column: Column<Row>): Snippet<[row: Row, value: unknown]> | undefined {
  		return byName[`cell-${column.key}`] as Snippet<[row: Row, value: unknown]> | undefined
  	}
  </script>
  <template>
  	<p each:of="props.rows" each:as="row">
  		<span each:of="props.columns" each:as="column">
  			<render
  				if:when="cellOf(column)"
  				snippet="cellOf(column)"
  				args="row, row[column.key]"
  			/>
  			<render
  				if:when="!cellOf(column)"
  				snippet="snippets.cell"
  				args="row, column, row[column.key]"
  			/>
  		</span>
  	</p>
  </template>

  <!-- En el padre: value es string, el tipo de User['email']. -->
  <AppGrid
  	bind:rows="users"
  	bind:columns="columns"
  >
  	<snippet
  		name="cell-email"
  		params="row, value"
  	>
  		<a bind:href="'mailto:' + value">{value}</a>
  	</snippet>
  </AppGrid>
  ```

  En el hijo, una intersección con un tipo mapeado se lee miembro a miembro: `snippets.cell` conserva su tupla junto a los snippets mapeados. Lo que TypeScript no puede tipar sobre un parámetro de tipo es un nombre calculado (``snippets[`cell-${column.key}`]``): en tiempo de ejecución funciona, pero el hijo lo lee de una vista con una conversión, como `byName` arriba. `UITable` usa este patrón para `cell-<clave>` y `header-<clave>`.

`defineSnippets` aparece una sola vez, en su propia declaración `const` de nivel superior con un nombre simple (`MEEK059`), con un argumento de tipo y sin argumentos en tiempo de ejecución (`MEEK060`). `MEEK061` señala un `<snippet>` que no es hijo directo de una etiqueta de componente, sin `name` o con un nombre que no sigue la regla de nombres de snippet, con parámetros que no son identificadores, repetido, con atributos distintos de `name`, `params` e `if:when`, con un `if:when` vacío o sin valor, o un `<snippet name="default">` junto a contenido suelto. `MEEK110`, un error de tipos de `meeko check` y del editor, señala el `if:when` de un `<snippet>` que llena un snippet obligatorio del hijo. `MEEK062` señala un `<render>` sin `snippet`, con contenido o con atributos distintos de `snippet` y `args`. Una `ref:` dentro del contenido de un `<snippet>` da `MEEK052`, porque el hijo puede pintarlo varias veces. `<snippet>` y `<render>` pueden cerrarse solos.
