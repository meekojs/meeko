# meeko/html-self-closing

Exige cerrar con `/>` los elementos y componentes sin contenido de la plantilla, al estilo de `vue/html-self-closing`: `<div></div>` pasa a `<div />` y `<AppButton></AppButton>`, a `<AppButton />`. Es una regla **optativa**: ni `recommended` ni `defineEslint` la activan por defecto.

`<div />` es una forma válida desde Meeko `1.8` y compila exactamente igual que `<div></div>` (véase [Elementos sin contenido](../../../../docs/api.md#elementos-sin-contenido-div-)).

## Configuración

```ts
import { defineEslint } from '@meekojs/eslint-plugin'

export default defineEslint({
	rules: {
		'meeko/html-self-closing': 'warn',
	},
})
```

## Ejemplos

Incorrecto, con las opciones por defecto:

```html
<template>
	<div class="spacer"></div>
	<input type="text" />
	<AppButton bind:label="label"></AppButton>
	<svg viewBox="0 0 24 24"><path d="M0 0h24v24H0z"></path></svg>
</template>
```

Correcto:

```html
<template>
	<div class="spacer" />
	<input type="text" />
	<AppButton bind:label="label" />
	<svg viewBox="0 0 24 24"><path d="M0 0h24v24H0z" /></svg>
	<p>Con contenido, la etiqueta de cierre se queda.</p>
	<div></div>
</template>
```

## Opciones

Cada categoría acepta `'always'` (exige `/>`), `'never'` (lo prohíbe) o `'any'` (no comprueba). Por defecto, todas valen `'always'`.

| Opción        | Elementos                                                                                          |
| ------------- | -------------------------------------------------------------------------------------------------- |
| `html.normal` | Elementos HTML no vacíos y personalizados: `<div>`, `<span>`, `<textarea>`, `<td>`, `<my-element>` |
| `html.void`   | Elementos vacíos: `<input>`, `<br>`, `<img>`, `<hr>`, `<meta>`…                                    |
| `component`   | Etiquetas de componente (`<AppButton>`, `<MeekoLink>`), `<component is>`, `<render>` y `<snippet>` |
| `svg`         | Elementos SVG, `<svg>` incluido                                                                    |
| `math`        | Elementos MathML, `<math>` incluido                                                                |

`ignoreWhitespace` vale `false` por defecto.

```ts
export default defineEslint({
	rules: {
		'meeko/html-self-closing': [
			'warn',
			{
				html: { normal: 'always', void: 'always' },
				component: 'always',
				svg: 'always',
				math: 'any',
				ignoreWhitespace: false,
			},
		],
	},
})
```

### Qué es «sin contenido»

Un elemento no tiene contenido cuando no tiene **ningún** nodo hijo: ni texto, ni comentarios, ni elementos. Los espacios cuentan como contenido, porque en Meeko los espacios entre etiquetas son nodos de texto que se pintan: `<span> </span>` y `<div>\n</div>` no se tocan por defecto, y quitar ese espacio podría cambiar el HTML o la separación entre elementos en línea.

Con `ignoreWhitespace: true`, el contenido formado sólo por saltos de línea y sangría (espacios en blanco con al menos un salto de línea) también cuenta como vacío y el autofix lo borra. En un elemento de bloque eso no cambia lo que se ve, pero sí el HTML del SSR y los nodos de texto del DOM; en un componente, ese espacio era su snippet `default`, que deja de pasarse. Un espacio sin salto de línea (`<span> </span>`) nunca se borra.

## Autofix y límites

- `'always'` sustituye `></tag>` por ` />` (o por `/>` si el `>` ya va precedido de un espacio o de un salto de línea), y `>` por ` />` en un elemento vacío. Conserva los atributos y su formato: con un atributo por línea, `/>` ocupa la línea del `>`.
- `'never'` sustituye `/>` por `></tag>` (o por `>` en un elemento vacío) y quita el espacio de delante, salvo que `/>` esté solo en su línea.
- No informa de `<template>`, `<script>`, `<style>`, `<html>`, `<head>`, `<body>` ni de nombres desconocidos, que no pueden cerrarse con `/>`, ni de un elemento que el parser cierra sin etiqueta de cierre (`<li>` seguido de otro `<li>`).
- `<input value=a/>` no está autocerrado: el `/` forma parte del valor sin comillas.
- La corrección es estable e idempotente y converge con `meeko/attributes-order`, que sólo mueve atributos, y con `meeko/prefer-static-bindings`.

### Prettier

El plugin de Prettier de Meeko conserva la forma escrita de los elementos HTML no vacíos, de los componentes y de los elementos SVG y MathML (`<div />` y `<div></div>`, `<path />` y `<path></path>`), así que la regla decide el estilo y Prettier respeta la corrección. En cambio, Prettier escribe siempre los elementos vacíos con `/>` (`<input>` pasa a `<input />`): con Prettier, deja `html.void` en `'always'` o en `'any'`, porque `'never'` entraría en conflicto con su salida.

El plugin de Prettier no tiene una opción equivalente: duplicaría la decisión de la regla (categorías y espacios en blanco) y dependería de detalles internos del printer HTML de Prettier. Usa la regla con `eslint --fix` y después Prettier.

## Por qué no está en `recommended`

En `1.x` la regla no se activa en `recommended` ni en `defineEslint`: activarla generaría avisos y diffs de formato en proyectos existentes sin cambiar su comportamiento. En el monorepo de Meeko daría 94 avisos en 150 archivos `.meeko` con las opciones por defecto.
