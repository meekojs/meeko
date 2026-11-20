import type { MeekoPopoverProps as PopoverProps } from './app/components/MeekoPopover/types'
import type { MeekoSelectProps as SelectProps } from './app/components/MeekoSelect/types'
import type { AwaitMessages, AwaitResource } from './app/runtime/await'
import type { ElementAttributes } from './app/runtime/dynamic-tag'
import type { RouteRecord } from './app/runtime/router'
import type { MeekoTeleportProps as TeleportProps } from './app/runtime/teleport'
import type { LayoutName as NamedLayoutName, LayoutProps as NamedLayoutProps } from './shared/layout'
import type { ThemeChoice, ThemeToggleMessages } from './shared/theme'

import { currentAppNavigation, navigateApp } from './app/runtime/navigate'
import { activeRouteManifest, href as runtimeHref } from './app/runtime/router'

export { createNavigator, createRouteManifest, matchRoute } from './app/runtime/router'
export { defineMeekoConfig } from './modules/define-meeko-config'
export type { DevAllowedHosts } from './server/runtime/dev-hosts'
export type { MeekoConfig, MeekoDevtoolsConfig, RobotsConfig, ServerHeaders, ServerResponseConfig, SitemapConfig, SitemapEntriesContext, SitemapEntry, StaticHeaderFile } from './modules/define-meeko-config'
export { defineMeekoModule } from './modules/define-meeko-module'
export type { MeekoHookable, MeekoHooks, MeekoModule, MeekoModuleContext, MeekoModuleDefinition, MeekoModuleEntry, MeekoModuleMeta, MeekoModuleName, MeekoModuleNames, ModulePublicFileOptions, ModuleAutoImport, ModulePlugin, ModuleServerHandler, SitemapAlternate, SitemapResolvedUrl } from './modules/define-meeko-module'
export { sitemapXml } from './framework/sitemap-xml'
export { definePlugin } from './app/definitions/define-plugin'
export type { MeekoPlugin, PluginApp, PluginErrorHandler, PluginErrorInfo, PluginRegistration } from './app/definitions/define-plugin'
export type { LinkResolveInput, LinkResolver } from './shared/link'
export type { ErrorPageRecord, NamedLayoutRecord, NavigationContext, Navigator, RouteMatch, RouteRecord } from './app/runtime/router'
export { defineGroup } from './shared/definitions/define-group'
export { useLayout } from './app/composables/useLayout'
export type { GroupDefinition, LayoutHandle, LayoutName, LayoutPropsInput, PageBodyLayoutProps, PageLayout, PageLayoutOptions } from './shared/layout'
export { mountClientApp } from './app/runtime/client'
export { HydrationMismatchError } from './app/runtime/hydration-errors'
export type { HydrationMismatchDetail } from './app/runtime/hydration-errors'
export type { ClientApp, ClientAppOptions, ClientComponent, ClientRoute } from './app/runtime/client'
export { readHydrationDocument } from './app/runtime/client-payload'
export type { HydrationDocument } from './app/runtime/client-payload'
export { useNavigation } from './app/composables/useNavigation'
export { useRoute } from './app/composables/useRoute'
export { useSearchParam } from './app/composables/useSearchParam'
export type { SearchParamOptions } from './app/composables/useSearchParam'
export type { NavigationState, RouteState } from './app/runtime/navigation'
export { definePage } from './app/definitions/define-page'
export { PageInputError } from './app/definitions/define-page'
export type { ClientPageDefinition, ClientPageLoadContext, PageBodyDefinePage, PageCache, PageCacheContext, PageDefinition, PageHead, PageLoadContext, PageMemoryCache, PageRender, PageSchema } from './app/definitions/define-page'
export { notFound, redirect } from './server/runtime/page-body'
export { documentHtml } from './server/runtime/document-html'
export { usePage } from './server/composables/usePage'
export type { PageRequest, PageRequestOf } from './server/composables/usePage'
export type { JsonShape, PageBodyHead, SerializableExport, ServerData } from './server/runtime/page-body'
export { StateStore } from './app/runtime/state'
export { useState } from './app/composables/useState'
export { useForm } from './app/composables/useForm'
export type { Form, FormField, FormSubmission } from './app/composables/useForm'
export { useStorage } from './app/composables/useStorage'
export { useHead } from './app/composables/use-head'
export { useSeoMeta } from './app/composables/use-seo-meta'
export type { DocumentConfig, DocumentHead, DocumentSeo, HeadInput, HeadLink, HeadMeta, HeadScript, HeadStyle, SeoMetaInput } from './shared/head'
export type { StorageArea, StorageOptions } from './app/composables/useStorage'
export { useTheme } from './app/composables/use-theme'
export { useThemeToggle } from './app/composables/use-theme-toggle'
export type { ThemeChoice, ThemeConfig, ThemeName, ThemeState, ThemeToggleMessages, ThemeToggleSnippets, ThemeToggleState, ThemeToggleSystem } from './shared/theme'
// Types only: the code of <MeekoPopover> and <MeekoSelect> reaches a bundle only through the tags.
export type { PopoverExposed, PopoverMode, PopoverPlacement, PopoverRole, PopoverSnippets, PopoverToggleEvent, PopoverTrigger } from './app/components/MeekoPopover/types'
export type { SelectField, SelectFilter, SelectFilterContext, SelectModel, SelectOptionState, SelectSnippets } from './app/components/MeekoSelect/types'
export { defer } from './app/runtime/deferred'
export type { DeferOptions, Deferred, DeferredError, DeferredFactory, DeferredStatus } from './app/runtime/deferred'
export { defineRouteMiddleware } from './app/definitions/define-route-middleware'
export { defineServerRouteMiddleware } from './server/middleware/definitions'
export type { RouteMiddleware, RouteMiddlewareContext, RouteMiddlewareName, RouteMiddlewareOptions } from './app/middleware/runtime'
export type { ServerRouteMiddleware, ServerRouteMiddlewareContext } from './server/middleware/runtime'
export { ClientError, createApiClient, createPublicServerManifest, createRpcClient, isClientError } from './shared/clients'
export { invalidate } from './shared/invalidation'
export type { ApiClient, ApiMutationInput, ApiOperation, ClientOptions, PublicApiEndpoint, PublicRpcEndpoint, PublicServerManifest, RpcClient, RpcOperation, ValidationIssue } from './shared/clients'
export { createBrowserClientOptions } from './app/runtime/browser-clients'
export { createSocketClient, createSocketRegistry } from './app/runtime/socket'
export { useSocket, useSocketClient } from './app/composables/use-socket-client'
export { useSocketChannel } from './app/composables/use-socket-channel'
export { createUseApi } from './app/composables/resources/use-api'
export { createUseApiMutation } from './app/composables/resources/use-api-mutation'
export { createUseRpcMutation } from './app/composables/resources/use-rpc-mutation'
export { createUseRpcQuery } from './app/composables/resources/use-rpc-query'
export type { ApiMutation, ApiMutationContract, ApiQueryContract, ApiQueryOptions, DataResource, DataResourceOptions, LoadedResource, Reactive, RpcMutation, UseApi, UseApiMutation, UseRpcMutation, UseRpcQuery } from './app/composables/resources/engine'
export type { AwaitMessages, AwaitResource, MeekoAwaitSnippets } from './app/runtime/await'
export type { MutationAttempt, MutationFailure, MutationOptions, RetrySafeMutation, RetrySafeOptions, UncertainMutation } from './app/runtime/mutations'
export type { SocketClient, SocketContract, SocketSchema, SocketClientOptions, SocketRegistry, SocketRegistryOptions } from './app/runtime/socket'
export type { MeekoTeleportTarget } from './app/runtime/teleport'

