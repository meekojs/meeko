import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { dirname, isAbsolute, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { normalizePath, resolveConfig, transformWithOxc } from "vite";
import type { Plugin } from "vite";
import { compile } from "./compiler.js";
import { moduleSpecifiers } from "./compiler/import-graph.js";
import { sourceMapForCompiled } from "./compiler/sourcemap.js";
import { discoverAutoImports, transformAutoImports } from "./autoimports.js";
import { transformTypeScriptAutoImports, typeScriptAutoImportMap } from "./autoimports-ts.js";
import { discoverConfiguredRoutes, loadConfiguredModules, loadMeekoConfig, resolveConfigSources } from "./framework/config.js";
import { clientPluginsSource, clientRoutesSource, clientSidecarsSource, readBuildAppData, serverAppSource } from "./framework/app-manifest.js";
import { assertRouteBlockPlacement, isPageFile, routeBlockFile, routeBlockId, routeBlockSource, withoutRouteBlock } from "./framework/route-block.js";
import { extractRouteRender } from "./framework/routes-discovery.js";
import { devScanIgnored, isDevWatchIgnored, isDiscoverySource } from "./framework/dev-watch.js";
import { serverScriptModule } from "./framework/server-script.js";
import { editorBridgeDirectory } from "./framework/editor-bridge.js";

/**
 * A component's CSS is the module `Card.meeko?meeko-style=<hash>&lang.css`: a real path, as Vue
 * names its style blocks, so PostCSS plugins resolve files (Tailwind's `@reference`, a relative
 * `@import`) from the component's folder. The hash changes with the CSS, for hot updates.
 */
const styleQuery = /[?&]meeko-style=([0-9a-f]{64})&lang\.css$/;
const clientPagesModule = "virtual:meeko-client-pages";
const clientRoutesModule = "virtual:meeko-manifest/client";
const clientSidecarsModule = "virtual:meeko-client-routes";
const serverAppModule = "virtual:meeko-server-app";
const clientPluginsModule = "virtual:meeko-plugins/client";
const virtualModules = new Set([clientPagesModule, clientRoutesModule, clientSidecarsModule, serverAppModule, clientPluginsModule]);
/** A module that imports `defineMeekoModule` holds build code: the browser must never load it. */
const moduleDefinitionImport = /\bimport\s*\{[^}]*\bdefineMeekoModule\b[^}]*\}\s*from\s*["']@meekojs\/meeko\/framework["']/;
/** This package (its `src/` and `dist/`), whose documentation shows module imports in comments. */
const packageDirectory = `${normalizePath(resolve(dirname(fileURLToPath(import.meta.url)), ".."))}/`;

/** Source without block and line comments, close enough for an import check. */
function withoutComments(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:"'`\\])\/\/.*$/gm, "$1");
}

/** Files and directories of the configured modules that only the server may load. */
interface ModuleBoundary {
  /** Module entries (setup code), server plugins, server middleware and server handlers. */
  readonly serverFiles: ReadonlySet<string>;
  /** `addAutoImportsDir` directories with `scope: "server"`, ending in `/`. */
  readonly serverDirectories: readonly string[];
  /** Directories a module owns, ending in `/`: a `.server.ts` file there is server-only. */
  readonly ownedDirectories: readonly string[];
}

async function moduleBoundary(root: string): Promise<ModuleBoundary> {
  const { modules } = await loadConfiguredModules(root);
  const directory = (path: string): string => `${normalizePath(path).replace(/\/$/, "")}/`;
  return {
    serverFiles: new Set([
      ...modules.entryFiles, ...modules.plugins.filter((plugin) => plugin.mode === "server").map((plugin) => plugin.file),
      ...modules.serverMiddleware, ...modules.serverHandlers.map((handler) => handler.file),
    ].map((file) => normalizePath(file))),
    serverDirectories: modules.autoImportsDirs.filter((entry) => entry.scope === "server").map((entry) => directory(entry.dir)),
    ownedDirectories: modules.ownedDirectories.map(directory),
  };
}
const runtimeDirectory = `${normalizePath(dirname(fileURLToPath(import.meta.url)))}/`;

/** `server.fs.deny` pattern of the editor bridge descriptors, which hold the session token. */
const editorBridgeFsDeny = `**/${editorBridgeDirectory}/**`;

let viteFsDeny: Promise<string[]> | undefined;

/**
 * Vite's default `server.fs.deny`. A list returned from `config` replaces the default
 * when the user sets none, so the plugin adds its pattern to these.
 */
function defaultFsDeny(): Promise<string[]> {
  viteFsDeny ??= resolveConfig({ configFile: false, envDir: false, logLevel: "silent", plugins: [] }, "serve")
    .then((resolved) => [...resolved.server.fs.deny]);
  return viteFsDeny;
}

/** Maps each specifier inserted by an autoimport transform to the names it provides. */
function autoimportedSpecifiers(prefix: string): Map<string, string[]> {
  const result = new Map<string, string[]>();
  for (const line of prefix.split("\n")) {
    const match = /^import (?:type )?(?:\{ \S+ as (\S+) \}|\* as (\S+)) from ("(?:[^"\\]|\\.)*");$/.exec(line.trim());
    if (!match) continue;
    const specifier = JSON.parse(match[3]!) as string;
    result.set(specifier, [...result.get(specifier) ?? [], (match[1] ?? match[2])!]);
  }
  return result;
}

