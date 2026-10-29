---
title: generic
group: syntax
since: 1.1.0
description: Declara parámetros de tipo de un componente en su script, que el padre infiere de las props y que tipan eventos, modelos, snippets y refs.
symbols:
  - "syntax:generic"
related:
  - "syntax:defineprops"
  - "syntax:defineemits"
  - "syntax:definesnippets"
  - "syntax:definemodel"
  - "syntax:defineexpose"
  - docs/api.md#componentes-genéricos-generic
---

El atributo `generic` del `<script lang="ts">` declara parámetros de tipo del componente, como una función genérica de TypeScript. Su valor es una lista de parámetros con restricciones (`extends`), valores por defecto y parámetros que dependen de otros: `generic="T extends object, K extends keyof T"`.

El padre no escribe los argumentos de tipo: cada etiqueta los infiere de sus props y, con ese tipo, comprueba sus eventos, sus modelos, sus snippets y su `ref:`. Así una tabla, una lista o un select sirven para cualquier fila sin perder los tipos.

## Uso

```html
<!-- app/components/DataTable.meeko -->
<script lang="ts" generic="T extends { id: string }">
const props = defineProps<{ rows: T[] }>();
const emit = defineEmits<{ select: [row: T] }>();
const snippets = defineSnippets<{ row: [row: T] }>();
</script>

<template>
  <ul>
    <li each:of="props.rows" each:as="row" each:key="row.id" on:click="() => emit('select', row)">
      <render snippet="snippets.row" args="row" />
    </li>
  </ul>
</template>
```

```html
<!-- app/pages/users.meeko -->
<script lang="ts">
interface User { id: string; email: string }
const users = signal<User[]>([{ id: "1", email: "ana@example.com" }]);
function open(email: string): void {
  console.log(email);
}
</script>

<template>
  <DataTable bind:rows="users.value" on:select="(user) => open(user.email)">
    <snippet name="row" params="user"><span>{user.email}</span></snippet>
  </DataTable>
</template>
```

Con `rows: User[]`, `T` es `User`: el manejador de `on:select` y el parámetro `user` del snippet son `User`.

## Atributos

| Atributo | Tipo | Por defecto | Descripción |
| --- | --- | --- | --- |
| `generic` | lista de parámetros de tipo | ninguno | Los parámetros del componente, con la sintaxis de TypeScript entre `<` y `>`: `T`, `T extends X`, `T = X`, `K extends keyof T`. Sin modificadores `const`, `in` ni `out`. |

## Resultado

- **En el script.** Los parámetros existen en todo el `<script>`: en los argumentos de tipo de `defineProps`, `defineEmits`, `defineModel` y `defineSnippets`, en el valor de `defineExpose` y en las anotaciones de variables y funciones.
- **En el padre.** Cada etiqueta infiere los parámetros una vez, a partir de sus props (también de los manejadores `on:` con parámetros anotados), y comprueba el resto con ellos.
- **En el módulo compilado.** `ComponentProps<T>`, `ComponentModels<T>`, `ComponentSnippets<T>` y `ComponentExposed<T>` llevan los mismos parámetros, y `renderWithState`, `renderToString`, `hydrate` y `hydrateScope` son genéricas. Las declaraciones `.d.meeko.ts` de `meeko types` los conservan.
- **En ejecución.** Nada: los tipos desaparecen al compilar.

## Ejemplos

### Una clave elegida por el padre

Un parámetro puede depender de otro. Aquí `K` es una clave de `T` y el padre la elige con una prop estática:

```html
<!-- app/components/AppPicker.meeko -->
<script lang="ts" generic="T extends Record<string, unknown>, K extends keyof T & string">
const props = defineProps<{ items: T[]; labelKey: K }>();
const selected = defineModel<T | null>({ default: null });
</script>

<template>
  <ul role="listbox" aria-label="Opciones">
    <li each:of="props.items" each:as="item" role="option" on:click="() => selected.value = item">{String(item[props.labelKey])}</li>
  </ul>
</template>
```

```html
<AppPicker bind:items="countries.value" labelKey="name" model="country" />
```

Con `countries` de tipo `{ code: string; name: string }[]`, `labelKey="nombre"` es un error de tipos, y `country` debe ser una `Signal<{ code: string; name: string } | null>`.

### Un tipo auxiliar genérico

Las declaraciones `interface` y `type` del script se declaran a nivel de módulo, donde `T` no existe. Hazlas genéricas y pásales el parámetro:

