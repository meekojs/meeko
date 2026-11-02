---
title: each:of
group: syntax
since: 1.0.0
description: Repeats a tag for each item in a list, with its name, index and, if needed, a stable key per row.
symbols:
  - "syntax:each"
related:
  - "syntax:if-when"
  - "syntax:ref"
  - "syntax:interpolation"
  - "@meekojs/meeko#computed"
  - docs/api.md#listas-con-y-sin-eachkey
source-hash: 56c8f5bd32fd9ce13f479838659ad96957fed82b04b80d2f50f0b8f7ec2b411b
---

`each:of="lista"` repeats its tag, with its content, once for each item in an iterable (an array, a `Set`, a `Map`, a signal's value…). Other directives in the family name the item (`each:as`), index (`each:index`) and each row's key (`each:key`).

When the list changes, Meeko adds, removes and moves only the necessary rows: it does not render the entire list again.

## Usage

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

## Attributes

| Attribute    | Type                          | Default   | Description                                                                 |
| ------------ | ----------------------------- | --------- | --------------------------------------------------------------------------- |
| `each:of`    | `Iterable<T>`                 | required  | The list. Read again when its signals change; for a signal, write `.value`. |
| `each:as`    | identifier                    | required  | Each row's item name, of type `T`, visible in the tag and its content.      |
| `each:index` | identifier                    | `index`   | The row index's name, of type `number`.                                     |
| `each:key`   | `string \| number` expression | the index | Row key, unique among siblings. Optional since `1.1`.                       |

`each:as` and `each:index` must be valid, distinct identifiers (`MEEK022`).

## Result

One row per item, in list order. In HTML, the list and each row sit between marker comments (`<!--meeko:for:N-->`, `<!--meeko:item:N:clave-->`) that hydration uses to identify each row.

**Without `each:key`**, each row's key is its index: row `i` keeps its nodes and receives the item now occupying position `i`, and rows are only added or removed at the end.

**With `each:key`**, each row follows its item: when reordering, inserting or deleting in the middle, Meeko moves the row's existing nodes, with their state, child components, control values and focus.

## Examples

### A display-only list

For a text list that does not change order, the index is enough as a key:

```html
<script lang="ts">
const props = defineProps<{ tags: string[] }>();
</script>

<template>
  <ul class="tags"><li each:of="props.tags" each:as="tag">{tag}</li></ul>
</template>
```

### Rows with their own state

When each row has a component with signals or a control the user edits, the key keeps that state with its item when reordering:

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

What the user typed in each `<input>` follows its task when reversing the list. Without `each:key`, it would stay at its position.

### Filter and sort with `computed`

`each:of` does not filter: derive the list with a `computed`, which only recalculates when its dependencies change:

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

### A `Map` and nested lists

Any iterable works: a `Map` yields `[clave, valor]` pairs, read by position. Each nested list names its own item:

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

## Common mistakes

### Passing the signal instead of its value

```html bad
<li each:of="todos" each:as="todo">{todo.title}</li>
```

`meeko check` reports `TS2741: Property '[Symbol.iterator]' is missing in type 'Signal<…>' but required in type 'Iterable<unknown>'.`, followed by `TS18046: 'todo' is of type 'unknown'.`

```html good
<li each:of="todos.value" each:as="todo">{todo.title}</li>
```

### Forgetting `each:as`, or using the same name for the index

```html bad
<li each:of="todos.value">{todo.title}</li>
<li each:of="todos.value" each:as="todo" each:index="todo">{todo.title}</li>
```

`MEEK022: Una lista necesita identificadores válidos y distintos en each:as y each:index`. The same applies to a name that is not an identifier, such as `each:as="todo-item"`.

```html good
<li each:of="todos.value" each:as="todo" each:index="i">{i}: {todo.title}</li>
```

### A key that is neither a string nor a number

```html bad
<li each:of="todos.value" each:as="todo" each:key="todo">{todo.title}</li>
```

`meeko check` reports `TS2322: Type '{ id: string; title: string; }' is not assignable to type 'string | number'.`

```html good
<li each:of="todos.value" each:as="todo" each:key="todo.id">{todo.title}</li>
```

### `each:of` alongside `if:when`

```html bad
<li each:of="todos.value" each:as="todo" if:when="!todo.done">{todo.title}</li>
```

`MEEK021: Un nodo no puede tener if:when y each:of a la vez`. Filter with a `computed` (see above) or put the condition on an inner element.

```html good
<li each:of="pending.value" each:as="todo" each:key="todo.id">{todo.title}</li>
```

### Mutating the signal's array

A signal notifies when assigned a new value. `push` or `splice` change the same array: the list does not notice and no error points it out.

```ts bad
todos.value.push({ id: "c3", title: "Nueva", done: false });
```

<!-- no-check -->

```ts good
todos.value = [...todos.value, { id: "c3", title: "Nueva", done: false }];
```

### A misspelled `each:` directive

```html bad
<li each:of="todos.value" each:as="todo" each:by="todo.id">{todo.title}</li>
```

Since `1.7`, `meeko check` warns with `MEEK119: each:by no es una directiva de each:of (each:as, each:key, each:index) y se escribe como atributo HTML literal; quítalo o corrige su nombre`. This is a warning: the HTML does not change and the list has no key.

```html good
<li each:of="todos.value" each:as="todo" each:key="todo.id">{todo.title}</li>
```

## Notes

- **Keys.** Keys are strings or finite numbers, unique among siblings. Use a stable data identifier (`id`, `slug`), never `Math.random()` or a disguised index: a key changing on every render recreates the row.
- **SSR and hydration.** The server renders every row with its markers and the browser claims them in order. The list must be the same on both sides; if it depends on the browser, populate it in `onMounted`.
- **Performance.** An update compares new and previous keys and only creates, moves or disposes of changed rows. New rows are prepared before removing previous ones: if rendering one fails, Meeko attempts to restore the previous rows.
- **`ref:` in a list.** A `ref:` inside `each:of` names all rows: `useElementRef` returns a signal containing a read-only array, in document order, which does not support `await`.
- **Types.** `each:index` is always `number`, including in the editor. `each:as` has the iterable's item type, and preserves its narrowing inside an outer `if:when`.
