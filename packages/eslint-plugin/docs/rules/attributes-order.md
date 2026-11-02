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

Cada aviso tiene una salida, según lo que cambie al mover los atributos:

- **Autofix.** `eslint --fix` ordena si ninguna expresión que cambia de orden puede tener efectos. No los tienen los identificadores, las lecturas como `signal.value`, los literales, las plantillas, los ternarios y operadores sobre ellos, los arrays y objetos con esos valores, ni crear una función, como `(event) => emit('click', event)`. La regla da por hecho que una lectura no ejecuta un getter con efectos. Las expresiones que no cambian de orden entre sí dan igual: en `bind:title="read()" bind="rest" bind:to="to"`, la llamada sigue la primera y se corrige.
- **Sugerencia.** Si una expresión que cambia de orden puede tener efectos (una llamada, `new`, `await`, `delete`, una asignación o un `++`) o no se puede analizar, `--fix` no la toca: el aviso ofrece la sugerencia de ordenar, que el editor aplica con Quick Fix. Nombra los atributos que se evalúan en otro momento, porque quien la aplica debe comprobar que el resultado no dependa de eso.
- **A mano.** Los casos siguientes no se pueden mover sin cambiar el resultado o perder texto, y no tienen autofix ni sugerencia:
  - Las colisiones de un nombre y su variante `bind:`, incluidos `class` y `style`: ahí el orden escrito sí decide el valor. Con `id="a" bind:id="b"` gana el primero en el HTML, y con `bind="obj"`, de `class` y `bind:class` sólo cuenta el último.
  - Los rangos separados por contenido que no sea espacio en blanco.
  - Los atributos repetidos con la misma escritura y los comentarios HTML entre atributos, que son errores del parser de Meeko: se conserva ese diagnóstico y no se modifica el archivo. Los comentarios HTML entre elementos permanecen intactos.

### El orden y `bind="objeto"`

Mover un `bind="objeto"` no cambia quién gana: la clave explícita gana en cualquier posición, y `class` y `style` se combinan siempre igual, las clases explícitas antes que las del objeto y los estilos del objeto antes que los explícitos. Da lo mismo en SSR, en hidratación y en las actualizaciones. Sólo cambia cuándo se evalúa el objeto en el servidor, que el compilador coloca en `bind` o en un `class` o `style` escrito antes, y el orden del texto de los atributos en el HTML.

Con `alphabetical: true`, dos `bind:` pueden cambiar de orden, y cada uno escribe en su propio efecto, en el orden en que está escrito. En un control nativo eso puede importar: si `bind:value` escribe antes que `bind:max` en una misma actualización, el navegador recorta el valor al máximo anterior. Por eso, al mover `bind:value`, `bind:checked` o `bind:selected` respecto a otro `bind:` de un elemento, se ofrece una sugerencia y no un autofix.

La regla no comprueba la validez de las directivas ni los tipos de sus expresiones. Usa `meeko check` para esos diagnósticos. Puede combinarse con `meeko/prefer-static-bindings`: al convertir un literal en atributo estático, el atributo pasa de `bindings` a `attributes` y las correcciones convergen.

La prioridad de claves de `bind` se describe en [la referencia de bindings](../../../../docs/reference/syntax/bind.md) y [la API](../../../../docs/api.md#atributos-en-bloque-con-bind).
