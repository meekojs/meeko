---
title: useElementRef
group: macros
since: 1.1.0
description: Lee desde el script el elemento o el componente que la plantilla nombra con ref:, como señal o, con await, ya montado.
symbols:
  - "syntax:useelementref"
related:
  - "syntax:ref"
  - "syntax:defineexpose"
  - "@meekojs/meeko#onMounted"
  - "@meekojs/meeko#ReadonlySignal"
  - docs/api.md#referencias-a-elementos-ref-y-useelementref
  - docs/api.md#composables-de-nivel-superior-y-await
---

`useElementRef("nombre")` lee el elemento o el componente que la plantilla nombra con `ref:nombre`. Su tipo sale de la plantilla: `HTMLInputElement` para un `<input>`, `SVGSVGElement` para un `<svg>` y, en un componente, el valor de su `defineExpose`. Es una macro de compilación: no se importa, y sólo se llama en el nivel superior del `<script>`.

Sin `await` devuelve una señal que vale `null` hasta que el elemento existe. Con `await`, el elemento ya montado, y el resto del setup continúa sólo en el navegador.

## Uso

```html
<!-- app/components/SearchPanel.meeko -->
<script lang="ts">
const input = useElementRef("input");

onMounted(() => {
  input.value?.focus();
});
</script>

<template><input ref:input type="search" aria-label="Buscar"></template>
```

`input` es `ReadonlySignal<HTMLInputElement | null>`; en `onMounted`, cada `ref:` visible ya tiene su valor.

## Parámetros

| Parámetro | Tipo | Por defecto | Descripción |
| --- | --- | --- | --- |
| `name` | literal de texto | obligatorio | El nombre de una `ref:` de la plantilla, como `"input"`. Una variable, una plantilla literal o un nombre que la plantilla no tiene dan `MEEK056`. |

## Valor devuelto

| Forma | Destino | Devuelve |
| --- | --- | --- |
| `useElementRef("x")` | un elemento | `ReadonlySignal<Elemento \| null>`: `null` en SSR, antes de hidratar, mientras un `if:when` lo oculta y después de liberarlo |
| `useElementRef("x")` | un componente | `ReadonlySignal<Expuesto \| null>`, con el valor de su `defineExpose` (`null` sin él) |
| `useElementRef("x")` | dentro de `each:of` | `ReadonlySignal<readonly Elemento[]>`, en orden de documento |
| `await useElementRef("x")` | un elemento o un componente | El elemento o el valor expuesto, nunca `null`. Espera a que exista, también bajo un `if:when` todavía falso |

## Ejemplos

### Medir un elemento

Un observador se crea en el navegador y se libera con el componente:

```html
<script lang="ts">
const box = useElementRef("box");
const width = signal(0);

onMounted(() => {
  const target = box.value;
  if (!target) return;
  const observer = new ResizeObserver(([entry]) => {
    width.value = entry?.contentRect.width ?? 0;
  });
  observer.observe(target);
  onCleanup(() => observer.disconnect());
});
</script>

<template><div ref:box class="box">{Math.round(width.value)} px</div></template>
```

### Las filas de una lista

```html
<script lang="ts">
const items = signal(["Té", "Café", "Agua"]);
const rows = useElementRef("row");
function focusFirst(): void {
  rows.value[0]?.focus();
}
</script>

<template>
  <ul><li each:of="items.value" each:as="item" ref:row tabindex="-1">{item}</li></ul>
  <button type="button" on:click="focusFirst">Primera</button>
</template>
```

### Esperar el elemento con `await`

El primer `await` de navegador divide el setup: lo anterior se ejecuta en SSR y al hidratar; lo posterior, sólo en el navegador una vez montado el componente.

```html
<script lang="ts">
const status = signal("Preparando el gráfico…");
const canvas = await useElementRef("chart");
const context = canvas.getContext("2d");
context?.fillRect(0, 0, canvas.width / 2, canvas.height);
status.value = "Listo";
</script>

<template>
  <p role="status">{status.value}</p>
  <canvas ref:chart width="320" height="160"></canvas>
</template>
```

`canvas` es `HTMLCanvasElement`, sin `null`. La plantilla puede leer `status`, declarada antes del `await`, pero no `context`, que sólo existe en el navegador.

## Errores comunes

### Llamarla dentro de una función