/**
 * Rutas de la aplicación con sus parámetros, por ID. Está vacía en el paquete: la amplían las
 * declaraciones generadas en `.meeko/types/routes.d.ts`, y con ellas `href` comprueba IDs y
 * `params`. Sin esas declaraciones, `href` acepta cualquier cadena.
 *
 * @example
 * ```ts
 * // .meeko/types/routes.d.ts (generado por meeko routes / meeko check)
 * declare module "@meekojs/meeko/framework" {
 *   interface GeneratedRoutes {
 *     "/": {};
 *     "/users/[id]": { id: string };
 *   }
 * }
 * ```
 */
export interface GeneratedRoutes {}

/**
 * Clave de datos: identifica lo que carga una lectura y lo que cambia una escritura. Las claves son
 * jerárquicas por puntos: `"orders"` cubre `"orders"`, `"orders.list"` y `"orders.42"`. Las que
 * Meeko conoce por convención (cada procedimiento RPC y cada ruta GET de `server/api`, con sus
 * prefijos) llegan al autocompletado mediante {@link GeneratedDataKeys}; cualquier otra cadena
 * también vale.
 *
 * @since 1.10.0
 * @example
 * ```ts
 * import type { DataKey } from "@meekojs/meeko/framework";
 *
 * const keys: DataKey[] = ["orders", `orders.${"42"}`];
 * ```
 */
export type DataKey = keyof GeneratedDataKeys | (string & {})

