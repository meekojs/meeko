import { createHash } from "node:crypto";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { normalizePath, transformWithOxc } from "vite";
import type { Plugin } from "vite";
import { compile } from "./compiler.js";

const stylePrefix = "\0virtual:meeko-style:";
const runtimeDirectory = `${normalizePath(dirname(fileURLToPath(import.meta.url)))}/`;

/** Transforma componentes .meeko para Vite, tanto en cliente como en SSR. */
export function meeko(): Plugin {
  let isDev = false;
  const styles = new Map<string, string>();
  return {
    name: "meeko:components",
    enforce: "pre",
    configResolved(config) {
      isDev = config.command === "serve";
    },
    resolveId(id) {
      if (id.startsWith("virtual:meeko-style:")) return `\0${id}`;
      return null;
    },
    load(id) {
      if (!id.startsWith(stylePrefix) || !id.endsWith(".css")) return null;
      return styles.get(id) ?? null;
    },
    async transform(source, id) {
      if (!id.endsWith(".meeko")) return null;
      const filename = normalizePath(resolve(id));
      const result = compile(source, filename, { hot: isDev });
      const styleId = `${stylePrefix}${createHash("sha256").update(filename).update("\0").update(result.css).digest("hex")}.css`;
      if (result.css) styles.set(styleId, result.css);
      const cssImport = result.css ? `\nimport ${JSON.stringify(styleId.slice(1))};` : "";
      const hotCode = isDev ? `\nif (import.meta.hot) {\n  __meeko.enableHotModule(__hotId);\n  import.meta.hot.accept((next) => { if (next) __meeko.replaceHotModule(__hotId, next); });\n}\n` : "";
      return transformWithOxc(`${result.code}${cssImport}${hotCode}`, `${filename}.ts`, { lang: "ts" });
    },
    handleHotUpdate({ file, server }) {
      if (!normalizePath(file).startsWith(runtimeDirectory)) return;
      server.ws.send({ type: "full-reload" });
      return [];
    },
  };
}
