# meeko/prefer-static-bindings

Simplifica bindings literales equivalentes sin opciones adicionales:

```html
<!-- Antes -->
<Card bind:label="'Guardar'" />
<input bind:disabled="true" />

<!-- Después de eslint --fix -->
<Card label="Guardar" />
<input disabled />
```

Las cadenas se escapan como atributos HTML. `true` sólo se convierte en un atributo booleano HTML conocido; un booleano de componente conserva su binding.

Omite expresiones dinámicas, números, `false`, `null`, cadenas con caracteres de control y bindings de cadenas para booleanos HTML. También omite custom elements, SVG, etiquetas dinámicas, componentes integrados Meeko, nombres especiales y atributos que ya tienen una versión estática.

Es una regla optativa con autofix. No cambia valores dinámicos ni deduce tipos de props.
