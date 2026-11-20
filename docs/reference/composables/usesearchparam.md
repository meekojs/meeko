---
title: useSearchParam
group: composables
since: 1.10.0
description: Devuelve una señal editable enlazada a un parámetro de la query string, validada con un Standard Schema y con valor por defecto; escribirla navega por el router.
symbols:
  - "@meekojs/meeko/framework#useSearchParam"
types:
  - "@meekojs/meeko/framework#SearchParamOptions"
related:
  - "@meekojs/meeko/framework#useRoute"
  - "@meekojs/meeko/framework#navigate"
  - "@meekojs/meeko/framework#useStorage"
  - "@meekojs/meeko/framework#definePage"
  - docs/routing-navigation-reference.md#parámetros-de-búsqueda-como-estado
---

`useSearchParam(name, initial, options)` convierte un parámetro de la URL en estado del componente: una pestaña, un filtro, el orden o la página de una lista. Leer la señal da el valor de la ruta confirmada, validado y transformado por `schema`, o `initial` cuando falta o no es válido. Escribirla cambia la URL y navega por el router, así que los datos de la página se vuelven a cargar como al seguir un enlace a esa URL, y un enlace compartido o una recarga abren la misma vista.

Se autoimporta en los componentes y composables de `app/`. Pídalo en el script, como `useRoute`, y escriba la señal donde quiera, también en un manejador de eventos.

## Uso

```html
<!-- app/pages/users/[id].meeko -->
<script lang="ts">
	const tab = useSearchParam('tab', 'perfil')
</script>

<template>
	<nav>
		<button bind:aria-pressed="tab.value === 'perfil'" on:click="() => (tab.value = 'perfil')">Perfil</button>
		<button bind:aria-pressed="tab.value === 'actividad'" on:click="() => (tab.value = 'actividad')">Actividad</button>
	</nav>
	<p>Pestaña: {tab.value}</p>
</template>
```

En `/users/42` vale `"perfil"`; al pulsar «Actividad», la URL pasa a `/users/42?tab=actividad`. Volver a «Perfil» quita el parámetro, porque es el valor por defecto.

## Parámetros

| Parámetro         | Tipo                     | Por defecto | Descripción                                                                                                                                             |
| ----------------- | ------------------------ | ----------- | ------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `name`            | `string`                 | obligatorio | Nombre del parámetro de la query string, como `"tab"`.                                                                                                  |
| `initial`         | `T`                      | obligatorio | Valor cuando el parámetro falta o no cumple `schema`. Escribirlo quita el parámetro de la URL. Sin `schema`, es un texto.                               |
| `options.schema`  | Standard Schema síncrono | ninguno     | Valida y transforma el valor de la URL: un texto o, si la clave se repite, una lista de textos. Su salida da el tipo `T`. Sin él, el valor es el texto. |
| `options.history` | `"replace"` \| `"push"`  | `"replace"` | `"replace"` sustituye la entrada del historial; `"push"` añade otra, para que el botón atrás vuelva al valor anterior.                                  |

## Valor devuelto

Un `Signal<T>`:

- **`value` al leer.** El valor del parámetro en la ruta confirmada, tras pasar por `schema`; `initial` si falta o no es válido. Nunca lanza por lo que traiga la URL. Es reactivo: cambia al confirmarse una navegación, también por el historial.
- **`value` al escribir.** Navega a la URL actual con el parámetro cambiado. Mientras la navegación está pendiente, la señal ya devuelve el valor escrito; si falla o se cancela, vuelve al de la URL. Escribir el valor que ya tiene no hace nada.

Al escribir, el valor pasa a la URL así: un texto, un número, un booleano o un `bigint`, como texto; una fecha, con `toISOString()`; una lista, como la clave repetida (`?tag=a&tag=b`). `null`, `undefined` y el valor igual a `initial` quitan el parámetro. Otro valor, como un objeto, lanza `TypeError`.

## Ejemplos

### La página de una lista, como número

```html
<!-- app/pages/products/index.meeko -->
<script server lang="ts">
	import * as v from 'valibot'

	export const route = definePage({ search: v.object({ page: v.optional(v.pipe(v.string(), v.toNumber(), v.integer(), v.minValue(1)), '1') }) })
	const { search } = usePage()
	export const products = await rpc.products.list({ page: search.page })
</script>

<script lang="ts">
	import * as v from 'valibot'

	const page = useSearchParam('page', 1, { schema: v.pipe(v.string(), v.toNumber(), v.integer(), v.minValue(1)) })
</script>

<template>
	<ul><li each:of="products" each:as="product" each:key="product.id">{product.name}</li></ul>
	<button bind:disabled="page.value === 1" on:click="() => page.value--">Anterior</button>
	<button on:click="() => page.value++">Siguiente</button>
</template>
```

