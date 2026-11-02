# Web pública de Meeko UI

Aplicación de documentación de `@meekojs/ui`, construida con Meeko y el propio módulo UI. Conserva la identidad visual del sitio principal, incluidos los temas claro y oscuro, la tipografía Inter y los tokens semánticos. Funciona sin base de datos; con `DATABASE_URL`, aplica la moderación y los avisos del dashboard.

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

## Moderación y avisos del dashboard

`apps/dashboard` puede ocultar o destacar páginas de esta web y publicar avisos en su cabecera (pantalla «Moderación»). La web los lee de la base de documentación compartida con el site, mediante `meeko-docs-content/moderation`:

- **Variable.** `DATABASE_URL` en `apps/ui/.env`, ignorado por Git; `.env.example` la describe. En desarrollo es la base `meeko_site_dev` de `voidcat-local:5432`: copia solo esa línea de `apps/meeko/.env`.
- **Opcional.** Sin `DATABASE_URL`, o si la base no responde (3 s como mucho por intento, con un reintento cada 10 s), la web funciona igual, sin moderación ni avisos, y registra una sola línea `[docs-moderation]` en la consola del servidor. Nunca responde 500 por ello.
- **Cómo se aplica.** `meeko.config.ts` registra el módulo con `modules: ['meeko-docs']` y `docs: { site: 'ui' }`: su plugin de servidor lee la moderación (caché de 30 s por proceso) y el Shell la recibe en el estado de la página, así que el navegador hidrata lo mismo que pintó el servidor; tras cada navegación en el navegador la vuelve a pedir (`/_meeko-docs/moderation/ui`), así que reglas y avisos nuevos llegan sin recargar. Una URL equivalente (`/%62uttons`, `//buttons`, con barra final o query) también responde 404. Una página oculta responde 404, también al navegar en el navegador (`app/middleware/moderation.server.ts`), y sale de la navegación; una destacada lleva la insignia «Destacado» en la navegación y en el índice de componentes (`/components`). Los avisos se pintan en SSR bajo la cabecera, con `role="status"` (o `alert` si son una incidencia); el lector puede cerrarlos y la cookie `meeko-docs-notices` lo recuerda.

## Métricas y «¿Te sirvió?»

Con `DATABASE_URL`, la web cuenta vistas, registra las búsquedas del filtro de la guía y recoge el «¿Te sirvió?» de cada página (salvo la portada) en la base compartida; el dashboard las muestra en «Métricas». Las escribe `meeko-docs-content/metrics` desde tres rutas de esta app, `server/api/docs/{views,search,feedback}.post.ts`, porque un módulo no puede añadir rutas de API:

- **Vistas.** El plugin del módulo (`meeko-docs/metrics/plugin`) envía un beacon por cada página que llega a mostrarse, también al navegar en el navegador. Solo cuentan las páginas de `app/utils/navigation.ts` (un alias cuenta como su página) que no están ocultas; los bots evidentes y los prefetch se descartan. Suma uno a la página y al día UTC.
- **Búsquedas.** El filtro de la barra lateral guarda la consulta normalizada y cuántas páginas encontró cuando dejas de escribir 1,5 s, una vez por consulta; nunca por pulsación.
- **Rutas.** Una vista o una respuesta cuenta para la página de la navegación a la que llega el router: una ruta con un segmento codificado o barras repetidas, o un alias escrito así (`/en//playground`), cuenta como su página canónica.

**Idioma compartido.** La cookie `meeko-locale` se declara con `domain: 'meekojs.com'` (`i18n.cookie` en `meeko.config.ts`), igual que en `apps/meeko`: el idioma elegido en uno de los tres sitios viaja a los otros dos. En `localhost` queda solo en ese host.

- **«¿Te sirvió?».** `DocsFeedback` al final de `DocsPage`: «Sí» o «No» y un comentario opcional de hasta 2000 caracteres, por JSON o, sin JavaScript, con un formulario que vuelve a la página (`303`).
- **Seguridad y límites.** `defineApiRoute` con Valibot: `Origin` de la web obligatorio (Meeko 1.8) y `rateLimit` por cliente (120 vistas y 30 búsquedas por minuto, 10 respuestas cada 10 minutos), contados en memoria por instancia.
- **Privacidad.** Ni cookies de seguimiento, ni IP, ni agente de usuario, ni identificadores en la base. Una consulta que parece un dato personal o un secreto pegado por error (un email, un teléfono o un número de tarjeta, una URL con credenciales o con un token en su query, un `Bearer`/`Basic`, una clave de API, un JWT, una clave privada o cualquier cadena larga de alta entropía) no se guarda: el servidor la descarta antes de truncarla, de buscar con ella y de escribirla, sin dejarla en ningún log, y el navegador ni siquiera la envía.
- **Sin base o con la base caída.** No se guarda nada y la página no cambia; el servidor registra una línea `[docs-metrics]`. Sin `DATABASE_URL`, el widget no aparece.
- **Desactivarlas.** `DOCS_METRICS=off`.

## Organización

- `app/pages/`: portada, instalación, temas, índice y guías de componentes, en español y, en `app/pages/en/`, en inglés. Cada componente de `packages/ui` tiene su guía; varios comparten una por familia (`/controls`, `/feedback`, `/content`, `/page`, `/navigation`, `/overlays`, `/editor`).
- `packages/docs/`: módulo privado compartido con i18n: shell, navegación, página documental, bloques de código copiables y tablas de API. Las declaraciones de sus componentes se preparan antes de dev, build y check.
- `app/utils/navigation.ts`: catálogo de navegación y filtro local por nombre o descripción; no es búsqueda de texto completo.
- `app/utils/examples.ts`: código copiable de las guías.
- `app/styles/main.css`: sólo la coreografía de la demo de View Transitions, un efecto. Todo lo demás viene de `packages/ui`, y la disposición de las demos, de `packages/docs/src/app/styles/docs.css`.
- `public/`: logo copiado desde `packages/docs/assets` por los scripts de dev/build; se ignora en Git. La fuente la sirve el módulo de UI.

Cada guía debe explicar el contrato real, mostrar un ejemplo interactivo, incluir código copiable y documentar props, snippets y eventos relevantes. Mantén los ejemplos sincronizados con `packages/ui/src/app` y actualiza el catálogo al añadir una ruta. Las comprobaciones de tipos validan los componentes vivos; las pruebas de navegador de UI cubren navegación, formularios, modales, tablas, temas y View Transitions.

```powershell
node --test --test-concurrency=1 packages/ui/tests/*.e2e.mjs
```

El sitio se migró de `apps/ui-demo` a `apps/ui`; el nombre del paquete de workspace es `meeko-ui-site`.
