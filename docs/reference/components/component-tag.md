---
title: <component is>
group: components
since: 1.0.0
description: Renderiza un componente elegido con una expresión, o desde 1.5 una etiqueta HTML, con props, eventos y snippets comprobados por tipos.
symbols:
  - "syntax:component-tag"
types:
  - "@meekojs/meeko#Component"
related:
  - "syntax:meekooutlet"
  - "syntax:defineprops"
  - "syntax:snippet-tag"
  - "syntax:bind"
  - "syntax:on"
  - docs/api.md#etiquetas-de-componente-appbutton-
  - docs/api.md#etiquetas-html-en-component-is
  - docs/api.md#atributos-en-bloque-con-bind
  - docs/api.md#props-estáticas
---

`<component is="expresión">` pinta el componente que devuelve la expresión: una prop que recibe un componente, el de una tabla de vistas, el elegido por una condición. Cada `bind:` pasa una prop tipada, cada `on:` un evento de su `defineEmits`, y `meeko check` comprueba las props obligatorias, sus nombres y sus tipos. Si `is` cambia, Meeko libera la instancia anterior y renderiza e hidrata la nueva en el mismo sitio.

Para un componente fijo, la etiqueta con su nombre es más corta: `<AppButton bind:label="'Guardar'" />` equivale a `<component is="AppButton" bind:label="'Guardar'"></component>`. Desde `1.5`, `is` también acepta una **etiqueta HTML** (`is="props.href ? 'a' : 'button'"`), con sus atributos, eventos y contenido.

## Uso

```html
<!-- app/components/Card.meeko -->
<script lang="ts">
import type { Component } from "@meekojs/meeko";
const props = defineProps<{ content: Component<{ label: string }>; label: string }>();
</script>

<template>
  <section class="card">
    <component is="props.content" bind:label="props.label"></component>
  </section>
</template>
```

`Component<{ label: string }>` exige que el componente recibido acepte `label`: el padre no puede pasar uno que necesite otra prop.

## Atributos

| Atributo | Tipo | Descripción |
| --- | --- | --- |
| `is` | `Component<Props>`, una etiqueta HTML o una unión de ambos | Sólo en `<component>`. Una etiqueta no permitida (`script`, `iframe`, `style`…) es `MEEK112`. |
| `bind:prop` | el tipo de la prop | Una prop con el valor de una expresión. Una prop opcional acepta `undefined`, que equivale a no pasarla. |
| `prop="texto"` | literal | Prop estática: el texto como literal (`variant="primary"`) o `true` sin valor. Los nombres con guiones no son props (`MEEK032`). |
| `bind="objeto"` | props o atributos | Desde `1.5`, props (o atributos de la etiqueta) desde un objeto, sin claves `on*`; las explícitas ganan (`MEEK113`). |
| `on:evento` | `(…args) => unknown` | La prop de callback `onEvento` de un evento de `defineEmits`. |
| `model`, `model:nombre` | `Signal<T>` | Los modelos del hijo, de `defineModel`. |
| `ref:nombre` | | Nombra la instancia para `useElementRef`; su tipo sale del `defineExpose` del hijo. |

El contenido entre las etiquetas son los snippets del componente (`<snippet name="…">` y el contenido suelto, `default`) o, con una etiqueta HTML, sus hijos.

## Resultado

Con un componente, su HTML entre los marcadores de comentario de un componente hijo; el estado del hijo viaja con él y la hidratación lo reclama. Con una etiqueta HTML cuyo valor se conoce en la sintaxis (literales en las ramas de `?:`), el elemento tal cual, sin marcadores. Cada atributo se escribe sólo mientras la etiqueta del momento lo admite: `href` en `<a>`, `type` y `disabled` en `<button>`.

## Ejemplos

### Vistas intercambiables

```html
<script lang="ts">
import * as GridView from "./GridView.meeko";
import * as ListView from "./ListView.meeko";

const props = defineProps<{ items: { id: string; name: string }[] }>();
const mode = signal<"grid" | "list">("grid");
const views = { grid: GridView, list: ListView };
</script>

<template>
  <button type="button" on:click="() => mode.value = mode.value === 'grid' ? 'list' : 'grid'">Cambiar vista</button>
  <component is="views[mode.value]" bind:items="props.items"></component>
</template>
```

Al cambiar `mode`, Meeko libera la vista anterior y monta la nueva en su sitio.

