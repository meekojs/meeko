---
title: useNavigation
group: composables
since: 1.0.0
description: Devuelve el estado de navegación de la aplicación, con pending en true mientras se carga una página nueva.
symbols:
  - "@meekojs/meeko/framework#useNavigation"
types:
  - "@meekojs/meeko/framework#NavigationState"
related:
  - "@meekojs/meeko/framework#useRoute"
  - "syntax:meekolink"
  - "syntax:meekoawait"
  - "@meekojs/meeko/framework#mountClientApp"
  - docs/framework.md#estado-de-navegación
  - docs/framework.md#navegación-y-render-client
---

`useNavigation()` dice si la aplicación está cambiando de página. Su `pending` vale `true` desde que empieza una navegación del cliente (un clic en un enlace, `app.navigate()`, el botón atrás) hasta que la página nueva se confirma, falla o se cancela, incluida la carga de sus `await useApi`/`await useRpcQuery` y la primera carga de una página `render: "client"`. Sirve para una barra de progreso global, un cursor de espera o atenuar el contenido mientras llega la página siguiente.

Se exporta desde `@meekojs/meeko/framework` y, desde `1.7`, se autoimporta como `useRoute` (un export propio llamado `useNavigation` tiene prioridad); el import explícito sigue valiendo. Puede llamarse también desde código que se ejecuta con el componente (un composable, un `computed`, un `effect`), pero no desde un manejador de eventos: ahí no hay raíz activa y devuelve un estado fijo con `pending` en `false`.

## Uso

```html
<!-- app/layouts/default.meeko -->
<script lang="ts">
const navigation = useNavigation();
</script>

<template>
  <div class="progress" if:when="navigation.pending.value" role="progressbar" aria-label="Cargando página"></div>
  <main bind:aria-busy="navigation.pending.value ? 'true' : null"><MeekoOutlet /></main>
</template>
```

La página anterior sigue visible mientras `pending` vale `true`; al confirmarse la nueva, vuelve a `false`.

## Parámetros

`useNavigation()` no recibe parámetros.

## Valor devuelto

Un `NavigationState`:

| Propiedad | Tipo | Descripción |
| --- | --- | --- |
| `pending` | `ReadonlySignal<boolean>` | `true` mientras se carga una página nueva. En SSR y fuera de `mountClientApp` vale siempre `false`. |

Nunca lanza: fuera de una aplicación montada devuelve un estado fijo con `pending` en `false`.

## Ejemplos

### Una barra de progreso que no parpadea

Una navegación rápida no debería mostrar nada. Un `effect` con un retardo muestra la barra sólo si la carga tarda:

```html
<!-- app/components/NavigationProgress.meeko -->
<script lang="ts">
const navigation = useNavigation();
const visible = signal(false);
effect(() => {
  if (!navigation.pending.value) { visible.value = false; return; }
  const timer = setTimeout(() => { visible.value = true; }, 150);
  onCleanup(() => clearTimeout(timer));
});
</script>

<template><div class="progress" if:when="visible.value" aria-hidden="true"></div></template>
```

### Desactivar acciones durante la navegación

```ts
import { computed } from "@meekojs/meeko";
import { useNavigation } from "@meekojs/meeko/framework";

const navigation = useNavigation();
const disabled = computed(() => navigation.pending.value);
// <button bind:disabled="disabled.value">Guardar</button>
```

### Un componente que sabe adónde se va

`pending` dice que hay una navegación; la ruta de destino aún no se ve en [`useRoute`](/docs/reference/useroute), que cambia sólo al confirmar. Combinados, un layout muestra la página actual y el estado de carga:

```html
<script lang="ts">
const navigation = useNavigation();
const route = useRoute();
</script>

<template>
  <p class="status">{route.path.value}{navigation.pending.value ? " · cargando…" : ""}</p>
</template>
```

## Errores comunes

### Llamarlo en un manejador de eventos

```html bad
<script lang="ts">
function save() {
  if (useNavigation().pending.value) return;
  // …
}
</script>
```

No hay error, pero el manejador se ejecuta sin raíz activa: `useNavigation()` devuelve el estado fijo y `pending` siempre vale `false`. Pídelo en el script y léelo en el manejador:

```html good
<script lang="ts">
const navigation = useNavigation();
function save() {
  if (navigation.pending.value) return;
  // …
}
</script>
```

### Escribir `pending`

```ts bad
const navigation = useNavigation();
navigation.pending.value = true;
```

`meeko check` da `TS2540: Cannot assign to 'value' because it is a read-only property`. El estado lo lleva el navegador de la aplicación; para un indicador propio, usa una señal tuya:

<!-- no-check -->
```ts good
const saving = signal(false);
```

### Esperar `pending` en SSR o en la primera carga

```html bad
<p if:when="navigation.pending.value">Cargando la aplicación…</p>
```

El HTML del servidor y la carga completa de una página nunca muestran ese texto: `pending` sólo se activa en las navegaciones del cliente. Para los datos que llegan después del primer pintado, envuelve la zona en [`<MeekoAwait>`](/docs/reference/meekoawait) o lee `pending` del recurso de `useApi`:

```html good
<MeekoAwait for="items">
  <snippet name="pending"><p>Cargando…</p></snippet>
  <ItemsList bind:items="items.data.value" />
</MeekoAwait>
```

## Notas

- **SSR.** Siempre `false`. La hidratación tampoco lo cambia.
- **Qué cuenta.** El render previo de la página nueva que carga sus `await` de datos, la petición del payload al servidor y la carga de una ruta `render: "client"`. Una navegación sólo de fragmento (`#seccion`) no la activa: el navegador sólo desplaza la página.
- **Cancelación.** Si el usuario inicia otra navegación mientras tanto, la anterior se cancela y `pending` sigue en `true` hasta que termina la última.
- **Accesibilidad.** Marca la zona que cambia con `aria-busy` mientras carga, en lugar de anunciar cada navegación.
