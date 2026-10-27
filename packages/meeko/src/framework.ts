import { activeRouteManifest, href as runtimeHref } from "./framework/router.js";
import type { RouteRecord } from "./framework/router.js";

export { createNavigator, createRouteManifest, matchRoute } from "./framework/router.js";
export { defineMeekoConfig } from "./framework/config-type.js";
export type { MeekoConfig } from "./framework/config-type.js";
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
export type { DocumentConfig, HeadInput, HeadLink, HeadMeta, HeadScript, HeadStyle, SeoMetaInput } from "./framework/head.js";
export type { StorageArea, StorageOptions } from "./framework/storage.js";
export { defer } from "./framework/deferred.js";
export type { DeferOptions, Deferred, DeferredError, DeferredFactory, DeferredStatus } from "./framework/deferred.js";
export { defineRouteMiddleware } from "./framework/middleware.js";
export type { RouteMiddleware, RouteMiddlewareContext } from "./framework/middleware.js";
export { ClientError, createApiClient, createBrowserClientOptions, createPublicServerManifest, createRpcClient } from "./framework/clients.js";
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
