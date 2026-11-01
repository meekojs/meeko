# Base documental privada

`meeko-docs` es un módulo de workspace **privado**, compartido por `apps/ui` y `apps/i18n`. No se publica ni forma parte de la instalación de UI o i18n en aplicaciones consumidoras.

- `src/module.ts` registra componentes `Docs*` y la hoja de estilos del sitio.
- `src/app/components/Docs/` contiene shell, navegación, página, bloques de código y tabla de API.
- `src/theme.ts` exporta `docsTheme` para conectar UI con las variables de marca.
- `src/app/styles/` conserva la identidad de Meeko y los estilos editoriales.
- `assets/` contiene el logo derivado de la marca y la tipografía Inter con su licencia.
- `scripts/assets.mjs` copia esos recursos al `public/` de la aplicación que lo ejecuta.
- `scripts/build.mjs` genera declaraciones adyacentes de los componentes externos mediante la CLI de Meeko y el rebase común del monorepo. Las declaraciones se ignoran y se actualizan sólo si cambia su contenido.

`pnpm build` lo prepara después del núcleo y UI. Las aplicaciones también ejecutan su preparación antes de `dev`, `build` y `check`. `meeko.config.ts` del paquete describe las dependencias de sus plantillas durante esa generación.

`DocsShell` recibe nombre de producto, paquete, repositorio y navegación; su snippet `default` aloja el outlet. `DocsPage` admite `product` para el sufijo del título; conserva `Meeko UI` por defecto para las guías existentes. `DocsNavigation` acepta aliases de URL para representar la selección de rutas localizadas.

Al cambiar esta base, comprueba ambas aplicaciones y los E2E de UI y de i18n. Los ejemplos del módulo i18n pertenecen a su aplicación, no a esta base compartida.

`meeko-docs/server` proporciona el runtime para estas webs públicas, que no crean cuentas ni sesiones persistentes. Su manager usa memoria sin cambiar el modo de producción del resto del runtime. Una aplicación que añada sesiones persistentes debe proporcionar su propio runtime y store.

**Moderación.** Con `modules: ['meeko-docs']` y `docs: { site: 'ui' }` (o `'i18n'`) en `meeko.config.ts`, el módulo añade un plugin de servidor que lee la moderación del dashboard con `meeko-docs-content/moderation` y la publica para la petición. El Shell la fija con `useDocsModeration()` (`meeko-docs/state`), un `useState` que viaja al navegador y que, tras cada navegación confirmada, se vuelve a pedir a `/_meeko-docs/moderation/<web>` (un handler del módulo, sin caché; `refreshOnNavigation`), porque el estado de clave fija no se renueva al navegar: filtra las páginas ocultas de la navegación, marca las destacadas con «Destacado» y pinta los avisos (`DocsAnnouncements`, que acepta `preview` para la vista previa del dashboard). El 404 de una página oculta lo da el middleware de ruta de servidor de cada web con `isModeratedOut` de `meeko-docs/moderation`, porque los módulos no añaden middleware de ruta. Sin `site`, o sin base de datos, todo queda vacío.

**Métricas.** Con `site`, el módulo añade también `src/metrics/plugin.ts`, un plugin de los dos lados: en el servidor decide si las métricas están activas (`DATABASE_URL` y sin `DOCS_METRICS=off`), lo publica para `useDocsMetrics()` (`meeko-docs/metrics`) y en el `<meta name="meeko-docs-metrics">`; en el navegador envía un beacon a `/api/docs/views` por cada ruta confirmada (la primera y las de la navegación del cliente; nunca un cambio de hash). `DocsPage` termina con `DocsFeedback` («¿Te sirvió?», salvo en `landing`), que funciona también sin JavaScript con un formulario `POST` a `/api/docs/feedback`, y el filtro de `DocsShell` registra la búsqueda en `/api/docs/search` tras 1,5 s sin escribir, salvo que parezca un dato personal o un secreto (`storedQuery`), que no se envía. Como un módulo no puede añadir rutas de API, cada web declara esas tres en `server/api/docs/*.post.ts` con los handlers y schemas de `meeko-docs/metrics/server` (`navigationPaths(site, navigation)` limita las rutas a las de su navegación, con sus alias, y salta las ocultas; compara rutas, alias y destinos como los lee el router, así que `/%62uttons` o `/en//playground` cuentan como su página canónica). El site, que no usa el módulo, importa el plugin (`meeko-docs/metrics/plugin`) y el componente; los tokens del site y de esta base se llaman igual.
