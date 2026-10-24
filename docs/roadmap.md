# Plan de desarrollo

Estado: motor experimental. Cada etapa se considera terminada cuando sus criterios se comprueban en el código actual, las pruebas y, donde corresponda, un navegador real.

## 1. Parser y diagnósticos

- [x] Analizar secciones y plantilla con un AST propio y posiciones de inicio y fin.
- [x] Rechazar secciones duplicadas, HTML inválido y expresiones incompletas con diagnósticos en `.meeko`.
- [x] Conservar segmentos de mapeo desde código generado hasta archivo original para errores de TypeScript.

**Aceptación:** un error en script, plantilla o estilo señala la ubicación correcta del `.meeko` y el CLI falla sin emitir un módulo incompleto.

## 2. Plantillas completas

- [x] Atributos dinámicos y booleanos con escape SSR y actualización reactiva.
- [x] Condiciones con límites de región deterministas entre servidor y navegador.
- [x] Listas con claves obligatorias, inserción, eliminación y reordenamiento sin perder el estado de elementos conservados.
- [x] Tipos precisos de props, eventos y variables locales de listas.

**Aceptación:** cada construcción tiene pruebas de salida SSR, hidratación sin reemplazar nodos, actualización y eliminación de observadores.

## 3. SSR e hidratación robustos

- [x] Instancias múltiples, componentes anidados y marcadores aislados por raíz.
- [x] Transferencia de estado serializable y comprobación explícita de datos no serializables.
- [x] Diagnósticos de hidratación que indiquen componente y ubicación.
- [x] Pruebas de aislamiento entre peticiones concurrentes.

**Aceptación:** dos componentes con el mismo código en una página funcionan independientemente y una petición no puede leer estado de otra.

## 4. Tipado y editor

- [x] Verificación directa de `.meeko` con diagnósticos en el archivo fuente.
- [x] Autocompletado, navegación, renombrado y hover en script y plantilla.
- [x] Formateo consistente y resaltado validado en la extensión VS Code dentro de un host real.

**Aceptación:** el editor y el CLI muestran los mismos errores y las refactorizaciones conservan referencias entre plantilla y script.

## 5. Integración y rendimiento

- [x] Plugin Vite que transforma `.meeko` para cliente y servidor con HMR.
- [x] Pruebas E2E en navegador real: primera carga, hidratación, navegación y actualización.
- [x] Comparativas reproducibles frente a Vue con funciones y configuración equivalentes: tamaño comprimido, tiempo de carga, actualización y memoria.
- [x] Documentación de API, límites de compatibilidad y preparación de publicación.

**Aceptación:** una aplicación de ejemplo se ejecuta en desarrollo y producción sin pasos manuales de generación; las cifras de rendimiento incluyen scripts y condiciones de medición reproducibles.

## Próxima etapa: publicación y adopción

- [x] Elegir licencia MIT y preparar el paquete público `@meekojs/meeko` con versión experimental `0.0.1`.
- [x] Probar el paquete como dependencia de una aplicación externa con CLI, SSR, tipos y Vite.
- [x] Revisar las exportaciones internas de DOM/HMR: el compilador usa `@meekojs/meeko/internal` y los exports antiguos de la raíz se conservan por compatibilidad durante `0.x`.
- [x] Publicar el repositorio en GitHub y la primera versión del paquete en npm.
- [x] Preparar y comprobar la extensión de VS Code para Windows, Linux y macOS en x64/arm64. Las pruebas de host corrieron en Windows x64, Linux x64 y macOS arm64; las demás variantes se comprobaron por contenido del VSIX y binario nativo.
- [x] Ampliar la comparativa a árboles, listas grandes y navegación, con condiciones y resultados reproducibles. La lista muestra una oportunidad clara de optimización.
- [x] Decidir el alcance de `0.0.2`: `:global` en CSS, streaming SSR y un servidor de lenguaje independiente se posponen. Se evaluarán por separado antes de una versión estable.

## DevTools experimental

- [x] Instrumentar instancias hidratadas, props, señales, árbol, eventos y limpieza en desarrollo.
- [x] Ofrecer selección, resaltado y puntos de parada por instancia en un panel integrado.
- [x] Ofrecer un panel local de Chrome DevTools que consuma el mismo hook.
- [x] Verificar el runtime, las interfaces y el ejemplo en Chrome.
- [x] Publicar `0.0.2` en npm con DevTools y adjuntar el ZIP de Chrome y los seis VSIX a la versión de GitHub. Las extensiones todavía no están publicadas en sus tiendas.

**Aceptación:** la [guía de DevTools](devtools.md) documenta el uso y los límites; SSR y producción no exponen el hook de desarrollo.

## Desarrollo de 0.0.3

- [x] Optimizar el movimiento de listas con claves y comparar 1.000 filas en ambos órdenes de ejecución.
- [x] Evitar escrituras DOM iniciales redundantes y asignar señales de índice y conjuntos de suscriptores sólo cuando se usan.
- [x] Separar en el benchmark la navegación que reutiliza nodos de la que monta una vista nueva.
- [x] Crear un piloto SSR con rutas, formulario, lista, componentes anidados y datos asíncronos; verificar desarrollo y producción en Chromium, Firefox y WebKit.
- [x] Generar una aplicación SSR independiente con `meeko init` y compilarla desde un tarball instalado fuera del repositorio.
- [x] Mostrar en ambos paneles DevTools las expresiones `.meeko` que leen cada señal, con archivo, línea y columna.
- [x] Preparar el workflow OIDC para publicaciones futuras y documentar el límite actual entre runtime y herramientas.
- [x] Publicar `0.0.2` en npm y crear su etiqueta y [versión en GitHub](https://github.com/meekojs/meeko/releases/tag/v0.0.2) tras completar la autorización de npm.
- [x] Vincular el Trusted Publisher en npm para `meekojs/meeko` y `publish.yml`. Falta comprobar el flujo en la primera publicación automática de una versión posterior.
- [x] Medir el coste de instalación en frío y el arranque SSR de un consumidor publicado. El [primer ensayo](benchmarks.md#consumidor-instalado-desde-npm) no decide aún si se separan runtime y compilador.

La [comparativa actual](benchmarks.md) muestra una reducción del heap de listas, aunque su hidratación sigue por encima de Vue en las dos corridas. También queda por acelerar el montaje completo de vistas. Las cifras locales no sustituyen mediciones de una aplicación desplegada.
