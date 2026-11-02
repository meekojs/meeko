# Meeko Dashboard

Herramienta de administración de la documentación pública de las tres webs del monorepo: el framework (`apps/meeko`), UI (`apps/ui`) e i18n (`apps/i18n`). Es una aplicación Meeko full-stack con el adaptador Node y `@meekojs/ui`, con la misma identidad que las webs documentales: los tokens son los de `@meekojs/ui`.

Lee y escribe la misma base de datos que el site, a través de `meeko-docs-content`. El site sirve siempre el snapshot activo; el dashboard decide cuál es.

## Arranque

```powershell
pnpm install
pnpm build                     # núcleo, UI y meeko-docs, la primera vez
Copy-Item apps/dashboard/.env.example apps/dashboard/.env   # y rellena DATABASE_URL
pnpm -F meeko-dashboard exec meeko auth hash                # ADMIN_PASSWORD_HASH=…; añade también ADMIN_USERNAME
pnpm dashboard:dev             # http://127.0.0.1:4310, que pide iniciar sesión
```

Todas las pantallas exigen la sesión del administrador (véase «F5: autenticación»). Sin `ADMIN_USERNAME` y `ADMIN_PASSWORD_HASH`, el desarrollo arranca pero nadie puede entrar, y la página de inicio de sesión lo explica.

La base debe tener el esquema aplicado (`pnpm -F meeko-site run db:migrate`). Si faltan las tablas o la conexión, cada pantalla muestra el error y cómo resolverlo; el servidor arranca igualmente.

| Comando                                       | Qué hace                                                                                                                                                                                                                                                                                   |
| --------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `pnpm -F meeko-dashboard run dev`             | Servidor de desarrollo en `127.0.0.1:4310`. Prepara antes los recursos de `meeko-docs` (logo, Inter y declaraciones).                                                                                                                                                                      |
| `pnpm -F meeko-dashboard run check`           | `meeko check`: tipos de páginas, RPC y contratos.                                                                                                                                                                                                                                          |
| `pnpm -F meeko-dashboard run test`            | Ejecutor de trabajos, worker de vista previa, procesos hijo que mueren con el dashboard, control de `Host` y reglas del login; con `DATABASE_URL`, también lecturas, revisiones, moderación, métricas, el script hijo y el login sobre HTTP (`tests/auth.test.ts`) en un esquema temporal. |
| `pnpm -F meeko-dashboard run test:e2e`        | Chrome con Playwright contra un esquema temporal, con una cuenta de prueba: login, navegación y logout (también sin JavaScript); resumen, filtros, detalle y rollback; el editor, la moderación y las métricas. Se salta sin `DATABASE_URL`.                                               |
| `pnpm -F meeko-dashboard run build` / `start` | Build Node y su servidor. Los trabajos se lanzan desde `scripts/` de la raíz que da `ServerRuntimeContext.root` (la carpeta del proyecto, o `MEEKO_ROOT`), así que `start` funciona desde cualquier carpeta.                                                                               |

## Variables de entorno

`meeko dev`, `build` y `start` leen `apps/dashboard/.env`, que no se versiona. `.env.example` lista las variables.

- `DATABASE_URL`: la base de documentación, la misma de desarrollo que usa el site (`voidcat-local:5432/meeko_site_dev`). Copia solo esta línea desde `apps/meeko/.env`.
- `DASHBOARD_DATABASE_SCHEMA` (opcional): esquema de las tablas (`search_path`). Lo usan las pruebas para trabajar en un esquema temporal; normalmente no se define.
- `DASHBOARD_ALLOWED_HOSTS` (opcional): nombres de host, además de los de loopback, a los que responde el servidor. Separa varios con comas. En producción, `dashboard.meekojs.com`.
- `ADMIN_USERNAME`, `ADMIN_PASSWORD_HASH` y las variables de sesión y de límite de intentos: véase «F5: autenticación».
- `MEEKO_HOST` y `MEEKO_PORT`: dirección y puerto del servidor; por defecto, `127.0.0.1:4310` en desarrollo y `0.0.0.0:4310` en un build de producción.
- `DASHBOARD_AUTHOR` ya no existe: desde F5 el autor de cada cambio es el usuario de la sesión (véase «F5: autenticación»). Si sigue en un `.env`, se ignora.

## Seguridad

