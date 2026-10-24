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
import { discoverConfiguredRoutes } from "./framework/config.js";

const stylePrefix = "\0virtual:meeko-style:";
const pageModules = new Map<string, "client" | "server" | "routes">([
  ["virtual:meeko-client-pages", "client"],
  ["virtual:meeko-server-pages", "server"],
  ["virtual:meeko-server-routes", "routes"],
]);
const runtimeDirectory = `${normalizePath(dirname(fileURLToPath(import.meta.url)))}/`;

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
      if (pageModules.has(id)) return `\0${id}`;
      return null;
    },
    async load(id) {
      const kind = pageModules.get(id.slice(1));
      if (kind) {
        const routes = await discoverConfiguredRoutes(root);
        const files = kind === "routes"
          ? routes.flatMap((route) => route.sidecar ? [route.sidecar] : [])
          : routes.flatMap((route) => [route.file, ...route.layouts, ...(route.error ? [route.error] : [])]);
        const unique = [...new Set(files)];
        const entries = unique.map((file, index) => {
          const path = relative(root, file).replaceAll("\\", "/");
          if (path === ".." || path.startsWith("../") || isAbsolute(path)) throw new Error(`Page outside Meeko project: ${file}`);
          const specifier = `/${path}`;
          return kind === "client"
            ? `${JSON.stringify(specifier)}: () => import(${JSON.stringify(specifier)})`
            : `${JSON.stringify(specifier)}: module${index}`;
        });
        const imports = kind === "client" ? "" : unique.map((file, index) => {
          const path = relative(root, file).replaceAll("\\", "/");
          return `import * as module${index} from ${JSON.stringify(`/${path}`)};`;
        }).join("\n");
        return `${imports}\nexport const modules = {${entries.join(",")}};`;
      }
      if (!id.startsWith(stylePrefix) || !id.endsWith(".css")) return null;
      return styles.get(id) ?? null;
    },
    async transform(source, id, options) {
      const serverTransform = Boolean(options?.ssr || ssrBuild);
      const normalizedId = normalizePath(resolve(id));
      const normalizedRoot = normalizePath(root);
      const clientModule = !serverTransform && normalizedId.startsWith(`${normalizedRoot}/`);
      if (clientModule && (normalizedId.startsWith(`${normalizedRoot}/server/`) || /\.server\.[cm]?[jt]sx?$/.test(id))) {
        throw new Error(`Server-only module reached the client bundle: ${id}`);
      }
      if (serverTransform && normalizedId.startsWith(`${normalizedRoot}/`) && /\.client\.[cm]?[jt]sx?$/.test(id)) {
        throw new Error(`Client-only module reached the server bundle: ${id}`);
      }
      const checkBoundary = async (code: string): Promise<void> => {
        if (!clientModule) return;
        for (const { value } of moduleSpecifiers(code, id)) {
          const dependency = await this.resolve(value, id, { skipSelf: true });
          if (dependency && normalizePath(dependency.id).startsWith(`${normalizedRoot}/server/`)) {
            throw new Error(`Client module ${id} imports server-only module ${value}`);
          }
        }
      };
      if (!id.endsWith(".meeko")) {
        if (/\.[cm]?[jt]sx?$/.test(id) && clientModule) await checkBoundary(source);
        if (/\.[cm]?tsx?$/.test(id) && normalizedId.startsWith(`${normalizedRoot}/`)) {
          const registry = await discoverAutoImports(root);
          const transformed = transformTypeScriptAutoImports(source, id, root, registry);
          if (transformed) {
            await checkBoundary(transformed);
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
      await checkBoundary(code);
      const shifted = code.length - result.code.length;
      const mappings = result.mappings.map((mapping) => ({
        ...mapping,
        generatedStart: mapping.generatedStart + shifted,
        generatedEnd: mapping.generatedEnd + shifted,
      }));
      const generated = `${code}${cssImport}${hotCode}`;
      return transformWithOxc(generated, `${filename}.ts`, { lang: "ts" }, sourceMapForCompiled(generated, source, filename, mappings));
    },
    handleHotUpdate({ file, server }) {
      const normalized = normalizePath(file);
      const relative = normalized.slice(normalizePath(root).length + 1);
      const registrySource = /^(?:app\/(?:components|composables|utils|stores)|shared\/(?:types|schemas|utils|constants|enums)|server\/utils)\//.test(relative);
      const routesSource = /^(?:app\/pages|layers\/|modules\/)/.test(relative) || relative.startsWith("meeko.config.");
      if (!normalized.startsWith(runtimeDirectory) && !registrySource && !routesSource) return;
      server.moduleGraph.invalidateAll();
      server.ws.send({ type: "full-reload" });
      return [];
    },
  };
}
