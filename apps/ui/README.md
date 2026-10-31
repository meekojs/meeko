# Web pública de Meeko UI

Aplicación de documentación de `@meekojs/ui`, construida con Meeko y el propio módulo UI. Conserva la identidad visual del sitio principal, incluidos los temas claro y oscuro, la tipografía Inter y los tokens semánticos. No necesita una base de datos.

## Desarrollo

Desde la raíz del repositorio, con Node.js 24+ y pnpm 12:

```powershell
pnpm install
pnpm build
pnpm ui:dev
```

Meeko imprime la URL disponible. `pnpm dev` sigue iniciando la documentación del framework; `pnpm ui:dev` inicia esta web.

```powershell
pnpm -F meeko-ui-site check
pnpm ui:build
pnpm -F meeko-ui-site start
```

El build usa el adaptador Node de Meeko y genera `.meeko/output/node`. Para cambiar de adaptador o configurar el dominio, usa `meeko.config.ts` y la guía de despliegue del framework. Estos comandos preparan y sirven el sitio; no lo publican automáticamente.

## Organización

- `app/pages/`: portada, instalación, temas, índice y guías de componentes. Las rutas `/cards`, `/tables`, `/modals` y `/transitions` conservan los ejemplos interactivos anteriores.
- `app/components/Docs/`: página documental, bloques de código copiables y tablas de API.
- `app/utils/navigation.ts`: catálogo de navegación y filtro local por nombre o descripción; no es búsqueda de texto completo.
- `app/utils/examples.ts`: código copiable de las guías.
- `app/styles/`: tokens de la identidad Meeko y estilos del sitio. UI sigue usando su propio PostCSS.
- `public/`: logo de Meeko y tipografía Inter con su licencia.

Cada guía debe explicar el contrato real, mostrar un ejemplo interactivo, incluir código copiable y documentar props, snippets y eventos relevantes. Mantén los ejemplos sincronizados con `packages/ui/src/app` y actualiza el catálogo al añadir una ruta. Las comprobaciones de tipos validan los componentes vivos; las pruebas de navegador de UI cubren navegación, formularios, modales, tablas, temas y View Transitions.

```powershell
node --test --test-concurrency=1 packages/ui/tests/*.e2e.mjs
```

El sitio se migró de `apps/ui-demo` a `apps/ui`; el nombre del paquete de workspace es `meeko-ui-site`.