- **Login obligatorio.** Todas las páginas, las RPC y la API, y por tanto los procesos hijo que lanzan, exigen la sesión del administrador; solo quedan abiertos `/login`, `POST /api/auth/login`, la RPC `auth/session` (dice quién está conectado en la petición, o `null`) y los recursos estáticos. Véase «F5: autenticación».
- **`Host` permitido.** `server/middleware/10-host.ts` rechaza con `421` las peticiones cuyo `Host` no sea `127.0.0.1`, `localhost`, `[::1]` o uno de `DASHBOARD_ALLOWED_HOSTS`. Así, una web que resuelva su propio dominio al servidor (DNS rebinding) no puede leer el dashboard.
- **Origen y CSRF en las acciones.** Toda mutación comprueba `Origin` (Meeko 1.8 lo hace por defecto; las RPC que cambian datos, la exportación y la vista previa lo declaran además con `origin: 'required'`), y con sesión también el token CSRF (`x-meeko-csrf`, o el campo `_csrf` de un formulario nativo). Otra web no puede lanzarlas desde el navegador.

Las respuestas llevan `noindex`, una CSP sin scripts externos y `frame-ancestors 'none'`. La vista previa muestra el HTML del render real, que conserva el HTML del Markdown como el site, así que un borrador puede traer `<style>`, `<iframe>`, `<script>` o atributos `on*`. Por eso nunca entra en el documento del dashboard: es el `srcdoc` de un `<iframe sandbox>` sin `allow-scripts` ni `allow-same-origin` (`app/utils/preview-document.ts`). Su origen es opaco, no ejecuta nada y no alcanza los controles del editor. Dentro van los estilos de prosa del site y los tokens del tema actual. Como defensas adicionales, el iframe hereda la CSP del dashboard y su documento añade otra (`script-src 'none'`, `frame-src 'none'`, `form-action 'none'` y `base-uri 'none'`). Inter no se carga dentro, porque una fuente desde un origen opaco necesita CORS, y la sustituye la fuente del sistema.

## Cómo funciona

- **Lecturas.** RPC tipados en `server/rpc/*` con los schemas de `shared/schemas/dashboard.ts` (Valibot): `overview.get`, `sources.list`, `sources.get`, `snapshots.list` y `health.get`. Las páginas los llaman desde su `<script server>` y conservan un fallo como estado de error de la página, no como un `500`. El pool de PostgreSQL es un servicio del runtime (`server/runtime.ts`) y se abre en el primer uso.
- **Trabajos en un proceso hijo.** Importar desde Git, publicar un snapshot y comprobar la salud se ejecutan con `scripts/content-job.mjs` en otro proceso Node, con Vite cargando el TypeScript de `meeko-docs-content`. El render compila el paquete con TypeScript y guarda cachés por contexto, así el proceso del dashboard no carga nada de eso y su memoria no crece con cada publicación. `server/dashboard/jobs.ts` impide que una importación y una publicación coincidan, guarda las últimas 400 líneas de salida y mata el proceso a los 10 minutos.
- **Procesos hijo ligados al dashboard.** Cada hijo (trabajos y vista previa) se abre con un canal IPC y `scripts/parent-guard.mjs` lo termina en cuanto ese canal se cierra. En Windows libuv ya mata a los hijos con su padre; en Linux y macOS, sin ese guardián, un trabajo seguía vivo tras un `SIGKILL` del dashboard.
- **Conflictos.** Si un rollback u otra publicación (por ejemplo, `docs:sync`) cambia el snapshot activo mientras se renderiza, `publishDocumentation` lanza `SnapshotConflictError` y no guarda nada. Snapshots lo muestra como conflicto y ofrece volver a publicar. Mientras un trabajo de contenido está en curso, el dashboard no deja activar otro snapshot.
- **Salud.** `meeko-docs-content/health` reúne las referencias pendientes de `docs/reference/taxonomy.json`, los exports de `@meekojs/meeko` que no nombra ninguna página escrita y los enlaces internos y anclas rotos de las guías y la referencia. El informe se calcula en el proceso hijo y se guarda en memoria hasta que vuelvas a comprobar.

## Pantallas