/**
 * Claves de datos conocidas de la aplicación. Está vacía en el paquete: la amplían las
 * declaraciones generadas en `.meeko/types/server-contracts.d.ts` con la clave por convención de
 * cada procedimiento RPC y de cada ruta GET de `server/api`, y sus prefijos. Sólo sirve para el
 * autocompletado: {@link DataKey} acepta además cualquier cadena, y `meeko check` avisa con
 * `MEEK141` de una invalidación que ninguna lectura usa.
 *
 * @since 1.10.0
 * @example
 * ```ts
 * // .meeko/types/server-contracts.d.ts (generado por meeko check y meeko dev)
 * declare module "@meekojs/meeko/framework" {
 *   interface GeneratedDataKeys {
 *     "orders": true;
 *     "orders.list": true;
 *   }
 * }
 * ```
 */
export interface GeneratedDataKeys {}

/**
 * Temas de la aplicación. Está vacía en el paquete: con `theme` en `meeko.config.ts`, la amplían
 * las declaraciones generadas en `.meeko/types/routes.d.ts` (`meeko check`), y con ellas
 * `useTheme()` tipa sus temas como la unión literal de `themes`. Sin esas declaraciones, los
 * temas son `string`.
 *
 * @since 1.4.0
 * @example
 * ```ts
 * // .meeko/types/routes.d.ts (generado por meeko routes / meeko check)
 * declare module "@meekojs/meeko/framework" {
 *   interface GeneratedTheme {
 *     readonly themes: "light" | "dark";
 *     readonly choices: "light" | "dark" | "system";
 *   }
 * }
 * ```
 */
export interface GeneratedTheme {}

/**
 * Layouts con nombre de la aplicación, con las props de cada uno. Está vacía en el paquete: la
 * amplían las declaraciones generadas en `.meeko/types/routes.d.ts` (`meeko check`, `meeko dev`), y
 * con ellas `layout` y `layoutProps` de `definePage` y de `defineGroup`, y `useLayout()`, se tipan
 * con los nombres y las props de cada layout. Sin esas declaraciones, cualquier nombre vale.
 *
 * @since 1.5.0
 * @example
 * ```ts
 * // .meeko/types/routes.d.ts (generado por meeko check)
 * declare module "@meekojs/meeko/framework" {
 *   interface GeneratedLayouts {
 *     "default": import("../../app/layouts/default.meeko").ComponentProps;
 *     "dashboard": import("../../app/layouts/dashboard.meeko").ComponentProps;
 *   }
 * }
 * ```
 */
export interface GeneratedLayouts {}

/**
 * Layout con nombre de cada página, por ID de ruta: un nombre de {@link GeneratedLayouts}, o `false`
 * para una página sin layout con nombre. Está vacía en el paquete: la amplían las declaraciones
 * generadas en `.meeko/types/routes.d.ts`, y con ellas `useLayout()` se tipa en cada página con su
 * layout.
 *
 * @since 1.5.0
 * @example
 * ```ts
 * // .meeko/types/routes.d.ts (generado por meeko check)
 * declare module "@meekojs/meeko/framework" {
 *   interface GeneratedPageLayouts {
 *     "/": "default";
 *     "/connections": "dashboard";
 *     "/print": false;
 *   }
 * }
 * ```
 */
export interface GeneratedPageLayouts {}

/**
 * Middleware de ruta con nombre de la aplicación (`app/middleware/*.ts` con
 * `defineRouteMiddleware(fn, { global: false })`), por nombre, con su archivo. Está vacía en el
 * paquete: la amplían las declaraciones generadas en `.meeko/types/routes.d.ts` (`meeko check`,
 * `meeko dev`), y con ellas `middleware` de `definePage` y de `defineGroup` se tipa con sus nombres.
 * Sin esas declaraciones, cualquier nombre vale.
 *
 * @since 1.6.0
 * @example
 * ```ts
 * // .meeko/types/routes.d.ts (generado por meeko check)
 * declare module "@meekojs/meeko/framework" {
 *   interface GeneratedRouteMiddleware {
 *     "auth": "app/middleware/auth.ts";
 *     "admin": "app/middleware/20-admin.ts";
 *   }
 * }
 * ```
 */
export interface GeneratedRouteMiddleware {}

/**
 * Props que una página puede pasar al layout con nombre `L`: las `Props` que declara el layout, sin
 * `outlet`. Con `false` (página sin layout con nombre) no admite ninguna; sin las declaraciones
 * generadas, es `Record<string, unknown>`. Se autoimporta en las aplicaciones; un tipo propio del
 * proyecto con el mismo nombre tiene prioridad.
 *
 * @typeParam L Nombre del layout, o `false`.
 * @since 1.5.0
 * @example
 * ```ts
 * // Con app/layouts/dashboard.meeko declarando { title?: string; showAlert?: boolean }:
 * const props: LayoutProps<"dashboard"> = { title: "Conexiones", showAlert: true };
 * ```
 * @see https://github.com/meekojs/meeko/blob/main/docs/framework.md#props-del-layout-desde-la-página
 */
