# Revisión de la web de Meeko — 5 de noviembre de 2026

Estado: implementación local integrada; sin commit, publicación de snapshot ni despliegue.

## Cambios comprobados

- Entrada de instalación y tutorial ES/EN para consumidores. CLI publicada 1.9.0 ejecutada con `npm exec` fuera del workspace; instalación, check y servidor HTTP 200 comprobados.
- Ejemplos iniciales de UI e i18n comprobados con paquetes publicados 1.9.0. UI: check/build. i18n: check/build y traducciones visibles en `/` y `/en/`.
- Framework dividido en ocho guías y modelo de componentes en nueve, en ambos idiomas. Se conservan las anclas anteriores como enlaces de continuidad. Material de pruebas, tooling y presupuestos del monorepo trasladado a contribución.
- Corrección del render de etiquetas literales, incluido el textarea del changelog. Regresiones de script, style, pre, genéricos, bloques sin cierre y secciones posteriores.
- Navegación global conservada en referencia; filtro por nombre y avisos de deprecación; ficha activa visible en su grupo.
- Extractos de búsqueda sin controles de copia, cortes en límites de palabra y normalización de tildes. Comprobación local de búsqueda hydrate, Escape y devolución del foco.
- Portada con comandos públicos y demostración real de datos iniciales del servidor y filtro cliente. Contador conservado. Revisión visual representativa de portada, mapa, changelog y mapa móvil.
- Versiones históricas, roadmap y benchmarks contextualizados. Correcciones de variantes de UIButton, tonos reales de UIBadge y distinción UISelect/UICombobox contra tipos implementados.

## Cobertura y evidencia

`public-routes.generated.json` se genera con `pnpm -F meeko-docs-content inventory`: 1.354 rutas localizadas, 59 fuentes de guía, 172 símbolos curados, 574 generados, 134 compartidos y 612 destinos distintos de referencia.

La revisión automática de fuentes españolas comprobó 59 guías, 172 fichas y 1.274 enlaces: cero rotos. La comprobación de enlaces renderizados hacia fragmentos de guías dio cero fragmentos inexistentes en ambos idiomas. Esto verifica estructura y contratos; no equivale a una revisión editorial individual de las 612 fichas.

Pruebas ejecutadas: site check; site test 21/21; Markdown e idiomas 12/12 y regresión adicional de enlace traducido 7/7 en su archivo; build de producción. La suite docs-content completa encontró una expectativa antigua del título de portada; se corrigió y su archivo volvió a pasar. Pruebas de base de datos sin DATABASE_URL no se ejecutaron.

Medición de respuestas de desarrollo en localhost:4175, sin compresión y con preview de fuentes: framework pasó de 1.372.308 a 188.338 bytes de HTML; componentes/API de 737.982 a 177.539 bytes. Cambió también el menú, por lo que no se atribuye toda la diferencia únicamente al artículo. No son métricas de producción, transferencia, JavaScript ni Lighthouse.

## Límites pendientes de cobertura

- No se ha realizado una revisión editorial individual de cada ficha generada ni de todas las fichas curadas no examinadas por la auditoría original.
- La correspondencia de idioma de Inicio rápido conserva su sección mediante alias. Los enlaces documentales traducidos resuelven su ancla o retiran un fragmento inexistente; no se ha probado cada cambio de idioma de cada sección del catálogo.
- No se ha completado una matriz de portapapeles real, zoom, todos los paneles móviles, todos los estados de búsqueda ni todas las páginas en ambos temas.
- La búsqueda local sigue consultando el snapshot de datos existente. Publicar el nuevo contenido e índice requiere sincronización y despliegue autorizados por separado.
- El build conserva avisos sobre resolución de fuente en ejecución y la pseudoclase experimental `:target-current` en UI.
- Los agentes de la última separación encontraron capacidad del modelo agotada; su contenido fue integrado y comprobado por el coordinador. Algunos directorios temporales de worktree quedaron tras fallar la limpieza de Git por rutas largas. La eliminación recursiva adicional fue rechazada por la revisión automática, sin motivo detallado.

Servicios locales comprobados HTTP 200: Meeko 4175, UI 4174 e i18n 4173; se mantienen activos por petición del usuario. `dashboard.meekojs.com/` respondió HTTP 404; esto no demuestra si existe un servicio privado desplegado detrás del dominio.