- **Resumen.** Fuentes de cada web por tipo y por estado de divergencia (`git`, `same`, `edited`, `conflict`, `missing` e importación desactualizada), el snapshot activo con fecha y autor, y el último cambio importado.
- **Fuentes.** Tabla filtrable por web, idioma, tipo, estado y texto, con los filtros en la URL. Las traducciones (`docs/en/**`) son fuentes propias, con el `path` de su original. El detalle muestra archivo, hashes, revisiones con sus acciones, la comparación de dos versiones y el diff de Git a la revisión publicada.
- **Traducciones** (`/translations`, `/translations/<id>`). Estado de cada guía y referencia escrita (traducida, desactualizada o sin traducir), con filtros y contadores; el detalle compara los dos textos y muestra lo que cambió en el español desde que se tradujo. Véase «Idiomas».
- **Salud.** El informe anterior y el inventario de páginas `.meeko` de UI e i18n.
- **Editor** (`/sources/<id>/edit`). `UIMarkdownEditor` (Crepe, con un modo código) y vista previa lado a lado (apilados en pantallas estrechas). El frontmatter se edita aparte, como campos, y no pasa por Crepe. Abrir un documento no lo cambia y una edición sólo reescribe su bloque: las traducciones no se quedan desactualizadas por el formato de Crepe.
- **Moderación** (`/moderation`, una pestaña por web). Reglas de ocultar o destacar páginas y avisos de cabecera, de un idioma o de todos; ver «F3» e «Idiomas».
- **Métricas** (`/metrics`, una pestaña por web, un idioma con `?lang=es|en` y un rango de días). Vistas por día, páginas más vistas, búsquedas, «¿Te sirvió?» y comentarios de los lectores; ver «F4».
- **Snapshots.** Importar, publicar con una nota (firma el usuario de la sesión), y activar o volver a un snapshot anterior tras confirmarlo, con la salida del proceso a la vista. Lista los cambios de revisiones que el snapshot activo aún no incluye: las publicadas después y, desde la migración 003 (`archived_at`), la publicada que ese snapshot muestra y se archivó después sin otra en su lugar (su página vuelve a Git con la próxima publicación). «Volver a publicar» tras un conflicto reutiliza la nota del trabajo, también después de recargar.

## Idiomas

La interfaz está en español, sin prefijo (las URL de siempre), y en inglés, bajo `/en/…`, con `@meekojs/i18n`: las rutas inglesas salen de las mismas páginas, y el idioma lo decide siempre la dirección. El navegador solo sugiere: un aviso descartable que nunca redirige.

- **Catálogos.** `app/locales/<idioma>/<namespace>.json`: `common` (cabecera, errores, validación, etiquetas y trabajos) y uno por página, declarados en `routes`. `shell` es el catálogo de `meeko-docs`, cuyo `DocsAnnouncements` pinta la vista previa de los avisos. `tests/translations.test.ts` comprueba que los dos idiomas tienen las mismas claves.
- **Sin texto en el servidor.** Los fallos viajan como códigos (`errors.<CODE>`), los mensajes de los schemas son claves (`validation.*`, `issues.*`) y un trabajo devuelve `facts`, que la página dice en su idioma. La salida de los procesos es un log técnico en inglés. `app/utils/i18n.ts` comprueba con `i18n.has` la clave que llega de un dato: basta añadirla al catálogo, sin valores, y un código que el catálogo no explica recibe el mensaje genérico con el código.
- **Sesión.** Sin sesión, `/en/x` va a `/en/login?next=/en/x` y vuelve allí; la página de login fija el idioma de `next`. Cerrar sesión lleva al login del idioma de la página, por su `Referer`. La cookie de sesión, el `Origin` y el token CSRF no dependen del idioma; la del idioma es otra (`meeko-dashboard-locale`), y solo sirve para sugerir.
- **Contenido por idioma.** Las rutas de la base no llevan prefijo y el idioma va aparte. Una regla o un aviso se aplican a un idioma o, con `locale` nulo, a todos: el formulario preselecciona «Todos los idiomas» y la tabla muestra el alcance de cada uno. Las métricas filtran con `?lang=`.
- **Traducir desde aquí.** Una traducción que existe en `docs/en/**` se edita como cualquier fuente: borrador, vista previa con el render inglés, publicación y exportación a su archivo. «Marcar como traducida» escribe en `source-hash` el hash del original importado. Una página sin traducir no tiene fuente que editar: el detalle dice dónde crear el archivo y permite descargar el original; aparece aquí tras importar.
- **Publicar** sigue generando un único snapshot con los dos idiomas; la lista de snapshots muestra las páginas de cada uno.

## F2: edición del Markdown con revisiones

Solo se editan las guías y la referencia de `apps/meeko` (fuentes `guide` y `reference`). Las páginas `.meeko` de UI e i18n se cambian en el repositorio. Las ediciones viven en PostgreSQL como revisiones (`docs_revisions`) sobre el Markdown de Git; el servidor nunca escribe en `docs/`.

