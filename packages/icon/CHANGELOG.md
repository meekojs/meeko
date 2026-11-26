# Cambios de Meeko Icon

## 1.11.0 — 2026-11-25

- Publicación coordinada con `@meekojs/ui` 1.11.0, sin cambios funcionales en este paquete.

## 1.10.2 — 2026-11-24

- **El icono deja su sitio al indicador de un botón ocupado.** Un `<UIButton loading>` con un `<UIIcon>` dentro, también con `iconOnly`, mostraba a la vez el indicador de carga y el icono: la hoja del icono no tiene capa, así que su `display` ganaba a la utilidad de `@meekojs/ui` que lo oculta. Ahora un botón o enlace con `aria-busy="true"` oculta el icono que contiene directamente. La regla usa `:where(button, a)` para que la aplicación la cambie con un selector sencillo.

## 1.10.1 — 2026-11-23

- Publicación coordinada con `@meekojs/meeko` 1.10.1, sin cambios funcionales en este paquete.

## 1.10.0 — 2026-11-23

- **`componentName` cambia el nombre del componente de iconos.** `icon: { componentName: 'AppIcon' }` autoimporta `<AppIcon>` en lugar de `<UIIcon>` y resuelve al compilar esa etiqueta; un nombre que no está en PascalCase es un error de la opción. Por defecto sigue siendo `UIIcon`.

## 1.9.0 — 2026-11-05

- Publicación coordinada con `@meekojs/meeko` 1.9.0, sin cambios funcionales en este paquete.

## 1.8.0 — 2026-11-04

- **Primera versión.** Módulo `@meekojs/icon`: se registra con `modules: ['@meekojs/icon']` y sus opciones van en la clave `icon` (`collections`, `include`, `local`, `size`), tipada sin imports.
- **`<UIIcon>` resuelto al compilar.** Cada `name` literal (y cada literal de una expresión `bind:name`) se resuelve durante el build con `@iconify/utils` y el paquete `@iconify-json/<colección>` del proyecto, y se incrusta en el `<svg>` del componente que lo usa: el bundle sólo lleva los iconos usados, sin peticiones en tiempo de ejecución ni CDN. Los nombres dinámicos que no son literales salen de `icon.include` (o `'<colección>:*'`); fuera de él se pinta un `<svg>` vacío y `meeko dev` avisa.
- **Tipos.** La unión de los nombres disponibles se genera por colección en `.meeko/types/modules/`; un nombre inexistente es `TS2820` con la sugerencia más parecida, en las plantillas y en `icon.include`. El editor completa `name="…"`.
- **SVG propios.** `app/icons/<nombre>.svg` (o la carpeta de `icon.local`) es `local:<nombre>`, saneado al compilar: sin `<script>`, `<style>`, manejadores, estilos en línea ni referencias externas, y en `currentColor` si es de un solo color.
- **Accesible y compatible con CSP estricta.** Decorativo por defecto (`aria-hidden="true"`, `focusable="false"`); con `label`, `role="img"` y `aria-label`. Alto `1em` por defecto, `currentColor`, y ancho, alto y relleno como atributos, nunca `style` en línea.
