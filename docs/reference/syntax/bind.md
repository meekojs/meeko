---
title: bind:nombre
group: syntax
since: 1.0.0
description: Da a un atributo de un elemento, o a una prop de un componente, el valor de una expresión, y lo actualiza cuando cambian sus señales.
symbols:
  - "syntax:bind"
related:
  - "syntax:model"
  - "syntax:on"
  - "syntax:component-tag"
  - "syntax:interpolation"
  - "@meekojs/meeko#ElementAttributes"
  - docs/api.md#componentes-meeko
  - docs/api.md#atributos-en-bloque-con-bind
  - docs/api.md#props-estáticas
---

`bind:nombre="expresión"` da al atributo `nombre` el valor de una expresión TypeScript y lo mantiene al día cuando cambian las señales que lee. En una etiqueta de componente o en `<component is>`, `bind:prop` pasa una prop tipada al hijo.

Un atributo sin `bind:` es texto literal: `title="{x}"` escribe `{x}`. Para un valor calculado, usa siempre `bind:`.

## Uso

```html
<!-- app/components/SaveButton.meeko -->
<script lang="ts">
const saving = signal(false);
const count = signal(3);
</script>

<template>
  <button bind:disabled="saving.value" bind:title="`${count.value} cambios`" bind:aria-busy="saving.value ? 'true' : null">
    Guardar
  </button>
</template>
```

Con `saving.value` en `false`, el botón no lleva `disabled` ni `aria-busy`; al pasar a `true`, Meeko añade los dos.

## Atributos

| Atributo | Tipo | Por defecto | Descripción |
| --- | --- | --- | --- |
| `bind:<atributo>` en un elemento | cualquier valor | ninguno | El atributo con `String(valor)`. `null`, `undefined` y `false` lo quitan. En los atributos booleanos de HTML (`disabled`, `checked`, `hidden`, `required`, `open`…), cualquier valor verdadero lo pone vacío y uno falso lo quita. |
| `bind:<prop>` en un componente | el tipo de la prop | ninguno | La prop del hijo, comprobada contra su `defineProps`. Una prop opcional acepta `undefined`, que equivale a no pasarla. |
| `bind="objeto"` | `ElementAttributes<Tag>` o las props | ninguno | Desde `1.5`. Varios atributos, o varias props, desde un objeto. Las claves explícitas ganan; `class` y `style` se combinan. |

## Resultado

- **Atributos.** En SSR, el atributo con su valor escapado, o nada si el valor lo quita. En el navegador, `setAttribute` o `removeAttribute` en cada cambio.
- **Propiedades de los controles.** `bind:value` en `<input>`, `<textarea>` y `<select>`, `bind:checked` en `<input>` y `bind:selected` en `<option>` actualizan también la propiedad del elemento, porque el navegador deja de leer el atributo en cuanto el usuario edita el control.
- **Props.** El hijo recibe el valor nuevo sin volver a montarse: sólo se actualizan los bindings que leen esa prop.

## Ejemplos

### Clases y estilos calculados

`bind:class` recibe el texto completo de la clase. Para combinar clases fijas y condicionales, construye la cadena:

```html
<script lang="ts">
const props = defineProps<{ active: boolean; size: "sm" | "lg" }>();
const classes = computed(() => ["chip", `chip--${props.size}`, props.active ? "chip--active" : ""].filter(Boolean).join(" "));
</script>

<template>
  <span bind:class="classes.value" bind:style="props.active ? 'outline: 2px solid currentColor' : null">Etiqueta</span>
</template>
```

### Atributos ARIA y `data-*`

Un atributo que debe valer `"true"` o `"false"` como texto (los `aria-*` no son booleanos de HTML) se escribe como texto:

```html
<script lang="ts">
const open = signal(false);
</script>

<template>
  <button type="button" aria-controls="menu" bind:aria-expanded="open.value ? 'true' : 'false'" on:click="() => open.value = !open.value">Menú</button>
  <ul id="menu" bind:hidden="!open.value" bind:data-state="open.value ? 'open' : 'closed'">
    <li>Perfil</li>
  </ul>
</template>
```

### Props de un componente