```html
<script lang="ts" generic="T">
type Rows<U> = readonly U[];
const props = defineProps<{ rows: Rows<T>; empty?: string }>({ empty: "Sin datos" });
</script>

<template>
  <p if:when="props.rows.length === 0">{props.empty}</p>
</template>
```

### Exponer valores con el tipo del padre

`defineExpose` también usa `T`, y la `ref:` del padre recibe el valor con el `T` inferido:

```html
<!-- app/components/AppList.meeko -->
<script lang="ts" generic="T extends { id: string }">
const props = defineProps<{ items: T[] }>();
defineExpose({ first: (): T | undefined => props.items[0] });
</script>

<template><ul><li each:of="props.items" each:as="item" each:key="item.id">{item.id}</li></ul></template>
```

```html
<script lang="ts">
const notes = signal([{ id: "n1", title: "Hola" }]);
const list = useElementRef("list");
function firstTitle(): string | undefined {
  return list.value?.first()?.title;
}
</script>

<template><AppList ref:list bind:items="notes.value" /></template>
```

## Errores comunes

### Un `interface` que usa el parámetro

```html bad
<script lang="ts" generic="T extends { id: string }">
interface Props { rows: T[] }
const props = defineProps<Props>();
</script>
```

`MEEK100: Esta declaración de tipo usa T, un parámetro de generic, pero los tipos del script se declaran a nivel de módulo, donde T no existe; escríbela en el argumento de la macro (defineProps<{ rows: T[] }>()) o hazla genérica (type Rows<T> = ...) y pásale T`.

```html good
<script lang="ts" generic="T extends { id: string }">
const props = defineProps<{ rows: T[] }>();
</script>
```

### Un modificador `const`, `in` u `out`

```html bad
<script lang="ts" generic="const T">
```

`MEEK100: generic no admite el modificador const; escribe sólo el nombre, la restricción y el valor por defecto`. Un `generic=""` vacío da `MEEK100: generic necesita al menos un parámetro de tipo, como generic="T" o generic="T extends { id: string }"`.

```html good
<script lang="ts" generic="T">
```

### Una página o un layout genéricos

Meeko pasa sus props a las páginas, los layouts, `app/app.meeko` y las páginas de error: no puede elegir sus parámetros de tipo.

```html bad
<!-- app/pages/list.meeko -->
<script lang="ts" generic="T">
const props = defineProps<{ rows: T[] }>();
</script>
```

`meeko check` del proyecto da `MEEK100: Las páginas, los layouts, app.meeko y las páginas de error no pueden ser genéricos: Meeko les pasa sus props y no puede elegir sus parámetros de tipo; quita generic o lleva el contenido genérico a un componente de app/components`. Tampoco un `<script server>` lleva `generic`.

```html good
<!-- app/pages/list.meeko -->
<script lang="ts">
const rows = signal([{ id: "a1" }, { id: "b2" }]);
</script>

<template><DataTable bind:rows="rows.value"><snippet name="row" params="row">{row.id}</snippet></DataTable></template>
```

### Props que no cumplen la restricción

```html bad
<DataTable bind:rows="plain.value">
  <snippet name="row" params="row"><span>{row.email}</span></snippet>
</DataTable>
```

Con `plain` de tipo `Signal<{ email: string }[]>`, `meeko check` da `TS2322: Type '{ email: string; }[]' is not assignable to type '{ id: string; }[]'.` en `bind:rows`, y el snippet se comprueba con la restricción: `TS2339: Property 'email' does not exist on type '{ id: string; }'.`

```html good
<DataTable bind:rows="users.value">
  <snippet name="row" params="row"><span>{row.email}</span></snippet>
</DataTable>
```

## Notas

- **Inferencia.** `T` sólo se infiere de las props. Los modelos, los snippets y las refs se comprueban con el `T` que dan las props; si ninguna prop lo determina, TypeScript usa la restricción (o `unknown`).
- **Listas.** Una `ref:` en una etiqueta genérica dentro de `each:of` tipa el valor expuesto de cada fila con la restricción de `T`, no con el `T` inferido.
- **Literales.** Una prop estática conserva su literal: con `generic="T extends string"`, `<Chip value="draft" />` infiere `T = "draft"`.
- **`<component is>`.** Desde `1.5`, admite contenido como snippets, así que un componente genérico con snippets obligatorios se puede usar con `<component is>` igual que con su etiqueta.
- **Editor.** El hover de la etiqueta muestra los parámetros resueltos (`T = User`) y la gramática resalta el valor de `generic` como TypeScript.
- **Coste.** Los parámetros sólo existen en la comprobación de tipos: no añaden código al bundle ni cambian el SSR o la hidratación.
