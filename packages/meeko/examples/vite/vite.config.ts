import { defineConfig } from "vite";
import { meeko } from "@meekojs/meeko/vite";

export default defineConfig({
  plugins: [meeko()],
});