`page.value++` lleva a `?page=2`: el código de servidor vuelve a ejecutarse con la página nueva y la lista se actualiza sin recargar el documento. `?page=abc` o `?page=0` en la URL dan `1`.

### Un filtro en el historial

```html
<script lang="ts">
	const status = useSearchParam('status', 'all', { history: 'push' })
</script>

<template>
	<select model="status">
		<option value="all">Todos</option>
		<option value="open">Abiertos</option>
		<option value="closed">Cerrados</option>
	</select>
</template>
```

Con `history: "push"`, cada filtro es una entrada del historial y atrás vuelve al anterior.

### Varios parámetros a la vez

```html
<script lang="ts">
	const sort = useSearchParam('sort', 'name')
	const page = useSearchParam('page', '1')
	const sortBy = (key: string) => {
		sort.value = key
		page.value = '1'
	}
</script>
```

Dos escrituras seguidas se acumulan: la segunda parte de la URL de la primera, así que la URL final lleva los dos cambios y la navegación anterior se cancela.

## Errores comunes

### Un schema asíncrono

```ts bad
const query = useSearchParam('q', '', { schema: v.pipeAsync(v.string(), v.checkAsync(isAllowed)) })
```

Leer la señal lanza `TypeError: useSearchParam("q"): the schema must validate synchronously`: el valor se lee al renderizar, sin esperar. Valide en el servidor lo que necesite una consulta y deje en el schema las comprobaciones síncronas:

<!-- no-check -->

```ts good
const query = useSearchParam('q', '', { schema: v.pipe(v.string(), v.maxLength(100)) })
```

### Un valor por defecto de otro tipo

```ts bad
const page = useSearchParam('page', 1)
```

`meeko check` da `TS2345: Argument of type 'number' is not assignable to parameter of type 'string'`: sin `schema`, el valor es el texto de la URL. Para un número, transforme el texto con un schema:

<!-- no-check -->

```ts good
const page = useSearchParam('page', 1, { schema: v.pipe(v.string(), v.toNumber(), v.integer()) })
```

### Escribirla en el servidor

```html bad
<script lang="ts">
	const tab = useSearchParam('tab', 'perfil')
	if (tab.value === 'antigua') tab.value = 'perfil'
</script>
```

El script también se ejecuta en SSR, donde la URL es la de la petición y la señal es de sólo lectura: lanza `Error: useSearchParam("tab"): la URL sólo se puede escribir en el navegador; en el servidor el valor es de sólo lectura.` Para corregir una URL antigua, redirija en el servidor (con `redirect()`) o trate el valor como inválido en el schema, para que valga `initial`:

```html good
<script lang="ts">
	import * as v from 'valibot'

	const tab = useSearchParam('tab', 'perfil', { schema: v.picklist(['perfil', 'actividad']) })
</script>
```

## Notas

- **SSR.** Lee la query de la petición y es de sólo lectura. La hidratación lee lo mismo, sin desajustes, también en una página prerenderizada que el hosting sirve con otra query: justo después de hidratar, la señal pasa a la de la barra de direcciones.
- **Qué recarga.** Escribir es una navegación a la misma ruta con otra query: se ejecutan el middleware de ruta, el loader o el código de nivel superior y los `await` de datos de la página, y `useNavigation().pending` vale `true` mientras tanto. La página se vuelve a montar con la URL nueva y los layouts se conservan. Para un estado que sólo filtra datos ya cargados, sin volver al servidor, una señal propia es más barata.
- **Campos de texto.** Como la página se vuelve a montar al confirmar, un `<input>` de la página que escribe la señal en cada tecla pierde el foco. Escriba al enviar el formulario o al salir del campo (`on:change`), o ponga el campo en un layout.
- **Otros parámetros y fragmento.** Se conservan, en el mismo orden; un parámetro con un solo valor mantiene su posición en la query.
- **Scroll y animación.** Con `"replace"` el scroll se mantiene; con `"push"`, la entrada nueva empieza arriba, como un enlace. Si la URL tiene `#fragmento`, el navegador vuelve a ese elemento. La navegación no usa View Transitions.
- **Schema de la página.** El valor sale de la query de la URL, no de `useRoute().search`: así un parámetro que el schema `search` de `definePage` no declara, o que transforma, se lee igual. Si la página valida el parámetro con `definePage({ search })`, un valor que la página rechaza responde `400` en esa navegación.
- **Fuera de una aplicación.** Lanza el error de `useRoute()`, porque lo usa.
