import { activeRouteManifest, href as runtimeHref } from "./framework/router.js";
import type { RouteRecord } from "./framework/router.js";
import type { ThemeChoice, ThemeToggleMessages } from "./framework/theme.js";

export { createNavigator, createRouteManifest, matchRoute } from "./framework/router.js";
export { defineMeekoConfig } from "./framework/config-type.js";
export type { MeekoConfig, RobotsConfig, SitemapConfig, StaticHeaderFile } from "./framework/config-type.js";
export { defineMeekoModule } from "./framework/module.js";
export type { MeekoHookable, MeekoHooks, MeekoModule, MeekoModuleContext, MeekoModuleDefinition, MeekoModuleEntry, MeekoModuleMeta, ModuleAutoImport, ModulePlugin, ModuleServerHandler } from "./framework/module.js";
export { definePlugin } from "./framework/plugin.js";
export type { MeekoPlugin, PluginApp, PluginErrorHandler, PluginErrorInfo, PluginRegistration } from "./framework/plugin.js";
export type { ErrorPageRecord, NavigationContext, Navigator, RouteMatch, RouteRecord } from "./framework/router.js";
export { mountClientApp } from "./framework/client.js";
export type { ClientApp, ClientAppOptions, ClientComponent, ClientRoute } from "./framework/client.js";
export { useNavigation, useRoute } from "./framework/navigation.js";
export type { NavigationState, RouteState } from "./framework/navigation.js";
export { definePage, PageInputError } from "./framework/page.js";
export type { ClientPageDefinition, ClientPageLoadContext, PageDefinition, PageHead, PageLoadContext, PageRender, PageSchema } from "./framework/page.js";
export { notFound, redirect, usePage } from "./framework/page-body.js";
export type { JsonShape, PageBodyHead, PageRequest, PageRequestOf, SerializableExport, ServerData } from "./framework/page-body.js";
export { StateStore, useState } from "./framework/state.js";
export { useForm } from "./framework/form.js";
export type { Form } from "./framework/form.js";
export { useStorage } from "./framework/storage.js";
export { useHead, useSeoMeta } from "./framework/head.js";
export type { DocumentConfig, DocumentHead, DocumentSeo, HeadInput, HeadLink, HeadMeta, HeadScript, HeadStyle, SeoMetaInput } from "./framework/head.js";
export type { StorageArea, StorageOptions } from "./framework/storage.js";
export { useTheme } from "./framework/theme.js";
export type { ThemeChoice, ThemeConfig, ThemeName, ThemeState, ThemeToggleMessages, ThemeToggleSnippets } from "./framework/theme.js";
export { defer } from "./framework/deferred.js";
export type { DeferOptions, Deferred, DeferredError, DeferredFactory, DeferredStatus } from "./framework/deferred.js";
export { defineRouteMiddleware } from "./framework/middleware.js";
export type { RouteMiddleware, RouteMiddlewareContext } from "./framework/middleware.js";
export { ClientError, createApiClient, createBrowserClientOptions, createPublicServerManifest, createRpcClient, isClientError } from "./framework/clients.js";
export type { ApiClient, ApiMutationInput, ApiOperation, ClientOptions, PublicApiEndpoint, PublicRpcEndpoint, PublicServerManifest, RpcClient, RpcOperation, ValidationIssue } from "./framework/clients.js";
export { createSocketClient, createSocketRegistry, useSocket, useSocketChannel, useSocketClient } from "./framework/socket.js";
export { createUseApi, createUseApiMutation, createUseRpcMutation, createUseRpcQuery } from "./framework/resources.js";
export type { ApiMutation, ApiMutationContract, ApiQueryContract, ApiQueryOptions, DataResource, LoadedResource, Reactive, RpcMutation, UseApi, UseApiMutation, UseRpcMutation, UseRpcQuery } from "./framework/resources.js";
export type { MutationAttempt, MutationFailure, MutationOptions, RetrySafeMutation, RetrySafeOptions, UncertainMutation } from "./framework/mutations.js";
export type { SocketClient, SocketContract, SocketSchema, SocketClientOptions, SocketRegistry, SocketRegistryOptions } from "./framework/socket.js";

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
 * {@link href}. `to` es el ID de la ruta; `params` y `search` se escriben con `bind:`. El resto de
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
