import type { ElementAttributes, TrustedHtml } from '@meekojs/meeko'

import type { UIRouteTarget } from './button'
import type { UIContainerSize } from './container'

/** `href` o `to`, excluyentes. */
type UILinkDestination = { readonly href: string; readonly to?: undefined; readonly params?: undefined; readonly search?: undefined; readonly resolve?: undefined; readonly match?: undefined } | (UIRouteTarget & { readonly href?: undefined; readonly resolve?: boolean; readonly match?: 'exact' | 'prefix' })

/**
 * Destino de un enlace dentro de una lista (`items`, `groups`…): `href` para cualquier URL o `to`
 * para una ruta de la aplicación, con `params` y `search` tipados, que navega con `<MeekoLink>` y
 * pasa por los resolvedores de enlaces, así que con `@meekojs/i18n` apunta al idioma del documento o
 * al de `hreflang`. Los dos a la vez son un error de tipos. Con `to`, `aria-current` lo decide la ruta
 * activa y sigue a la navegación del cliente; `match: 'prefix'` marca también sus rutas hijas.
 *
 * @since 0.2.0
 * @example
 * ```ts
 * const guide: UILinkTarget = { to: '/docs/[slug]', params: { slug: 'inicio' } }
 * const repository: UILinkTarget = { href: 'https://github.com/meekojs/meeko', target: '_blank' }
 * ```
 */
export type UILinkTarget = UILinkDestination & {
	/** Dónde se abre el enlace. Con `"_blank"` y sin `rel`, añade `rel="noopener noreferrer"`. */
	readonly target?: '_self' | '_blank' | '_parent' | '_top'
	/** Relación con el destino; gana sobre el valor por defecto de `target="_blank"`. */
	readonly rel?: string
	/** Descarga el destino, con el nombre de archivo indicado o el del servidor con `true`. */
	readonly download?: string | boolean
	/** Idioma del destino. Con `to`, también elige el idioma del enlace con `@meekojs/i18n`. */
	readonly hreflang?: string
	/** Idioma del texto del enlace, cuando no es el del documento. */
	readonly lang?: string
	/** Texto de ayuda del enlace. */
	readonly title?: string
}

/**
 * Un enlace con texto, la unidad de `<UIHeader>`, `<UIFooter>`, `<UINavigationTabs>` y
 * `<UIPageNavigation>`. Un enlace con `to` se marca solo con la ruta activa. Uno con `href` es el
 * actual si `current` es `true` o, sin `current`, si su `href` coincide con la prop `current` del
 * componente.
 *
 * @since 0.2.0
 * @example
 * ```ts
 * const items: UINavigationLink[] = [
 * 	{ label: 'Guía', to: '/docs' },
 * 	{ label: 'GitHub', href: 'https://github.com/meekojs/meeko' },
 * ]
 * ```
 */
export type UINavigationLink = UILinkTarget & {
	/** Texto visible. */
	readonly label: string
	/** Con `href`, marca o desmarca el enlace como página actual, por encima de la prop `current` del componente. */
	readonly current?: boolean
}

/**
 * La marca de `<UIHeader>` y `<UIFooter>`: un enlace a la portada con imagen, nombre y producto.
 * `width` y `height` de la imagen reservan su espacio, así que su carga no mueve nada.
 *
 * @since 0.2.0
 * @example
 * ```ts
 * const brand: UIBrand = { name: 'Meeko', product: 'UI', to: '/', image: { src: '/brand/logo.png', width: 24, height: 24 }, ariaLabel: 'Meeko UI: inicio' }
 * ```
 */
export type UIBrand = UILinkTarget & {
	/** Nombre visible. Con `product`, se oculta en un móvil estrecho. */
	readonly name: string
	/** Producto, tras el nombre. */
	readonly product?: string
	/** Logotipo decorativo: el nombre del enlace lo da el texto o `ariaLabel`. */
	readonly image?: { readonly src: string; readonly width: number; readonly height: number }
	/** Nombre accesible del enlace, si el texto visible no basta. */
	readonly ariaLabel?: string
}

