import { defineConfig } from "vite";
import { meeko } from "@meekojs/meeko/vite";

export default defineConfig({
  plugins: [meeko()],
  build: {
    outDir: ".meeko/output/client",
    manifest: true,
    rollupOptions: { input: "app/entry-client.ts" },
  },
});
