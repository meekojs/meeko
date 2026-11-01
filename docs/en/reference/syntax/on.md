---
title: on:evento
group: syntax
since: 1.0.0
description: Listens to a DOM event on an element or a defineEmits event on a component, with typed event and currentTarget.
symbols:
  - "syntax:on"
related:
  - docs/como-elegir.md
  - "syntax:defineemits"
  - "syntax:bind"
  - "syntax:model"
  - "@meekojs/meeko#provideErrorHandler"
  - "@meekojs/meeko#ErrorSource"
  - docs/api.md#eventos-de-componente-defineemits-y-on
  - docs/api.md#componentes-meeko
source-hash: b395eb4682ee15e53f1de212ce244cae16206fdb16011a89df60e45c6c5ea5d3
---

`on:evento="manejador"` does two things depending on the tag:

- **On an HTML or SVG element**, adds a DOM listener. Since `1.2`, the event uses its named type from `HTMLElementEventMap` (`SVGElementEventMap` inside `<svg>`) and `event.currentTarget` uses the element's type: `KeyboardEvent` in `on:keydown`, `HTMLInputElement` on an `<input>`.
- **On a component tag**, passes the `onEvento` callback prop for an event declared by the child with `defineEmits`, with typed arguments.

The value is an **expression returning the function**: a script function's name or an arrow function. It is not code executed on click.

## Usage

```html
<!-- app/components/Counter.meeko -->
<script lang="ts">
const count = signal(0);
const query = signal("");
function increment(): void {
  count.value++;
}
</script>

<template>
  <button type="button" on:click="increment">{count.value}</button>
  <input on:input="(event) => query.value = event.currentTarget.value" aria-label="Buscar">
</template>
```

## Attributes

| Attribute                    | Type                                                       | Default | Description                                                                                                                        |
| ---------------------------- | ---------------------------------------------------------- | ------- | ---------------------------------------------------------------------------------------------------------------------------------- |
| `on:<nombre>` on an element  | `(event: Evento & { currentTarget: Elemento }) => unknown` | none    | DOM listener for event `<nombre>`. Write the name as in `addEventListener`: `click`, `keydown`, `pointerdown`, `submit`, `toggle`. |
| `on:<nombre>` on a component | `(...args) => unknown`                                     | none    | The child's `on<Nombre>` prop, with arguments from its `defineEmits`. The name is an identifier: `on:save`, `on:saveDraft`.        |

There are no modifiers such as `.prevent` or `.once`: call `event.preventDefault()` in the handler.

## Result

- **Element.** In the browser, `addEventListener(nombre, manejador)` during hydration or mounting, and `removeEventListener` when disposing of the component or region (`if:when`, `each:of`). Nothing appears in server HTML.
- **Component.** The child receives the function in `props.onEvento`, and `emit("evento", …)` calls it. Without a listener, `emit` does nothing.
- **Asynchronous handlers.** If the handler returns a promise, Meeko observes it: a synchronous or asynchronous failure reaches the nearest error observer (`provideErrorHandler`) with source `"event"`, without leaving an unhandled rejection or stopping other listeners. Without an observer, it is written to the console.

## Examples

### Keyboard, with a typed event

`on:keydown` receives a `KeyboardEvent`, so `event.key` is checked without casts:

```html
<script lang="ts">
const items = signal(["Té", "Café", "Agua"]);
const active = signal(0);
function onKey(event: KeyboardEvent): void {
  if (event.key === "ArrowDown") active.value = Math.min(active.value + 1, items.value.length - 1);
  else if (event.key === "ArrowUp") active.value = Math.max(active.value - 1, 0);
  else return;
  event.preventDefault();
}
</script>

<template>
  <ul role="listbox" tabindex="0" aria-label="Bebidas" on:keydown="onKey">
    <li each:of="items.value" each:as="item" each:index="i" role="option" bind:aria-selected="i === active.value ? 'true' : 'false'">{item}</li>
  </ul>
</template>
```

### An asynchronous submission

An `async` handler can await; if it fails, the error reaches the component's observer:

```html
<script lang="ts">
const saving = signal(false);
provideErrorHandler((error, source) => {
  console.error(`Fallo en ${source}`, error);
});
async function save(event: SubmitEvent): Promise<void> {
  event.preventDefault();
  saving.value = true;
  try {
    const form = new FormData(event.currentTarget as HTMLFormElement);
    await fetch("/api/notes", { method: "POST", body: form });
  } finally {
    saving.value = false;
  }
}
</script>

<template>
  <form on:submit="save">
    <textarea name="text" aria-label="Nota"></textarea>
    <button bind:disabled="saving.value">Guardar</button>
  </form>
</template>
```