export type LayoutProps<L extends string | false = NamedLayoutName> = NamedLayoutProps<L>

type RouteKey = keyof GeneratedRoutes extends never ? string : keyof GeneratedRoutes & string
type RouteParams<K extends string> = K extends keyof GeneratedRoutes ? GeneratedRoutes[K] : Record<string, string>
type HrefOptions<K extends string> = (keyof GeneratedRoutes extends never
	? {
			/** Parámetros de la ruta por nombre. */
			params?: Record<string, string>
		}
	: keyof RouteParams<K> extends never
		? {
				/** Una ruta sin segmentos dinámicos no admite parámetros. */
				params?: never
			}
		: {
				/** Parámetros de la ruta dinámica, uno por segmento. */
				params: RouteParams<K>
			}) & {
	/** Query string; omite `null` y `undefined`. */
	search?: Readonly<Record<string, string | number | boolean | null | undefined>>
}
type HrefArguments<K extends string> = K extends keyof GeneratedRoutes ? (keyof RouteParams<K> extends never ? [options?: HrefOptions<K>] : [options: HrefOptions<K>]) : [options?: HrefOptions<K>]

type RuntimeHrefOptions = Parameters<typeof runtimeHref>[2]

/**
 * ID de cualquier ruta de la aplicación, como `"/users/[id]"`: la unión de las páginas de
 * `app/pages` que declaran `.meeko/types/routes.d.ts` (`meeko check`, `meeko dev`), o `string` sin
 * esas declaraciones. Es el tipo de `to` de `<MeekoLink>` y del ID de {@link href}. Se autoimporta en
 * las aplicaciones; un tipo propio del proyecto con el mismo nombre tiene prioridad.
 *
 * @since 1.4.0
 * @example
 * ```html
 * <!-- app/components/NavItem.meeko: recibe el ID de una ruta sin parámetros -->
 * <script lang="ts">
 * const props = defineProps<{ to: RouteId; label: string }>();
 * </script>
 * <template><a bind:href="href(props.to)">{props.label}</a></template>
 * ```
 */
export type RouteId = RouteKey

/**
 * Props de la etiqueta propia `<MeekoLink>`, que renderiza un `<a>` cuyo `href` construye
 * {@link href}. `to` es el ID de la ruta; `params` y `search` se escriben con `bind:`; `match`
 * elige si el enlace está activo sólo en su ruta o también por debajo (desde 1.5.0). El resto de
 * atributos (`class`, `target`, `aria-*`, `on:click`…) y el contenido pasan al `<a>`. El tipo
 * incluye los atributos de `ElementAttributes<'a'>`, salvo `href`, que construye Meeko; un
 * `aria-current` propio gana a la ruta, `false` lo quita y `null` o `undefined` dejan decidir a la
 * ruta (desde 1.8.0). El editor
 * muestra estas props en el hover de la etiqueta y lleva aquí con «Ir a definición». Sólo es un
 * tipo: sirve, por ejemplo, para un componente que envuelve `<MeekoLink>`. Se autoimporta en `app/`
 * y en los componentes, como `AppCardProps`; un tipo propio del proyecto con el mismo nombre tiene
 * prioridad.
 *
 * @typeParam K ID de la ruta, como `"/users/[id]"`.
 * @since 1.4.0
 * @example
 * ```html
 * <script lang="ts">
 * import type { MeekoLinkProps } from "@meekojs/meeko/framework";
 * const props = defineProps<{ link: MeekoLinkProps<"/users/[id]">; label: string }>();
 * </script>
 * <template>
 *   <MeekoLink to="/users/[id]" bind:params="props.link.params">{props.label}</MeekoLink>
 * </template>
 * ```
 * @see https://github.com/meekojs/meeko/blob/main/docs/framework.md#meekooutlet--y-meekolink
 */