/**
 * Props de `<UIHeader>`: una barra de altura fija (`--ui-header-height`) con marca, enlaces y
 * acciones. En una pantalla estrecha los enlaces pasan a un menú nativo con `popover`, sin JavaScript
 * y sin mover la página. Sus snippets son `brand`, `nav`, `actions` y `menu`.
 *
 * @since 0.2.0
 * @example
 * ```html
 * <UIHeader bind:brand="brand" bind:items="items" bind:current="route.path.value">
 * 	<snippet name="actions"><UIThemeToggle /></snippet>
 * </UIHeader>
 * ```
 */
export interface UIHeaderProps {
	/** Marca; el snippet `brand` la sustituye. */
	readonly brand?: UIBrand
	/** Enlaces principales; el snippet `nav` los sustituye en pantallas anchas. */
	readonly items?: readonly UINavigationLink[]
	/** Ruta actual, para marcar el enlace con `aria-current="page"`. */
	readonly current?: string
	/** `aria-label` de la navegación. */
	readonly label?: string
	/** `aria-label` del botón del menú en pantallas estrechas. */
	readonly menuLabel?: string
	/** Se queda fija arriba al desplazarse; `true` por defecto. */
	readonly sticky?: boolean
	/** Ancho máximo del contenido, como en `<UIContainer>`; `"xl"` por defecto. */
	readonly size?: UIContainerSize
	/** Clases adicionales, tras la del componente. */
	readonly class?: string
}

/**
 * Una columna de enlaces de `<UIFooter>`.
 *
 * @since 0.2.0
 * @example
 * ```ts
 * const group: UIFooterGroup = { title: 'Recursos', items: [{ label: 'Guía', to: '/docs' }] }
 * ```
 */
export interface UIFooterGroup {
	/** Título de la columna. */
	readonly title: string
	/** Enlaces de la columna. */
	readonly items: readonly UINavigationLink[]
}

/**
 * Props de `<UIFooter>`: marca y descripción, columnas de enlaces (`groups`), una fila de enlaces
 * (`items`) y una línea legal. Sus snippets son `brand`, `about`, `actions` y `legal`.
 *
 * @since 0.2.0
 * @example
 * ```html
 * <UIFooter bind:brand="brand" description="Un framework con SSR." bind:groups="groups">
 * 	<snippet name="legal">MIT</snippet>
 * </UIFooter>
 * ```
 */
export interface UIFooterProps {
	/** Marca; el snippet `brand` la sustituye. */
	readonly brand?: UIBrand
	/** Texto bajo la marca; el snippet `about` lo sustituye. */
	readonly description?: string
	/** Columnas de enlaces. */
	readonly groups?: readonly UIFooterGroup[]
	/** Fila de enlaces, sin columnas. */
	readonly items?: readonly UINavigationLink[]
	/** `aria-label` de la navegación. */
	readonly label?: string
	/** Ancho máximo del contenido, como en `<UIContainer>`; `"xl"` por defecto. */
	readonly size?: UIContainerSize
	/** Clases adicionales, tras la del componente. */
	readonly class?: string
}

/**
 * Disposición de `<UIPage>` y `<UIPageHeader>`: `docs` tiene navegación, artículo e índice; `dashboard`,
 * navegación opcional y un área ancha; `landing` deja el ancho a cada sección.
 *
 * @since 0.2.0
 * @example
 * ```ts
 * const layout: UIPageLayout = 'dashboard'
 * ```
 */
export type UIPageLayout = 'docs' | 'dashboard' | 'landing'

