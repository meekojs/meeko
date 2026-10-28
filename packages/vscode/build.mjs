import { build } from "esbuild";

const common = {
  bundle: true,
  platform: "node",
  format: "esm",
  target: "node20",
  mainFields: ["module", "main"],
  // Bundled CommonJS dependencies call `require`. The import is renamed: bundled modules of the
  // server import `createRequire` themselves, and a second top-level binding fails to load.
  banner: { js: "import { createRequire as __meekoCreateRequire } from 'node:module'; const require = __meekoCreateRequire(import.meta.url);" },
  sourcemap: true,
  logLevel: "info",
};

// Thin VS Code client.
await build({
  ...common,
  entryPoints: ["src/extension.ts"],
  outfile: "dist/extension.js",
  external: ["vscode"],
});

// Bundled fallback of the Meeko language server, used when the workspace has no
// @meekojs/meeko with `meeko-language-server`. TypeScript stays an installed dependency:
// the server resolves the native tsc next to this file. Prettier is installed too: it loads
// its language plugins from its own files, and formatting falls back to it when the
// workspace has no Prettier. Vite is never bundled: sorting classes by the stylesheet loads the
// project's own Vite, and only normalizes them when there is none.
await build({
  ...common,
  entryPoints: ["../meeko/src/language-server/main.ts"],
  outfile: "dist/server.js",
  external: ["@typescript/typescript6", "prettier", "prettier/*", "vite"],
});
