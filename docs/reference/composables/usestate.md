---
title: useState
group: composables
since: 1.0.0
description: Devuelve la señal de estado compartido de la aplicación con una clave, creada la primera vez, por petición en SSR y transferida al navegador.
symbols:
  - "@meekojs/meeko/framework#useState"
types:
  - "@meekojs/meeko/framework#StateStore"
related:
  - "@meekojs/meeko#signal"
  - "@meekojs/meeko/framework#useStorage"
  - "@meekojs/meeko#provide"
  - "@meekojs/meeko#serializeJson"
  - docs/framework.md#autoimports-y-typescript
  - docs/framework.md#estado-persistente-usestorage
---

Una [`signal`](/docs/reference/signal) creada en un componente es suya: otro componente no la ve. `useState(key, factory)` da una señal **de la aplicación**, una por clave: el primer componente que pide `"cart:items"` la crea con `factory()`, y todos los demás que piden la misma clave reciben la misma señal. Es la base de los stores de `app/stores`.

En SSR hay un almacén por petición, así que dos usuarios nunca comparten estado; su contenido viaja en el payload y el navegador lo restaura antes de hidratar. En el navegador hay uno por aplicación montada, que sobrevive a las navegaciones. Se autoimporta en las aplicaciones.

## Uso

```ts
// app/stores/cart.ts
import { useState } from "@meekojs/meeko/framework";

export function useCart() {
  const items = useState("cart:items", (): string[] => []);
  const add = (id: string): void => { items.value = [...items.value, id]; };
  return { items, add };
}
```

```html
<!-- app/components/CartBadge.meeko -->
<script lang="ts">
const { items } = useCart();
</script>

<template><span class="badge">{items.value.length}</span></template>
```

Cualquier componente que llame a `useCart()` lee y escribe la misma lista.

## Parámetros

| Parámetro | Tipo | Por defecto | Descripción |
| --- | --- | --- | --- |
| `key` | `string` | obligatorio | Clave única en la aplicación, como `"cart:items"`. No puede estar vacía ni ser `__proto__`, `constructor` o `prototype` (`TypeError: Invalid state key`). |
| `factory` | `() => T` | obligatorio | Crea el valor inicial la primera vez que se pide la clave. Debe devolver algo que JSON represente fielmente. |

## Valor devuelto

La `Signal<T>` compartida de esa clave. Fuera de una aplicación de Meeko lanza `Error: Missing Meeko context: Meeko framework state`.

## Ejemplos

### Un store con estado derivado

```ts
// app/stores/session.ts
import { computed } from "@meekojs/meeko";
import { useState } from "@meekojs/meeko/framework";

export function useSessionStore() {
  const user = useState<{ id: string; name: string } | null>("session:user", () => null);
  const signedIn = computed(() => user.value !== null);
  return { user, signedIn, signOut: () => { user.value = null; } };
}
```

### Estado sembrado en el servidor

El servidor llena el estado durante el render; el navegador lo recibe en el payload y no repite el trabajo:

```html
<!-- app/app.meeko -->
<script lang="ts">
const visits = useState("app:renderedAt", () => new Date().toISOString());
</script>

<template>
  <div class="site-root"><MeekoOutlet /></div>
  <footer>Renderizado: {visits.value}</footer>
</template>
```

`factory` se ejecuta en el servidor; al hidratar, el navegador ya tiene la clave y no la vuelve a llamar, así que el texto coincide.

### Compartir entre páginas

En el navegador, el almacén vive mientras la aplicación está montada: un filtro elegido en una página sigue ahí al volver a ella.

```ts
// app/stores/filters.ts
import { useState } from "@meekojs/meeko/framework";

export const useFilters = () => useState("products:filters", () => ({ category: "todas", sort: "precio" }));
```

## Errores comunes

### Un valor que JSON no representa

```ts bad
const when = useState("agenda:when", () => new Date());
```

El estado viaja en JSON: al serializar el payload la respuesta falla con `TypeError: Non-plain object at $.when`. Guarda el texto y deriva el objeto:

<!-- no-check -->
```ts good
const when = useState("agenda:when", () => new Date().toISOString());
const date = computed(() => new Date(when.value));
```

### Pasar el valor en lugar de la función

```ts bad
const count = useState<number>("cart:count", 0);
```

`meeko check` da `TS2345: Argument of type 'number' is not assignable to parameter of type '() => number'`.

<!-- no-check -->
```ts good
const count = useState("cart:count", () => 0);
```

### Mutar el array o el objeto

```ts bad
items.value.push(id);
```

No hay error, pero la señal no avisa: ni la plantilla ni los demás componentes se enteran. Asigna un valor nuevo:

<!-- no-check -->
```ts good
items.value = [...items.value, id];
```

### Escribir el estado cuando la página ya salió

En el servidor el almacén se sella tras el render: el payload ya está escrito.

```ts bad
// En el script de un componente: una promesa suelta que escribe después del render.
const stats = useState<Stats | null>("stats", () => null);
fetchStats().then((value) => { stats.value = value; });
```

En SSR, la escritura tardía lanza `STATE_SEALED: Meeko state "stats" cannot change after the page was rendered; the browser already received it` y, sin un `catch`, es un rechazo sin manejar. Carga el dato antes del render, en `<script server>`, `load` o con `await useApi`:

<!-- no-check -->
```ts good
const stats = await useRpcQuery("stats.summary");
```

## Notas

- **Por petición.** En el servidor, cada petición tiene su almacén: nunca guardes estado de la aplicación en una variable de módulo, que sí se comparte entre usuarios.
- **Hidratación.** El navegador restaura el estado del payload antes de hidratar, así que `factory` no se vuelve a ejecutar para las claves que el servidor ya creó.
- **Navegación.** En una navegación del cliente, las claves nuevas que crea el servidor se añaden sin sustituir las existentes. Un loader de una ruta `render: "client"` escribe en un estado provisional que se aplica al confirmar la ruta.
- **Persistencia.** El estado vive en memoria: una recarga lo vuelve a crear. Para sobrevivir a recargas o compartir entre pestañas, usa [`useStorage`](/docs/reference/usestorage).
- **Seguridad.** Todo lo que guardas viaja en el HTML de la página: no pongas ahí secretos ni datos de otros usuarios.
- **Dónde llamarlo.** En el script de un componente o en un composable o store que éste llama mientras se ejecuta. El compilador no lo limita al nivel superior (no da `MEEK054`), pero busca el almacén en la raíz activa: en un manejador de eventos no la hay y lanza `Missing Meeko context`. Pide la señal en el script y úsala en el manejador.
