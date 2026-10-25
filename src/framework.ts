import { href as runtimeHref } from "./framework/router.js";
import type { RouteRecord } from "./framework/router.js";

export { createNavigator, createRouteManifest, matchRoute } from "./framework/router.js";
export { defineMeekoConfig } from "./framework/config-type.js";
export type { MeekoConfig } from "./framework/config-type.js";
export type { NavigationContext, Navigator, RouteMatch, RouteRecord } from "./framework/router.js";
export { mountClientApp } from "./framework/client.js";
export type { ClientApp, ClientAppOptions, ClientComponent, ClientRoute } from "./framework/client.js";
export { definePage, PageInputError } from "./framework/page.js";
export type { PageDefinition, PageLoadContext, PageSchema } from "./framework/page.js";
export { StateStore, useState } from "./framework/state.js";
export { defineRouteMiddleware } from "./framework/middleware.js";
export type { RouteMiddleware, RouteMiddlewareContext } from "./framework/middleware.js";
export { ClientError, createApiClient, createBrowserClientOptions, createPublicServerManifest, createRpcClient } from "./framework/clients.js";
export type { ApiClient, ApiOperation, ClientOptions, PublicApiEndpoint, PublicRpcEndpoint, PublicServerManifest, RpcClient, RpcOperation } from "./framework/clients.js";
export { createSocketClient, createSocketRegistry, useSocket, useSocketChannel } from "./framework/socket.js";
export type { SocketClient, SocketContract, SocketSchema, SocketClientOptions, SocketRegistry, SocketRegistryOptions } from "./framework/socket.js";

/** Augmented by generated declarations in .meeko/types/routes.d.ts. */
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

/** Builds a checked URL when the project's route declarations are installed. */
export function href<K extends RouteKey>(routes: readonly RouteRecord[], id: K, ...[options]: HrefArguments<K>): string {
  return runtimeHref(routes, id, options as Parameters<typeof runtimeHref>[2] | undefined);
}
