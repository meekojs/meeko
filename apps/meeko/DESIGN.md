# Diseño del sitio

**Este sitio no tiene diseño propio.** Colores, tamaños, fuentes, espacios, radios y controles salen de [`packages/ui`](../../packages/ui/DESIGN.md), como en `apps/ui`, `apps/i18n`, `apps/dashboard` y `packages/docs`. Si falta algo, se añade a UI, no aquí. La dirección es la del contrato: neutros limpios, fondo `#ffffff` y `#000000`, bordes finos, un violeta eléctrico usado con moderación y tipografía compacta.

## Cómo está hecho

- `app/layouts/docs.meeko` y `app/layouts/default.meeko` pintan `SiteShell`, el adaptador del snapshot sobre `<DocsShell>` de `meeko-docs`: el primero para las páginas del snapshot, que le pasan sus datos con `layoutProps`, y el segundo, con `layout: 'landing'`, para la portada, `/docs` y el error.
- El HTML del snapshot se viste con `<UIProse>`, que también gestiona sus botones de copiar. La búsqueda es `<UICommandPalette>`, en `SiteSearch`, y el pie, `<UIFooter>`, en `SiteFooter`.
- Lo que queda de CSS en una página o un componente es disposición y sólo lee `--ui-*`.

## Lo único propio: imágenes y efectos

| Dónde                            | Qué                                                                                                                                                                                       |
| -------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `app/styles/main.css`, `.iso`    | Las figuras isométricas: trazos finos sobre pasos de la escala `surface`, con las etiquetas en las unidades de cada dibujo (`--fig-text`, en `px` del `viewBox`).                         |
| `app/components/CatFigure.meeko` | El dibujo de Meeko: su geometría, la mezcla del trazo medio y los ojos con el acento.                                                                                                     |
| `app/pages/index.meeko`          | La entrada de la portada (`settle`, `rise`, con `prefers-reduced-motion`), los tamaños de `--fig-text` de cada figura y la escena del editor de la FIG. 04.                               |
| `app/components/LiveDemo.meeko`  | La ventana que se funde con el fondo (`mask-image`), la trama de puntos del resultado y los destellos al cambiar una señal, con el rosa de la nariz de Meeko (`--ui-color-pink-3`, `-9`). |

Todo lo demás, también dentro de esos archivos (textos, botones, leyendas de figura), es de UI: los controles son `UIButton` y `UIBadge`, y las fuentes y los tamaños salen de tokens.

## Reglas al tocar este sitio

1. Un `<button>`, `<input>`, `<dialog>` o `<table>` a mano, un hex, un `font-size` o un `font-family` fuera de tokens no entran. Las únicas excepciones son las de la tabla.
2. Lee el token de uso, no el paso. Un paso de una escala sólo en un dibujo.
3. Un tema se resuelve solo con `data-theme`: no escribas reglas por tema.
4. El violeta es para la acción principal, el foco, la selección y lo que está activo.
5. Cada `<style scoped>` debe poder leerse como disposición. Si describe un aspecto, ese aspecto falta en UI.
