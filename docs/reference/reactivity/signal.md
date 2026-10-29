---
title: signal
group: reactivity
since: 1.0.0
description: Crea un valor observable y editable con .value; cada escritura de un valor distinto avisa a la plantilla, los computed y los effect que lo leyeron.
symbols:
  - "@meekojs/meeko#signal"
types:
  - "@meekojs/meeko#Signal"
  - "@meekojs/meeko#ReadonlySignal"
related:
  - "@meekojs/meeko#computed"
  - "@meekojs/meeko#effect"
  - "@meekojs/meeko#batch"
  - "@meekojs/meeko#untrack"
  - "syntax:model"
  - "@meekojs/meeko/framework#useState"
  - docs/api.md#reactividad
  - docs/api.md#módulo-generado
---

`signal(initial)` crea el estado más básico de Meeko: un objeto con una propiedad `value`. Leer `value` dentro de la plantilla, de un [`computed`](/docs/reference/computed) o de un [`effect`](/docs/reference/effect) registra la dependencia; asignar un valor distinto avisa sólo a quien la leyó. No hay DOM virtual: la plantilla compilada actualiza exactamente el nodo o el atributo que depende de la señal.

En el `<script>` de un componente, las señales de nivel superior son además el **estado del componente**: el servidor las serializa con el HTML (`renderWithState`), la hidratación las restaura y HMR las conserva por nombre. Se exporta desde `@meekojs/meeko` y se autoimporta en las aplicaciones del framework.

## Uso

```html
<!-- app/components/Counter.meeko -->
<script lang="ts">
const count = signal(0);
</script>

<template>
  <button type="button" on:click="() => count.value++">Pulsado {count.value} veces</button>
</template>
```

Cada clic asigna un número nuevo a `count.value` y Meeko actualiza sólo el texto del botón.

## Parámetros

| Parámetro | Tipo | Por defecto | Descripción |
| --- | --- | --- | --- |
| `initial` | `T` | obligatorio | Valor inicial. `T` se infiere de él: `signal(0)` es `Signal<number>`. Para una unión o un valor vacío, escribe el tipo: `signal<User \| null>(null)`, `signal<string[]>([])`. |

## Valor devuelto

Un `Signal<T>`, un objeto con una sola propiedad:

| Propiedad | Tipo | Descripción |
| --- | --- | --- |
| `value` | `T` | Lectura: devuelve el valor actual y, si hay un observador activo (la plantilla, un `computed`, un `effect`), lo suscribe. Escritura: si el valor nuevo es distinto según `Object.is`, lo guarda y ejecuta en ese momento los observadores que lo leyeron. |

`Signal<T>` es asignable a `ReadonlySignal<T>`, el tipo de sólo lectura que devuelven `computed` y los composables: úsalo para exponer una señal sin permitir que otros la escriban.

## Ejemplos

### Estado con tipo explícito

```ts
import { signal } from "@meekojs/meeko";

interface User { id: string; name: string }

const user = signal<User | null>(null);
const tags = signal<string[]>([]);

user.value = { id: "1", name: "Ada" };
tags.value = [...tags.value, "admin"]; // un array nuevo: avisa a los observadores
```

### Un control de formulario con `model`

`model` enlaza en los dos sentidos un control con una señal escribible del tipo del control:

```html
<script lang="ts">
const name = signal("");
const accepted = signal(false);
</script>

<template>
  <input model="name" placeholder="Tu nombre">
  <label><input type="checkbox" model="accepted"> Acepto</label>
  <button bind:disabled="!accepted.value || !name.value.trim()">Enviar</button>
</template>
```

### Exponer una señal de sólo lectura desde un composable

```ts
// app/composables/counter.ts
import { signal } from "@meekojs/meeko";
import type { ReadonlySignal } from "@meekojs/meeko";

export function useCounter(start = 0): { count: ReadonlySignal<number>; increment: () => void } {
  const count = signal(start);
  return { count, increment: () => { count.value++; } };
}
```

