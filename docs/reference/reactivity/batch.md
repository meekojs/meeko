---
title: batch
group: reactivity
since: 1.0.0
description: Agrupa varias escrituras de señales en una sola ronda de notificaciones, al terminar la función.
symbols:
  - "@meekojs/meeko#batch"
related:
  - "@meekojs/meeko#signal"
  - "@meekojs/meeko#effect"
  - "@meekojs/meeko#computed"
  - "@meekojs/meeko#untrack"
  - docs/api.md#reactividad
---

Cada escritura de una señal ejecuta en el momento los observadores que la leyeron. Si cambias tres señales seguidas, un `effect` que lee las tres se ejecuta tres veces y ve dos estados intermedios. `batch(fn)` retrasa esas notificaciones hasta que `fn` termina: los observadores afectados se ejecutan una sola vez, con todas las escrituras ya hechas.

Se exporta desde `@meekojs/meeko` y se autoimporta en las aplicaciones del framework.

## Uso

```ts
import { batch, effect, signal } from "@meekojs/meeko";

const first = signal("Ada");
const last = signal("Lovelace");
const log: string[] = [];
effect(() => { log.push(`${first.value} ${last.value}`); });

batch(() => {
  first.value = "Grace";
  last.value = "Hopper";
});
// log: ["Ada Lovelace", "Grace Hopper"], sin el intermedio "Grace Lovelace"
```

## Parámetros

| Parámetro | Tipo | Por defecto | Descripción |
| --- | --- | --- | --- |
| `fn` | `() => T` | obligatorio | Función que escribe señales. Se ejecuta en el momento; las notificaciones esperan a que termine. |

## Valor devuelto

Lo que devuelve `fn`. Si `fn` lanza, `batch` ejecuta igualmente los observadores pendientes y vuelve a lanzar el error; si además falla algún observador, lanza un `AggregateError` con las dos causas.

## Ejemplos

### Un manejador que cambia varias señales

```html
<!-- app/components/Filters.meeko -->
<script lang="ts">
const category = signal("todas");
const minPrice = signal(0);
const page = signal(1);

function reset(): void {
  batch(() => {
    category.value = "todas";
    minPrice.value = 0;
    page.value = 1;
  });
}
</script>

<template>
  <button type="button" on:click="reset">Quitar filtros</button>
</template>
```

Un `useApi` que lee las tres señales en su `query` pide los datos una vez, no tres.

### Un estado coherente para un efecto

```ts
import { batch, effect, signal } from "@meekojs/meeko";

const status = signal<"idle" | "done" | "error">("idle");
const message = signal("");

effect(() => {
  // Nunca ve status "error" con el mensaje vacío.
  if (status.value === "error") console.warn(message.value);
});

batch(() => {
  message.value = "No se pudo guardar";
  status.value = "error";
});
```

### Lotes anidados

Un `batch` dentro de otro no notifica al terminar: las notificaciones esperan al lote exterior.

```ts
import { batch, signal } from "@meekojs/meeko";

const a = signal(0);
const b = signal(0);

function setA(value: number): void { batch(() => { a.value = value; }); }

batch(() => {
  setA(1);       // aún sin notificar
  b.value = 1;
}); // aquí se ejecutan los observadores de a y b, una vez
```

## Errores comunes

### Un `batch` asíncrono

El lote termina cuando `fn` devuelve, y una función `async` devuelve en su primer `await`.

```ts bad
batch(async () => {
  a.value = 10;
  await save();
  b.value = 20;
});
```

No hay error de tipos ni de ejecución, pero la escritura posterior al `await` queda fuera del lote: un efecto que lee `a` y `b` se ejecuta dos veces. Haz el trabajo asíncrono antes y agrupa sólo las escrituras:

<!-- no-check -->
```ts good
const saved = await save();
batch(() => {
  a.value = 10;
  b.value = saved.total;
});
```

### Leer un valor derivado dentro del lote

Un `computed` también es un observador: dentro de `batch` conserva el valor anterior hasta que el lote termina.

```ts bad
const double = computed(() => count.value * 2);
batch(() => {
  count.value = 5;
  send(double.value); // envía el doble del valor anterior
});
```

Lee el `computed` después del lote, o calcula a partir de lo que acabas de escribir:

<!-- no-check -->
```ts good
batch(() => { count.value = 5; });
send(double.value); // 10
```

## Notas

- **Cuándo hace falta.** Cada escritura es síncrona y barata; `batch` sólo importa cuando un observador lee varias de las señales que cambias juntas, o cuando el estado intermedio no es válido.
- **Ya agrupado.** Meeko agrupa por su cuenta las escrituras que hace a la vez: los estados de `useApi` y `useRpcQuery` (`data`, `error`, `pending`, `refreshing`) y los de `useRpcMutation` y `useApiMutation`. Un `effect` que los lee nunca ve una mezcla.
- **Servidor y navegador.** Funciona igual en los dos; en SSR, los efectos ya no se repiten tras su primera ejecución.
- **Errores.** Los fallos de los observadores pendientes se recogen todos: uno se lanza tal cual y varios, en un `AggregateError`.
