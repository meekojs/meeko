import { defineConfig } from "vite";
import { meeko } from "@meekojs/meeko/vite";

/** Transforma la misma fuente .meeko para SSR y para el navegador. */
export default defineConfig({ plugins: [meeko()] });
