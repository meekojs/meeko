---
title: defineExpose
group: macros
since: 1.1.0
description: Publica un valor del componente, como métodos o señales, para el padre que lo nombra con ref: y lo lee con useElementRef.
symbols:
  - "syntax:defineexpose"
related:
  - "syntax:useelementref"
  - "syntax:ref"
  - "syntax:defineemits"
  - "syntax:definemodel"
  - docs/api.md#exponer-valores-defineexpose
---

`defineExpose(valor)` publica un valor del componente para el padre que lo nombra con `ref:nombre` y lo lee con `useElementRef("nombre")`. El padre recibe el valor con su tipo exacto. Sin `defineExpose`, el componente expone `null`. Es una macro de compilación: no se importa.

Sirve para acciones imperativas que no encajan en props y eventos: enfocar, limpiar, desplazar, abrir un diálogo.

## Uso

```html
<!-- app/components/SearchBox.meeko -->
<script lang="ts">
const query = signal("");
const input = useElementRef("input");
function clear(): void {
  query.value = "";
  input.value?.focus();
}
defineExpose({ query, clear });
</script>

<template><input ref:input type="search" model="query" aria-label="Buscar"></template>
```

```html
<!-- app/components/Toolbar.meeko -->
<script lang="ts">
const box = useElementRef("box");
</script>

<template>
  <SearchBox ref:box />
  <button type="button" on:click="() => box.value?.clear()">Limpiar</button>
  <p>Buscando: {box.value?.query.value ?? ""}</p>
</template>
```

## Parámetros

| Parámetro | Tipo | Por defecto | Descripción |
| --- | --- | --- | --- |
| `exposed` | `T` | obligatorio | El valor que recibe el padre: normalmente un objeto con funciones y señales. Sin argumento es `MEEK051`. |
| `T` (argumento de tipo) | cualquier tipo | inferido | Opcional, para anotar el tipo expuesto. Como mucho uno (`MEEK051`). |

## Valor devuelto

El mismo `exposed`. El padre lo recibe en `useElementRef("nombre")`:

- sin `await`, una `ReadonlySignal<T | null>`, `null` en SSR y hasta que el hijo se monta;
- con `await`, el valor, una vez que el hijo existe en el navegador.

El módulo compilado exporta su tipo como `ComponentExposed` (y cada componente autoimportado, como `<Nombre>Exposed`), y la función que devuelve `hydrateScope` lleva el valor en `exposed`.

## Ejemplos

### Un diálogo nativo que el padre abre

```html
<!-- app/components/ConfirmDialog.meeko -->
<script lang="ts">
const dialog = useElementRef("dialog");
const snippets = defineSnippets<{ default: [] }>();
defineExpose({
  open: (): void => dialog.value?.showModal(),
  close: (): void => dialog.value?.close(),
});
</script>

<template>
  <dialog ref:dialog>
    <render snippet="snippets.default" />
    <form method="dialog"><button>Cerrar</button></form>
  </dialog>
</template>
```

```html
<script lang="ts">
const confirm = useElementRef("confirm");
</script>

<template>
  <button type="button" on:click="() => confirm.value?.open()">Borrar</button>
  <ConfirmDialog ref:confirm><p>¿Borrar la nota?</p></ConfirmDialog>
</template>
```

### Esperar al hijo con `await`

Con `await`, el padre recibe el valor expuesto ya montado, sin `null`. Lo que sigue al `await` sólo se ejecuta en el navegador:

```html
<script lang="ts">
const ready = signal(false);
const box = await useElementRef("box");
box.query.value = "meeko";
ready.value = true;
</script>

<template><SearchBox ref:box /></template>
```

## Errores comunes

### Llamarla dos veces, o asignar su resultado

```html bad
<script lang="ts">
const api = defineExpose({ clear });
defineExpose({ focus });
</script>
```

`MEEK050: defineExpose debe aparecer una sola vez, como sentencia propia de nivel superior: defineExpose({ ... })`. Reúne todo en un objeto.

```html good
<script lang="ts">
defineExpose({ clear, focus });
</script>
```

### Sin argumento

```html bad
<script lang="ts">
defineExpose();
</script>
```

`MEEK051: defineExpose necesita un argumento: el valor que recibe el padre a través de ref`.

```html good
<script lang="ts">
defineExpose({ clear });
</script>
```

### Esperar un componente que no expone nada

```html bad
<script lang="ts">
const box = await useElementRef("box");
</script>
<template><NoExpose ref:box /></template>
```

`MEEK080: await useElementRef("box") espera el valor del defineExpose de un componente, pero el componente de ref:box no lo tiene. Añade defineExpose a ese componente o lee useElementRef("box").value`. En ejecución, la promesa rechaza con un error `MEEK080` al hidratarse el componente.

```html good
<script lang="ts">
const box = await useElementRef("box");
</script>
<template><SearchBox ref:box /></template>
```

### Usar el valor expuesto para pasar datos

Leer el estado del hijo desde el padre por la `ref:` acopla los dos y no funciona en SSR (`null`). Para datos que fluyen, usa props, eventos o un modelo.

```html bad
<p>{box.value?.query.value}</p>
```

```html good
<SearchBox model="query" />
<p>{query.value}</p>
```

Con `const query = defineModel<string>()` en el hijo y `const query = signal("")` en el padre.

## Notas

- **SSR.** El valor expuesto no viaja en el estado SSR y la `ref:` vale `null` en el servidor: lo que dependa de él debe ejecutarse en el navegador, en un manejador o en `onMounted`.
- **Dónde va.** Es una sentencia de nivel superior, antes del primer `await` de navegador (`MEEK058`).
- **Tipos.** `meeko check` y el editor tienen el tipo exacto. Las declaraciones `.d.meeko.ts` de `meeko types` pierden precisión y escriben `any` en lo que TypeScript no infiere allí.
- **Diseño.** Expón acciones pequeñas (`open`, `focus`, `clear`) en vez de todo el estado: el componente sigue siendo dueño de sus datos.
