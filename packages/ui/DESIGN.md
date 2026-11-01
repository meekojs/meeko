# Contrato visual de Meeko

`packages/ui` es la única fuente de diseño. `apps/meeko`, `apps/ui`, `apps/i18n`, `apps/dashboard` y `packages/docs` usan estos tokens: mismos colores, tamaños y fuentes. Una app sólo puede diferir en imágenes y efectos. Si falta algo, se añade aquí, nunca en la app.

**La dirección:** neutros limpios, bordes finos, un violeta eléctrico usado con moderación y tipografía compacta y precisa.

## Reglas

1. Lee `var(--ui-*)`. Ningún hex, tamaño, duración o peso suelto fuera de `src/app/styles/tokens.css` y `palette.css`. `tests/tokens.test.mjs` lo comprueba en las hojas y los componentes de UI. La única excepción es el ancho de un `@media`, porque CSS no admite variables ahí.
2. Usa el token de uso, no el paso: `--ui-color-border`, no `--ui-color-surface-6`. Lee un paso sólo para algo que ningún token de uso cubra, como una ilustración.
3. Tema con `data-theme` en `<html>`, nunca `.dark`. Los tokens ya cambian solos: no escribas reglas por tema.
4. El violeta es para la acción principal, el foco, la selección y lo que está activo. Si todo es violeta, nada destaca.
5. Plataforma antes que JavaScript. Los navegadores antiguos funcionan, sin animación.

## Color

Pasos de cada escala: 1-2 fondos, 3-5 controles, 6-8 bordes, 9-10 sólidos, 11-12 texto.

| Para                              | Token                                                                   | Paso                  |
| --------------------------------- | ----------------------------------------------------------------------- | --------------------- |
| Fondo de la página                | `--ui-color-bg`                                                         | surface 1             |
| Banda o zona discreta             | `--ui-color-bg-subtle`                                                  | surface 2             |
| Card, panel, tabla                | `--ui-color-surface`                                                    | surface 2             |
| Popover, modal, card elevada      | `--ui-color-surface-raised`                                             | 1 claro, 3 oscuro     |
| Fondo de control                  | `--ui-color-control`, `-hover`, `-active`                               | surface 3, 4, 5       |
| Separador, borde de card          | `--ui-color-border`                                                     | surface 6             |
| Borde de control de formulario    | `--ui-color-control-border`, con 3:1 o más                              | surface 9, 10 oscuro  |
| Borde discreto de un panel        | `--ui-color-border-strong`                                              | surface 8             |
| Borde de un control de formulario | `--ui-color-control-border` (3:1 o más)                                 | surface 9, 10 oscuro  |
| Texto                             | `--ui-color-text`                                                       | surface 12            |
| Texto suave y placeholder         | `--ui-color-text-soft`                                                  | surface 11            |
| Acción principal                  | `--ui-color-primary`, `-hover`, `-active`                               | primary 9, 10, mezcla |
| Texto sobre la acción             | `--ui-color-primary-contrast`, `-contrast-hover`                        | blanco                |
| Etiqueta o fondo activo discreto  | `--ui-color-primary-soft`, `-soft-hover`, con `--ui-color-primary-text` | primary 3, 4, 11      |
| Borde violeta                     | `--ui-color-primary-border`                                             | primary 7             |
| Foco                              | `--ui-focus-ring`, con `outline-offset: var(--ui-focus-ring-offset)`    | primary 9             |
| Selección de texto                | `--ui-color-selection`                                                  | primary 5             |
| Fondo de un modal abierto         | `--ui-color-overlay`                                                    | negro al 50 %         |

**Estados:** `info`, `success`, `warning` y `danger` tienen la misma forma. Ejemplo con `danger`: `--ui-color-danger` (sólido, borde de un campo inválido), `-hover`, `-soft` (fondo), `-border` y `-text` (texto de error).

**Texto sobre un sólido:** usa siempre `--ui-color-<escala>-contrast`, con cualquier escala, incluidas `surface`, `cyan`, `orange` y `pink`. Elige blanco o negro con 4,5:1 o más en cada tema. Sobre el paso 10, usa `--ui-color-<escala>-contrast-hover`: en claro, `info`, `success`, `warning` y `cyan` pasan de negro a blanco, porque el paso 10 es más oscuro que el 9.

```css
.alert-action {
	background: var(--ui-color-danger);
	color: var(--ui-color-danger-contrast);
}
.alert-action:hover {
	background: var(--ui-color-danger-hover);
	color: var(--ui-color-danger-contrast-hover);
}
```

## Tipografía

`--ui-font-sans` es Inter Variable y `--ui-font-mono`, la mono del sistema. La mono es para código y datos, no un adorno «técnico».

