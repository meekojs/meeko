---
title: meekoUtilities
group: advanced
since: 1.2.0
description: Plugin de PostCSS que sustituye cada @utilities "<ruta>" por las reglas CSS que genera una función de TypeScript, con HMR en meeko dev y los autoimports del proyecto.
symbols:
  - "@meekojs/meeko/postcss#meekoUtilities"
types:
  - "@meekojs/meeko/postcss#MeekoUtilitiesOptions"
related:
  - "@meekojs/meeko/postcss#defineUtilities"
  - "@meekojs/meeko/vite#meeko"
  - "config:css"
  - docs/framework.md#autoimports-y-typescript
  - docs/migration-1.3.md
---

`meekoUtilities()` es un plugin de PostCSS que genera CSS con TypeScript. Donde una hoja contiene `@utilities "./utilities/color.ts" layer(utilities);`, el plugin importa ese módulo, llama a la función que exporta por defecto (normalmente con `defineUtilities`) y sustituye la at-rule por las reglas que devuelve, opcionalmente dentro de `@layer`. Es el sustituto tipado de los bucles de un preprocesador (`@each`, `@for`): un `map` de TypeScript sobre una paleta o una escala.

Funciona en la hoja global (`app/styles/main.css`), en los archivos que importa y en el `<style>` de un `.meeko`. Con Vite 8, el módulo se empaqueta con rolldown en cada cambio, así que editarlo, o editar un módulo local que importa, regenera el CSS en `meeko dev` sin reiniciar. Desde `1.4`, en un proyecto Meeko el módulo recibe los autoimports de `app/` y `shared/`.

## Uso

```ts
// postcss.config.ts
import { meekoUtilities } from "@meekojs/meeko/postcss";

export default { plugins: [meekoUtilities()] };
```

```css
/* app/styles/main.css */
@utilities "./utilities/buttons.ts" layer(utilities);
```

```ts
// app/styles/utilities/buttons.ts
import { defineUtilities } from "@meekojs/meeko/postcss";

const sizes = { sm: "0.25rem 0.5rem", md: "0.5rem 1rem" };

export default defineUtilities(({ rule }) =>
  Object.entries(sizes).map(([size, padding]) => rule(`.button[data-size='${size}']`, { padding })));
```

Resultado:

```css
@layer utilities {
  .button[data-size='sm'] { padding: 0.25rem 0.5rem; }
  .button[data-size='md'] { padding: 0.5rem 1rem; }
}
```

## Opciones

| Opción | Tipo | Por defecto | Descripción |
| --- | --- | --- | --- |
| `root` | ruta | `process.cwd()` | Carpeta desde la que se resuelven las rutas de `@utilities` cuando la hoja no tiene archivo (CSS procesado sin la opción `from` de PostCSS). Con archivo, la ruta es siempre relativa a la hoja. |
| `autoImports` | `boolean` | `true` | Desde `1.4`. Aplica los autoimports de `app/` y `shared/` a los módulos de `@utilities` y a sus imports locales, ejecutando `meeko.config.*` una vez por hoja. `false` empaqueta los módulos como en `1.3`, sin ejecutar la configuración. |

La at-rule admite una ruta entre comillas a un `.ts`, `.mts`, `.js` o `.mjs`, relativa a la hoja que la contiene, y `layer(<nombre>)` opcional. No lleva bloque y debe ir después de los `@import`.

## Valor devuelto

Un plugin de PostCSS (`postcssPlugin: "meeko-utilities"`). Cada `@utilities` se sustituye por las reglas que devuelve la función: un nodo de `rule`, `atRule` o `css`, o un array de ellos (anidado a cualquier profundidad), donde `null`, `false` y `undefined` se omiten.

Los errores detienen la hoja con el archivo CSS y la línea del `@utilities`, que Vite muestra en su overlay:

```text
meeko-utilities: …/app/styles/main.css:1:13: "./bad.ts": la salida contiene ".x { color: red }", que no es un nodo de utilidades; envuelva el CSS literal con css`…`
```

