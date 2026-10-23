# Plan de desarrollo

Estado: motor experimental. Cada etapa se considera terminada cuando sus criterios se comprueban en el código actual, las pruebas y, donde corresponda, un navegador real.

## 1. Parser y diagnósticos

- [ ] Analizar secciones y plantilla con un AST propio y posiciones de inicio y fin.
- [x] Rechazar secciones duplicadas, HTML inválido y expresiones incompletas con diagnósticos en `.meeko`.
- [ ] Conservar un mapa desde código generado hasta archivo original para errores de TypeScript.

**Aceptación:** un error en script, plantilla o estilo señala la ubicación correcta del `.meeko` y el CLI falla sin emitir un módulo incompleto.

## 2. Plantillas completas

- [ ] Atributos dinámicos y booleanos con escape SSR y actualización reactiva.
- [ ] Condiciones con límites de región deterministas entre servidor y navegador.
- [ ] Listas con claves obligatorias, inserción, eliminación y reordenamiento sin perder el estado de elementos conservados.
- [ ] Tipos precisos de props, eventos y variables locales de listas.

**Aceptación:** cada construcción tiene pruebas de salida SSR, hidratación sin reemplazar nodos, actualización y eliminación de observadores.

## 3. SSR e hidratación robustos

- [ ] Instancias múltiples, componentes anidados y marcadores únicos por raíz.
- [ ] Transferencia de estado serializable y comprobación explícita de datos no serializables.
- [ ] Diagnósticos de hidratación que indiquen componente y ubicación.
- [ ] Pruebas de aislamiento entre peticiones concurrentes.

**Aceptación:** dos componentes con el mismo código en una página funcionan independientemente y una petición no puede leer estado de otra.

## 4. Tipado y editor

- [ ] Verificación directa de `.meeko` con diagnósticos en el archivo fuente.
- [ ] Autocompletado, navegación, renombrado y hover en script y plantilla.
- [ ] Formateo consistente y resaltado validado en la extensión VS Code.

**Aceptación:** el editor y el CLI muestran los mismos errores y las refactorizaciones conservan referencias entre plantilla y script.

## 5. Integración y rendimiento

- [ ] Plugin Vite que transforma `.meeko` para cliente y servidor con HMR.
- [ ] Pruebas E2E en navegador real: primera carga, hidratación, navegación y actualización.
- [ ] Comparativas reproducibles frente a Vue con funciones y configuración equivalentes: tamaño comprimido, tiempo de carga, actualización y memoria.
- [ ] Documentación de API, límites de compatibilidad y preparación de publicación.

**Aceptación:** una aplicación de ejemplo se ejecuta en desarrollo y producción sin pasos manuales de generación; las cifras de rendimiento incluyen scripts y condiciones de medición reproducibles.