| Tamaño                               | rem        | Para                                | Interlineado | Tracking  |
| ------------------------------------ | ---------- | ----------------------------------- | ------------ | --------- |
| `--ui-font-size-xs`                  | 0,75       | Badge, metadatos                    | `snug`       | `normal`  |
| `--ui-font-size-sm`                  | 0,8125     | Etiqueta, ayuda, error, descripción | `normal`     | `normal`  |
| `--ui-font-size-md`                  | 0,875      | Control, tabla, texto de interfaz   | `snug`       | `snug`    |
| `--ui-font-size-lg`                  | 1          | Lectura (`body`)                    | `normal`     | `normal`  |
| `--ui-font-size-xl`                  | 1,125      | Título de card y de modal           | `snug`       | `tight`   |
| `--ui-font-size-2xl`                 | 1,375      | Título de sección                   | `snug`       | `tight`   |
| `--ui-font-size-3xl`                 | 1,75       | Título de página                    | `tight`      | `tight`   |
| `--ui-font-size-4xl`, `-5xl`, `-6xl` | 2,25, 3, 4 | Portadas                            | `tight`      | `display` |

- **Interlineado** (`--ui-line-height-*`): `none` 1, `tight` 1,2, `snug` 1,35, `normal` 1,5, `relaxed` 1,65.
- **Peso** (`--ui-font-weight-*`): `regular` 400, `medium` 500 en etiquetas y controles, `semibold` 600 en títulos y `bold` 700 sólo en portadas.
- **Tracking** (`--ui-tracking-*`): `normal` 0, `snug` -0,006em, `tight` -0,014em, `display` -0,025em.

## Espacio y forma

- **Espacio:** `--ui-space-<n>`, en pasos de 0,25rem: `0`, `0-5`, `1`, `1-5`, `2`, `3`, `4`, `5`, `6`, `8`, `10`, `12`, `16`, `20`, `24`. Junta lo relacionado (`1-5`, `2`) y separa los grupos (`5` en adelante).
- **Radios:** `--ui-radius-xs` 3px, `-sm` 4px (opción de una lista), `-md` 6px (controles), `-lg` 8px (cards, popovers), `-xl` 12px (modales), `-full` (badges, `pill`).
- **Bordes:** `--ui-border-width` (1px). No uses bordes de color gruesos en un lateral.
- **Sombras:** `--ui-shadow-sm`, `-md` (popover, card elevada), `-lg` (modal). En oscuro un panel se eleva con `--ui-color-surface-raised`; la sombra sólo separa lo que se solapa.
- **Contenedor:** `--ui-container-sm` 40rem, `-md` 48rem, `-lg` 64rem, `-xl` 80rem, `-2xl` 96rem, `-3xl` 120rem, `-4k` 240rem. Márgenes: `--ui-container-gutter-sm`, `-md`, `-lg`. Mejor `<UIContainer>` que leerlos a mano.

## Controles

| Tamaño | Alto                          | Alto táctil | Padding                   | Texto                       |
| ------ | ----------------------------- | ----------- | ------------------------- | --------------------------- |
| `sm`   | `--ui-control-height-sm` 28px | 36px        | `--ui-control-padding-sm` | `--ui-control-font-size-sm` |
| `md`   | `--ui-control-height-md` 32px | 40px        | `--ui-control-padding-md` | `--ui-control-font-size`    |
| `lg`   | `--ui-control-height-lg` 40px | 44px        | `--ui-control-padding-lg` | `--ui-control-font-size-lg` |

Con `pointer: coarse` los altos crecen solos, y los inputs usan `--ui-input-font-size` a 16px para que iOS no amplíe la página al enfocarlos.

## Estados

| Estado        | Cómo                                                                                                    |
| ------------- | ------------------------------------------------------------------------------------------------------- |
| Hover         | Fondo un paso más: `-hover`. Con `--ui-duration-fast`.                                                  |
| Pulsado       | `-active`.                                                                                              |
| Foco          | Siempre `:focus-visible` con `--ui-focus-ring`. No lo quites sin dar otro igual de claro.               |
| Deshabilitado | `opacity: var(--ui-opacity-disabled)` y `cursor: not-allowed`.                                          |
| Inválido      | `aria-invalid="true"`, borde `--ui-color-danger` y mensaje en `--ui-color-danger-text`.                 |
| Seleccionado  | `--ui-color-control-active` y peso `semibold`, o `--ui-color-primary-soft` si es el acento de la vista. |

## Movimiento

