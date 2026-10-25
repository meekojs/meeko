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
// the server resolves the native tsc next to this file.
await build({
  ...common,
  entryPoints: ["../../src/language-server/main.ts"],
  outfile: "dist/server.js",
  external: ["@typescript/typescript6"],
});
