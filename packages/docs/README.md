# Base documental privada

`meeko-docs` es un módulo de workspace **privado**, compartido por `apps/ui`, `apps/i18n` y `apps/meeko`. No se publica ni forma parte de la instalación de UI o i18n en aplicaciones consumidoras.

- `src/module.ts` registra los componentes `Docs*` y `docs.css`.
- `src/app/components/Docs/` contiene el Shell, su adaptador, la navegación, la página, los bloques de código y la tabla de API, todos sobre `@meekojs/ui`.
- `src/runtime/shell.ts` declara `DocsShellView`, el contrato del Shell (`meeko-docs/shell`).
- `src/app/styles/docs.css` sólo dispone las demos de las guías con tokens `--ui-*`. **Esta base no tiene diseño propio:** ni paleta, ni fuentes, ni tema. Los colores, tamaños y fuentes salen de [`packages/ui`](../ui/DESIGN.md), que también sirve Inter.
- `assets/` contiene el logo derivado de la marca.
- `scripts/assets.mjs` copia esos recursos al `public/` de la aplicación que lo ejecuta.
- `scripts/build.mjs` genera declaraciones adyacentes de los componentes externos mediante la CLI de Meeko y el rebase común del monorepo. Las declaraciones se ignoran y se actualizan sólo si cambia su contenido.

`pnpm build` lo prepara después del núcleo y UI. Las aplicaciones también ejecutan su preparación antes de `dev`, `build` y `check`. `meeko.config.ts` del paquete describe las dependencias de sus plantillas durante esa generación.

**Shell.** `DocsShell` pinta `UIPage`, `UIHeader`, `UIFooter`, `UIDrawer`, `UINavigationTree`, `UITableOfContents`, `UIPageNavigation`, `UILocaleSwitcher` y `UILocaleSuggestion`. Recibe una sola prop, `view` (`DocsShellView`), con todo ya resuelto: **no lee la base de datos, ni la moderación, ni las rutas**, y sirve igual a una web de páginas `.meeko` y a un snapshot.

```html
<DocsShell
	bind:view="view.value"
	on:queryChange="(text) => (query.value = text)"
	on:dismissAnnouncement="dismiss"
	on:stayLocale="stay"
>
	<UIProse
		as="article"
		bind:html="page.html"
	/>
</DocsShell>
```

| Parte     | Qué es                                                                                                                                                                                                                                                                                    |
| --------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Snippets  | `default` (el artículo, dentro del único `<main>`), `after` (tras el artículo, sin su `lang`), `aside` (bajo el índice), `headerActions` y `searchResults` (en la cabecera, con `search.mode: 'dialog'`), y `footer` (sustituye al pie).                                                  |
| Eventos   | `queryChange` (el filtro, con `search.mode: 'filter'`), `dismissAnnouncement` (el `id`; el estado y la cookie son de la web) y `stayLocale`.                                                                                                                                              |
| `toc`     | Índice en la columna lateral y plegable en pantallas estrechas; sin él, no hay columna.                                                                                                                                                                                                   |
| `pager`   | `UIPageNavigation`, tras el artículo.                                                                                                                                                                                                                                                     |
| `edit`    | Enlace para editar la página, con la ruta de su fuente.                                                                                                                                                                                                                                   |
| `locale`  | `fallback` marca el artículo con el `lang` de `content`, no los textos del Shell, y, con `originalHref`, muestra la nota «sin traducir»; `outdated`, con `originalHref`, avisa de una traducción anterior a su original. `suggested` muestra la sugerencia, que se calcula tras hidratar. |
| `layout`  | `docs` por defecto; `landing` deja el ancho a cada sección. Sin grupos en `navigation` ni filtro, no hay barra lateral ni cajón.                                                                                                                                                          |
| `product` | `brandName` y `logo` sustituyen a la marca de un paquete; `linksLabel` nombra los enlaces de la cabecera.                                                                                                                                                                                 |

`DocsSiteShell` es el adaptador de una web de páginas `.meeko` (UI e i18n): recibe nombre, paquete, repositorio y navegación, y construye la vista con la moderación, el idioma y las métricas; su snippet `default` aloja el outlet. `DocsPage` admite `product` para el sufijo del título, con `Meeko UI` por defecto, y pinta `UIPageHeader`, `UIProse` y `DocsFeedback` sin un `<main>` propio. `DocsCode` y `DocsApi` son `UICodeBlock` y `UITable` con los textos del catálogo `shell`. `DocsAnnouncements` recibe `items` y emite `dismiss`, y el dashboard lo usa como vista previa.

Al cambiar esta base, comprueba ambas aplicaciones y los E2E de UI y de i18n. Los ejemplos del módulo i18n pertenecen a su aplicación, no a esta base compartida.

`meeko-docs/server` proporciona el runtime para estas webs públicas, que no crean cuentas ni sesiones persistentes. Su manager usa memoria sin cambiar el modo de producción del resto del runtime. Una aplicación que añada sesiones persistentes debe proporcionar su propio runtime y store.

**Idiomas.** Los componentes `Docs*` no llevan textos propios: usan `useI18n()` de `@meekojs/i18n`, así que **toda aplicación que los pinte debe registrar ese módulo y el catálogo del Shell**. Los catálogos viven en `locales/es/shell.json` y `locales/en/shell.json`, en el namespace `shell`. **Todas sus claves empiezan por `shell.`** (`shell.nav.menu`, `shell.feedback.title`…) y ningún componente de este paquete usa claves fuera de ese prefijo. Se pueden añadir claves, pero no renombrarlas sin avisar a las aplicaciones consumidoras (`apps/ui`, `apps/i18n`, `apps/meeko` y `apps/dashboard`). Sin el catálogo, `t()` muestra la clave y avisa una vez en la consola (`[meeko:i18n] Missing message`).