`bind:` comprueba cada prop contra el hijo; un atributo sin prefijo pasa una prop estática como literal:

```html
<!-- app/components/AppBadge.meeko -->
<script lang="ts">
const props = defineProps<{ label: string; tone?: "info" | "danger"; count?: number }>({ tone: "info" });
</script>

<template><span bind:class="`badge badge--${props.tone}`">{props.label} <b if:when="props.count">{props.count}</b></span></template>
```

```html
<AppBadge label="Errores" tone="danger" bind:count="errors.value.length" />
<AppBadge bind:label="user.value.name" bind:count="unread.value > 0 ? unread.value : undefined" />
```

### Atributos en bloque

Desde `1.5`, `bind="objeto"` escribe varias claves a la vez, tipadas con `ElementAttributes`:

```html
<script lang="ts">
import type { ElementAttributes } from "@meekojs/meeko";

const props = defineProps<{ busy: boolean; id: string }>();
const attrs = computed((): ElementAttributes<"section"> => ({ id: props.id, "aria-busy": props.busy, hidden: false }));
</script>

<template><section class="panel" bind="attrs.value">…</section></template>
```

## Errores comunes

### Usar llaves en un atributo sin `bind:`

```html bad
<img src="{photo.value.url}" alt="{photo.value.caption}">
```

No es un error de compilación: el atributo vale el texto literal `{photo.value.url}`.

```html good
<img bind:src="photo.value.url" bind:alt="photo.value.caption">
```

### Pasar la señal en lugar de su valor

Una señal es un objeto, y un objeto es verdadero: `bind:disabled="saving"` desactiva el botón siempre, sin ningún error.

```html bad
<button bind:disabled="saving">Guardar</button>
```

```html good
<button bind:disabled="saving.value">Guardar</button>
```

### Un objeto en `bind:class`

`bind:class` no interpreta objetos ni arrays como Vue: escribe `String(valor)`, es decir, `class="[object Object]"`, sin ningún error.

```html bad
<p bind:class="{ active: selected.value }">Opción</p>
```

```html good
<p bind:class="selected.value ? 'active' : null">Opción</p>
```

### Un manejador de eventos como atributo

```html bad
<button bind:onclick="() => save()">Guardar</button>
```

`MEEK012: Atributo dinámico no válido: onclick`. Los eventos van con `on:`.

```html good
<button on:click="save">Guardar</button>
```

### Una prop estática y con `bind:` a la vez

```html bad
<AppBadge label="Errores" bind:label="title.value" />
```

`MEEK090: label y bind:label pasan los dos la prop label; deja sólo el texto estático o sólo bind:label`.

```html good
<AppBadge bind:label="title.value" />
```

### Una prop que el hijo no declara, o con otro tipo

```html bad
<AppBadge label="Errores" bind:size="3" bind:count="'3'" />
```

`meeko check` da `TS2353: Object literal may only specify known properties, and '"size"' does not exist in type …` y `TS2322: Type 'string' is not assignable to type 'number'.`

```html good
<AppBadge label="Errores" bind:count="3" />
```

## Notas

- **SSR e hidratación.** El servidor escribe el atributo escapado y la hidratación comprueba que el del HTML coincide con el valor que calcula el navegador; si difiere, lanza `Hydration mismatch` con el componente y la línea. Calcula en el servidor lo que dependa del navegador, o cámbialo en `onMounted`.
- **Seguridad.** El valor siempre se escapa, así que no puede cerrar el atributo. Un `bind:href` con una URL de un usuario puede ser `javascript:…`: valida el esquema antes. Los manejadores `on*` no se admiten con `bind:` (`MEEK012`) ni en `bind="obj"` (`MEEK113`).
- **`bind:html` y `bind:ref`.** No son las directivas `html` ni `ref:`: en un elemento, `bind:html` escribe un atributo HTML llamado `html`; en un componente, `bind:ref` pasa una prop llamada `ref`.
- **`select multiple`.** `bind:value` no sincroniza la selección de un `<select multiple>`: usa `model` con una señal `string[]`.
- **Valores sin comillas.** Como en HTML, una expresión sin espacios puede escribirse sin comillas: `bind:disabled=saving.value`.
