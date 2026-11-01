# Cambios de ESLint para Meeko

## Sin publicar

- Activa Perfectionist por defecto en `defineEslint`: sólo `sort-imports` y `sort-named-imports`, con orden natural ascendente y autofix. Durante Meeko 1.x emite `warn`; desde 2.0 emitirá `error`. `perfectionist: false` lo desactiva y `rules` permite subir la severidad a `error` sin activar explícitamente la opción.

- Añade la regla optativa `meeko/attributes-order`, con `ref:` y `each:*` al principio, atributos planos separados de los `bind:` y eventos al final antes del contenido. Incluye grupos configurables, orden alfabético y autofix conservador que preserva el orden de evaluación de expresiones. No se activa en la configuración recomendada.
- Añade la regla optativa `meeko/html-self-closing`, al estilo de `vue/html-self-closing`: cierra con `/>` los elementos y componentes sin ningún nodo hijo (`<div></div>` pasa a `<div />` y `<AppButton></AppButton>`, a `<AppButton />`). Admite `'always'`, `'never'` o `'any'` por categoría (`html.normal`, `html.void`, `component`, `svg` y `math`; por defecto, todo `'always'`) e `ignoreWhitespace` (por defecto `false`) para tratar como vacío el contenido de sólo saltos de línea y sangría, que en Meeko es texto que se pinta. El autofix conserva los atributos y su formato, es idempotente y converge con `attributes-order`, `prefer-static-bindings` y Prettier. Con Meeko `1.7`, que no admite `<div />`, no comprueba `html.normal`. No se activa en `recommended` ni en `defineEslint` en `1.x`, para no generar diffs en proyectos existentes.
