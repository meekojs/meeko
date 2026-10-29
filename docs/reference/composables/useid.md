---
title: useId
group: composables
since: 1.5.0
description: Devuelve un ID único por instancia y llamada, igual en el HTML del servidor y al hidratar, para enlazar etiquetas, controles y textos de ayuda.
symbols:
  - "@meekojs/meeko#useId"
related:
  - "@meekojs/meeko/framework#useForm"
  - "syntax:meekoselect"
  - "syntax:meekopopover"
  - "syntax:bind"
  - docs/api.md#ids-estables-useid
  - docs/framework.md#componentes-de-campo-formfield
---

Los atributos que enlazan elementos (`id` con `for`, `aria-describedby`, `aria-controls`, `aria-labelledby`) necesitan un ID que no se repita en la página. En un componente reutilizable no sirve uno fijo, y uno aleatorio cambiaría entre el servidor y el navegador y rompería la hidratación. `useId()` devuelve un ID que sale de la **posición de la instancia** en el árbol y del orden de la llamada en su script: distinto en cada instancia, idéntico en el SSR y al hidratar, sin viajar en el payload.

Se exporta desde `@meekojs/meeko` y se autoimporta en las aplicaciones del framework; un export propio del proyecto con el mismo nombre tiene prioridad.

## Uso

```html
<!-- app/components/AppSwitch.meeko -->
<script lang="ts">
const props = defineProps<{ label: string; hint?: string }>();
const on = defineModel<boolean>();
const id = useId();
</script>

<template>
  <input type="checkbox" role="switch" bind:id="id" bind:aria-describedby="props.hint ? `${id}-hint` : null" model="on">
  <label bind:for="id">{props.label}</label>
  <p if:when="props.hint" bind:id="`${id}-hint`">{props.hint}</p>
</template>
```

Dos `<AppSwitch>` en la misma página tienen IDs distintos, y cada uno es el mismo en el HTML del servidor y tras hidratar.

## Parámetros

`useId()` no recibe parámetros.

## Valor devuelto

Un `string` con el prefijo de la aplicación, `-`, la posición y un contador: `m-0`, `m-2_f0n3-1` o, para posiciones largas o con otros caracteres, un hash (`m-h1x2y3…-0`). Sólo lleva letras, números, `-` y `_`, así que sirve también en un selector CSS. No dependas de su forma, que puede cambiar entre versiones.

Fuera del script de un componente devuelve un ID único en el proceso o la página (`m-u0`, `m-u1`…) que **no** coincide entre servidor y navegador.

## Ejemplos

### Varios elementos de un mismo campo

Cada llamada da un ID nuevo. Para varios elementos de un mismo campo, deriva sufijos de uno solo:

```html
<!-- app/components/AppTextField.meeko -->
<script lang="ts">
const props = defineProps<{ label: string; error?: string }>();
const value = defineModel<string>();
const id = useId();
</script>

<template>
  <label bind:for="id">{props.label}</label>
  <input bind:id="id" model="value" bind:aria-invalid="props.error ? 'true' : null" bind:aria-describedby="props.error ? `${id}-error` : null">
  <p if:when="props.error" bind:id="`${id}-error`" role="alert">{props.error}</p>
</template>
```

### Un disclosure accesible

```html
<!-- app/components/AppDisclosure.meeko -->
<script lang="ts">
const props = defineProps<{ title: string }>();
const snippets = defineSnippets<{ default: [] }>();
const open = signal(false);
const panelId = useId();
</script>

<template>
  <button type="button" bind:aria-expanded="String(open.value)" bind:aria-controls="panelId" on:click="() => open.value = !open.value">{props.title}</button>
  <div bind:id="panelId" bind:hidden="!open.value"><render snippet="snippets.default" /></div>
</template>
```

### Dentro de una lista

Cada fila de `each:of` es una posición propia, así que el mismo componente tiene un ID distinto en cada fila. Con `each:key`, la fila conserva su ID aunque la lista cambie de orden:

```html
<ul>
  <li each:of="tasks.value" each:as="task" each:key="task.id"><AppSwitch bind:label="task.title" /></li>
</ul>
```

### Un prefijo propio

Dos aplicaciones Meeko en la misma página repetirían sus IDs. `document.idPrefix` cambia el prefijo en el servidor y en el navegador a la vez:

```ts
// meeko.config.ts
import { defineMeekoConfig } from "@meekojs/meeko/framework";

export default defineMeekoConfig({ document: { idPrefix: "shop" } });
```

## Errores comunes

### Llamarlo en un manejador o en la plantilla

Fuera del script, el ID no sale de la posición de la instancia.

```html bad
<script lang="ts">
const fieldId = (): string => useId();
</script>
<template><label bind:for="fieldId()">Nombre</label><input bind:id="fieldId()"></template>
```

No hay error de compilación, pero cada llamada da un ID distinto (la etiqueta y el campo ya no se enlazan) y, como se ejecuta durante el render, el del servidor y el del navegador no coinciden. Llámalo una vez en el nivel superior del script:

```html good
<script lang="ts">
const fieldId = useId();
</script>
<template><label bind:for="fieldId">Nombre</label><input bind:id="fieldId"></template>
```

### Escribir `for` sin `bind:`

```html bad
<label for="id">Nombre</label>
```

`meeko check` lo acepta, pero el atributo es el texto literal `"id"`, no el valor de la variable: la etiqueta no se enlaza.

```html good
<label bind:for="id">Nombre</label>
```

### Llamarlo tras un `await` de navegador

Lo que va después de `await useElementRef(...)` o `await useSocket(...)` sólo se ejecuta en el navegador, así que su ID no existe en el HTML del servidor.

```ts bad
const panel = await useElementRef("panel");
const titleId = useId();
```

Además, la plantilla no puede usar `titleId`: `meeko check` da `MEEK057`. Llama a `useId` antes del primer `await`:

<!-- no-check -->
```ts good
const titleId = useId();
const panel = await useElementRef("panel");
```

## Notas

- **Determinista.** El ID sale del componente que contiene a la instancia, la clave de su fila en `each:of`, el `if:when` o el snippet que la pintan y el orden de la llamada. El servidor y el navegador recorren las mismas posiciones.
- **Único.** Dos instancias nunca comparten ID, tampoco las filas de una lista ni el contenido que un `if:when` pinta más tarde en el navegador. Un componente que un `if:when` vuelve a crear recupera el que tenía.
- **No viaja.** El ID no forma parte del estado del payload: no aumenta el tamaño de la página.
- **Raíces sueltas.** Con `hydrate` o `renderWithState` sin el framework, cada raíz empieza en la posición vacía: dos raíces independientes repetirían sus IDs.
- **Formularios.** [`useForm`](/docs/reference/useform) lo usa para los IDs de `form.field`, y `<MeekoPopover>` y `<MeekoSelect>` para enlazar disparador, contenido y opciones.