### Un botón que es un enlace (desde 1.5)

```html
<!-- app/components/AppButton.meeko -->
<script lang="ts">
const props = defineProps<{ href?: string; type?: "button" | "submit" }>();
const snippets = defineSnippets<{ default: [] }>();
</script>

<template>
  <component is="props.href ? 'a' : 'button'" class="button" bind:href="props.href" bind:type="props.type ?? 'button'">
    <render snippet="snippets.default" />
  </component>
</template>
```

Sin `href` renderiza `<button class="button" type="button">`; con él, `<a class="button" href="…">`. `type` no se escribe en `<a>` ni `href` en `<button>`.

### Una sección con la etiqueta elegida por el padre

```html
<script lang="ts">
const props = defineProps<{ as?: "section" | "article" | "aside"; title: string }>();
const snippets = defineSnippets<{ default: [] }>();
</script>

<template>
  <component is="props.as ?? 'section'" class="block" bind:aria-label="props.title">
    <render snippet="snippets.default" />
  </component>
</template>
```

### Snippets en un componente dinámico

```html
<component is="props.dialog" bind:title="'Confirmar'">
  <p>¿Seguro que quieres borrar «{item.name}»?</p>
  <snippet name="actions" params="close"><button on:click="close">Cancelar</button></snippet>
</component>
```

## Errores comunes

### Una etiqueta que no se puede renderizar

```html bad
<script lang="ts">
const tag = signal<"a" | "script">("a");
</script>
<template><component is="tag.value">x</component></template>
```

`meeko check` da `MEEK112: <script> no es una etiqueta que <component is> pueda renderizar`. El nombre de la etiqueta nunca inyecta marcado: un valor no permitido que llega en ejecución lanza `TypeError` antes de escribir HTML.

```html good
<script lang="ts">
const tag = signal<"a" | "button">("a");
</script>
<template><component is="tag.value">x</component></template>
```

### Olvidar una prop obligatoria

```html bad
<Card />
```

Con `defineProps<{ title: string; count?: number }>()` en `Card`, `meeko check` da `TS2345: Argument of type '{}' is not assignable to parameter of type '{ title: string; count?: number | undefined; } & ExtraProps'`, con `Property 'title' is missing`.

```html good
<Card title="Hola" />
```

### Una prop estática donde se espera otro tipo

```html bad
<Card title="Hola" count="3" />
```

`meeko check` da `TS2322: Type 'string' is not assignable to type 'number'`: un atributo sin prefijo pasa el texto `"3"`. Para un número, usa `bind:`:

```html good
<Card title="Hola" bind:count="3" />
```

### La misma prop estática y con `bind:`

```html bad
<Card title="Hola" bind:title="'Adiós'" />
```

`meeko check` da `MEEK090: title y bind:title pasan los dos la prop title; deja sólo el texto estático o sólo bind:title`.

```html good
<Card bind:title="'Adiós'" />
```

### Un atributo con guiones en un componente

```html bad
<Card title="Hola" data-test="card" />
```

`meeko check` da `MEEK032: Las props de un componente se pasan con prop="texto", bind:prop="expresión" u on:evento="manejador"; is, ref, html y los nombres con guiones no son props`. Un componente no tiene un elemento raíz al que pasar atributos: decláralo como prop, o ponlo en un elemento que lo envuelva.

```html good
<div data-test="card"><Card title="Hola" /></div>
```

## Notas

- **SSR e hidratación.** El servidor renderiza el componente elegido con su estado; la hidratación reclama el mismo HTML. Si `is` cambia en el navegador, la instancia anterior se libera (sus efectos, limpiezas y eventos) y la nueva se monta en los mismos marcadores.
- **Cambio de etiqueta.** Con una etiqueta HTML, un cambio de `is` crea el elemento nuevo y **mueve** a él los hijos, que conservan su estado y el foco.
- **Navegación con datos.** Un componente elegido en tiempo de ejecución obliga al navegador a hacer la pasada previa de una navegación, porque podría esperar datos con `await useApi`.
- **Seguridad.** `is` nunca interpreta texto como HTML: sólo módulos de componente o etiquetas de una lista permitida. Los elementos personalizados (`x-card`) y las etiquetas SVG no se admiten como valor de `is`.
- **Outlet.** En los layouts, [`<MeekoOutlet />`](/docs/reference/meekooutlet) equivale a `<component is="props.outlet">` sin declarar la prop.
