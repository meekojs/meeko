/**
 * Node build tooling: discovery, configuration, prerender and adapter builds.
 * Server runtimes import `@meekojs/meeko/server` instead; this entry reads the
 * filesystem and loads TypeScript.
 */
export { discoverRoutes } from "./framework/routes-discovery.js";
export { composeFrameworkRoutes } from "./framework/modules.js";
export type { ComposeRoutesOptions, RouteLayer, RouteModule } from "./framework/modules.js";
export { discoverConfiguredRoutes, loadMeekoConfig, readMeekoConfigSync, resolveConfigSources } from "./framework/config.js";
export type { ConfigSource, MeekoConfig } from "./framework/config.js";
export type { MeekoAdapterName, MeekoServerConfig } from "./framework/config-type.js";
export { discoverServerManifest } from "./framework-server/manifest-discovery.js";
export { prerenderProject, prerenderRoutes } from "./framework/prerender.js";
export type { PrerenderIndex, PrerenderOptions } from "./framework/prerender.js";
export { buildProject } from "./framework/project.js";
export type { BuildProjectOptions, BuildProjectResult } from "./framework/project.js";
