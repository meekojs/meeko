---
title: effect
group: reactivity
since: 1.0.0
description: Ejecuta una función síncrona ahora y cada vez que cambia una señal que leyó; puede devolver una limpieza y devuelve la función que la detiene.
symbols:
  - "@meekojs/meeko#effect"
types:
  - "@meekojs/meeko#ReadonlySignal"
  - "@meekojs/meeko#EffectResult"
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

| Parámetro | Tipo                         | Por defecto | Descripción                                                                                                                                                                                                               |
| --------- | ---------------------------- | ----------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `fn`      | `() => void \| (() => void)` | obligatorio | Callback **síncrono** que lee señales y puede devolver una limpieza (desde `1.10`). Un callback que devuelve una promesa (`async`), o una limpieza que la devuelve, es un error de tipos y, en ejecución, un `TypeError`. |
| `source`  | `EffectSource`               | ninguno     | Ubicación de la expresión para DevTools. La añade el compilador en desarrollo; no la escribas.                                                                                                                            |

## Valor devuelto

Una función `() => void` que detiene el efecto: deja de observar sus señales, no vuelve a ejecutarse y ejecuta la limpieza de su última ejecución. En un componente no hace falta llamarla, porque el efecto se detiene al desmontarlo; sirve para pararlo antes, o para un efecto creado fuera de una raíz.

## Limpieza por ejecución

Desde `1.10`, cada ejecución del efecto es propietaria de lo que registra, como en Solid o en `useEffect` de React:

- la función que devuelve `fn`;
- los [`onCleanup`](/docs/reference/oncleanup) que llama;
- los `effect`, `computed` y [`createRoot`](/docs/reference/createroot) que crea.

Todo ello se libera **antes de la siguiente ejecución** y **al detener el efecto** (con la función que devuelve, al desmontar su componente o al liberar su raíz), en el orden en que se registró, con la función devuelta en último lugar. En SSR el efecto se ejecuta una vez y su limpieza corre al terminar el render, cuando se libera la raíz, igual que un `onCleanup` del script.

Cualquier otro valor devuelto (un número, un objeto) se ignora. Una promesa devuelta detiene el efecto y lanza `TypeError` (véase [Un callback `async`](#un-callback-async)).

Hasta `1.9` la función devuelta se ignoraba y `onCleanup` dentro del efecto se registraba en el componente, que la ejecutaba una sola vez al desmontarse; véase [Excepciones aprobadas](/docs/stability#excepciones-aprobadas).

## Ejemplos

### Liberar lo de cada ejecución

```ts
import { effect, signal } from "@meekojs/meeko";

const delay = signal(1_000);
const tick = (): void => console.log("tic");
effect(() => {
  const id = setInterval(tick, delay.value);
  return () => clearInterval(id);
});
delay.value = 500; // para el intervalo de 1 s antes de crear el de 500 ms
```

La limpieza también corre al desmontar el componente o al detener el efecto, así que no hace falta otro `onCleanup` fuera.

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

El efecto lee las señales de forma síncrona, lanza la petición y devuelve su cancelación; el error es responsabilidad tuya:

```ts
import { effect, signal } from "@meekojs/meeko";

const query = signal("");
const results = signal<string[]>([]);

effect(() => {
  const q = query.value.trim(); // la dependencia se registra aquí, antes de cualquier await
  if (!q) { results.value = []; return; }
  const controller = new AbortController();
  fetch(`/api/search?q=${encodeURIComponent(q)}`, { signal: controller.signal })
    .then((response) => response.json() as Promise<string[]>)
    .then((list) => { results.value = list; })
    .catch((error: unknown) => { if (!controller.signal.aborted) console.error(error); });
  return () => controller.abort();
});
```

Cada nueva búsqueda aborta la anterior, y al desmontar el componente se aborta la última.

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

### Devolver una función que no es una limpieza

```ts bad
effect(() => props.onSelect);
```

Desde `1.10`, una función devuelta es la limpieza de esa ejecución: Meeko la llama antes de la siguiente y al detener el efecto. Un efecto con cuerpo de expresión que sólo pretendía leer un valor que es una función lo llamaría. Usa un cuerpo con llaves:

<!-- no-check -->

```ts good
effect(() => {
  void props.onSelect;
});
```

### `onCleanup` después de un `await`

```ts bad
effect(() => {
  void connect(url.value).then((socket) => {
    onCleanup(() => socket.close());
  });
});
```

El `then` corre cuando el efecto ya terminó su ejecución: no hay propietario activo, así que `onCleanup` lanza `Error: onCleanup() requires an active component root…` (y, en desarrollo, lo avisa por consola). Registra la limpieza durante la ejecución y deja que compruebe lo que haya:

<!-- no-check -->

```ts good
effect(() => {
  let socket: Socket | undefined;
  let released = false;
  void connect(url.value).then((opened) => {
    if (released) opened.close();
    else socket = opened;
  });
  return () => { released = true; socket?.close(); };
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
- **Limpieza.** Desde `1.10`, la función devuelta, los `onCleanup` y lo que crea cada ejecución se liberan antes de la siguiente y al detener el efecto (véase [Limpieza por ejecución](#limpieza-por-ejecución)). Una limpieza que falla llega a quien escribió la señal, como un fallo del efecto, y no impide la nueva ejecución. Un efecto que crea otro efecto, un `computed` o un `createRoot` los recrea en cada ejecución: créalos fuera si deben durar más.
- **Sin `onUpdated`.** Meeko no tiene un gancho de actualización: un efecto que lee las señales es la forma de reaccionar a sus cambios.
