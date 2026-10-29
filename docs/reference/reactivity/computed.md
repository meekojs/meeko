---
title: computed
group: reactivity
since: 1.0.0
description: Deriva un valor de solo lectura de otras señales y lo recalcula en cuanto cambia alguna de las que leyó.
symbols:
  - "@meekojs/meeko#computed"
types:
  - "@meekojs/meeko#ReadonlySignal"
related:
  - "@meekojs/meeko#signal"
  - "@meekojs/meeko#effect"
  - "@meekojs/meeko#batch"
  - "@meekojs/meeko#untrack"
  - docs/api.md#reactividad
---

`computed(fn)` devuelve una señal de sólo lectura cuyo valor es el resultado de `fn`. Meeko ejecuta `fn` al crearla, registra las señales que lee y la vuelve a ejecutar cada vez que una de ellas cambia; quien lee el `computed` (la plantilla, otro `computed`, un `effect`) se actualiza a su vez. Úsalo para todo lo que se calcula a partir del estado: totales, filtros, textos formateados, condiciones.

Un `computed` no es estado: no viaja en el payload ni lo conserva HMR, porque se vuelve a calcular al hidratar a partir de las señales que sí viajan. Se exporta desde `@meekojs/meeko` y se autoimporta en las aplicaciones del framework.

## Uso

```html
<!-- app/components/Cart.meeko -->
<script lang="ts">
const items = signal([{ name: "Café", price: 3 }, { name: "Té", price: 2 }]);
const total = computed(() => items.value.reduce((sum, item) => sum + item.price, 0));
</script>

<template>
  <p>{items.value.length} productos, {total.value} €</p>
</template>
```

Al asignar `items.value`, `total` se recalcula y la plantilla muestra el nuevo importe.

## Parámetros

| Parámetro | Tipo | Por defecto | Descripción |
| --- | --- | --- | --- |
| `fn` | `() => T` | obligatorio | Función pura que lee señales y devuelve el valor. Se ejecuta en cuanto se crea el `computed` y de nuevo con cada cambio de las señales que leyó en su última ejecución. |

## Valor devuelto

Un `ReadonlySignal<T>` cuyo `value` es el último resultado de `fn`. Leerlo registra la dependencia como con cualquier señal; asignarlo es un error de tipos.

El `computed` sólo avisa a sus lectores cuando el resultado cambia según `Object.is`: si `fn` devuelve el mismo número, nada se vuelve a pintar.

## Ejemplos

### Un filtro sobre una lista

```ts
import { computed, signal } from "@meekojs/meeko";

interface Task { title: string; done: boolean }

const tasks = signal<Task[]>([{ title: "Escribir", done: true }, { title: "Revisar", done: false }]);
const showDone = signal(false);
const visible = computed(() => showDone.value ? tasks.value : tasks.value.filter((task) => !task.done));

showDone.value = true; // visible.value vuelve a incluir las tareas hechas
```

### Una condición para la plantilla

```html
<script lang="ts">
const password = signal("");
const confirm = signal("");
const mismatch = computed(() => confirm.value !== "" && password.value !== confirm.value);
</script>

<template>
  <input type="password" model="password">
  <input type="password" model="confirm" bind:aria-invalid="mismatch.value ? 'true' : null">
  <p if:when="mismatch.value" role="alert">Las contraseñas no coinciden.</p>
</template>
```

### Derivar de props y de datos

Las props de `defineProps` son reactivas desde `1.2`: un `computed` que las lee sigue al padre sin volver a montar el hijo.

```html
<!-- app/components/Price.meeko -->
<script lang="ts">
const props = defineProps<{ cents: number; currency: string }>();
const label = computed(() => new Intl.NumberFormat("es", { style: "currency", currency: props.currency }).format(props.cents / 100));
</script>

<template><span class="price">{label.value}</span></template>
```

### Derivar un valor que no se puede serializar

Las señales del estado viajan en JSON, así que guardan el dato serializable; el `computed` crea el objeto en cada lado:

```ts
import { computed, signal } from "@meekojs/meeko";

const isoDate = signal("2026-10-29T10:00:00.000Z");
const date = computed(() => new Date(isoDate.value));
const weekday = computed(() => date.value.toLocaleDateString("es", { weekday: "long" }));
```

## Errores comunes

### Asignar `value`

```ts bad
const double = computed(() => count.value * 2);
double.value = 10;
```

`meeko check` da `TS2540: Cannot assign to 'value' because it is a read-only property`. En ejecución, desde `1.7`, la asignación lanza `TypeError: Meeko computed values are read-only: change the signals it reads, or use a signal`, también en JavaScript sin tipos (hasta `1.6` sobrescribía el valor hasta el siguiente recálculo). Escribe la señal de origen:

<!-- no-check -->
```ts good
count.value = 5; // double.value pasa a 10
```

### Efectos secundarios dentro de `fn`

`fn` se ejecuta al crearlo y con cada cambio, también en SSR y en la pasada en seco de una navegación, donde los `effect` no se ejecutan pero los `computed` sí.

```ts bad
const total = computed(() => {
  localStorage.setItem("total", String(price.value * quantity.value));
  return price.value * quantity.value;
});
```

En el SSR con Node 24 lanza `ReferenceError: localStorage is not defined`, y en el navegador escribe en cada recálculo, también en pasadas que se descartan. Calcula en el `computed` y escribe fuera, en un [`effect`](/docs/reference/effect) o con [`useStorage`](/docs/reference/usestorage):

<!-- no-check -->
```ts good
const total = computed(() => price.value * quantity.value);
effect(() => localStorage.setItem("total", String(total.value)));
```

### Un `computed` asíncrono

```ts bad
const user = computed(async () => (await fetch(`/api/users/${id.value}`)).json());
```

No da error, pero `user.value` es una `Promise`, no los datos, y las lecturas posteriores al `await` no se registran. Para datos del servidor usa [`useApi`](/docs/reference/use-api) o [`useRpcQuery`](/docs/reference/use-rpc-query), que se recargan al cambiar sus señales:

<!-- no-check -->
```ts good
const user = useApi("/api/users/[id]", () => ({ params: { id: id.value } }));
```

### Leer un `computed` dentro de `batch`

Dentro de [`batch`](/docs/reference/batch) los observadores esperan al final, y un `computed` es un observador: su valor no cambia hasta que termina el lote.

```ts bad
batch(() => {
  count.value = 5;
  console.log(double.value); // todavía el valor anterior
});
```

Lee el resultado después de `batch`, o calcula a partir de las señales que acabas de escribir:

<!-- no-check -->
```ts good
batch(() => { count.value = 5; });
console.log(double.value); // 10
```

## Notas

- **Ansioso, no perezoso.** El `computed` se calcula al crearse y en cuanto cambia una dependencia, aunque nadie lo lea. Mantén `fn` barata; para trabajo caro que no siempre se necesita, una función normal que la plantilla llama sólo donde hace falta.
- **SSR e hidratación.** Se calcula igual en el servidor y en el navegador a partir de las mismas señales, así que el HTML coincide. No forma parte del estado transferido ni lo conserva HMR.
- **Dependencias dinámicas.** En cada ejecución sólo cuenta lo que `fn` leyó: en `a.value ? b.value : c.value`, el `computed` no depende de `c` mientras `a` sea verdadera.
- **Ciclo de vida.** Pertenece a la raíz activa (el componente) y deja de recalcularse al desmontarlo. Creado fuera de una raíz, vive mientras vivan sus señales.
- **Igualdad.** Avisa a sus lectores sólo si el resultado cambia según `Object.is`; un `computed` que devuelve un objeto nuevo en cada ejecución avisa siempre.
