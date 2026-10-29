---
title: createRoot
group: reactivity
since: 1.0.0
description: Crea una raíz reactiva propia cuyos efectos, limpiezas y contextos se liberan juntos al llamar a dispose.
symbols:
  - "@meekojs/meeko#createRoot"
related:
  - "@meekojs/meeko#effect"
  - "@meekojs/meeko#onCleanup"
  - "@meekojs/meeko#provide"
  - "@meekojs/meeko#inject"
  - docs/api.md#reactividad
---

Todo lo reactivo pertenece a una raíz: los `effect`, los `computed`, las limpiezas de `onCleanup` y los valores de `provide`. Meeko crea una por cada componente y la libera al desmontarlo, así que en el script de un componente casi nunca hace falta crear otra. `createRoot(fn)` crea una raíz a mano para el código que vive fuera de un componente (una prueba, un host propio, un widget montado a mano) o para un grupo de efectos que debe poder liberarse antes que el componente.

`fn` recibe `dispose`, la función que libera todo lo creado dentro. Se exporta desde `@meekojs/meeko` y, desde `1.7`, se autoimporta en las aplicaciones como `effect` u `onCleanup` (un export propio llamado `createRoot` tiene prioridad).

## Uso

```ts
import { createRoot, effect, signal } from "@meekojs/meeko";

const count = signal(0);
const seen: number[] = [];

const dispose = createRoot((dispose) => {
  effect(() => { seen.push(count.value); });
  return dispose;
});

count.value = 1; // seen: [0, 1]
dispose();
count.value = 2; // seen sigue siendo [0, 1]
```

## Parámetros

| Parámetro | Tipo | Por defecto | Descripción |
| --- | --- | --- | --- |
| `fn` | `(dispose: () => void) => T` | obligatorio | Se ejecuta en el momento, con la raíz nueva activa. Todo lo reactivo que cree pertenece a la raíz. |

## Valor devuelto

Lo que devuelve `fn`. Lo habitual es devolver `dispose` o un objeto que lo incluye.

`dispose()` ejecuta las limpiezas y las raíces hijas en el orden en que se registraron, detiene los efectos y borra los contextos. Si fallan varias limpiezas, lanza un `AggregateError` con todas. Si `fn` lanza, la raíz se libera sola antes de propagar el error; si además falla una limpieza, el error es un `AggregateError` con las dos causas.

## Ejemplos

### Probar un composable

```ts
import { createRoot, onCleanup, signal } from "@meekojs/meeko";

function useCounter(): { count: { readonly value: number }; increment(): void } {
  const count = signal(0);
  onCleanup(() => { count.value = 0; });
  return { count, increment: () => { count.value++; } };
}

createRoot((dispose) => {
  const counter = useCounter();
  counter.increment();
  console.assert(counter.count.value === 1);
  dispose();
});
```

### Raíces anidadas

Una raíz creada dentro de otra es su hija: liberar la exterior libera también la interior, y la interior ve los contextos de la exterior.

```ts
import { createContext, createRoot, inject, onCleanup, provide } from "@meekojs/meeko";

const log: string[] = [];
const nameKey = createContext<string>("name");

const disposeOuter = createRoot((dispose) => {
  provide(nameKey, "exterior");
  createRoot(() => {
    log.push(inject(nameKey));
    onCleanup(() => log.push("interior liberada"));
  });
  return dispose;
});

disposeOuter(); // log: ["exterior", "interior liberada"]
```

### Efectos que se liberan antes que el componente

En un componente, una raíz propia permite parar un grupo de efectos (por ejemplo, el seguimiento mientras un panel está abierto) sin desmontar nada:

```html
<script lang="ts">
import { createRoot } from "@meekojs/meeko";

const tracking = signal(false);
const position = signal(0);
let stopTracking: (() => void) | undefined;
// La raíz se crea en un manejador, sin raíz activa: el componente la libera al desmontarse.
onCleanup(() => stopTracking?.());

function toggle(): void {
  if (stopTracking) { stopTracking(); stopTracking = undefined; tracking.value = false; return; }
  stopTracking = createRoot((dispose) => {
    const update = (): void => { position.value = window.scrollY; };
    window.addEventListener("scroll", update);
    onCleanup(() => window.removeEventListener("scroll", update));
    return dispose;
  });
  tracking.value = true;
}
</script>

<template><button type="button" on:click="toggle">{tracking.value ? `Scroll: ${position.value}` : "Seguir el scroll"}</button></template>
```

## Errores comunes

### No llamar nunca a `dispose`

```ts bad
createRoot(() => {
  effect(() => { document.title = title.value; });
});
```

No hay error, pero el efecto vive para siempre: una raíz que nadie libera retiene sus efectos y todo lo que leen. Guarda `dispose` y llámalo cuando el trabajo termine, o deja que lo haga el componente con `onCleanup`:

<!-- no-check -->
```ts good
const dispose = createRoot((dispose) => {
  effect(() => { document.title = title.value; });
  return dispose;
});
onCleanup(dispose);
```

## Notas

- **Componentes.** Cada componente ya es una raíz, hija de la de su padre. Una raíz creada en su script es hija suya: se libera con él aunque no llames a `dispose`. Una creada en un manejador de eventos no tiene raíz activa y no es hija de nadie: libérala tú.
- **Contextos.** La raíz nueva hereda los contextos de la activa, y lo que publique con `provide` sólo lo ven sus descendientes.
- **Servidor y navegador.** Funciona igual en los dos. En SSR, los efectos de la raíz sólo se ejecutan una vez.
- **Errores.** Un fallo de `fn` libera la raíz antes de propagarse, sin dejar efectos a medias.
