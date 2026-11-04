# Rendimiento

## Medición reproducible

Desde la raíz del monorepo, con Node.js 24+ y Chrome instalado:

```powershell
pnpm -F @meekojs/meeko benchmark:measure
pnpm -F @meekojs/meeko benchmark:compare --fail-on-regression
```

`benchmark:measure` construye el núcleo y genera `packages/meeko/.meeko/performance/current.json`. `benchmark:compare` escribe `comparison.json` en esa misma carpeta. `benchmark:budget` ejecuta ambos pasos y devuelve un código distinto de cero si detecta una regresión comparable. Ningún comando actualiza la baseline automáticamente.

El escenario usa un componente fijo con contador y 30 filas, comprueba SSR y verifica un clic después de hidratar en Chromium. No representa el tamaño ni la latencia de una aplicación de usuario completa. Los informes registran versiones de Node, navegador y esbuild, plataforma, arquitectura, CPU, revisión de Git, estado sucio y hash de los escenarios.

## Categorías de métricas

| Métrica                     | Qué mide                                                                                            |
| --------------------------- | --------------------------------------------------------------------------------------------------- |
| `compile.cold`              | Primera compilación dentro de un worker nuevo; excluye arrancar el worker e importar el compilador. |
| `compile.warm`              | Compilaciones completas del componente modificado, tras calentamiento; no supone caché incremental. |
| `ssr.render`                | `renderWithState` completo de una instancia nueva.                                                  |
| `client.hydration`          | Tiempo dentro de `hydrate` en un navegador real; después se comprueba el evento del botón.          |
| `bundle.raw`, `bundle.gzip` | Bytes del cliente del escenario, compilado y minificado con esbuild, sin sourcemap.                 |
| `lsp.completion.cold`       | Primer completado de un proyecto LSP recién creado; excluye su descubrimiento inicial.              |
| `lsp.completion.warm`       | Completados repetidos sobre ese documento, con el programa TypeScript preparado.                    |

El LSP trabaja con una pequeña aplicación temporal y los tipos de `dist`, no con la complejidad de un consumidor real. Los sistemas de archivos y las cachés del sistema operativo pueden estar calientes incluso al crear un worker o servicio nuevo. La mediana y p95 se calculan sobre todas las muestras, sin quitar extremos. Hay siete rondas y dos calentamientos; las mediciones frías usan tres instancias nuevas. Se pueden cambiar con `--rounds`, `--warmups` y `--cold-rounds`.

Para usar Chromium descargado por Playwright, establece `MEEKO_BROWSER_CHANNEL=chromium`. Para un ejecutable propio usa `MEEKO_CHROME_PATH`. El runner libera su navegador, servidor y carpeta temporal al terminar. No ejecuta el editor ni modifica los proyectos consumidores.

## Presupuestos y comparación

`packages/meeko/benchmarks/performance-budgets.json` define el aumento relativo permitido y un incremento absoluto mínimo por unidad o métrica. Los valores iniciales son 35% y 0,05 ms para tiempos, 5% y 256 bytes para tamaños. Compilación fría y completado tienen mínimos específicos para no bloquear por variaciones pequeñas.

Una regresión debe superar ambos límites en **mediana y p95**. Una muestra lenta aislada no basta. Los tiempos sólo bloquean cuando coinciden Node, plataforma, arquitectura, CPU y versión del navegador; otro entorno aparece como `different-environment`. Los tamaños se comparan siempre porque no dependen del reloj. Un escenario distinto, una métrica ausente o una unidad cambiada rechaza la comparación en vez de declarar éxito.

La CI ejecuta `benchmark:budget` y conserva los informes incluso si falla. En un runner distinto a la máquina que capturó la baseline, los tiempos quedan como información y los tamaños siguen sujetos al presupuesto. Para evaluar una regresión temporal entre revisiones, mide ambas en el mismo runner y con la misma herramienta; evita imponer cifras absolutas universales.

## Actualizar una baseline

La baseline versionada es `packages/meeko/benchmarks/performance-baseline.json`. Tras revisar un cambio de escenario, versión de herramienta o coste deliberado:

```powershell
pnpm -F @meekojs/meeko benchmark:measure
Copy-Item packages/meeko/.meeko/performance/current.json packages/meeko/benchmarks/performance-baseline.json
```

Revisa las diferencias del informe junto con el cambio que justifica el nuevo coste. El comparador acepta `--baseline`, `--current`, `--budgets` y `--output` para comparar otras capturas sin sustituir la referencia. Si cambia el trabajo medido, actualiza la versión del escenario además de su fuente para que el hash impida comparar cargas distintas.

Los benchmarks históricos `benchmark`, `benchmark:scenarios` y `benchmarks/stability-baseline.mjs` continúan disponibles para comparaciones ampliadas, memoria, HMR y consumidores externos. Este presupuesto pequeño es una señal adicional; no sustituye las pruebas funcionales ni una medición representativa del consumidor.
