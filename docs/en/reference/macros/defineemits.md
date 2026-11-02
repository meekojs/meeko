---
title: defineEmits
group: macros
since: 1.1.0
description: Declares a component's events with typed arguments and returns emit, which calls the parent's on:evento handler.
symbols:
  - "syntax:defineemits"
related:
  - "syntax:on"
  - "syntax:defineprops"
  - "syntax:definemodel"
  - "syntax:generic"
  - docs/api.md#eventos-de-componente-defineemits-y-on
source-hash: 85523c50ae12b12956b3a9947dd6c75a2ba140a94cf9fc9fb3b12faf3db5cd8e
---

`defineEmits<T>()` declares the component's events: each key of `T` is an event and its value is the argument tuple. It returns `emit(evento, ...args)`, typed with those tuples. It is a compile-time macro: you do not import it.

There is no separate event channel: each `save` event is the child's optional `onSave` callback prop, and `emit("save", id)` calls the one currently passed by the parent with `on:save`. Without a listener, `emit` does nothing.

## Usage

```html
<!-- app/components/TodoItem.meeko -->
<script lang="ts">
const props = defineProps<{ id: number; title: string }>();
const emit = defineEmits<{ save: [id: number]; close: [] }>();
</script>

<template>
  <p>{props.title}</p>
  <button type="button" on:click="() => emit('save', props.id)">Guardar</button>
  <button type="button" on:click="() => emit('close')">Cerrar</button>
</template>
```

```html
<!-- en el padre -->
<TodoItem bind:id="todo.id" bind:title="todo.title" on:save="(id) => save(id)" on:close="() => open.value = false" />
```

## Parameters

| Parameter           | Type                      | Default  | Description                                                                                                                                           |
| ------------------- | ------------------------- | -------- | ----------------------------------------------------------------------------------------------------------------------------------------------------- |
| `T` (type argument) | `{ [evento]: [...args] }` | required | An object whose keys are events (identifiers) and whose values are named tuples: `{ save: [id: number]; close: [] }`. Omitting it produces `MEEK046`. |

Does not accept runtime arguments (`MEEK047`): events are declared only in the type.

## Return value

`emit(evento, ...args): void`. TypeScript checks that `evento` is a key of `T` and that arguments match its tuple. `emit` synchronously calls the parent's current `on<Evento>` prop; if the parent does not pass one, it does nothing.

In the parent, `ComponentProps` includes an optional `on<Evento>` prop per event (`onSave?: (id: number) => unknown`), and `on:save="…"` fills it.

## Examples

### An event with multiple arguments

Named tuples document each argument in the editor:

```html
<!-- app/components/AppRating.meeko -->
<script lang="ts">
const props = defineProps<{ max?: number }>({ max: 5 });
const emit = defineEmits<{ rate: [value: number, previous: number | null] }>();
const value = signal<number | null>(null);
function pick(next: number): void {
  const previous = value.value;
  value.value = next;
  emit("rate", next, previous);
}
const stars = computed(() => Array.from({ length: props.max }, (_, index) => index + 1));
</script>

<template>
  <button each:of="stars.value" each:as="star" type="button" bind:aria-pressed="value.value === star ? 'true' : 'false'" on:click="() => pick(star)">{star}</button>
</template>
```

```html
<AppRating on:rate="(value, previous) => console.log(value, previous)" />
```

### Forward a child's event

A wrapper component can forward its child's event with its own `emit`:

```html
<!-- app/components/TodoRow.meeko -->
<script lang="ts">
const props = defineProps<{ id: number; title: string }>();
const emit = defineEmits<{ save: [id: number] }>();
</script>

<template>
  <li><TodoItem bind:id="props.id" bind:title="props.title" on:save="(id) => emit('save', id)" /></li>
</template>
```

### Generic events

In a component with `generic`, the tuple can use the parameter, and the parent receives the type inferred from props:

```html
<!-- app/components/AppList.meeko -->
<script lang="ts" generic="T extends { id: string }">
const props = defineProps<{ items: T[] }>();
const emit = defineEmits<{ select: [item: T] }>();
</script>

<template>
  <ul><li each:of="props.items" each:as="item" each:key="item.id" on:click="() => emit('select', item)">{item.id}</li></ul>
</template>
```

## Common mistakes

### No type argument, or runtime arguments

```html bad
<script lang="ts">
const emit = defineEmits(["save"]);
</script>
```

`MEEK046: defineEmits necesita un argumento de tipo, como defineEmits<{ save: [id: number] }>()`. With a type argument and arguments (`defineEmits<…>(["save"])`), `MEEK047: defineEmits no admite argumentos en tiempo de ejecución; declara los eventos en su argumento de tipo`.

```html good
<script lang="ts">
const emit = defineEmits<{ save: [id: number] }>();
</script>
```

### `let`, destructuring or two calls

```html bad
<script lang="ts">
let emit = defineEmits<{ save: [id: number] }>();
</script>
```

`MEEK045: defineEmits debe aparecer una sola vez, en su propia declaración const de nivel superior con un nombre simple`.

```html good
<script lang="ts">
const emit = defineEmits<{ save: [id: number] }>();
</script>
```

### Arguments that do not match the tuple

```html bad
<button on:click="() => emit('save', String(props.id))">Guardar</button>
```

`meeko check` reports `TS2345: Argument of type 'string' is not assignable to parameter of type 'number'.`

```html good
<button on:click="() => emit('save', props.id)">Guardar</button>
```

### The same callback in `defineProps`

```html bad
<script lang="ts">
const props = defineProps<{ id: number; onSave?: (id: number) => void }>();
const emit = defineEmits<{ save: [id: number] }>();
</script>
```

`meeko check` reports `TS2344: Type '"defineEmits events conflict with defineProps props: onSave"' does not satisfy the constraint 'true'.`

```html good
<script lang="ts">
const props = defineProps<{ id: number }>();
const emit = defineEmits<{ save: [id: number] }>();
</script>
```

### A parent handler with different arguments

```html bad
<TodoItem bind:id="1" bind:title="'Té'" on:save="(id: string) => save(id)" />
```

`meeko check` reports `TS2322: Type '(id: string) => void' is not assignable to type '(id: number) => void'.` An undeclared child event (`on:remove`) produces `TS2353`, and a hyphenated name (`on:save-draft`) produces `MEEK011`.

```html good
<TodoItem bind:id="1" bind:title="'Té'" on:save="(id) => save(String(id))" />
```

## Notes

- **Server or browser.** `emit` only has an effect in the browser, inside a handler or effect. Handlers do not run in SSR.
- **Errors.** The parent's handler runs synchronously inside the child's `emit`: if it throws, the error escapes `emit`. When called from a child's `on:`, it reaches the error observer like any listener failure, with source `"event"`.
- **Names.** Events are identifiers (`save`, `saveDraft`); the parent listens with `on:save`, `on:saveDraft`. `on:save` and `bind:onSave` on the same tag produce `MEEK048`.
- **Location.** Once, in its own top-level `const` declaration, before the first browser `await` (`MEEK058`).
- **Values in both directions.** For a value shared by parent and child (an `open`, a `value`), `defineModel` avoids the prop + event pair.
