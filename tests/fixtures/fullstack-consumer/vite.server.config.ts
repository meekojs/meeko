import { defineConfig } from "vite";
import { meeko } from "@meekojs/meeko/vite";

export default defineConfig({
  plugins: [meeko()],
  build: {
    ssr: "server/entry.ts",
    outDir: ".meeko/output/server",
    rollupOptions: { output: { entryFileNames: "entry.js" } },
  },
});