- **Editor.** «Editar» en el detalle abre un borrador nuevo a partir de la revisión publicada o, si no hay, del archivo de Git de ahora (su hash queda como base de la revisión). `?revision=N` edita ese borrador o parte de otra revisión. El estado dice cuántas líneas tienen cambios sin guardar. Salir con cambios pregunta antes: `beforeunload` al recargar o cerrar, y un plugin (`app/plugins/unsaved.client.ts`) en la navegación de la app.
- **Vista previa.** Es el render real de `meeko-docs-content/preview` para esa sola fuente, con el texto del borrador superpuesto en su propio contexto de fuentes. Se actualiza tras una pausa de 1,2 s al escribir, o con «Actualizar». Muestra como avisos lo que impediría publicar: frontmatter incompleto (`assertPublishable`), un render que fallaría (por ejemplo, un símbolo inexistente) y los enlaces o anclas rotos, con su línea.
- **Worker de vista previa.** `scripts/preview-worker.mjs` es un proceso hijo con Vite cargado una vez (unos 1-1,5 s por render). `server/dashboard/preview.ts` renderiza de una en una; la petición en espera la sustituye la más nueva. Mata el worker si un render pasa de 60 s, lo recicla al superar 1,5 GB de memoria residente o 40 renders, y lo para tras 5 min sin uso.
- **Revisiones.** Crear y guardar borrador (guardar de nuevo lo actualiza en su sitio y rechaza la escritura si alguien lo guardó entretanto), publicar y archivar con confirmación, comparar dos versiones (Git ahora o cualquier revisión) y exportar el `.md`, que descarga el navegador. Publicar una referencia con el frontmatter incompleto se rechaza y muestra el motivo; la publicada anterior sigue intacta. Una revisión archivada se puede volver a publicar: restaura su texto, recibe una fecha de publicación nueva y queda pendiente hasta el siguiente snapshot.
- **Pendientes de publicar.** Una revisión publicada después del snapshot activo aparece como «Sin snapshot» en el detalle y en Snapshots, hasta que se publique la documentación. Tras activar otro snapshot (un rollback o la vuelta al último), Snapshots vuelve a leer la lista sin recargar. Archivar la revisión publicada vuelve a mostrar Git en la próxima publicación, pero el indicador no lo cuenta porque el archivado no guarda fecha.

### Concurrencia

- **Publicar una revisión valida lo que publica.** `publishRevision` bloquea la fuente y después la revisión, que es el mismo orden de `archiveRevision`; `updateDraft` solo toma la revisión. Relee el Markdown bajo ese bloqueo y lo valida en la misma transacción. Un guardado que entra antes se valida, y uno que llega después espera y se rechaza porque ya no es un borrador.
- **Revisiones frente a snapshots, en todos los procesos.** `publishDocumentation` (los trabajos del dashboard y `docs:sync`) toma en exclusiva un lock consultivo de contenido de PostgreSQL (`lockKeys.content`, con el esquema como clave para que los esquemas temporales de las pruebas no se bloqueen entre sí) en una conexión propia, desde antes de leer las revisiones hasta que el snapshot se confirma. Publicar una revisión, o archivar la publicada, toma ese lock compartido sin esperar.
  - Si un render lo tiene, la acción falla con `busy`, que es `409 JOB_RUNNING` en el dashboard, y no cambia nada.
  - Si una acción está a medias, el render espera a que se confirme y la incluye.

  `assertNoContentJob` se mantiene como respuesta rápida dentro del dashboard. Si el proceso muere, PostgreSQL suelta el lock con la conexión.

- **Pendientes exactos.** `published_at` se escribe con `clock_timestamp()` bajo ese lock. Así, una revisión que lee un snapshot siempre es anterior a él y una publicada después siempre es posterior, y comparar fechas basta. No hace falta una migración que registre las revisiones de cada snapshot; sí la haría falta para contar como pendiente el archivado de la revisión publicada.
- **Conflicto con Git.** Una revisión cuyo hash base no es el de Git ahora está en conflicto. El detalle muestra los diffs base → Git, base → revisión y Git → revisión. La base se busca en la última importación, en el working tree y en los 100 últimos commits del archivo; una base que nunca llegó a un commit no se encuentra, y entonces solo se compara Git con la revisión. Si la fusión es trivial (cambios en líneas distintas y no contiguas), ofrece «Crear borrador: Git actual + mis cambios», escrito sobre el Git de ahora. Si no, solo informa.
- **Límites.** El Markdown enviado ocupa como mucho 900 kB medido como cadena JSON en UTF-8 (`encodedBytes`), con los escapes ya contados: el cuerpo de una RPC de Meeko es de 1 MiB y el JSON escapa saltos de línea, comillas, barras y caracteres de control (hasta 6 bytes por uno). Así, un texto que el editor y el schema aceptan siempre cabe en la petición. El paquete admite 1.000.000 de caracteres. Hoy el archivo más grande, `docs/framework.md`, ocupa 479 kB.

