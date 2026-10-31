# meeko/button-has-type

Exige un `type` explícito en los botones HTML. Dentro de un formulario, el tipo implícito puede enviar datos cuando se pretendía una acción local.

Incorrecto:

```html
<button on:click="openDetails">Detalles</button>
```

Correcto:

```html
<button type="button" on:click="openDetails">Detalles</button>
<button type="submit">Guardar</button>
<button bind:type="buttonType">Acción</button>
```

No tiene opciones. Omite componentes como `<Button>` y admite `type` o `bind:type`; los valores y sus tipos pertenecen a `meeko check`.

No tiene autofix, porque elegir el tipo cambia el comportamiento observable. Ofrece dos suggestions: añadir `type="button"` o `type="submit"`. Puedes escribir `reset` manualmente cuando corresponda.
