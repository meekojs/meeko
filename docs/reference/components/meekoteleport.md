---
title: <MeekoTeleport>
group: components
since: 1.5.0
description: Pinta su contenido en otro lugar del documento (el final de body o un elemento con id) sin sacarlo del componente que lo declara.
symbols:
  - "syntax:meekoteleport"
types:
  - "@meekojs/meeko/framework#MeekoTeleportProps"
  - "@meekojs/meeko/framework#MeekoTeleportTarget"
related:
  - "syntax:meekooutlet"
  - "syntax:meekopopover"
  - "@meekojs/meeko/framework#useLayout"
  - "@meekojs/meeko#provide"
  - docs/framework.md#meekoteleport
---

A veces el markup de un componente debe aparecer en otro sitio de la página: los botones de una página en la barra de su layout, unas migas de pan en la cabecera, un aviso al final de `<body>`. `<MeekoTeleport to="…">` pinta su contenido en ese destino, pero el contenido **sigue perteneciendo al componente que lo declara**: lee sus señales, sus eventos llaman a sus funciones, recibe su `provide`/`inject` y sus manejadores de errores, y conserva el atributo de su `<style scoped>`. Se libera con el componente, sin dejar nodos en el destino.

El HTML del servidor ya trae el contenido en su destino y la hidratación no cambia el DOM. No se importa: el compilador reconoce la etiqueta.

## Uso

```html
<!-- app/layouts/default.meeko -->
<template>
  <header class="bar">
    <MeekoLink to="/">Inicio</MeekoLink>
    <div id="toolbar"></div>
  </header>
  <main><MeekoOutlet /></main>
</template>
```

```html
<!-- app/pages/notes/[id].meeko -->
<script lang="ts">
async function save(): Promise<void> { /* … */ }
</script>

<template>
  <MeekoTeleport to="#toolbar">
    <button type="button" on:click="save">Guardar</button>
  </MeekoTeleport>
  <article>…</article>
</template>
```

El botón aparece en la barra del layout, y al navegar a otra página desaparece de ella.

## Props

| Atributo | Tipo | Por defecto | Descripción |
| --- | --- | --- | --- |
| `to` | `"body"` o `"#id"` | obligatorio | `"body"` añade el contenido al final de `<body>`; `"#id"`, dentro del elemento con ese `id`, tras lo que ya tiene. El `id` es una letra y luego letras ASCII, dígitos, `-` o `_`; se busca con `getElementById`, nunca como selector CSS. |
| `bind:to` | `MeekoTeleportTarget` | | Destino calculado, `"body"` o una cadena que empieza por `#`; se valida al renderizar. |
| `disabled` o `bind:disabled` | `boolean` | `false` | Mientras es verdadero, el contenido se pinta en su sitio. Cambiarlo mueve los mismos nodos, que conservan su estado. |
| `if:when`, `each:of` | | | Funcionan como en cualquier etiqueta. |

Cualquier otro atributo es `MEEK114`.

## Resultado

El contenido, en el destino, entre marcadores de comentario (`<!--meeko:portal:…-->`); en su sitio queda sólo un marcador. Varios teleports al mismo destino conservan el orden en que aparecen en la página. En SSR, el contenido de `to="body"` va tras la aplicación y antes de los scripts de Meeko, y el de `to="#id"` dentro de ese elemento, se renderice éste antes o después que el teleport.

## Ejemplos

### Un aviso al final de `<body>`

```html
<script lang="ts">
const saved = signal(false);
</script>

<template>
  <button type="button" on:click="() => saved.value = true">Guardar</button>
  <MeekoTeleport to="body">
    <div if:when="saved.value" class="toast" role="status">Guardado.</div>
  </MeekoTeleport>
</template>
```

### En su sitio en pantallas pequeñas

```html
<script lang="ts">
const narrow = signal(false);
onMounted(() => {
  const query = window.matchMedia("(max-width: 40rem)");
  const update = (): void => { narrow.value = query.matches; };
  update();
  query.addEventListener("change", update);
  return () => query.removeEventListener("change", update);
});
</script>

<template>
  <MeekoTeleport to="#toolbar" bind:disabled="narrow.value">
    <AppButton on:click="save">Guardar</AppButton>
  </MeekoTeleport>
</template>
```

