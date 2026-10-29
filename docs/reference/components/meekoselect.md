---
title: <MeekoSelect>
group: components
since: 1.5.0
description: Select accesible sin estilos sobre MeekoPopover, con opciones de cualquier tipo, selección múltiple, búsqueda, grupos y envío en formularios.
symbols:
  - "syntax:meekoselect"
types:
  - "@meekojs/meeko/framework#MeekoSelectProps"
  - "@meekojs/meeko/framework#SelectModel"
  - "@meekojs/meeko/framework#SelectSnippets"
related:
  - "syntax:meekopopover"
  - "@meekojs/meeko/framework#useForm"
  - "syntax:model"
  - "@meekojs/meeko#useId"
  - docs/api.md#select-meekoselect
  - docs/api.md#componentes-integrados
---

Un `<select>` nativo no admite opciones con contenido propio, búsqueda ni grupos con estilo. `<MeekoSelect>` es un select construido sobre [`<MeekoPopover>`](/docs/reference/meekopopover) con el patrón ARIA de *combobox* y *listbox*: el foco se queda en el disparador y `aria-activedescendant` marca la opción activa. `model` es el valor y su tipo sale de `options`, que pueden ser primitivos u objetos.

No tiene estilos visuales: las opciones llevan `data-active`, `data-selected` y `data-disabled`, y la raíz `data-open`. No se importa; sólo los componentes que la usan cargan su código.

## Uso

```html
<!-- app/components/AssigneePicker.meeko -->
<script lang="ts">
interface User { id: number; name: string; team: string }
const props = defineProps<{ users: User[] }>();
const assignee = signal<User | null>(null);
</script>

<template>
  <label for="assignee">Responsable</label>
  <MeekoSelect id="assignee" model="assignee" bind:options="props.users" by="id" placeholder="Elige a alguien">
    <snippet name="option" params="user, state">{user.name} <span if:when="state.selected">✓</span></snippet>
  </MeekoSelect>
</template>
```

`by="id"` compara las opciones con el valor por su `id`; `meeko check` sólo admite claves de `User`.

## Props

| Atributo | Tipo | Por defecto | Descripción |
| --- | --- | --- | --- |
| `bind:options` | `readonly T[]` | obligatorio | Las opciones. Es reactiva: una lista nueva actualiza la lista abierta. |
| `model` | `Signal<T \| null>`, o `Signal<T[]>` con `multiple` | ninguno | El valor elegido. |
| `multiple` | `boolean` | `false` | El modelo es un array y cada opción se alterna. |
| `by` | clave de `T` o `(a, b) => boolean` | `Object.is` | Cómo se compara una opción con el valor. |
| `labelBy`, `disabledBy`, `groupBy` | clave de `T` o función | texto, `label`/`name`; `disabled: true`; sin grupos | Etiqueta, si está deshabilitada y grupo de cada opción. |
| `placeholder` | `string` | ninguno | Texto sin valor elegido. |
| `name` | `string` | ninguno | `name` de los `<input type="hidden">` que se envían con el `<form>`. |
| `required`, `disabled` | `boolean` | `false` | Como en un control nativo. |
| `searchable` | `boolean` | `false` | El disparador es un `<input>` que filtra las opciones sin distinguir mayúsculas ni acentos. |
| `bind:filter` | `(query, { options, signal }) => T[] \| Promise<T[]>` | filtro por etiqueta | Búsqueda propia, también asíncrona. |
| `bind:max` | `number` | sin límite | Con `multiple`, cuántas opciones se pueden elegir. |
| `bind:field` | `form.field('x')` de `useForm` | ninguno | Da el valor, el `id`, el `name`, `aria-invalid` y `aria-describedby` del campo. |
| `id`, `label`, `describedBy`, `invalid` | | | `id` del disparador (para `<label for>`), su `aria-label`, `aria-describedby` y `aria-invalid`. |
| `class`, `listClass`, `placement`, `bind:offset` | | | Clases de la raíz y de la lista, y posición de la lista. |
| `on:change` | `(value) => void` | ninguno | Se emite con cada elección del usuario. |

Snippets: `option` (`[option, state]`, con `state.selected`, `state.active` y `state.disabled`), `value` (cómo se ve cada valor elegido en el disparador), `group` (el encabezado de un grupo), `empty` (sin opciones; por defecto, «Sin resultados») y `loading` (mientras carga una búsqueda asíncrona).

## Resultado

- La raíz, con `data-meeko-select` y `data-open`, `data-multiple`, `data-disabled` y `data-loading`.
- El disparador: un `role="combobox"` (un `<button>` o, con `searchable`, un `<input>` con `aria-autocomplete="list"`) con `aria-expanded`, `aria-controls`, `aria-haspopup="listbox"` y `aria-activedescendant`.
- La lista: un `role="listbox"` (con `aria-multiselectable` si es múltiple) de `role="option"` con `aria-selected` y `aria-disabled`, agrupadas en `role="group"` con `groupBy`.
- Con `name`, un `<input type="hidden">` por valor (uno vacío en un select simple sin valor). El valor de cada opción es su clave de `by`, el primitivo o su etiqueta.

