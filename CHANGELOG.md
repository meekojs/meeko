# Cambios de Meeko

## [Unreleased]

### Cambios incompatibles y migración

- La raíz `@meekojs/meeko` sólo exporta la API pública documentada: `signal`, `computed`, `effect`, `batch`, `untrack`, `createRoot`, `onCleanup`, `createContext`, `provide`, `inject`, `provideErrorHandler`, `serializeJson` y sus tipos. Los helpers de DOM, SSR, HMR y DevTools (`bind*`, `render*`, `keyToken`, `withStateSnapshot`, `escapeHtml`, `attributeValue`, `renderAttribute`, `enableHotModule`, `registerHot*`, `replaceHot*`, `restoreSignals`, `snapshotSignals`, `registerDevtoolsInstance`) quedan sólo en `@meekojs/meeko/internal`, que es lo que importa el código generado desde `0.0.2`. Vuelva a compilar los módulos generados con `0.0.1`.
- `ComponentErrorHandler` recibe un segundo argumento `source: ErrorSource`. Los handlers de un solo parámetro siguen siendo válidos.
- El payload de hidratación y navegación lleva `v: 1`, `render` y `head`. El cliente rechaza un payload sin versión con un mensaje explícito; servidor y navegador deben salir del mismo build.
- Se elimina `FrameworkHandlerOptions.renderLayout`. Los layouts se componen siempre mediante el outlet `<component is="props.outlet">`.

### Añadido y corregido

- `mountClientApp({ onError })` observa los fallos de la aplicación (navegación, Socket, y eventos, efectos o limpiezas sin un `provideErrorHandler` más cercano) junto con su `ErrorSource`. `provideErrorHandler` recibe también los rechazos de `effect` y `onCleanup` que devuelven una promesa por error.
- La navegación cliente es transaccional: la vista nueva se hidrata junto a la actual y la anterior sólo se retira tras una hidratación correcta; un outlet restaura su página anterior. Sólo si también falla esa restauración se recarga la última URL confirmada.
- La navegación actualiza `document.title` con el `head` de la página siguiente.
- `FrameworkHandlerOptions.document` añade marcado del host a `<head>` y al final de `<body>`, también en la página `+error.meeko`, y aplica un `nonce` CSP por petición a los estilos y al script de entrada. `head` y `bodyEnd` pueden ser funciones que reciben la petición y su nonce.
- Un evento, efecto o limpieza de un componente sin observador antepasado sólo se entrega al `onError` de la aplicación o a la consola, nunca al `provideErrorHandler` de otro componente.
- Las interpolaciones con entidades HTML (`&copy;`, `&lt;`) o saltos CRLF se ubican en la misma posición en `meeko check` y en VS Code: el compilador analiza el texto fuente y decodifica cada parte como el parser HTML. El analizador trata como división el `/` tras `i++`, `i--` o una propiedad con nombre de palabra clave (`obj.return / 2`) y acepta continuaciones de línea CRLF dentro de cadenas.
- `meeko --help` y `meeko --version`.

- Las expresiones de texto admiten llaves anidadas: objetos literales, plantillas literales con `${...}`, cadenas que contienen `{` o `}`, comentarios y expresiones regulares. Compilador y VS Code comparten el mismo analizador, por lo que SSR, hidratación, `meeko check` y el editor ubican cada expresión en la misma posición. Una interpolación sin cerrar se informa con `MEEK010` en su llave de apertura, y `{}` se informa como expresión vacía (`MEEK009`).
- El código generado envuelve entre paréntesis las expresiones devueltas por funciones flecha, de modo que una expresión que empieza por `{`, como `bind:title="{ text: label }.text"`, no se interpreta como bloque.
- VS Code mapea los valores de directivas sin comillas, como `on:click=handler` o `each:of=items`, con la misma lógica que el compilador; sus diagnósticos, navegación y renombrado ya no se omiten.
- `<style scoped>` admite `:global(<selector>)`: el selector interno se emite sin el atributo de ámbito, que se añade al último compuesto local (`.card :global(.icon)` produce `.card[data-meeko-s-…] .icon`). `:global` sin selector, con una lista de selectores o anidado en otra pseudoclase falla con `MEEK019` en su posición.

## [0.1.0] - 2026-10-25

