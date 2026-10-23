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

- [ ] Elegir licencia y política de versiones; retirar `private` sólo cuando el paquete esté listo.
- [ ] Probar el paquete del motor como dependencia de una aplicación externa con instalación reproducible y definir qué API internas permanecen públicas.
- [ ] Preparar y comprobar la extensión de VS Code para otras plataformas además de Windows x64.
- [ ] Ampliar la comparativa a árboles, listas grandes y navegación antes de hacer afirmaciones generales de rendimiento.
- [ ] Decidir si `:global` en CSS, streaming SSR y un servidor de lenguaje independiente entran en la primera versión pública.
