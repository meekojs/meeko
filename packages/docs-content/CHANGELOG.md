# Cambios de meeko-docs-content

Paquete privado, sin versiones publicadas. Cada entrada describe un cambio del contenido, del render o del esquema de la documentación.

## Búsqueda

- **Los extractos de la búsqueda ya no llevan basura.** `searchable_text` indexaba cualquier texto del payload, también rutas, archivos y trazos de iconos (`/docs/reference/signal M9 1.75…`), y dejaba sin decodificar las entidades numéricas de Shiki (`&#x3C;`), que el cliente volvía a escapar. Ahora omite esos campos y valores y decodifica todas las entidades una vez. El esquema no cambia, pero los snapshots ya publicados conservan su texto: surte efecto al volver a publicar.

## Idiomas (i18n, fase 1B)

- **`listTranslations` conserva un `source-hash` publicado nulo.** Una revisión publicada sin hash, o con uno inválido, seguía contando como `translated` en la lista y sus contadores por el hash importado, mientras el detalle y el render decían `outdated`. Ahora el hash importado sólo cuenta sin revisión publicada.
- **Migración `006_locales`**, aditiva para los datos: `locale` en `docs_sources` (con `source_hash` en las traducciones), `docs_pages` (con `translation`), `docs_moderation` y `docs_announcements` (`NULL` es todos los idiomas), `docs_feedback`, `docs_page_views` y `docs_searches`. Las filas existentes pasan a `es`. Las claves `(site, path)` ganan el idioma: `docs_sources (site, locale, path)`, `docs_pages (snapshot_id, locale, path)`, `docs_moderation (site, locale, path)` con `NULLS NOT DISTINCT` y `docs_page_views (site, locale, path, day)`. Índices de búsqueda `spanish` y `english` por idioma.
- **Traducciones en Git** (`docs/en/**`) con `source-hash` en el frontmatter, el estado `translated`, `outdated` o `missing`, y el comando `translations` (`stamp` escribe el hash).
- **Render por idioma**: `buildSnapshotPages` renderiza español e inglés en contextos separados; el inglés lee las traducciones, cae al español página a página (`i18n.fallback`) y lleva sus enlaces bajo `/en/`. Textos del render en `content/messages.ts`, títulos de sección de la referencia en inglés y anclas de `related` y del JSDoc trasladadas a la traducción.
- **Un snapshot con los dos idiomas**: `readPage`, `listPages` y `searchPages` aceptan `{ locale }` (español por defecto, compatibles con la firma anterior), y la búsqueda usa la configuración del idioma.
- **Dashboard**: `listTranslations`, `countTranslations`, `translationDetail`, fuentes y revisiones por idioma, `pagesByLocale` en los snapshots y `locales` en el resultado de `publishDocumentation`.
- **Moderación y avisos por idioma o globales**, con las rutas de las webs como URLs públicas del idioma, y **métricas con `locale`** en escritura, handlers (`localized`) y lecturas.
- `renderSourcePreview` previsualiza en inglés un borrador de una traducción (`file: 'docs/en/…'`).
