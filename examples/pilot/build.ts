import { copyFile, mkdir } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { build as bundleNodeServer } from "esbuild";
import { build as buildVite } from "vite";

const root = dirname(fileURLToPath(import.meta.url));
const output = resolve(root, ".output");
const viteConfig = resolve(root, "vite.config.ts");

/** Genera artefactos separados para navegador, componente SSR y servidor HTTP. */
export async function buildPilot(): Promise<void> {
  await buildVite({
    configFile: viteConfig,
    root,
    build: {
      outDir: resolve(output, "client"),
      emptyOutDir: true,
      rollupOptions: { input: resolve(root, "client.ts"), output: { entryFileNames: "client.js" } },
    },
  });
  await mkdir(resolve(output, "client"), { recursive: true });
  await copyFile(resolve(root, "style.css"), resolve(output, "client/style.css"));
  await copyFile(resolve(root, "../../assets/brand/meeko-logo.png"), resolve(output, "client/meeko-logo.png"));
  await buildVite({
    configFile: viteConfig,
    root,
    build: {
      ssr: resolve(root, "App.meeko"),
      outDir: resolve(output, "server"),
      emptyOutDir: true,
      rollupOptions: { output: { entryFileNames: "app.js" } },
    },
  });
  await bundleNodeServer({
    entryPoints: [resolve(root, "production-server.ts")],
    outfile: resolve(output, "server/http.js"),
    bundle: true,
    packages: "external",
    platform: "node",
    format: "esm",
    target: "node24",
    sourcemap: true,
  });
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  await buildPilot();
}