export interface MeekoLinkProps<K extends RouteId = RouteId> extends Omit<ElementAttributes<'a'>, 'href'> {
	/**
	 * ID de la ruta de destino, como `to="/users/[id]"`: sólo las rutas que existen. También admite
	 * una expresión con `bind:to`.
	 */
	readonly to: K
	/**
	 * Parámetros de una ruta dinámica, con `bind:params="{ id: user.id }"`. Son obligatorios en las
	 * rutas con segmentos dinámicos y no se admiten en las demás.
	 */
	readonly params?: RouteParams<K>
	/**
	 * Query string, con `bind:search="{ tab: 'perfil' }"`. Omite `null` y `undefined`.
	 */
	readonly search?: Readonly<Record<string, string | number | boolean | null | undefined>>
	/**
	 * Cuándo el enlace está activo. `"exact"` (por defecto): sólo en su ruta, con
	 * `aria-current="page"`. `"prefix"`: también en las rutas por debajo, por segmentos completos
	 * (`/dashboard` cubre `/dashboard/stats`, no `/dashboards`), con `aria-current="true"`, la
	 * sección actual; en su propia ruta sigue siendo `"page"`. `to="/"` sólo coincide exacta. Se
	 * escribe `match="prefix"` o `bind:match`.
	 *
	 * @since 1.5.0
	 * @example
	 * ```html
	 * <nav>
	 *   <MeekoLink to="/">Inicio</MeekoLink>
	 *   <MeekoLink to="/dashboard" match="prefix">Panel</MeekoLink>
	 * </nav>
	 * ```
	 */
	readonly match?: 'exact' | 'prefix'
	/**
	 * Si el `href` pasa por los resolvedores de enlaces de la aplicación (`app.resolveLink` de un
	 * plugin o módulo, como el prefijo de idioma de `@meekojs/i18n`). `true` por defecto;
	 * `bind:resolve="false"` deja el `href` tal como lo construye `href()`. El atributo `hreflang`
	 * del enlace llega al resolvedor, que puede usarlo para elegir otro idioma.
	 *
	 * @since 1.8.0
	 * @example
	 * ```html
	 * <MeekoLink to="/guide">Guía</MeekoLink>
	 * <MeekoLink to="/guide" hreflang="en">Guide (English)</MeekoLink>
	 * <MeekoLink to="/admin" bind:resolve="false">Administración</MeekoLink>
	 * ```
	 */
	readonly resolve?: boolean
}

/**
 * Props de la etiqueta propia `<MeekoOutlet />`: ninguna. Pinta, en `app/app.meeko` y en los
 * layouts, el layout o la página que van dentro, a partir de la prop `outlet` que Meeko pasa. No
 * admite atributos ni contenido (`MEEK104`). El editor lleva aquí con «Ir a definición». Se
 * autoimporta en `app/` y en los componentes.
 *
 * @since 1.4.0
 * @example
 * ```html
 * <!-- app/layouts/default.meeko -->
 * <template>
 *   <header><MeekoLink to="/">Inicio</MeekoLink></header>
 *   <main><MeekoOutlet /></main>
 * </template>
 * ```
 * @see https://github.com/meekojs/meeko/blob/main/docs/framework.md#meekooutlet--y-meekolink
 */
export interface MeekoOutletProps {}

/**
 * Props de la etiqueta propia `<MeekoThemeToggle>`, el selector de tema que Meeko compila y
 * distribuye con `theme` en `meeko.config.ts`. Todas son opcionales; `themes` y `labels` usan las
 * elecciones de la configuración ({@link ThemeChoice}). Además admite un snippet por elección, su
 * icono (`ThemeToggleSnippets`). El editor muestra estas props en el hover de la etiqueta y
 * lleva aquí con «Ir a definición». Se autoimporta en `app/` y en los componentes, como
 * `MeekoLinkProps`; un tipo propio del proyecto con el mismo nombre tiene prioridad.
 *
 * @since 1.4.0
 * @example
 * ```html
 * <!-- app/components/ThemeSwitch.meeko: envuelve el selector y recibe su modo -->
 * <script lang="ts">
 * const props = defineProps<{ mode: NonNullable<MeekoThemeToggleProps["mode"]> }>();
 * </script>
 * <template>
 *   <MeekoThemeToggle bind:mode="props.mode" class="switch" />
 * </template>
 * ```
 * @see https://github.com/meekojs/meeko/blob/main/docs/framework.md#meekothemetoggle
 */
export interface MeekoThemeToggleProps {
	/** `"cycle"` (por defecto), un botón que pasa a la elección siguiente; `"select"`, un grupo de radios. */
	readonly mode?: 'cycle' | 'select'
	/** Elecciones y su orden, como `bind:themes="['light', 'dark']"`; por defecto, los temas de la configuración y `"system"` si está activo. */
	readonly themes?: readonly ThemeChoice[]
	/** Nombre de cada elección, como `bind:labels="{ dark: 'Oscuro' }"`; por defecto, «Claro», «Oscuro», «Sistema» y el nombre de los demás temas. */
	readonly labels?: Partial<Record<ThemeChoice, string>>
	/** Textos accesibles del botón y del grupo (`cycle(current, next)`, `unknown` y `group`), para traducirlos. */
	readonly messages?: ThemeToggleMessages
	/** Clases del elemento raíz, el `<form>`. */
	readonly class?: string
	/** `id` del elemento raíz, el `<form>`. */
	readonly id?: string
}

