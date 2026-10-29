---
title: effect
group: reactivity
since: 1.0.0
description: Ejecuta una función síncrona ahora y cada vez que cambia una señal que leyó; devuelve la función que la detiene.
symbols:
  - "@meekojs/meeko#effect"
types:
  - "@meekojs/meeko#ReadonlySignal"
related:
  - "@meekojs/meeko#computed"
  - "@meekojs/meeko#onCleanup"
  - "@meekojs/meeko#onMounted"
  - "@meekojs/meeko#untrack"
  - "@meekojs/meeko#batch"
  - "@meekojs/meeko#provideErrorHandler"
  - docs/api.md#reactividad
  - docs/api.md#ciclo-de-vida
---

`effect(fn)` es el puente entre las señales y el mundo exterior: ejecuta `fn` en el momento, registra las señales que lee y la vuelve a ejecutar cuando cambia cualquiera de ellas. Sirve para sincronizar algo que Meeko no pinta (el título del documento, una librería de terceros, un `localStorage`, una conexión) con el estado. Para calcular un valor, usa [`computed`](/docs/reference/computed); para pintar, la plantilla.

En el script de un componente, el efecto pertenece al componente y se detiene al desmontarlo. Se exporta desde `@meekojs/meeko` y se autoimporta en las aplicaciones del framework.

## Uso

```html
<!-- app/components/SearchBox.meeko -->
<script lang="ts">
const query = signal("");
effect(() => {
  if (typeof document === "undefined") return;
  document.title = query.value ? `Buscar: ${query.value}` : "Buscar";
});
</script>

<template><input type="search" model="query"></template>
```

La primera ejecución ocurre al crear el efecto; cada letra que escribe el usuario cambia `query` y vuelve a ejecutarlo en el navegador.

## Parámetros

| Parámetro | Tipo | Por defecto | Descripción |
| --- | --- | --- | --- |
| `fn` | `() => unknown` | obligatorio | Callback **síncrono** que lee señales. Un callback que devuelve una promesa (`async`) es un error de tipos y, en ejecución, un `TypeError`. |
| `source` | `EffectSource` | ninguno | Ubicación de la expresión para DevTools. La añade el compilador en desarrollo; no la escribas. |

## Valor devuelto

Una función `() => void` que detiene el efecto: deja de observar sus señales y no vuelve a ejecutarse. En un componente no hace falta llamarla, porque el efecto se detiene al desmontarlo; sirve para pararlo antes, o para un efecto creado fuera de una raíz.

## Ejemplos

### Detener un efecto

```ts
import { effect, signal } from "@meekojs/meeko";

const count = signal(0);
const seen: number[] = [];
const stop = effect(() => { seen.push(count.value); });

count.value = 1;
stop();
count.value = 2; // seen sigue siendo [0, 1]
```

### Sincronizar una librería externa y liberarla

`onCleanup` dentro de un componente libera el recurso al desmontarlo; el efecto vuelve a aplicar la opción cuando cambia la señal:

```html
<!-- app/components/Chart.meeko -->
<script lang="ts">
import { createChart } from "../lib/chart";

const props = defineProps<{ points: number[] }>();
const canvas = useElementRef("canvas");
onMounted(() => {
  const chart = createChart(canvas.value!);
  effect(() => chart.update(props.points));
  return () => chart.destroy();
});
</script>

<template><canvas ref:canvas width="400" height="200"></canvas></template>
```

El efecto creado dentro de `onMounted` pertenece igualmente al componente: Meeko lo detiene con él.

### Trabajo asíncrono desde un efecto síncrono

El efecto lee las señales de forma síncrona y lanza la petición; la cancelación y el error son responsabilidad tuya:

```ts
import { effect, signal } from "@meekojs/meeko";

const query = signal("");
const results = signal<string[]>([]);
let controller: AbortController | undefined;

effect(() => {
  const q = query.value.trim(); // la dependencia se registra aquí, antes de cualquier await
  controller?.abort();
  if (!q) { results.value = []; return; }
  const current = new AbortController();
  controller = current;
  fetch(`/api/search?q=${encodeURIComponent(q)}`, { signal: current.signal })
    .then((response) => response.json() as Promise<string[]>)
    .then((list) => { results.value = list; })
    .catch((error: unknown) => { if (!current.signal.aborted) console.error(error); });
});
```

