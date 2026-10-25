import { createHash } from "node:crypto";
import { dirname, isAbsolute, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { normalizePath, transformWithOxc } from "vite";
import type { Plugin } from "vite";
import { compile } from "./compiler.js";
import { moduleSpecifiers } from "./compiler/import-graph.js";
import { sourceMapForCompiled } from "./compiler/sourcemap.js";
import { discoverAutoImports, transformAutoImports } from "./autoimports.js";
import { transformTypeScriptAutoImports, typeScriptAutoImportMap } from "./autoimports-ts.js";
import { discoverConfiguredRoutes, loadMeekoConfig, resolveConfigSources } from "./framework/config.js";
import { clientRoutesSource, clientSidecarsSource, readBuildAppData, serverAppSource } from "./framework/app-manifest.js";

const stylePrefix = "\0virtual:meeko-style:";
const clientPagesModule = "virtual:meeko-client-pages";
const clientRoutesModule = "virtual:meeko-manifest/client";
const clientSidecarsModule = "virtual:meeko-client-routes";
const serverAppModule = "virtual:meeko-server-app";
const virtualModules = new Set([clientPagesModule, clientRoutesModule, clientSidecarsModule, serverAppModule]);
const runtimeDirectory = `${normalizePath(dirname(fileURLToPath(import.meta.url)))}/`;

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

/** Transforma componentes .meeko para Vite, tanto en cliente como en SSR. */
export function meeko(): Plugin {
  let isDev = false;
  let ssrBuild = false;
  let root = "";
  const styles = new Map<string, string>();
  return {
    name: "meeko:components",
    enforce: "pre",
    configResolved(config) {
      isDev = config.command === "serve";
      ssrBuild = Boolean(config.build.ssr);
      root = config.root;
    },
    resolveId(id) {
      if (id.startsWith("virtual:meeko-style:")) return `\0${id}`;
      if (virtualModules.has(id)) return `\0${id}`;
      return null;
    },
    async load(id) {
      const virtual = id.startsWith("\0") ? id.slice(1) : undefined;
      if (virtual === clientRoutesModule) return clientRoutesSource(root);
      if (virtual === clientSidecarsModule) return clientSidecarsSource(root);
      if (virtual === serverAppModule) return serverAppSource(root, ssrBuild && !isDev ? await readBuildAppData(root) : undefined);
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
      if (!id.startsWith(stylePrefix) || !id.endsWith(".css")) return null;
      return styles.get(id) ?? null;
    },
    async transform(source, id, options) {
      const serverTransform = Boolean(options?.ssr || ssrBuild);
      const normalizedId = normalizePath(resolve(id));
      const normalizedRoot = normalizePath(root);
      const clientModule = !serverTransform && normalizedId.startsWith(`${normalizedRoot}/`);
      const sources = normalizedId.startsWith(`${normalizedRoot}/`) ? await resolveConfigSources(root) : [];
      const serverDirectories = sources.map((entry) => `${normalizePath(entry.root)}/server/`);
      const serverOnly = (moduleId: string): boolean => serverDirectories.some((directory) => moduleId.startsWith(directory));
      if (clientModule && (serverOnly(normalizedId) || /\.server\.[cm]?[jt]sx?$/.test(id))) {
        throw new Error(`Server-only module reached the client bundle: ${id}`);
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
        if (/\.[cm]?tsx?$/.test(id) && normalizedId.startsWith(`${normalizedRoot}/`)) {
          const registry = await discoverAutoImports(root);
          // Only `render: "client"` sidecars reach the browser graph; they get browser autoimports.
          const clientSidecar = clientModule && /\.route\.[cm]?tsx?$/.test(id) && /\/app\/pages\//.test(normalizedId);
          let transformed: string | undefined;
          try {
            transformed = transformTypeScriptAutoImports(source, id, root, registry, sources.map((entry) => entry.root), clientSidecar ? "client" : undefined);
          } catch (error) {
            const name = clientSidecar && error instanceof Error ? /^Autoimport (\S+) is unavailable/.exec(error.message)?.[1] : undefined;
            if (name) throw new Error(`Client route sidecar ${id} uses autoimport ${name}, which is not available in the browser; render: "client" sidecars must call API or RPC endpoints instead`, { cause: error });
            throw error;
          }
          if (transformed) {
            await checkBoundary(transformed, source);
            return { code: transformed, map: typeScriptAutoImportMap(source, transformed, id) };
          }
        }
        return null;
      }
      const filename = normalizePath(resolve(id));
      const result = compile(source, filename, { hot: isDev });
      const styleId = `${stylePrefix}${createHash("sha256").update(filename).update("\0").update(result.css).digest("hex")}.css`;
      if (result.css) styles.set(styleId, result.css);
      const cssImport = result.css ? `\nimport ${JSON.stringify(styleId.slice(1))};` : "";
      const hotCode = isDev ? `\nif (import.meta.hot) {\n  __meeko.enableHotModule(__hotId);\n  import.meta.hot.accept((next) => { if (next) __meeko.replaceHotModule(__hotId, next); });\n}\n` : "";
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
      return transformWithOxc(generated, `${filename}.ts`, { lang: "ts" }, sourceMapForCompiled(generated, source, filename, mappings));
    },
    async handleHotUpdate({ file, server }) {
      const normalized = normalizePath(file);
      const normalizedRoot = normalizePath(root);
      const configFile = normalized.startsWith(`${normalizedRoot}/meeko.config.`);
      let sourceChanged = false;
      if (normalized.startsWith(`${normalizedRoot}/`) && !configFile) {
        const config = await loadMeekoConfig(root);
        const sources = await resolveConfigSources(root, config);
        for (const source of sources) {
          const prefix = `${normalizePath(source.root)}/`;
          if (!normalized.startsWith(prefix)) continue;
          const path = normalized.slice(prefix.length);
          const registrySource = /^(?:app\/(?:components|composables|utils|stores)|shared\/(?:types|schemas|utils|constants|enums)|server\/utils)\//.test(path) ||
            (config.imports?.serverDirs ?? []).some((directory) => path.startsWith(`${directory.replaceAll("\\", "/").replace(/\/$/, "")}/`));
          const routesSource = /^(?:app\/(?:pages|layouts|middleware)|server\/middleware)\//.test(path);
          if (registrySource || routesSource) { sourceChanged = true; break; }
        }
      }
      if (!normalized.startsWith(runtimeDirectory) && !configFile && !sourceChanged) return;
      server.moduleGraph.invalidateAll();
      server.ws.send({ type: "full-reload" });
      return [];
    },
  };
}
