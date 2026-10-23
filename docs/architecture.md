# Arquitectura de Meeko

## Objetivo

Meeko compila archivos `.meeko` a código TypeScript con `renderWithState(props)` o `renderToString(props)` para SSR y `hydrate(root, props, state?)` para conectar eventos y señales al DOM existente. El runtime del navegador evita un árbol virtual y actualiza los nodos afectados por cada señal.

## Contrato actual

1. `<script lang="ts">` declara tipos, imports y estado. `defineProps<Props>()` es una macro de compilación.
2. `<template>` define HTML, expresiones de texto `{expression}`, eventos `on:event="handler"`, atributos dinámicos `bind:name="expression"`, condiciones `if:when` y listas `each:of` con claves obligatorias.
3. `<style>` es opcional. `scoped` añade un atributo estable a los elementos y a los selectores CSS.
4. El servidor escapa el texto dinámico e inserta marcadores para las expresiones reactivas.
5. La aplicación transfiere props y estado de `renderWithState` al navegador como JSON escapado. Cada hijo anidado lleva su estado dentro de su marcador inicial. Durante `hydrate`, Meeko restaura señales, busca los marcadores, verifica el texto existente, conecta eventos y crea observadores. La función devuelta libera estos recursos.

El ejemplo de `examples/counter` ejercita el contrato en un servidor HTTP. Cada llamada a `hydrate` reclama una raíz de componente; varias llamadas sobre raíces independientes mantienen sus señales y eventos aislados. Los hijos importados usan `hydrateScope` en rangos de comentarios: esto permite anidarlos sin elementos envolventes y evita que sus marcadores se confundan con los del padre.

## Límites de responsabilidad

| Parte | Responsabilidad |
| --- | --- |
| Parser | Analizar secciones, plantilla y expresiones conservando posiciones originales. |
| Compilador | Validar la sintaxis y producir módulos tipados para SSR e hidratación. |
| Runtime reactivo | Registrar dependencias, agrupar actualizaciones y liberar observadores por instancia. |
| Runtime de navegador | Reclamar nodos existentes, conectar eventos y aplicar cambios precisos. |
| Integración de herramientas | Mostrar diagnósticos en `.meeko`, transformar archivos en Vite y mantener HMR. |

El parser de secciones vive en `src/compiler/sfc.ts`; `src/compiler/template.ts` construye un AST propio de HTML. Ambos conservan límites de inicio y fin en el archivo original. El generador de `src/compiler.ts` usa esas posiciones para errores de sintaxis y devuelve segmentos de mapeo para el script y las expresiones. `src/check.ts` verifica el módulo mediante TypeScript 7 y presenta los errores en el `.meeko` original. Un error en código auxiliar generado sin segmento se identifica como tal y se sitúa al inicio del archivo para no atribuirle una ubicación falsa.

El runtime de `src/dom.ts` usa comentarios como límites de condiciones, listas y componentes hijos. Una lista comprueba las claves durante SSR y al hidratar; al cambiar, mueve los rangos de nodos de las claves existentes. Cada elemento de la lista mantiene señales para su dato y su índice, de modo que expresiones reactivas y comparaciones estrictas leen los valores actuales. Al quitar una región se desconectan sus eventos y observadores.

El plugin `src/vite.ts` usa el mismo compilador para cliente y SSR y expone el CSS como módulo virtual. En desarrollo, cada componente acepta sus propias actualizaciones HMR: `src/hmr.ts` captura las señales editables por instancia, renderiza la nueva versión, hidrata su raíz o rango existente y actualiza los estilos. Una actualización del runtime recarga la página.

## Reglas para SSR

- Cada petición debe crear su propio estado. No se comparten señales con datos de usuarios entre peticiones.
- El HTML dinámico se escapa antes de insertarse. El JSON inicial se escapa para no cerrar su etiqueta `<script>`.
- Las expresiones que afectan el HTML inicial deben producir el mismo valor en servidor y navegador; `renderWithState` transfiere las señales editables cuando su valor inicial no es determinista. Una diferencia es un error de hidratación.
- Los IDs de marcadores son locales a cada componente y se buscan sólo dentro de su raíz o rango de comentarios.
- Las listas exigen claves estables para conservar nodos y estado al reordenarse.

## TypeScript

El proyecto utiliza TypeScript 7.0.2 estable para la compilación y la verificación de tipos. El parser de scripts usa temporalmente `@typescript/typescript6`, aislado como dependencia del compilador, porque TypeScript 7.0 no expone una API programática estable. El módulo generado se comprueba con TypeScript 7. `meeko types` emite declaraciones `.d.meeko.ts` para que un consumidor con `allowArbitraryExtensions` compruebe imports y props. La extensión local de VS Code usa los mapeos de origen y un documento TypeScript virtual para ofrecer diagnósticos y operaciones semánticas sobre `.meeko`.