En un componente del framework, [`useRpcQuery`](/docs/reference/use-rpc-query) o [`useApi`](/docs/reference/use-api) con `debounceMs` y `enabled` (desde `1.7`) ya hacen esto, con cancelación, SSR e hidratación.

### Leer una señal sin depender de ella

```ts
import { effect, signal, untrack } from "@meekojs/meeko";

const query = signal("");
const page = signal(1);
// Se repite al cambiar query, no al cambiar page.
effect(() => console.log(query.value, untrack(() => page.value)));
```

## Errores comunes

### Un callback `async`

```ts bad
effect(async () => {
  const response = await fetch(`/api/users?q=${query.value}`);
  users.value = await response.json();
});
```

`meeko check` da `TS2345: Argument of type '() => Promise<void>' is not assignable to parameter of type 'never'` y, en ejecución, el efecto lanza `TypeError: Meeko effect callbacks must be synchronous`. Las lecturas posteriores a un `await` no se registrarían. Lee las señales primero y lanza la promesa sin devolverla:

<!-- no-check -->
```ts good
effect(() => {
  const q = query.value;
  void fetch(`/api/users?q=${q}`).then((response) => response.json()).then((list) => { users.value = list; });
});
```

### Escribir la señal que el efecto lee

```ts bad
effect(() => {
  count.value = count.value + 1;
});
```

Cada escritura vuelve a disparar el efecto, y Meeko lo corta con `Error: Reactive update cycle exceeded 1000 iterations`. Si el valor depende de otro, es un `computed`:

<!-- no-check -->
```ts good
const next = computed(() => count.value + 1);
```

### Usar `effect` para derivar estado

```ts bad
const total = signal(0);
effect(() => { total.value = price.value * quantity.value; });
```

Funciona, pero `total` es una señal editable más: viaja en el estado del componente, alguien puede escribirla y queda un instante desincronizada. Un valor derivado es un `computed`:

<!-- no-check -->
```ts good
const total = computed(() => price.value * quantity.value);
```

### Tocar el DOM o APIs del navegador sin comprobarlo

El efecto se ejecuta una vez también en SSR.

```ts bad
effect(() => { window.scrollTo(0, offset.value); });
```

En SSR lanza `ReferenceError: window is not defined` y la página falla. Comprueba el entorno, o crea el efecto en `onMounted`, que sólo se ejecuta en el navegador:

<!-- no-check -->
```ts good
onMounted(() => {
  effect(() => { window.scrollTo(0, offset.value); });
});
```

## Notas

- **SSR.** En el servidor el efecto se ejecuta sólo la primera vez, al crearse. En la pasada en seco de una navegación del cliente (el render previo que carga los datos de la página nueva) no se ejecuta.
- **Orden.** Los efectos pendientes se ejecutan en orden de creación: un efecto padre, como el de un `if:when`, corre antes que los que creó. Varias escrituras seguidas ejecutan el efecto varias veces; agrúpalas con [`batch`](/docs/reference/batch).
- **Errores.** Una excepción de un efecto creado en el setup hace fallar el render. Una que ocurre al reaccionar a una escritura se propaga a quien escribió (por ejemplo, el manejador `on:click`), que la entrega al [`provideErrorHandler`](/docs/reference/provideerrorhandler) más cercano. Si fallan varios observadores en la misma ronda, se agrupan en un `AggregateError`.
- **Ciclo de vida.** Dentro de un componente, el efecto se detiene al desmontarlo, al cambiar de página o cuando desaparece su `if:when` o su fila de `each:of`. Fuera de una raíz (un módulo o una prueba), vive hasta que llamas a la función que devuelve, o lo creas dentro de [`createRoot`](/docs/reference/createroot).
- **Sin `onUpdated`.** Meeko no tiene un gancho de actualización: un efecto que lee las señales es la forma de reaccionar a sus cambios.
