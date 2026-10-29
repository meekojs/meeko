---
title: onMounted
group: reactivity
since: 1.1.0
description: Ejecuta una función una vez en el navegador, cuando el componente ya está hidratado o montado; nunca en SSR.
symbols:
  - "@meekojs/meeko#onMounted"
types:
  - "@meekojs/meeko#ErrorSource"
related:
  - "@meekojs/meeko#onCleanup"
  - "@meekojs/meeko#effect"
  - "syntax:useelementref"
  - "@meekojs/meeko#provideErrorHandler"
  - docs/api.md#ciclo-de-vida
  - docs/api.md#composables-de-nivel-superior-y-await
---

`onMounted(fn)` registra trabajo que sólo tiene sentido en el navegador y con el DOM ya en su sitio: medir un elemento, enfocar un campo, suscribirse a `window`, arrancar una librería. `fn` se ejecuta una vez, al terminar la hidratación o el montaje del componente, con sus bindings y sus `ref:` ya asignados. En el servidor nunca se ejecuta, así que el código de dentro puede usar `window` y `document` sin comprobarlo.

Si `fn` devuelve una función, Meeko la registra como limpieza del componente, como [`onCleanup`](/docs/reference/oncleanup). Se exporta desde `@meekojs/meeko` y se autoimporta en las aplicaciones del framework.

## Uso

```html
<!-- app/components/WindowWidth.meeko -->
<script lang="ts">
const width = signal(0);
onMounted(() => {
  const update = (): void => { width.value = window.innerWidth; };
  update();
  window.addEventListener("resize", update);
  return () => window.removeEventListener("resize", update);
});
</script>

<template><p>{width.value}px</p></template>
```

El HTML del servidor muestra `0px`; al hidratar, `onMounted` mide la ventana y la plantilla se actualiza. Al desmontar el componente, la función devuelta quita el listener.

## Parámetros

| Parámetro | Tipo | Por defecto | Descripción |
| --- | --- | --- | --- |
| `fn` | `() => void \| (() => void) \| PromiseLike<void>` | obligatorio | Se ejecuta una vez tras montar. Puede devolver una limpieza síncrona, o ser `async`; una función `async` no puede devolver limpieza. |

## Valor devuelto

`void`. Lanza `Error: onMounted() must be called while a component script runs` si se llama fuera del script de un componente, y `TypeError: onMounted() expects a function` si `fn` no es una función.

## Ejemplos

### Enfocar un campo al aparecer

```html
<script lang="ts">
const field = useElementRef("search");
onMounted(() => field.value?.focus());
</script>

<template><input ref:search type="search" placeholder="Buscar"></template>
```

### Una librería que necesita el elemento

```html
<!-- app/components/Map.meeko -->
<script lang="ts">
import { createMap } from "../lib/map";

const props = defineProps<{ lat: number; lng: number }>();
const container = useElementRef("map");
onMounted(() => {
  const map = createMap(container.value!, { center: [props.lat, props.lng] });
  effect(() => map.setCenter([props.lat, props.lng]));
  return () => map.destroy();
});
</script>

<template><div ref:map class="map"></div></template>
```

El `effect` creado dentro sigue a las props y se detiene con el componente.

### Trabajo asíncrono con su propia limpieza

Una función `async` no puede devolver la limpieza: regístrala con `onCleanup` antes del primer `await`.

```html
<script lang="ts">
const stats = signal<{ visits: number } | null>(null);
onMounted(async () => {
  const controller = new AbortController();
  onCleanup(() => controller.abort());
  const response = await fetch("/api/stats", { signal: controller.signal });
  stats.value = (await response.json()) as { visits: number };
});
</script>

<template><p if:when="stats.value">{stats.value.visits} visitas</p></template>
```

Si la petición falla, el error llega al observador de errores con la fuente `"mounted"`.

### Orden entre padre e hijos

Dentro de una misma hidratación o montaje, los hijos ejecutan su `onMounted` antes que el padre, y varios callbacks de un componente se ejecutan en el orden en que se registraron. Un hijo puede así emitir un evento en su `onMounted` y el padre ya tiene sus bindings listos para recibirlo.

## Errores comunes

### Devolver la limpieza desde una función `async`

```ts bad
onMounted(async () => {
  const id = setInterval(tick, 1000);
  return () => clearInterval(id);
});
```

`meeko check` da `TS2345: Argument of type '() => Promise<() => void>' is not assignable to parameter of type '() => MountedResult'`: la limpieza llegaría dentro de una promesa y Meeko no la ejecutaría. Usa `onCleanup` antes del primer `await`, o una función síncrona:

<!-- no-check -->
```ts good
onMounted(() => {
  const id = setInterval(tick, 1000);
  return () => clearInterval(id);
});
```

### Llamarlo fuera del setup

```ts bad
async function open(): Promise<void> {
  await loadPanel();
  onMounted(() => panel.value?.focus());
}
```

En ejecución lanza `Error: onMounted() must be called while a component script runs`. Llámalo en el nivel superior del script, o haz el trabajo directamente en el manejador, donde el componente ya está montado:

<!-- no-check -->
```ts good
async function open(): Promise<void> {
  await loadPanel();
  panel.value?.focus();
}
```

### Usarlo en `<script server>`

`onMounted` pertenece al componente, que se ejecuta en el navegador; el bloque de servidor de una página no se monta.

```html bad
<script server lang="ts">
onMounted(() => console.log("listo"));
</script>
```

`meeko check` da `MEEK108: onMounted() sólo existe en el <script> de un componente: <script server> se ejecuta fuera del componente, antes de renderizar la página. Muévelo al <script lang="ts">`.

```html good
<script lang="ts">
onMounted(() => console.log("listo"));
</script>
```

## Notas

- **SSR.** Nunca se ejecuta en el servidor ni en un render que sólo produce HTML: la pasada en seco de una navegación o el render previo a montar una región en el navegador.
- **Cuándo.** Al final de la hidratación o del montaje en curso, cuando ya existe todo lo que esa operación creó: el componente, sus hermanos posteriores y los bindings de su padre. Un componente que aparece después (un `if:when` que se cumple, una fila nueva de `each:of`, la página de una navegación) sigue la misma regla en su propio montaje.
- **Valores restaurados.** `useStorage`, `useTheme` y los controles con `model` que el usuario editó antes de hidratar aplican sus valores justo antes de los `onMounted`, así que el callback ya los ve.
- **Sin seguimiento.** Los callbacks se ejecutan sin suscribirse a las señales que leen: leer `count.value` dentro no los repite. Para reaccionar a cambios, crea un [`effect`](/docs/reference/effect).
- **Errores.** Un fallo síncrono o una promesa rechazada llega al [`provideErrorHandler`](/docs/reference/provideerrorhandler) más cercano (o al `onError` de la aplicación) con la fuente `"mounted"`; no detiene los demás callbacks ni deshace la hidratación. Si la hidratación falla, o el componente se libera antes de terminar su montaje, sus callbacks no se ejecutan.
- **Después de un `await` de navegador.** En la continuación de un `await useElementRef(...)` o `await useSocket(...)` el componente ya está montado, y `onMounted` ejecuta el callback en el momento.
