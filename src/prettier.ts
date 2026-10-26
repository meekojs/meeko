/**
 * Plugin de Prettier para componentes `.meeko`: `plugins: ["@meekojs/meeko/prettier"]`.
 * Formatea `<script>` y `<script server>` como TypeScript, `<style>` como CSS y la plantilla
 * como HTML con directivas e interpolaciones `{expr}` formateadas como expresiones TypeScript.
 */
export { default, languages, options, parsers, printers } from "./prettier/plugin.js";
export type { MeekoPrettierOptions } from "./prettier/plugin.js";
