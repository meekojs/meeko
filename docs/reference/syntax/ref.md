---
title: ref:nombre
group: syntax
since: 1.0.0
description: Nombra un elemento o un componente de la plantilla para leerlo desde el script con useElementRef, con el tipo de su etiqueta o de su defineExpose.
symbols:
  - "syntax:ref"
related:
  - "syntax:useelementref"
  - "syntax:defineexpose"
  - "syntax:each"
  - "@meekojs/meeko#onMounted"
  - docs/api.md#referencias-a-elementos-ref-y-useelementref
---

`ref:nombre`, sin valor, nombra un elemento o un componente de la plantilla. El script lo lee con [`useElementRef("nombre")`](/docs/reference/useelementref), cuyo tipo sale de la etiqueta: `HTMLInputElement` para un `<input>`, `SVGSVGElement` para un `<svg>` y, en un componente, el valor de su `defineExpose`.

Es la vía para lo que la plantilla no expresa: enfocar un campo, medir un elemento, desplazarse hasta él o llamar a un método que expone un componente hijo.

## Uso

```html
<!-- app/components/SearchPanel.meeko -->
<script lang="ts">
const input = useElementRef("input");

onMounted(() => {
  input.value?.focus();
});
</script>

<template>
  <input ref:input type="search" aria-label="Buscar">
</template>
```

## Atributos

| Atributo | Tipo | Por defecto | Descripción |
| --- | --- | --- | --- |
| `ref:<nombre>` | sin valor | ninguno | Nombra la etiqueta. `<nombre>` es un identificador, único en la plantilla. |

Vale en elementos HTML y SVG, en etiquetas de componente y en `<component is>`. No vale en `<template>`, ni dentro del contenido de un `<snippet>` (o del contenido suelto de una etiqueta de componente, que es el snippet `default`).

## Resultado

Nada en el HTML. En el script, `useElementRef("nombre")` devuelve:

| Dónde está la `ref:` | Sin `await` | Con `await` |
| --- | --- | --- |
| Un elemento | `ReadonlySignal<Elemento \| null>`: `null` en SSR, antes de hidratar y mientras un `if:when` lo oculta | El elemento, nunca `null`; el resto del setup sigue sólo en el navegador |
| Un componente | `ReadonlySignal<Expuesto \| null>`, con el valor de su `defineExpose` | El valor expuesto |
| Dentro de `each:of` | `ReadonlySignal<readonly Elemento[]>`, en orden de documento | No admite `await` (`MEEK056`) |

## Ejemplos

### Llamar a un componente hijo

El hijo publica lo que el padre puede usar con `defineExpose`; el padre lo nombra con `ref:`:

```html
<!-- app/components/SearchBox.meeko -->
<script lang="ts">
const query = signal("");
function clear(): void {
  query.value = "";
}
defineExpose({ query, clear });
</script>

<template><input type="search" model="query" aria-label="Buscar"></template>
```

```html
<!-- app/components/Toolbar.meeko -->
<script lang="ts">
const box = useElementRef("box");
function reset(): void {
  box.value?.clear();
}
</script>

<template>
  <SearchBox ref:box />
  <button type="button" on:click="reset">Limpiar</button>
</template>
```

### Las filas de una lista

Una sola `ref:` dentro de `each:of` nombra todas las filas:

```html
<script lang="ts">
const items = signal(["Té", "Café", "Agua"]);
const rows = useElementRef("row");
function focusLast(): void {
  rows.value.at(-1)?.focus();
}
</script>

<template>
  <ul>
    <li each:of="items.value" each:as="item" ref:row tabindex="-1">{item}</li>
  </ul>
  <button type="button" on:click="focusLast">Ir al último</button>
</template>
```

### Un elemento que se monta más tarde

Con `await`, el setup espera a que el elemento exista, también si está bajo un `if:when` todavía falso. Lo que viene después sólo se ejecuta en el navegador:

```html
<script lang="ts">
const width = signal(0);
const chart = await useElementRef("chart");
const observer = new ResizeObserver(([entry]) => {
  width.value = entry?.contentRect.width ?? 0;
});
observer.observe(chart);
onCleanup(() => observer.disconnect());
</script>

<template><div ref:chart class="chart"></div></template>
```

La plantilla no puede leer `observer`, que se declara después del `await`, pero sí `width`, declarada antes.

## Errores comunes

### Darle un valor

```html bad
<h2 ref:title="heading">Buscar</h2>
```

`MEEK052: ref:title no lleva valor; escribe ref:title`.

```html good
<h2 ref:title>Buscar</h2>
```

### Escribir `ref="x"` como en Vue

`ref="x"` es un atributo HTML literal, no la directiva.

```html bad
<h2 ref="title">Buscar</h2>
```

Con `useElementRef("title")` en el script, `meeko check` da `MEEK056: La plantilla no tiene ref:title; añade ref:title a un elemento o a un componente`. En un componente, `ref="x"` da `MEEK032`.

```html good
<h2 ref:title>Buscar</h2>
```

### El mismo nombre en dos lugares

```html bad
<h2 ref:title>Buscar</h2>
<p ref:title>Resultados</p>
```

`MEEK053: ref:title ya se usa en la línea 1; una ref nombra un solo lugar de la plantilla (las filas de each:of la comparten)`. Dos `ref:` en el mismo elemento dan `MEEK052: Un elemento o componente admite una sola directiva ref:`.

```html good
<h2 ref:title>Buscar</h2>
<p ref:results>Resultados</p>
```

### Una `ref:` dentro del contenido de un componente

El contenido de una etiqueta de componente es un snippet, que el hijo puede pintar varias veces.

```html bad
<AppDialog><p ref:body>Texto</p></AppDialog>
```

`MEEK052: ref: no se admite dentro del contenido de <snippet>, que el hijo puede renderizar cualquier número de veces`.

```html good
<AppDialog ref:dialog><p>Texto</p></AppDialog>
```

Pon la `ref:` en el componente y deja que exponga lo que necesites, o en un elemento fuera de él.

### Un nombre que no es un identificador

```html bad
<h2 ref:main-title>Buscar</h2>
```

`MEEK052: Nombre de ref no válido: "main-title"; usa un identificador, como ref:input`.

```html good
<h2 ref:mainTitle>Buscar</h2>
```

## Notas

- **SSR.** Una `ref:` no existe en el servidor: la señal vale `null` en SSR y al principio de la hidratación. Cuando se ejecuta `onMounted`, cada `ref:` visible ya tiene su valor.
- **Tipos.** El tipo sale de la plantilla, no de una anotación: un `<input>` da `HTMLInputElement`, sin conversiones. En un `<component is>` con etiquetas, es la unión de sus elementos; en un componente genérico, el valor expuesto con el `T` que infiere la etiqueta.
- **Hidratación.** No uses la `ref:` para escribir en el DOM antes de montar: lo que cambies fuera de Meeko no se conserva si la región se vuelve a crear (`if:when`, `each:of`).
- **Accesibilidad.** Al mover el foco con una `ref:`, hazlo como respuesta a una acción del usuario; enfocar un campo al cargar la página desorienta a los lectores de pantalla.
- **Otras formas.** `bind:ref` en un componente pasa una prop llamada `ref`; en un elemento, un atributo `ref`.
