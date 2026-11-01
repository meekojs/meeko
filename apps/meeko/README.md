# Sitio de documentación de Meeko

El sitio conserva Markdown, taxonomía y JSDoc en este repositorio como fuente. El script `docs:sync` los convierte en un snapshot de PostgreSQL. El servidor público usa únicamente ese snapshot para la portada, guías, referencia, búsqueda, `llms.txt` y sitemap; no lee Markdown del repositorio al atender peticiones.

## Desarrollo

La web consume `@meekojs/ui` como módulo. Su configuración `ui.tokens` apunta a las variables existentes de `app/styles/tokens.css`, de modo que conserva la misma paleta clara/oscura. Las acciones usan `UILink`, el índice documental `UILinkCard` y los metadatos de referencia `UIBadge`; la base visual vive en el paquete UI. Los defaults de formas y variantes se configuran en `ui.defaults`, y las props explícitas tienen prioridad. Véase la [guía de UI](../../docs/ui.md).

Se necesita Node.js 24, pnpm y una base PostgreSQL **dedicada al sitio**. La URL de conexión va en `apps/meeko/.env`, ignorado por Git:

```dotenv
DATABASE_URL=postgresql://USUARIO:CLAVE@HOST:5432/BASE_DE_DATOS
```

Desde la raíz del repositorio:

`pnpm dev` inicia este sitio; `pnpm site:dev` es el alias explícito. Para la web pública de Meeko UI usa `pnpm ui:dev`.

```powershell
pnpm install
pnpm run build
pnpm -F meeko-site run db:migrate
pnpm -F meeko-site run docs:import
pnpm -F meeko-site run docs:sync
pnpm -F meeko-site run check
pnpm -F meeko-site run test
pnpm -F meeko-site run dev
```

El render y el acceso a datos viven en el paquete privado [`meeko-docs-content`](../../packages/docs-content/README.md); el site solo lee el snapshot activo con `meeko-docs-content/snapshots`. Los tres scripts cargan el paquete con Vite y toman `DATABASE_URL` de `apps/meeko/.env` si el entorno no la define:

- `db:migrate` aplica las migraciones pendientes del paquete (`packages/docs-content/migrations/`) en una transacción y las registra en `docs_schema_migrations`. Repetirlo no aplica nada.
- `docs:import` guarda como fuentes base las guías y la referencia del site con su Markdown, y las páginas de `apps/ui` y `apps/i18n` sin él. Es idempotente y nunca modifica revisiones.
- `docs:sync` genera todas las páginas a partir de los archivos locales, con las revisiones publicadas desde el dashboard en lugar de su archivo, y activa el nuevo snapshot en una transacción; si falla, la versión anterior sigue visible. La base conserva los últimos snapshots y el que estaba activo para una posible reversión.

Nunca publiques un snapshot parcial ni edites las filas a mano. Después de cambiar Markdown o JSDoc, ejecuta `docs:sync` para publicarlos en el sitio.

## Moderación y avisos

El dashboard (`apps/dashboard`, pantalla «Moderación») oculta o destaca páginas y publica avisos sin publicar un snapshot. El site los lee de la misma base (`docs_moderation`, `docs_announcements`) con `meeko-docs-content/moderation`, con una caché de 30 s por proceso:

- **Oculta.** La página responde 404 (`readPage` de `server/content/db.ts` devuelve `null`) y sale de la barra lateral, de las tarjetas de `/docs`, de los índices de la referencia, del anterior/siguiente, de la búsqueda, de `/sitemap.xml`, de `/llms.txt` y de `/llms-full.txt`. El HTML de las guías no se reescribe: un enlace a ella desde otra guía lleva a su 404.
- **Destacada.** Una insignia «Destacado» en la barra lateral, en `/docs` y en el índice de la referencia.
- **Avisos.** `app/plugins/moderation.server.ts` los lee y `app/components/Announcements.meeko` los pinta en SSR bajo la cabecera (`role="status"`, o `alert` en una incidencia). Cerrar uno lo guarda en la cookie `meeko-docs-notices`, que el servidor lee: un aviso cerrado no vuelve a pintarse ni parpadea.
- **Sin base o con la base caída.** La moderación queda vacía, con un solo log `[docs-moderation]`; las páginas dependen igualmente del snapshot de la base.

