---
title: invalidate
group: utils
since: 1.10.0
description: Invalida claves de datos en el navegador para que los useApi, useRpcQuery y loaders montados que dependen de ellas vuelvan a pedir sus datos sin volver a montarse.
symbols:
  - "@meekojs/meeko/framework#invalidate"
types:
  - "@meekojs/meeko/framework#DataKey"
  - "@meekojs/meeko/framework#GeneratedDataKeys"
related:
  - "@meekojs/meeko/server#defineRpc"
  - "@meekojs/meeko/server#defineApiRoute"
  - "autoimport:useApi"
  - "autoimport:useRpcQuery"
  - "@meekojs/meeko/framework#useRoute"
  - "@meekojs/meeko/framework#usePage"
  - docs/framework-api.md#claves-de-datos-e-invalidación
  - docs/routing-data-reference.md#recargar-los-datos-de-la-página-depends
---

`invalidate(...claves)` dice al navegador que cambiaron los datos de esas claves. Cada `useApi` y `useRpcQuery` montado cuya clave coincide vuelve a pedir sus datos, conservando los anteriores mientras llegan (`refreshing` en `true`), y el loader de la página visible se vuelve a ejecutar si declaró una clave que coincide con `depends`. Nada se vuelve a montar: sólo se actualiza lo que lee esos datos.

Una mutación no la necesita: la respuesta correcta de un `defineRpc` o un `defineApiRoute` con `invalidates` ya invalida sus claves. `invalidate` es para los cambios que llegan por otra vía, como un mensaje de un socket o una escritura hecha con `fetch` propio. Se importa de `@meekojs/meeko/framework` y se autoimporta en `app/`.

## Uso

```html
<!-- app/pages/orders.meeko -->
<script lang="ts">
	const orders = await useApi('/api/orders') // clave "orders"
	const feed = useSocket('orders')
	// Otra persona cambió un pedido: se recargan la lista y la ficha de ese pedido, si están montadas.
	feed.on('changed', ({ id }) => invalidate('orders', `orders.${id}`))
</script>
<template>
	<ul bind:aria-busy="orders.refreshing.value ? 'true' : undefined">
		<li
			each:of="orders.data.value"
			each:as="order"
			each:key="order.id"
		>
			{order.item}
		</li>
	</ul>
</template>
```

## Parámetros

| Parámetro | Tipo        | Por defecto               | Descripción                                                                                                                                                                                                    |
| --------- | ----------- | ------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `claves`  | `DataKey[]` | al menos una, obligatoria | Claves de datos, como `"orders"` u `` `orders.${id}` ``. Una clave cubre las que empiezan por ella y un punto: `"orders"` refresca `"orders.list"` y `"orders.42"`, pero `"orders.42"` no refresca `"orders"`. |

La clave por convención de `useRpcQuery` es el ID del procedimiento (`"orders.list"`) y la de `useApi`, los segmentos estáticos de la ruta tras `/api`, unidos por puntos (`"/api/orders/[id]"` da `"orders"`). La opción `keys` de los dos y `depends` del loader añaden otras.

## Valor devuelto

Una `Promise<void>` que se cumple cuando terminan las recargas que provocó. Nunca rechaza: el fallo de una recarga queda en el `error` de su recurso, y el de un loader llega al observador de errores de la aplicación. Las invalidaciones de la misma tarea comparten las recargas: cada dato se pide una vez.

## Ejemplos

### Tras una escritura con un `fetch` propio

<!-- no-check -->

```ts
// app/composables/upload.ts
import { invalidate } from '@meekojs/meeko/framework'

export async function uploadAvatar(userId: string, file: File): Promise<void> {
	const response = await fetch(`/uploads/avatars/${userId}`, { method: 'PUT', body: file })
	if (!response.ok) throw new Error(`Upload failed: ${response.status}`)
	// La ficha del usuario depende de "users.<id>" (keys o depends).
	await invalidate(`users.${userId}`)
}
```

### Un recurso con su propia clave

```html
<!-- app/components/OrderCard.meeko -->
<script lang="ts">
	const props = defineProps<{ id: string }>()
	// Además de "orders", la ficha depende de "orders.<id>".
	const order = useApi('/api/orders/[id]', () => ({ params: { id: props.id } }), { keys: () => [`orders.${props.id}`] })
</script>
<template><p if:when="order.data.value">{order.data.value.status}</p></template>
```

`invalidate("orders.42")` recarga sólo la tarjeta del pedido 42; `invalidate("orders")`, todas las tarjetas y la lista.

## Errores comunes

### Invalidar una clave más concreta que la lectura

```ts bad
// La lista depende de "orders": "orders.42" está por debajo y no la recarga.
await invalidate('orders.42')
```

Las claves no suben: una invalidación sólo alcanza las lecturas que dependen de su clave o de una por debajo. Invalida la clave de la lista, o las dos:

```ts good
import { invalidate } from '@meekojs/meeko/framework'

await invalidate('orders', 'orders.42')
```

`meeko check` avisa de este error con `MEEK141` cuando la clave está en `invalidates` o en `invalidate()` de un handler de `server/`.

### Llamarla sin claves para recargarlo todo

```ts bad
await invalidate()
// TypeError: invalidate() needs at least one data key, such as invalidate("orders"); useRoute().refresh() reloads all the data of the current route
```

Para recargar todos los datos de la ruta actual hay una API explícita:

```ts good
import { useRoute } from '@meekojs/meeko/framework'

// En el script de un componente: la página y todos sus recursos montados.
const route = useRoute()
await route.refresh()
```

### Una clave con un punto de sobra

```ts bad
await invalidate(`orders.${id}.`)
// TypeError: invalidate: a data key must be a non-empty string of at most 200 characters, with dots only between segments…
```

Los segmentos vacíos no son claves válidas: `".orders"`, `"orders."` y `"orders..x"` lanzan `TypeError`.

```ts good
import { invalidate } from '@meekojs/meeko/framework'

const id = '42'
await invalidate(`orders.${id}`)
```

## Notas

- **Sólo lo montado.** Un recurso que no está montado (el de una página de la que ya se navegó, o el de una región `if:` cerrada) no se pide: carga sus datos al montarse. Un recurso con `enabled` en `false` tampoco pide nada.
- **Sin volver a montar.** El loader de la página se vuelve a ejecutar y la página recibe sus datos nuevos en su sitio: `props.data` y los exports de `<script server>` cambian, y se conservan el foco, lo que se está escribiendo y el estado de los componentes.
- **Concurrencia.** Una invalidación posterior reinicia la recarga en curso de un dato, para que refleje también la última escritura. Durante una navegación no se vuelve a ejecutar el loader de la página que se abandona.
- **SSR.** En el servidor no hace nada y resuelve enseguida: no hay recursos montados.
- **Tipos.** `DataKey` acepta cualquier cadena; las claves por convención de la aplicación llegan al autocompletado a través de `GeneratedDataKeys`, que `meeko check` y `meeko dev` generan.