/**
 * Props de `<UIPage>`, la estructura de una página: enlace para saltar al contenido, un único `<main>`
 * enfocable (`#contenido` por defecto) y las zonas `header`, `notices`, `bar`, `sidebar`, `aside` y
 * `footer` como snippets. `sidebar` y `aside` se ocultan en pantallas estrechas: `bar` es la barra que
 * entonces lleva el `<UIDrawer>`. Los demás atributos, como `lang` y `dir`, llegan a la raíz.
 *
 * @since 0.2.0
 * @example
 * ```html
 * <UIPage layout="docs">
 * 	<snippet name="header"><UIHeader bind:brand="brand" /></snippet>
 * 	<snippet name="sidebar"><UINavigationTree bind:groups="groups" /></snippet>
 * 	<article>…</article>
 * </UIPage>
 * ```
 */
export type UIPageProps = Omit<ElementAttributes<'div'>, 'class'> & {
	/** Disposición; `"docs"` por defecto. */
	readonly layout?: UIPageLayout
	/** `id` del `<main>`, destino del enlace para saltar; `"contenido"` por defecto. */
	readonly mainId?: string
	/** Idioma del contenido de `<main>`, cuando no es el del documento. */
	readonly mainLang?: string
	/** Texto del enlace para saltar al contenido. */
	readonly skipLabel?: string
	/** Clases adicionales, tras la del componente. */
	readonly class?: string
}

/**
 * Props de `<UIPageHeader>`, el encabezado con el único `<h1>` de una página. Sus snippets son
 * `breadcrumb`, `actions` y `default`, éste bajo la descripción.
 *
 * @since 0.2.0
 * @example
 * ```html
 * <UIPageHeader title="Fuentes" description="Lo que se publica en la documentación." layout="dashboard">
 * 	<snippet name="actions"><UIButton>Añadir</UIButton></snippet>
 * </UIPageHeader>
 * ```
 */
export interface UIPageHeaderProps {
	/** Título de la página. */
	readonly title: string
	/** Texto bajo el título. */
	readonly description?: string
	/** Disposición de la página, que fija el tamaño del título y el borde; `"docs"` por defecto. */
	readonly layout?: UIPageLayout
	/** Clases adicionales, tras la del componente. */
	readonly class?: string
}

/**
 * Un enlace de `<UINavigationTree>`.
 *
 * @since 0.2.0
 * @example
 * ```ts
 * const item: UINavigationTreeItem = { label: 'useSignal', to: '/docs/reference', code: true, featured: true }
 * ```
 */
export type UINavigationTreeItem = UINavigationLink & {
	/** Trazo SVG del icono, en una rejilla de 16 por 16; el snippet `icon` lo sustituye. */
	readonly icon?: string
	/** El texto es código: se pinta en monoespaciada y en una sola línea. */
	readonly code?: boolean
	/** Añade la etiqueta de destacado. */
	readonly featured?: boolean
	/** Otras rutas para las que este enlace también es el actual. */
	readonly aliases?: readonly string[]
}

/**
 * Un grupo de `<UINavigationTree>`.
 *
 * @since 0.2.0
 * @example
 * ```ts
 * const group: UINavigationTreeGroup = { title: 'Empezar', open: true, items: [{ label: 'Instalación', href: '/installation' }] }
 * ```
 */
export interface UINavigationTreeGroup {
	/** Título del grupo; sin él, los enlaces van sueltos y el grupo no se pliega. */
	readonly title?: string
	/** Trazo SVG del icono del grupo, en una rejilla de 16 por 16. */
	readonly icon?: string
	/** Enlaces del grupo. */
	readonly items: readonly UINavigationTreeItem[]
	/** Abierto al cargar; `true` por defecto. Un grupo con el enlace actual siempre empieza abierto. */
	readonly open?: boolean
}

/**
 * Props de `<UINavigationTree>`, la navegación lateral: grupos que se pliegan con `<details>` nativo,
 * enlace actual, iconos, código y destacados. Sus snippets son `item`, `icon` y `empty`.
 *
 * @since 0.2.0
 * @example
 * ```html
 * <UINavigationTree bind:groups="groups" bind:current="route.path.value" label="Documentación" />
 * ```
 */