### Component events

The child declares events with `defineEmits`; the parent listens with `on:`:

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
<TodoItem bind:id="todo.id" bind:title="todo.title" on:save="(id) => save(id)" on:close="() => open.value = false" />
```

### Delegate to a container

A single listener on the container handles all rows, including HTML inserted with `html`, which does not accept directives:

```html
<script lang="ts">
import type { TrustedHtml } from "@meekojs/meeko";

const props = defineProps<{ body: TrustedHtml }>();
function onClick(event: MouseEvent): void {
  const link = (event.target as Element | null)?.closest("a[data-term]");
  if (link) console.log(link.getAttribute("data-term"));
}
</script>

<template><article html="props.body" on:click="onClick"></article></template>
```

## Common mistakes

### Call the function instead of passing it

```html bad
<button on:click="increment()">+1</button>
```

`increment()` would run during rendering and pass its result. `meeko check` reports `TS2345: Argument of type 'void' is not assignable to parameter of type '(event: PointerEvent & { readonly currentTarget: HTMLButtonElement; }) => unknown'.`

```html good
<button on:click="increment">+1</button>
<button on:click="() => add(5)">+5</button>
```

### Read `event.target.value`

`event.target` can be a descendant and its type is `EventTarget | null`.

```html bad
<input on:input="(event) => query.value = event.target.value">
```

`meeko check` reports `TS18047: 'event.target' is possibly 'null'.` and `TS2339: Property 'value' does not exist on type 'EventTarget'.`

```html good
<input on:input="(event) => query.value = event.currentTarget.value">
```

For two-way binding, `model="query"` is shorter.

### A handler typed for another event

```html bad
<input on:click="onKey">
```

With `function onKey(event: KeyboardEvent)`, `meeko check` reports `TS2345` with `Type 'PointerEvent & { readonly currentTarget: HTMLInputElement; }' is missing the following properties from type 'KeyboardEvent': …`.

```html good
<input on:keydown="onKey">
```

### Vue-style modifiers

```html bad
<form on:submit.prevent="save">
```

`MEEK011: Nombre de evento no válido: submit.prevent`.

```html good
<form on:submit="save">
```

With `event.preventDefault()` inside `save`.

### A hyphenated component event

```html bad
<TodoItem bind:id="1" on:save-draft="save" />
```

`MEEK011: Nombre de evento de componente no válido: save-draft`. On a component, the event name is an identifier, the key in `defineEmits`.

```html good
<TodoItem bind:id="1" on:saveDraft="save" />
```

### Both `on:save` and `bind:onSave`

```html bad
<TodoItem bind:id="1" on:save="save" bind:onSave="save" />
```

`MEEK048: on:save y bind:onSave asignan la misma prop onSave del componente; deja sólo uno`.

```html good
<TodoItem bind:id="1" on:save="save" />
```

### An event not declared by the child

```html bad
<TodoItem bind:id="1" on:remove="remove" />
```

`meeko check` reports `TS2353: Object literal may only specify known properties, and '"onRemove"' does not exist in type 'EventNames<ComponentProps>'.`

```html good
<TodoItem bind:id="1" on:close="remove" />
```

## Notes

- **Server or browser.** Listeners only exist in the browser. In SSR, the handler never runs; the button works once the page hydrates. For a form that works without JavaScript, give it `action` and `method` (see `form` in `defineApiRoute`).
- **Cleanup.** A component's or region's listeners are removed on disposal: no `removeEventListener` is needed. To listen to `window` or `document`, register in `onMounted` and remove with `onCleanup`.
- **HTML `on*` attributes.** `onclick="…"` without `:` is a literal HTML attribute, executing inline code outside Meeko and blocked by a CSP without `'unsafe-inline'`. Use `on:click`. `bind:onclick` produces `MEEK012: Atributo dinámico no válido: onclick`.
- **Types.** A name absent from the element's event map receives `Event`. On a custom element, `currentTarget` is `HTMLElement`.
- **Performance.** Each `on:` is a listener; in long lists, one container listener with `event.target.closest(…)` avoids one per row.
