import { build } from "esbuild";

const common = {
  bundle: true,
  platform: "node",
  format: "esm",
  target: "node20",
  mainFields: ["module", "main"],
  banner: { js: "import { createRequire } from 'node:module'; const require = createRequire(import.meta.url);" },
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
// workspace has no Prettier.
await build({
  ...common,
  entryPoints: ["../meeko/src/language-server/main.ts"],
  outfile: "dist/server.js",
  external: ["@typescript/typescript6", "prettier", "prettier/*"],
});
