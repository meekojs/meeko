# Componentes integrados

## Componentes integrados

Desde `1.5`, Meeko trae dos componentes accesibles, `<MeekoPopover>` y `<MeekoSelect>`, como etiquetas propias: no se importan y funcionan igual en el motor independiente y en el framework. No tienen estilos visuales; exponen su estado con atributos `data-*` y ARIA para que la aplicación los estilice.

- **Peso.** Cada etiqueta es un módulo propio (`@meekojs/meeko/builtins/popover` y `@meekojs/meeko/builtins/select`), que el compilador importa sólo en los componentes que la usan. Una aplicación que no las escribe no carga su código, y `<MeekoSelect>` lleva consigo `<MeekoPopover>`. Esas rutas son, como `@meekojs/meeko/internal`, un contrato entre el compilador y su runtime de la misma versión: no las importe a mano.
- **SSR e hidratación.** El HTML del servidor trae el disparador (con el valor elegido en un select) y el contenido oculto por su atributo `popover`, sin parpadeo. Los IDs que enlazan disparador, contenido y opciones salen de [`useId`](language-reactivity.md#ids-estables-useid): son los mismos al hidratar.
- **CSP.** Nada va en atributos `style="…"`. El anclaje es una hoja construida (`adoptedStyleSheets`) en la capa de cascada `meeko`, compartida por todos, y cada instancia pasa sus valores en propiedades personalizadas por CSSOM; una CSP sin `'unsafe-inline'` basta. Como está en una capa, cualquier regla de la aplicación tiene prioridad.
- **Nombres.** Un componente del proyecto llamado `MeekoPopover` o `MeekoSelect` tiene prioridad sobre la etiqueta, con el aviso `MEEK106`. Los tipos de sus props, `MeekoPopoverProps` y `MeekoSelectProps`, se exportan desde `@meekojs/meeko/framework` y se autoimportan en `app/`.

### Popover: `<MeekoPopover>`

> **Obsoleto desde 1.8; retirada en 2.0.** `<MeekoPopover>` sigue funcionando en 1.x y emite `MEEK121`. Usa `<UIPopover>` de `@meekojs/ui` 0.2 con su módulo activo. Conserva props, snippets y marcado `data-meeko-*`. Véase [Migración a 1.8](migration-1.8.md).

Un contenido en la capa superior del navegador (la API `popover`), anclado a su disparador con _CSS anchor positioning_:

```html
<script lang="ts">
	const open = signal(false)
</script>
<template>
	<MeekoPopover
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
	</MeekoPopover>
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
<MeekoPopover mode="hint">
	<snippet name="trigger">?</snippet>
	El código está en el reverso de la tarjeta.
</MeekoPopover>
```

**Posición.** El contenido usa `position-anchor`, `position-area` y `position-try-fallbacks: flip-block, flip-inline`, así que se coloca al otro lado si no cabe. En un navegador sin anchor positioning, Meeko lo marca con `data-meeko-popover-fallback` y calcula su posición en JavaScript al abrirse y con cada `resize` o `scroll`: también se da la vuelta y nunca sale del viewport, y el lado elegido queda en `data-side`. El contenido abierto lleva `data-open`.

**Disparador propio.** El snippet `anchor` sustituye el botón: recibe en `trigger` (tipo `PopoverTrigger`) los atributos que el disparador debe llevar, con el nombre de cada atributo como clave, así que basta con [`bind="trigger"`](component-attributes.md#atributos-en-bloque-con-bind). `<MeekoPopover>` encuentra el elemento por su `id` al montarse y le añade el teclado y el anclaje:

```html
<MeekoPopover role="menu">
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
</MeekoPopover>
```

Con un componente propio, `<AppButton bind="trigger">` le pasa esas claves como props: el componente debe declararlas (por ejemplo, `defineProps<Partial<PopoverTrigger> & { variant?: "ghost" }>()`) y ponerlas en su `<button>`, que es el elemento que lleva el `id`.

Un disparador que no es un `<button>` (sin `popovertarget`) abre el contenido con el modelo: `on:click="() => open.value = !open.value"`.

### Select: `<MeekoSelect>`

> **Obsoleto desde 1.8; retirada en 2.0.** `<MeekoSelect>` sigue funcionando en 1.x y emite `MEEK121`. Usa `<UICombobox>` de `@meekojs/ui` 0.2 con su módulo activo, que conserva props, snippets y marcado `data-meeko-*`, o `<UISelect>`, un `<select>` nativo, si no necesitas `multiple`, `searchable`, `filter` ni `max`. Véase [Migración a 1.8](migration-1.8.md).

Un select accesible construido sobre `<MeekoPopover>`. `model` es el valor y su tipo sale de `options`:

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
	<MeekoSelect
		id="color"
		model="color"
		bind:options="colors"
		placeholder="Elige un color"
		name="color"
	/>

	<MeekoSelect
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
	</MeekoSelect>

	<MeekoSelect
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
| `filter`                                    | Búsqueda propia, síncrona o asíncrona.                                                                                                                                                   |
| `max`                                       | Con `multiple`, cuántas opciones se pueden elegir como mucho.                                                                                                                            |
| `field`                                     | El campo de `useForm`: `bind:field="form.field('color')"`.                                                                                                                               |
| `id`, `label`, `describedBy`, `invalid`     | `id` del disparador (para `<label for>`), su `aria-label`, `aria-describedby` y `aria-invalid`.                                                                                          |
| `class`, `listClass`, `placement`, `offset` | Clases de la raíz y de la lista, y la posición de la lista.                                                                                                                              |

`on:change` emite el valor nuevo con cada elección del usuario. Los snippets son `option` (`[option, state]`, con `state.selected`, `state.active` y `state.disabled`), `value` (cómo se ve cada valor elegido en el disparador; sin él, las etiquetas separadas por comas), `group` (el encabezado de un grupo), `empty` (sin opciones; por defecto, «Sin resultados») y `loading` (mientras carga una búsqueda asíncrona).

**Tipos.** `meeko check` y el editor infieren de la etiqueta el tipo de las opciones (`T`) y si es múltiple: el modelo de un select simple es una `Signal<T | null>` y el de uno múltiple, `Signal<T[]>`; `by`, `labelBy` y `groupBy` sólo admiten claves de `T`, y los parámetros de los snippets tienen el tipo `T`. El tipo `SelectModel<T, Multiple>` describe el valor.

**ARIA y teclado.** El disparador es un `role="combobox"` (un `<button>` o, con `searchable`, un `<input>` con `aria-autocomplete="list"`) con `aria-expanded`, `aria-controls`, `aria-haspopup="listbox"` y `aria-activedescendant`: el foco nunca sale de él. La lista es un `role="listbox"` (con `aria-multiselectable` en un select múltiple) de `role="option"` con `aria-selected` y `aria-disabled`, agrupadas en `role="group"` con `groupBy`. Un `<label for>` externo nombra el disparador por su `id`.

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
	<MeekoSelect
		model="city"
		bind:options="[]"
		by="code"
		searchable
		bind:filter="search"
		placeholder="Busca una ciudad"
	>
		<snippet name="loading">Buscando…</snippet>
		<snippet name="empty">Ninguna ciudad con ese nombre</snippet>
	</MeekoSelect>
</template>
```

**Formularios.** Con `name`, el select envía un `<input type="hidden">` por valor (uno vacío en un select simple sin valor, ninguno en uno múltiple vacío), como un `<select>` nativo; con `disabled` no envía nada. El valor de cada opción es su clave de `by`, el propio primitivo o su etiqueta. `required` impide enviar el `<form>` sin valor: el disparador recibe el foco y `aria-invalid="true"` hasta que se elige una opción. Con `useForm`, `model="form.fields.color"` funciona como en cualquier control, y `bind:field="form.field('color')"` da además el valor, el `id` del campo (para su `<label for>`), el `name`, `aria-invalid` y `aria-describedby` con el mensaje de error; `focusInvalid` lleva el foco al select cuando falla la validación. El valor inicial `""` de un campo cuenta como «sin valor» (salvo que una opción sea `""`).

```html
<form
	on:submit="form.submit"
	novalidate
>
	<label bind:for="form.field('country').id">País</label>
	<MeekoSelect
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

**Listas largas.** `<MeekoSelect>` pinta todas las opciones (en el HTML del servidor también). Para miles de opciones, use `searchable` con un `filter` que devuelva sólo las primeras coincidencias; una lista virtual que sólo pinte las visibles (`virtual`) no está disponible en `1.5`.

**Alternativa nativa.** Para un caso simple, sin búsqueda ni opciones con contenido propio, un `<select>` nativo con `model` sigue siendo la opción más ligera. En los navegadores que lo admiten, `appearance: base-select` permite estilizarlo por completo y conserva el teclado, la accesibilidad y el envío del formulario del navegador:

```css
select,
::picker(select) {
	appearance: base-select;
}
```