export interface UINavigationTreeProps {
	/** Grupos de enlaces. */
	readonly groups: readonly UINavigationTreeGroup[]
	/** Ruta actual, para marcar el enlace con `aria-current="page"`. */
	readonly current?: string
	/** `aria-label` de la navegación. */
	readonly label?: string
	/** Los grupos se pliegan; `true` por defecto. */
	readonly collapsible?: boolean
	/** Etiqueta de un enlace con `featured`. */
	readonly featuredLabel?: string
	/** Mensaje sin grupos; el snippet `empty` lo sustituye. */
	readonly emptyText?: string
	/** Clases adicionales, tras la del componente. */
	readonly class?: string
}

/**
 * Cómo se cierra un `<UIDrawer>`: `any` con Escape o al pulsar fuera, `closerequest` sólo con Escape
 * y `none` sólo desde el propio panel. Es el atributo nativo `closedby` de `<dialog>`.
 *
 * @since 0.2.0
 * @example
 * ```ts
 * const closedBy: UIDrawerClosedBy = 'closerequest'
 * ```
 */
export type UIDrawerClosedBy = 'any' | 'closerequest' | 'none'

/**
 * Lado de un `<UIDrawer>`, en orden lógico: `start` es la izquierda en un documento LTR y la derecha
 * en uno RTL.
 *
 * @since 0.2.0
 * @example
 * ```ts
 * const side: UIDrawerSide = 'end'
 * ```
 */
export type UIDrawerSide = 'start' | 'end'

/**
 * Props de `<UIDrawer>`, un panel lateral sobre un `<dialog>` modal nativo: abre con `command`
 * (también sin JavaScript en los navegadores que lo admiten), atrapa el foco y lo devuelve al cerrar.
 * Su modelo es `open`, y sus snippets son `default`, `footer` y `trigger`, que recibe el `id` del panel
 * para usar `commandfor`. Sin `triggerLabel` ni `trigger`, no pinta botón: ábrelo con el modelo.
 *
 * @since 0.2.0
 * @example
 * ```html
 * <UIDrawer title="Contenidos" triggerLabel="Contenidos" model="menuOpen">
 * 	<UINavigationTree bind:groups="groups" />
 * </UIDrawer>
 * ```
 */
export interface UIDrawerProps {
	/** Título visible y nombre accesible del panel. */
	readonly title: string
	/** `id` del `<dialog>`; por defecto, uno generado. */
	readonly id?: string
	/** Lado por el que entra; `"start"` por defecto. */
	readonly side?: UIDrawerSide
	/** Texto del botón que abre el panel. */
	readonly triggerLabel?: string
	/** `aria-label` del botón de cierre. */
	readonly closeLabel?: string
	/** Cómo se cierra el panel; `"any"` por defecto. */
	readonly closedBy?: UIDrawerClosedBy
	/** Seguir un enlace del panel lo cierra; `true` por defecto. */
	readonly closeOnNavigate?: boolean
	/** Clases adicionales, tras la del componente. */
	readonly class?: string
}

/**
 * Props de `<UINavigationTabs>`: enlaces entre páginas con aspecto de pestañas, con `aria-current` y un
 * indicador que se desplaza con CSS. Son navegación, no un `tablist`: cada uno lleva a otra URL.
 *
 * @since 0.2.0
 * @example
 * ```html
 * <UINavigationTabs bind:items="[{ label: 'Hoy', to: '/metrics' }, { label: 'Mes', to: '/metrics/month' }]" current="/metrics" />
 * ```
 */
export interface UINavigationTabsProps {
	/** Enlaces. */
	readonly items: readonly UINavigationLink[]
	/** Ruta actual, para marcar el enlace con `aria-current="page"`. */
	readonly current?: string
	/** `aria-label` de la navegación. */
	readonly label?: string
	/** Clases adicionales, tras la del componente. */
	readonly class?: string
}

/**
 * Un paso de `<UIBreadcrumb>`. Sin destino, es sólo texto.
 *
 * @since 0.2.0
 * @example
 * ```ts
 * const items: UIBreadcrumbItem[] = [{ label: 'Inicio', to: '/' }, { label: 'useSignal' }]
 * ```
 */
