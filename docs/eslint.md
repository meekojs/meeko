# ESLint

`@meekojs/eslint-plugin` analiza componentes `.meeko` completos con ESLint 10 y Flat Config. Reutiliza el parser público de Meeko para las secciones y la plantilla, y TypeScript-ESLint para los scripts y las expresiones. No ejecuta la configuración ni genera archivos del proyecto.

## Instalación y configuración

```sh
pnpm add -D eslint jiti @meekojs/eslint-plugin
```

```ts
// eslint.config.ts
import { defineEslint } from '@meekojs/eslint-plugin'

export default defineEslint({
	ignores: ['**/coverage/**'],
	rules: {
		'meeko/button-has-type': 'error',
		'@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_' }],
	},
})
```

En Node, ESLint carga `eslint.config.ts` con `jiti` 2.2 o superior instalado en el consumidor. El helper devuelve un array Flat Config estándar: no genera archivos, no carga `meeko.config.ts` y no necesita un composer. `meeko init` no crea esta configuración: el archivo es tuyo.

## Opciones de defineEslint

Las tres opciones de lenguaje están activadas por defecto:

| Opción          | Efecto                                                                                                                                                                          |
| --------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `javascript`    | Activa el preset recomendado de ESLint para `.js`, `.mjs` y `.cjs`.                                                                                                             |
| `typescript`    | Activa el preset recomendado de TypeScript-ESLint, sin tipos, para `.ts`, `.tsx`, `.mts` y `.cts`.                                                                              |
| `meeko`         | Activa el parser y las reglas recomendadas del plugin para `.meeko`. Es independiente de `typescript`.                                                                          |
| `perfectionist` | Sin la opción, ordena sólo los imports. `true` ordena casi todo, salvo clases y módulos. `false` no ordena nada. Véase [Ordenar con Perfectionist](#ordenar-con-perfectionist). |
| `unusedImports` | Optativo, por defecto `false`. Elimina imports sin uso y centraliza el aviso de variables sin uso.                                                                              |
| `ignores`       | Añade patrones globales de exclusión.                                                                                                                                           |
| `rules`         | Personaliza reglas conocidas del núcleo, TypeScript-ESLint y Meeko con opciones tipadas.                                                                                        |

La base recomendada de JavaScript también se aplica a los scripts de los lenguajes habilitados: por ejemplo, detecta `debugger` dentro de `.meeko`. Después se aplican las excepciones de cada lenguaje. Los globals de Node o navegador se configuran explícitamente en los overrides; el helper no presupone el runtime de la aplicación.

Se excluyen por defecto `**/node_modules/**`, `**/dist/**`, `**/.meeko/**`, `**/*.d.meeko.ts` y `**/*.generated.ts`. `ignores` añade patrones a esa lista. No se ignoran los componentes `*.meeko`.

Las reglas personalizadas se aplican por ámbito: las del núcleo a los lenguajes habilitados, las `@typescript-eslint/*` a TS y/o Meeko, y las `meeko/*` a los componentes. El namespace `perfectionist/*` se admite salvo con `perfectionist: false`, y `unused-imports/*` requiere `unusedImports: true`; ambos se aplican a los lenguajes habilitados. Seleccionar una regla de un namespace desactivado produce un error; desactivar todos los lenguajes también produce un error. `typescript: false` permite incorporar tu propio preset TypeScript mientras mantienes Meeko.

Los nombres y las opciones de reglas están tipados: una regla desconocida, un nivel inválido o `['error', { allow: true }]` en una regla Meeko sin opciones fallan al comprobar `eslint.config.ts`. Los tipos del núcleo vienen de la API pública de ESLint. Los tipos TypeScript-ESLint son un snapshot reproducible de los `meta.schema` públicos de la versión fijada, generado mediante `pnpm types:generate`. Representan la forma, claves y enums del esquema; límites numéricos, expresiones regulares y combinaciones semánticas se validan por ESLint en ejecución. Perfectionist publica tipos de opciones precisos desde su entrada pública y el helper los reutiliza directamente. Las opciones de unused-imports reutilizan el snapshot de `no-unused-vars`; las pruebas comprueban que ambos esquemas públicos siguen siendo idénticos. El generador no forma parte del código que carga el consumidor.

Los argumentos posteriores a las opciones son overrides Flat Config normales y ganan al final:

```ts
export default defineEslint({ rules: { 'meeko/button-has-type': 'error' } }, { files: ['tests/**/*.ts'], rules: { '@typescript-eslint/no-explicit-any': 'off' } })
```

Configura plugins adicionales y sus reglas dentro de esos overrides, donde se conserva la API Flat Config completa. El helper rechaza activar desde `options.rules` reglas TypeScript-ESLint que necesiten información de tipos, como `no-floating-promises`; sí permite desactivarlas con `off` o `0`. Los overrides de TS pueden configurar su propio análisis tipado y sus reglas. El parser de `.meeko` sigue siendo sintáctico y rechaza `project`, `projectService` y `programs`.

## Ordenar con Perfectionist

Perfectionist viene como dependencia del helper. Todas sus reglas emiten `warn`, con `type: 'natural'` y `order: 'asc'`: el orden natural coloca `item2` antes que `item10`.

| `perfectionist` | Qué ordena                                                                                                            |
| --------------- | --------------------------------------------------------------------------------------------------------------------- |
| Sin la opción   | Sólo los imports: `sort-imports` y `sort-named-imports`.                                                              |
| `true`          | Además, el resto del conjunto `recommended-natural` que publica Perfectionist, salvo `sort-classes` y `sort-modules`. |
| `false`         | Nada: no registra el plugin, y declarar una regla `perfectionist/*` en `rules` produce un error.                      |

Sin la opción, `eslint --fix` sólo mueve imports. En declaraciones de import se fija `sortSideEffects: false` y se desactiva la detección experimental de dependencias. No se activa resolución de tsconfig. Los imports de efectos secundarios sin bindings se conservan en su orden; los imports con bindings sí pueden cambiar de posición por el orden elegido.

`perfectionist: true` no copia la lista de Perfectionist, así que una regla nueva llega con su versión: exports, objetos, interfaces, tipos, uniones e intersecciones, enums, `switch`, `Set`, `Map`, `includes`, variables, decoradores, cláusulas `implements` y atributos de import. Se aplican a `.js`, `.ts` y al `<script>` de un `.meeko`, incluidas las expresiones de su plantilla. En un `<script server>` no avisan `sort-exports` y `sort-named-exports`, porque el parser convierte ese bloque en un ámbito de función y sus exports no forman parte del árbol; las demás sí. `sort-jsx-props` sólo tiene efecto en `.tsx`, porque una plantilla Meeko no es JSX. Perfectionist no ordena los atributos de la plantilla: eso es [`meeko/attributes-order`](../packages/eslint-plugin/docs/rules/attributes-order.md).

`sort-arrays` y `sort-constructor-parameters` no forman parte del conjunto, porque Perfectionist les exige `useConfigurationIf` para decir a qué aplican; si las activas con esa opción, `settings.perfectionist` les da el mismo orden.

Para personalizar un orden utiliza las opciones públicas de las reglas: como en Flat Config, sustituir una regla sustituye sus opciones, no las combina en profundidad. Para apagar una regla concreta, ponla a `off` en `rules` o en un override; para eximir un solo caso en un script, usa un comentario `// eslint-disable-next-line perfectionist/sort-objects`, que una plantilla no admite. `sort-imports` y `sort-named-imports` pasarán a `error` en 2.0; para exigirlas antes, sobrescribe sólo la severidad, y así se conservan las opciones naturales:

```ts
export default defineEslint({
	perfectionist: true,
	rules: {
		'perfectionist/sort-objects': 'off',
		'perfectionist/sort-imports': 'error',
		'perfectionist/sort-named-imports': 'error',
	},
})
```

`eslint --fix` corrige estos avisos; una ejecución con `--max-warnings 0` también falla si quedan avisos. El monorepo de Meeko no declara la opción, de modo que sólo ordena imports, y exige como `error` sus dos reglas: el conjunto completo daba allí 21766 avisos, y cada regla necesita su propia revisión antes de un arreglo.

### sort-classes y sort-modules

`perfectionist: true` no las activa, porque su `--fix` rompe código válido sin que la regla pueda detectarlo:

| Regla          | Antes del arreglo                                                                                                  | Después del arreglo                                                                                                                         |
| -------------- | ------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------- |
| `sort-classes` | `class K { z = 1; a = this.calc(); calc() { return this.z + 1 } }` da `a === 2`: la dependencia pasa por un método | Da `NaN`; los campos con efectos también cambian de orden                                                                                   |
| `sort-modules` | `class Z {}`, `function getZ() { return Z }`, `class A { static v = getZ() }` funciona                             | Lanza `ReferenceError`, porque `A` se evalúa antes que `Z`; los decoradores de registro y los `static` con efectos también cambian de orden |

Si las quieres, actívalas en `rules` o en un override. Heredan el orden natural de `settings.perfectionist`, también sin la opción:

```ts
export default defineEslint({
	perfectionist: true,
	rules: {
		'perfectionist/sort-classes': 'warn',
		'perfectionist/sort-modules': 'warn',
	},
})
```

`sort-modules` tampoco avisa en un `<script server>`, por la misma razón que `sort-exports`. Revisa el diff de su arreglo igual que el del resto.

### Revisa el diff de --fix

Con `perfectionist: true` no se excluyen las demás reglas, porque es una opción explícita, pero ordenar sólo es seguro cuando el orden no se observa, y estas reglas no pueden saber cuándo se observa. Respetan las dependencias directas (`a = this.z + 1`), los `case` que caen en el siguiente, `switch (true)`, los enums con valores implícitos y los límites de un spread, pero estos casos cambian de comportamiento al corregirlos:

| Regla                                                                   | Antes del arreglo                                                                                                                                | Después del arreglo                                                                                 |
| ----------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------ | --------------------------------------------------------------------------------------------------- |
| `sort-objects`                                                          | `Object.keys({ z: 1, a: 2 })` da `z, a`, y un `each:of` pinta en ese orden                                                                       | Da `a, z`, y `JSON.stringify` también cambia                                                        |
| `sort-objects`                                                          | `{ z: next(), a: next() }` evalúa `z` primero                                                                                                    | Evalúa `a` primero; pasa lo mismo con claves calculadas y con valores por defecto al desestructurar |
| `sort-objects`                                                          | `{ [key]: 'calculada', a: 'literal' }`, con `key === 'a'`, se queda con `'literal'`                                                              | Se queda con `'calculada'`                                                                          |
| `sort-maps`, `sort-sets`                                                | La iteración sigue el orden escrito: una tabla `new Map([['/z/x', 1], ['/a', 2], ['/z', 3]])` que busca la primera coincidencia encuentra `/z/x` | Encuentra `/z`                                                                                      |
| `sort-exports`                                                          | `export { z } from './z'` evalúa `./z` antes que `./a`                                                                                           | Evalúa `./a` primero                                                                                |
| `sort-decorators`                                                       | `@z @a class K {}` aplica `a` y después `z`                                                                                                      | Aplica `z` y después `a`                                                                            |
| `sort-variable-declarations`, `sort-array-includes`, `sort-switch-case` | `let z = next(), a = next()` evalúa `z` primero; igual los elementos de un array y los `case` con llamadas                                       | Evalúa `a` primero                                                                                  |

Sólo cambian tipos, sin efecto en ejecución, `sort-interfaces`, `sort-object-types`, `sort-union-types`, `sort-intersection-types` y `sort-heritage-clauses`. Si un orden importa, exímelo con el comentario o apaga la regla.

### Qué cambia en el HTML de un componente

En un `.meeko`, esas reglas llegan al `<script>`, al `<script server>` y a las expresiones de la plantilla, y el arreglo se ve en el HTML que se pinta. Este componente:

```html
<script lang="ts">
const labels = { z: 'Zeta', a: 'Alfa' }
const attrs = { title: 'x', id: 'y' }
const box = { 'padding-left': '4px', padding: '0' }
const boxStyle = Object.entries(box)
	.map(([name, value]) => `${name}:${value}`)
	.join(';')
</script>

<template>
	<ul>
		<li
			each:of="Object.values(labels)"
			each:as="label"
			each:key="label"
		>
			{label}
		</li>
	</ul>
	<div bind="attrs" />
	<p bind:style="boxStyle" />
</template>
```

cambia así tras `eslint --fix`, sin ningún error:

| Origen                                                        | HTML antes del arreglo               | HTML después del arreglo             |
| ------------------------------------------------------------- | ------------------------------------ | ------------------------------------ |
| `Object.values(labels)`, igual en `new Set(['zeta', 'alfa'])` | `Zeta`, `Alfa`                       | `Alfa`, `Zeta`                       |
| `bind="attrs"`                                                | `<div title="x" id="y">`             | `<div id="y" title="x">`             |
| `Object.entries(box)`                                         | `style="padding-left:4px;padding:0"` | `style="padding:0;padding-left:4px"` |

En el último caso el arreglo también cambia lo que se ve: antes `padding` anulaba a `padding-left`, y después gana `padding-left`. Pasa igual con un objeto escrito dentro de la plantilla, como `each:of="Object.keys({ z: 1, a: 2 })"`, y con los datos de un `<script server>`: `export const data = { z: 1, a: 2 }` queda `{ a: 2, z: 1 }`, y un `Object.keys(data)` en la plantilla los recorre en el orden nuevo. Si un objeto define un orden de presentación, usa un array, que `sort-objects` no toca, o exime ese objeto con el comentario.

## Limpiar imports sin uso

El plugin viene como dependencia del helper y se activa con su opción:

```ts
import { defineEslint } from '@meekojs/eslint-plugin'

export default defineEslint({
	unusedImports: true,
	rules: {
		'unused-imports/no-unused-vars': [
			'error',
			{
				vars: 'all',
				varsIgnorePattern: '^_',
				args: 'after-used',
				argsIgnorePattern: '^_',
			},
		],
	},
})
```

`unusedImports: true` activa `unused-imports/no-unused-imports: 'error'` y `unused-imports/no-unused-vars: 'error'`. La segunda permite variables y argumentos con prefijo `_`. Los avisos originales `no-unused-vars` y `@typescript-eslint/no-unused-vars` quedan desactivados para evitar duplicados. Reactivarlos en `options.rules` produce un error explícito que indica usar `unused-imports/no-unused-vars`; los overrides finales siguen conservando el control normal de Flat Config.

`eslint --fix` puede entonces ordenar imports y eliminar los realmente sin uso en los archivos seleccionados. Los usados sólo en la plantilla, etiquetas de componentes, tipos o restricciones genéricas se conservan. Los bloques `<script>` y `<script server>` tienen límites de tokens propios: ordenar y eliminar imports no cruza esos límites ni consume `</script>` o `<template>`. Las pruebas cubren imports únicos/finales, bloques adyacentes en ambos órdenes, comentarios, CRLF y la idempotencia de ambas correcciones juntas. La limpieza de variables que no son imports sigue siendo un aviso de error, sin autofix de eliminación por defecto.

## Orden de componentes e imports de tipos

Las reglas de estilo de componentes son optativas y tienen opciones tipadas en `defineEslint`:

```ts
export default defineEslint({
	unusedImports: true,
	rules: {
		'meeko/order-macros': [
			'error',
			{
				order: ['defineProps', 'defineEmits', 'defineModel', 'defineSnippets', 'useElementRef', 'defineExpose'],
			},
		],
		'meeko/padding-line-between-macros': 'error',
		'meeko/order-sections': [
			'error',
			{
				order: ['server', 'script', 'template', 'style'],
			},
		],
		'meeko/prefer-static-bindings': 'warn',
		'meeko/attributes-order': ['warn', { alphabetical: false }],
		'@typescript-eslint/consistent-type-imports': [
			'error',
			{
				prefer: 'type-imports',
				fixStyle: 'separate-type-imports',
			},
		],
	},
})
```

Esos órdenes son los predeterminados: también puedes usar simplemente `'error'`. Estas reglas `meeko/*` sólo se aplican a `.meeko`; los imports de tipos se comprueban tanto en TypeScript como en los scripts de componentes.

`padding-line-between-macros` exige al menos una línea en blanco después de cada macro cuando hay otra declaración o instrucción debajo: macros, variables, funciones o tipos. También contempla macros multilínea o de la misma clase. Su autofix conserva comentarios, indentación y LF/CRLF; funciona junto con el orden de macros. No añade separación al final del script si no hay más código. No admite opciones. Consulta la [regla de separación de macros](../packages/eslint-plugin/docs/rules/padding-line-between-macros.md).

`order-macros` detecta el orden de las macros de componente. Su autofix se limita a bloques consecutivos seguros: las dependencias, las llamadas con posibles efectos secundarios y los comentarios impiden mover declaraciones automáticamente. `defineExpose` se revisa manualmente para conservar las declaraciones que necesita. `order-sections` comprueba la posición de las secciones del SFC. `prefer-static-bindings` simplifica bindings literales sólo cuando puede conservar su semántica, por ejemplo `bind:title="'Guardar'"` a `title="Guardar"`. Los casos dinámicos siguen siendo bindings.

En `.meeko`, la integración de `consistent-type-imports` mantiene un estado independiente por script. Dos imports del mismo módulo en servidor y cliente no se combinan entre secciones, incluso al corregir imports mixtos de valores y tipos.

Estas reglas no forman parte de `recommended`; se activan explícitamente en la configuración del repositorio. Para corregir un archivo seleccionado:

```sh
pnpm exec eslint app/components/Example.meeko --fix
```

## Uso directo del plugin

La regla optativa [`meeko/attributes-order`](../packages/eslint-plugin/docs/rules/attributes-order.md) ordena por grupos: `ref:`, `each:*`, condicionales, definición, atributos planos, modelos, `bind:`, spread, eventos y contenido. Admite `order` y `alphabetical`; su autofix sólo cambia el orden de expresiones sin efectos y evita colisiones; si una puede tener efectos, ofrece una sugerencia. No se activa por defecto en `defineEslint` ni en `recommended`.

La regla optativa [`meeko/html-self-closing`](../packages/eslint-plugin/docs/rules/html-self-closing.md) cierra con `/>` los elementos y componentes sin ningún nodo hijo (`<div></div>` pasa a `<div />`), con opciones `'always'`, `'never'` o `'any'` para `html.normal`, `html.void`, `component`, `svg` y `math`, e `ignoreWhitespace` para tratar como vacío el contenido de sólo saltos de línea y sangría. Con Meeko `1.7`, que no admite `<div />`, no comprueba los elementos HTML no vacíos. Tampoco se activa en `recommended` en `1.x`, para no generar diffs en proyectos existentes.

La exportación por defecto y las configuraciones existentes continúan disponibles:

```js
import meeko from '@meekojs/eslint-plugin'

export default [...meeko.configs.recommended]
```

La configuración `recommended` del plugin aplica únicamente a `**/*.meeko`: registra el parser, las macros y etiquetas integradas, activa `@typescript-eslint/no-unused-vars` y las dos reglas de plantilla. Desactiva `no-unused-vars` y `no-undef` del núcleo, como corresponde al código TypeScript y sus autoimports. Los argumentos y variables con prefijo `_` se permiten como deliberadamente ignorados.

`configs.base` registra sólo parser, plugin y globals. Puedes combinar `recommended` con tu configuración JS/TS habitual. Quita cualquier exclusión global `**/*.meeko` de la configuración existente: los archivos globalmente ignorados no llegan al parser.

```sh
pnpm exec eslint 'app/**/*.meeko'
```

El paquete incluye su propia API de compilador TypeScript 6 para TypeScript-ESLint. La aplicación puede seguir usando TypeScript 7 con `meeko check`.

## Qué comprende

- Los bloques `<script lang="ts">` y `<script server lang="ts">`, incluyendo imports y datos exportados del servidor.
- Referencias desde interpolaciones, directivas `bind`, `on:*`, `model`, `html`, condiciones, claves de listas y componentes dinámicos.
- Componentes importados utilizados como etiquetas, incluyendo sustituciones de etiquetas integradas.
- Ámbitos de `each:as`, `each:index`, parámetros de snippets y callbacks: una variable de lista no marca como utilizada otra variable homónima del script.
- Condiciones de snippets evaluadas fuera de sus parámetros.
- Nombres genéricos del componente y referencias a sus restricciones.
- Posiciones UTF-16 sobre el archivo original, incluidos CRLF, caracteres Unicode y entidades HTML de atributos.

Los imports y locales del bloque servidor permanecen en su ámbito. Una referencia exclusiva del servidor no convierte en utilizada una variable del script de componente. Las declaraciones exportadas por el servidor cuentan como publicadas; sus datos pueden leerse en la plantilla.

## Reglas propias

| Regla                                                                                            | Nivel recomendado | Corrección                                   |
| ------------------------------------------------------------------------------------------------ | ----------------- | -------------------------------------------- |
| [`meeko/button-has-type`](../packages/eslint-plugin/docs/rules/button-has-type.md)               | warning           | Suggestions para elegir `button` o `submit`. |
| [`meeko/html-self-closing`](../packages/eslint-plugin/docs/rules/html-self-closing.md)           | optativo          | Autofix de `<div></div>` a `<div />`.        |
| [`meeko/no-autofocus`](../packages/eslint-plugin/docs/rules/no-autofocus.md)                     | warning           | Suggestion para quitar el atributo.          |
| [`meeko/order-macros`](../packages/eslint-plugin/docs/rules/order-macros.md)                     | optativo          | Autofix conservador de macros consecutivas.  |
| [`meeko/order-sections`](../packages/eslint-plugin/docs/rules/order-sections.md)                 | optativo          | Orden de secciones del componente.           |
| [`meeko/prefer-static-bindings`](../packages/eslint-plugin/docs/rules/prefer-static-bindings.md) | optativo          | Simplifica bindings literales equivalentes.  |
| [`meeko/prefer-ui-components`](../packages/eslint-plugin/docs/rules/prefer-ui-components.md)     | optativo          | Sin corrección: indica el componente de UI.  |

Las suggestions de `button-has-type` y `no-autofocus` requieren una elección explícita: no cambian el comportamiento de un formulario o el foco mediante `eslint --fix`.

## Parser y servicios

```js
import parser from '@meekojs/eslint-plugin/parser'

export default [
	{
		files: ['**/*.meeko'],
		languageOptions: { parser },
	},
]
```

El parser devuelve un AST TypeScript-ESLint con nodos `MeekoScope` para los ámbitos de plantilla. Estos nodos se recorren mediante `visitorKeys.children`; sus expresiones conservan nodos y referencias TypeScript. Los tokens corresponden exclusivamente a texto del archivo original, incluidos tokens `MeekoScriptBoundary` para las etiquetas de apertura/cierre de cada script. Estos límites permiten que reglas que utilizan `getTokenAfter` o `getTokensBetween` distingan los bloques del SFC. `context.sourceCode.parserServices` ofrece `isMeeko: true` y `templateBody`, el AST de plantilla de la API pública `@meekojs/meeko/parse`. También conserva los servicios sintácticos de TypeScript-ESLint, sin un programa de tipos; esto permite usar `consistent-type-imports` sin activar análisis tipado.

La infraestructura sintética sólo se usa para construir ámbitos. No se ejecuta ni se presenta como código escrito por el usuario. Las pruebas comprueban correcciones de reglas existentes tanto en scripts como en expresiones de atributos y su idempotencia.

## Límites de esta primera base

- Es análisis sintáctico. `parserOptions.project`, `projectService` y `programs` se rechazan explícitamente; usa `meeko check` para tipos, props, modelos, rutas y errores del compilador.
- No sustituye a Prettier ni implementa un AST de formato HTML/CSS. Las reglas de formato diseñadas para un archivo JavaScript completo pueden asumir delimitadores que una plantilla no tiene; usa el plugin Prettier de Meeko para el formato.
- No promete compatibilidad con cualquier regla de terceros que suponga un AST exclusivamente JavaScript. Las reglas propias, `no-unused-vars`, `prefer-const`, `no-unneeded-ternary`, `consistent-type-imports`, las reglas de Perfectionist que activa `perfectionist: true`, `sort-classes`, `sort-modules` y las dos reglas de unused-imports tienen pruebas específicas. `sort-arrays` y `sort-constructor-parameters` tienen opciones tipadas y se pueden configurar explícitamente, pero no forman parte de los defaults ni de esta matriz de validación.
- Los exports por defecto y reexports del bloque servidor se rechazan con un error de parsing explícito. Los exports de declaraciones nombradas y listas de nombres locales están cubiertos.
- Las comprobaciones de accesibilidad son parciales: `no-autofocus` cubre atributos estáticos en HTML y omite componentes y custom elements. No equivale a una auditoría completa de accesibilidad.
- Antes de publicar, la versión mínima del peer Meeko debe ser la primera versión publicada que incluya `@meekojs/meeko/parse`. Esta entrega se valida con el workspace actual.

## Desarrollo

Construye primero el núcleo de Meeko. Después:

```sh
pnpm -F @meekojs/eslint-plugin run check
pnpm -F @meekojs/eslint-plugin run test
```

Las pruebas usan ESLint real y RuleTester: referencias de plantilla, ámbitos de listas/snippets/servidor, ubicaciones, suggestions, límites explícitos, comprobaciones de tipos del consumidor y correcciones seguras de reglas existentes y de los plugins optativos.
