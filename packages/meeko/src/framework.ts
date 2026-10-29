import { activeRouteManifest, href as runtimeHref } from "./framework/router.js";
import type { RouteRecord } from "./framework/router.js";
import type { ThemeChoice, ThemeToggleMessages } from "./framework/theme.js";
import type { LayoutName as NamedLayoutName, LayoutProps as NamedLayoutProps } from "./framework/layout.js";
import type { AwaitMessages, AwaitResource } from "./framework/await.js";
import type { MeekoPopoverProps as PopoverProps } from "./builtins/popover.js";
import type { MeekoTeleportProps as TeleportProps } from "./teleport.js";
import type { MeekoSelectProps as SelectProps } from "./builtins/select.js";

export { createNavigator, createRouteManifest, matchRoute } from "./framework/router.js";
export { defineMeekoConfig } from "./framework/config-type.js";
export type { MeekoConfig, RobotsConfig, ServerHeaders, ServerResponseConfig, SitemapConfig, SitemapEntriesContext, SitemapEntry, StaticHeaderFile } from "./framework/config-type.js";
export { defineMeekoModule } from "./framework/module.js";
export type { MeekoHookable, MeekoHooks, MeekoModule, MeekoModuleContext, MeekoModuleDefinition, MeekoModuleEntry, MeekoModuleMeta, ModuleAutoImport, ModulePlugin, ModuleServerHandler } from "./framework/module.js";
export { definePlugin } from "./framework/plugin.js";
export type { MeekoPlugin, PluginApp, PluginErrorHandler, PluginErrorInfo, PluginRegistration } from "./framework/plugin.js";
export type { ErrorPageRecord, NamedLayoutRecord, NavigationContext, Navigator, RouteMatch, RouteRecord } from "./framework/router.js";
export { defineGroup, useLayout } from "./framework/layout.js";
export type { GroupDefinition, LayoutHandle, LayoutName, LayoutPropsInput, PageLayout, PageLayoutOptions } from "./framework/layout.js";
export { mountClientApp } from "./framework/client.js";
export type { ClientApp, ClientAppOptions, ClientComponent, ClientRoute } from "./framework/client.js";
export { useNavigation, useRoute } from "./framework/navigation.js";
export type { NavigationState, RouteState } from "./framework/navigation.js";
export { definePage, PageInputError } from "./framework/page.js";
export type { ClientPageDefinition, ClientPageLoadContext, PageCache, PageCacheContext, PageDefinition, PageHead, PageLoadContext, PageMemoryCache, PageRender, PageSchema } from "./framework/page.js";
export { notFound, redirect, usePage } from "./framework/page-body.js";
export type { JsonShape, PageBodyHead, PageRequest, PageRequestOf, SerializableExport, ServerData } from "./framework/page-body.js";
export { StateStore, useState } from "./framework/state.js";
export { useForm } from "./framework/form.js";
export type { Form, FormField, FormSubmission } from "./framework/form.js";
export { useStorage } from "./framework/storage.js";
export { useHead, useSeoMeta } from "./framework/head.js";
export type { DocumentConfig, DocumentHead, DocumentSeo, HeadInput, HeadLink, HeadMeta, HeadScript, HeadStyle, SeoMetaInput } from "./framework/head.js";
export type { StorageArea, StorageOptions } from "./framework/storage.js";
export { useTheme } from "./framework/theme.js";
export type { ThemeChoice, ThemeConfig, ThemeName, ThemeState, ThemeToggleMessages, ThemeToggleSnippets } from "./framework/theme.js";
// Types only: the code of <MeekoPopover> and <MeekoSelect> reaches a bundle only through the tags.
export type { PopoverExposed, PopoverMode, PopoverPlacement, PopoverRole, PopoverSnippets, PopoverToggleEvent, PopoverTrigger } from "./builtins/popover.js";
export type { SelectField, SelectFilter, SelectFilterContext, SelectModel, SelectOptionState, SelectSnippets } from "./builtins/select.js";
export { defer } from "./framework/deferred.js";
export type { DeferOptions, Deferred, DeferredError, DeferredFactory, DeferredStatus } from "./framework/deferred.js";
export { defineRouteMiddleware, defineServerRouteMiddleware } from "./framework/middleware.js";
export type { RouteMiddleware, RouteMiddlewareContext, RouteMiddlewareName, RouteMiddlewareOptions, ServerRouteMiddleware, ServerRouteMiddlewareContext } from "./framework/middleware.js";
export { ClientError, createApiClient, createBrowserClientOptions, createPublicServerManifest, createRpcClient, isClientError } from "./framework/clients.js";
export type { ApiClient, ApiMutationInput, ApiOperation, ClientOptions, PublicApiEndpoint, PublicRpcEndpoint, PublicServerManifest, RpcClient, RpcOperation, ValidationIssue } from "./framework/clients.js";
export { createSocketClient, createSocketRegistry, useSocket, useSocketChannel, useSocketClient } from "./framework/socket.js";
export { createUseApi, createUseApiMutation, createUseRpcMutation, createUseRpcQuery } from "./framework/resources.js";
export type { ApiMutation, ApiMutationContract, ApiQueryContract, ApiQueryOptions, DataResource, DataResourceOptions, LoadedResource, Reactive, RpcMutation, UseApi, UseApiMutation, UseRpcMutation, UseRpcQuery } from "./framework/resources.js";
export type { AwaitMessages, AwaitResource, MeekoAwaitSnippets } from "./framework/await.js";
export type { MutationAttempt, MutationFailure, MutationOptions, RetrySafeMutation, RetrySafeOptions, UncertainMutation } from "./framework/mutations.js";
export type { SocketClient, SocketContract, SocketSchema, SocketClientOptions, SocketRegistry, SocketRegistryOptions } from "./framework/socket.js";
export type { MeekoTeleportTarget } from "./teleport.js";

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
export type LayoutProps<L extends string | false = NamedLayoutName> = NamedLayoutProps<L>;