```html bad
<script lang="ts">
onMounted(() => {
  const title = useElementRef("title");
  title.value?.focus();
});
</script>
```

`MEEK054: useElementRef() debe llamarse en el nivel superior de <script>, no dentro de una función, un handler, un effect ni onMounted`. Dentro de un `if`, un bucle o un bloque, el mensaje es `… debe llamarse sin condiciones en el nivel superior de <script>…`.

```html good
<script lang="ts">
const title = useElementRef("title");
onMounted(() => {
  title.value?.focus();
});
</script>
```

### Un nombre que no es un literal, o que no existe

```html bad
<script lang="ts">
const title = useElementRef("tittle");
</script>
<template><h2 ref:title>Buscar</h2></template>
```

`MEEK056: La plantilla no tiene ref:tittle; sus refs son "title"`. Con una variable: `MEEK056: useElementRef necesita un literal de texto con el nombre de una directiva ref: de la plantilla, como useElementRef("input")`.

```html good
<script lang="ts">
const title = useElementRef("title");
</script>
<template><h2 ref:title>Buscar</h2></template>
```

### Leer `.value` sin comprobar `null`

```html bad
<script lang="ts">
const title = useElementRef("title");
title.value.focus();
</script>
```

`meeko check` da `TS18047: 'title.value' is possibly 'null'.` Además, en el nivel superior se ejecutaría en SSR, donde el elemento no existe.

```html good
<script lang="ts">
const title = useElementRef("title");
onMounted(() => title.value?.focus());
</script>
```

### Usar en la plantilla un nombre declarado después del `await`

```html bad
<script lang="ts">
const input = await useElementRef("input");
const label = signal("Hola");
</script>
<template><input ref:input><p>{label.value}</p></template>
```

`MEEK057: La plantilla no puede usar label: se declara en la línea 3, después del primer await de navegador, y sólo existe en el navegador una vez montado el componente. Declara ese nombre antes de ese await`.

```html good
<script lang="ts">
const label = signal("Hola");
const input = await useElementRef("input");
</script>
<template><input ref:input><p>{label.value}</p></template>
```

### Macros después del `await`

```html bad
<script lang="ts">
const input = await useElementRef("input");
const props = defineProps<{ label: string }>();
</script>
```

`MEEK058: defineProps debe ir antes del primer await de navegador (await useElementRef o await useSocket), tras el cual el código sólo continúa en el navegador`.

```html good
<script lang="ts">
const props = defineProps<{ label: string }>();
const input = await useElementRef("input");
</script>
```

### Esperar una lista, o un componente sin `defineExpose`

```html bad
<script lang="ts">
const rows = await useElementRef("row");
</script>
<template><li each:of="items" each:as="item" ref:row>{item}</li></template>
```

`MEEK056: ref:row está dentro de each:of y nombra una lista; lee useElementRef("row").value en lugar de esperarla con await`. Sobre un componente sin `defineExpose`, el error es `MEEK080`.

```html good
<script lang="ts">
const items = ["Té", "Café"];
const rows = useElementRef("row");
</script>
<template><li each:of="items" each:as="item" ref:row>{item}</li></template>
```

### Desestructurar la señal

```html bad
<script lang="ts">
const { value } = useElementRef("input");
</script>
```

`MEEK015: useElementRef no admite desestructuración: asigna la ref a un nombre simple, como const input = useElementRef("input"), y lee input.value cuando la necesites`.

```html good
<script lang="ts">
const input = useElementRef("input");
</script>
```

## Notas

- **SSR.** No hay elementos en el servidor: la señal vale `null` y el código posterior a un `await useElementRef` no se ejecuta. Nada de lo que hagas con el elemento llega al HTML del servidor.
- **Hidratación.** La señal recibe el elemento al hidratar o al montar; un `onMounted` ya lo ve. Si un `if:when` oculta el elemento, la señal vuelve a `null`.
- **Continuación.** Lo que sigue a un `await useElementRef` pertenece al componente: sus `effect`, `onCleanup` y composables se liberan al desmontarlo, y si se desmonta mientras espera, la continuación no se reanuda. Un fallo llega al observador de errores con la fuente `"mounted"`.
- **Tipos.** El tipo se deduce de la etiqueta: no hace falta anotar ni convertir. En un `<component is>` con varias etiquetas, es la unión de sus elementos.
