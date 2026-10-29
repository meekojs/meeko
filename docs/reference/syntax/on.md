---
title: on:evento
group: syntax
since: 1.0.0
description: Escucha un evento del DOM en un elemento, o un evento de defineEmits en un componente, con el evento y currentTarget tipados.
symbols:
  - "syntax:on"
related:
  - "syntax:defineemits"
  - "syntax:bind"
  - "syntax:model"
  - "@meekojs/meeko#provideErrorHandler"
  - "@meekojs/meeko#ErrorSource"
  - docs/api.md#eventos-de-componente-defineemits-y-on
  - docs/api.md#componentes-meeko
---

`on:evento="manejador"` hace dos cosas según la etiqueta:

- **En un elemento HTML o SVG**, añade un listener del DOM. Desde `1.2`, el evento tiene el tipo de `HTMLElementEventMap` para su nombre (`SVGElementEventMap` dentro de `<svg>`) y `event.currentTarget`, el del elemento: `KeyboardEvent` en `on:keydown`, `HTMLInputElement` en un `<input>`.
- **En una etiqueta de componente**, pasa la prop de callback `onEvento` de un evento que el hijo declara con `defineEmits`, con sus argumentos tipados.

El valor es una **expresión que devuelve la función**: el nombre de una función del script o una función flecha. No es código que se ejecuta al pulsar.

## Uso

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

## Atributos

| Atributo | Tipo | Por defecto | Descripción |
| --- | --- | --- | --- |
| `on:<nombre>` en un elemento | `(event: Evento & { currentTarget: Elemento }) => unknown` | ninguno | Listener del evento `<nombre>` del DOM. El nombre se escribe como en `addEventListener`: `click`, `keydown`, `pointerdown`, `submit`, `toggle`. |
| `on:<nombre>` en un componente | `(...args) => unknown` | ninguno | La prop `on<Nombre>` del hijo, con los argumentos de su `defineEmits`. El nombre es un identificador: `on:save`, `on:saveDraft`. |

No hay modificadores como `.prevent` o `.once`: llama a `event.preventDefault()` en el manejador.

## Resultado

- **Elemento.** En el navegador, `addEventListener(nombre, manejador)` al hidratar o montar, y `removeEventListener` al liberar el componente o la región (`if:when`, `each:of`). En el HTML del servidor no aparece nada.
- **Componente.** El hijo recibe la función en `props.onEvento`, y `emit("evento", …)` la llama. Sin listener, `emit` no hace nada.
- **Manejadores asíncronos.** Si el manejador devuelve una promesa, Meeko la observa: un fallo, síncrono o asíncrono, llega al observador de errores más cercano (`provideErrorHandler`) con la fuente `"event"`, sin dejar un rechazo sin manejar ni detener otros listeners. Sin observador, se escribe en la consola.

## Ejemplos

### Teclado, con el evento tipado

`on:keydown` recibe un `KeyboardEvent`, así que `event.key` se comprueba sin conversiones:

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

### Un envío asíncrono

Un manejador `async` puede esperar; si falla, el error llega al observador del componente:

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

### Eventos de un componente

El hijo declara sus eventos con `defineEmits`; el padre los escucha con `on:`:

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

### Delegar en un contenedor

Un solo listener en el contenedor atiende a todas las filas, también al HTML insertado con `html`, que no admite directivas:

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

## Errores comunes

### Llamar a la función en lugar de pasarla

```html bad
<button on:click="increment()">+1</button>
```

`increment()` se ejecutaría al renderizar y pasaría su resultado. `meeko check` da `TS2345: Argument of type 'void' is not assignable to parameter of type '(event: PointerEvent & { readonly currentTarget: HTMLButtonElement; }) => unknown'.`

```html good
<button on:click="increment">+1</button>
<button on:click="() => add(5)">+5</button>
```

### Leer `event.target.value`

`event.target` puede ser un descendiente y su tipo es `EventTarget | null`.

```html bad
<input on:input="(event) => query.value = event.target.value">
```

`meeko check` da `TS18047: 'event.target' is possibly 'null'.` y `TS2339: Property 'value' does not exist on type 'EventTarget'.`

```html good
<input on:input="(event) => query.value = event.currentTarget.value">
```

Para un enlace en los dos sentidos, `model="query"` es más corto.

### Un manejador con el tipo de otro evento

```html bad
<input on:click="onKey">
```

Con `function onKey(event: KeyboardEvent)`, `meeko check` da `TS2345` con `Type 'PointerEvent & { readonly currentTarget: HTMLInputElement; }' is missing the following properties from type 'KeyboardEvent': …`.

```html good
<input on:keydown="onKey">
```

### Modificadores al estilo de Vue

```html bad
<form on:submit.prevent="save">
```

`MEEK011: Nombre de evento no válido: submit.prevent`.

```html good
<form on:submit="save">
```

Con `event.preventDefault()` dentro de `save`.

### Un evento de componente con guion

```html bad
<TodoItem bind:id="1" on:save-draft="save" />
```

`MEEK011: Nombre de evento de componente no válido: save-draft`. En un componente, el nombre del evento es un identificador, el de la clave de `defineEmits`.

```html good
<TodoItem bind:id="1" on:saveDraft="save" />
```

### `on:save` y `bind:onSave` a la vez

```html bad
<TodoItem bind:id="1" on:save="save" bind:onSave="save" />
```

`MEEK048: on:save y bind:onSave asignan la misma prop onSave del componente; deja sólo uno`.

```html good
<TodoItem bind:id="1" on:save="save" />
```

### Un evento que el hijo no declara

```html bad
<TodoItem bind:id="1" on:remove="remove" />
```

`meeko check` da `TS2353: Object literal may only specify known properties, and '"onRemove"' does not exist in type 'EventNames<ComponentProps>'.`

```html good
<TodoItem bind:id="1" on:close="remove" />
```

## Notas

- **Servidor o navegador.** Los listeners sólo existen en el navegador. En SSR el manejador nunca se ejecuta; el botón funciona en cuanto la página se hidrata. Para que un formulario funcione sin JavaScript, dale `action` y `method` (véase `form` de `defineApiRoute`).
- **Limpieza.** Los listeners de un componente o de una región se quitan al liberarla: no hace falta `removeEventListener`. Para escuchar `window` o `document`, regístralo en `onMounted` y quítalo con `onCleanup`.
- **Atributos `on*` de HTML.** `onclick="…"` sin `:` es un atributo HTML literal, que ejecuta código en línea fuera de Meeko y que una CSP sin `'unsafe-inline'` bloquea. Usa `on:click`. `bind:onclick` da `MEEK012: Atributo dinámico no válido: onclick`.
- **Tipos.** Un nombre que no está en el mapa de eventos del elemento recibe `Event`. En un elemento personalizado, `currentTarget` es `HTMLElement`.
- **Rendimiento.** Cada `on:` es un listener; en listas largas, un listener en el contenedor con `event.target.closest(…)` evita uno por fila.
