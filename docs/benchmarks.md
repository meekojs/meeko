# Comparativa reproducible: Meeko y Vue

Esta prueba usa el mismo caso funcional en ambos motores: un botón renderizado en el servidor con valor inicial `0`, valor derivado `doble`, hidratación y un clic que actualiza ambos valores. El ejemplo de Meeko es [`Counter.meeko`](../examples/counter/Counter.meeko); la contraparte de Vue está en [`benchmarks/vue-counter.ts`](../benchmarks/vue-counter.ts). Vue usa una función `render` escrita a mano y su runtime de producción, sin compilador de plantillas en el navegador. Meeko usa el módulo producido por su compilador. Se comprueba el texto visible antes y después de cada clic.

## Cómo repetirla

En PowerShell 7, con Node.js 24 o posterior, `pnpm install` y Google Chrome instalados:

```powershell
pnpm run benchmark
$env:MEEKO_BENCH_ORDER = 'vue-first'
try { pnpm run benchmark } finally { Remove-Item Env:MEEKO_BENCH_ORDER }
```

El comando compila Meeko, genera el componente de ejemplo, verifica los tipos del benchmark y ejecuta [`benchmarks/run.ts`](../benchmarks/run.ts). No descarga Chrome. Para usar otro ejecutable compatible, define `MEEKO_CHROME_PATH`. El resultado completo sale como JSON por stdout e incluye versiones, CPU, orden de ejecución y estado Git.

## Método