## Ejemplos

### Una paleta con variables por color

```ts
// app/styles/utilities/color.ts
import { defineUtilities } from "@meekojs/meeko/postcss";

const colors = ["gray", "blue", "red"] as const;
const steps = Array.from({ length: 12 }, (_, index) => index + 1);

export default defineUtilities(({ rule, atRule }) => [
  colors.map((name) =>
    rule(`.color[data-color='${name}']`, Object.fromEntries(steps.map((step) => [`--color-${step}`, `var(--${name}-${step})`])))),
  rule(".color", { color: "var(--color-11)" },
    rule("&:hover", { backgroundColor: "var(--color-3)" }),
    atRule("media", "(prefers-contrast: more)", { color: "var(--color-12)" })),
]);
```

### Con Tailwind

<!-- no-check -->
```ts
// postcss.config.ts
import { meekoUtilities } from "@meekojs/meeko/postcss";
import tailwindcss from "@tailwindcss/postcss";

export default { plugins: [meekoUtilities(), tailwindcss()] };
```

`meekoUtilities()` va antes de `@tailwindcss/postcss` para que Tailwind vea las reglas generadas. `@utilities` no choca con `@utility` de Tailwind 4.

### Fuera de Vite

```sh
npx postcss app/styles/main.css -o dist/main.css
```

Con `postcss-cli`, si no encuentra rolldown, el plugin importa el módulo con la eliminación de tipos de Node (imports con extensión y TypeScript borrable), recarga sólo el módulo de entrada y lo avisa una vez.

## Errores comunes

### Devolver CSS como texto

```ts bad
// app/styles/utilities/bad.ts
export default () => [".x { color: red }"];
```

`"./bad.ts": la salida contiene ".x { color: red }", que no es un nodo de utilidades; envuelva el CSS literal con css`…``.

```ts good
// app/styles/utilities/good.ts
import { defineUtilities } from "@meekojs/meeko/postcss";

export default defineUtilities(({ css }) => css`.x { color: red; }`);
```

### Una ruta que no existe

```css bad
@utilities "./utilities/colours.ts";
```

`@utilities no encuentra "./utilities/colours.ts" (C:\proyectos\tienda\app\styles\utilities\colours.ts)`. La ruta es relativa a la hoja que contiene la at-rule, no al proyecto.

```css good
@utilities "./utilities/color.ts";
```

### `@utilities` antes de un `@import`

```css bad
@utilities "./utilities/color.ts" layer(utilities);
@import "./tokens.css";
```

Para CSS, `@utilities` es una regla más, y los `@import` deben ir antes de cualquier regla: Vite avisa (`@import statements must precede all other statements`) y no incluye ese `@import`.

```css good
@import "./tokens.css";
@utilities "./utilities/color.ts" layer(utilities);
```

## Notas

- **Sólo Node.** El plugin se ejecuta durante `meeko dev` y el build; `@meekojs/meeko/postcss` no forma parte del runtime del navegador ni del servidor.
- **Ámbito.** Las reglas generadas en un `<style scoped>` no reciben el atributo de ámbito: son globales, porque PostCSS las genera después de que Meeko aplique el ámbito.
- **Recarga.** Guarda estos módulos en `app/styles/`: en las carpetas que Meeko vigila por sus autoimports y rutas (`app/components`, `app/utils`, `shared/`…), un cambio recarga la página entera en lugar de actualizar sólo el CSS.
- **Autoimports.** Los módulos se ejecutan en Node al generar el CSS: reciben los exports de valores de `app/` y `shared/`, pero no los de `server/`, los componentes, los clientes generados ni las API del framework como `signal` o `useState`. Usar uno de ésos lanza un error que nombra el autoimport y su origen.
- **Tipos.** Las declaraciones de `rule()` y `atRule()` se tipan con csstype desde `1.3`: `backgroundColr` o `padding: 4` son errores de tipos.
