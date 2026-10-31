# Sitio de documentación de Meeko

El sitio conserva Markdown, taxonomía y JSDoc en este repositorio como fuente. El script `docs:sync` los convierte en un snapshot de PostgreSQL. El servidor público usa únicamente ese snapshot para la portada, guías, referencia, búsqueda, `llms.txt` y sitemap; no lee Markdown del repositorio al atender peticiones.

## Desarrollo

La web consume `@meekojs/ui` como módulo. Su configuración `ui.tokens` apunta a las variables existentes de `app/styles/tokens.css`, de modo que conserva la misma paleta clara/oscura. Las acciones usan `UILink`, el índice documental `UILinkCard` y los metadatos de referencia `UIBadge`; la base visual vive en el paquete UI. Los defaults de formas y variantes se configuran en `ui.defaults`, y las props explícitas tienen prioridad. Véase la [guía de UI](../../docs/ui.md).

Se necesita Node.js 24, pnpm y una base PostgreSQL **dedicada al sitio**. La URL de conexión va en `apps/site/.env`, ignorado por Git:

```dotenv
DATABASE_URL=postgresql://USUARIO:CLAVE@HOST:5432/BASE_DE_DATOS
```

Desde la raíz del repositorio:

`pnpm dev` inicia este sitio; `pnpm site:dev` es el alias explícito. Para la web pública de Meeko UI usa `pnpm ui:dev`.

```powershell
pnpm install
pnpm run build
pnpm -F meeko-site run db:migrate
pnpm -F meeko-site run docs:sync
pnpm -F meeko-site run check
pnpm -F meeko-site run test
pnpm -F meeko-site run dev
```

`db:migrate` aplica `migrations/001_docs.sql`. `docs:sync` genera todas las páginas a partir de los archivos locales y activa el nuevo snapshot en una transacción; si falla, la versión anterior sigue visible. La base conserva también la versión activa anterior para una posible reversión. Nunca publiques un snapshot parcial ni edites las filas a mano. Después de cambiar Markdown o JSDoc, ejecuta `docs:sync` para publicarlos en el sitio.

## Build y publicación

```powershell
pnpm run site:build
pnpm -F meeko-site run docs:sync
pnpm -F meeko-site run start
```

El build genera `.meeko/output/node`; `start` sirve las rutas SSR y los assets. El proceso necesita `DATABASE_URL` y una base ya migrada y sincronizada. En producción, configura la URL en el gestor de secretos del servicio, inicia Node detrás del proxy HTTPS y comprueba `/docs`, `/docs/reference`, `/api/docs/search?q=signal` y `/sitemap.xml` antes de dirigir tráfico. El antiguo despliegue de archivos `dist-static/` no sirve esta versión.

El snapshot se construye con `scripts/sync-docs.mjs`: las guías vienen de `docs/*.md` y del README del paquete; la referencia combina `docs/reference/`, `taxonomy.json` y las declaraciones TypeScript/JSDoc públicas. Los tipos y las firmas se generan desde el código del paquete, no se duplican en PostgreSQL como una segunda fuente editable.

La búsqueda consulta el texto del mismo snapshot activo. Los fragmentos que devuelve son texto plano y el cliente los escapa antes de mostrarlos. `/llms.txt`, `/llms-full.txt`, `/sitemap.xml` y `/robots.txt` también salen del servidor Node. `pnpm run test` comprueba que los símbolos, ejemplos y páginas escritas sigan el contrato de la referencia.