/**
 * Props de la etiqueta propia `<MeekoAwait>`, la zona de unos datos que llegan después del primer
 * pintado (`useApi` o `useRpcQuery` sin `await`). Pinta su snippet `pending` en la primera carga,
 * `error` si falla y su contenido cuando hay datos, que conserva durante las recargas. Con
 * `reserve`, mientras espera ocupa la altura que tuvo con datos la última vez. Además admite los
 * snippets de {@link MeekoAwaitSnippets}. El editor muestra estas props en el hover de la etiqueta y
 * lleva aquí con «Ir a definición». Se autoimporta en `app/` y en los componentes, como
 * `MeekoLinkProps`; un tipo propio del proyecto con el mismo nombre tiene prioridad.
 *
 * @since 1.5.0
 * @example
 * ```html
 * <!-- app/components/ItemsCard.meeko -->
 * <script lang="ts">
 * const items = useApi("/api/items");
 * </script>
 * <template>
 *   <section class="card">
 *     <MeekoAwait for="items" reserve>
 *       <snippet name="pending"><ItemsSkeleton /></snippet>
 *       <snippet name="error" params="error, retry"><p role="alert">No se pudo cargar. <button on:click="retry">Reintentar</button></p></snippet>
 *       <ItemsList bind:items="items.data.value" />
 *     </MeekoAwait>
 *   </section>
 * </template>
 * ```
 * @see https://github.com/meekojs/meeko/blob/main/docs/framework.md#meekoawait
 */
export interface MeekoAwaitProps {
	/**
	 * Recurso que espera: el resultado de `useApi` o `useRpcQuery` sin `await`, o una lista
	 * (`for="[items, stats]"`). Es una expresión, como `each:of`; también admite `bind:for`. Dentro
	 * del contenido, `meeko check` y el editor leen `items.data.value` como cargado.
	 */
	readonly for: AwaitResource | readonly AwaitResource[]
	/**
	 * Reserva de altura: `reserve` recuerda la altura que tuvo la zona con datos y la aplica mientras
	 * espera otra vez (en `sessionStorage`, por ruta, petición e instancia); `reserve="320px"` fija
	 * además un mínimo, también en la primera visita.
	 */
	readonly reserve?: boolean | string
	/** Textos del aviso de error por defecto, sin el snippet `error`. */
	readonly messages?: AwaitMessages
	/** Clases del contenedor, un `<div>`. */
	readonly class?: string
	/** `id` del contenedor. */
	readonly id?: string
}

/**
 * Props de la etiqueta propia `<MeekoTeleport>`, que pinta su contenido (el snippet `default`) en
 * otro lugar del documento sin sacarlo del componente que lo declara: conserva su ámbito reactivo,
 * sus eventos, sus snippets, `provide`/`inject`, sus manejadores de errores y el CSS `scoped`. El
 * HTML del servidor ya trae el contenido en su destino. El editor muestra estas props en el hover
 * de la etiqueta. Se autoimporta en `app/` y en los componentes, como `MeekoLinkProps`.
 *
 * @since 1.5.0
 * @example
 * ```html
 * <script lang="ts">
 * const isMobile = signal(false);
 * function save(): void {}
 * </script>
 * <template>
 *   <MeekoTeleport to="#toolbar" bind:disabled="isMobile.value">
 *     <button type="button" on:click="save">Guardar</button>
 *   </MeekoTeleport>
 * </template>
 * ```
 * @see https://github.com/meekojs/meeko/blob/main/docs/framework.md#meekoteleport
 */
export interface MeekoTeleportProps extends TeleportProps {}

/**
 * Props de la etiqueta propia `<MeekoPopover>`: un contenido en la capa superior (`popover`),
 * anclado a su disparador con *CSS anchor positioning* (con un cálculo en JavaScript donde el
 * navegador no lo tiene). El modelo por defecto (`model="open"`) es la señal de apertura y
 * `on:toggle` emite `{ open }`. El editor muestra estas props en el hover de la etiqueta y lleva
 * aquí con «Ir a definición». Se autoimporta en `app/` y en los componentes, como `MeekoLinkProps`.
 *
 * @since 1.5.0
 * @example
 * ```html
 * <!-- app/components/ActionsMenu.meeko: un menú que recibe dónde se abre -->
 * <script lang="ts">
 * const props = defineProps<{ placement?: MeekoPopoverProps["placement"] }>();
 * </script>
 * <template>
 *   <MeekoPopover role="menu" bind:placement="props.placement">
 *     <snippet name="trigger">Acciones</snippet>
 *     <button role="menuitem">Archivar</button>
 *   </MeekoPopover>
 * </template>
 * ```
 * @see https://github.com/meekojs/meeko/blob/main/docs/api.md#popover-meekopopover
 */
