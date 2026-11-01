# Web pública de Meeko i18n

Documentación de `@meekojs/i18n`, construida con Meeko, el módulo i18n real y Meeko UI. Comparte la identidad y la base documental privada `meeko-docs` con `apps/ui`. Funciona sin base de datos; con `DATABASE_URL`, aplica la moderación y los avisos del dashboard.

## Desarrollo

Desde la raíz del monorepo, con Node.js 24+ y pnpm 12:

```powershell
pnpm install
pnpm build
pnpm i18n:dev
```

El servidor imprime la URL disponible. Para generar y servir el build Node:

```powershell
pnpm i18n:build
pnpm -F meeko-i18n-site start
```

El build genera `.meeko/output/node`. Estos comandos preparan y sirven el sitio; no lo despliegan automáticamente. El dominio y el adaptador se configuran mediante `meeko.config.ts`.

## Moderación y avisos del dashboard

`apps/dashboard` puede ocultar o destacar páginas de esta web y publicar avisos en su cabecera (pantalla «Moderación»). La web los lee de la base de documentación compartida con el site, mediante `meeko-docs-content/moderation`:

- **Variable.** `DATABASE_URL` en `apps/i18n/.env`, ignorado por Git; `.env.example` la describe. En desarrollo es la base `meeko_site_dev` de `voidcat-local:5432`: copia solo esa línea de `apps/meeko/.env`.
- **Opcional.** Sin `DATABASE_URL`, o si la base no responde (3 s como mucho por intento, con un reintento cada 10 s), la web funciona igual, sin moderación ni avisos, y registra una sola línea `[docs-moderation]` en la consola del servidor. Nunca responde 500 por ello.
- **Cómo se aplica.** `meeko.config.ts` registra el módulo con `modules: ['meeko-docs']` y `docs: { site: 'i18n' }`: su plugin de servidor lee la moderación (caché de 30 s por proceso) y el Shell la recibe en el estado de la página, así que el navegador hidrata lo mismo que pintó el servidor; tras cada navegación en el navegador la vuelve a pedir (`/_meeko-docs/moderation/i18n`), así que reglas y avisos nuevos llegan sin recargar. Una URL equivalente (`/%70layground`, `/en//playground`, con barra final o query) también responde 404. Una página oculta responde 404, también al navegar en el navegador (`app/middleware/moderation.server.ts`, que también cubre sus alias localizados como `/en/playground`), y sale de la navegación; una destacada lleva la insignia «Destacado» en la navegación. Los avisos se pintan en SSR bajo la cabecera, con `role="status"` (o `alert` si son una incidencia); el lector puede cerrarlos y la cookie `meeko-docs-notices` lo recuerda.

## Métricas y «¿Te sirvió?»

Con `DATABASE_URL`, la web cuenta vistas, registra las búsquedas del filtro de la guía y recoge el «¿Te sirvió?» de cada página (salvo la portada) en la base compartida; el dashboard las muestra en «Métricas». Las escribe `meeko-docs-content/metrics` desde tres rutas de esta app, `server/api/docs/{views,search,feedback}.post.ts`, porque un módulo no puede añadir rutas de API:

- **Vistas.** El plugin del módulo (`meeko-docs/metrics/plugin`) envía un beacon por cada página que llega a mostrarse, también al navegar en el navegador. Solo cuentan las páginas de `app/utils/navigation.ts` que no están ocultas, y los alias localizados del laboratorio (`/en/playground`) cuentan como `/playground`; los bots evidentes y los prefetch se descartan. Suma uno a la página y al día UTC.
- **Búsquedas.** El filtro de la barra lateral guarda la consulta normalizada y cuántas páginas encontró cuando dejas de escribir 1,5 s, una vez por consulta; nunca por pulsación.
- **Rutas.** Una vista o una respuesta cuenta para la página de la navegación a la que llega el router: una ruta con un segmento codificado o barras repetidas, o un alias escrito así (`/en//playground`), cuenta como su página canónica.
- **«¿Te sirvió?».** `DocsFeedback` al final de `DocsPage`: «Sí» o «No» y un comentario opcional de hasta 2000 caracteres, por JSON o, sin JavaScript, con un formulario que vuelve a la página (`303`).
- **Seguridad y límites.** `defineApiRoute` con Valibot: `Origin` de la web obligatorio (Meeko 1.8) y `rateLimit` por cliente (120 vistas y 30 búsquedas por minuto, 10 respuestas cada 10 minutos), contados en memoria por instancia.
- **Privacidad.** Ni cookies de seguimiento, ni IP, ni agente de usuario, ni identificadores en la base. Una consulta que parece un dato personal o un secreto pegado por error (un email, un teléfono o un número de tarjeta, una URL con credenciales o con un token en su query, un `Bearer`/`Basic`, una clave de API, un JWT, una clave privada o cualquier cadena larga de alta entropía) no se guarda: el servidor la descarta antes de truncarla, de buscar con ella y de escribirla, sin dejarla en ningún log, y el navegador ni siquiera la envía.
- **Sin base o con la base caída.** No se guarda nada y la página no cambia; el servidor registra una línea `[docs-metrics]`. Sin `DATABASE_URL`, el widget no aparece.
- **Desactivarlas.** `DOCS_METRICS=off`.

`tests/metrics.e2e.mjs` arranca `meeko dev` tres veces: con una base que no responde (páginas en 200, widget con y sin JavaScript y un solo log sin la contraseña), con `DOCS_METRICS=off` (ni beacons ni widget) y, con `DATABASE_URL`, contra un esquema temporal donde comprueba vistas, alias, el filtro y el «¿Te sirvió?».

## Contenido

- `app/pages/`: instalación, mensajes, plurales, formatos, rutas, namespaces, RTL, API y validación.
- `app/components/TranslationLab.meeko`: laboratorio con señales e instancia real de `useI18n`.
- `app/locales/{es,en,ar}/`: catálogos `common` y `checkout`. `checkout` sólo se solicita en `/namespaces`.
- `app/utils/`: catálogo de navegación y ejemplos copiables.
- `packages/docs/`: shell compartido, componentes documentales, tokens, tipografía y logo. Los scripts preparan sus declaraciones y copian los recursos a `public/`, ignorado por Git.

El laboratorio está en `/playground` y `/{es,en,ar}/playground`. Las rutas localizadas validan el idioma en servidor; el módulo no genera esas rutas automáticamente. `switchLocale` realiza una navegación completa y conserva query/hash. Los controles locales se restablecen al cambiar de documento.

La documentación se mantiene en español y dirección LTR. El plugin publica `lang`/`dir` del idioma activo en el documento; el shell declara explícitamente español/LTR y el bloque traducido declara su propio idioma y dirección.

## Validación

```powershell
pnpm -F meeko-i18n-site check
pnpm -F meeko-i18n-site build
pnpm -F meeko-i18n-site test:e2e
```

El E2E arranca el build de producción en un puerto libre y verifica las guías, copia de código, interpolación, plurales, selectores, formatos, navegación entre idiomas, namespace diferido, RTL, menú móvil, 404 y lectura sin JavaScript. Requiere Chrome o `MEEKO_CHROME_PATH` apuntando a Chromium. Capturas y logs quedan bajo `.meeko/`.

`tests/moderation.e2e.mjs` arranca `meeko dev` dos veces: con una base que no responde (todas las páginas en 200, la navegación completa, sin avisos y un solo log) y, con `DATABASE_URL`, contra un esquema temporal con una regla `hide` (`/playground` y sus alias en 404), una `feature` y un aviso, que borra al terminar:

```powershell
node --test tests/moderation.e2e.mjs
```