El site no usa la caché de páginas de Meeko (`definePage({ cache })`): cada página se renderiza por petición, así que una regla nueva se aplica, como mucho, a los 30 s. `/sitemap.xml`, `/llms.txt` y `/llms-full.txt` llevan `public, no-cache` y un `ETag` débil: un navegador o una CDN pueden guardarlos, pero los revalidan en cada uso (`304` si no cambiaron), así que no suman frescura a los 30 s del lector. El banner de avisos vuelve a pedir los avisos tras cada navegación en el navegador (`/_meeko-docs/moderation/site`, `server/middleware/20-moderation.ts`, sin caché), así que una sesión larga ve los que empiezan, terminan o cambian sin recargar.

`pnpm -F meeko-site run test:e2e` arranca `meeko dev` contra un esquema temporal, con una copia del snapshot activo de la base dev (solo lectura de sus tablas), una regla `hide`, una `feature` y dos avisos, y comprueba todo lo anterior en Chrome. Borra el esquema al terminar.

## Métricas y «¿Te sirvió?»

El site cuenta vistas y búsquedas y recoge el «¿Te sirvió?» de cada página de documentación en la misma base (`docs_page_views`, `docs_searches` y `docs_feedback`); el dashboard las muestra en su pantalla «Métricas». Escribe con `meeko-docs-content/metrics`, un módulo que solo carga `pg`.

- **Vistas.** `app/plugins/metrics.ts` (de `meeko-docs`) envía un beacon (`navigator.sendBeacon`) a `POST /api/docs/views` por cada página que llega a mostrarse: la primera carga y cada navegación del cliente que cambia la ruta (no el hash ni la query). Un prefetch nunca confirma su ruta y una página prerenderizada por el navegador espera a mostrarse; el servidor descarta además los bots evidentes (agente vacío, de crawler o de cliente HTTP), las cabeceras `Sec-Purpose`/`Purpose: prefetch` y las rutas que el snapshot no tiene o que están ocultas. Cada vista suma uno a la fila de la página y el día UTC: no se guarda una fila por visita. Se eligió el beacon frente a contar en el servidor porque solo cuenta lo que se ve, cubre la navegación del cliente (que el servidor solo vería como `index.meeko.json`, igual que un prefetch) y deja fuera a los crawlers sin JavaScript.
- **Rutas.** Una vista o una respuesta se anota con la ruta que lee el router (`metricPath`): `/docs/%66ramework` o `/docs//framework/` cuentan como `/docs/framework`, y solo si el snapshot activo tiene esa página.
- **Búsquedas.** El diálogo de búsqueda pide resultados con `GET /api/docs/search` mientras se escribe, sin guardar nada; cuando la consulta se asienta (1,2 s sin escribir), se abre un resultado o se cierra el diálogo, envía una vez `POST /api/docs/search`, que guarda la consulta normalizada (recortada, en minúsculas, con los espacios unidos y como mucho 120 caracteres) con el número de resultados que encuentra el propio servidor. Así quedan las búsquedas sin resultados y nunca sus prefijos.
- **«¿Te sirvió?».** Al final de cada guía y página de referencia (`DocsLayout`), el componente `Docs/Feedback.meeko` de `meeko-docs`: «Sí» o «No» y un comentario opcional de hasta 2000 caracteres. Con JavaScript se envía como JSON; sin él es un `<form method="post">` a `POST /api/docs/feedback` que vuelve a la página con `303` y el agradecimiento pintado (la cookie de un solo uso `meeko-form` de Meeko, `HttpOnly` y de 60 s, solo lleva ese resultado).
- **Seguridad.** Las tres rutas son `defineApiRoute` con Valibot: Meeko exige el `Origin` del site en toda mutación (1.8), también en el formulario sin JavaScript (los navegadores lo envían), y aplica `rateLimit` por cliente: 120 vistas y 30 búsquedas por minuto y 10 respuestas cada 10 minutos. Los contadores viven en la memoria de cada instancia (`MemorySessionStore`) y Meeko solo guarda un resumen SHA-256 de la ruta y la IP; con varias instancias, cada una cuenta aparte.
- **Privacidad.** Sin cookies de seguimiento, IP, agente de usuario ni identificadores en la base: solo la ruta, el día o el instante, la consulta normalizada, la respuesta y el comentario. Una consulta que parece un dato personal o un secreto pegado por error (un email, un teléfono o un número de tarjeta, una URL con credenciales o con un token en su query, un `Bearer`/`Basic`, una clave de API, un JWT, una clave privada o cualquier cadena larga de alta entropía) no se guarda: el servidor la descarta antes de truncarla, de buscar con ella y de escribirla, sin dejarla en ningún log, y el navegador ni siquiera la envía. El comentario de «¿Te sirvió?» sí se guarda tal como lo escribe el lector, que lo envía a propósito; el dashboard permite borrarlo.
- **Sin base o con la base caída.** No se guarda nada, el endpoint responde igual (`204`, o el agradecimiento) y el servidor registra una sola línea `[docs-metrics]`, sin la URL. Sin `DATABASE_URL` el widget no se muestra.
- **Desactivarlas.** `DOCS_METRICS=off` (también `0`, `false` o `no`): el plugin no envía beacons, el widget desaparece y los endpoints no escriben.

