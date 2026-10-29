---
title: onCleanup
group: reactivity
since: 1.0.0
description: Registra en la raíz activa la liberación síncrona de un recurso, que se ejecuta al desmontar o liberar el componente.
symbols:
  - "@meekojs/meeko#onCleanup"
related:
  - "@meekojs/meeko#onMounted"
  - "@meekojs/meeko#effect"
  - "@meekojs/meeko#createRoot"
  - "@meekojs/meeko#provideErrorHandler"
  - docs/api.md#reactividad
  - docs/api.md#ciclo-de-vida
---

`onCleanup(release)` dice a Meeko qué hacer cuando el componente deja de existir: parar un temporizador, quitar un listener de `window`, cerrar una conexión, destruir una instancia de una librería. La función se registra en la raíz activa (el componente cuyo script se ejecuta, o la de [`createRoot`](/docs/reference/createroot)) y se ejecuta cuando esa raíz se libera: al desmontar el componente, al cambiar de página, cuando su `if:when` o su fila de `each:of` desaparecen, y también si el render o la hidratación fallan.

Es la pieza con la que se escriben composables que limpian lo suyo. Se exporta desde `@meekojs/meeko` y se autoimporta en las aplicaciones del framework.

## Uso

```ts
// app/composables/now.ts
import { onCleanup, signal } from "@meekojs/meeko";
import type { ReadonlySignal } from "@meekojs/meeko";

export function useNow(intervalMs = 1_000): ReadonlySignal<number> {
  const now = signal(Date.now());
  const timer = typeof window === "undefined" ? undefined : setInterval(() => { now.value = Date.now(); }, intervalMs);
  onCleanup(() => clearInterval(timer));
  return now;
}
```

Cualquier componente que llame a `useNow()` en su script tiene un reloj que se detiene al desmontarlo.

## Parámetros

| Parámetro | Tipo | Por defecto | Descripción |
| --- | --- | --- | --- |
| `release` | `() => void` | obligatorio | Función **síncrona** que libera el recurso. Una que devuelve una promesa es un error de tipos y, al liberar, un `TypeError`. |

## Valor devuelto

`void`. Sin raíz activa lanza `Error: onCleanup() requires an active component root`.

## Ejemplos

### Un listener del navegador

```html
<!-- app/components/ShortcutHelp.meeko -->
<script lang="ts">
const open = signal(false);
onMounted(() => {
  const onKey = (event: KeyboardEvent): void => { if (event.key === "?") open.value = !open.value; };
  window.addEventListener("keydown", onKey);
  onCleanup(() => window.removeEventListener("keydown", onKey));
});
</script>

<template><aside if:when="open.value">Atajos de teclado…</aside></template>
```

Devolver la función desde `onMounted` es equivalente; `onCleanup` sirve también desde composables y desde código que no es el callback.

### Liberar una conexión de un composable

```ts
// app/composables/ticker.ts
import { onCleanup, signal } from "@meekojs/meeko";
import type { ReadonlySignal } from "@meekojs/meeko";

export function useTicker(url: string): ReadonlySignal<number | null> {
  const price = signal<number | null>(null);
  if (typeof EventSource !== "undefined") {
    const source = new EventSource(url);
    source.onmessage = (event) => { price.value = Number(event.data); };
    onCleanup(() => source.close());
  }
  return price;
}
```

### Varias limpiezas

Cada llamada añade una limpieza. Al liberar la raíz se ejecutan todas, en el orden en que se registraron; si fallan varias, Meeko continúa con las demás y lanza un `AggregateError` con todas las causas.

```ts
import { createRoot, onCleanup } from "@meekojs/meeko";

const log: string[] = [];
const dispose = createRoot((dispose) => {
  onCleanup(() => log.push("timer"));
  onCleanup(() => log.push("socket"));
  return dispose;
});
dispose(); // log: ["timer", "socket"]
```

## Errores comunes

### Una limpieza asíncrona

```ts bad
onCleanup(async () => {
  await connection.close();
});
```

`meeko check` da `TS2345: Argument of type '() => Promise<void>' is not assignable to parameter of type 'never'`. En JavaScript, la liberación entrega `TypeError: Meeko cleanup callbacks must be synchronous` y el componente no espera a la promesa. Inicia el cierre y observa su error tú mismo:

<!-- no-check -->
```ts good
onCleanup(() => {
  connection.close().catch((error: unknown) => console.error("No se pudo cerrar", error));
});
```

### Llamarlo fuera de una raíz

```ts bad
// app/utils/clock.ts, evaluado al importar el módulo
const timer = setInterval(tick, 1000);
onCleanup(() => clearInterval(timer));
```

Al importar el módulo lanza `Error: onCleanup() requires an active component root`: un módulo no se desmonta. Llama a `onCleanup` dentro de una función que el script del componente invoca (un composable), o crea una raíz con [`createRoot`](/docs/reference/createroot):

<!-- no-check -->
```ts good
export function useClock(): void {
  const timer = setInterval(tick, 1000);
  onCleanup(() => clearInterval(timer));
}
```

### Registrarla después de un `await`

Dentro de una función `async`, lo que va tras un `await` ya no se ejecuta en el script del componente.

```ts bad
onMounted(async () => {
  const socket = await connect();
  onCleanup(() => socket.close());
});
```

Si el componente se desmonta mientras espera, el socket queda abierto. Registra la limpieza antes del primer `await` y deja que compruebe lo que haya:

<!-- no-check -->
```ts good
onMounted(async () => {
  let socket: Socket | undefined;
  let released = false;
  onCleanup(() => { released = true; socket?.close(); });
  socket = await connect();
  if (released) socket.close();
});
```

## Notas

- **Servidor.** En SSR la raíz del componente se libera al terminar el render, así que las limpiezas también se ejecutan: no dejes temporizadores abiertos en el servidor, o créalos sólo en el navegador (`typeof window`, `onMounted`).
- **Render fallido.** Si el render o la hidratación fallan, Meeko libera todo lo ya registrado. Si además falla una limpieza, entrega un `AggregateError` con las dos causas.
- **Errores.** Una limpieza que lanza no impide las demás. Un rechazo de una limpieza que devolvió una promesa por error llega al [`provideErrorHandler`](/docs/reference/provideerrorhandler) más cercano con la fuente `"cleanup"`.
- **Efectos.** No hace falta `onCleanup` para los `effect` y `computed` del componente: pertenecen a la misma raíz y se detienen solos.
