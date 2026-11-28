# Cambios de Prettier para Meeko

## Sin publicar

- El formateador se genera en el build a partir del de `@meekojs/meeko` (`packages/meeko/src/formatters/prettier`), que pasa a ser su única fuente: los dos dan siempre el mismo resultado. Sin cambios de salida ni de API; cambian los nombres de los módulos internos de `dist/`.
- `meekoSortClasses: "stylesheet"` ordena por `.meeko/styles/main.css` (la hoja que `meeko dev` escribe con todo el pipeline de Vite y sus plugins) cuando existe y nombra alguna clase, y recurre a procesar `app/styles/main.css` si no. Una hoja anterior a `app/styles/main.css` se usa igualmente y avisa una vez; la caché se invalida cuando la hoja cambia. Mismo comportamiento que el formateador de `@meekojs/meeko`.
- **Rompe compatibilidad: se retiran `meekoSortClasses: "tailwind"` y la opción `meekoTailwindStylesheet`.** `tailwindcss` deja de ser dependencia par opcional y Prettier rechaza `"tailwind"` como valor inválido. **Migración:** cambia a `meekoSortClasses: "stylesheet"` (orden de la hoja `app/styles/main.css` ya procesada) y elimina `meekoTailwindStylesheet`. `meekoClassFunctions` conserva su comportamiento con los tres modos restantes.

## 1.11.0 — 2026-11-25

- Publicación coordinada con `@meekojs/ui` 1.11.0, sin cambios funcionales en este paquete.

## 1.10.2 — 2026-11-24

- Publicación coordinada con `@meekojs/ui` y `@meekojs/icon` 1.10.2, sin cambios funcionales en este paquete.

## 1.10.1 — 2026-11-23

- Publicación coordinada con `@meekojs/meeko` 1.10.1, sin cambios funcionales en este paquete.

## 1.10.0 — 2026-11-23

- **Una línea en blanco entre las secciones de un `.meeko`.** `<script>`, `<template>` y `<style>` quedan siempre separados por una línea en blanco; un comentario sigue pegado a la sección que explica, también `prettier-ignore`.
- **Un comentario en su propia línea queda pegado al elemento que sigue** en la plantilla: se quitan las líneas en blanco entre ambos.
- **`if` y `else-if` se formatean como expresiones**, como ya lo hacían `if:when` y `each:of`.
- **`htmlWhitespaceSensitivity: "ignore"` explícito deja los espacios al printer HTML**, también en los bordes de las etiquetas y los snippets. `css` y `strict` siguen sin añadir ni quitar nodos de texto.
- Un elemento con sólo texto conserva `>texto</Tag>` junto aunque sus atributos ocupen varias líneas.

## 1.9.0 — 2026-11-05

- Publicación coordinada con `@meekojs/meeko` 1.9.0, sin cambios funcionales en este paquete.

## 1.8.0 — 2026-11-04

- **Corrección: con cualquier `htmlWhitespaceSensitivity`, también la de por defecto, formatear ya no cambia lo que se renderiza.** El compilador conserva los espacios de la plantilla como nodos de texto, y el formato los añadía: partir `<li each:of="a" each:as="b">{b}</li>` en varias líneas o separar `<button>a</button><button>b</button>` creaba nodos que el código fuente no tenía, también en los bordes de `<template>`. Y también los quitaba: `Hi<b> you</b>` se pintaba `Hiyou`. Ahora ningún espacio aparece ni desaparece en el límite entre dos nodos, sean del tipo que sean; un espacio sí puede pasar a ser un salto de línea con su sangría, que se pinta igual salvo con `white-space: pre`. **La salida cambia** en lo que no tenía espacios: los saltos de línea quedan dentro de las etiquetas (`>{b}</li\n>`), como con `strict`. Un archivo ya formateado conserva sus espacios y casi siempre queda igual. Añadir un salto de línea tras `>` y antes de `</` pide la forma con el contenido en su propia línea, y añade esos nodos. **Con la sensibilidad por defecto (`css`) esto se nota más**: un `<p>texto largo</p>` sin formatear, que antes pasaba a tener el texto en sus propias líneas, conserva ahora el texto pegado a las etiquetas (`<p\n>texto largo</p\n>`).
- **Corrección: un espacio junto a una etiqueta `<snippet>` ya no se pierde, y una segunda pasada ya no cambia nada.** Para el compilador, `<snippet name="a"> <b>x</b> </snippet>` tiene contenido en esos bordes, y con un salto de línea no lo tendría. Con el snippet pegado a un texto o a una interpolación y una línea que no cabía, ese espacio pasaba a ser un salto: `left right` se pintaba `leftright`. Ahora lo que no cabe se parte dentro de las etiquetas (`name="a"

> <b`). **La salida cambia:** un snippet con un espacio en el borde se formatea como cualquier otro elemento, en vez de conservarse tal como está escrito.

- **Corrección: formatear ya no pierde contenido de `<pre>`, `<listing>` ni `<textarea>`.** Un contenido de sólo espacios se reducía a uno o desaparecía, y un `&#10;` inicial, que el parser HTML ignora, pasaba a ser un salto de línea real. Estos dos casos se imprimen ahora tal como están escritos. Un elemento de estos con hijos que no son texto ya no recibe un segundo `>` de su vecino.
- **Corrección: un `}}` del código ya no pierde una llave.** Una palabra, una línea o un valor `}}` se confundía con el cierre de una interpolación y salía como `}`, en un texto, un comentario, un atributo o un bloque con `<!-- prettier-ignore -->`.
- **Corrección: el formato ya no añade un espacio visible con `htmlWhitespaceSensitivity: "ignore"`.** El compilador conserva el texto de la plantilla tal como está escrito, así que `<code>x</code>.` partido en dos líneas se pintaba `x .`. Donde el código no tiene espacio entre un texto y un elemento, entre dos elementos de texto (`code`, `a`, `strong`…) o en el borde interior de uno de ellos, el plugin ya no lo añade.
- **Paridad con el editor.** Desde Meeko `1.8`, el plugin del núcleo, que usa el servidor de lenguaje, da el mismo resultado que este paquete, también en el `class` de un componente, en `bind:class` y en `meekoClassFunctions`. Una prueba de paridad lo comprueba.

- Añade `meekoClassFunctions` (`[]` por defecto), que ordena con `meekoSortClasses` las cadenas de los argumentos de funciones como `tv()`, `clsx()` o `cn()`, a cualquier profundidad, en el script de un `.meeko` y en los archivos `.ts`, `.tsx` y `.js`. Nunca toca las claves de un objeto.
- **Cambio de salida con `meekoSortClasses` distinto de `"off"`:** también se ordenan y normalizan las cadenas de `bind:class` y el `class` de una etiqueta de componente. Sin cambios con `"off"`, el valor por defecto.
- Conserva los elementos HTML sin contenido tal como están escritos, `<div />` o `<div></div>`, que Meeko `1.8` admite en la plantilla; los atributos se siguen formateando (uno por línea con `singleAttributePerLine`, y `/>` en la línea del `>`), y los elementos vacíos se siguen escribiendo `<input />`. No añade una opción para convertir una forma en la otra: esa decisión es de la regla `meeko/html-self-closing` de `@meekojs/eslint-plugin`, cuyo autofix converge con el formato del plugin.
