---
title: <MeekoPopover>
group: components
since: 1.5.0
description: Popover accesible anclado a su disparador, sobre la API nativa popover y CSS anchor positioning, para menús, diálogos ligeros y tooltips.
symbols:
  - "syntax:meekopopover"
types:
  - "@meekojs/meeko/framework#MeekoPopoverProps"
  - "@meekojs/meeko/framework#PopoverSnippets"
  - "@meekojs/meeko/framework#PopoverTrigger"
  - "@meekojs/meeko/framework#PopoverExposed"
related:
  - "syntax:meekoselect"
  - "syntax:meekoteleport"
  - "@meekojs/meeko#useId"
  - "syntax:model"
  - docs/api.md#popover-meekopopover
  - docs/api.md#componentes-integrados
---

`<MeekoPopover>` pinta un `<button>` disparador y un contenido en la *top layer* del navegador (el atributo `popover`), colocado junto al disparador con *CSS anchor positioning*. Resuelve lo que cuesta hacer bien a mano: `aria-expanded`, `aria-controls` y `aria-haspopup`, `Esc` que cierra y devuelve el foco, el patrón de teclado de un menú, tooltips que no roban el foco, y la colocación que se da la vuelta si no cabe. Donde el navegador no tiene anchor positioning, un cálculo en JavaScript lo coloca y lo mantiene dentro de la ventana.

No tiene estilos visuales: expone su estado con atributos `data-*` y ARIA. No se importa; el compilador la reconoce e importa su módulo sólo en los componentes que la usan.

## Uso

```html
<!-- app/components/RowActions.meeko -->
<script lang="ts">
const emit = defineEmits<{ rename: []; remove: [] }>();
</script>

<template>
  <MeekoPopover placement="bottom-end" bind:offset="4" role="menu">
    <snippet name="trigger">Acciones ▾</snippet>
    <button role="menuitem" on:click="() => emit('rename')">Renombrar</button>
    <button role="menuitem" on:click="() => emit('remove')">Eliminar</button>
  </MeekoPopover>
</template>
```

Con `role="menu"`, las flechas mueven el foco entre los `menuitem`, las letras buscan uno, y elegirlo cierra el menú y devuelve el foco al disparador.

## Props

| Atributo | Tipo | Por defecto | Descripción |
| --- | --- | --- | --- |
| `mode` | `"auto" \| "manual" \| "hint"` | `"auto"` | `"auto"` se cierra al pulsar fuera y con `Esc`; `"manual"`, sólo desde el disparador, `Esc` o el modelo; `"hint"` es un tooltip que se abre con el puntero o el foco. |
| `placement` | `top`, `bottom`, `left` o `right`, con `-start` o `-end` | `"bottom-start"` | Lado del disparador y alineación con su borde. |
| `bind:offset` | `number` | `0` | Separación en píxeles con el disparador. |
| `role` | `"menu" \| "dialog" \| "tooltip"` | `"tooltip"` con `mode="hint"` | Patrón ARIA del contenido. |
| `label` | `string` | ninguno | `aria-label` del contenido; sin ella, un menú o un diálogo se nombran con el disparador. |
| `class`, `triggerClass` | `string` | ninguno | Clases del contenido y del `<button>` disparador. |
| `triggerId` | `string` | uno de `useId` | `id` del disparador; con un disparador propio, el `id` que lleva. |
| `matchWidth` | `boolean` | `false` | El contenido mide al menos lo que el disparador. |
| `bind:delay`, `bind:closeDelay` | `number` | `300`, `150` | Con `mode="hint"`, milisegundos antes de abrir y de cerrar con el puntero. |
| `model` | `Signal<boolean>` | ninguno | Señal de apertura: asignarla abre o cierra, y el usuario la cambia al abrir o cerrar. |
| `on:toggle` | `(event: { open: boolean }) => void` | ninguno | Se emite con cada apertura y cierre. |

Snippets: `trigger` (contenido del botón), el contenido suelto (`default`) y `anchor`, que sustituye el botón por un disparador propio y recibe sus atributos en un `PopoverTrigger`. Una `ref:` recibe `show()`, `hide()` y `toggle()`.

## Resultado

- Un `<button>` con `popovertarget`, `aria-expanded`, `aria-controls` y `aria-haspopup` (según `role`), cuyo contenido es el snippet `trigger`. Con `popovertarget`, el botón abre y cierra el contenido incluso antes de hidratar.
- El contenido, dentro de un elemento con `popover` y `data-meeko-popover`, oculto desde el HTML del servidor. Abierto lleva `data-open`; con el cálculo en JavaScript, `data-meeko-popover-fallback` y `data-side` con el lado elegido.

## Ejemplos

### Un tooltip

```html
<label for="code">Código</label>
<input id="code">
<MeekoPopover mode="hint"><snippet name="trigger">?</snippet>El código está en el reverso de la tarjeta.</MeekoPopover>
```

