---
title: useLayout
group: composables
since: 1.5.0
description: Lee y cambia desde la página, de forma tipada y reactiva, las props del layout con nombre que la envuelve.
symbols:
  - "@meekojs/meeko/framework#useLayout"
types:
  - "@meekojs/meeko/framework#LayoutHandle"
  - "@meekojs/meeko/framework#LayoutProps"
related:
  - "@meekojs/meeko/framework#definePage"
  - "@meekojs/meeko/framework#defineGroup"
  - "syntax:meekooutlet"
  - "syntax:meekoteleport"
  - docs/framework.md#props-del-layout-desde-la-página
  - docs/framework.md#layouts-con-nombre
---

Un layout con nombre (`app/layouts/dashboard.meeko`) declara props normales: un título, si muestra un aviso, qué pestaña marca. La página se las pasa de dos formas: estáticas o calculadas con sus datos en `layoutProps` de [`definePage`](/docs/reference/definepage), o desde su `<script>` con `useLayout()`, para lo que depende del estado del navegador. `layout.set(patch)` cambia las props que nombra y el layout actualiza sólo lo que las lee, sin volver a montarse.

En una página, el tipo sigue al layout que eligen su `definePage` o sus `+group.ts`, así que una prop que el layout no declara es un error de tipos. Se autoimporta en las aplicaciones.

## Uso

```html
<!-- app/layouts/dashboard.meeko -->
<script lang="ts">
export interface Props { title?: string; showAlert?: boolean }
const props = defineProps<Props>({ showAlert: false });
</script>

<template>
  <header>{props.title}</header>
  <p if:when="props.showAlert" role="alert">Hay un problema con la conexión.</p>
  <main><MeekoOutlet /></main>
</template>
```

```html
<!-- app/pages/connections.meeko -->
<script server lang="ts">
export const route = definePage({ layout: "dashboard", layoutProps: { title: "Conexiones" } });
</script>

<script lang="ts">
const layout = useLayout();                 // LayoutHandle de "dashboard"
const failing = signal(false);
effect(() => layout.set({ showAlert: failing.value }));
</script>

<template>
  <p>Título actual: {layout.props.title}</p>
  <button type="button" on:click="() => failing.value = !failing.value">Probar conexión</button>
</template>
```

## Parámetros

| Parámetro | Tipo | Por defecto | Descripción |
| --- | --- | --- | --- |
| `L` | parámetro de tipo | el layout de la página | Nombre del layout. En una página lo pone Meeko; en un componente que no es la página, escríbelo: `useLayout<"dashboard">()`. |

## Valor devuelto

Un `LayoutHandle` congelado:

| Propiedad | Tipo | Descripción |
| --- | --- | --- |
| `name` | `string \| undefined` | Nombre del layout de la página, o `undefined` con `layout: false`. |
| `props` | `Readonly<Partial<LayoutProps<L>>>` | Las props que recibe ahora el layout, sin `outlet`: las de `layoutProps` y los `+group.ts` con lo que la página escribió encima. La lectura es reactiva. |
| `set(patch)` | `void` | Cambia las props que nombra `patch` y conserva las demás. Una prop que el layout no declara, o con otro tipo, es un error de tipos. Un valor que no es un objeto lanza `TypeError: useLayout().set() necesita un objeto con las props del layout`. |

Fuera de una página que renderiza Meeko lanza `Error: useLayout() necesita una página que renderiza Meeko: sólo funciona en las páginas, en sus componentes y en sus +layout.meeko…`. En una página con `layout: false` devuelve un acceso que no hace nada.

## Ejemplos

### Un título que depende de lo que hace el usuario

```html
<!-- app/pages/editor.meeko -->
<script server lang="ts">
export const route = definePage({ layout: "dashboard" });
</script>

<script lang="ts">
const layout = useLayout();
const draft = signal("");
effect(() => layout.set({ title: draft.value ? `Editando: ${draft.value}` : "Nuevo documento" }));
</script>

<template><input model="draft" placeholder="Título"></template>
```

### Desde un componente de la página