export interface MeekoPopoverProps extends PopoverProps {}

/**
 * Props de la etiqueta propia `<MeekoSelect>`, un select accesible sobre `<MeekoPopover>`. `T` es
 * el tipo de cada opción y `Multiple`, si se eligen varias: en la etiqueta se infieren de
 * `options` y de `multiple`, y el modelo es `SelectModel<T, Multiple>`. Se autoimporta en `app/`
 * y en los componentes, como `MeekoLinkProps`.
 *
 * @since 1.5.0
 * @example
 * ```html
 * <!-- app/components/UserPicker.meeko: envuelve el select con sus opciones -->
 * <script lang="ts">
 * interface User { id: number; name: string }
 * const props = defineProps<{ users: MeekoSelectProps<User>["options"] }>();
 * const user = defineModel<User | null>();
 * </script>
 * <template>
 *   <MeekoSelect model="user" bind:options="props.users" by="id" placeholder="Elige" />
 * </template>
 * ```
 * @see https://github.com/meekojs/meeko/blob/main/docs/api.md#select-meekoselect
 */
export interface MeekoSelectProps<T, Multiple extends boolean = false> extends SelectProps<T, Multiple> {}

/**
 * Construye una URL comprobada con el manifiesto de la aplicación en ejecución: en el servidor, el
 * de la petición en curso (SSR, loaders, `head`, prerender, API, RPC y middleware de servidor); en
 * el navegador, el de `mountClientApp`. Las rutas dinámicas exigen `params` con las claves del ID;
 * `search` añade la query string y omite `null` y `undefined`. Se autoimporta en las aplicaciones.
 *
 * @param id ID de la ruta, como `"/users/[id]"`.
 * @param options `params` de la ruta y `search`.
 * @returns La ruta con los parámetros codificados y la query string.
 * @throws {Error} Fuera de una aplicación; pase el manifiesto con la otra forma.
 * @since 1.1.0
 * @example
 * ```ts
 * import { href } from "@meekojs/meeko/framework";
 *
 * const link = href("/users/[id]", { params: { id: "42" }, search: { tab: "profile" } });
 * // "/users/42?tab=profile"
 * ```
 * @see https://github.com/meekojs/meeko/blob/main/docs/framework.md#configuración
 */
export function href<K extends RouteKey>(id: K, ...options: HrefArguments<K>): string
/**
 * Construye una URL comprobada a partir de un manifiesto de rutas explícito. Es la forma para
 * código fuera de una aplicación, como pruebas unitarias.
 *
 * @param routes Manifiesto de rutas, por ejemplo el de `createRouteManifest`.
 * @param id ID de la ruta.
 * @param options `params` de la ruta y `search`.
 * @returns La ruta con los parámetros codificados y la query string.
 * @throws {Error} Si el ID no existe o los `params` no coinciden con la ruta.
 * @example
 * ```ts
 * import { createRouteManifest, href } from "@meekojs/meeko/framework";
 *
 * const routes = createRouteManifest([{ id: "/users/[id]", file: "app/pages/users/[id].meeko", layouts: [] }]);
 * href(routes, "/users/[id]", { params: { id: "42" } }); // "/users/42"
 * ```
 */
export function href<K extends RouteKey>(routes: readonly RouteRecord[], id: K, ...options: HrefArguments<K>): string
export function href(first: string | readonly RouteRecord[], ...rest: unknown[]): string {
	if (typeof first === 'string') return runtimeHref(activeRouteManifest(), first, rest[0] as RuntimeHrefOptions | undefined)
	return runtimeHref(first, rest[0] as string, rest[1] as RuntimeHrefOptions | undefined)
}

/**
 * Destino tipado de {@link navigate}: el mismo que recibe `<MeekoLink>`. `to` es el ID de una ruta
 * que existe; `params`, obligatorios en una ruta dinámica y prohibidos en las demás, y `search`,
 * como en {@link href}.
 *
 * @typeParam K ID de la ruta, como `"/users/[id]"`.
 * @since 1.10.0
 * @example
 * ```ts
 * import type { NavigateTarget } from "@meekojs/meeko/framework";
 *
 * const target: NavigateTarget = { to: "/users/[id]", params: { id: "42" }, search: { tab: "actividad" }, hash: "bio" };
 * ```
 */
export type NavigateTarget<K extends RouteId = RouteId> = NavigateRoute<K> & HrefOptions<K>

