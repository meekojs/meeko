---
title: "{expresión}"
group: syntax
since: 1.0.0
description: Inserta en la plantilla el valor de una expresión TypeScript como texto escapado, que se actualiza cuando cambian las señales que lee.
symbols:
  - "syntax:interpolation"
related:
  - "syntax:html"
  - "syntax:bind"
  - "syntax:if-when"
  - "@meekojs/meeko#signal"
  - "@meekojs/meeko#computed"
  - docs/api.md#componentes-meeko
  - docs/api.md#condiciones-con-ifwhen-y-tipos
---

`{expresión}` escribe en el contenido de un elemento el valor de una expresión TypeScript, siempre **escapado**: `<`, `>`, `&` y las comillas llegan como texto, nunca como HTML. La expresión ve todo lo que declara el nivel superior del `<script>` (señales, `props`, funciones, imports) y los datos que exporta el `<script server>` de una página.

Cada interpolación es un enlace reactivo propio: cuando cambia una señal que lee, Meeko actualiza sólo ese nodo de texto, sin volver a renderizar el componente.

## Uso

```html
<!-- app/components/Inbox.meeko -->
<script lang="ts">
const props = defineProps<{ name: string }>();
const unread = signal(3);
</script>

<template>
  <p>{props.name} tiene {unread.value} mensajes sin leer</p>
</template>
```

En SSR, con `name: "Ana"`, el párrafo dice «Ana tiene 3 mensajes sin leer»; cada valor va entre dos comentarios `<!--meeko:text:N-->` que la hidratación usa para encontrar su nodo. Al cambiar `unread.value`, sólo cambia el número.

## Atributos

| Sintaxis | Tipo | Por defecto | Descripción |
| --- | --- | --- | --- |
| `{expresión}` | cualquier expresión TypeScript | obligatorio | Se evalúa en el ámbito del `<script>` (y de los datos de `<script server>`), y su resultado se escribe como texto. Sólo en el contenido de un elemento, no en los atributos. |

Qué admite la expresión:

- Cualquier expresión TypeScript: llamadas, ternarios, operadores, plantillas literales (`` {`${count.value} €`} ``), `as` y `!`.
- Llaves propias de JavaScript: un objeto literal (`{ { total: count.value }.total }`), una plantilla con `${…}`, cadenas con `{` o `}`, comentarios y expresiones regulares. La interpolación termina en la llave que equilibra la de apertura.
- No admite sentencias (`if`, `const`, `;`): calcula el valor en el script o con un `computed`.

## Resultado

Un nodo de texto con `String(valor)`, entre dos comentarios de marca: escapado en el HTML del servidor y asignado con `textContent` en el navegador.

| Valor | Texto |
| --- | --- |
| `string`, `number`, `boolean` | Su conversión a texto: `"Ana"`, `3`, `true`. |
| `null`, `undefined` | Su conversión a texto: `null`, `undefined`. Usa `?? ""` para no pintar nada. |
| Un objeto o una señal | `[object Object]`: lee `.value` o la propiedad que quieres. |
| HTML (`"<b>hola</b>"`) | El texto literal `<b>hola</b>`, escapado. Para insertar HTML usa la directiva `html`. |

## Ejemplos

### Valores derivados con `computed`

Para un cálculo que se repite o que lee varias señales, un `computed` evita repetir la expresión y sólo se recalcula cuando cambian sus dependencias:

```html
<script lang="ts">
const items = signal([{ name: "Té", price: 3.5, qty: 2 }]);
const total = computed(() => items.value.reduce((sum, item) => sum + item.price * item.qty, 0));
const money = new Intl.NumberFormat("es-ES", { style: "currency", currency: "EUR" });
</script>

<template>
  <p>Total: {money.format(total.value)}</p>
  <p>{items.value.length === 1 ? "1 artículo" : `${items.value.length} artículos`}</p>
</template>
```

### Valores opcionales

Con `strict`, TypeScript exige comprobar `null` antes de leer una propiedad. `?.` y `??` lo resuelven en la propia expresión, y `if:when` estrecha el tipo de todo un bloque:

```html
<script lang="ts">
const user = signal<{ name: string; city?: string } | null>(null);
</script>

<template>
  <p>Hola, {user.value?.name ?? "invitado"}</p>
  <p if:when="user.value">{user.value.name} vive en {user.value.city ?? "algún sitio"}</p>
</template>
```

### Datos del servidor de una página

Un `export const` del `<script server>` llega a la plantilla con su nombre y su tipo:

```html
<!-- app/pages/users/[id].meeko -->
<script server lang="ts">
const { params } = usePage();
export const profile = { id: params.id, name: `Usuario ${params.id}` };
</script>

<template><h1>{profile.name}</h1></template>
```

### Texto de usuarios, sin riesgo

El texto siempre se escapa, así que un comentario con HTML se muestra tal cual y no se ejecuta:

```html
<script lang="ts">
const props = defineProps<{ comment: string }>(); // "<img src=x onerror=alert(1)>"
</script>

<template><blockquote>{props.comment}</blockquote></template>
```

## Errores comunes

### Una llave sin cerrar

```html bad
<p>Hola {user.value.name</p>
```

El compilador da `MEEK010: Expresión de plantilla sin cerrar`, en la llave de apertura. Para escribir una llave literal en el texto, interpólala como cadena.

```html good
<p>Hola {user.value.name}</p>
<p>Las llaves se escriben {"{"} y {"}"}</p>
```

### Una interpolación vacía

```html bad
<p>Hola {}</p>
```

`MEEK009: Expresión de plantilla vacía`.

```html good
<p>Hola {name.value}</p>
```

### Interpolar la señal en lugar de su valor

`{count}` no es un error de tipos: la plantilla admite cualquier valor, pero pinta `[object Object]` y no se actualiza.

```html bad
<button on:click="increment">{count}</button>
```

```html good
<button on:click="increment">{count.value}</button>
```

### Leer una propiedad de un valor que puede ser `null`

```html bad
<p>{user.value.name}</p>
```

`meeko check` da `TS18047: 'user.value' is possibly 'null'.`

```html good
<p if:when="user.value">{user.value.name}</p>
```

### Llaves en un atributo

Las llaves sólo interpolan en el contenido. En un atributo son texto literal: `title="{name}"` escribe `{name}`.

```html bad
<a title="{user.value.name}">Perfil</a>
```

```html good
<a bind:title="user.value.name">Perfil</a>
```

## Notas

- **SSR e hidratación.** El servidor escribe el texto escapado y el navegador reclama ese nodo al hidratar: la expresión se evalúa en los dos lados con los mismos datos. Un valor distinto en cada lado (`Date.now()`, `Math.random()`, la zona horaria del navegador) produce un error de hidratación; calcúlalo en el servidor y pásalo como dato, o píntalo en `onMounted`.
- **Reactividad.** Cada `{…}` se suscribe a las señales que lee y se actualiza en su sitio. Leer `props.x` en la plantilla sigue a la prop cuando el padre la cambia.
- **Seguridad.** El escape hace segura cualquier cadena, también la de un usuario. Para HTML de confianza usa la directiva `html` con `trustHtml`.
- **Rendimiento.** La expresión se vuelve a evaluar en cada cambio de sus señales: para cálculos caros o repetidos, usa un `computed`.
- **Tipos.** `meeko check` y el editor comprueban cada expresión con las opciones estrictas del proyecto (`strict`, `noUncheckedIndexedAccess`) y ubican el error en la propia expresión.
