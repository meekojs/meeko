# meeko/padding-line-between-macros

Exige al menos una línea en blanco después de cada macro en los scripts de componentes `.meeko`, cuando haya otra declaración o instrucción a continuación. Incluye otras macros, variables, funciones y tipos.

```ts
// eslint.config.ts
export default defineEslint({
  rules: { 'meeko/padding-line-between-macros': 'error' },
})
```

```ts
const props = defineProps<{ name: string }>()

const emit = defineEmits<{ save: [] }>()

const model = defineModel<string>()

const snippets = defineSnippets<{ default?: [] }>()

const count = signal(0)
```

Comprende `defineProps`, `defineEmits`, `defineModel`, `defineSnippets`, `useElementRef` y `defineExpose`, incluidas varias declaraciones de la misma macro. Los bloques multilínea también deben estar separados.

`eslint --fix` inserta la separación conservando indentación, LF/CRLF y comentarios. Una línea vacía dentro de un comentario no cuenta como separación. Las funciones o imports locales que se llamen igual no se consideran macros. La regla no cruza secciones de script y no mueve código; puede combinarse con `meeko/order-macros`. No exige separación antes de una macro si la declaración anterior no es otra macro, ni añade una línea al final del script cuando no hay más código.

No admite opciones y se activa explícitamente: no forma parte de `recommended`.
