---
title: untrack
group: reactivity
since: 1.0.0
description: Ejecuta una función que lee señales sin registrarlas como dependencias del observador activo.
symbols:
  - "@meekojs/meeko#untrack"
related:
  - "@meekojs/meeko#effect"
  - "@meekojs/meeko#computed"
  - "@meekojs/meeko#batch"
  - docs/api.md#reactividad
---

Dentro de un `effect`, un `computed` o la plantilla, leer `signal.value` suscribe al observador: cuando la señal cambie, se volverá a ejecutar. `untrack(fn)` ejecuta `fn` sin observador activo, así que las señales que lee dentro no se registran. Sirve para leer un valor de contexto (el usuario, la página actual, una opción) sin que su cambio dispare el trabajo.

Se exporta desde `@meekojs/meeko` y se autoimporta en las aplicaciones del framework.

## Uso

```ts
import { effect, signal, untrack } from "@meekojs/meeko";

const query = signal("");
const page = signal(1);

// Se repite al cambiar query; page se lee sin suscribirse.
effect(() => {
  console.log(`Buscar "${query.value}" desde la página ${untrack(() => page.value)}`);
});

page.value = 2;     // sin log
query.value = "a";  // log: Buscar "a" desde la página 2
```

## Parámetros

| Parámetro | Tipo | Por defecto | Descripción |
| --- | --- | --- | --- |
| `fn` | `() => T` | obligatorio | Función que lee señales. Se ejecuta en el momento, una vez. |

## Valor devuelto

Lo que devuelve `fn`. Fuera de un observador, `untrack(fn)` equivale a llamar a `fn()`.

## Ejemplos

### Registrar un evento con un dato que no debe repetirlo

```ts
import { effect, signal, untrack } from "@meekojs/meeko";

const route = signal("/");
const userId = signal("anon");

effect(() => {
  const path = route.value; // la dependencia
  void fetch("/api/analytics", {
    method: "POST",
    body: JSON.stringify({ path, user: untrack(() => userId.value) }),
  });
});
```

Cambiar de usuario no envía una visita nueva; cambiar de ruta sí.

### Un valor inicial que no debe seguir a la prop

En un `computed`, `untrack` fija lo que no debe recalcularlo:

```html
<!-- app/components/Draft.meeko -->
<script lang="ts">
const props = defineProps<{ text: string; locale: string }>();
const draft = signal(untrack(() => props.text)); // copia inicial, a propósito
const words = computed(() => draft.value.trim().split(/\s+/).filter(Boolean).length);
</script>

<template>
  <textarea model="draft"></textarea>
  <p>{words.value} palabras</p>
</template>
```

`props.text` sólo se lee una vez; el usuario edita la copia en `draft`.

### Llamar a código ajeno desde un efecto

Una función de una librería puede leer señales que no controlas. `untrack` evita que el efecto dependa de ellas:

```ts
import { effect, signal, untrack } from "@meekojs/meeko";

declare function notify(message: string): void; // puede leer señales internas

const saved = signal(0);
effect(() => {
  if (saved.value > 0) untrack(() => notify(`Guardado ${saved.value}`));
});
```

## Errores comunes

### Devolver la señal en lugar de su valor

`untrack` sólo evita la suscripción mientras `fn` se ejecuta. Si devuelve la señal, la lectura ocurre después, fuera de `untrack`, y sí se registra.

```ts bad
effect(() => {
  const current = untrack(() => page);
  console.log(query.value, current.value); // page vuelve a ser dependencia
});
```

No hay error: el efecto se repite al cambiar `page`. Lee `.value` dentro de la función:

<!-- no-check -->
```ts good
effect(() => {
  console.log(query.value, untrack(() => page.value));
});
```

### Usarlo para tapar un bucle

Si un efecto escribe una señal que también lee, `untrack` en la lectura evita el error `Reactive update cycle exceeded 1000 iterations`, pero deja un estado que se deriva a mano.

```ts bad
effect(() => {
  total.value = untrack(() => total.value) + price.value;
});
```

`total` acumula cada cambio de `price` y no vuelve atrás nunca. Si el valor depende de otros, es un `computed`:

<!-- no-check -->
```ts good
const total = computed(() => items.value.reduce((sum, item) => sum + item.price, 0));
```

## Notas

- **Servidor y navegador.** Funciona igual en los dos.
- **Escrituras.** `untrack` no cambia las escrituras: una asignación dentro de `fn` avisa a los observadores como siempre. Para agruparlas, usa [`batch`](/docs/reference/batch).
- **Callbacks de Meeko.** `onMounted` y las funciones que Meeko ejecuta tras la hidratación ya corren sin seguimiento: no hace falta `untrack` dentro.
- **Plantilla.** En una expresión de la plantilla, `untrack` hace que ese binding no se actualice cuando cambia la señal. Es raro necesitarlo; normalmente indica que el dato debería ser una constante.