## F3: moderación y avisos

Una pestaña por web (`/moderation`, `?site=ui`, `?site=i18n`), con el número de reglas y de avisos en vigor. Los cambios se guardan en `docs_moderation` y `docs_announcements` y las tres webs los aplican en menos de 30 s, sin publicar un snapshot ni reiniciar: cada web los lee con `meeko-docs-content/moderation` y una caché de 30 s por proceso. El servidor del dashboard no puede invalidar la caché de otro proceso, por eso la pantalla lo avisa.

Cada regla y cada aviso tienen una versión (`004_moderation_versions.sql`) y cada escritura envía la que leyó la pantalla: guardar, activar o desactivar y borrar desde una pestaña antigua responde `409 MODERATION_CONFLICT` sin escribir nada (o `404 MODERATION_NOT_FOUND` si otra persona lo borró). Una regla se nombra por su página, y una borrada y creada de nuevo vuelve a la versión 1: por eso guardar una regla envía también su id (`id` y `version`, o ambos `null` para una página sin regla) y una regla recreada es otra regla y un conflicto. El formulario de reglas fija la regla que edita (id y versión) al elegir la página o pulsar «Cambiar»; una recarga de la lista por otra acción de la pestaña (activar un aviso, por ejemplo) no la mueve. La pantalla recarga la lista, lo explica y conserva lo escrito en el formulario; solo entonces renueva esa base, así que guardar otra vez sustituye el cambio ajeno a sabiendas. Limpiar el formulario también la renueva. Activar o desactivar usa su propia RPC (`moderation/announcements/active`), que solo cambia `active`: una fila antigua no puede devolver el mensaje o las fechas que otra pestaña corrigió.

- **Páginas.** Se elige una página conocida de la web: sus fuentes (`docs_sources`) y, en el site, también las del snapshot activo, como las páginas de la referencia generadas desde el JSDoc (agrupadas aparte). La regla es «Ocultar» o «Destacar», con un motivo opcional y firmada por el usuario de la sesión; hay una por página, así que guardar otra la sustituye y anota el autor y la fecha nuevos. Ocultar pide confirmación y explica el efecto (404 y fuera de la navegación; en el site también de la búsqueda, el sitemap y `llms.txt`); destacar se guarda sin preguntar. La portada (`/`) no se puede ocultar. «Quitar» pide confirmación y devuelve la página.
- **Avisos.** Mensaje (500 caracteres como mucho, con contador), tono (información, novedad, advertencia o incidencia; la incidencia usa `role="alert"` en las webs y las demás `role="status"`), inicio y fin opcionales en la hora local del navegador (se guardan como instantes), y activo. La vista previa pinta el componente real de las webs de UI e i18n (`DocsAnnouncements` de `meeko-docs`, con la prop `preview`), que comparte diseño con el banner del site, y dice cuándo se mostrará. La tabla da el estado (en vigor, programado, terminado o inactivo) y permite editar, activar o desactivar y borrar (con confirmación). Guardar un aviso lo firma el usuario de la sesión.
- **Validación.** En el cliente (página, longitudes y fechas, con los errores junto al formulario) y en el servidor: los schemas de `shared/schemas/moderation.ts` y las comprobaciones del paquete. Los rechazos son `422 INVALID_MODERATION` (con el motivo), `422 UNKNOWN_PAGE` (la web no tiene esa página) y `404 MODERATION_NOT_FOUND`.
- **Accesibilidad.** Las pestañas son enlaces con `aria-current`, el selector de página es un combobox con búsqueda, «Ocultar/Destacar» es un grupo de radios, los avisos de estado usan `role="status"` y, al borrar una fila, el foco pasa al encabezado de su sección.
- **Pruebas.** `tests/moderation.test.ts` (schemas, fechas y el servicio en un esquema temporal) y `tests/moderation.e2e.mjs` (Chrome: ocultar con confirmación, destacar, avisos con vista previa, validación, desactivar y borrar, 390 px sin scroll horizontal y 403 con un `Origin` ajeno en las cuatro RPC).

## F4: métricas y feedback

