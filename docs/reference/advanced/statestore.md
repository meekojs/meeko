---
title: StateStore
group: advanced
since: 1.0.0
description: Almacén del estado de useState, con una señal por clave y valores serializables en JSON, que se crea por petición en el servidor y se transfiere al navegador.
symbols:
  - "@meekojs/meeko/framework#StateStore"
related:
  - "@meekojs/meeko/framework#useState"
  - "@meekojs/meeko/framework#mountClientApp"
  - "@meekojs/meeko/framework#definePage"
  - "@meekojs/meeko#serializeJson"
  - docs/framework.md#streaming-ssr-render-stream
---

`StateStore` guarda el estado compartido de una aplicación: una señal por clave, creada la primera vez que alguien la pide. Es lo que hay debajo de [`useState`](/docs/reference/usestate): en el servidor hay un almacén por petición, que se **sella** cuando el HTML ya salió y viaja al navegador en el payload; en el navegador hay uno por aplicación montada (`ClientApp.state`), que sobrevive a las navegaciones.

Los loaders de las páginas lo reciben como `state` para sembrar valores antes del render, y un host propio lo crea para sus renders o sus pruebas.

## Uso

```ts
import { StateStore } from "@meekojs/meeko/framework";

const state = new StateStore({ theme: "dark" });
const theme = state.get("theme", () => "light"); // conserva "dark"
const count = state.get("count", () => 0);
count.value++;
console.log(state.snapshot()); // { theme: "dark", count: 1 }
```

## Parámetros

| Parámetro | Tipo | Por defecto | Descripción |
| --- | --- | --- | --- |
| `initial` | `Record<string, unknown>` | `{}` | Valores iniciales por clave. Deben poder serializarse con `serializeJson`: objetos planos, arrays, textos, números, booleanos y `null`. |

## Valor devuelto

Una instancia con:

| Miembro | Descripción |
| --- | --- |
| `get(key, factory)` | La señal de `key`; la crea con `factory()` si no existe. Es lo que hace `useState(key, factory)`. |
| `seed(values)` | Añade valores sin sustituir las claves que ya existen. Es como el navegador recibe el estado de una navegación del servidor. |
| `snapshot()` | Copia los valores actuales por clave, comprobando que se pueden serializar. |
| `seal()` | Congela el almacén: claves nuevas, `seed` y escrituras lanzan `STATE_SEALED`. El servidor lo llama tras el render síncrono. |
| `sealed` | `true` cuando ya está sellado. |
| `seedForNavigation(values, commit)`, `navigationDraft()` | Aplican el estado de una navegación sólo si su cambio del DOM termina bien; los usa `mountClientApp`. |

El constructor lanza `TypeError` si un valor no es serializable (`Non-plain object at $.when`) y `get` si la clave está vacía o es `__proto__`, `constructor` o `prototype` (`Invalid state key`).

## Ejemplos

### Sembrar el estado desde el loader de una página

```ts
// app/pages/cart.route.ts
import { definePage } from "@meekojs/meeko/framework";

export const route = definePage({
  load: ({ state }) => {
    state.get("cart.count", () => 3);
    return { title: "Carrito" };
  },
});
```

```html
<!-- app/components/CartBadge.meeko, en el layout -->
<script lang="ts">
const count = useState("cart.count", () => 0);
</script>

<template><span class="badge">{count.value}</span></template>
```

El layout lee `3` en el SSR y el navegador lo recibe en el payload: la hidratación no cambia el número.

### Leer el estado de la aplicación montada

<!-- no-check -->
```ts
const app = await mountClientApp(options);
const theme = app.state.get("theme", () => "light");
theme.value = "dark"; // todos los componentes que usan useState("theme") se actualizan
```

### Un render propio con estado

```ts
import { StateStore } from "@meekojs/meeko/framework";

const state = new StateStore();
state.get("user", () => ({ name: "Ada" }));
// …render…
state.seal();
const payload = JSON.stringify({ sharedState: state.snapshot() });
console.log(payload); // {"sharedState":{"user":{"name":"Ada"}}}
```

## Errores comunes

### Escribir el estado cuando la página ya se envió

```ts bad
export const route = definePage({
  load: ({ state }) => {
    const count = state.get("count", () => 0);
    setTimeout(() => { count.value = 5; }, 1000);
    return {};
  },
});
```

Cuando el temporizador se dispara, el almacén ya está sellado: `StateSealedError: STATE_SEALED: Meeko state "count" cannot change after the page was rendered; the browser already received it`. El estado viaja con el HTML, así que un cambio posterior no puede llegar al navegador.

<!-- no-check -->
```ts good
export const route = definePage({
  load: async ({ state }) => {
    state.get("count", () => 0).value = await computeCount(); // antes de que termine el load
    return {};
  },
});
```

### Un valor que no es JSON

```ts bad
const state = new StateStore({ when: new Date() });
```

`TypeError: Non-plain object at $.when`. Con `get`, el valor de la factoría no se comprueba al crear la clave, sino al serializarlo: `state.get("tags", () => new Map())` se acepta y falla después, en `snapshot()` o al enviar el payload, con `Non-plain object at $.tags`.

```ts good
import { StateStore } from "@meekojs/meeko/framework";

const state = new StateStore({ when: new Date().toISOString(), tags: ["a", "b"] });
```

### Una clave reservada

```ts bad
state.get("__proto__", () => ({}));
```

`TypeError: Invalid state key`. También `""`, `constructor` y `prototype`.

<!-- no-check -->
```ts good
state.get("proto.settings", () => ({}));
```

## Notas

- **Servidor y navegador.** En el servidor, un almacén por petición: nunca compartas estado entre usuarios en una variable de módulo. En el navegador, uno por aplicación, que conserva las claves entre navegaciones; `seed` sólo añade las nuevas.
- **Seguridad.** Todo lo que guardas viaja en el HTML: no pongas secretos ni datos de otros usuarios.
- **Reactividad.** Cada clave es una `signal`: leerla en una plantilla, un `computed` o un `effect` la suscribe.
- **Tamaño.** El payload crece con el estado; guarda identificadores y datos pequeños, y deja los grandes en los datos de la página.
- **Errores no exportados.** `StateSealedError` no se exporta: compara `error.code === "STATE_SEALED"`.