`--ui-duration-fast` 120ms (color), `--ui-duration-base` 180ms y `--ui-duration-slow` 220ms (entrada de un panel). Curvas: `--ui-ease-out` para lo que aparece, `--ui-ease-in` para lo que se va y `--ui-ease-in-out` para lo que se desplaza. Respeta siempre `prefers-reduced-motion`.

**Qué usar:** la entrada de un panel, `@starting-style`. La salida o un cambio dentro de la página, una View Transition con `withViewTransition()` (`@meekojs/ui/runtime`). No uses JavaScript para animar.

**Reglas de las View Transitions:**

1. Da `view-transition-name` sólo durante tu tipo: `html:active-view-transition-type(mi-tipo) .x { view-transition-name: x; }`. Toda transición captura todos los elementos con nombre: un nombre permanente repite animaciones ajenas, y dos elementos con el mismo nombre cancelan la animación.
2. Dura 250 ms o menos: los clics durante una transición se pierden.
3. No abras un modal ni un `<select>` con View Transition: en WebKit el modal no se pinta hasta el final y el `<select>` no abre.

| Tipo             | Nombre                                          | Quién                                                                    |
| ---------------- | ----------------------------------------------- | ------------------------------------------------------------------------ |
| `ui-modal-close` | `ui-modal`, `ui-drawer-left`, `ui-drawer-right` | Salida de `UIModal`, `UICommandPalette` y `UIDrawer`.                    |
| `ui-tab`         | `ui-tabs-indicator`                             | Indicador de `UITabs`, sólo el grupo que cambia (`data-ui-tabs-active`). |
| `ui-toast-close` | `ui-toast`                                      | Salida de `UIToast`. No retiene los clics, porque cierra sola.           |
| `ui-theme`       | Ninguno: el fundido de la raíz                  | `UIThemeToggle`.                                                         |
| `meeko-route`    | `ui-navigation-tabs-indicator`                  | Indicador de `UINavigationTabs`, sólo en la fila con un enlace actual.   |

**Sólo Chromium:** la salida de `UIPopover`, `UICombobox` y la lista de `UISelect` usa `allow-discrete`. Firefox y WebKit las cierran de golpe, porque cerrar con un clic fuera no se puede interceptar para envolverlo en una transición.

**`UIToast` no corta otra transición:** si al cerrarse hay una en curso, desaparece sin animar. `clear()` y `remove()` tampoco animan: varios avisos a la vez repetirían el nombre.

**Dos filas de `UINavigationTabs` con enlace actual en la misma página** duplican el nombre: esa navegación funciona, pero sin animación.

## Carga

El módulo lo hace todo con `modules: ['@meekojs/ui']`:

- **`main.css`:** paleta, tokens, alias deprecados, `@font-face` y componentes.
- **`base.css`:** reset, `body`, `color-scheme`, `::selection`, barras de desplazamiento y foco, en la capa `@layer ui-base`. Cualquier regla sin capa de la app gana, y también cualquier capa que declare, porque ésta se registra primero. Se omite con `ui: { base: false }`.
- **La fuente:** se sirve en `/_meeko-ui/fonts/inter-latin-opsz-normal.woff2`, con su `preload`. La app no copia archivos ni escribe `@font-face`. La CSP sólo necesita `font-src 'self'`.

Una app no debe escribir su propio reset ni su `body`: borra los suyos al migrar.

## Editor de Markdown

`<UIMarkdownEditor>`, de `@meekojs/ui/editor`, pinta Crepe con los tokens. `src/app/styles/markdown-editor.css` asigna cada `--crepe-*` a un token de uso y sustituye a `classic.css` y `classic-dark.css`: `data-theme` cambia los colores sin reglas por tema, también en el CodeMirror de los bloques de código. No importes esos temas ni `theme/common/style.css`, que arrastra KaTeX y sus fuentes.

- **Títulos:** los tamaños de esta guía, no los de Crepe, que son de una página entera.
- **Lo que flota** (barra de formato, menú `/`, enlaces, lenguajes): `--ui-color-surface-raised`, con borde `--ui-color-border`.
- **Altura:** fija desde el primer pintado, con `--ui-markdown-editor-height`, para que no salte nada al llegar Crepe.

## Personalizar

Para una marca propia, `ui.tokens` o una hoja de la app:

```css
:root {
	--ui-color-primary-9: #0a7cff;
	--ui-radius-md: 0.5rem;
}
```

## Alias deprecados

`src/app/styles/deprecated.css` mantiene `--meeko-ui-*` sólo para leerlos, porque las páginas de `apps/ui` aún los usan. Asignar uno ya no llega a los componentes, salvo `--meeko-ui-container-max-width` y `--meeko-ui-container-gutter`. El paquete nunca se publicó, así que el archivo se borra cuando las apps migren. No escribas `--meeko-ui-*` en código nuevo.
