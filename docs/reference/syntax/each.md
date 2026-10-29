---
title: each:of
group: syntax
since: 1.0.0
description: Repite una etiqueta por cada elemento de una lista, con su nombre, su índice y, si hace falta, una clave estable por fila.
symbols:
  - "syntax:each"
related:
  - "syntax:if-when"
  - "syntax:ref"
  - "syntax:interpolation"
  - "@meekojs/meeko#computed"
  - docs/api.md#listas-con-y-sin-eachkey
---

`each:of="lista"` repite la etiqueta en la que está, con su contenido, una vez por cada elemento de un iterable (un array, un `Set`, un `Map`, el valor de una señal…). Las demás directivas de la familia nombran el elemento (`each:as`), el índice (`each:index`) y la clave de cada fila (`each:key`).

Cuando la lista cambia, Meeko añade, quita y mueve sólo las filas necesarias: no vuelve a pintar la lista entera.

## Uso

```html
<!-- app/components/TodoList.meeko -->
<script lang="ts">
const todos = signal([
  { id: "a1", title: "Comprar té", done: false },
  { id: "b2", title: "Escribir la guía", done: true },
]);
</script>

<template>
  <ul>
    <li each:of="todos.value" each:as="todo" each:key="todo.id" each:index="i">
      {i + 1}. {todo.title}
    </li>
  </ul>
</template>
```

## Atributos

| Atributo | Tipo | Por defecto | Descripción |
| --- | --- | --- | --- |
| `each:of` | `Iterable<T>` | obligatorio | La lista. Se vuelve a leer cuando cambian sus señales; con una señal, escribe `.value`. |
| `each:as` | identificador | obligatorio | Nombre del elemento de cada fila, de tipo `T`, visible en la etiqueta y su contenido. |
| `each:index` | identificador | `index` | Nombre del índice de la fila, de tipo `number`. |
| `each:key` | expresión `string \| number` | el índice | Clave de la fila, única entre sus hermanas. Desde `1.1` es opcional. |

`each:as` y `each:index` deben ser identificadores válidos y distintos (`MEEK022`).

## Resultado

Una fila por elemento, en el orden de la lista. En el HTML, la lista y cada fila van entre comentarios de marca (`<!--meeko:for:N-->`, `<!--meeko:item:N:clave-->`) con los que la hidratación reconoce cada fila.

**Sin `each:key`**, la clave de cada fila es su índice: la fila `i` conserva sus nodos y recibe el elemento que ahora ocupa la posición `i`, y sólo se añaden o se quitan filas al final.

**Con `each:key`**, cada fila sigue a su elemento: al reordenar, insertar o borrar en medio, Meeko mueve los nodos existentes de la fila, con su estado, sus componentes hijos, el valor de sus controles y el foco.

## Ejemplos

### Una lista que sólo se muestra

Para una lista de texto que no cambia de orden, el índice basta como clave:

```html
<script lang="ts">
const props = defineProps<{ tags: string[] }>();
</script>

<template>
  <ul class="tags"><li each:of="props.tags" each:as="tag">{tag}</li></ul>
</template>
```

### Filas con estado propio

Cuando cada fila tiene un componente con señales o un control que el usuario edita, la clave mantiene ese estado con su elemento al reordenar:

```html
<script lang="ts">
const todos = signal([{ id: "a1", title: "Comprar té" }, { id: "b2", title: "Escribir la guía" }]);
function reverse(): void {
  todos.value = [...todos.value].reverse();
}
</script>

<template>
  <button type="button" on:click="reverse">Invertir</button>
  <ul>
    <li each:of="todos.value" each:as="todo" each:key="todo.id">
      <label>{todo.title} <input placeholder="Nota"></label>
    </li>
  </ul>
</template>
```

Lo que el usuario escribió en cada `<input>` acompaña a su tarea al invertir la lista. Sin `each:key`, se quedaría en la posición.

### Filtrar y ordenar con `computed`

`each:of` no filtra: deriva la lista con un `computed`, que sólo se recalcula cuando cambian sus dependencias:

```html
<script lang="ts">
const query = signal("");
const users = signal([{ id: 1, name: "Ana" }, { id: 2, name: "Luis" }]);
const visible = computed(() => {
  const q = query.value.trim().toLowerCase();
  return users.value.filter((user) => user.name.toLowerCase().includes(q)).sort((a, b) => a.name.localeCompare(b.name));
});
</script>

<template>
  <input type="search" model="query" aria-label="Buscar">
  <ul>
    <li each:of="visible.value" each:as="user" each:key="user.id">{user.name}</li>
  </ul>
  <p if:when="visible.value.length === 0">Sin resultados.</p>
</template>
```