Este bloque contiene cambios incompatibles respecto de `0.0.4`. De acuerdo con la política SemVer de Meeko para la serie `0.x`, se publica como `0.1.0`, no como un patch.

### Cambios incompatibles y migración

- `effect` y `onCleanup` sólo aceptan callbacks síncronos. Inicie el trabajo asíncrono desde un callback síncrono, observe sus errores y gestione explícitamente su cancelación; no devuelva una promesa al runtime reactivo.
- Los stores persistentes personalizados deben conservar `familyId` e implementar `replace` y `revokeFamily` de forma atómica. Migre registros e índices antes del arranque en producción: `SessionManager({ production: true, ... })` rechaza un store incompleto; en desarrollo, la operación que necesite una capacidad ausente falla de forma explícita.
- `render: "client"` ya no forma parte del contrato de páginas. Elimínelo para usar SSR, que continúa siendo el valor predeterminado, o use `render: "prerender"` cuando corresponda.
- Los proyectos generados activan `verbatimModuleSyntax`, `noUncheckedIndexedAccess` y `exactOptionalPropertyTypes`. Use `import type`, compruebe accesos por índice y declare `| undefined` explícitamente cuando la ausencia sea un valor permitido.
- Los contratos Standard Schema públicos deben resolver a tipos concretos. Sustituya `any`, `unknown`, `never`, parámetros genéricos no resueltos y tipos anidados inseguros por tipos públicos concretos de entrada y salida.
- Las rutas estáticas ya no aceptan `params`; las rutas API/RPC que forman jerarquías ambiguas o no representables deben renombrarse. Los parámetros dinámicos deben corresponder exactamente con la URL. Las queries públicas deben aceptar texto o listas de texto y modelar como opcionales las claves que puedan faltar; transforme números dentro del schema.
- Los contratos de componentes, páginas, layouts y errores validan las props que el host realmente suministra. Declare esas props precisas y no ensanche un componente para ocultar requisitos obligatorios.
- Para migrar un starter full-stack de `0.0.4`, adopte `meeko dev`, `meeko check`, `meeko build` y `meeko start`; compare primero cualquier personalización y después retire `server.mjs`, las entradas cliente/servidor, las configuraciones Vite y los `tsconfig.*` ahora generados bajo `.meeko/`. Puede mover el layout raíz a `app/layouts/default.meeko`, pero no lo conserve a la vez que `app/pages/+layout.meeko`.

### Añadido y corregido

