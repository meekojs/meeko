# Cambios de Meeko

## 0.0.3 (en desarrollo)

- Hidratación sin escrituras iniciales redundantes de texto y atributos; señales sin lectores y filas que no usan el índice asignan menos memoria.
- Reconciliación de listas con claves que conserva regiones ordenadas y evita movimientos innecesarios; hidratación inicial sin reconciliación cuando el estado SSR sigue intacto.
- Aplicación piloto con SSR, hidratación, formularios, navegación, componentes anidados y API asíncrona, probada en desarrollo y producción con Chromium, Firefox y WebKit.
- `meeko init <directorio>` genera un proyecto SSR independiente que fija la versión exacta de su compilador y runtime.
- Línea de tiempo de señales en ambos paneles DevTools, con componente, valor seguro y expresiones de texto o atributo que leen cada señal, ubicadas en el `.meeko`.
- Workflow de publicación npm mediante Trusted Publishing; vínculo OIDC registrado para `meekojs/meeko` y `publish.yml`, pendiente de su primera ejecución con una versión nueva.

## 0.0.2

- DevTools experimental para inspeccionar instancias hidratadas, props, señales, eventos, árbol de componentes y estado de hidratación durante el desarrollo con Vite.
- Panel integrado y extensión local de Chrome DevTools con selección, resaltado y puntos de parada por instancia.
- Ruta `@meekojs/meeko/internal` para el runtime generado por el compilador. Los exports internos anteriores siguen disponibles en la raíz durante la serie experimental para conservar compatibilidad.
- Configuración de depuración de la extensión de VS Code y ampliaciones de sus verificaciones y de los benchmarks reproducibles.

La sintaxis y las API de la serie `0.x` siguen siendo experimentales. El compilador y su runtime deben usar la misma versión del paquete.

## 0.0.1

- Primera versión pública con componentes `.meeko`, SSR, hidratación, señales reactivas, plugin de Vite, HMR, CLI y extensión local de VS Code.
