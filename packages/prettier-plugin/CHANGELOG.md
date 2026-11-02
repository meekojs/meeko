# Cambios de Prettier para Meeko

## Sin publicar

- Añade `meekoClassFunctions` (`[]` por defecto), que ordena con `meekoSortClasses` las cadenas de los argumentos de funciones como `tv()`, `clsx()` o `cn()`, a cualquier profundidad, en el script de un `.meeko` y en los archivos `.ts`, `.tsx` y `.js`. Nunca toca las claves de un objeto.
- **Cambio de salida con `meekoSortClasses` distinto de `"off"`:** también se ordenan y normalizan las cadenas de `bind:class` y el `class` de una etiqueta de componente. Sin cambios con `"off"`, el valor por defecto.
- Conserva los elementos HTML sin contenido tal como están escritos, `<div />` o `<div></div>`, que Meeko `1.8` admite en la plantilla; los atributos se siguen formateando (uno por línea con `singleAttributePerLine`, y `/>` en la línea del `>`), y los elementos vacíos se siguen escribiendo `<input />`. No añade una opción para convertir una forma en la otra: esa decisión es de la regla `meeko/html-self-closing` de `@meekojs/eslint-plugin`, cuyo autofix converge con el formato del plugin.
