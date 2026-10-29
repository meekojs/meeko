---
title: defineSnippets
group: macros
since: 1.1.0
description: Declara los snippets de un componente, contenido de plantilla que el padre escribe entre sus etiquetas, con sus parámetros tipados.
symbols:
  - "syntax:definesnippets"
related:
  - "syntax:snippet-tag"
  - "syntax:render-tag"
  - "syntax:defineprops"
  - "syntax:generic"
  - "@meekojs/meeko#Snippet"
  - docs/api.md#snippets-con-definesnippets
  - docs/framework.md#tipos-de-cada-componente
---

`defineSnippets<T>()` declara los snippets del componente: trozos de plantilla que el padre escribe entre las etiquetas del hijo y que el hijo pinta donde quiere con `<render>`. Cada clave de `T` es un snippet y su valor, la tupla de parámetros que el hijo le pasa; `?` lo hace opcional. Es una macro de compilación: no se importa.

El contenido suelto entre las etiquetas es el snippet `default`; los demás se escriben con [`<snippet name="…">`](/docs/reference/snippet-tag).

## Uso

```html
<!-- app/components/AppDialog.meeko -->
<script lang="ts">
const snippets = defineSnippets<{ default: []; title?: []; actions?: [close: () => void] }>();
const open = signal(true);
function close(): void {
  open.value = false;
}
</script>

<template>
  <section if:when="open.value">
    <h2 if:when="snippets.title"><render snippet="snippets.title" /></h2>
    <render snippet="snippets.default" />
    <footer if:when="snippets.actions"><render snippet="snippets.actions" args="close" /></footer>
  </section>
</template>
```

```html
<AppDialog>
  <p>¿Borrar la nota?</p>
  <snippet name="title">Confirmar</snippet>
  <snippet name="actions" params="close"><button type="button" on:click="close">Cancelar</button></snippet>
</AppDialog>
```

## Parámetros

| Parámetro | Tipo | Por defecto | Descripción |
| --- | --- | --- | --- |
| `T` (argumento de tipo) | `{ [nombre]: [...params] \| Snippet<Args> }` | obligatorio | Cada clave es un snippet y su valor, la tupla de parámetros (`[]` sin parámetros). Desde `1.4`, el valor también puede ser un `Snippet<Args>`, que cuenta como `Args`. Una clave opcional (`title?:`) hace opcional el snippet. Sin argumento de tipo es `MEEK060`. |

No admite argumentos en ejecución (`MEEK060`).

## Valor devuelto

Un objeto con un `Snippet<Args>` por clave (`undefined` si el padre no pasa uno opcional). Se usa en la plantilla:

- `<render snippet="snippets.x" args="a, b" />` pinta el snippet con esos argumentos;
- `if:when="snippets.x"` comprueba si el padre lo pasó.

Los snippets no son props: no aparecen en `ComponentProps`. El módulo compilado exporta su tipo en `ComponentSnippets`, y cada componente autoimportado tiene además `<Nombre>Snippets` (`AppDialogSnippets`).

## Ejemplos

### Una lista con fila y estado vacío

```html
<!-- app/components/AppList.meeko -->
<script lang="ts" generic="T extends { id: string }">
const props = defineProps<{ items: T[] }>();
const snippets = defineSnippets<{ item: [item: T, index: number]; empty?: [] }>();
</script>

<template>
  <ul if:when="props.items.length">
    <li each:of="props.items" each:as="item" each:key="item.id" each:index="i"><render snippet="snippets.item" args="item, i" /></li>
  </ul>
  <div if:when="!props.items.length"><render snippet="snippets.empty" /></div>
</template>
```

```html
<AppList bind:items="notes.value">
  <snippet name="item" params="note, index">{index + 1}. {note.title}</snippet>
  <snippet name="empty">No hay notas.</snippet>
</AppList>
```

### Reutilizar los snippets de otro componente

Desde `1.4`, `T` puede partir del tipo de snippets de otro componente y recortarlo o ampliarlo. Un modal que envuelve una card declara los de la card salvo `footer`, añade `actions` y los reenvía:

