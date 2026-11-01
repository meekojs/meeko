# Cambios de Prettier para Meeko

## Sin publicar

- Conserva los elementos HTML sin contenido tal como están escritos, `<div />` o `<div></div>`, que Meeko `1.8` admite en la plantilla; los atributos se siguen formateando (uno por línea con `singleAttributePerLine`, y `/>` en la línea del `>`), y los elementos vacíos se siguen escribiendo `<input />`. No añade una opción para convertir una forma en la otra: esa decisión es de la regla `meeko/html-self-closing` de `@meekojs/eslint-plugin`, cuyo autofix converge con el formato del plugin.