- **Tamaño:** esbuild 0.28.2 empaqueta cada cliente en ESM `es2022` con `minify`, `treeShaking` y `NODE_ENV=production`. Se mide el JS entregado y su tamaño con gzip. Se excluyen HTML, CSS, encabezados HTTP y dependencias de desarrollo.
- **SSR:** se crea una instancia por render. Meeko llama a `renderToString`; Vue crea una aplicación SSR y llama a [`vue/server-renderer` `renderToString`](https://vuejs.org/api/ssr). Hay dos rondas de calentamiento y nueve medidas de 500 renders. Cada cifra es el tiempo total de una ronda dividido entre 500; el `await` se aplica a ambos.
- **Carga:** Chrome headless navega a dos páginas SSR servidas por HTTP en `127.0.0.1`. El tiempo es `loadEventEnd - startTime` de Navigation Timing, con caché caliente tras dos navegaciones de calentamiento. Son nueve navegaciones medidas por motor. Esta cifra local no representa carga de red real ni Web Vitals.
- **Hidratación:** cada cliente mide `performance.now()` justo antes y después de `hydrate` de Meeko o `createSSRApp(...).mount` de Vue. Se usan las mismas nueve navegaciones medidas.
- **Actualización:** el navegador hace clic 400 veces por ronda y comprueba el texto tras cada clic. En Vue espera `nextTick()` antes de comprobar el DOM; Meeko actualiza sin esa espera. Dos rondas de calentamiento, nueve rondas medidas; cada resultado se divide entre 400.
- **Memoria:** se solicita GC mediante Chrome DevTools Protocol y se lee `JSHeapUsedSize` de la página hidratada antes de la prueba de clics. Es una sola instantánea de heap total por página; no aísla el coste de una instancia ni mide memoria máxima.

Las columnas de tiempo expresan la **mediana** de nueve rondas y, entre paréntesis, mínimo–máximo. El orden puede invertirse con `MEEKO_BENCH_ORDER=vue-first` para detectar sesgo por ejecutar siempre el mismo motor primero.

## Registro local del 23 de octubre de 2026

Windows 11 `10.0.26300`, Intel Core Ultra 9 285K, Node 24.21.0, Chrome 155.0.8059.85, Vue 3.5.44, esbuild 0.28.2. Revisión base `02096fc` con cambios locales aún sin commit; orden de esta corrida: Vue → Meeko. Se repitió con el compilador y la transferencia de estado finales. Una segunda corrida invirtió el orden: ambos motores registraron 5,00 ms de carga mediana, por lo que esa diferencia no es concluyente.

| Métrica | Meeko | Vue |
| --- | ---: | ---: |
| JS minificado | 3.522 B | 80.359 B |
| JS gzip | 1.586 B | 32.166 B |
| SSR por instancia | 0,00306 ms (0,00266–0,02375) | 0,01040 ms (0,00717–0,03290) |
| Carga HTTP local | 5,00 ms (4,30–5,30) | 5,00 ms (4,70–5,30) |
| Hidratación | 0,10 ms (0,00–0,10) | 0,20 ms (0,10–0,40) |
| Clic y actualización | 0,00250 ms (0,00250–0,00300) | 0,00275 ms (0,00250–0,00350) |
| Heap JS tras hidratar | 1.287.168 B | 1.517.856 B |

En este contador, la diferencia de tamaño es clara. Las medidas de carga y actualización se solapan, y la hidratación está cerca de la resolución del temporizador: no permiten afirmar una ventaja práctica. El heap es orientativo por ser una sola instantánea. Vue incluye funciones maduras que Meeko todavía no ofrece, y una plantilla Vue compilada podría dar cifras distintas a su función `render`. Como explica la [guía de rendimiento de Vue](https://vuejs.org/guide/best-practices/performance), el coste depende de la arquitectura y del trabajo real de cada aplicación.

## Escenarios ampliados: árbol, lista y navegación

```powershell
pnpm run benchmark:scenarios
$env:MEEKO_BENCH_ORDER = 'vue-first'
try { pnpm run benchmark:scenarios } finally { Remove-Item Env:MEEKO_BENCH_ORDER }
```

Para aislar una carga, define `MEEKO_BENCH_SCENARIO` como `tree`, `list`, `navigation` o `navigation-mount`. El runner de [escenarios](../benchmarks/scenarios.ts) comprueba el HTML SSR, el contenido e identidad de los nodos tras cada paso y la URL de navegación. Las implementaciones de [Vue](../benchmarks/vue-scenarios.ts) usan funciones `render` escritas a mano y su runtime de producción, sin compilador de plantillas en el navegador.

| Caso | Operación verificada |
| --- | --- |
| Árbol | 16 ramas × 8 hojas interactivas (145 componentes con la raíz). Se incrementa la primera hoja y se comprueban las 128. |
| Lista | 1.000 filas con claves estables. Se rota la última al inicio; se comprueban cardinalidad y claves. |
| Navegación, reutilizar | Tres vistas de 40 filas. Cada cambio conserva el mismo `section` y las filas, y actualiza texto, atributo y URL mediante `history.pushState`. |
| Navegación, montar | Las mismas vistas y URL; cada cambio sustituye el `section` y sus 40 filas en ambos motores. |

Hay dos rondas de calentamiento y siete medidas. SSR crea una instancia nueva por render: 30 renders por ronda para árbol y lista, 100 para cada navegación. El navegador hace siete cargas medidas por caso y motor con caché caliente; se mide `loadEventEnd - startTime`, hidratación con `performance.now()` y una instantánea de heap tras solicitar GC. La actualización promedia 100 pasos por ronda para árbol, 30 para lista y 60 para cada navegación. Incluye el clic, la reacción y `nextTick()` de Vue; la comprobación del DOM se hace después del temporizador. El bundle de cada motor incluye los cuatro casos y se mide una sola vez; excluye HTML, CSS y encabezados HTTP.

### Registro local del 23 de octubre de 2026

Windows 11 `10.0.26300`, Intel Core Ultra 9 285K, Node 24.21.0, Chrome 155.0.8059.85, Vue 3.5.44 y esbuild 0.28.2. Revisión base `8bb0da1` con cambios locales aún sin commit. Se ejecutó Meeko → Vue y luego Vue → Meeko, sin otros benchmarks concurrentes. La tabla contiene medianas de la primera corrida. Los tiempos están en milisegundos; actualización es por paso. El heap está en MiB y sólo es una instantánea.

| Caso | Métrica | Meeko | Vue |
| --- | --- | ---: | ---: |
| Árbol | SSR | 0,505 | 1,058 |
| Árbol | Carga HTTP local | 7,3 | 7,3 |
| Árbol | Hidratación | 1,3 | 1,3 |
| Árbol | Actualización | 0,003 | 0,003 |
| Árbol | Heap JS | 1,80 MiB | 1,89 MiB |
| Lista | SSR | 0,638 | 0,526 |
| Lista | Carga HTTP local | 14,1 | 11,7 |
| Lista | Hidratación | 3,3 | 1,9 |
| Lista | Actualización | 0,263 | 0,437 |
| Lista | Heap JS | 3,17 MiB | 2,15 MiB |
| Navegación, reutilizar | SSR | 0,040 | 0,015 |
| Navegación, reutilizar | Hidratación | 0,5 | 0,3 |
| Navegación, reutilizar | Actualización | 0,055 | 0,067 |
| Navegación, montar | SSR | 0,029 | 0,013 |
| Navegación, montar | Hidratación | 0,5 | 0,3 |
| Navegación, montar | Actualización | 0,283 | 0,075 |

Bundle conjunto: Meeko 19.617 B (6.254 B gzip); Vue 83.084 B (32.958 B gzip). Al invertir el orden, la actualización de lista fue 0,260 frente a 0,433 ms; la navegación que reutiliza nodos, 0,055 frente a 0,065 ms; y el montaje completo, 0,283 frente a 0,070 ms. El nuevo algoritmo de listas mejora la actualización, pero su hidratación y heap siguen por encima de Vue en este caso. El montaje completo de una vista también sigue siendo más lento. La comparación anterior de navegación mezclaba montaje en Meeko con reutilización en Vue; se sustituyó por las dos cargas equivalentes.

Estas cifras pertenecen a una máquina y dos implementaciones concretas. La carga HTTP local no mide red real ni Web Vitals; las diferencias pequeñas de actualización se acercan a la resolución del temporizador. Falta validar una aplicación de producción y una contraparte Vue con plantilla compilada.

### Optimización de memoria en desarrollo de 0.0.3

En la misma máquina y con el mismo runner, después de omitir escrituras DOM iniciales redundantes y asignar conjuntos de suscriptores y señales de índice sólo cuando se usan, se repitió la suite en ambos órdenes. La lista de 1.000 filas pasó de **3,17 MiB** en el registro anterior a **2,87 MiB** de heap JS tras hidratar (3.007.284 y 3.007.096 B); Vue registró 2,15 MiB (2.255.532 y 2.259.476 B). Su actualización pasó de 0,263 ms a 0,223 y 0,217 ms por paso; Vue registró 0,433 y 0,437 ms.

La hidratación de lista marcó 3,9 y 3,1 ms en Meeko frente a 1,8 y 1,9 ms en Vue. La variación entre corridas impide atribuir un cambio preciso a esta optimización, y el coste sigue por encima de Vue. El montaje completo de navegación marcó 0,252 y 0,230 ms por paso en Meeko frente a 0,077 y 0,072 ms en Vue. Las instantáneas de heap y medianas locales siguen siendo indicadores del escenario, no garantías de producción.
