# Diseño de la documentación de Meeko UI

## Dirección

Modo de lectura: documentación técnica con ejemplos interactivos. El usuario eligió conservar la identidad de Meeko. La autoridad visual es `apps/site/app/styles/tokens.css`: Inter autoalojada, superficies neutras, acento azul, acciones principales neutras y temas claro/oscuro. No se introduce una marca independiente.

## Estructura

Cabecera del ecosistema, navegación lateral por tareas y una columna de lectura. En móvil, el menú se abre desde la cabecera; la documentación y los enlaces de recuperación funcionan sin JavaScript. El filtro busca nombres y descripciones del catálogo local.

La portada muestra un componente vivo. Las guías reúnen uso, ejemplo, código copiable y contrato de API. Las tablas y el código pueden desplazarse horizontalmente dentro de su contenedor; la página no debe desbordarse.

## Componentes y estados

Usa `@meekojs/ui` en las acciones, formularios, metadatos y ejemplos. Las superficies editoriales no necesitan convertirse en cards. Mantén un único encabezado principal, nombres accesibles, foco visible y texto para errores y estados. Los modales y View Transitions conservan el soporte de movimiento reducido del runtime.

Los tokens compartidos se copian desde el sitio principal y se conectan mediante `ui.tokens`. Al cambiar la identidad central, actualiza esta copia y comprueba ambos temas. Los ejemplos son datos locales; no sugieren persistencia ni peticiones que no existan.
