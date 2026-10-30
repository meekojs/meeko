---
title: model
group: syntax
since: 1.1.0
description: Enlaza en los dos sentidos un control de formulario, o el modelo de un componente, con una señal escribible.
symbols:
  - "syntax:model"
related:
  - "syntax:definemodel"
  - "syntax:bind"
  - "syntax:on"
  - "@meekojs/meeko#signal"
  - "@meekojs/meeko/framework#useForm"
  - docs/api.md#controles-de-formulario-con-model
  - docs/api.md#modelos-de-componente-definemodel-y-model
---

`model="señal"` enlaza un control de formulario con una señal en los dos sentidos: el control muestra el valor de la señal y cada edición del usuario lo escribe en ella. Sustituye a la pareja `bind:value` + `on:input`.

En una etiqueta de componente, `model` pasa la señal del modelo por defecto del hijo, y `model:nombre` la de un modelo con nombre; el hijo los declara con `defineModel`.

## Uso

```html
<!-- app/components/SignupForm.meeko -->
<script lang="ts">
const email = signal("");
const accepted = signal(false);
const plan = signal<string | null>("free");
</script>

<template>
  <label>Correo <input type="email" model="email"></label>
  <label><input type="checkbox" model="accepted"> Acepto las condiciones</label>
  <label><input type="radio" value="free" model="plan"> Gratis</label>
  <label><input type="radio" value="pro" model="plan"> Pro</label>
  <p>{email.value} · {accepted.value ? "aceptado" : "pendiente"} · {plan.value}</p>
</template>
```

## Atributos

| Control | Propiedad y evento | Tipo de la señal |
| --- | --- | --- |
| `<input>` de texto (cualquier `type` salvo los siguientes, o `bind:type`) y `<textarea>` | `value`, en `input` | `Signal<string>` |
| `<input type="checkbox">` | `checked`, en `change` | `Signal<boolean>` o, desde `1.7.1`, `Signal<boolean \| undefined>`: `undefined` se pinta desmarcado y `change` escribe siempre un booleano |
| `<input type="radio">` | marcado si la señal vale su `value`; `change` escribe ese valor | `Signal<string \| null \| undefined>` |
| `<select>` | `value`, en `change` | `Signal<string>` |
| `<select multiple>` | las opciones seleccionadas, en `change` | `Signal<string[]>` |
| Etiqueta de componente: `model` | el modelo por defecto del hijo | `Signal<T>` de su `defineModel<T>()` |
| Etiqueta de componente: `model:nombre` | el modelo `nombre` del hijo | `Signal<T>` de su `defineModel<T>("nombre")` |

La expresión debe ser una **señal escribible**: no su `.value`, ni un `computed`.

## Resultado

- **SSR.** El HTML lleva el valor de la señal: `value` en un `<input>`, `checked` en un checkbox o radio, el contenido de un `<textarea>` y `selected` en cada `<option>`. Un checkbox cuya señal vale `undefined` sale sin `checked`.
- **Navegador.** Asignar la señal desde código actualiza la propiedad viva del control; cada edición del usuario escribe la señal.
- **Antes de hidratar.** Si el usuario escribe antes de que la página se hidrate (o el navegador restaura el valor al volver atrás), lo escrito se conserva y se copia a la señal al terminar la hidratación, antes de los `onMounted`.
- **Componente.** El hijo recibe la misma señal: leer y escribir en el hijo lee y escribe la del padre.

## Ejemplos

### Un `<select>` y un `<select multiple>`

```html
<script lang="ts">
const country = signal("es");
const tags = signal<string[]>([]);
</script>

<template>
  <select model="country" aria-label="País">
    <option value="es">España</option>
    <option value="mx">México</option>
  </select>
  <select multiple model="tags" aria-label="Etiquetas">
    <option value="urgente">Urgente</option>
    <option value="cliente">Cliente</option>
  </select>
  <p>{country.value}: {tags.value.join(", ")}</p>
</template>
```

### Un número, guardado como texto

Un `<input type="number">` también entrega texto. Guarda el texto en la señal y conviértelo donde lo uses:

```html
<script lang="ts">
const quantity = signal("1");
const total = computed(() => {
  const value = Number(quantity.value);
  return Number.isFinite(value) ? value * 3.5 : 0;
});
</script>

<template>
  <label>Cantidad <input type="number" min="1" model="quantity"></label>
  <p>Total: {total.value.toFixed(2)} €</p>
</template>
```

### Mostrar la contraseña con `bind:type`

Desde `1.2`, `model` admite `bind:type` y trata el control siempre como uno de texto:

