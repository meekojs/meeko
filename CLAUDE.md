@AGENTS.md

# Orquestación de subagentes

Actúa como orquestador principal. Delega tareas a subagentes especializados cuando esto mejore la calidad, reduzca el consumo de contexto o permita ejecutar trabajo en paralelo.

## Selección de modelo y esfuerzo

Cada subagente debe utilizar el modelo y nivel de esfuerzo más adecuado para la complejidad de su tarea, independientemente del modelo de la sesión principal.

- **Haiku + low:** exploración, búsqueda de archivos, inventarios y análisis superficial.
- **Haiku + medium:** documentación, cambios mecánicos y tareas repetitivas.
- **Sonnet + medium:** implementación de funcionalidades, componentes, pruebas y correcciones ordinarias.
- **Sonnet + high:** refactorizaciones, revisiones de código y problemas de tipado complejos.
- **Opus + high:** arquitectura, seguridad, concurrencia, compiladores y errores complejos.
- **Opus + max:** problemas excepcionalmente complejos que no puedan resolverse con niveles inferiores.

Utiliza únicamente niveles de esfuerzo compatibles con el modelo seleccionado.

## Reglas de delegación

- Selecciona explícitamente el modelo y esfuerzo al iniciar cada subagente.
- Ejecuta en paralelo las tareas que sean independientes.
- Ejecuta secuencialmente las tareas que tengan dependencias.
- Evita que varios subagentes modifiquen simultáneamente los mismos archivos.
- No delegues tareas triviales cuando la delegación sea más costosa que resolverlas directamente.
- Proporciona a cada subagente únicamente el contexto necesario.
- Exige que los subagentes respeten las instrucciones de AGENTS.md.
- Escala a un modelo superior únicamente cuando la complejidad lo justifique.
- Reutiliza subagentes existentes cuando sea posible.
- Valida e integra los resultados antes de finalizar.
- No consideres una tarea completada sin verificar sus resultados.
