# Arquitectura de Meeko

## Objetivo

Meeko compila archivos `.meeko` a código TypeScript con `renderWithState(props)` o `renderToString(props)` para SSR y `hydrate(root, props, state?)` para conectar eventos y señales al DOM existente. El runtime del navegador evita un árbol virtual y actualiza los nodos afectados por cada señal.

## Contrato actual

1. `<script lang="ts">` declara tipos, imports y estado. `defineProps<Props>()` es una macro de compilación. En una página, `<script server lang="ts">` declara las opciones de ruta; el compilador lo excluye del componente y Vite lo sirve como un módulo aparte (`<página>.meeko?meeko-route&lang.ts`), sólo en el servidor salvo en las rutas `render: "client"`.
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
| Framework | Rutas, páginas, modos de render, navegación y clientes API/RPC/Socket (`src/framework`). |
| Núcleo de servidor | Aplicación portable sobre Web APIs: runtime, contratos, sesiones, middleware y Socket (`src/framework-server`). |
| Adaptadores | Conectar el núcleo con Node, Bun, Deno y Cloudflare Workers (`src/node.ts`, `src/bun.ts`, `src/deno.ts`, `src/cloudflare.ts`). |

La [guía del framework](framework.md) describe el framework, el servidor y los adaptadores.

El parser de secciones vive en `src/compiler/sfc.ts`; `src/compiler/template.ts` construye un AST propio de HTML. Ambos conservan límites de inicio y fin en el archivo original. El generador de `src/compiler.ts` usa esas posiciones para errores de sintaxis y devuelve segmentos de mapeo para el script y las expresiones. `src/check.ts` verifica el módulo mediante TypeScript 7 y presenta los errores en el `.meeko` original. Un error en código auxiliar generado sin segmento se identifica como tal y se sitúa al inicio del archivo para no atribuirle una ubicación falsa.

El runtime de `src/dom.ts` usa comentarios como límites de condiciones, listas y componentes hijos. Una lista comprueba las claves durante SSR y al hidratar; al cambiar, mueve los rangos de nodos de las claves existentes. Cada elemento de la lista mantiene señales para su dato y su índice, de modo que expresiones reactivas y comparaciones estrictas leen los valores actuales. Al quitar una región se desconectan sus eventos y observadores.

El plugin `src/vite.ts` usa el mismo compilador para cliente y SSR y expone el CSS como módulo virtual. En desarrollo, cada componente acepta sus propias actualizaciones HMR: `src/hmr.ts` captura las señales editables por instancia, renderiza la nueva versión, hidrata su raíz o rango existente y actualiza los estilos. Una actualización del runtime recarga la página.

Los módulos generados importan el runtime desde `@meekojs/meeko/internal`. Esta ruta agrupa las funciones de DOM, SSR, HMR y DevTools que el compilador necesita y se versiona junto con él. En desarrollo, `src/devtools.ts` registra las instancias hidratadas y expone un hook de lectura que comparten el panel integrado y la extensión de Chrome. Ni SSR ni el build de producción registran instancias en ese hook.

## Reglas para SSR

- Cada petición debe crear su propio estado. No se comparten señales con datos de usuarios entre peticiones.
- El HTML dinámico se escapa antes de insertarse. El JSON inicial se escapa para no cerrar su etiqueta `<script>`.
- Las expresiones que afectan el HTML inicial deben producir el mismo valor en servidor y navegador; `renderWithState` transfiere las señales editables cuando su valor inicial no es determinista. Una diferencia es un error de hidratación.
- Los IDs de marcadores son locales a cada componente y se buscan sólo dentro de su raíz o rango de comentarios.
- Las listas exigen claves estables para conservar nodos y estado al reordenarse.

## TypeScript

El proyecto utiliza TypeScript 7.0.2 estable para la compilación y la verificación de tipos. El parser de scripts usa temporalmente `@typescript/typescript6`, aislado como dependencia del compilador, porque TypeScript 7.0 no expone una API programática estable. El módulo generado se comprueba con TypeScript 7. `meeko types` emite declaraciones `.d.meeko.ts` para que un consumidor con `allowArbitraryExtensions` compruebe imports y props. El servidor de lenguaje de `src/language-server` usa los mapeos de origen y un documento TypeScript virtual para ofrecer diagnósticos y operaciones semánticas sobre `.meeko`. Lo usan la extensión de VS Code y [otros editores](editors.md).

## Límite entre runtime y herramientas

El bundle del navegador sólo incorpora los módulos usados por la aplicación; [las mediciones](benchmarks.md) registran su tamaño comprimido por separado. La instalación de `@meekojs/meeko` sí incluye el compilador, TypeScript 7, el analizador TypeScript 6, parse5 y PostCSS porque la CLI y el plugin Vite pertenecen al mismo paquete. El coste de instalación y el tamaño del JS servido son métricas distintas.

En la serie 1.x Meeko se publica como un único paquete. El código generado y `@meekojs/meeko/internal` deben tener exactamente la misma versión, y `meeko init` fija esa versión exacta en los proyectos que crea. Separar compilador y runtime añadiría una segunda versión que coordinar en cada build, sin un beneficio medido que lo justifique. La [política de estabilidad](stability.md#un-solo-paquete) recoge esta decisión. Si en el futuro el coste de instalación aconsejara dividir el paquete, la división conservaría una ruta de compatibilidad para los módulos `.meeko` ya compilados y tendría pruebas de consumo desde paquetes publicados.