Las tres webs recogen vistas, búsquedas y respuestas a «¿Te sirvió?» en `docs_page_views`, `docs_searches` y `docs_feedback`, con `meeko-docs-content/metrics` (ver los README de cada web y del paquete). La pantalla **Métricas** las lee por web (`/metrics`, `?site=ui`, `?site=i18n`) y por rango de días UTC (`from` y `to` en la URL; 7, 30 o 90 días, o un rango propio de hasta un año con un formulario `GET` que funciona sin JavaScript):

- **Totales**: vistas, búsquedas (y cuántas sin resultados) y la proporción de «Sí».
- **Vistas por día**: columnas, una por día y también los días sin vistas, con un eje de valores redondos. Al pasar el puntero o recorrerlo con las flechas (el gráfico es enfocable) un tooltip da el día y las vistas; «Ver los valores como tabla» tiene todos los valores. Color de la marca validado con el validador de `dataviz` contra la superficie de cada tema (`#2f63d6` en claro, `#5b8cec` en oscuro).
- **Páginas más vistas**, **búsquedas más frecuentes** (con los resultados de la última vez) y **búsquedas sin resultados**, las 20 primeras.
- **«¿Te sirvió?» por página**: proporción de «Sí», respuestas y comentarios, primero las más respondidas.
- **Comentarios**: los de los lectores con su página, respuesta y fecha, 25 por página, filtrables por estado (pendientes, que es lo que se ve al entrar, revisados o todos), por respuesta y por ruta. «Marcar como revisado» y «Volver a pendiente» guardan `reviewed_at` (migración `003_metrics.sql`); «Borrar» pide confirmación y no se puede deshacer.

Estados: cada sección tiene su vacío; la página se atenúa mientras navega (`aria-busy`) y la lista de comentarios mientras recarga; un fallo de lectura es un `DashFailure` con su código (`422 INVALID_RANGE`, `404 FEEDBACK_NOT_FOUND` y los de la base). Un rango de la URL con días que no existen en el calendario (`2026-99-99`, `2026-02-30`), invertido o de más de un año se detecta antes de renderizar y es `INVALID_RANGE` sin consultar la base; la etiqueta del rango dice «Rango no válido». Tras revisar, reabrir o borrar un comentario, si la página actual queda fuera del nuevo total la lista pasa a la última que existe. RPC: `metrics/get`, `metrics/feedback/list` y, con `origin: 'required'`, `metrics/feedback/review` y `metrics/feedback/delete`. Pruebas: `tests/metrics.test.ts` (schemas y servicio en un esquema temporal) y `tests/metrics.e2e.mjs` (Chrome: totales, gráfico con puntero y teclado, tabla, rankings, filtros, revisar y borrar con confirmación, otra web vacía, rango inválido, 390 px y 403 con un `Origin` ajeno).

Privacidad: no hay cookies, IP, agente de usuario ni identificadores en las tablas; solo la ruta canónica, el día o el instante, la consulta normalizada, la respuesta y el comentario que escribe el lector. Las webs no guardan una consulta que parezca un dato personal o un secreto (email, teléfono, URL con credenciales, token, clave de API, JWT o una cadena de alta entropía), así que tampoco aparece en las búsquedas de esta pantalla.

## F5: autenticación

Una cuenta de administrador con las piezas de Meeko, sin Cloudflare Access: `verifyPassword` (scrypt) de `@meekojs/meeko/password`, `SqlSessionStore` sobre PostgreSQL, `rateLimit`, un middleware de ruta de servidor global y `auth: 'required'` en cada RPC. El dashboard no se publica sin ella: en producción no arranca si falta.

### La cuenta

1. Genera el hash. Pide la contraseña dos veces sin mostrarla y escribe en stdout solo la línea del hash:

   ```powershell
   pnpm -F meeko-dashboard exec meeko auth hash
   ```

2. Guárdala junto al usuario en `apps/dashboard/.env` (desarrollo, no versionado) o en los secretos del despliegue (Coolify): `ADMIN_USERNAME=…` y `ADMIN_PASSWORD_HASH=scrypt$131072$8$1$…`. **Nunca** escribas credenciales ni hashes reales en archivos versionados; `.env.example` solo lleva el formato.
3. El hash contiene `$`. Si el gestor de variables interpola (`$131072` se queda vacío), guárdalo como literal o escapa cada `$`; un valor que no tiene el formato de `meeko auth hash` detiene el arranque con un mensaje que lo dice, en lugar de dejar un login que nunca acepta la contraseña.

Para cambiar la contraseña, genera otro hash y reinicia. Las sesiones abiertas siguen hasta que caducan o cierran sesión.

### Variables

