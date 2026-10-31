# meeko/no-autofocus

Desaconseja `autofocus` estático en elementos HTML: puede mover el foco al cargar y alterar la navegación de teclado o la lectura asistida.

Incorrecto:

```html
<input autofocus>
```

Correcto:

```html
<input>
```

No tiene opciones. La regla no prohíbe políticas de foco que una aplicación necesite al abrir un diálogo o después de una acción del usuario.

No tiene autofix: quitar `autofocus` cambia el comportamiento del foco. Ofrece una suggestion que elimina únicamente el atributo. Omite componentes y custom elements, cuyos contratos pueden dar otro significado a esa prop. No analiza `bind:autofocus` ni constituye una auditoría completa de accesibilidad.