`tests/metrics.e2e.mjs` (dentro de `pnpm -F meeko-site run test:e2e`) arranca `meeko dev` contra un esquema temporal con una copia del snapshot activo y comprueba en Chrome la vista al cargar y al navegar (no al cambiar el hash), una búsqueda sin resultados guardada una sola vez, el «¿Te sirvió?» con y sin JavaScript, la falta de cookies, y los `403` sin `Origin` o con uno ajeno; borra el esquema al terminar.

## Build y publicación

```powershell
pnpm run site:build
pnpm -F meeko-site run docs:sync
pnpm -F meeko-site run start
```

El build genera `.meeko/output/node`; `start` sirve las rutas SSR y los assets. El proceso necesita `DATABASE_URL` y una base ya migrada y sincronizada. En producción, configura la URL en el gestor de secretos del servicio, inicia Node detrás del proxy HTTPS y comprueba `/docs`, `/docs/reference`, `/api/docs/search?q=signal` y `/sitemap.xml` antes de dirigir tráfico. El antiguo despliegue de archivos `dist-static/` no sirve esta versión.

El snapshot se construye con `scripts/sync-docs.mjs` y `publishDocumentation` de `meeko-docs-content`: las guías vienen de `docs/*.md` y del README del paquete; la referencia combina `docs/reference/`, `taxonomy.json` y las declaraciones TypeScript/JSDoc públicas. Una revisión publicada sustituye al Markdown de su archivo; el repositorio no cambia. Los tipos y las firmas se generan desde el código del paquete, no se duplican en PostgreSQL como una segunda fuente editable.

La búsqueda consulta el texto del mismo snapshot activo. Los fragmentos que devuelve son texto plano y el cliente los escapa antes de mostrarlos. `/llms.txt`, `/llms-full.txt`, `/sitemap.xml` y `/robots.txt` también salen del servidor Node. `pnpm run test` comprueba que los símbolos, ejemplos y páginas escritas sigan el contrato de la referencia.

## Dominio y redirección de `www`

La web se publica en `https://meekojs.com`; las demás, en `https://ui.meekojs.com` (`apps/ui`), `https://i18n.meekojs.com` (`apps/i18n`) y, cuando tenga login, `https://dashboard.meekojs.com` (`apps/dashboard`). Las URL canónicas y `og:url` salen de `site` en `meeko.config.ts`; el sitemap, `robots.txt` y los enlaces absolutos de `llms.txt`, de `siteOrigin` en `meeko-docs-content`. Cambiar de dominio exige tocar los dos y volver a ejecutar `docs:sync`.

En producción, el servicio define:

```dotenv
MEEKO_PUBLIC_ORIGIN=https://meekojs.com     # el origen tras el proxy HTTPS; los POST de métricas comparan Origin con él
SITE_CANONICAL_ORIGIN=https://meekojs.com   # activa la redirección de www
```

Con `SITE_CANONICAL_ORIGIN`, `server/middleware/00-canonical-host.ts` responde `301` a `https://meekojs.com` con la misma ruta y query cuando la petición llega a `www.meekojs.com`, antes que cualquier otro middleware. Sin la variable, como en local, no actúa; un valor que no sea un origen `http:` o `https:` sin ruta detiene el arranque. El host es el de la cabecera `Host`, no el de `request.url`, que Meeko rehace sobre `MEEKO_PUBLIC_ORIGIN`. `X-Forwarded-Host` solo cuenta con `MEEKO_TRUST_PROXY`, y entonces se lee su entrada como Meeko lee `X-Forwarded-For`: la del proxy de confianza más externo. Lo comprueba `tests/canonical-host.test.mjs`.

Meeko sirve los archivos de `public/` (fuentes e imágenes de marca) antes del middleware, así que siguen respondiendo en `www`. Para redirigir todo sin que la petición llegue al servidor, la alternativa es una regla de Cloudflare en la zona `meekojs.com` (**Rules → Redirect Rules → Single Redirect**), con el registro `www` proxied:

- **Cuándo:** `http.host eq "www.meekojs.com"`.
- **Destino:** dinámico, `concat("https://meekojs.com", http.request.uri.path)`, código `301` y **Preserve query string** activado.

Con la regla activa, el middleware queda como respaldo y puede seguir configurado.