```html
<script lang="ts">
const password = signal("");
const revealed = signal(false);
</script>

<template>
  <input bind:type="revealed.value ? 'text' : 'password'" model="password" autocomplete="current-password" aria-label="Contraseña">
  <button type="button" bind:aria-pressed="revealed.value ? 'true' : 'false'" on:click="() => revealed.value = !revealed.value">Mostrar</button>
</template>
```

### Modelos de un componente

El hijo declara sus modelos con `defineModel`; el padre pasa sus señales con `model` y `model:nombre`:

```html
<!-- app/components/AppSearch.meeko -->
<script lang="ts">
const query = defineModel<string>();
const open = defineModel<boolean>("open", { default: false });
</script>

<template>
  <input type="search" model="query" aria-label="Buscar" on:focus="() => open.value = true">
</template>
```

```html
<AppSearch model="search" model:open="panelOpen" />
```

### Los campos de `useForm`

`form.fields.x` son señales escribibles, así que van directamente en `model`:

```html
<script lang="ts">
const form = useForm({ initial: { name: "", newsletter: false }, submit: async (values) => values });
</script>

<template>
  <form on:submit="form.submit">
    <input model="form.fields.name" aria-label="Nombre">
    <label><input type="checkbox" model="form.fields.newsletter"> Boletín</label>
  </form>
</template>
```

## Errores comunes

### Pasar `.value`

```html bad
<input model="name.value">
```

`meeko check` da `TS2322: Type 'string' is not assignable to type '{ value: string; }'`, y en ejecución el enlace lanza `TypeError: Meeko model expects a writable signal, not a computed signal or a plain value`.

```html good
<input model="name">
```

### Un `computed`

Un `computed` no se puede escribir.

```html bad
<input model="upper">
```

Con `const upper = computed(() => name.value.toUpperCase())`, `meeko check` da `TS2345: Argument of type 'ReadonlySignal<string>' is not assignable to parameter of type 'ReadonlySignal<string> & { readonly "a model needs a writable signal; computed and readonly signals cannot be written": never; }'.`

```html good
<input model="name">
<p>{upper.value}</p>
```

### Una señal del tipo equivocado

```html bad
<input type="number" model="age">
<input type="checkbox" model="accepted">
```

Con `signal(0)` y `signal("no")`, `meeko check` da `TS2322: Type 'Signal<number>' is not assignable to type '{ value: string; }'` y `TS2322: Type 'Signal<string>' is not assignable to type '{ value: boolean | undefined; }'`.

```html good
<input type="number" model="ageText">
<input type="checkbox" model="accepted">
```

Con `const ageText = signal("0")` y `const accepted = signal(false)`.

### `model` junto al evento que ya escucha

```html bad
<input model="query" on:input="search">
```

`MEEK065: model asigna value y escucha input; quita on:input`. Para reaccionar al cambio, usa un `effect` o un `computed` sobre la señal, u otro evento como `on:change`.

```html good
<input model="query" on:change="search">
```

### `model` en un elemento que no es un control

```html bad
<div model="name"></div>
```

`MEEK065: model se admite en <input>, <textarea> y <select>, no en <div>`. Otros casos de `MEEK065`: `<input type="file">` (`model no se admite en <input type="file">`), un radio sin `value` (`Un radio con model necesita value="..." o bind:value="expression"`) y un `<textarea model>` con contenido.

```html good
<textarea model="name"></textarea>
```

### `model:x` y `bind:x` en un componente

```html bad
<AppSearch model="search" model:open="panelOpen" bind:open="panelOpen.value" />
```

`MEEK066: model:open y bind:open pasan los dos open; un modelo no es una prop, deja sólo model:open`.

```html good
<AppSearch model="search" model:open="panelOpen" />
```

## Notas

- **Hidratación.** `model` no rompe la hidratación cuando el usuario escribe pronto: las regiones `if:`, `each:` y `<render>` que leen la señal se hidratan con el valor del SSR y reaccionan después al valor restaurado.
- **Números y fechas.** Los controles entregan texto. Guarda texto en la señal y conviértelo donde se use, o deja que lo haga el schema de `useForm` (`v.transform(Number)`).
- **Estado del componente.** Una señal de nivel superior del script viaja en el estado SSR y se restaura al hidratar; la que el padre pasa por `model` pertenece al padre y no forma parte del estado del hijo.
- **Elementos personalizados.** En una etiqueta con guion (`<my-input model="query">`), `model` es un atributo HTML literal, no la directiva.
- **Accesibilidad.** `model` no da nombre al control: envuélvelo en un `<label>` o usa `aria-label`.
