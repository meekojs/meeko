# Fixture: Tailwind CSS 4

App Meeko mínima con Tailwind CSS 4 mediante `@tailwindcss/postcss`, usada por
`tests/tailwind.test.ts`. El test la copia a un proyecto temporal (nunca se construye aquí) y
enlaza `@meekojs/meeko`, `tailwindcss`, `@tailwindcss/postcss` y `vite`.

- `app/styles/main.css`: `@import "tailwindcss"`, un `@theme` propio y un `@utilities` de Meeko.
- `app/components/Card.meeko`: `<style scoped>` con `@reference` y `@apply`, y una clase
  (`ring-4`) que sólo aparece en `bind:class`, junto al `class` estático del mismo elemento.
- `postcss.config.mjs`: `meekoUtilities()` antes de Tailwind.
