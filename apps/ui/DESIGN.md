# Diseño de la documentación de Meeko UI

## Dirección

Modo de lectura: documentación técnica con ejemplos interactivos. **Esta web no escribe diseño:** la autoridad visual es [`packages/ui/DESIGN.md`](../../packages/ui/DESIGN.md), con Inter, neutros limpios, bordes finos, violeta eléctrico con moderación, fondo blanco o negro puros y temas claro y oscuro.

## Estructura

Cabecera del ecosistema y portada a ancho completo con los patrones de `@meekojs/ui`. Las guías tienen navegación lateral por tareas y una columna de lectura. En móvil, el menú de las guías se abre desde la cabecera; la documentación y los enlaces de recuperación funcionan sin JavaScript. El filtro busca nombres y descripciones del catálogo local.

La portada muestra un componente vivo. Las guías reúnen uso, ejemplo, código copiable y contrato de API. Las tablas y el código pueden desplazarse horizontalmente dentro de su contenedor; la página no debe desbordarse.

## Componentes y estados

Usa `@meekojs/ui` en las acciones, formularios, metadatos y ejemplos. Las superficies editoriales no necesitan convertirse en cards. Mantén un único encabezado principal, nombres accesibles, foco visible y texto para errores y estados. Los modales y View Transitions conservan el soporte de movimiento reducido del runtime.

Los tokens viven en `packages/ui` y esta web no define los suyos. Su único CSS es un efecto, la coreografía de la demo de View Transitions en `app/styles/main.css`. La disposición de las demos (`DocsPreview`, `.docs-grid`, `.docs-stack`) está en `packages/docs`. Si falta algo, se añade a UI. Los ejemplos son datos locales; no sugieren persistencia ni peticiones que no existan.