export type UIBreadcrumbItem =
	| UINavigationLink
	| {
			/** Texto visible. */
			readonly label: string
			/** Marca el paso como página actual; por defecto, el último. */
			readonly current?: boolean
			readonly href?: undefined
			readonly to?: undefined
	  }

/**
 * Props de `<UIBreadcrumb>`: una lista ordenada dentro de un `<nav>`, con el último paso como página
 * actual.
 *
 * @since 0.2.0
 * @example
 * ```html
 * <UIBreadcrumb bind:items="[{ label: 'Referencia', to: '/docs/reference' }, { label: 'useSignal' }]" />
 * ```
 */
export interface UIBreadcrumbProps {
	/** Pasos, del más general al actual. */
	readonly items: readonly UIBreadcrumbItem[]
	/** `aria-label` de la navegación. */
	readonly label?: string
	/** Clases adicionales, tras la del componente. */
	readonly class?: string
}

/**
 * Props de `<UIPageNavigation>`: los enlaces a la página anterior y a la siguiente de un documento.
 * Para una lista larga, `<UIPagination>`.
 *
 * @since 0.2.0
 * @example
 * ```html
 * <UIPageNavigation bind:previous="{ label: 'Inicio', to: '/' }" bind:next="{ label: 'Rutas', to: '/routes' }" />
 * ```
 */
export interface UIPageNavigationProps {
	/** Página anterior. */
	readonly previous?: UINavigationLink
	/** Página siguiente. */
	readonly next?: UINavigationLink
	/** `aria-label` de la navegación. */
	readonly label?: string
	/** Texto sobre el enlace anterior. */
	readonly previousLabel?: string
	/** Texto sobre el enlace siguiente. */
	readonly nextLabel?: string
	/** Clases adicionales, tras la del componente. */
	readonly class?: string
}

/**
 * Props de `<UIPagination>`: recuento de una lista y acción de cargar más, con estado ocupado. Sin
 * `moreLink` emite `loadMore`; con él es un enlace, que funciona sin JavaScript (un cursor en la URL).
 *
 * @since 0.2.0
 * @example
 * ```html
 * <UIPagination bind:shown="rows.value.length" bind:total="total" bind:busy="loading.value" on:loadMore="load" />
 * ```
 */
export interface UIPaginationProps {
	/** Elementos visibles. */
	readonly shown?: number
	/** Total de elementos. */
	readonly total?: number
	/** Texto del recuento, ya formateado; gana sobre `shown` y `total`. */
	readonly countText?: string
	/** Hay más que cargar; por defecto, si `shown` es menor que `total`. */
	readonly hasMore?: boolean
	/** Hay una carga en curso: la acción se anuncia ocupada, conserva el foco e ignora los clics. */
	readonly busy?: boolean
	/** Destino de la acción, si es un enlace. */
	readonly moreLink?: UILinkTarget
	/** Texto de la acción. */
	readonly loadMoreLabel?: string
	/** Texto de la acción con `busy`. */
	readonly loadingLabel?: string
	/** `aria-label` de la navegación. */
	readonly label?: string
	/** Clases adicionales, tras la del componente. */
	readonly class?: string
}

/**
 * Una entrada de `<UITableOfContents>`: el `id` de un encabezado de la página.
 *
 * @since 0.2.0
 * @example
 * ```ts
 * const entry: UITableOfContentsEntry = { id: 'instalacion', text: 'Instalación', level: 2 }
 * ```
 */
export interface UITableOfContentsEntry {
	/** `id` del encabezado. */
	readonly id: string
	/** Texto del enlace. */
	readonly text: string
	/** Nivel del encabezado, de 2 a 4: los niveles 3 y 4 se sangran. */
	readonly level: number
}

/**
 * Vista de `<UITableOfContents>`: `aside` para la columna lateral de `<UIPage>` y `collapsible`, un
 * `<details>` para la columna de contenido, que `<UIPage>` sólo muestra cuando el lateral se oculta.
 *
 * @since 0.2.0
 * @example
 * ```ts
 * const variant: UITableOfContentsVariant = 'collapsible'
 * ```
 */
