---
title: <MeekoOutlet>
group: components
since: 1.2.0
description: Pinta, en app/app.meeko y en los layouts, el layout o la página que van dentro, y el navegador conserva el layout entre rutas.
symbols:
  - "syntax:meekooutlet"
types:
  - "@meekojs/meeko/framework#MeekoOutletProps"
related:
  - "syntax:meekolink"
  - "syntax:component-tag"
  - "syntax:meekoteleport"
  - "@meekojs/meeko/framework#useLayout"
  - "@meekojs/meeko/framework#definePage"
  - docs/framework.md#meekooutlet--y-meekolink
  - docs/framework.md#routing-layouts-y-ssr
  - docs/framework.md#layouts-con-nombre
---

Una aplicación de Meeko es una cadena de envoltorios: `app/app.meeko` envuelve al layout con nombre, éste a los `+layout.meeko` de las carpetas y el último a la página. `<MeekoOutlet />` marca, en cada envoltorio, dónde va el siguiente. Lee la prop `outlet` que Meeko pasa a cada layout, así que el layout no necesita declararla.

Al navegar, el navegador conserva los layouts que comparten la página saliente y la nueva (su DOM, su foco, su estado, el scroll de una barra lateral) y sólo cambia lo que hay dentro del outlet. No se importa: el compilador reconoce la etiqueta.

## Uso

```html
<!-- app/layouts/default.meeko -->
<template>
  <header><MeekoLink to="/">Inicio</MeekoLink></header>
  <main><MeekoOutlet /></main>
  <footer>© Mi sitio</footer>
</template>
```

```html
<!-- app/app.meeko -->
<template>
  <div class="site-root"><MeekoOutlet /></div>
</template>
```

## Props

`<MeekoOutlet />` no tiene props ni contenido. Cualquier atributo, o contenido entre sus etiquetas, es el error `MEEK104`.

## Resultado

El HTML del layout o la página que van dentro, en ese lugar, entre los marcadores de comentario de un componente hijo. Equivale a `<component is="props.outlet">`: el layout no añade ningún elemento propio alrededor, así que el envoltorio (`<main>`, `<div>`) lo pones tú.

Desde `1.5`, un layout con `<MeekoOutlet />` declara sólo sus props (`defineProps<{ title?: string }>()`) y Meeko añade `outlet` a su `ComponentProps`. Hasta `1.4`, si declaraba sus props, `outlet` debía estar entre ellas.

## Ejemplos

### Un layout con nombre y sus props

```html
<!-- app/layouts/dashboard.meeko -->
<script lang="ts">
export interface Props { title?: string; showAlert?: boolean }
const props = defineProps<Props>({ showAlert: false });
</script>

<template>
  <aside><DashboardNav /></aside>
  <section>
    <h1>{props.title}</h1>
    <p if:when="props.showAlert" role="alert">Hay un aviso pendiente.</p>
    <MeekoOutlet />
  </section>
</template>
```

Las páginas lo eligen con `definePage({ layout: "dashboard" })` y le pasan props con `layoutProps` o [`useLayout`](/docs/reference/uselayout).

### Una zona del layout que la página llena

Las props son para datos. Para poner markup de la página en otra zona del layout, deja un destino y usa [`<MeekoTeleport>`](/docs/reference/meekoteleport):

```html
<!-- app/layouts/default.meeko -->
<template>
  <header class="bar"><div id="toolbar"></div></header>
  <main><MeekoOutlet /></main>
</template>
```

### Layouts anidados

Un `+layout.meeko` junto a las páginas se anida dentro del layout con nombre, y su `<MeekoOutlet />` pinta la página:

```text
app/app.meeko                          → <MeekoOutlet /> pinta el layout con nombre
└─ app/layouts/dashboard.meeko         → <MeekoOutlet /> pinta +layout.meeko
   └─ app/pages/(dashboard)/+layout.meeko  → <MeekoOutlet /> pinta la página
      └─ app/pages/(dashboard)/reports.meeko
```

## Errores comunes

### Usarlo en un componente

```html bad
<!-- app/components/Card.meeko -->
<template><div class="card"><MeekoOutlet /></div></template>
```

`meeko check` da `MEEK104: <MeekoOutlet /> sólo se usa en app/app.meeko y en los layouts (app/layouts/*.meeko o +layout.meeko): pinta el layout o la página que van dentro`. Para que un componente reciba contenido, declara un snippet:

```html good
<!-- app/components/Card.meeko -->
<script lang="ts">
const snippets = defineSnippets<{ default: [] }>();
</script>
<template><div class="card"><render snippet="snippets.default" /></div></template>
```

### Darle atributos o contenido

```html bad
<MeekoOutlet class="page" />
```

`meeko check` da `MEEK104: <MeekoOutlet /> no admite atributos ni contenido: escríbelo como <MeekoOutlet />`. El outlet no pinta ningún elemento al que aplicar la clase: envuélvelo.

```html good
<main class="page"><MeekoOutlet /></main>
```

### Un componente propio llamado `MeekoOutlet`

```html bad
<!-- app/components/MeekoOutlet.meeko existe en el proyecto -->
<main><MeekoOutlet /></main>
```

Para no romper proyectos anteriores a `1.2`, el componente del proyecto tiene prioridad sobre la etiqueta, y `meeko check`, `meeko build` y el editor avisan con `MEEK106: <MeekoOutlet> es el componente MeekoOutlet del proyecto, no la etiqueta propia de Meeko (la página o el layout de dentro); renombra el componente para usar la de Meeko`.

```html good
<!-- app/components/AppOutletFrame.meeko -->
<main><MeekoOutlet /></main>
```

## Notas

- **Navegación.** El navegador conserva los layouts comunes a la página saliente y la nueva, y libera la página saliente antes de montar la nueva. Si cambia el layout con nombre, el anterior se libera y se monta el nuevo.
- **SSR e hidratación.** El servidor renderiza la cadena completa en un solo HTML, cada nivel con su estado, y la hidratación lo reclama sin cambiar el DOM.
- **Página de error.** Una página que falla en el navegador muestra su `+error.meeko` o `app/error.meeko` dentro de sus propios layouts, a través del mismo outlet.
- **Accesibilidad.** Pon el outlet dentro de un `<main>` del layout, una sola vez por página, para que los lectores de pantalla encuentren el contenido principal.
- **Contratos.** `meeko check` comprueba que `app/app.meeko` y los layouts acepten el `outlet` que pasa Meeko y que las props de un layout con nombre sean opcionales o tengan valor por defecto.