Quien llama puede leer `count.value`, pero asignarlo es un error de tipos (`TS2540`).

### Estado de un componente que viaja al navegador

```html
<!-- app/components/Tabs.meeko -->
<script lang="ts">
const props = defineProps<{ initial: "perfil" | "actividad" }>();
const tab = signal(props.initial);
</script>

<template>
  <button type="button" on:click="() => tab.value = 'perfil'" bind:aria-pressed="String(tab.value === 'perfil')">Perfil</button>
  <button type="button" on:click="() => tab.value = 'actividad'" bind:aria-pressed="String(tab.value === 'actividad')">Actividad</button>
</template>
```

El HTML del servidor sale con la pestaña de `initial`, la señal `tab` viaja en el estado del componente y la hidratación la restaura antes de reclamar el HTML: no hay desajuste.

## Errores comunes

### Mutar el objeto o el array de una señal

Una señal sólo avisa cuando se le asigna un valor distinto (`Object.is`). `push` o cambiar una propiedad modifican el mismo objeto: nadie se entera y no hay ningún error.

```ts bad
items.value.push(item);
user.value.name = "Grace";
```

Asignar el mismo objeto después tampoco avisa, porque `Object.is(objeto, objeto)` es `true`. Asigna siempre un valor nuevo:

<!-- no-check -->
```ts good
items.value = [...items.value, item];
user.value = { ...user.value, name: "Grace" };
```

### Olvidar `.value`

La señal es un objeto; su valor está en `value`.

```html bad
<button on:click="() => count++">{count.value}</button>
```

`meeko check` da `TS2588: Cannot assign to 'count' because it is a constant`. En una condición, `if:when="count > 0"` da `TS2365: Operator '>' cannot be applied to types 'Signal<number>' and 'number'`.

```html good
<button on:click="() => count.value++">{count.value}</button>
```

### Escribir en un `computed`

```ts bad
const double = computed(() => count.value * 2);
double.value = 4;
```

`meeko check` da `TS2540: Cannot assign to 'value' because it is a read-only property`, y desde `1.7` la asignación lanza `TypeError` en ejecución. Escribe en la señal de origen:

<!-- no-check -->
```ts good
count.value = 2; // double.value pasa a 4
```

### Guardar en el estado un valor que JSON no representa

Las señales de nivel superior del script viajan en JSON con el HTML del servidor.

```ts bad
const when = signal(new Date());
```

El render falla con el nombre del componente y de la señal, como `app/pages/agenda.meeko: the signal "when" cannot be sent to the browser with the SSR state (Non-plain object at $.when)`. Guarda un valor serializable y deriva el objeto:

<!-- no-check -->
```ts good
const when = signal(new Date().toISOString());
const date = computed(() => new Date(when.value));
```

## Notas

- **Servidor y navegador.** En SSR la señal funciona igual, pero el HTML sale una sola vez: las escrituras posteriores al render no llegan al navegador. Las actualizaciones de la plantilla ocurren en el navegador, tras hidratar.
- **Estado transferido.** Sólo viajan las señales editables del nivel superior del script. Un `computed`, una constante o una señal guardada dentro de un objeto no forman parte del estado; un `undefined` sí viaja desde `1.5`. Para estado compartido por varios componentes, usa [`useState`](/docs/reference/usestate).
- **HMR.** Al editar un componente en `meeko dev`, Meeko conserva por nombre sus señales editables; los `computed` se vuelven a calcular.
- **Sincronía.** Cada escritura ejecuta en el momento los observadores afectados, en orden de creación. Para agrupar varias escrituras en una sola ronda, usa [`batch`](/docs/reference/batch).
- **Igualdad.** `NaN` es igual a `NaN` y `-0` distinto de `0`, como en `Object.is`. Una escritura del mismo valor no hace nada.
- **Bucles.** Un observador que escribe la señal que lee se repite hasta que Meeko lo corta con `Reactive update cycle exceeded 1000 iterations`.
