# meeko/prefer-ui-components

Avisa de los controles HTML escritos a mano donde hay un componente de [`@meekojs/ui`](../../../ui/README.md): así una aplicación no vuelve a dibujar botones, campos o tablas que ya tienen aspecto, foco y estados en un solo sitio.

| Etiqueta     | Componente                                  |
| ------------ | ------------------------------------------- |
| `<button>`   | `UIButton`                                  |
| `<input>`    | `UIInput`                                   |
| `checkbox`   | `UICheckbox`, con `<input type="checkbox">` |
| `radio`      | `UIRadioGroup`, con `<input type="radio">`  |
| `range`      | `UISlider`, con `<input type="range">`      |
| `<textarea>` | `UITextarea`                                |
| `<select>`   | `UISelect`                                  |
| `<dialog>`   | `UIModal`                                   |
| `<table>`    | `UITable`                                   |

Incorrecto:

```html
<button
	type="button"
	on:click="save"
>
	Guardar
</button>
<input model="name" />
<table>
	<tr><td>{name.value}</td></tr>
</table>
```

Correcto:

```html
<UIButton on:click="save">Guardar</UIButton>
<UIInput model="name" />
<UITable
	bind:columns="columns"
	bind:rows="rows"
/>
<input
	type="hidden"
	name="token"
	bind:value="token"
/>
```

Un `<input type="hidden">` no se avisa, porque no se ve. Un `<input bind:type="tipo">` sí, porque el tipo no se conoce hasta ejecutarlo. Tampoco se avisan los componentes, como `<Button>`.

**Usar UI no es obligatorio**, así que la regla no está en la configuración recomendada ni en `defineEslint`: actívala si tu proyecto usa `@meekojs/ui`.

```ts
import { defineEslint } from '@meekojs/eslint-plugin'

export default defineEslint({ rules: { 'meeko/prefer-ui-components': 'error' } })
```

## Opciones

`allow` es la lista de etiquetas que no se avisan, para un proyecto que adopta UI poco a poco:

```ts
export default defineEslint({ rules: { 'meeko/prefer-ui-components': ['error', { allow: ['table'] }] } })
```

## Excepciones

Los comentarios de una plantilla no admiten directivas de ESLint. Para una página que muestra el HTML nativo a propósito, como una demo, desactiva la regla en ese archivo y explica el motivo:

```ts
export default defineEslint(
	{ rules: { 'meeko/prefer-ui-components': 'error' } },
	{
		// Esta guía enseña el <dialog> nativo.
		files: ['app/pages/native-dialog.meeko'],
		rules: { 'meeko/prefer-ui-components': 'off' },
	},
)
```

No tiene autofix: un componente de UI no recibe siempre los mismos atributos que la etiqueta que sustituye.
