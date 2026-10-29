/**
 * Node build tooling: discovery, configuration, prerender and adapter builds.
 * Server runtimes import `@meekojs/meeko/server` instead; this entry reads the
 * filesystem and loads TypeScript.
 */
export { discoverErrorPage, discoverLayouts, discoverRoutes } from "./framework/routes-discovery.js";
export type { DiscoverErrorPageOptions, DiscoverRoutesOptions, StaticGroupOptions, StaticRouteOptions } from "./framework/routes-discovery.js";
export { discoverRouteMiddleware } from "./framework/route-middleware-discovery.js";
export type { RouteMiddlewareDiscovery } from "./framework/route-middleware-discovery.js";
export { composeFrameworkRoutes } from "./framework/modules.js";
export type { ComposeRoutesOptions, RouteLayer, RouteModule } from "./framework/modules.js";
export { discoverConfiguredRoutes, loadMeekoConfig, readMeekoConfigSync, resolveConfigSources } from "./framework/config.js";
export type { ConfigSource, MeekoConfig } from "./framework/config.js";
export type { MeekoAdapterName, MeekoServerConfig, RobotsConfig, SitemapConfig, StaticHeaderFile } from "./framework/config-type.js";
export { inlineScriptHashes, inlineStyleHashes } from "./framework/script-hashes.js";
export type { InlineScriptReport } from "./framework/script-hashes.js";
export { discoverServerManifest } from "./framework-server/manifest-discovery.js";
export { prerenderProject, prerenderRoutes } from "./framework/prerender.js";
export type { PrerenderIndex, PrerenderOptions } from "./framework/prerender.js";
export { buildProject } from "./framework/project.js";
export type { BuildProjectOptions, BuildProjectResult } from "./framework/project.js";
