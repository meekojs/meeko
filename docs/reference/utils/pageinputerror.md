---
title: PageInputError
group: utils
since: 1.0.0
description: El error de una página cuyos params o search no superan los schemas de definePage, que el servidor responde con 400 y el navegador muestra con la página de error.
symbols:
  - "@meekojs/meeko/framework#PageInputError"
related:
  - "@meekojs/meeko/framework#definePage"
  - "@meekojs/meeko/framework#notFound"
  - "@meekojs/meeko/server#ApiError"
  - "@meekojs/meeko/server#createFrameworkHandler"
  - docs/framework.md#opciones-de-ruta-con-definepage
---

`PageInputError` es el error que Meeko lanza cuando los `params` o el `search` de una URL no superan los schemas que declara la página en `definePage`. Ocurre después del middleware de ruta y antes del loader y del código de nivel superior, que nunca reciben una entrada inválida.

El servidor responde `400` con su código (`INVALID_PARAMS` o `INVALID_SEARCH`), y en una navegación del navegador se muestra la página de error más cercana con ese estado. No lo lances tú: valida con los schemas. Exportarlo sirve a quien escribe un host propio o una prueba que necesita reconocerlo.

## Uso

```ts
import { PageInputError } from "@meekojs/meeko/framework";

export function statusOf(error: unknown): number {
  return error instanceof PageInputError ? 400 : 500;
}
```

## Parámetros

`new PageInputError(code)`:

| Parámetro | Tipo | Por defecto | Descripción |
| --- | --- | --- | --- |
| `code` | `"INVALID_PARAMS" \| "INVALID_SEARCH"` | obligatorio | La entrada que falló. También es el `message`. |

## Valor devuelto

Una instancia de `Error` con `code` y `message` iguales al código. Desde `1.7`, su `name` es `"PageInputError"`, como el de `ClientError` y `ApiError` (antes era `"Error"`); para distinguirlo en código, usa `instanceof PageInputError` o su `code`.

## Ejemplos

### La página que lo provoca

```html
<!-- app/pages/orders/[id].meeko -->
<script server lang="ts">
import * as v from "valibot";

export const route = definePage({
  params: v.object({ id: v.pipe(v.string(), v.regex(/^\d+$/)) }),
  search: v.object({ tab: v.optional(v.picklist(["items", "history"])) }),
});

const { params } = usePage();
export const order = { id: Number(params.id) };
</script>

<template><h1>Pedido {order.id}</h1></template>
```

`/orders/abc` responde `400 INVALID_PARAMS` y `/orders/7?tab=x`, `400 INVALID_SEARCH`, sin ejecutar el bloque.

### Un mensaje propio en la página de error

```html
<!-- app/pages/orders/+error.meeko -->
<script lang="ts">
const props = defineProps<{ status: number; message: string }>();
</script>

<template>
  <h1 if:when="props.status === 400">Esa dirección no es válida</h1>
  <p if:when="props.message === 'INVALID_SEARCH'">Revisa los filtros de la URL.</p>
  <h1 if:when="props.status !== 400">Algo ha fallado</h1>
</template>
```

## Errores comunes

### Validar a mano dentro de la página

Sin schemas, `params` es texto sin comprobar y el código de la página debe defenderse solo, sin ningún aviso si se olvida.

```html bad
<script server lang="ts">
const { params } = usePage();
export const order = await findOrder(Number(params.id)); // NaN con /orders/abc
</script>
```

```html good
<script server lang="ts">
import * as v from "valibot";
export const route = definePage({ params: v.object({ id: v.pipe(v.string(), v.regex(/^\d+$/)) }) });
const { params } = usePage();
export const order = await findOrder(Number(params.id));
</script>
```

### Lanzarlo para responder `400`

`PageInputError` sólo admite `INVALID_PARAMS` e `INVALID_SEARCH`, y su lugar es la validación de los schemas.

```ts bad
throw new PageInputError("INVALID_DATE");
```

`meeko check` da `TS2345: Argument of type '"INVALID_DATE"' is not assignable to parameter of type '"INVALID_PARAMS" | "INVALID_SEARCH"'.` Para otro `400`, lanza un `ApiError`.

<!-- no-check -->
```ts good
throw new ApiError("INVALID_DATE", 400);
```

## Notas

- **Cuándo.** La validación ocurre en cada petición, después del middleware de ruta (también el de servidor, que recibe `params` y `search` sin validar) y antes del `load` y del código de nivel superior.
- **Seguridad.** Los schemas de `params` y `search` son la validación de la entrada de la URL: con ellos, el código de la página recibe tipos ya comprobados.
- **Navegación.** En el navegador, la petición de datos responde `400` y se muestra el `+error.meeko` más cercano, o `app/error.meeko`, con `status: 400` y `message` igual al código.
