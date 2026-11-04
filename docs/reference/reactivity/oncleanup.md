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

| Parámetro | Tipo         | Por defecto | Descripción                                                                                                                  |
| --------- | ------------ | ----------- | ---------------------------------------------------------------------------------------------------------------------------- |
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

### Usar APIs del navegador en una limpieza que también corre en SSR

```html bad
<!-- app/components/Sticky.meeko -->
<script lang="ts">
let frame = 0;
let observer: ResizeObserver | undefined;
const scheduleUpdate = (): void => {};
onCleanup(() => {
  cancelAnimationFrame(frame);
  observer?.disconnect();
  window.removeEventListener("resize", scheduleUpdate);
});
</script>
```

El script de un componente también se ejecuta en el servidor y, en SSR, la raíz se libera al terminar el render: la limpieza se ejecuta en Node, donde `window` y `cancelAnimationFrame` no existen, y lanza `ReferenceError`. `meeko check` y el editor dan el aviso [`MEEK128`](/docs/stability) (un error en `2.0`) cuando un `onCleanup` del nivel superior del script, de un `effect` o de una función que el setup llama (un composable) usa una API que sólo existe en el navegador sin comprobarlo antes. El editor ofrece «Mover a `onMounted`». Crea el recurso y su limpieza en `onMounted`, que sólo se ejecuta en el navegador:

<!-- no-check -->

```ts good
let frame = 0;
let observer: ResizeObserver | undefined;
onMounted(() => {
  window.addEventListener("resize", scheduleUpdate);
  onCleanup(() => {
    cancelAnimationFrame(frame);
    observer?.disconnect();
    window.removeEventListener("resize", scheduleUpdate);
  });
});
```

No avisa una limpieza protegida con `typeof window`, `typeof document` o `import.meta.env.SSR` (en una condición o con un retorno temprano), una registrada en `onMounted`, en un manejador de evento o tras el primer `await` de navegador, ni el encadenamiento opcional sobre una variable propia (`observer?.disconnect()`). Sobre la global no protege: `window?.scrollTo()` también lanza en el servidor. Una variable local llamada `window` no es la global.

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

Al importar el módulo lanza `Error: onCleanup() requires an active component root`: un módulo no se desmonta. `meeko check` de un proyecto da el aviso `MEEK130` en los módulos de `app/`, `shared/` y `server/`. Llama a `onCleanup` dentro de una función que el script del componente invoca (un composable), o crea una raíz con [`createRoot`](/docs/reference/createroot):

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

Si el componente se desmonta mientras espera, el socket queda abierto, y tras el `await` ya no hay raíz activa. `meeko check` y el editor dan el aviso `MEEK129`. Registra la limpieza antes del primer `await` y deja que compruebe lo que haya:

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

- **Servidor.** En SSR la raíz del componente se libera al terminar el render, así que las limpiezas también se ejecutan: no dejes temporizadores abiertos en el servidor, o créalos sólo en el navegador (`typeof window`, `onMounted`). Una limpieza así que usa APIs del navegador es el aviso `MEEK128`; véase [Usar APIs del navegador en una limpieza que también corre en SSR](#usar-apis-del-navegador-en-una-limpieza-que-también-corre-en-ssr).
- **Render fallido.** Si el render o la hidratación fallan, Meeko libera todo lo ya registrado. Si además falla una limpieza, entrega un `AggregateError` con las dos causas.
- **Errores.** Una limpieza que lanza no impide las demás. Un rechazo de una limpieza que devolvió una promesa por error llega al [`provideErrorHandler`](/docs/reference/provideerrorhandler) más cercano con la fuente `"cleanup"`.
- **Efectos.** No hace falta `onCleanup` para los `effect` y `computed` del componente: pertenecen a la misma raíz y se detienen solos.