export type UITableOfContentsVariant = 'aside' | 'collapsible'

/**
 * Props de `<UITableOfContents>`: el índice de la página. Los enlaces funcionan sin JavaScript. La
 * entrada activa la pinta `scroll-target-group` donde exista; en todos los navegadores, un
 * `IntersectionObserver` mínimo mantiene `aria-current="location"`. `active` lo sustituye.
 *
 * @since 0.2.0
 * @example
 * ```html
 * <UITableOfContents bind:entries="toc" />
 * <UITableOfContents bind:entries="toc" variant="collapsible" />
 * ```
 */
export interface UITableOfContentsProps {
	/** Entradas, en el orden de la página. */
	readonly entries: readonly UITableOfContentsEntry[]
	/** `id` de la entrada activa, si la controla la aplicación; desactiva el seguimiento del scroll. */
	readonly active?: string
	/** Vista; `"aside"` por defecto. */
	readonly variant?: UITableOfContentsVariant
	/** Título y `aria-label`. */
	readonly label?: string
	/** Clases adicionales, tras la del componente. */
	readonly class?: string
}

/**
 * Un idioma de `<UILocaleSwitcher>` y `<UILocaleSuggestion>`. Es sólo presentación: la aplicación
 * calcula `href` (o `to`) y guarda la elección.
 *
 * @since 0.2.0
 * @example
 * ```ts
 * const items: UILocaleItem[] = [
 * 	{ code: 'es', label: 'Español', href: '/guia', current: true },
 * 	{ code: 'en', label: 'English', href: '/en/guide' },
 * ]
 * ```
 */
export type UILocaleItem = UILinkTarget & {
	/** Código del idioma: va en `hreflang` y `lang`, y es el texto visible del selector. */
	readonly code: string
	/** Nombre del idioma, en ese idioma. */
	readonly label: string
	/** Es el idioma de la página. */
	readonly current?: boolean
}

/**
 * Props de `<UILocaleSwitcher>`: enlaces reales a esta página en cada idioma, sin enrutado ni cookie.
 * Con menos de dos idiomas no pinta nada.
 *
 * @since 0.2.0
 * @example
 * ```html
 * <UILocaleSwitcher bind:items="i18n.pageLocales().map(toItem)" />
 * ```
 */
export interface UILocaleSwitcherProps {
	/** Idiomas. */
	readonly items: readonly UILocaleItem[]
	/** `aria-label` de la navegación. */
	readonly label?: string
	/** Clases adicionales, tras la del componente. */
	readonly class?: string
}

/**
 * Props de `<UILocaleSuggestion>`: un aviso flotante que ofrece otro idioma, escrito en ese idioma, sin
 * mover la página. La aplicación decide cuándo pintarlo (tras montar, para no desajustar la hidratación)
 * y atiende el evento `stay`, porque recordar la elección no es cosa de UI.
 *
 * @since 0.2.0
 * @example
 * ```html
 * <UILocaleSuggestion if:when="suggestion.value" bind:items="items" bind:suggested="suggestion.value" on:stay="stay" />
 * ```
 */
export interface UILocaleSuggestionProps {
	/** Idiomas. */
	readonly items: readonly UILocaleItem[]
	/** Código del idioma que se ofrece; por defecto, el primero que no es el actual. */
	readonly suggested?: string
	/** `aria-label` del aviso. */
	readonly label?: string
	/** Texto del aviso. */
	readonly message?: string
	/** Texto del enlace. */
	readonly goLabel?: string
	/** Texto del botón para quedarse. */
	readonly stayLabel?: string
	/** Clases adicionales, tras la del componente. */
	readonly class?: string
}

/**
 * Veredicto de un `<UICodeBlock>`: la forma correcta o el error que corrige.
 *
 * @since 0.2.0
 * @example
 * ```ts
 * const verdict: UICodeBlockVerdict = 'good'
 * ```
 */
