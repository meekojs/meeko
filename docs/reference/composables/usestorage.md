---
title: useStorage
group: composables
since: 1.2.0
description: Devuelve una señal editable guardada como JSON en localStorage o sessionStorage, sin desajustes de hidratación y sincronizada entre pestañas.
symbols:
  - "@meekojs/meeko/framework#useStorage"
types:
  - "@meekojs/meeko/framework#StorageOptions"
related:
  - "@meekojs/meeko/framework#useState"
  - "@meekojs/meeko#signal"
  - "@meekojs/meeko/framework#useTheme"
  - "autoimport:useRpcMutation"
  - docs/framework.md#estado-persistente-usestorage
  - docs/framework.md#mutaciones-seguras-ante-reintentos
---

`useStorage(key, initial, options?)` devuelve una señal cuyo valor se guarda en el almacenamiento del navegador: `localStorage` por defecto o `sessionStorage` con `storage: "session"`. Sirve para el estado del navegador que debe sobrevivir a una recarga o compartirse entre pestañas: un ticket abierto, la caja elegida, un borrador, una preferencia de vista.

El servidor nunca lee el almacenamiento: el HTML y la hidratación usan `initial`, y el valor guardado se aplica justo al terminar de hidratar, antes de `onMounted`. Así no hay desajustes. Se autoimporta en los `.meeko` y se llama mientras se ejecuta el script de un componente (en su nivel superior o en un composable que éste llama).

## Uso

```html
<!-- app/components/ViewToggle.meeko -->
<script lang="ts">
const view = useStorage("products:view", "grid");
</script>

<template>
  <button type="button" bind:aria-pressed="String(view.value === 'grid')" on:click="() => view.value = 'grid'">Cuadrícula</button>
  <button type="button" bind:aria-pressed="String(view.value === 'list')" on:click="() => view.value = 'list'">Lista</button>
</template>
```

Al recargar, la vista elegida vuelve; en otra pestaña abierta cambia a la vez.

## Parámetros

| Parámetro | Tipo | Por defecto | Descripción |
| --- | --- | --- | --- |
| `key` | `string` | obligatorio | Clave del almacenamiento, como `"pos:ticket"`. Incluye lo que la distinga entre usuarios o cuentas si comparten navegador. Vacía lanza `TypeError`. |
| `initial` | `T` | obligatorio | Valor en SSR, durante la hidratación, cuando no hay nada guardado y cuando lo guardado no es válido. Fija `T`. |
| `options.storage` | `"local" \| "session"` | `"local"` | `"local"` persiste entre sesiones y pestañas; `"session"`, sólo en la pestaña actual. |
| `options.schema` | Standard Schema síncrono | ninguno | Valida lo que se lee, también lo que llega de otra pestaña. Con él, el tipo de la señal sale del schema. |

## Valor devuelto

Una `Signal<T>` compartida por todos los componentes que usan la misma clave y el mismo almacenamiento. Cada asignación se guarda al momento; asignar `undefined` borra la clave y la siguiente lectura vuelve a `initial`.

Fuera del script de un componente lanza `Error: useStorage("<clave>") must be called while a component script runs`.

## Ejemplos

### Un ticket que sobrevive a una recarga

```html
<!-- app/pages/pos.meeko -->
<script lang="ts">
interface TicketLine { productId: string; quantity: number }
const lines = useStorage("pos:ticket", [] as TicketLine[]);
const add = (productId: string): void => { lines.value = [...lines.value, { productId, quantity: 1 }]; };
const clear = (): void => { lines.value = []; };
</script>

<template>
  <p>{lines.value.length} productos en el ticket</p>
  <button type="button" on:click="clear">Vaciar</button>
</template>
```

### Validar lo que se lee

Otro script, una versión anterior de la aplicación o el propio usuario pueden dejar en el almacenamiento algo inesperado. Con `schema`, un valor inválido se ignora y la señal vale `initial`:

<!-- no-check -->
```ts
import * as v from "valibot";

const density = useStorage("table:density", "normal", { schema: v.picklist(["compact", "normal", "comfortable"]) });
// density: Signal<"compact" | "normal" | "comfortable">
```

### Un borrador por pestaña

```html
<script lang="ts">
const draft = useStorage<string | undefined>("comment:draft", undefined, { storage: "session" });
const discard = (): void => { draft.value = undefined; }; // borra la clave
</script>

<template>
  <textarea bind:value="draft.value ?? ''" on:input="(event) => draft.value = event.currentTarget.value"></textarea>
  <button type="button" on:click="discard">Descartar</button>
</template>
```

## Errores comunes

### Mutar el valor guardado

```ts bad
lines.value.push(line);
```

No hay error, pero la señal no avisa y el almacenamiento no se escribe: tras recargar, la línea no está. Asigna un valor nuevo:

<!-- no-check -->
```ts good
lines.value = [...lines.value, line];
```

### Asignar otro tipo

```ts bad
const theme = useStorage("theme", "light");
theme.value = 1;
```

`meeko check` da `TS2322: Type 'number' is not assignable to type 'string'`: `initial` fija el tipo. Para una unión, escríbela: `useStorage<"light" | "dark">("theme", "light")`.

<!-- no-check -->
```ts good
theme.value = "dark";
```

### Llamarlo en un manejador

```ts bad
function remember(id: string): void {
  useStorage("last:item", "").value = id;
}
```

En ejecución lanza `Error: useStorage("last:item") must be called while a component script runs`. Crea la señal en el script y escríbela en el manejador:

<!-- no-check -->
```ts good
const lastItem = useStorage("last:item", "");
function remember(id: string): void { lastItem.value = id; }
```

### Guardar secretos

```ts bad
const token = useStorage("auth:token", "");
```

Cualquier script de la página puede leer `localStorage`: un token guardado ahí está expuesto a cualquier XSS. La sesión de Meeko ya vive en una cookie `HttpOnly`; no guardes credenciales en el almacenamiento.

<!-- no-check -->
```ts good
const lastSearch = useStorage("search:last", ""); // sólo preferencias y estado no sensible
```

## Notas

- **SSR e hidratación.** El servidor nunca lee el almacenamiento y la señal no viaja en el payload. Un componente que se monta después (un `if:when` que se abre, la página de una navegación) ya pinta el valor guardado en su primer render.
- **Almacenamiento bloqueado.** En modo privado, sin permiso o con la cuota llena, nunca lanza: la señal sigue funcionando en memoria. Sólo un fallo inesperado (un valor que JSON no puede representar, como un `BigInt` o un ciclo, o un `schema` que lanza o es asíncrono) llega al `provideErrorHandler` más cercano.
- **Otras pestañas.** Mientras algún componente usa la clave, el evento `storage` de otra pestaña actualiza la señal, con la misma validación; un `localStorage.clear()` la devuelve a `initial`.
- **Una señal por clave.** Dos componentes con la misma clave y el mismo almacenamiento comparten una señal; el primero fija `initial` y `schema`. Cuando ninguno la usa, el siguiente vuelve a leer el almacenamiento.
- **Elegir.** Estado compartido igual en SSR y en el navegador: [`useState`](/docs/reference/usestate). Estado del navegador que sobrevive a recargas: `useStorage`. Datos que pertenecen al servidor: [`useApi`](/docs/reference/use-api).
