---
title: defineEmits
group: macros
since: 1.1.0
description: Declara los eventos de un componente con sus argumentos tipados y devuelve emit, que llama al manejador on:evento del padre.
symbols:
  - "syntax:defineemits"
related:
  - "syntax:on"
  - "syntax:defineprops"
  - "syntax:definemodel"
  - "syntax:generic"
  - docs/api.md#eventos-de-componente-defineemits-y-on
---

`defineEmits<T>()` declara los eventos del componente: cada clave de `T` es un evento y su valor, la tupla de argumentos. Devuelve `emit(evento, ...args)`, tipada con esas tuplas. Es una macro de compilación: no se importa.

No hay un canal de eventos aparte: cada evento `save` es la prop de callback opcional `onSave` del hijo, y `emit("save", id)` llama a la que pasa el padre en ese momento con `on:save`. Sin listener, `emit` no hace nada.

## Uso

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

## Parámetros

| Parámetro | Tipo | Por defecto | Descripción |
| --- | --- | --- | --- |
| `T` (argumento de tipo) | `{ [evento]: [...args] }` | obligatorio | Un objeto cuyas claves son los eventos (identificadores) y cuyos valores son tuplas con nombre: `{ save: [id: number]; close: [] }`. Sin él es `MEEK046`. |

No admite argumentos en ejecución (`MEEK047`): los eventos se declaran sólo en el tipo.

## Valor devuelto

`emit(evento, ...args): void`. TypeScript comprueba que `evento` es una clave de `T` y que los argumentos coinciden con su tupla. `emit` llama de forma síncrona a la prop `on<Evento>` actual del padre; si el padre no la pasa, no hace nada.

En el padre, `ComponentProps` incluye una prop opcional `on<Evento>` por evento (`onSave?: (id: number) => unknown`), y `on:save="…"` la rellena.

## Ejemplos

### Un evento con varios argumentos

Las tuplas con nombre documentan cada argumento en el editor:

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

### Reenviar el evento de un hijo

Un componente que envuelve a otro puede reenviar su evento con su propio `emit`:

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

### Eventos genéricos

En un componente con `generic`, la tupla puede usar el parámetro, y el padre recibe el tipo inferido de las props:

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

## Errores comunes

### Sin argumento de tipo, o con argumentos en ejecución

```html bad
<script lang="ts">
const emit = defineEmits(["save"]);
</script>
```

`MEEK046: defineEmits necesita un argumento de tipo, como defineEmits<{ save: [id: number] }>()`. Con argumento de tipo y argumentos (`defineEmits<…>(["save"])`), `MEEK047: defineEmits no admite argumentos en tiempo de ejecución; declara los eventos en su argumento de tipo`.

```html good
<script lang="ts">
const emit = defineEmits<{ save: [id: number] }>();
</script>
```

### `let`, desestructuración o dos llamadas

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

### Argumentos que no coinciden con la tupla

```html bad
<button on:click="() => emit('save', String(props.id))">Guardar</button>
```

`meeko check` da `TS2345: Argument of type 'string' is not assignable to parameter of type 'number'.`

```html good
<button on:click="() => emit('save', props.id)">Guardar</button>
```

### El mismo callback en `defineProps`

```html bad
<script lang="ts">
const props = defineProps<{ id: number; onSave?: (id: number) => void }>();
const emit = defineEmits<{ save: [id: number] }>();
</script>
```

`meeko check` da `TS2344: Type '"defineEmits events conflict with defineProps props: onSave"' does not satisfy the constraint 'true'.`

```html good
<script lang="ts">
const props = defineProps<{ id: number }>();
const emit = defineEmits<{ save: [id: number] }>();
</script>
```

### Un manejador con otros argumentos en el padre

```html bad
<TodoItem bind:id="1" bind:title="'Té'" on:save="(id: string) => save(id)" />
```

`meeko check` da `TS2322: Type '(id: string) => void' is not assignable to type '(id: number) => void'.` Un evento que el hijo no declara (`on:remove`) da `TS2353`, y un nombre con guion (`on:save-draft`), `MEEK011`.

```html good
<TodoItem bind:id="1" bind:title="'Té'" on:save="(id) => save(String(id))" />
```

## Notas

- **Servidor o navegador.** `emit` sólo tiene efecto en el navegador, dentro de un manejador o un efecto. En SSR los manejadores no se ejecutan.
- **Errores.** El manejador del padre se ejecuta de forma síncrona dentro del `emit` del hijo: si lanza, el error sale de `emit`. Llamado desde un `on:` del hijo, llega al observador de errores como cualquier fallo de ese listener, con la fuente `"event"`.
- **Nombres.** Los eventos son identificadores (`save`, `saveDraft`); el padre los escucha con `on:save`, `on:saveDraft`. `on:save` y `bind:onSave` en la misma etiqueta dan `MEEK048`.
- **Dónde va.** Una sola vez, en su propia declaración `const` de nivel superior, antes del primer `await` de navegador (`MEEK058`).
- **Valores en los dos sentidos.** Para un valor que el padre y el hijo comparten (un `open`, un `value`), `defineModel` evita la pareja prop + evento.
