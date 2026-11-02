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

`meekoSortClasses` ordena las clases de cada atributo estático `class="…"` de la plantilla. En un elemento, el valor se normaliza siempre: espacios colapsados y sin clases repetidas. Con un orden elegido (cualquier valor menos `"off"`), también ordena y normaliza el `class` de una etiqueta de componente, que es la prop `class`, y las cadenas de `bind:class` (véase [Cadenas en expresiones](#cadenas-en-expresiones)); con `"off"`, esos valores se quedan como están.

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

## Cadenas en expresiones

`meekoClassFunctions` nombra las funciones cuyas cadenas son listas de clases, como `tailwindFunctions` de `prettier-plugin-tailwindcss`. Por defecto es `[]`, y sin un `meekoSortClasses` distinto de `"off"` no hace nada.

```js
export default {
	plugins: ['@meekojs/prettier-plugin'],
	meekoSortClasses: 'tailwind',
	meekoClassFunctions: ['tv', 'clsx', 'cn'],
}
```

```ts
const button = tv({
	base: 'flex text-white', // antes: 'text-white flex'
	variants: { size: { sm: 'p-1 text-sm', lg: on ? 'block p-4' : 'flex p-2' } },
	compoundVariants: [{ size: 'sm', class: 'mt-1 block' }],
})
```

- **Dónde.** En todo el JavaScript y TypeScript que Prettier formatee con el plugin cargado: `<script>`, `<script server>`, las expresiones de la plantilla y los archivos `.ts`, `.tsx`, `.js` y `.mjs`. No hace falta otro parser: el plugin ya sustituye el printer `estree` de Prettier y ordena el AST antes de imprimir. En un `.ts`, el orden sale del proyecto Meeko que contiene el archivo; con `"stylesheet"`, sólo de la hoja global.
- **Qué se ordena.** Los literales de cadena y las plantillas de cadena de los argumentos, a cualquier profundidad, a través de objetos, arrays, spreads, ternarios, `&&`, `||`, `??`, `+` y `as`. Sirve para `base`, `slots`, `variants`, `compoundVariants` y `compoundSlots` de `tv()`.
- **Qué no se ordena.** Las claves de un objeto, las comparaciones y la condición de un ternario, el cuerpo de una función, los argumentos de una llamada no nombrada (`cn(t('page title'))`), las plantillas etiquetadas, las cadenas fuera de una función nombrada y los valores con una secuencia de escape (`\t`, ` `), cuyos tokens no son el texto del código.
- **Nombres.** Se comparan literalmente, sin seguir los `import`: `tv` no cubre un alias ni `styles.tv(…)`, y un miembro se escribe entero (`styles.cn`).
- **Plantillas de cadena.** Los espacios junto a `${…}` no cambian, y un token pegado a `${…}` (`p-${size}`) no se mueve porque es sólo parte de una clase: `` `text-white flex p-${size} block` `` queda `` `flex text-white p-${size} block` ``. Lo mismo vale para los extremos de una concatenación con `+`. Una plantilla sin `${…}` se trata como una cadena.
- **Clases desconocidas y repetidas.** Las reglas de `class`: las desconocidas, primero; sin repetidas y con los espacios colapsados. Si el orden no se puede cargar, se avisa una vez y las cadenas sólo se normalizan.

Todo literal de esos argumentos se trata como lista de clases. Una cadena con espacios que no lo es, como el nombre de una variante (`defaultVariants: { size: 'x large' }`), también se reordena; en ese caso, usa un nombre sin espacios o `// prettier-ignore`.

`bind:class` sigue las mismas reglas sin necesidad de nombrar una función: `bind:class="on ? 'text-white flex' : ''"` queda `bind:class="on ? 'flex text-white' : ''"`. Depende sólo de `meekoSortClasses`, igual que el `class` estático.

### Servidor de lenguaje

El servidor de lenguaje formatea con el plugin del núcleo (`@meekojs/meeko/prettier`), que desde `1.8` conoce estas opciones y da el mismo resultado que este paquete: `prettier --check` pasa después de guardar. En un workspace no confiable no ordena nada, porque ordenar puede ejecutar código del proyecto.

### Junto a `prettier-plugin-tailwindcss`

Pueden convivir en un proyecto, en cualquier orden de `plugins`. El de Tailwind ordena al analizar y este al imprimir, así que, si ambos ven la misma cadena, gana `meekoSortClasses`. No repitas una función en `tailwindFunctions` y `meekoClassFunctions`: con `"tailwind"` el orden es el mismo, pero ese plugin también ordena las claves de los objetos y no quita las clases desconocidas repetidas, mientras que este sí las quita.

`pnpm -F @meekojs/prettier-plugin test` comprueba el resultado esperado, la idempotencia y la compilación de componentes reales.