type RouteKey = keyof GeneratedRoutes extends never ? string : keyof GeneratedRoutes & string;
type RouteParams<K extends string> = K extends keyof GeneratedRoutes ? GeneratedRoutes[K] : Record<string, string>;
type HrefOptions<K extends string> = (keyof RouteParams<K> extends never
  ? { params?: never }
  : { params: RouteParams<K> }) & {
  search?: Readonly<Record<string, string | number | boolean | null | undefined>>;
};
type HrefArguments<K extends string> = K extends keyof GeneratedRoutes
  ? keyof RouteParams<K> extends never ? [options?: HrefOptions<K>] : [options: HrefOptions<K>]
  : [options?: HrefOptions<K>];

type RuntimeHrefOptions = Parameters<typeof runtimeHref>[2];

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
export type RouteId = RouteKey;

/**
 * Props de la etiqueta propia `<MeekoLink>`, que renderiza un `<a>` cuyo `href` construye
 * {@link href}. `to` es el ID de la ruta; `params` y `search` se escriben con `bind:`; `match`
 * elige si el enlace está activo sólo en su ruta o también por debajo (desde 1.5.0). El resto de
 * atributos (`class`, `target`, `aria-*`, `on:click`…) y el contenido pasan al `<a>`. El editor
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
export interface MeekoLinkProps<K extends RouteId = RouteId> {
  /**
   * ID de la ruta de destino, como `to="/users/[id]"`: sólo las rutas que existen. También admite
   * una expresión con `bind:to`.
   */
  readonly to: K;
  /**
   * Parámetros de una ruta dinámica, con `bind:params="{ id: user.id }"`. Son obligatorios en las
   * rutas con segmentos dinámicos y no se admiten en las demás.
   */
  readonly params?: RouteParams<K>;
  /**
   * Query string, con `bind:search="{ tab: 'perfil' }"`. Omite `null` y `undefined`.
   */
  readonly search?: Readonly<Record<string, string | number | boolean | null | undefined>>;
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
  readonly match?: "exact" | "prefix";
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
  readonly mode?: "cycle" | "select";
  /** Elecciones y su orden, como `bind:themes="['light', 'dark']"`; por defecto, los temas de la configuración y `"system"` si está activo. */
  readonly themes?: readonly ThemeChoice[];
  /** Nombre de cada elección, como `bind:labels="{ dark: 'Oscuro' }"`; por defecto, «Claro», «Oscuro», «Sistema» y el nombre de los demás temas. */
  readonly labels?: Partial<Record<ThemeChoice, string>>;
  /** Textos accesibles del botón y del grupo (`cycle(current, next)`, `unknown` y `group`), para traducirlos. */
  readonly messages?: ThemeToggleMessages;
  /** Clases del elemento raíz, el `<form>`. */
  readonly class?: string;
  /** `id` del elemento raíz, el `<form>`. */
  readonly id?: string;
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
  readonly for: AwaitResource | readonly AwaitResource[];
  /**
   * Reserva de altura: `reserve` recuerda la altura que tuvo la zona con datos y la aplica mientras
   * espera otra vez (en `sessionStorage`, por ruta, petición e instancia); `reserve="320px"` fija
   * además un mínimo, también en la primera visita.
   */
  readonly reserve?: boolean | string;
  /** Textos del aviso de error por defecto, sin el snippet `error`. */
  readonly messages?: AwaitMessages;
  /** Clases del contenedor, un `<div>`. */
  readonly class?: string;
  /** `id` del contenedor. */
  readonly id?: string;
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
export function href<K extends RouteKey>(id: K, ...options: HrefArguments<K>): string;
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
export function href<K extends RouteKey>(routes: readonly RouteRecord[], id: K, ...options: HrefArguments<K>): string;
export function href(first: string | readonly RouteRecord[], ...rest: unknown[]): string {
  if (typeof first === "string") return runtimeHref(activeRouteManifest(), first, rest[0] as RuntimeHrefOptions | undefined);
  return runtimeHref(first, rest[0] as string, rest[1] as RuntimeHrefOptions | undefined);
}
