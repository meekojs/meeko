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

En este contador, la diferencia de tamaño es clara. Las medidas de carga y actualización se solapan, y la hidratación está cerca de la resolución del temporizador: no permiten afirmar una ventaja práctica. El heap es orientativo por ser una sola instantánea. Esta comparativa cubre un componente pequeño; Vue incluye funciones maduras que Meeko todavía no ofrece, y una plantilla Vue compilada podría dar cifras distintas a su función `render`. Como explica la [guía de rendimiento de Vue](https://vuejs.org/guide/best-practices/performance), el coste depende de la arquitectura y del trabajo real de cada aplicación. Antes de hacer afirmaciones generales, conviene ampliar los casos a listas grandes, árboles de componentes, navegación y redes representativas.