Un componente que no es la página no sabe qué layout la envuelve: nómbralo en el parámetro de tipo.

```html
<!-- app/components/ConnectionTest.meeko -->
<script lang="ts">
const layout = useLayout<"dashboard">();
async function test(): Promise<void> {
  const ok = await fetch("/api/ping").then((response) => response.ok, () => false);
  layout.set({ showAlert: !ok });
}
</script>

<template><button type="button" on:click="test">Probar</button></template>
```

### Las props por carpeta y por página

Lo estático va en las opciones de ruta, que llegan en el HTML del servidor desde el primer byte; `useLayout` sólo para lo que cambia en el navegador:

<!-- no-check -->
```ts
// app/pages/(dashboard)/+group.ts
export default defineGroup({ layout: "dashboard", layoutProps: { showAlert: false } });
```

<!-- no-check -->
```ts
// app/pages/(dashboard)/reports.route.ts
export const route = definePage({ layoutProps: { title: "Informes" } });
```

## Errores comunes

### Una prop que el layout no declara, o de otro tipo

```ts bad
const layout = useLayout(); // la página usa layout: "dashboard"
layout.set({ showAlert: "yes" });
layout.set({ subtitle: "x" });
```

`meeko check` da `TS2322: Type 'string' is not assignable to type 'boolean | undefined'` en la primera y `TS2353: Object literal may only specify known properties, and 'subtitle' does not exist in type 'Partial<{ title?: string; showAlert?: boolean | undefined; }> & {}'` en la segunda.

<!-- no-check -->
```ts good
layout.set({ showAlert: true });
```

### Usarlo con el layout `default` sin props

```ts bad
const layout = useLayout<"default">();
layout.set({ title: "x" });
```

Si `app/layouts/default.meeko` no declara props, `meeko check` da `TS2322: Type 'string' is not assignable to type 'never'`. Declara la prop en el layout (opcional o con valor por defecto) antes de escribirla.

```html good
<!-- app/layouts/default.meeko -->
<script lang="ts">
const props = defineProps<{ title?: string }>();
</script>
```

### Usar las props para markup

```ts bad
layout.set({ actionsHtml: "<button>Guardar</button>" });
```

Las props son datos: pasar HTML como texto obliga al layout a pintarlo con `html` y pierde los eventos y el ámbito de la página. Para poner contenido de la página en una zona del layout, usa [`<MeekoTeleport>`](/docs/reference/meekoteleport):

```html good
<MeekoTeleport to="#toolbar"><button type="button" on:click="save">Guardar</button></MeekoTeleport>
```

### Llamarlo en una prueba unitaria

```ts bad
renderToString({}); // la página llama a useLayout()
```

Lanza `Error: useLayout() necesita una página que renderiza Meeko… En una prueba unitaria, pasa los valores al componente como props.`

<!-- no-check -->
```ts good
renderToString({ title: "Informes" }); // el componente recibe el valor como prop
```

## Notas

- **SSR sin desajuste.** El layout se renderiza antes que la página. Lo que el setup de la página escribe con `set` durante el render llega al HTML con un segundo render de la página en el servidor, y el payload lleva esas props: el navegador hidrata exactamente ese HTML. Un render que escribe valores distintos cada vez se detiene en el tercero.
- **Navegador.** Lo que la página escribe mientras se renderiza y se hidrata se aplica al terminar de montarla; después, cada `set` se aplica al momento.
- **Nada queda pegado.** Al navegar a otra página, el layout recibe las props de la nueva (sus `layoutProps`, las de sus `+group.ts` y los valores por defecto), también si el layout se conserva. Una página que ya se fue no puede escribir.
- **Serialización.** Las props viajan en el payload: deben poder representarse en JSON. Un `undefined` deja la prop sin valor y el layout usa su valor por defecto.
- **Props opcionales.** Meeko renderiza el layout sin las props que una página no pasa, así que las de un layout con nombre deben ser opcionales o tener valor por defecto; `meeko check` lo comprueba (`MEEK_LAYOUT_PROPS`).
