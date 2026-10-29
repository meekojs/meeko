---
title: createContext
group: reactivity
since: 1.0.0
description: Crea una clave única y tipada para compartir un valor con los descendientes mediante provide e inject.
symbols:
  - "@meekojs/meeko#createContext"
types:
  - "@meekojs/meeko#ContextKey"
related:
  - "@meekojs/meeko#provide"
  - "@meekojs/meeko#inject"
  - "@meekojs/meeko#createRoot"
  - "@meekojs/meeko/framework#useState"
  - docs/api.md#ciclo-de-vida
---

`createContext<T>(description?)` crea la clave con la que un componente publica un valor ([`provide`](/docs/reference/provide)) y sus descendientes lo leen ([`inject`](/docs/reference/inject)). La clave es un `Symbol` nuevo, así que dos contextos nunca chocan aunque tengan la misma descripción, y lleva el tipo `T` del valor: `inject(clave)` devuelve `T` sin conversiones.

Crea la clave una vez, en un módulo, y expórtala junto a las funciones que la usan. Se exporta desde `@meekojs/meeko` y se autoimporta en las aplicaciones del framework.

## Uso

```ts
// app/composables/theme.ts
import { createContext, inject, provide, signal } from "@meekojs/meeko";
import type { Signal } from "@meekojs/meeko";

type Theme = "light" | "dark";
const themeKey = createContext<Signal<Theme>>("theme");

export function provideTheme(initial: Theme): Signal<Theme> {
  const theme = signal<Theme>(initial);
  provide(themeKey, theme);
  return theme;
}

export const useThemeContext = (): Signal<Theme> => inject(themeKey);
```

Un layout llama a `provideTheme("light")` en su script; cualquier componente dentro llama a `useThemeContext()`.

## Parámetros

| Parámetro | Tipo | Por defecto | Descripción |
| --- | --- | --- | --- |
| `T` | parámetro de tipo | `unknown` | Tipo del valor que se publica con la clave. Escríbelo siempre: no se infiere de ningún valor. |
| `description` | `string` | ninguna | Texto del `Symbol`. Aparece en el error de `inject` cuando falta el proveedor: `Missing Meeko context: theme`. |

## Valor devuelto

Una `ContextKey<T>`: un `symbol` con una marca de tipos que fija `T`. La marca sólo existe en TypeScript.

## Ejemplos

### Un contexto con su `provide` y su `inject` tipados

```ts
// app/composables/toasts.ts
import { createContext, inject, provide, signal } from "@meekojs/meeko";
import type { ReadonlySignal } from "@meekojs/meeko";

interface Toasts {
  readonly items: ReadonlySignal<readonly string[]>;
  show(message: string): void;
}

const toastsKey = createContext<Toasts>("toasts");

export function provideToasts(): Toasts {
  const items = signal<readonly string[]>([]);
  const toasts: Toasts = { items, show: (message) => { items.value = [...items.value, message]; } };
  provide(toastsKey, toasts);
  return toasts;
}

export const useToasts = (): Toasts => inject(toastsKey);
```

### Un contexto con valor por defecto

`inject` falla si nadie publicó la clave. Para un contexto opcional, publica el valor por defecto en la raíz de la aplicación (`app/app.meeko`), de modo que todo el árbol lo tenga:

```html
<!-- app/app.meeko -->
<script lang="ts">
import { provideToasts } from "./composables/toasts";
provideToasts();
</script>

<template><div class="site-root"><MeekoOutlet /></div></template>
```

### Un componente compuesto

Un `<Tabs>` publica su estado y cada `<Tab>` lo lee, sin pasar props por cada nivel:

```ts
// app/components/tabs-context.ts
import { createContext } from "@meekojs/meeko";
import type { Signal } from "@meekojs/meeko";

export const tabsKey = createContext<{ active: Signal<string>; select(id: string): void }>("tabs");
```

```html
<!-- app/components/Tab.meeko -->
<script lang="ts">
import { tabsKey } from "./tabs-context";
const props = defineProps<{ id: string; label: string }>();
const tabs = inject(tabsKey);
</script>

<template>
  <button type="button" role="tab" bind:aria-selected="String(tabs.active.value === props.id)" on:click="() => tabs.select(props.id)">{props.label}</button>
</template>
```

## Errores comunes

### Crear la clave dentro del componente

Cada ejecución del script crearía un `Symbol` distinto, que los descendientes nunca encuentran.

```html bad
<script lang="ts">
const panelKey = createContext<string>("panel");
provide(panelKey, "lateral");
</script>
```

Un hijo que crea su propia clave con `createContext<string>("panel")` y la inyecta lanza `Error: Missing Meeko context: panel`: la descripción es la misma, pero el símbolo no. Crea la clave una vez, en un módulo, e impórtala en los dos lados:

```ts good
// app/components/panel-context.ts
import { createContext } from "@meekojs/meeko";
export const panelKey = createContext<string>("panel");
```

### Olvidar el tipo

```ts bad
const userKey = createContext("user");
const user = inject(userKey);
user.name; // TS18046: 'user' is of type 'unknown'
```

Sin parámetro de tipo, la clave es `ContextKey<unknown>` y todo lo que lee `inject` es `unknown`. Declara el tipo en la clave:

<!-- no-check -->
```ts good
const userKey = createContext<{ id: string; name: string }>("user");
```

### Publicar un valor de otro tipo

```ts bad
const localeKey = createContext<string>("locale");
provide(localeKey, 1);
```

`meeko check` da `TS2345: Argument of type 'number' is not assignable to parameter of type 'string'`.

<!-- no-check -->
```ts good
provide(localeKey, "es");
```

## Notas

- **Servidor y navegador.** La clave es un valor normal de módulo, igual en los dos. Lo que se publica con ella vive en la raíz de cada componente: en SSR es por petición, y no se mezcla entre usuarios.
- **Descripción.** Úsala siempre: es lo único que nombra el contexto en el error de `inject`.
- **Contexto o estado.** El contexto sigue el árbol de componentes y no viaja en el payload. Para estado que debe ser el mismo en todo el árbol y transferirse del servidor al navegador, usa [`useState`](/docs/reference/usestate).
