# Guía de documentación

La documentación se organiza por tareas. Las guías existentes mantienen sus rutas y anclas para conservar los enlaces del repositorio y de la web pública.

## Empezar

- [Primera aplicación](primeros-pasos.md).
- [Elegir Meeko](como-elegir.md).
- [Framework full-stack](framework.md#crear-una-aplicación): estructura, configuración y desarrollo local.

## Framework y servidor

- [Routing, layouts y SSR](framework.md#routing-layouts-y-ssr).
- [Middleware](framework.md#middleware-de-rutas-y-servidor).
- [API y RPC](framework.md#api-y-rpc).
- [View Transitions](framework.md#view-transitions-nativas).
- [Referencia por categorías](reference/README.md): macros, reactividad, composables, utilidades y servidor.

## Componentes y módulos

- [Componentes y API](api.md).
- [Meeko UI](ui.md) y [API de Meeko UI](ui-api.md).
- [Internacionalización](i18n.md).
- [Módulos](framework.md#módulos) y [layers](framework.md#layers).

## Herramientas y calidad

- [Doctor](doctor.md): diagnóstico local sin ejecutar el proyecto.
- [Editores y LSP](editors.md).
- [ESLint](eslint.md): `defineEslint`, Perfectionist, reglas y parser.
- [ESLint y Prettier](tooling.md).
- [DevTools](devtools.md).
- [Pruebas y CI](testing.md).

## Arquitectura y rendimiento

- [Arquitectura](architecture.md).
- [Benchmarks](benchmarks.md).
- [Mediciones y presupuestos de rendimiento](performance.md).
- [Contrato de estabilidad](stability.md).

## Mantener y publicar

- [Plan de desarrollo](roadmap.md).
- [Publicaciones](releasing.md).
- [Historial de cambios](../packages/meeko/CHANGELOG.md).

La web pública publica estas categorías desde `packages/docs-content/src/content/catalog.ts`; la referencia detallada tiene su propia taxonomía. Al añadir una guía, actualiza este índice y su entrada del catálogo cuando deba ser pública.