| Variable                     | Por defecto | Qué hace                                                                                                                    |
| ---------------------------- | ----------- | --------------------------------------------------------------------------------------------------------------------------- |
| `ADMIN_USERNAME`             | —           | El usuario. Es también el autor de lo que cambia (revisiones, moderación, avisos, publicaciones y revisión de comentarios). |
| `ADMIN_PASSWORD_HASH`        | —           | El hash de `meeko auth hash`.                                                                                               |
| `DASHBOARD_SESSION_TTL`      | `12h`       | Duración máxima de una sesión desde que se inicia (`30m`, `12h`, `7d`…).                                                    |
| `DASHBOARD_SESSION_IDLE`     | `30m`       | Una sesión sin peticiones durante este tiempo termina, aunque no haya caducado.                                             |
| `DASHBOARD_SESSION_SAMESITE` | `Strict`    | `SameSite` de la cookie: `Strict` o `Lax`.                                                                                  |
| `DASHBOARD_LOGIN_IP_LIMIT`   | `20`        | Intentos de inicio de sesión por IP de cliente y ventana.                                                                   |
| `DASHBOARD_LOGIN_USER_LIMIT` | `5`         | Intentos por nombre de usuario y ventana, exista o no la cuenta.                                                            |
| `DASHBOARD_LOGIN_WINDOW`     | `15m`       | La ventana fija de los dos límites.                                                                                         |
| `MEEKO_PUBLIC_ORIGIN`        | —           | En producción, el origen público exacto (`https://dashboard.meekojs.com`), con el que Meeko compara `Origin`.               |
| `MEEKO_TRUST_PROXY`          | —           | `1` detrás de Traefik (Coolify) y el túnel, para que el límite por IP cuente la del visitante y no la del proxy.            |
| `DASHBOARD_ALLOWED_HOSTS`    | —           | `dashboard.meekojs.com`, para que el control de `Host` lo acepte.                                                           |

Un valor no válido (una duración, un límite, un `SameSite` o el hash) detiene el arranque.

### Cómo funciona

- **Inicio de sesión** (`/login`, `app/pages/login.meeko`). Un formulario `POST` a `/api/auth/login` (`server/api/auth/login.post.ts`) que funciona también sin JavaScript (`form` de `defineApiRoute`): con JavaScript envía JSON y carga la página de destino; sin él, el servidor responde `303` a esa página o vuelve a `/login` con el error, que `useForm` pinta en el SSR. Solo devuelve el usuario, nunca la contraseña.
- **Error genérico y tiempo constante.** Un usuario o una contraseña incorrectos responden lo mismo (`401 INVALID_CREDENTIALS`, «El usuario o la contraseña no son correctos.»). `verifyPassword` se ejecuta siempre, el usuario se compara en tiempo constante y cualquier fallo tarda al menos 1 s (`withConstantFailure`).
- **Límites.** Por IP, `rateLimit` de la ruta, que Meeko cuenta antes de leer el cuerpo (también en el formulario nativo) y responde `429` con `Retry-After`. Por usuario, `SessionManager.rateLimit` en el handler, para cualquier nombre (no revela qué cuentas existen). Los contadores viven en `dashboard_rate_limits` (resúmenes SHA-256, nunca la IP ni el nombre), compartidos entre instancias.
- **Sesión** (`server/dashboard/sessions.ts`). `SqlSessionStore` con el driver `dashboardSessionDriver` de `meeko-docs-content/db`, sobre `dashboard_sessions` de la misma base (`meeko_site_dev` en desarrollo). Iniciar sesión crea un ID y un token CSRF nuevos (si el navegador ya tenía una sesión, se sustituye de forma atómica: el ID anterior deja de valer). La cookie es opaca, `HttpOnly`, host-only y con el `SameSite` configurado; en producción, `__Host-meeko-dashboard.sid` con `Secure` (en `meeko dev` sobre `http://127.0.0.1`, `meeko-dashboard.sid` sin `Secure`). Caduca a las `DASHBOARD_SESSION_TTL` del inicio y, como `SessionManager` no tiene límite de inactividad, el driver lo aplica: cada lectura actualiza `last_seen_at` y una sesión inactiva más de `DASHBOARD_SESSION_IDLE` se lee como inexistente y se borra. Cada 10 minutos se borran las sesiones caducadas y las ventanas de límite terminadas. Sin `DATABASE_URL` (solo en desarrollo) las sesiones viven en memoria.
- **Todo protegido.** `app/middleware/10-auth.server.ts`, global y solo de servidor, redirige cualquier página sin sesión a `/login?next=<ruta>` antes de su `<script server>`, también en la petición de datos de una navegación. `next` solo admite rutas internas que empiezan por una sola `/` (`safeNext`): `//otra.web`, `/\otra.web`, esquemas y caracteres de control van a `/`, así que no hay _open redirect_. Con sesión, `/login` lleva directamente a `next`. El middleware de ruta no protege la API ni las RPC, así que cada RPC declara `auth: 'required'` (`401 UNAUTHENTICATED` sin sesión) y `/api/auth/logout` también; `tests/auth.test.ts` recorre el manifiesto de páginas, RPC y API y falla si una ruta nueva queda abierta.
- **Cierre de sesión.** El botón «Cerrar sesión» de la cabecera es un formulario `POST` a `/api/auth/logout` con el token CSRF en `_csrf`: borra la familia de la sesión en PostgreSQL, vacía la cookie y vuelve a `/login`.
- **Autor real.** Las RPC que firman (`revisions/save`, `revisions/merge`, `moderation/rules/save`, `moderation/announcements/save`, `jobs/start` al publicar y `metrics/feedback/review`) toman el autor del usuario de la sesión (`sessionUser`), no de lo que envía la pantalla: los schemas ya no tienen `author` ni `publishedBy`, y un valor enviado se descarta. La migración 005 añade `docs_feedback.reviewed_by`, que Métricas muestra como «Revisado … por …». `DASHBOARD_AUTHOR` y la firma recordada en `localStorage` desaparecen.