- La revocación de sesiones ahora invalida atómicamente la familia activa después de rotaciones concurrentes en memoria, Redis y SQL. Los drivers SQL personalizados deben migrar `familyId` e implementar `revokeFamily`; los stores de producción antiguos fallan al iniciar. VS Code aplica las mismas opciones estrictas de TypeScript que la CLI, HMR acepta IDs de módulo con caracteres de selector CSS y Socket comunica errores del transporte al observador activo.
- El descubrimiento rechaza colisiones jerárquicas que convertirían un miembro `api` o `rpc` simultáneamente en función y objeto. El starter independiente observa y conserva los fallos al cerrar HTTP y Vite mediante `SIGINT` o `SIGTERM`.
- La generación de tipos registra las declaraciones de componentes que administra y elimina las huérfanas tras borrar o renombrar una fuente. La adopción desde versiones anteriores usa el AST del contrato generado y conserva declaraciones ajenas.
- Los autoimports conservan parámetros, restricciones y defaults de tipos genéricos reexportados y deduplican overloads del mismo símbolo. Los proyectos generados usan las mismas opciones estrictas que CLI y VS Code.
- API, RPC y Socket rechazan schemas Standard Schema degradados a `any`, `unknown` o `never`, incluidos parámetros genéricos no resueltos y tipos inseguros anidados; el descubrimiento rechaza APIs raíz sin clave y rutas jerárquicas imposibles de representar. Si el arranque falla, los errores adicionales de cierre llegan al observador sin sustituir la causa original.
- `onCleanup` exige callbacks síncronos en tipos y runtime; un retorno thenable se observa sin `unhandledRejection`, no impide las demás limpiezas y participa en el `AggregateError` de la raíz.
- VS Code tipa `each:index` como `number`, igual que el compilador. La navegación solicita volver a la URL confirmada si falla `pushState` o `replaceState`, y preserva los errores de recuperación.
- `+error.meeko` conserva el contexto SSR de la petición, incluso en peticiones concurrentes; el cliente ignora tokens CSRF de respuestas anteriores a un cambio de sesión o navegación, y VS Code comprueba los tipos de `on:event` y `each:key` como el CLI.
- HMR restaura listeners y todas las raíces del módulo si falla su limpieza o una actualización posterior, mientras el adaptador Node conserva el `requestId` ya enviado al cliente cuando falla un stream de respuesta.
- El outlet del starter y los contratos de layout validan con mayor precisión el `Component`, sus props y la transferencia de estado SSR; los reemplazos de componentes y listas conservan la región previa cuando falla su hidratación o movimiento, y Socket intenta cerrar el peer aunque falle la desuscripción.
- `provideErrorHandler` permite observar errores de eventos por raíz de componentes con autoimport y tipo `unknown`; HMR conserva el contexto padre al reemplazar o restaurar una instancia.
- La navegación y los canales Socket de una aplicación montada consultan su observador activo; `socket` autoimportado conserva conexiones por aplicación y libera listeners al desmontar componentes. HMR preserva el fallo original si también falla el rollback.
- Los scripts `.meeko` admiten llamadas de expresión durante el setup para registrar hooks sin declaraciones artificiales.
- Tipado de defaults de `defineProps`, props de componentes hijos y contratos entre páginas y sidecars de ruta.
- Hidratación de expresiones de texto inicialmente vacías sin perder eventos, verificada con el componente de login original en Chrome.
- Comprobación TypeScript por ámbito de las fuentes de app, shared, servidor, layers y módulos configurados.
- Errores de servidor normalizados con `requestId` en páginas, API, RPC y WebSocket; cierre más robusto de recursos Node.
- Los fallos de limpieza de raíces y componentes compilados conservan también el error original; los fallos de navegación cliente por historial y clic se observan sin rechazos pendientes.
- Los contratos de páginas, layouts y páginas de error rechazan props inseguras; el editor muestra esos diagnósticos sobre `defineProps` al abrir o guardar el proyecto.
- Los componentes recibidos como props comprueban también si sus props obligatorias pueden omitirse; el editor actualiza diagnósticos y colores al guardar módulos TypeScript importados.
- Las rutas sin parámetros rechazan `params` en TypeScript; el editor vuelve a comprobar contratos de páginas cuando cambia un tipo importado por un sidecar.
- Las navegaciones descartadas no conservan estado provisional ni tokens CSRF, y los observadores reactivos pendientes terminan de ejecutarse aunque otro falle.
- Socket comunica fallos de listeners, observadores de estado y reconexión, ignora mensajes de conexiones reemplazadas y continúa un broadcast hacia peers sanos si uno falla.
- Los observadores de errores de navegación y servidor pueden ser asíncronos sin producir rechazos sin manejar; si fallan, Meeko informa el fallo sin sustituir la respuesta original.
- Los handlers `on:event` asíncronos ya entregan su promesa al runtime para registrar rechazos; los errores de TypeScript de módulos `.ts` importados señalan su archivo y posición reales.
- Eventos, navegación, Socket y DevTools comparten una captura interna de callbacks síncronos y asíncronos; los E2E fallan también ante errores de consola.
- `effect` rechaza callbacks que devuelven promesas en tipos y runtime; un rechazo asíncrono concurrente queda observado y registrado. Las aplicaciones que usaban `effect(async () => ...)` deben iniciar el trabajo asíncrono desde un callback síncrono y manejar su cancelación.
- Los contratos API rechazan `params` que no coincidan con la ruta y valores de `query` incompatibles con el transporte URL.
- La limpieza de listas libera todos los hijos aunque falle un release o una hidratación posterior; el middleware HTTP propaga fallos de `next()` aunque su autor no lo espere.
- El adaptador HTTP Node conserva varias cookies `Set-Cookie` y detiene el streaming cuando el cliente se desconecta.
- Comandos de proyecto generados por Meeko, layouts en `app/layouts`, middleware de rutas y HTTP, y validación ampliada del consumidor externo.
- CI selecciona el tarball generado por el build en lugar de fijar el nombre de una versión publicada.
- El workflow de publicación exige ahora las pruebas de la extensión VS Code sobre el SHA del tag.

## [0.0.4] - 2026-10-24

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