Se abre al pasar el puntero (tras `delay`) o al enfocar el `?`, se cierra con `Esc` o al perder el foco y nunca toma el foco. El disparador lleva `aria-describedby` con el contenido, que es `role="tooltip"`.

### Abrir desde el estado

```html
<script lang="ts">
const open = signal(false);
</script>

<template>
  <MeekoPopover model="open" role="dialog" label="Filtros" mode="manual" on:toggle="(event) => console.log(event.open)">
    <snippet name="trigger">Filtros</snippet>
    <form><label><input type="checkbox"> Sólo activos</label></form>
    <button type="button" on:click="() => open.value = false">Aplicar</button>
  </MeekoPopover>
</template>
```

Con `role="dialog"`, el foco entra en el primer control al abrirse.

### Un disparador propio

```html
<MeekoPopover role="menu">
  <snippet name="anchor" params="trigger">
    <button type="button" class="avatar" bind="trigger"><img src="/me.png" alt="Mi cuenta"></button>
  </snippet>
  <a role="menuitem" href="/perfil">Perfil</a>
  <a role="menuitem" href="/salir">Salir</a>
</MeekoPopover>
```

`bind="trigger"` pone en el botón el `id`, `popovertarget`, `aria-controls`, `aria-expanded` y `aria-haspopup`.

### Estilos

```css
[data-meeko-popover] { padding: 0.5rem; border: 1px solid #ddd; border-radius: 0.5rem; background: Canvas; }
[data-meeko-popover] [role="menuitem"]:focus-visible { outline: 2px solid Highlight; }
```

Las reglas de anclaje de Meeko están en la capa de cascada `meeko`, así que cualquier regla de la aplicación tiene prioridad.

## Errores comunes

### Un `placement` que no existe

```html bad
<MeekoPopover placement="bottom-left"><snippet name="trigger">Abrir</snippet>…</MeekoPopover>
```

`meeko check` da `TS2322: Type '"bottom-left"' is not assignable to type 'PopoverPlacement | undefined'`. Se escribe con `-start` o `-end`:

```html good
<MeekoPopover placement="bottom-start"><snippet name="trigger">Abrir</snippet>…</MeekoPopover>
```

### Un `role` o un `mode` que no admite

```html bad
<MeekoPopover role="listbox" mode="click"><snippet name="trigger">A</snippet>…</MeekoPopover>
```

`meeko check` da `TS2322: Type '"listbox"' is not assignable to type 'PopoverRole | undefined'` y `TS2322: Type '"click"' is not assignable to type 'PopoverMode | undefined'`. Para una lista de opciones, usa [`<MeekoSelect>`](/docs/reference/meekoselect).

```html good
<MeekoPopover role="menu" mode="auto"><snippet name="trigger">A</snippet>…</MeekoPopover>
```

### Un modelo que no es booleano

```html bad
<script lang="ts">
const open = signal("no");
</script>
<template><MeekoPopover model="open"><snippet name="trigger">Abrir</snippet>…</MeekoPopover></template>
```

`meeko check` da `TS2322: Type 'Signal<string>' is not assignable to type 'Signal<boolean>'`.

```html good
<script lang="ts">
const open = signal(false);
</script>
<template><MeekoPopover model="open"><snippet name="trigger">Abrir</snippet>…</MeekoPopover></template>
```

### Elementos de menú sin `role="menuitem"`

```html bad
<MeekoPopover role="menu"><snippet name="trigger">Acciones</snippet><button>Borrar</button></MeekoPopover>
```

No hay error, pero Meeko no cambia el rol del contenido: sin `role="menuitem"` las flechas no encuentran el elemento y los lectores de pantalla no anuncian un menú.

```html good
<MeekoPopover role="menu"><snippet name="trigger">Acciones</snippet><button role="menuitem">Borrar</button></MeekoPopover>
```

## Notas

- **SSR e hidratación.** El HTML trae el disparador y el contenido oculto por su atributo `popover`, sin parpadeo. Los IDs que enlazan disparador y contenido salen de `useId`: son los mismos al hidratar.
- **CSP.** Nada va en atributos `style`: el anclaje es una hoja construida (`adoptedStyleSheets`) y cada instancia pasa sus valores por CSSOM. Una CSP sin `'unsafe-inline'` basta.
- **Peso.** El módulo `@meekojs/meeko/builtins/popover` sólo se carga en los componentes que usan la etiqueta. No lo importes a mano: es un contrato entre el compilador y su runtime de la misma versión.
- **Teclado.** `Esc` cierra y devuelve el foco al disparador; pulsar fuera cierra un `mode="auto"` sin mover el foco. Con `role="menu"`: `Intro`, `Espacio` o `↓` abren con el foco en el primer `menuitem` (`↑`, en el último), las flechas lo mueven dando la vuelta, `Inicio` y `Fin` van a los extremos, `Tab` cierra y los elementos con `disabled` o `aria-disabled="true"` se saltan.
- **Nombre propio.** Un componente del proyecto llamado `MeekoPopover` tiene prioridad sobre la etiqueta, con el aviso `MEEK106`.