/**
 * Ruta, fragmento y resolución de enlaces de un {@link NavigateTarget}.
 *
 * @typeParam K ID de la ruta.
 * @since 1.10.0
 * @example
 * ```ts
 * import type { NavigateRoute } from "@meekojs/meeko/framework";
 *
 * const route: NavigateRoute<"/guide"> = { to: "/guide", hash: "install", hreflang: "en" };
 * ```
 */
export interface NavigateRoute<K extends RouteId = RouteId> {
	/** ID de la ruta de destino, como `"/users/[id]"`: sólo las rutas que existen. */
	readonly to: K
	/** Fragmento de la URL, sin `#` (`"bio"` da `#bio`). */
	readonly hash?: string
	/**
	 * Idioma para los resolvedores de enlaces (`app.resolveLink`), como el atributo `hreflang` de
	 * `<MeekoLink>`: con `@meekojs/i18n`, `"en"` lleva a la versión en inglés de la ruta.
	 */
	readonly hreflang?: string
	/** `false` deja la URL tal como la construye `href()`, sin los resolvedores de enlaces, como `bind:resolve="false"`. */
	readonly resolve?: boolean
}

/**
 * Opciones de {@link navigate}.
 *
 * @since 1.10.0
 * @example
 * ```ts
 * import type { NavigateOptions } from "@meekojs/meeko/framework";
 *
 * const options: NavigateOptions = { replace: true, viewTransition: false };
 * ```
 */
export interface NavigateOptions {
	/** `true` sustituye la entrada actual del historial en lugar de añadir otra. */
	readonly replace?: boolean
	/** Activa o desactiva la View Transition de esta navegación; sin ella, la de `viewTransitions` en `meeko.config.ts`. */
	readonly viewTransition?: boolean
}

/**
 * Navega a una URL escrita como texto, relativa a la página actual o absoluta. Una URL de la
 * aplicación pasa por el router del cliente; otro origen o una URL sin página se cargan como
 * documento, como un enlace. Sólo sigue URL `http:` y `https:`: otro esquema, como `javascript:`,
 * rechaza con un `TypeError`. El texto no se comprueba con las rutas: para eso, use el destino tipado.
 *
 * @param url URL de destino, como `"/users/42?tab=actividad"` o `"https://example.com"`.
 * @param options `replace` y `viewTransition`.
 * @returns `true` cuando la página nueva se confirma; `false` si se cancela o se carga como documento.
 * @throws {Error} En el servidor, donde se usa `redirect()`, y fuera de una aplicación montada.
 * @since 1.10.0
 * @example
 * ```ts
 * import { navigate } from "@meekojs/meeko/framework";
 *
 * const back = new URLSearchParams(location.search).get("next") ?? "/";
 * await navigate(back, { replace: true });
 * ```
 */
export function navigate(url: string, options?: NavigateOptions): Promise<boolean>
/**
 * Navega desde el código de un componente o un composable del navegador, por el mismo router que
 * `<MeekoLink>`: ejecuta el middleware de ruta y los datos de la página, activa
 * `useNavigation().pending` y actualiza el historial; si falla, la página anterior sigue visible.
 * Recibe el destino tipado de `<MeekoLink>` (`to`, `params`, `search` y `hash`), que `meeko check`
 * comprueba. Se autoimporta en `app/` y puede llamarse también en un manejador de eventos o después
 * de un `await`.
 *
 * @param target Ruta de destino, con sus `params`, `search` y `hash`.
 * @param options `replace` y `viewTransition`.
 * @returns `true` cuando la página nueva se confirma; `false` si la navegación se cancela o la URL
 * se carga como documento. Rechaza con el error si la navegación falla.
 * @throws {Error} En el servidor (SSR, loaders, middleware), donde se usa `redirect()`, y fuera de
 * una aplicación montada con `mountClientApp`.
 * @since 1.10.0
 * @example
 * ```html
 * <script lang="ts">
 * const props = defineProps<{ userId: string }>();
 * async function save() {
 *   await api.users.update.post({ body: { id: props.userId } });
 *   await navigate({ to: "/users/[id]", params: { id: props.userId }, search: { saved: 1 } });
 * }
 * </script>
 * <template><button on:click="save">Guardar</button></template>
 * ```
 * @see https://github.com/meekojs/meeko/blob/main/docs/routing-navigation-reference.md#navegación-programática
 */
export function navigate<K extends RouteKey>(target: NavigateTarget<K>, options?: NavigateOptions): Promise<boolean>
export function navigate(target: string | NavigateTarget, options?: NavigateOptions): Promise<boolean> {
	return navigateApp(currentAppNavigation('navigate()'), target as Parameters<typeof navigateApp>[1], options)
}
