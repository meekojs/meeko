# Cambios de Meeko Icon

## Sin publicar

- **Primera versión.** Módulo `@meekojs/icon`: se registra con `modules: ['@meekojs/icon']` y sus opciones van en la clave `icon` (`collections`, `include`, `local`, `size`), tipada sin imports.
- **`<UIIcon>` resuelto al compilar.** Cada `name` literal (y cada literal de una expresión `bind:name`) se resuelve durante el build con `@iconify/utils` y el paquete `@iconify-json/<colección>` del proyecto, y se incrusta en el `<svg>` del componente que lo usa: el bundle sólo lleva los iconos usados, sin peticiones en tiempo de ejecución ni CDN. Los nombres dinámicos que no son literales salen de `icon.include` (o `'<colección>:*'`); fuera de él se pinta un `<svg>` vacío y `meeko dev` avisa.
- **Tipos.** La unión de los nombres disponibles se genera por colección en `.meeko/types/modules/`; un nombre inexistente es `TS2820` con la sugerencia más parecida, en las plantillas y en `icon.include`. El editor completa `name="…"`.
- **SVG propios.** `app/icons/<nombre>.svg` (o la carpeta de `icon.local`) es `local:<nombre>`, saneado al compilar: sin `<script>`, `<style>`, manejadores, estilos en línea ni referencias externas, y en `currentColor` si es de un solo color.
- **Accesible y compatible con CSP estricta.** Decorativo por defecto (`aria-hidden="true"`, `focusable="false"`); con `label`, `role="img"` y `aria-label`. Alto `1em` por defecto, `currentColor`, y ancho, alto y relleno como atributos, nunca `style` en línea.
