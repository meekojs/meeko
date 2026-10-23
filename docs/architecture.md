# Arquitectura de Meeko

## Objetivo

Meeko compila archivos `.meeko` a código TypeScript con dos entradas por componente: `renderToString(props)` para SSR y `hydrate(root, props)` para conectar eventos y señales al DOM existente. El runtime del navegador evita un árbol virtual y actualiza los nodos afectados por cada señal.

## Contrato actual

1. `<script lang="ts">` declara tipos, imports y estado. `defineProps<Props>()` es una macro de compilación.
2. `<template>` define HTML, expresiones de texto `{expression}`, eventos `on:event="handler"` y atributos dinámicos `bind:name="expression"`.
3. `<style>` es opcional. `scoped` añade un atributo estable a los elementos y a los selectores CSS.
4. El servidor escapa el texto dinámico e inserta marcadores para las expresiones reactivas.
5. La aplicación transfiere las mismas props al navegador como JSON escapado. Durante `hydrate`, Meeko busca los marcadores, verifica el texto existente, conecta eventos y crea observadores. La función devuelta libera estos recursos.

El ejemplo de `examples/counter` ejercita el contrato en un servidor HTTP. Cada llamada a `hydrate` reclama una raíz de componente; varias llamadas sobre raíces independientes mantienen sus señales y eventos aislados. La composición de componentes anidados requiere un protocolo explícito antes de ofrecerse como API estable.

## Límites de responsabilidad

| Parte | Responsabilidad |
| --- | --- |
| Parser | Analizar secciones, plantilla y expresiones conservando posiciones originales. |
| Compilador | Validar la sintaxis y producir módulos tipados para SSR e hidratación. |
| Runtime reactivo | Registrar dependencias, agrupar actualizaciones y liberar observadores por instancia. |
| Runtime de navegador | Reclamar nodos existentes, conectar eventos y aplicar cambios precisos. |
| Integración de herramientas | Mostrar diagnósticos en `.meeko`, transformar archivos en Vite y mantener HMR. |

El parser de secciones vive en `src/compiler/sfc.ts` y conserva los desplazamientos del archivo original. El generador de `src/compiler.ts` usa esas posiciones para errores de sintaxis. Los errores de tipos todavía requieren un mapa entre el código generado y `.meeko`.

## Reglas para SSR

- Cada petición debe crear su propio estado. No se comparten señales con datos de usuarios entre peticiones.
- El HTML dinámico se escapa antes de insertarse. El JSON inicial se escapa para no cerrar su etiqueta `<script>`.
- Las expresiones que afectan el HTML inicial deben producir el mismo valor en servidor y navegador. Una diferencia es un error de hidratación.
- Los IDs de marcadores deben ser únicos por instancia cuando se soporten varias raíces o componentes anidados.
- Las listas deberán exigir claves estables para poder conservar nodos y estado al reordenarse.

## TypeScript

El proyecto utiliza TypeScript 7.0.2 estable para la compilación y la verificación de tipos. El parser de scripts usa temporalmente `@typescript/typescript6`, aislado como dependencia del compilador, porque TypeScript 7.0 no expone una API programática estable. El módulo generado se comprueba con TypeScript 7. La integración futura del editor deberá mapear diagnósticos y posiciones entre `.meeko` y los documentos TypeScript virtuales.
