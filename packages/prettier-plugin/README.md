# @meekojs/prettier-plugin

Plugin de Prettier para secciones TypeScript, plantilla y CSS de componentes `.meeko`.

```js
export default {
  plugins: ['@meekojs/prettier-plugin'],
  meekoIndentSections: true,
}
```

Requiere Prettier 3 y Meeko. Conserva el contrato de formato de la entrada anterior `@meekojs/meeko/prettier`, que sigue disponible por compatibilidad en Meeko 1.x. La implementación del paquete usa las entradas públicas `/compiler` y `/parse`; no importa archivos privados de Meeko.

`pnpm -F @meekojs/prettier-plugin test` comprueba el resultado esperado, la idempotencia y la compilación de componentes reales.
