# meeko/order-sections

Comprueba el orden de las secciones explícitas de un componente:

```ts
'meeko/order-sections': ['error', {
  order: ['server', 'script', 'template', 'style'],
}]
```

El orden predeterminado corresponde a `<script server>`, `<script>`, `<template>` y `<style>`. No exige que existan todas las secciones. Los nombres omitidos en `order` se añaden al final en su orden predeterminado.

El autofix mueve secciones completas conservando sus etiquetas, atributos y contenido. Si hay comentarios fuera de las secciones, sólo informa del problema para que decidas a qué sección pertenecen.

Es una regla optativa. El formato interno de las secciones sigue siendo responsabilidad de Prettier.
