# Routing

Meeko crea rutas a partir de `app/pages` y usa el mismo manifiesto para SSR y navegación en el navegador. Este índice reúne las guías del tema; cada una tiene su propio índice de secciones en la web.

## Por dónde empezar

1. Sigue el [tutorial del router](router.md) para construir páginas, cargar datos y navegar entre ellas.
2. Consulta [Páginas y parámetros](routing-pages.md) para las convenciones de archivos, segmentos dinámicos y grupos.
3. Elige las opciones de [Datos y renderizado](routing-data.md) que necesita cada página.

## Guías por tema

| Tema                                         | Contenido                                                         |
| -------------------------------------------- | ----------------------------------------------------------------- |
| [Páginas y parámetros](routing-pages.md)     | Archivos de ruta, precedencia, parámetros y opciones por carpeta. |
| [Datos y renderizado](routing-data.md)       | Código de servidor, carga, errores, SSR, streaming y caché.       |
| [Layouts](routing-layouts.md)                | Layouts con nombre, anidamiento y props.                          |
| [Navegación](routing-navigation.md)          | `MeekoLink`, `useRoute`, estado, scroll y View Transitions.       |
| [Middleware de rutas](routing-middleware.md) | Middleware global, con nombre y sólo de servidor.                 |

## API de referencia

Las guías enlazan sus detalles técnicos cuando hacen falta: [datos](routing-data-reference.md), [layouts](routing-layouts-reference.md), [navegación](routing-navigation-reference.md) y [middleware](routing-middleware-reference.md). La [referencia por categorías](/docs/reference) contiene firmas y ejemplos de las APIs. Para middleware HTTP que también cubre API y RPC, consulta [Middleware de servidor](framework.md#middleware-de-servidor).
