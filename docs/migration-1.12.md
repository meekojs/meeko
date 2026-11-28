# Actualizar de 1.11 a 1.12

**Origen:** 1.11.x. **Destino:** 1.12.0. **Estado:** publicado en npm el 28 de noviembre de 2026 (etiqueta `v1.12.0`). **Quién actúa:** quien mantenga una aplicación que actualiza desde 1.11.x a 1.12.0.

`1.12` es un minor con dos cambios incompatibles aprobados como [excepciones](stability.md#excepciones-aprobadas): Meeko deja de publicar utilidades de PostCSS y de depender de Tailwind CSS, y el formateador de Prettier deja de ordenar clases con `meekoSortClasses: "tailwind"`. Se retiran sin periodo de obsolescencia porque Meeko deja de acoplarse a una solución de CSS: el proyecto elige la suya. A la vez, el editor deja de detectar Tailwind por su cuenta: un módulo o el proyecto declaran qué herramientas generan clases. Lo nuevo (`meeko styles`, `dev.portless` y el HMR tras un proxy HTTPS) es opcional. Además, `@meekojs/ui` 1.12 cambia el aspecto de sus componentes y la forma de cargar sus estilos (véase [Cambios de `@meekojs/ui`](#cambios-de-meekojsui)). Consulta también el [CHANGELOG](../packages/meeko/CHANGELOG.md) y la [política de estabilidad](stability.md).

## A quién afecta

| Si tu proyecto…                                                                                     | Qué haces                                                                                                |
| --------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------- |
| Importa `@meekojs/meeko/postcss`, usa `meekoUtilities()`, `defineUtilities` o la regla `@utilities` | [Retira las utilidades de PostCSS](#retirada-de-meekojsmeekopostcss-y-de-tailwindcss-del-framework).     |
| Instaló `tailwindcss` sólo porque Meeko lo admitía como dependencia par                             | Decláralo en tu `package.json` (mismo apartado).                                                         |
| Usa `meekoSortClasses: "tailwind"` o `meekoTailwindStylesheet`                                      | [Cambia el modo de ordenar clases](#retirada-de-meekosortclasses-tailwind-y-de-meekotailwindstylesheet). |
| Usa Tailwind sin `@meekojs/ui` y trabaja en VS Code                                                 | [Declara el proveedor de clases](#proveedores-de-clases-del-editor).                                     |
| Usa `@meekojs/ui`                                                                                   | Lee [Cambios de `@meekojs/ui`](#cambios-de-meekojsui).                                                   |
| Nada de lo anterior                                                                                 | Actualiza, ejecuta `meeko check` y mira [Novedades que no rompen nada](#novedades-que-no-rompen-nada).   |

## Orden recomendado

1. Busca los usos retirados: `grep -rn "meekojs/meeko/postcss\|@utilities\|meekoUtilities\|defineUtilities\|meekoTailwindStylesheet" .` y `meekoSortClasses` en tu configuración de Prettier.
2. Actualiza `@meekojs/meeko` a `1.12.0` y, si lo usas, `@meekojs/prettier-plugin` y `@meekojs/ui` a `1.12.0`. El código compilado y el runtime deben tener la misma versión: vuelve a compilar o construir.
3. Quita `meekoUtilities()` de `postcss.config.*` y las reglas `@utilities` de tus hojas, y sustitúyelas por CSS propio.
4. Si usabas Tailwind sin `@meekojs/ui`, declara `tailwindcss` y su integración (`@tailwindcss/vite` o `@tailwindcss/postcss`) en el `package.json` del proyecto.
5. Cambia `meekoSortClasses: "tailwind"` por `"stylesheet"` (o `"alphabetical"`) y borra `meekoTailwindStylesheet`.
6. Si usas Tailwind sin `@meekojs/ui`, añade `css.classProviders` a `meeko.config.ts`.
7. Ejecuta `meeko check` (que además escribe `.meeko/styles/main.css`) y `prettier --check .`. En CI, ejecuta `meeko styles` antes de Prettier si ordenas con `"stylesheet"`.

## Retirada de `@meekojs/meeko/postcss` y de `tailwindcss` del framework

**Qué cambió.** Se retiran sin periodo de obsolescencia:

- la entrada `@meekojs/meeko/postcss`, con `meekoUtilities()`, `defineUtilities` y sus tipos (`UtilityDeclarations`, `UtilityAtRuleDeclarations`…);
- la at-rule `@utilities "<ruta>" [layer(<nombre>)];`;
- la dependencia par opcional `tailwindcss` de `@meekojs/meeko`.

`@meekojs/meeko` ya no exporta la subruta `./postcss` y no declara `tailwindcss` en sus `peerDependencies`. Meeko sigue pasando `app/styles/main.css`, las hojas de los módulos y los `<style>` de los componentes por el pipeline de CSS de Vite, con el `postcss.config.*` de la raíz del proyecto y los plugins de Vite que registren el proyecto o un módulo. PostCSS sólo se usa dentro de Meeko para aplicar el ámbito de `<style scoped>`. La configuración de Tailwind vive ahora sólo en `@meekojs/ui`. Véase [El CSS lo elige el proyecto](framework-configuration.md#postcss-y-tailwind).

**A quién afecta.** A un proyecto que:

- importe `@meekojs/meeko/postcss` (típicamente en `postcss.config.*` o en módulos de utilidades): el import falla con `Package subpath './postcss' is not defined by "exports"`;
- escriba `@utilities` en una hoja: la regla deja de expandirse y las clases que generaba no existen;
- usara Tailwind sin `@meekojs/ui` apoyándose en que `@meekojs/meeko` lo admitía como dependencia par: ahora no hay nada que lo traiga.

No afecta a quien usa CSS plano, `@meekojs/ui` o Tailwind ya declarado en su propio `package.json`.

**Qué hacer.**

Antes:

```js
// postcss.config.mjs
import tailwindcss from '@tailwindcss/postcss'
import { meekoUtilities } from '@meekojs/meeko/postcss'

export default { plugins: [meekoUtilities(), tailwindcss()] }
```

```ts
// app/styles/utilities/surface.ts
import { defineUtilities } from '@meekojs/meeko/postcss'

export default defineUtilities(({ rule }) => [rule('.surface', { position: 'relative', padding: '4px' })])
```

```css
/* app/styles/main.css */
@import 'tailwindcss';
@utilities "./utilities/surface.ts";
```

Después, con CSS propio (lo que generaba el módulo):

```js
// postcss.config.mjs
import tailwindcss from '@tailwindcss/postcss'

export default { plugins: [tailwindcss()] }
```

```css
/* app/styles/main.css */
@import 'tailwindcss';

.surface {
	position: relative;
	padding: 4px;
}
```

Si necesitas seguir generando utilidades desde código, elige la herramienta que prefieras: `@utility` de Tailwind 4, un plugin de PostCSS propio o un script de build que escriba el CSS.

Si usabas Tailwind sin `@meekojs/ui`, declara Tailwind y su integración en el proyecto. Hay dos caminos; usa uno solo. Con el plugin de Vite, regístralo en un módulo (`addVitePlugin`); con PostCSS, en `postcss.config.*`, como arriba. El detalle y los dos ejemplos completos están en [El CSS lo elige el proyecto](framework-configuration.md#postcss-y-tailwind):

```sh
pnpm add -D tailwindcss @tailwindcss/vite
```

## Retirada de `meekoSortClasses: "tailwind"` y de `meekoTailwindStylesheet`

**Qué cambió.** El formateador de Prettier (`@meekojs/meeko/prettier` y `@meekojs/prettier-plugin`) elimina el modo `"tailwind"` de `meekoSortClasses` y la opción `meekoTailwindStylesheet`. Ya no carga `tailwindcss` ni `@tailwindcss/node`, y `tailwindcss` deja de ser dependencia par opcional de `@meekojs/prettier-plugin`. Prettier rechaza `meekoSortClasses: "tailwind"` con su error de opción inválida. Quedan tres modos: `"off"`, `"stylesheet"` y `"alphabetical"`, que no cambian.

**A quién afecta.** A quien tenga en `prettier.config.*`, `.prettierrc` o `--meeko-sort-classes` el valor `tailwind`, o `meekoTailwindStylesheet`. `meekoClassFunctions` conserva su comportamiento con los tres modos restantes.

**Qué hacer.**

Antes:

```ts
// prettier.config.ts
export default {
	plugins: ['@meekojs/meeko/prettier'],
	meekoSortClasses: 'tailwind',
	meekoTailwindStylesheet: './app/styles/main.css',
}
```

Después:

```ts
// prettier.config.ts
export default {
	plugins: ['@meekojs/meeko/prettier'],
	meekoSortClasses: 'stylesheet',
}
```

`"stylesheet"` ordena cada clase por su primera aparición en la hoja global. Desde `1.12`, el formateador lee `.meeko/styles/main.css` cuando existe y nombra alguna clase: es la hoja que `meeko dev` escribe con todo el pipeline de Vite y sus plugins, así que incluye las utilidades de Tailwind aunque se registre como plugin de Vite (`@tailwindcss/vite`, el caso de `@meekojs/ui`). Sólo se lee. Sin ella, procesa `app/styles/main.css` con el `postcss.config.*` del proyecto, como hasta ahora; si la hoja es anterior a `app/styles/main.css`, la usa igualmente y avisa una vez. Véase [Orden por la hoja global](editors.md#orden-por-la-hoja-global).

Dos casos:

- **Tailwind con `@tailwindcss/vite` y sin `.meeko/styles/main.css`.** La hoja que se procesa como alternativa no incluye las utilidades de Tailwind: ejecuta antes `meeko dev`, `meeko check` o `meeko styles`, o usa `"alphabetical"` u `"off"`.
- **CI y clones nuevos.** `.meeko/` está fuera de Git, así que `prettier --check` ordenaría distinto que en local. Ejecuta [`meeko styles`](reference/commands/meeko-styles.md) antes de Prettier:

```sh
meeko styles . && prettier --check .
```

## Proveedores de clases del editor

**Qué cambió.** El servidor de lenguaje ya no mira si el proyecto usa Tailwind: no lee `tailwindcss` en el `package.json` ni en los `@import` de las hojas. En su lugar, quien genera clases lo declara:

- un módulo, con `meeko.addClassProvider({ name, vscode?, languages? })` en su `setup`;
- el proyecto, en `css.classProviders` de `meeko.config.ts`.

Los tipos son `ClassProvider` (exportado por `@meekojs/meeko/framework`) y la opción `css.classProviders`. Con un proveedor activo en el editor (alguna de las extensiones de `vscode`), el servidor deja a esa extensión las clases que sólo están en `.meeko/styles/main.css`. `meeko dev` y `meeko check` guardan las declaraciones en `.meeko/manifests/class-providers.json`, que el editor lee en un workspace no confiable, donde no ejecuta el proyecto. Las hojas `.css` registran `css` y los `languages` declarados, en vez de `tailwindcss` siempre. Véase [Proveedores de clases](editors.md#proveedores-de-clases).

**A quién afecta.** A quien use Tailwind (u otra herramienta que genere clases) con una extensión de editor propia. Sin la declaración nada se rompe: Meeko ofrece también las clases generadas, junto a las de Tailwind CSS IntelliSense, y puede que veas las utilidades repetidas en el completado. `@meekojs/ui` ya declara Tailwind CSS, así que sus proyectos no hacen nada. Un servidor anterior a `1.12` no conoce la petición `meeko/classProviders`; la extensión de VS Code lo tolera y sigue enviando `tailwindActive`.

**Qué hacer.** Un proyecto con Tailwind sin `@meekojs/ui` añade la declaración a `meeko.config.ts`. Escribe el array como un literal: en un workspace no confiable el editor lo lee sin ejecutar la configuración.

```ts
// meeko.config.ts
import { defineMeekoConfig } from '@meekojs/meeko/framework'

export default defineMeekoConfig({
	css: { classProviders: [{ name: 'Tailwind CSS', vscode: ['bradlc.vscode-tailwindcss'], languages: ['tailwindcss'] }] },
})
```

Un módulo propio que registra Tailwind con `addVitePlugin` lo declara en su `setup`, donde ya conoce la herramienta:

```ts
meeko.addClassProvider({ name: 'Tailwind CSS', vscode: ['bradlc.vscode-tailwindcss'], languages: ['tailwindcss'] })
```

Meeko valida la declaración al cargar la configuración: un campo desconocido, un `name` vacío, ids que no son de la forma `editor.nombre` o `"meeko"` entre los `languages` detienen `meeko dev`, `meeko build` y `meeko check` con el mensaje de la ruta (véase [`css`](reference/config/config-css.md)). Para otros clientes LSP, la petición `meeko/classProviders` y el campo `activeExtensions` de `meeko.classes` están descritos en [Editores](editors.md#proveedores-de-clases).

## Cambios de `@meekojs/ui`

`@meekojs/ui` `1.12.0` cambia el aspecto de sus componentes y la forma de cargar sus estilos. Es un paquete con su propio CHANGELOG, que lista cada cambio con su migración; aquí va el resumen de lo que exige acción. Consulta [Meeko UI](ui.md) y el [CHANGELOG de UI](../packages/ui/CHANGELOG.md).

- **La aplicación compila los estilos de UI con su Tailwind.** El paquete ya no trae la hoja precompilada `dist/styles/main.css`: `app/styles/main.css` importa Tailwind y la entrada CSS de UI. `tailwindcss` es dependencia par de UI (`^4.3.5`); instálalo en la aplicación.

  ```css
  /* app/styles/main.css */
  @import 'tailwindcss';
  @import '@meekojs/ui';
  ```

  `@import 'tailwindcss'` trae el preflight de Tailwind, que quita márgenes, viñetas y el tamaño de los encabezados. Para conservar el aspecto anterior de una aplicación que no usaba Tailwind, importa sólo el tema y las utilidades (véase [Meeko UI](ui.md#empezar-en-una-aplicación)).

- **Las clases de la aplicación ganan a las de los componentes.** Las recetas fusionan `class`, cada slot de `ui` y `ui.defaults` con Tailwind Merge, y `@meekojs/ui/theme` exporta `mergeClasses`. El tema de UI se suma al de Tailwind y se retira `appearance-palette.css` con las clases `ui-<color>`.
- **`UIButton`, `UILink`, `UIIconButton` y `UICopyButton`.** `variant` es el tratamiento (`solid`, `soft`, `surface`, `outline`, `subtle`, `ghost`, `link`) y la prop nueva `color` es el color semántico. Desaparecen `tone`, `shape`, la prop `appearance` y los valores `primary` y `secondary` de `variant`:

  | Antes                 | Ahora                               |
  | --------------------- | ----------------------------------- |
  | `variant="primary"`   | `variant="solid" color="primary"`   |
  | `variant="secondary"` | `variant="surface" color="neutral"` |
  | `tone="danger"`       | `color="danger"`                    |
  | `shape="pill"`        | `radius="full"`                     |

- **`UICard` y `UILinkCard`.** Props nuevas `color`, `radius` y `elevation`; desaparecen `variant="elevated"` (usa `elevation="md"`) y la prop `appearance`. La card por defecto conserva su aspecto.
- **El resto de componentes** (`UIInput`, `UIBadge`, `UIAvatar`, `UIAlert`, `UIToast`, `UISparkline`, `UIMenu`…) sustituyen `tone`, `appearance` y `shape` por `variant`, `color`, `size` y `radius`; `UIInput` ya no pasa `size` al `<input>`. `useModal().confirm({ tone })` es `confirm({ color })`. El CHANGELOG de UI trae la tabla completa de reemplazos.
- **`UISelect` deja de ser un `<select>` nativo.** Es un botón `role="combobox"` que abre una lista propia sobre `UIPopover`. Las props, el modelo y el valor del formulario no cambian; sí cambian el marcado (los selectores `select`/`option`/`::picker(select)` y `selectOption()` en las pruebas dejan de funcionar), la lista, que se crea al abrir, y `listClass`, que va en la caja flotante. Sin JavaScript ya no se puede elegir una opción.
- **Anchos.** `UISelect` y `UICombobox` ocupan el ancho de su contenedor (`block w-full`); para un ancho fijo, usa una clase (`class="w-48"`).

## Novedades que no rompen nada

- **`meeko styles [directorio]`.** Escribe `.meeko/styles/main.css` sin arrancar `meeko dev`, con el mismo contenido y de forma atómica; sirve para ordenar clases en CI y para el editor tras clonar. `meeko check` también la escribe al terminar bien. Véase [`meeko styles`](reference/commands/meeko-styles.md).
- **`dev.portless`.** `dev: { portless: true }` (o `{ name: "ui.meeko" }`) publica `meeko dev` en `https://<nombre>.localhost` a través de [portless](https://portless.sh), sin envolver el script. `portless` no es dependencia de Meeko, y `PORTLESS=0` lo desactiva. Véase [URL con nombre con portless](reference/config/config-dev.md#url-con-nombre-con-portless).
- **HMR tras un proxy HTTPS.** El WebSocket de HMR de `meeko dev` declara ahora el protocolo `ws`, así que la recarga en caliente funciona cuando la página se sirve por un proxy HTTPS local (portless, Caddy o un túnel en el mismo equipo). No hay nada que configurar.
- **Mejoras de rendimiento de `meeko dev` y `meeko build`.** Los autoimports se descubren una vez en lugar de una por módulo, el router descarga el código de la página mientras pide sus datos, y las peticiones en vuelo se responden cuando Vite invalida el grafo del servidor. No cambian la API.

## Actualizar los paquetes

```sh
pnpm add @meekojs/meeko@^1.12.0
pnpm add -D @meekojs/prettier-plugin@^1.12.0
pnpm add @meekojs/ui@^1.12.0 tailwindcss
```

Instala sólo los paquetes que uses. Sigue la [política de estabilidad](stability.md) y los [seis paquetes públicos](releasing.md#publicar-los-paquetes-de-meeko), que se publican con la misma versión.