El HTML del servidor trae todas las opciones y el valor elegido en el disparador.

## Ejemplos

### Selección múltiple con búsqueda y grupos

```html
<script lang="ts">
interface Tag { slug: string; name: string; category: string }
const props = defineProps<{ tags: Tag[] }>();
const chosen = signal<Tag[]>([]);
</script>

<template>
  <MeekoSelect model="chosen" multiple searchable bind:options="props.tags" by="slug" labelBy="name" groupBy="category" bind:max="3" name="tags" label="Etiquetas" />
</template>
```

Al llegar a 3, las demás opciones quedan `aria-disabled="true"` y `data-disabled` hasta que se quite una.

### Búsqueda en el servidor

```html
<script lang="ts">
interface City { code: string; name: string }
const city = signal<City | null>(null);
const search = (query: string, { signal }: { signal: AbortSignal }): Promise<City[]> =>
  fetch(`/api/cities?q=${encodeURIComponent(query)}`, { signal }).then((response) => response.json());
</script>

<template>
  <MeekoSelect model="city" bind:options="[]" by="code" searchable bind:filter="search" placeholder="Busca una ciudad">
    <snippet name="loading">Buscando…</snippet>
    <snippet name="empty">Ninguna ciudad con ese nombre</snippet>
  </MeekoSelect>
</template>
```

Una búsqueda nueva aborta la anterior (`signal`) y descarta su respuesta. Con la búsqueda vacía se muestran `options` sin llamar a `filter`.

### En un formulario de `useForm`

```html
<script lang="ts">
const countries = ["España", "México", "Argentina"];
const form = useForm({ initial: { country: "" }, submit: (values) => api.profile.put({ body: values }) });
</script>

<template>
  <form on:submit="form.submit" novalidate>
    <label bind:for="form.field('country').id">País</label>
    <MeekoSelect bind:field="form.field('country')" bind:options="countries" placeholder="Elige un país" />
    <p if:when="form.errors.value.country" bind:id="form.field('country').errorId">{form.errors.value.country}</p>
    <button>Guardar</button>
  </form>
</template>
```

El valor inicial `""` cuenta como «sin valor». Con `focusInvalid`, el foco va al select cuando falla la validación.

### Estilos

```css
[data-meeko-select] [role="option"][data-active] { background: var(--hover); }
[data-meeko-select] [role="option"][data-selected]::after { content: " ✓"; }
[data-meeko-select] [data-meeko-popover] { max-height: 16rem; }
```

## Errores comunes

### Un modelo simple en un select múltiple

```html bad
<script lang="ts">
const tags = signal<string | null>(null);
</script>
<template><MeekoSelect model="tags" multiple bind:options="['a', 'b']" /></template>
```

`meeko check` da `TS2322: Type 'Signal<string | null>' is not assignable to type 'Signal<string[]>'`: con `multiple`, el modelo es un array.

```html good
<script lang="ts">
const tags = signal<string[]>([]);
</script>
<template><MeekoSelect model="tags" multiple bind:options="['a', 'b']" /></template>
```

### Una clave de `by` que no existe

```html bad
<MeekoSelect model="user" bind:options="users.value" by="uuid" />
```

`meeko check` da `TS2322: Type '"uuid"' is not assignable to type '"id" | "name" | ((a: User, b: User) => boolean) | undefined'`: `by`, `labelBy` y `groupBy` sólo admiten claves de las opciones.

```html good
<MeekoSelect model="user" bind:options="users.value" by="id" />
```

### Miles de opciones

```html bad
<MeekoSelect model="product" bind:options="allProducts" />
```

No hay error, pero `<MeekoSelect>` pinta todas las opciones, también en el HTML del servidor: con miles, la página pesa y el teclado va lento. Usa `searchable` con un `filter` que devuelva sólo las primeras coincidencias:

```html good
<MeekoSelect model="product" bind:options="[]" searchable bind:filter="searchProducts" />
```

## Notas

- **Alternativa nativa.** Para un caso simple, sin búsqueda ni opciones con contenido propio, un `<select>` con `model` es más ligero. En los navegadores que lo admiten, `appearance: base-select` permite estilizarlo por completo.
- **Teclado.** `↓`, `↑`, `Intro` o `Espacio` abren sobre la opción elegida; las flechas, `Inicio`, `Fin`, `RePág` y `AvPág` mueven la opción activa sin dar la vuelta; las letras buscan por el principio de la etiqueta. `Intro` elige; en un select simple, elegir cierra la lista; `Alt+↑` elige y cierra; `Esc` cierra sin cambiar el valor.
- **Formularios.** Con `name`, el select envía sus valores como un `<select>` nativo; con `disabled` no envía nada. `required` impide enviar el `<form>` sin valor y marca el disparador con `aria-invalid="true"`.
- **SSR e hidratación.** Los IDs del disparador, la lista y las opciones salen de `useId`. La búsqueda nunca se ejecuta en el servidor.
- **Nombre propio.** Un componente del proyecto llamado `MeekoSelect` tiene prioridad sobre la etiqueta, con el aviso `MEEK106`.
