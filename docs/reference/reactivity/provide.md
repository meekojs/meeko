---
title: provide
group: reactivity
since: 1.0.0
description: Publica un valor con una clave de contexto en el componente activo y en todos sus descendientes.
symbols:
  - "@meekojs/meeko#provide"
types:
  - "@meekojs/meeko#ContextKey"
related:
  - "@meekojs/meeko#createContext"
  - "@meekojs/meeko#inject"
  - "@meekojs/meeko#createRoot"
  - "@meekojs/meeko#provideErrorHandler"
  - docs/api.md#ciclo-de-vida
---

`provide(key, value)` guarda `value` bajo `key` en la raíz del componente cuyo script se está ejecutando. Cualquier descendiente (sus hijos, los hijos de sus hijos, el contenido de sus snippets y de un `<MeekoTeleport>`) lo lee con [`inject(key)`](/docs/reference/inject), que busca el proveedor más cercano hacia arriba. Así se comparte algo con un subárbol sin pasar props por cada nivel: el tema de un layout, el estado de un componente compuesto, un servicio.

Se exporta desde `@meekojs/meeko` y se autoimporta en las aplicaciones del framework.

## Uso

```html
<!-- app/layouts/default.meeko -->
<script lang="ts">
import { themeKey } from "../composables/theme";
const theme = signal<"light" | "dark">("light");
provide(themeKey, theme);
</script>

<template>
  <div bind:class="theme.value"><MeekoOutlet /></div>
</template>
```

Todas las páginas que pinta este layout pueden leer `inject(themeKey)` y, como el valor es una señal, reaccionar a sus cambios.

## Parámetros

| Parámetro | Tipo | Por defecto | Descripción |
| --- | --- | --- | --- |
| `key` | `ContextKey<T>` | obligatorio | Clave creada con [`createContext`](/docs/reference/createcontext). |
| `value` | `T` | obligatorio | Valor que reciben los `inject` de los descendientes. Para que lo lean de forma reactiva, publica una señal o un objeto con señales. |

## Valor devuelto

`void`. Sin un componente o una raíz activa lanza `Error: provide() requires an active component root`.

## Ejemplos

### Un servicio para un subárbol

```ts
// app/composables/cart.ts
import { createContext, inject, provide, signal, computed } from "@meekojs/meeko";
import type { ReadonlySignal } from "@meekojs/meeko";

interface Cart { readonly count: ReadonlySignal<number>; add(id: string): void }
const cartKey = createContext<Cart>("cart");

export function provideCart(): Cart {
  const ids = signal<string[]>([]);
  const cart: Cart = { count: computed(() => ids.value.length), add: (id) => { ids.value = [...ids.value, id]; } };
  provide(cartKey, cart);
  return cart;
}

export const useCart = (): Cart => inject(cartKey);
```

### Sustituir un valor en una rama

Un descendiente puede volver a publicar la misma clave: su rama ve el valor nuevo y el resto del árbol, el anterior.

```html
<!-- app/components/DarkSection.meeko -->
<script lang="ts">
import { themeKey } from "../composables/theme";
const snippets = defineSnippets<{ default: [] }>();
provide(themeKey, signal<"light" | "dark">("dark"));
</script>

<template><section class="dark"><render snippet="snippets.default" /></section></template>
```

### Fuera de un componente, en una raíz propia

En una prueba o en un host propio, [`createRoot`](/docs/reference/createroot) da una raíz donde publicar:

```ts
import { createContext, createRoot, inject, provide } from "@meekojs/meeko";

const localeKey = createContext<string>("locale");
const value = createRoot(() => {
  provide(localeKey, "es");
  return createRoot(() => inject(localeKey)); // una raíz hija lo encuentra
});
// value === "es"
```

## Errores comunes

### Llamarlo fuera del script de un componente

```ts bad
// app/utils/setup.ts, evaluado al importar
provide(localeKey, "es");
```

Lanza `Error: provide() requires an active component root`. Publica desde el script de un componente (para toda la aplicación, `app/app.meeko`) o dentro de un composable que ese script llama:

```html good
<!-- app/app.meeko -->
<script lang="ts">
provide(localeKey, "es");
</script>
```

### Esperar que lo lea un hermano

`provide` sólo alcanza a los descendientes del componente que lo llama.

```html bad
<Sidebar />   <!-- llama a provide(panelKey, …) -->
<Content />   <!-- llama a inject(panelKey) -->
```

`<Content>` lanza `Error: Missing Meeko context: panel`. Publica en el ancestro común:

```html good
<!-- el componente que contiene a los dos llama a provide(panelKey, …) -->
<Sidebar />
<Content />
```

### Publicar un valor fijo que debería cambiar

```ts bad
const theme = signal("light");
provide(themeKey, theme.value);
```

Los descendientes reciben el texto `"light"` y no se enteran de los cambios (además es un error de tipos si la clave es de `Signal`). Publica la señal:

<!-- no-check -->
```ts good
provide(themeKey, theme);
```

## Notas

- **Servidor y navegador.** Funciona en los dos. En SSR, el valor vive en la raíz del componente de esa petición: dos peticiones nunca comparten lo publicado.
- **Dónde llamarlo.** En el nivel superior del script, antes de pintar los hijos: los descendientes buscan el valor cuando se ejecuta su propio script.
- **No viaja.** Lo publicado no forma parte del estado del payload. El navegador vuelve a ejecutar el `provide` al hidratar; si el valor debe ser el mismo que en el servidor, sale de props, datos de la ruta o señales del estado.
- **Raíces independientes.** Dos raíces sin relación (dos aplicaciones montadas en la misma página, o dos `createRoot` sin anidar) no comparten valores.
- **Errores.** [`provideErrorHandler`](/docs/reference/provideerrorhandler) usa el mismo mecanismo: un observador de errores publicado en un componente vale para toda su rama.
