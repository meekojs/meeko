---
title: if:when
group: syntax
since: 1.0.0
description: Pinta una etiqueta con su contenido sólo mientras una expresión es verdadera, y estrecha los tipos dentro de ella.
symbols:
  - "syntax:if-when"
related:
  - "syntax:each"
  - "syntax:snippet-tag"
  - "syntax:render-tag"
  - "syntax:interpolation"
  - "syntax:meekoawait"
  - docs/api.md#condiciones-con-ifwhen-y-tipos
---

`if:when="expresión"` hace que una etiqueta, con todo su contenido, exista sólo mientras la expresión es verdadera (en el sentido de JavaScript: `0`, `""`, `null` y `undefined` son falsos). Vale en elementos HTML, en etiquetas de componente, en `<component is>` y, desde `1.4`, en `<snippet>`.

Desde `1.2`, también estrecha los tipos, como `v-if` en Vue: dentro de la etiqueta, `meeko check` y el editor comprueban los atributos, las props, los eventos y el contenido sabiendo que la condición se cumple, sin `!`.

## Uso

```html
<!-- app/components/UserCard.meeko -->
<script lang="ts">
const user = signal<{ name: string; email: string } | null>(null);
</script>

<template>
  <article if:when="user.value">
    <h2>{user.value.name}</h2>
    <a bind:href="`mailto:${user.value.email}`">{user.value.email}</a>
  </article>
  <p if:when="!user.value">Sin sesión.</p>
</template>
```

Mientras `user.value` es `null`, sólo existe el segundo párrafo. Dentro del `<article>`, `user.value` es `{ name: string; email: string }` para TypeScript.

## Atributos

| Atributo | Tipo | Por defecto | Descripción |
| --- | --- | --- | --- |
| `if:when` | cualquier expresión | obligatorio | La condición. Se evalúa como booleano de JavaScript y se vuelve a evaluar cuando cambian las señales que lee. |

No hay `if:else` ni `else-if`: escribe la condición contraria en otra etiqueta (`if:when="!user.value"`). Un atributo `if:` desconocido es `MEEK024: Directiva de plantilla incompleta` y, junto a un `if:when`, el aviso `MEEK119` (desde `1.7`), porque se escribiría como atributo HTML literal.

## Resultado

- **Condición verdadera.** La etiqueta y su contenido se pintan como si no tuvieran la directiva.
- **Condición falsa.** No se pinta nada: el contenido nunca se evalúa, así que sus expresiones no se ejecutan ni fallan.
- **En el HTML.** La región va entre dos comentarios de marca, también vacía, para que la hidratación sepa dónde está.
- **Al cambiar.** Pasar a falsa libera la región (sus efectos, listeners y componentes hijos, que ejecutan su limpieza); volver a verdadera la crea de nuevo, con estado nuevo.

## Ejemplos

### Estados de una carga

Varias condiciones excluyentes cubren los estados de un recurso:

```html
<script lang="ts">
const items = useApi("/api/items");
</script>

<template>
  <p if:when="items.pending.value && !items.data.value">Cargando…</p>
  <p if:when="items.error.value" role="alert">No se pudo cargar.</p>
  <ul if:when="items.data.value">
    <li each:of="items.data.value" each:as="item" each:key="item.id">{item.name}</li>
  </ul>
</template>
```

Para una zona con sus estados de carga, error y reintento, `<MeekoAwait>` hace lo mismo con menos código y reserva la altura.

### Un componente condicional

En una etiqueta de componente, la condición estrecha también sus props:

```html
<template>
  <WorkspaceHeader if:when="session.data.value?.staff" bind:staff="session.data.value.staff" />
</template>
```

`bind:staff` recibe el tipo sin `undefined`, porque TypeScript sabe que la condición se cumple.

### Mostrar y ocultar sin perder el estado

`if:when` destruye la región al ocultarla. Para conservar el estado de un formulario o el scroll de un panel, oculta el elemento con `hidden` en lugar de quitarlo:

```html
<script lang="ts">
const open = signal(false);
const draft = signal("");
</script>

<template>
  <button type="button" bind:aria-expanded="open.value ? 'true' : 'false'" on:click="() => open.value = !open.value">Notas</button>
  <section bind:hidden="!open.value">
    <textarea model="draft"></textarea>
  </section>
</template>
```

### Un snippet opcional

En el hijo, `if:when` comprueba si el padre pasó un snippet opcional antes de pintar su contenedor:

```html
<!-- app/components/AppCard.meeko -->
<script lang="ts">
const snippets = defineSnippets<{ default: []; footer?: [] }>();
</script>

<template>
  <article class="card">
    <render snippet="snippets.default" />
    <footer if:when="snippets.footer"><render snippet="snippets.footer" /></footer>
  </article>
</template>
```

## Errores comunes

### `if:when` y `each:of` en la misma etiqueta

```html bad
<li each:of="items.value" each:as="item" if:when="item.visible">{item.name}</li>
```

`MEEK021: Un nodo no puede tener if:when y each:of a la vez`. Filtra la lista antes, o pon la condición en un elemento interior.

```html good
<li each:of="visibleItems.value" each:as="item" each:key="item.id">{item.name}</li>
```

Con `const visibleItems = computed(() => items.value.filter((item) => item.visible))` en el script.

### Esperar un `else`

```html bad
<p if:when="user.value">Hola, {user.value.name}</p>
<p if:else>Sin sesión.</p>
```

`MEEK024: Directiva de plantilla incompleta`, en `if:else`.

```html good
<p if:when="user.value">Hola, {user.value.name}</p>
<p if:when="!user.value">Sin sesión.</p>
```

### Perder el estrechamiento en una función flecha

TypeScript no conserva el estrechamiento de una propiedad dentro de una función que se ejecuta más tarde.

```html bad
<div if:when="user.value">
  <button on:click="() => save(user.value.id)">Guardar</button>
</div>
```

`meeko check` da `TS18047: 'user.value' is possibly 'null'.` en el manejador.

```html good
<div if:when="user.value">
  <button on:click="saveCurrent">Guardar</button>
</div>
```

Con `function saveCurrent(): void { if (user.value) save(user.value.id); }` en el script.

### Una condición vacía

```html bad
<p if:when>Hola</p>
```

`MEEK020: Expression expected.` La directiva necesita una expresión; para ocultar un elemento de forma estática, quítalo de la plantilla.

```html good
<p if:when="visible.value">Hola</p>
```

## Notas

- **SSR e hidratación.** El servidor evalúa la condición y pinta la rama que corresponde entre sus marcas; el navegador la evalúa otra vez al hidratar y debe obtener lo mismo. Una condición que depende del navegador (`window.innerWidth`, `localStorage`, la hora local) produce un error de hidratación: pinta esa parte en `onMounted` o guarda el dato en una señal que cambies después de montar.
- **Rendimiento.** Ocultar libera la región y mostrarla la vuelve a crear, con sus hijos. Para un panel que se abre y se cierra a menudo, `bind:hidden` es más barato y conserva el estado.
- **Tipos.** Sólo cambia la comprobación: en ejecución el contenido nunca se evalúa con la condición falsa. El estrechamiento alcanza a las condiciones y listas anidadas y a los snippets de una etiqueta de componente, salvo cuando un `each:as`, un `each:index` o un parámetro de snippet ocultan el nombre.
- **Accesibilidad.** Un mensaje que aparece con `if:when` no se anuncia solo: dale `role="alert"` o `role="status"`, o ponlo dentro de una región `aria-live` que exista siempre.