```ts
// meeko.config.ts de la aplicación
i18n: {
	defaultLocale: 'es',
	catalogs: {
		es: { common: 'app/locales/es/common.json', shell: 'node_modules/meeko-docs/locales/es/shell.json' },
		en: { common: 'app/locales/en/common.json', shell: 'node_modules/meeko-docs/locales/en/shell.json' },
	},
	// El Shell se pinta en todas las rutas, también en la de error.
	global: ['shell'],
}
```

- **Idioma del Shell.** `shell.meta.lang` dice en qué idioma está escrito el catálogo y es el `lang` de su marcado. Un idioma de demostración sin traducción de la interfaz, como el árabe de `apps/i18n`, declara el catálogo español: el Shell sigue en español y LTR, y sus enlaces apuntan a las páginas de ese idioma, de modo que un idioma `partial` nunca enlaza a páginas que no tiene.
- **Selector y sugerencia.** `DocsSiteShell` calcula los enlaces del selector (`switchLocalePath`, `pageLocales`), que conservan la página, la búsqueda y el fragmento. Tras hidratar, sugiere el idioma de la cookie o del navegador en un aviso flotante, que no desplaza el contenido, nunca redirige y se descarta recordando el idioma actual.
- **Prosa de las páginas.** `DocsPage` recibe `locale`, el idioma en el que está escrita la prosa; sin ella, es el idioma por defecto. Una página traducida vive en `app/pages/en/` y declara `locale="en"`. Una página en español servida bajo `/en/…` marca su contenido con `lang="es"` y muestra el aviso «sin traducir» con un enlace al original (`hreflang`), mientras los textos del Shell siguen en inglés con su propio `lang`.
- **`UIThemeToggle`.** `@meekojs/ui` trae sus textos por idioma (`ui.locale`, `ui.messages`); el Shell no le pasa `labels` ni `messages`, y el catálogo `shell` ya no tiene claves `shell.theme.*`.
- **Navegación.** `DocsSiteShell` recibe los `href` sin prefijo y los localiza; `DocsShell` los recibe ya localizados. `app/utils/navigation.ts` conserva `title`, `label` y `description` en español como literales, porque `meeko-docs-content` los lee de su sintaxis al importar las fuentes, y añade un objeto `en` con los textos ingleses.

**Moderación.** Con `modules: ['meeko-docs']` y `docs: { site: 'ui' }` (o `'i18n'`) en `meeko.config.ts`, el módulo añade un plugin de servidor que lee la moderación del dashboard con `meeko-docs-content/moderation`, en el idioma de la URL (`/en/…` es inglés; las reglas de ese idioma y las globales), y la publica para la petición. `DocsSiteShell` la fija con `useDocsModeration()` (`meeko-docs/state`), un `useState` que viaja al navegador y que, tras cada navegación confirmada, se vuelve a pedir a `/_meeko-docs/moderation/<web>` (`/<web>/en` en inglés) (un handler del módulo, sin caché; `refreshOnNavigation`), porque el estado de clave fija no se renueva al navegar: filtra las páginas ocultas de la navegación, marca las destacadas con «Destacado» y pinta los avisos (`DocsAnnouncements`, que recibe `items`, también en la vista previa del dashboard). El 404 de una página oculta lo da el middleware de ruta de servidor de cada web con `isModeratedOut` de `meeko-docs/moderation`, porque los módulos no añaden middleware de ruta. Sin `site`, o sin base de datos, todo queda vacío.

**Sitemap.** Con `site`, el módulo también sirve `/sitemap.xml` (`src/runtime/sitemap.ts`) con `sitemapXml` y la moderación vigente de cada idioma: una página oculta sale de la lista y de las alternativas de las demás, y un idioma sin reglas propias, como `/ar/playground`, sigue a la página española. Se calcula en cada petición y se revalida (caché de 30 s de la moderación), así que no necesita otro build; sin base de datos no oculta nada, como las páginas. Las URL son las rutas sin parámetros del manifiesto y el origen sale de `site`. `sitemap: true` en la web es un error, porque su archivo estático se serviría antes que el handler.

**Métricas.** Con `site`, el módulo añade también `src/metrics/plugin.ts`, un plugin de los dos lados: en el servidor decide si las métricas están activas (`DATABASE_URL` y sin `DOCS_METRICS=off`), lo publica para `useDocsMetrics()` (`meeko-docs/metrics`) y en el `<meta name="meeko-docs-metrics">`; en el navegador envía un beacon a `/api/docs/views` por cada ruta confirmada (la primera y las de la navegación del cliente; nunca un cambio de hash). `DocsPage` termina con `DocsFeedback` («¿Te sirvió?», salvo en `landing`), que funciona también sin JavaScript con un formulario `POST` a `/api/docs/feedback`, y el filtro de `DocsSiteShell` registra la búsqueda en `/api/docs/search` tras 1,5 s sin escribir, salvo que parezca un dato personal o un secreto (`storedQuery`), que no se envía. Como un módulo no puede añadir rutas de API, cada web declara esas tres en `server/api/docs/*.post.ts` con los handlers y schemas de `meeko-docs/metrics/server`, con `localized: true` para que `/en/…` cuente como inglés sin el prefijo (`navigationPaths(site, navigation)` limita las rutas a las de su navegación, con sus alias, y salta las ocultas en ese idioma; compara rutas, alias y destinos como los lee el router, así que `/%62uttons` o `//buttons` cuentan como su página canónica). El site registra el módulo sin `site`, sólo por sus componentes, e importa el plugin (`meeko-docs/metrics/plugin`): su moderación y su sitemap salen del snapshot.
