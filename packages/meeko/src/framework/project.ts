// Entry point of the project commands (`meeko build`, `dev`, `start`, `preview`) for the CLI, the
// `./build` entry and the tests. Each responsibility lives in its own module:
// - build-outputs.ts: output folders and entries of each adapter;
// - prepare-project.ts: framework-owned entries in `.meeko/generated`;
// - build-assets.ts: asset manifest and client assets of the Vite build;
// - vite-config.ts: what modules add to the inline Vite configuration;
// - module-public-files.ts: public files of the modules;
// - build-project.ts: `meeko build` for every adapter, with its prerender;
// - start-project.ts: `meeko start` and `meeko preview`;
// - dev-server.ts: the `meeko dev` server.
export { frameworkClientEntry, frameworkServerEntry } from './app-manifest'
export { assetManifest } from './build-assets'
export { adapterEntry, adapterOutput, assertBuildAdapter, staticClientEntry } from './build-outputs'
export type { BuildProjectOptions, BuildProjectResult } from './build-project'
export { buildProject } from './build-project'
export { developmentServerPorts, devViteAllowedHosts, stopDevelopmentServer } from './dev-server'
export { prepareProject } from './prepare-project'
export { previewProject, startProject } from './start-project'
export { withSourcePackages } from './vite-config'
