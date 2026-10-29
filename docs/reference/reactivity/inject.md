---
title: inject
group: reactivity
since: 1.0.0
description: Lee el valor que publicó con provide el ancestro más cercano y falla si ninguno lo hizo.
symbols:
  - "@meekojs/meeko#inject"
types:
  - "@meekojs/meeko#ContextKey"
related:
  - "@meekojs/meeko#createContext"
  - "@meekojs/meeko#provide"
  - "@meekojs/meeko#createRoot"
  - docs/api.md#ciclo-de-vida
---

`inject(key)` recorre hacia arriba las raíces del componente activo (el propio componente, su padre, el padre de éste…) y devuelve el valor de la primera que publicó `key` con [`provide`](/docs/reference/provide). Si ninguna lo hizo, lanza un error con la descripción de la clave en lugar de devolver `undefined`: un contexto que falta es un fallo de estructura, no un caso que la plantilla deba tratar.

Se exporta desde `@meekojs/meeko` y se autoimporta en las aplicaciones del framework.

## Uso

```html
<!-- app/components/ThemeBadge.meeko -->
<script lang="ts">
import { themeKey } from "../composables/theme";
const theme = inject(themeKey); // Signal<"light" | "dark">
</script>

<template><span class="badge" bind:data-theme="theme.value">Tema {theme.value}</span></template>
```

Como el layout publicó una señal, el badge se actualiza cuando el tema cambia.

## Parámetros

| Parámetro | Tipo | Por defecto | Descripción |
| --- | --- | --- | --- |
| `key` | `ContextKey<T>` | obligatorio | Clave creada con [`createContext`](/docs/reference/createcontext). La misma instancia que usó `provide`, no otra con la misma descripción. |

## Valor devuelto

El valor `T` del proveedor más cercano. Si ningún ancestro publicó la clave, lanza `Error: Missing Meeko context: <descripción>` (sin descripción, `Missing Meeko context`).

## Ejemplos

### Un composable que envuelve el `inject`

Exporta una función con nombre en lugar de la clave: quien la usa no necesita saber que hay un contexto.

```ts
// app/composables/session.ts
import { createContext, inject } from "@meekojs/meeko";
import type { ReadonlySignal } from "@meekojs/meeko";

export const sessionKey = createContext<ReadonlySignal<{ name: string } | null>>("session");
export const useSessionUser = (): ReadonlySignal<{ name: string } | null> => inject(sessionKey);
```

```html
<script lang="ts">
const user = useSessionUser();
</script>

<template><p if:when="user.value">Hola, {user.value.name}</p></template>
```

### El proveedor más cercano gana

```ts
import { createContext, createRoot, inject, provide } from "@meekojs/meeko";

const sizeKey = createContext<"sm" | "md">("size");
const size = createRoot(() => {
  provide(sizeKey, "md");
  return createRoot(() => {
    provide(sizeKey, "sm");
    return createRoot(() => inject(sizeKey));
  });
});
// size === "sm"
```

### Un contexto opcional

`inject` no tiene valor por defecto. Si un componente debe funcionar con y sin proveedor, publica el valor por defecto en `app/app.meeko` o comprueba el caso con `try`:

```ts
import { inject } from "@meekojs/meeko";
import type { ContextKey } from "@meekojs/meeko";

export function injectOr<T>(key: ContextKey<T>, fallback: T): T {
  try { return inject(key); }
  catch { return fallback; }
}
```

## Errores comunes

### Un componente fuera del proveedor

```html bad
<!-- app/pages/index.meeko: el layout no llama a provide(themeKey, …) -->
<ThemeBadge />
```

El render falla con `Error: Missing Meeko context: theme`. Publica el valor en un ancestro de todos los que lo leen, como el layout o `app/app.meeko`:

```html good
<!-- app/layouts/default.meeko -->
<script lang="ts">
import { themeKey } from "../composables/theme";
provide(themeKey, signal<"light" | "dark">("light"));
</script>
```

### Llamarlo en un manejador o tras un `await`

`inject` busca desde la raíz activa, que sólo existe mientras se ejecuta el script del componente.

```ts bad
async function save(): Promise<void> {
  await persist();
  inject(toastsKey).show("Guardado");
}
```

Fuera del script no hay raíz activa y lanza `Missing Meeko context: toasts`. Haz el `inject` en el nivel superior del script y guarda el valor:

<!-- no-check -->
```ts good
const toasts = inject(toastsKey);
async function save(): Promise<void> {
  await persist();
  toasts.show("Guardado");
}
```

### Leer el valor en lugar de la señal

```ts bad
const theme = inject(themeKey).value;
```

`theme` es el texto del momento: la plantilla no se actualiza al cambiar el tema. Guarda la señal y lee `.value` donde se usa:

<!-- no-check -->
```ts good
const theme = inject(themeKey);
// <span>{theme.value}</span>
```

## Notas

- **Servidor y navegador.** Funciona igual en los dos, con los valores que publicaron los ancestros en esa misma ejecución.
- **Dónde llamarlo.** En el nivel superior del script o en un composable que éste llama. El contenido de un snippet o de un `<MeekoTeleport>` ve los contextos del componente que lo declara.
- **Hermanos.** Sólo se buscan ancestros: un hermano que publicó la clave no cuenta.
- **Contexto de Meeko.** `useState`, `useRoute`, `useNavigation` y otros composables del framework se apoyan en este mismo mecanismo. Por eso `useState` fuera de una aplicación lanza `Missing Meeko context: Meeko framework state`.