### Escucha y producción

- **Desarrollo** (`meeko dev`): `127.0.0.1:4310`, como antes.
- **Producción** (build con `NODE_ENV=production`, `meeko start`): `meeko.config.ts` escucha en `0.0.0.0`, para ir detrás de Coolify/Traefik y del túnel. `server/runtime.ts` **se niega a arrancar** en producción sin `ADMIN_USERNAME`, `ADMIN_PASSWORD_HASH` o `DATABASE_URL` (`assertProductionAuth`), así que un dashboard sin login nunca queda expuesto. El prerender del build no lo exige. `MEEKO_HOST` sustituye la dirección en los dos casos.
- Para publicarlo: las variables de la tabla en los secretos de Coolify, `MEEKO_PUBLIC_ORIGIN=https://dashboard.meekojs.com`, `MEEKO_TRUST_PROXY=1`, `DASHBOARD_ALLOWED_HOSTS=dashboard.meekojs.com` y la base con la migración 005 aplicada (`migrate` de `meeko-docs-content/db`).

### Base de datos

`packages/docs-content/migrations/005_dashboard_auth.sql` es aditiva: crea `dashboard_sessions` (el esquema de `SqlSessionStore` más `last_seen_at`) y `dashboard_rate_limits` (`UNLOGGED`), y añade la columna opcional `docs_feedback.reviewed_by`. Se aplica con las demás migraciones del paquete.

### Pruebas

- `tests/auth.test.ts`: las reglas (duraciones, `safeNext`, rechazo de producción, cookie, tiempo constante) y, con `DATABASE_URL`, el `meeko dev` real en un esquema temporal con una cuenta de prueba que solo existe en su entorno: todas las páginas, RPC y API sin sesión; usuario y contraseña incorrectos con el mismo error y tiempo; inicio correcto con la sesión en PostgreSQL; rotación; CSRF y `Origin`; cierre con JSON y con el formulario nativo; inactividad; caducidad; límites por usuario y por IP.
- `tests/auth.e2e.mjs`: Chrome. Una página sin sesión lleva al login y vuelve a ella; error genérico; navegación con la sesión; cierre; 390 px; y el mismo recorrido sin JavaScript. Los demás e2e inician sesión con su propia cuenta de prueba (`tests/fixtures/auth.mjs`).
- `packages/docs-content/tests/sessions.test.ts`: el driver con `SqlSessionStore` y `SessionManager` (rotación, familia, inactividad, caducidad y contadores atómicos).

## Fases

| Fase | Alcance                                                                         |
| ---- | ------------------------------------------------------------------------------- |
| F1   | Supervisión, importación, publicación y rollback. Sin edición ni autenticación. |
| F2   | Edición del Markdown de site con revisiones en PostgreSQL (hecho).              |
| F3   | Moderación de páginas y avisos (hecho).                                         |
| F4   | Métricas y feedback (hecho).                                                    |
| F5   | Login de administrador, sesiones en PostgreSQL y autor real (hecho).            |
| i18n | Interfaz bilingüe y gestión de traducciones, moderación y métricas por idioma.  |