export type UICodeBlockVerdict = 'bad' | 'good'

/**
 * Props de `<UICodeBlock>`: código con etiqueta, lenguaje, veredicto y botón de copiar. `html` recibe
 * un `<pre>` ya resaltado (Shiki, por ejemplo) y el snippet `default`, marcado propio; `code` es lo que
 * se copia. `mode="log"` es una salida de texto: `role="log"`, líneas partidas y sin botón por defecto.
 *
 * @since 0.2.0
 * @example
 * ```html
 * <UICodeBlock code="pnpm add @meekojs/ui" lang="sh" label="Instalación" />
 * <UICodeBlock bind:code="source" bind:html="highlighted" lang="ts" verdict="good" />
 * ```
 */
export interface UICodeBlockProps {
	/** Texto del bloque y lo que se copia. Sin él, se copia el texto pintado. */
	readonly code?: string
	/** Un `<pre>` ya resaltado, en lugar de pintar `code`. */
	readonly html?: TrustedHtml
	/** Título del bloque. */
	readonly label?: string
	/** Lenguaje, junto al título. */
	readonly lang?: string
	/** Veredicto del ejemplo. */
	readonly verdict?: UICodeBlockVerdict
	/** Texto del veredicto. */
	readonly verdictLabel?: string
	/** Presentación; `"code"` por defecto. */
	readonly mode?: 'code' | 'log'
	/** Muestra el botón de copiar; por defecto, salvo en `mode="log"`. */
	readonly copy?: boolean
	/** Texto del botón de copiar. */
	readonly copyLabel?: string
	/** Texto tras copiar. */
	readonly copiedLabel?: string
	/** Texto si la copia falla. */
	readonly copyFailedLabel?: string
	/** Clases adicionales, tras la del componente. */
	readonly class?: string
}

/**
 * Props de `<UIProse>`: estilos de lectura para Markdown renderizado, con títulos, listas, enlaces,
 * código, tablas, avisos y anclas. `html` recibe HTML de confianza, como el de un snapshot, cuyo
 * `.code-block`, `.callout`, `.table-wrap` y `.heading-anchor` también se visten; el snippet `default`
 * recibe marcado propio. La clase pública `meeko-ui-prose` sirve en cualquier elemento.
 *
 * @since 0.2.0
 * @example
 * ```html
 * <UIProse as="article" bind:html="doc.html" />
 * <UIProse><h2>Instalación</h2><p>Añade el paquete.</p></UIProse>
 * ```
 */
export type UIProseProps = Omit<ElementAttributes<'div' | 'article' | 'section'>, 'class'> & {
	/** Etiqueta raíz; `"div"` por defecto. */
	readonly as?: 'div' | 'article' | 'section'
	/** HTML de confianza; sin él, se pinta el snippet `default`. */
	readonly html?: TrustedHtml
	/** Clases adicionales, tras la del componente. */
	readonly class?: string
}

/**
 * Tipo de línea de un `<UIDiff>`.
 *
 * @since 0.2.0
 * @example
 * ```ts
 * const kind: UIDiffLineKind = 'hunk'
 * ```
 */
export type UIDiffLineKind = 'add' | 'context' | 'file' | 'hunk' | 'remove'

/**
 * Props de `<UIDiff>`: un diff unificado, con cada línea marcada por su tipo en color y para los
 * lectores de pantalla.
 *
 * @since 0.2.0
 * @example
 * ```html
 * <UIDiff bind:diff="patch" label="Cambios en la guía" />
 * ```
 */
export interface UIDiffProps {
	/** El diff unificado, tal cual. */
	readonly diff: string
	/** Nombre accesible del bloque. */
	readonly label: string
	/** Mensaje sin cambios. */
	readonly emptyText?: string
	/** Texto para lectores de pantalla ante cada tipo de línea. */
	readonly lineLabels?: Readonly<Partial<Record<UIDiffLineKind, string>>>
	/** Clases adicionales, tras la del componente. */
	readonly class?: string
}
