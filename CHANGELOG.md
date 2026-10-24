# Cambios de Meeko

## [0.0.4] - Unreleased

### Framework full-stack

- Rutas basadas en archivos con parámetros y navegación tipados, layouts persistentes, SSR e hidratación.
- Estado `useState` aislado por petición, prerender y composición de módulos y layers.
- Starter `meeko init-framework` y generación de manifiestos mediante CLI y Vite.

### Autoimports y tipos

- Autoimports tipados en `.meeko` y `.ts` para componentes, composables, stores y utilidades; símbolos `api`, `rpc`, `socket` y `useSocket`.
- Declaraciones TypeScript generadas por ámbito, con separación entre código cliente, servidor y shared.

### Servidor

- API HTTP y RPC tipados mediante contratos Standard Schema; despacho RPC local durante SSR con la misma validación y autorización.
- Sesiones con adaptadores Redis y SQL, y canales WebSocket con transporte Node.
- Validación de entradas y salidas, autorización y errores normalizados.

### Seguridad y correcciones

- Aislamiento de peticiones SSR, protección CSRF y límites de imports entre cliente y servidor.
- Protección de rutas públicas y layers frente a enlaces simbólicos que salen del proyecto.
- Comprobaciones de Origin y autorización de WebSocket; `ws` se carga sólo al activar el adaptador Node.

### Verificación y herramientas

- Mejoras de Vite y CLI, source maps de JavaScript con fuentes embebidas y baseline reproducible de rendimiento.
- Consumidor externo desde tarball, integración con Redis real en CI y E2E en Chromium, Firefox y WebKit.

## 0.0.3

- `meeko init .` configura una carpeta recién preparada con pnpm, conserva su manifiesto y archivos del gestor, y rechaza proyectos que ya contienen código o scripts incompatibles.
- Hidratación sin escrituras iniciales redundantes de texto y atributos; señales sin lectores y filas que no usan el índice asignan menos memoria.
- Reconciliación de listas con claves que conserva regiones ordenadas y evita movimientos innecesarios; hidratación inicial sin reconciliación cuando el estado SSR sigue intacto.
- Aplicación piloto con SSR, hidratación, formularios, navegación, componentes anidados y API asíncrona, probada en desarrollo y producción con Chromium, Firefox y WebKit.
- `meeko init <directorio>` genera un proyecto SSR independiente que fija la versión exacta de su compilador y runtime.
- Línea de tiempo de señales en ambos paneles DevTools, con componente, valor seguro y expresiones de texto o atributo que leen cada señal, ubicadas en el `.meeko`.
- Primera publicación npm mediante Trusted Publishing, con procedencia firmada desde `meekojs/meeko` y `publish.yml`.

## 0.0.2

- DevTools experimental para inspeccionar instancias hidratadas, props, señales, eventos, árbol de componentes y estado de hidratación durante el desarrollo con Vite.
- Panel integrado y extensión local de Chrome DevTools con selección, resaltado y puntos de parada por instancia.
- Ruta `@meekojs/meeko/internal` para el runtime generado por el compilador. Los exports internos anteriores siguen disponibles en la raíz durante la serie experimental para conservar compatibilidad.
- Configuración de depuración de la extensión de VS Code y ampliaciones de sus verificaciones y de los benchmarks reproducibles.

La sintaxis y las API de la serie `0.x` siguen siendo experimentales. El compilador y su runtime deben usar la misma versión del paquete.

## 0.0.1

- Primera versión pública con componentes `.meeko`, SSR, hidratación, señales reactivas, plugin de Vite, HMR, CLI y extensión local de VS Code.
