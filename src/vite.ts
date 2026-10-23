import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { transformWithOxc } from "vite";
import type { Plugin } from "vite";
import { compile } from "./compiler.js";

const stylePrefix = "\0virtual:meeko-style:";

/** Transforma componentes .meeko para Vite, tanto en cliente como en SSR. */
export function meeko(): Plugin {
  return {
    name: "meeko:components",
    enforce: "pre",
    resolveId(id) {
      if (id.startsWith("virtual:meeko-style:")) return `\0${id}`;
      return null;
    },
    async load(id) {
      if (!id.startsWith(stylePrefix) || !id.endsWith(".css")) return null;
      const filename = id.slice(stylePrefix.length, -4);
      const source = await readFile(filename, "utf8");
      return compile(source, filename).css;
    },
    async transform(source, id) {
      if (!id.endsWith(".meeko")) return null;
      const filename = resolve(id);
      const result = compile(source, filename);
      const cssImport = result.css ? `\nimport ${JSON.stringify(`virtual:meeko-style:${filename}.css`)};` : "";
      return transformWithOxc(`${result.code}${cssImport}`, `${filename}.ts`, { lang: "ts" });
    },
    handleHotUpdate({ file, server }) {
      if (!file.endsWith(".meeko")) return;
      server.ws.send({ type: "full-reload" });
      return [];
    },
  };
}
