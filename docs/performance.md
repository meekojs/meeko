# Rendimiento

## Medir tu aplicación

Mide una ruta y una interacción representativas de tu aplicación en un build de producción. Ejecuta `pnpm exec meeko build .` desde la raíz del proyecto y usa `pnpm exec meeko preview .` para servir ese build. Repite el mismo recorrido en el mismo navegador y equipo antes y después del cambio; registra la revisión, el entorno y las mediciones. Las herramientas Performance y Network del navegador permiten observar carga, hidratación, solicitudes y tamaño transferido.

## Optimizar con evidencia

Identifica primero el tramo más lento: respuesta del servidor, descarga, ejecución del cliente o interacción después de hidratar. Reduce trabajo o datos en ese tramo y vuelve a medir con el mismo recorrido. Comprueba también que la interacción y el HTML inicial siguen funcionando; un menor tamaño de bundle por sí solo no demuestra una mejora de experiencia.

Los [benchmarks de Meeko](benchmarks.md) y el presupuesto del repositorio usan un escenario pequeño y fijo. Sus cifras no predicen el rendimiento de tu aplicación.

## Presupuesto del repositorio

### Medición reproducible

Consulta [medición reproducible en la guía de contribuidores](contributing.md#medición-reproducible).

### Categorías de métricas

Consulta [categorías de métricas en la guía de contribuidores](contributing.md#categorías-de-métricas).

### Presupuestos y comparación

Consulta [presupuestos y comparación en la guía de contribuidores](contributing.md#presupuestos-y-comparación).

### Actualizar una baseline

Consulta [actualizar una baseline en la guía de contribuidores](contributing.md#actualizar-una-baseline).