```html
<!-- app/components/AppModal.meeko -->
<script lang="ts">
const open = defineModel<boolean>();
const snippets = defineSnippets<Omit<AppCardSnippets, "footer"> & { actions?: [close: () => void] }>();
function close(): void {
  open.value = false;
}
</script>

<template>
  <AppCard if:when="open.value">
    <render snippet="snippets.default" />
    <snippet name="footer" if:when="snippets.actions"><render snippet="snippets.actions" args="close" /></snippet>
  </AppCard>
</template>
```

`AppCardSnippets` se autoimporta con el nombre de la etiqueta. Cada snippet conserva sus parámetros y su `?`.

### Un snippet con varias acciones

Los parámetros pueden ser funciones del hijo, que el padre usa sin conocer su estado:

```html
<!-- app/components/AppStepper.meeko -->
<script lang="ts">
const props = defineProps<{ steps: number }>();
const snippets = defineSnippets<{ step: [index: number, next: () => void, back: () => void] }>();
const current = signal(0);
const next = (): void => { current.value = Math.min(current.value + 1, props.steps - 1); };
const back = (): void => { current.value = Math.max(current.value - 1, 0); };
</script>

<template><render snippet="snippets.step" args="current.value, next, back" /></template>
```

## Errores comunes

### Argumentos en ejecución, o sin argumento de tipo

```html bad
<script lang="ts">
const snippets = defineSnippets<{ default: [] }>({ default: [] });
</script>
```

`MEEK060: defineSnippets no admite argumentos en tiempo de ejecución; declara los snippets en su argumento de tipo`. Sin argumento de tipo: `MEEK060: defineSnippets necesita un argumento de tipo, como defineSnippets<{ default: [] }>()`.

```html good
<script lang="ts">
const snippets = defineSnippets<{ default: [] }>();
</script>
```

### Pintar un snippet sin sus argumentos

```html bad
<render snippet="snippets.actions" />
```

Con `actions: [close: () => void]`, `meeko check` da `TS2345: Argument of type '[]' is not assignable to parameter of type '[close: () => void]'.`

```html good
<render snippet="snippets.actions" args="close" />
```

### No pasar un snippet obligatorio, o pasar uno que no existe

```html bad
<AppDialog>
  <snippet name="footer">Pie</snippet>
</AppDialog>
```

`meeko check` da `TS2741: Property 'default' is missing in type …` y `TS2353: Object literal may only specify known properties, and '"footer"' does not exist in type 'SnippetMap<{ default: []; title?: []; actions?: [close: () => void]; }>'.`

```html good
<AppDialog>
  <p>Texto</p>
  <snippet name="title">Pie</snippet>
</AppDialog>
```

### Contenido para un componente sin snippets

Un componente sin `defineSnippets` no admite contenido.

```html bad
<!-- app/components/AppBox.meeko, sin defineSnippets -->
<AppBox><p>Hola</p></AppBox>
```

`meeko check` da `TS2322: Type 'Snippet<any[]>' is not assignable to type '"this component declares no defineSnippets, so it accepts no children or <snippet>"'.` Declara `default` en el hijo:

```html good
<!-- app/components/AppBox.meeko -->
<script lang="ts">
const snippets = defineSnippets<{ default: [] }>();
</script>

<template><div class="box"><render snippet="snippets.default" /></div></template>
```

## Notas

- **Ámbito.** El contenido de un snippet pertenece al padre: lee sus señales y funciones, sigue siendo reactivo y se libera con el padre o el hijo. Lo que el hijo quiera darle va en los argumentos.
- **SSR e hidratación.** El snippet se pinta dentro del DOM del hijo, entre comentarios de marca, igual en el servidor que en el navegador.
- **Copias en el setup.** Como con las props, `const hasFooter = Boolean(snippets.footer)` conserva el valor inicial: léelo en la plantilla o en un `computed`, porque el padre puede empezar o dejar de pasarlo con `<snippet if:when>`.
- **Dónde va.** Una sola vez, en su propia declaración `const` de nivel superior con un nombre simple (`MEEK059`), antes del primer `await` de navegador (`MEEK058`).
- **Tipos.** Un valor que no es una tupla ni un `Snippet` es `TS2344`. Las tuplas con nombre (`[close: () => void]`) dan nombres a los parámetros en el editor.
