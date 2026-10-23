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

Para aislar un escenario, define `MEEKO_BENCH_SCENARIO` como `tree`, `list` o `navigation`. [`benchmarks/scenarios.ts`](../benchmarks/scenarios.ts) compila las fuentes `.meeko` de [`benchmarks/cases`](../benchmarks/cases), comprueba SSR y valida el DOM tras cada operación. Los archivos `*.generated.ts` se ignoran en Git. Las implementaciones Vue están en [`benchmarks/vue-scenarios.ts`](../benchmarks/vue-scenarios.ts); usan funciones `render` escritas a mano y el runtime de producción, sin compilador de plantillas en el navegador.

| Caso | Trabajo equivalente |
| --- | --- |
| Árbol | 16 ramas × 8 hojas interactivas: 145 componentes contando la raíz. Cada paso incrementa la primera hoja y verifica su texto y las 128 hojas. |
| Lista | 1.000 filas con claves estables. Cada paso rota el último elemento al principio y verifica cardinalidad y claves de primera/última fila. |
| Navegación | Tres vistas de 40 filas. Cada paso cambia la vista, usa `history.pushState` y verifica la URL, la vista activa y las 40 filas. Es navegación local sintética; no mide un router, carga de datos, `popstate` ni red. |

Cada caso usa dos rondas de calentamiento y siete medidas. SSR crea una instancia nueva por render: 30 renders por ronda para árbol/lista y 100 para navegación. El navegador hace siete navegaciones medidas por caso y motor, con caché caliente; se mide `loadEventEnd - startTime`, hidratación con `performance.now()` y una instantánea de heap JS tras solicitar GC. La actualización promedia 100 pasos por ronda para árbol, 30 para lista y 60 para navegación. La ventana medida incluye clic, reacción y `nextTick()` en Vue; la verificación del DOM ocurre después de detener el temporizador en cada paso. Como el temporizador del navegador tiene resolución limitada, especialmente en el árbol, las diferencias de milésimas de milisegundo no son concluyentes. El bundle de cada motor **incluye los tres casos** y sólo se mide una vez para el conjunto, no por escenario. Se excluyen HTML, CSS, encabezados HTTP y dependencias de desarrollo.

### Registro local del 23 de octubre de 2026

Windows 11 `10.0.26300`, Intel Core Ultra 9 285K, Node 24.21.0, Chrome 155.0.8059.85, Vue 3.5.44 y esbuild 0.28.2. Revisión base `654b078`, árbol de trabajo con cambios locales. Se ejecutó Meeko → Vue y se repitió Vue → Meeko sin otros benchmarks concurrentes. La tabla muestra **medianas de la primera corrida**, en milisegundos por render o paso, salvo carga e hidratación (milisegundos por navegación) y heap (MiB). El JSON de cada ejecución incluye mínimos, máximos, orden, versiones y parámetros.

| Caso | Métrica | Meeko | Vue |
| --- | --- | ---: | ---: |
| Árbol | SSR | 0,520 | 1,001 |
| Árbol | Carga HTTP local | 8,1 | 7,3 |
| Árbol | Hidratación | 1,4 | 1,3 |
| Árbol | Actualización | 0,003 | 0,004 |
| Árbol | Heap JS | 1,80 MiB | 1,89 MiB |
| Lista | SSR | 0,673 | 0,701 |
| Lista | Carga HTTP local | 17,3 | 11,8 |
| Lista | Hidratación | 5,8 | 1,8 |
| Lista | Actualización | 3,420 | 0,430 |
| Lista | Heap JS | 3,18 MiB | 2,15 MiB |
| Navegación | SSR | 0,029 | 0,014 |
| Navegación | Carga HTTP local | 5,4 | 5,6 |
| Navegación | Hidratación | 0,5 | 0,3 |
| Navegación | Actualización | 0,310 | 0,070 |
| Navegación | Heap JS | 1,35 MiB | 1,51 MiB |

Bundle conjunto: Meeko 17.721 B (5.756 B gzip); Vue 82.492 B (32.904 B gzip). Al invertir el orden se mantuvieron las diferencias más relevantes: SSR del árbol 0,381 frente a 1,031 ms; actualización de lista 3,373 frente a 0,420 ms; actualización de navegación 0,293 frente a 0,072 ms. La lista es una prioridad de optimización para Meeko: su hidratación, actualización y heap fueron mayores en estas cargas. Las cifras describen este equipo, estas implementaciones y esta ejecución local; no son Web Vitals ni prueban una ventaja general de ninguno de los motores. Falta evaluar redes representativas, aplicaciones completas y una contraparte Vue con plantilla compilada.
