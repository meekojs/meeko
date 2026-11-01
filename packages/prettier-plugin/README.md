# @meekojs/prettier-plugin

Plugin de Prettier para secciones TypeScript, plantilla y CSS de componentes `.meeko`.

```js
export default {
	plugins: ['@meekojs/prettier-plugin'],
	meekoIndentSections: true,
}
```

Requiere Prettier 3 y Meeko. Conserva el contrato de formato de la entrada anterior `@meekojs/meeko/prettier`, que sigue disponible por compatibilidad en Meeko 1.x. La implementación del paquete usa las entradas públicas `/compiler` y `/parse`; no importa archivos privados de Meeko.

## Orden de las clases

`meekoSortClasses` ordena las clases de cada atributo estático `class="…"` de la plantilla. No toca `bind:class` ni el `class` de una etiqueta de componente, que es una prop. El valor se normaliza siempre: espacios colapsados y sin clases repetidas.

| Valor            | Orden                                                                                                                                                  |
| ---------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `"off"`          | El del código (por defecto).                                                                                                                           |
| `"stylesheet"`   | Primera aparición en `app/styles/main.css`, procesada como en `meeko dev`, y después en el `<style>` del componente; las clases desconocidas, primero. |
| `"tailwind"`     | El oficial de Tailwind CSS 4, el mismo de `prettier-plugin-tailwindcss`; las clases que Tailwind no conoce, primero y en su orden.                     |
| `"alphabetical"` | Por código de carácter.                                                                                                                                |

```js
export default {
	plugins: ['@meekojs/prettier-plugin'],
	meekoSortClasses: 'tailwind',
	// Opcional; relativa a la raíz del proyecto Meeko. Por defecto, app/styles/main.css.
	meekoTailwindStylesheet: 'app/styles/main.css',
}
```

Con `"tailwind"`, el plugin carga el design system de la hoja `meekoTailwindStylesheet` con sus `@import`, `@theme`, `@plugin`, `@utility` y `@custom-variant`, usando el `tailwindcss` 4 instalado en el proyecto (es una dependencia opcional: no se instala con el plugin). Los módulos de `@plugin` se cargan con `@tailwindcss/node` (también en TypeScript) si el proyecto tiene `@tailwindcss/postcss` o `@tailwindcss/vite`; sin ellos, sólo módulos JavaScript. El design system se reutiliza entre archivos y se recarga cuando cambia la hoja o algo que importa. Si falta `tailwindcss`, la hoja no existe o Tailwind la rechaza, las clases no se ordenan y se avisa una vez. En un workspace no confiable del editor, `"stylesheet"` y `"tailwind"` se comportan como `"off"`, porque ejecutarían código del proyecto.

`prettier-plugin-tailwindcss` no reconoce el parser `meeko`; con `"tailwind"` no hace falta.

`pnpm -F @meekojs/prettier-plugin test` comprueba el resultado esperado, la idempotencia y la compilación de componentes reales.