Al cambiar `narrow`, los mismos nodos pasan de la barra a su sitio, sin volver a renderizarse.

### Migas de pan desde cada página

```html
<!-- app/pages/docs/[slug].meeko -->
<template>
  <MeekoTeleport to="#breadcrumbs">
    <MeekoLink to="/docs">Documentación</MeekoLink> › <span>{page.title}</span>
  </MeekoTeleport>
  <article html="page.body"></article>
</template>
```

## Errores comunes

### Un selector CSS en `to`

```html bad
<MeekoTeleport to="header .bar"><p>Hola</p></MeekoTeleport>
```

`meeko check` da `MEEK114: to de <MeekoTeleport> admite "body" o "#id" (una letra y luego letras, dígitos, - o _), como to="#toolbar", no "header .bar"`. Da al destino un `id`:

```html good
<MeekoTeleport to="#toolbar"><p>Hola</p></MeekoTeleport>
```

### Un atributo que no admite

```html bad
<MeekoTeleport to="#toolbar" class="actions"><button>Guardar</button></MeekoTeleport>
```

`meeko check` da `MEEK114: <MeekoTeleport> admite to, bind:to, disabled, bind:disabled, if:when y each:of; class no se admite`. La etiqueta no pinta ningún elemento propio: pon la clase en el contenido.

```html good
<MeekoTeleport to="#toolbar"><div class="actions"><button>Guardar</button></div></MeekoTeleport>
```

### Un `bind:to` de tipo `string`

```html bad
<script lang="ts">
const target = signal("#toolbar");
</script>
<template><MeekoTeleport bind:to="target.value"><p>Hola</p></MeekoTeleport></template>
```

`meeko check` da `TS2322: Type 'string' is not assignable to type 'MeekoTeleportTarget'`. Declara la señal con el tipo del destino, que se importa de `@meekojs/meeko/framework`:

```html good
<script lang="ts">
import type { MeekoTeleportTarget } from "@meekojs/meeko/framework";
const target = signal<MeekoTeleportTarget>("#toolbar");
</script>
<template><MeekoTeleport bind:to="target.value"><p>Hola</p></MeekoTeleport></template>
```

### Un destino que no existe

```html bad
<!-- ningún layout ni componente pinta id="sidebar" -->
<MeekoTeleport to="#sidebar"><nav>…</nav></MeekoTeleport>
```

`meeko check` no lo detecta. En desarrollo el render falla con `Error: <MeekoTeleport to="#sidebar">: the page renders no element with id "sidebar"; render it in the page, a layout or app.meeko, or use to="body"`; en producción el contenido se pinta en su sitio y el servidor avisa una vez con el mismo texto en `console.warn`. El destino debe vivir al menos tanto como el teleport: un elemento del layout o de `app/app.meeko` para una página.

```html good
<!-- app/layouts/default.meeko pinta <aside id="sidebar"></aside> -->
<MeekoTeleport to="#sidebar"><nav>…</nav></MeekoTeleport>
```

## Notas

- **Modales y menús.** No hace falta teleport: `<dialog>` con `showModal()` y el atributo `popover` (o [`<MeekoPopover>`](/docs/reference/meekopopover)) ya van en la *top layer* del navegador, sin problemas de `z-index` ni de `overflow`.
- **Navegador.** Lo que el navegador renderiza después (una navegación, un `if:when` que aparece, una fila nueva) se pinta primero en su sitio y pasa al destino al terminar ese montaje, antes del siguiente pintado.
- **Foco.** Cambiar `disabled` mueve los nodos: el elemento que tenía el foco lo pierde, como en cualquier movimiento del DOM.
- **Seguridad.** `to` nunca se interpreta como HTML ni como selector: sólo `"body"` o un `id` con caracteres seguros.
- **Accesibilidad.** El orden del documento cambia: el contenido teletransportado se lee donde está en el DOM, no donde lo declaraste. Úsalo para lo que tiene sentido leer en el destino.