/**
 * Plugin de Vite de Meeko: compila los imports `.meeko` en cliente y SSR, añade HMR y CSS durante el
 * desarrollo, aplica los autoimports a `.meeko` y `.ts`, y en una aplicación del framework genera
 * los módulos virtuales de rutas, páginas y servidor y el módulo de cada `<script server>`.
 * `meeko dev` y `meeko build` lo configuran solos; añádalo a mano sólo con un host de Vite propio.
 *
 * @returns El plugin de Vite.
 * @example
 * ```ts
 * // vite.config.ts
 * import { defineConfig } from "vite";
 * import { meeko } from "@meekojs/meeko/vite";
 *
 * export default defineConfig({
 *   plugins: [meeko()],
 * });
 * ```
 * @see https://github.com/meekojs/meeko/blob/main/docs/api.md#herramientas
 */
export function meeko(): Plugin {
  let isDev = false;
  let ssrBuild = false;
  let workerBuild = false;
  let root = "";
  const styles = new Map<string, string>();
  /**
   * Whether a file under the project feeds autoimports or routes. `tree` also
   * counts the server modules that discovery lists, for an added or removed file.
   */
  const watchedSource = async (file: string, tree = false): Promise<boolean> => {
    const normalized = normalizePath(file);
    const normalizedRoot = normalizePath(root);
    if (!normalized.startsWith(`${normalizedRoot}/`) || normalized.startsWith(`${normalizedRoot}/meeko.config.`)) return false;
    const config = await loadMeekoConfig(root);
    const sources = await resolveConfigSources(root, config);
    for (const source of sources) {
      const prefix = `${normalizePath(source.root)}/`;
      if (!normalized.startsWith(prefix)) continue;
      const path = normalized.slice(prefix.length);
      const registrySource = /^(?:app\/(?:components|composables|utils|stores)|shared\/(?:types|schemas|utils|constants|enums)|server\/utils)\//.test(path) ||
        (config.imports?.serverDirs ?? []).some((directory) => path.startsWith(`${directory.replaceAll("\\", "/").replace(/\/$/, "")}/`));
      const routesSource = /^(?:app\/(?:pages|layouts|middleware|plugins)|server\/middleware)\//.test(path);
      if (registrySource || routesSource || (tree && isDiscoverySource(file, [source.root]))) return true;
    }
    return false;
  };
  return {
    name: "meeko:components",
    enforce: "pre",
    configResolved(config) {
      isDev = config.command === "serve";
      ssrBuild = Boolean(config.build.ssr);
      // Workers have no TCP: their bundle never carries the redis package.
      workerBuild = config.ssr?.target === "webworker";
      root = config.root;
    },
    async resolveId(id, importer) {
      if (virtualModules.has(id)) return `\0${id}`;
      const page = routeBlockFile(id);
      if (page !== undefined) {
        const resolved = await this.resolve(page, importer, { skipSelf: true });
        return resolved ? routeBlockId(resolved.id) : null;
      }
      return null;
    },
    async load(id, options) {
      const page = routeBlockFile(id);
      if (page !== undefined) {
        const filename = normalizePath(resolve(page));
        // Only a page of this project or its layers carries route options.
        if (!isPageFile(filename, (await resolveConfigSources(root)).map((entry) => entry.root))) {
          throw new Error(`Route options can only be loaded from a page under app/pages: ${filename}`);
        }
        this.addWatchFile(filename);
        const source = await readFile(filename, "utf8");
        const block = routeBlockSource(source, filename);
        if (block === undefined) throw new Error(`${filename} has no <script server> section`);
        // Top-level code runs per request inside a generated loader; it rejects render: "client".
        const body = serverScriptModule(source, filename);
        // Only `render: "client"` options are public; every other block stays on the server.
        if (!(options?.ssr || ssrBuild) && (body || extractRouteRender(filename, block) !== "client")) {
          throw new Error(`Server route options reached the client bundle: <script server> of ${filename}`);
        }
        return body ? { code: body.code, map: body.map as never } : block;
      }
      const virtual = id.startsWith("\0") ? id.slice(1) : undefined;
      if (virtual === clientRoutesModule) return clientRoutesSource(root);
      if (virtual === clientSidecarsModule) return clientSidecarsSource(root);
      if (virtual === serverAppModule) return serverAppSource(root, ssrBuild && !isDev ? await readBuildAppData(root) : undefined, { redis: !workerBuild });
      if (virtual === clientPluginsModule) {
        if (options?.ssr || ssrBuild) throw new Error(`${clientPluginsModule} belongs to the client bundle`);
        return clientPluginsSource(root);
      }
      if (virtual === clientPagesModule) {
        const routes = await discoverConfiguredRoutes(root);
        const unique = [...new Set(routes.flatMap((route) => [route.file, ...route.layouts, ...(route.error ? [route.error] : [])]))];
        const entries = unique.map((file) => {
          const path = relative(root, file).replaceAll("\\", "/");
          if (path === ".." || path.startsWith("../") || isAbsolute(path)) throw new Error(`Page outside Meeko project: ${file}`);
          const specifier = `/${path}`;
          return `${JSON.stringify(specifier)}: () => import(${JSON.stringify(specifier)})`;
        });
        return `export const modules = {${entries.join(",")}};`;
      }
      const style = styleQuery.exec(id)?.[1];
      return style === undefined ? null : styles.get(style) ?? null;
    },
    async transform(source, id, options) {
      const serverTransform = Boolean(options?.ssr || ssrBuild);
      const normalizedId = normalizePath(resolve(id));
      const normalizedRoot = normalizePath(root);
      const clientModule = !serverTransform && normalizedId.startsWith(`${normalizedRoot}/`);
      // Every component this plugin compiles, also one outside the project, follows the project's `css` options.
      const config = normalizedId.startsWith(`${normalizedRoot}/`) || id.endsWith(".meeko") ? await loadMeekoConfig(root) : undefined;
      const sources = normalizedId.startsWith(`${normalizedRoot}/`) ? await resolveConfigSources(root, config) : [];
      // Module code may live outside the project (a linked package): its boundary applies to any id.
      const boundary = serverTransform || normalizedId.startsWith(runtimeDirectory) ? undefined : await moduleBoundary(root);
      const serverDirectories = [...sources.map((entry) => `${normalizePath(entry.root)}/server/`), ...boundary?.serverDirectories ?? []];
      const serverOnly = (moduleId: string): boolean => serverDirectories.some((directory) => moduleId.startsWith(directory))
        || (boundary?.serverFiles.has(moduleId.replace(/\?.*$/, "")) ?? false);
      if (clientModule && (serverOnly(normalizedId) || /\.server\.[cm]?[jt]sx?$/.test(id))) {
        throw new Error(`Server-only module reached the client bundle: ${id}`);
      }
      if (boundary) {
        if (serverOnly(normalizedId) || (/\.server\.[cm]?[jt]sx?(?:\?|$)/.test(id) && boundary.ownedDirectories.some((directory) => normalizedId.startsWith(directory)))) {
          throw new Error(`Server-only module reached the client bundle: ${id}`);
        }
        const ownRuntime = normalizedId.startsWith(`${packageDirectory}dist/`) || normalizedId.startsWith(`${packageDirectory}src/`);
        if (/\.[cm]?[jt]sx?(?:\?|$)/.test(id) && !ownRuntime && moduleDefinitionImport.test(withoutComments(source))) {
          throw new Error(`Meeko module setup reached the client bundle: ${id}; only meeko.config.ts may import a module created with defineMeekoModule`);
        }
      }
      if (serverTransform && normalizedId.startsWith(`${normalizedRoot}/`) && /\.client\.[cm]?[jt]sx?$/.test(id)) {
        throw new Error(`Client-only module reached the server bundle: ${id}`);
      }
      const checkBoundary = async (code: string, original?: string): Promise<void> => {
        if (!clientModule) return;
        const autoimported = original === undefined ? new Map<string, string[]>() : autoimportedSpecifiers(code.slice(0, code.length - original.length));
        for (const { value } of moduleSpecifiers(code, id)) {
          const dependency = await this.resolve(value, id, { skipSelf: true });
          if (dependency && serverOnly(normalizePath(dependency.id))) {
            const names = autoimported.get(value);
            throw new Error(names
              ? `Client module ${id} imports server-only module ${value} through autoimport ${names.join(", ")}`
              : `Client module ${id} imports server-only module ${value}`);
          }
        }
      };
      if (!id.endsWith(".meeko")) {
        if (/\.[cm]?[jt]sx?$/.test(id) && clientModule) await checkBoundary(source);
        const routeBlock = routeBlockFile(id) !== undefined;
        if (/\.[cm]?tsx?$/.test(id) && normalizedId.startsWith(`${normalizedRoot}/`)) {
          const registry = await discoverAutoImports(root);
          // Only `render: "client"` sidecars reach the browser graph; they get browser autoimports.
          const clientSidecar = clientModule && (routeBlock || (/\.route\.[cm]?tsx?$/.test(id) && /\/app\/pages\//.test(normalizedId)));
          let transformed: string | undefined;
          try {
            // A route block lives in a `.meeko` under `app/`, so its scope cannot come from its path.
            const scope = clientSidecar ? "client" : routeBlock ? "server" : undefined;
            // Plain app/ modules resolve framework clients per graph, like a `.meeko` component.
            transformed = transformTypeScriptAutoImports(source, id, root, registry, sources.map((entry) => entry.root), scope, serverTransform);
          } catch (error) {
            const name = clientSidecar && error instanceof Error ? /^Autoimport (\S+) is unavailable/.exec(error.message)?.[1] : undefined;
            if (name) throw new Error(`Client route sidecar ${id} uses autoimport ${name}, which is not available in the browser; render: "client" sidecars must call API or RPC endpoints instead`, { cause: error });
            throw error;
          }
          if (transformed) {
            await checkBoundary(transformed, source);
            if (routeBlock) return transformWithOxc(transformed, `${routeBlockFile(id)!}.ts`, { lang: "ts" }, typeScriptAutoImportMap(source, transformed, id));
            return { code: transformed, map: typeScriptAutoImportMap(source, transformed, id) };
          }
        }
        if (routeBlock) return transformWithOxc(source, `${routeBlockFile(id)!}.ts`, { lang: "ts" });
        return null;
      }
      const filename = normalizePath(resolve(id));
      assertRouteBlockPlacement(source, filename, sources.map((entry) => entry.root));
      const scopeAttribute = config?.css?.scopeAttribute;
      const result = compile(source, filename, { hot: isDev, ...(scopeAttribute ? { scopeAttribute } : {}) });
      const styleHash = createHash("sha256").update(filename).update("\0").update(result.css).digest("hex");
      if (result.css) styles.set(styleHash, result.css);
      const cssImport = result.css ? `\nimport ${JSON.stringify(`${filename}?meeko-style=${styleHash}&lang.css`)};` : "";
      const hotCode = isDev ? `\nif (import.meta.hot) {\n  __meeko.enableHotModule(__hotId);\n  __meeko.connectLiveBridge(import.meta.hot);\n  import.meta.hot.accept((next) => { if (next) __meeko.replaceHotModule(__hotId, next); });\n}\n` : "";
      const registry = await discoverAutoImports(root);
      const code = transformAutoImports(source, filename, result.code, registry, serverTransform ? "server" : "client");
      await checkBoundary(code, result.code);
      const shifted = code.length - result.code.length;
      const mappings = result.mappings.map((mapping) => ({
        ...mapping,
        generatedStart: mapping.generatedStart + shifted,
        generatedEnd: mapping.generatedEnd + shifted,
      }));
      const generated = `${code}${cssImport}${hotCode}`;
      // The map embeds its source text; leave the server-only route options out of it.
      return transformWithOxc(generated, `${filename}.ts`, { lang: "ts" }, sourceMapForCompiled(generated, withoutRouteBlock(source, filename), filename, mappings));
    },
    async config(config, env) {
      if (env.command !== "serve") return undefined;
      // No page may fetch the editor bridge descriptors and their token. Vite appends
      // this to the user's `server.fs.deny`; without one, its defaults must stay.
      const deny = [...(config.server?.fs?.deny === undefined ? await defaultFsDeny() : []), editorBridgeFsDeny];
      // `server.watch: null` turns the watcher off; a merged object would turn it back on.
      if (config.server?.watch === null) return { server: { fs: { deny } } };
      // configResolved replaces this with the resolved root before the watcher starts.
      root = resolve(config.root ?? "");
      // Checks, editor tooling and builds rewrite `.meeko` files that Vite never
      // loads; Vite appends this matcher to the user's `server.watch.ignored`.
      return { server: { fs: { deny }, watch: { ignored: [(file: string) => isDevWatchIgnored(file, root)] } } };
    },
    configEnvironment: {
      // After every other plugin, so an input another plugin sets still wins over the HTML crawl.
      order: "post",
      handler(_name, config, env) {
        if (env.command !== "serve") return undefined;
        const entries = config.optimizeDeps?.entries;
        // Explicit entries stay; Vite appends the exclusion to them.
        if (entries !== undefined) return { optimizeDeps: { entries: [...devScanIgnored] } };
        // An input names the scan entries itself; explicit entries would replace it.
        if (config.input !== undefined || config.build?.rolldownOptions?.input !== undefined || config.build?.rollupOptions?.input !== undefined) return undefined;
        // Vite's default crawl, every HTML file except tests and coverage, now outside `.meeko`.
        return { optimizeDeps: { entries: ["**/*.html", "!**/__tests__/**", "!**/coverage/**", ...devScanIgnored] } };
      },
    },
    configureServer(server) {
      // A new or removed page, layout or server module changes discovery; Vite's
      // hot update only reports edits of files it already knows.
      const onTreeChange = (file: string): void => {
        void watchedSource(file, true).then((changed) => {
          if (!changed) return;
          server.moduleGraph.invalidateAll();
          server.ws.send({ type: "full-reload" });
        }, (error: unknown) => server.config.logger.error(String(error)));
      };
      server.watcher.on("add", onTreeChange);
      server.watcher.on("unlink", onTreeChange);
    },
    async handleHotUpdate({ file, server }) {
      const normalized = normalizePath(file);
      const configFile = normalized.startsWith(`${normalizePath(root)}/meeko.config.`);
      if (!normalized.startsWith(runtimeDirectory) && !configFile && !await watchedSource(file)) return;
      server.moduleGraph.invalidateAll();
      server.ws.send({ type: "full-reload" });
      return [];
    },
  };
}
