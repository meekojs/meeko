# meeko/order-macros

Comprueba el orden de las macros del script, sin entrar en funciones anidadas ni tratar identificadores locales homónimos como macros.

```ts
'meeko/order-macros': ['error', {
  order: ['defineProps', 'defineEmits', 'defineModel', 'defineSnippets', 'useElementRef', 'defineExpose'],
}]
```

Ese es el orden predeterminado. Los nombres omitidos en `order` se añaden al final en su orden predeterminado. No se mezclan macros de distintos scripts.

El autofix sólo ordena un bloque consecutivo independiente con argumentos literales y sin comentarios en el script. Las referencias a variables, llamadas, `await` y declaraciones intermedias impiden la corrección automática. Revisa esos diagnósticos manualmente conservando las dependencias.

`defineExpose` debe ir después de la lógica del componente. Siempre requiere corrección manual; no se mueve con autofix.

Es una regla optativa, disponible con `defineEslint` y el plugin directo.