### Un `Map` y listas anidadas

Cualquier iterable vale: un `Map` entrega pares `[clave, valor]`, que se leen por posición. Cada lista anidada nombra su propio elemento:

```html
<script lang="ts">
const groups = signal(new Map([["Bebidas", ["Té", "Café"]], ["Postres", ["Flan"]]]));
</script>

<template>
  <section each:of="groups.value" each:as="group" each:key="group[0]">
    <h3>{group[0]}</h3>
    <ul><li each:of="group[1]" each:as="item" each:index="position">{position}: {item}</li></ul>
  </section>
</template>
```

## Errores comunes

### Pasar la señal en lugar de su valor

```html bad
<li each:of="todos" each:as="todo">{todo.title}</li>
```

`meeko check` da `TS2741: Property '[Symbol.iterator]' is missing in type 'Signal<…>' but required in type 'Iterable<unknown>'.`, y después `TS18046: 'todo' is of type 'unknown'.`

```html good
<li each:of="todos.value" each:as="todo">{todo.title}</li>
```

### Olvidar `each:as`, o usar el mismo nombre para el índice

```html bad
<li each:of="todos.value">{todo.title}</li>
<li each:of="todos.value" each:as="todo" each:index="todo">{todo.title}</li>
```

`MEEK022: Una lista necesita identificadores válidos y distintos en each:as y each:index`. Lo mismo con un nombre que no es un identificador, como `each:as="todo-item"`.

```html good
<li each:of="todos.value" each:as="todo" each:index="i">{i}: {todo.title}</li>
```

### Una clave que no es texto ni número

```html bad
<li each:of="todos.value" each:as="todo" each:key="todo">{todo.title}</li>
```

`meeko check` da `TS2322: Type '{ id: string; title: string; }' is not assignable to type 'string | number'.`

```html good
<li each:of="todos.value" each:as="todo" each:key="todo.id">{todo.title}</li>
```

### `each:of` junto a `if:when`

```html bad
<li each:of="todos.value" each:as="todo" if:when="!todo.done">{todo.title}</li>
```

`MEEK021: Un nodo no puede tener if:when y each:of a la vez`. Filtra con un `computed` (véase arriba) o pon la condición en un elemento interior.

```html good
<li each:of="pending.value" each:as="todo" each:key="todo.id">{todo.title}</li>
```

### Mutar el array de la señal

Una señal avisa cuando se le asigna un valor nuevo. `push` o `splice` cambian el mismo array: la lista no se entera y no hay ningún error que lo señale.

```ts bad
todos.value.push({ id: "c3", title: "Nueva", done: false });
```

<!-- no-check -->
```ts good
todos.value = [...todos.value, { id: "c3", title: "Nueva", done: false }];
```

### Una directiva `each:` mal escrita

```html bad
<li each:of="todos.value" each:as="todo" each:by="todo.id">{todo.title}</li>
```

Desde `1.7`, `meeko check` avisa con `MEEK119: each:by no es una directiva de each:of (each:as, each:key, each:index) y se escribe como atributo HTML literal; quítalo o corrige su nombre`. Es un aviso: el HTML no cambia y la lista queda sin clave.

```html good
<li each:of="todos.value" each:as="todo" each:key="todo.id">{todo.title}</li>
```

## Notas

- **Claves.** Las claves son cadenas o números finitos, únicas entre hermanas. Usa un identificador estable del dato (`id`, `slug`), nunca `Math.random()` ni el índice disfrazado: una clave que cambia en cada render vuelve a crear la fila.
- **SSR e hidratación.** El servidor pinta todas las filas con sus marcas y el navegador las reclama en orden. La lista debe ser la misma en los dos lados; si depende del navegador, rellénala en `onMounted`.
- **Rendimiento.** Una actualización compara las claves nuevas con las anteriores y sólo crea, mueve o libera las filas que cambian. Las filas nuevas se preparan antes de retirar las anteriores: si una falla al pintarse, Meeko intenta restablecer las anteriores.
- **`ref:` en una lista.** Una `ref:` dentro de `each:of` nombra todas las filas: `useElementRef` devuelve una señal con un array de sólo lectura, en orden de documento, que no admite `await`.
- **Tipos.** `each:index` es siempre `number`, también en el editor. `each:as` tiene el tipo de los elementos del iterable, y dentro de un `if:when` exterior conserva su estrechamiento.
