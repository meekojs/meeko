# meeko/attributes-order

Ordena los atributos de elementos HTML y etiquetas de componente por grupos para facilitar la lectura de plantillas. Es una regla **optativa**: ni `recommended` ni `defineEslint` la activan por defecto.

## Configuración

```ts
import { defineEslint } from '@meekojs/eslint-plugin'

export default defineEslint({
	rules: {
		'meeko/attributes-order': ['warn', { alphabetical: false }],
	},
})
```

## Ejemplos

Incorrecto:

```html
<template>
	<Card
		bind:title="title"
		ref:card
		id="profile"
		class="card"
	/>
</template>
```

Correcto:

```html
<template>
	<Card
		ref:card
		id="profile"
		class="card"
		bind:title="title"
	/>
</template>
```

## Opciones

`order` acepta un array no vacío de grupos distintos. Los grupos omitidos se añaden al final conservando el orden predeterminado:

| Grupo         | Atributos                                                                                    |
| ------------- | -------------------------------------------------------------------------------------------- |
| `ref`         | `ref:nombre`                                                                                 |
| `list`        | `each:of`, `each:as`, `each:index`, `each:key`, en ese orden                                 |
| `conditional` | `if:when`                                                                                    |
| `definition`  | `is` de `<component>`                                                                        |
| `attributes`  | Todos los atributos planos: `id`, `name`, `type`, `class`, `style`, `aria-*`, `data-*`, etc. |
| `model`       | `model`, `model:prop`                                                                        |
| `bindings`    | Todos los `bind:atributo`, incluidos `bind:class` y `bind:style`                             |
| `spread`      | `bind="objeto"`                                                                              |
| `events`      | `on:evento`                                                                                  |
| `content`     | `html`; `name`, `params` de `<snippet>`; `snippet`, `args` de `<render>`                     |

Ese es también el orden predeterminado. En `content`, `name` precede a `params` y `snippet` precede a `args`, incluso al activar el orden alfabético. Las etiquetas personalizadas también se comprueban; esta clasificación es de estilo y no convierte sus atributos literales en directivas.

`alphabetical` vale `false` por defecto. Con `true`, ordena por nombre dentro del grupo, con comparación de cadenas sensible a mayúsculas, excepto los órdenes internos fijos de `list` y `content`. Los atributos planos y los `bind:` pertenecen a grupos separados. El prefijo `bind:` se ignora al comparar nombres dentro de `bindings`. Los empates conservan el orden original.

```ts
export default defineEslint({
	rules: {
		'meeko/attributes-order': [
			'error',
			{
				order: ['attributes', 'bindings', 'events'],
				alphabetical: true,
			},
		],
	},
})
```

## Autofix y límites

La regla recorre una vez el AST de plantilla y emite como máximo un aviso por etiqueta desordenada. `eslint --fix` conserva el texto original de cada atributo y los separadores de sus posiciones, incluidos saltos de línea, CRLF, indentación, entidades y valores multilínea. Prettier puede aplicar después el formato de un atributo por línea.

La corrección es conservadora:

- No cambia el orden relativo de atributos que pueden contener expresiones, aunque sean identificadores: una lectura podría ejecutar un getter. Por ejemplo, `bind:z="readZ()" bind:a="readA()"` se informa con `alphabetical: true`, pero no se corrige.
- Permite mover atributos planos delante de `bind:` y spreads si conserva el orden relativo de expresiones. `ref:` no evalúa una expresión y puede subir al principio.
- No corrige etiquetas que combinan `bind="objeto"` con `class`/`style` o sus variantes `bind:`: el compilador coloca la evaluación del spread según su posición y la de esos atributos. Mover un atributo plano podría adelantar esa evaluación.
- No corrige colisiones de un nombre y su variante `bind:`, incluidos `class` y `style`, ni rangos separados por contenido que no sea espacio en blanco. Conserva el código para revisión manual.
- Los atributos repetidos con la misma escritura y los comentarios HTML entre atributos son errores del parser de Meeko. Se conserva ese diagnóstico y no se modifica el archivo. Los comentarios HTML entre elementos permanecen intactos.
- Puede informar sin corregir `<render args="…" snippet="…" />` o directivas `each:*` desordenadas si moverlas cambia el orden relativo de expresiones. No ofrece suggestions que supongan seguridad semántica.

La regla no comprueba la validez de las directivas ni los tipos de sus expresiones. Usa `meeko check` para esos diagnósticos. Puede combinarse con `meeko/prefer-static-bindings`: al convertir un literal en atributo estático, el atributo pasa de `bindings` a `attributes` y las correcciones convergen.

La prioridad de claves de `bind` se describe en [la referencia de bindings](../../../../docs/reference/syntax/bind.md) y [la API](../../../../docs/api.md#atributos-en-bloque-con-bind).
