# Meeko DevTools para Chrome

Panel local de Chrome DevTools para inspeccionar y editar componentes `.meeko` hidratados en desarrollo. Versión `1.0.0`, que implementa el protocolo DevTools 1. No requiere instalación de dependencias ni compilación.

## Cargar la extensión

1. Abre `chrome://extensions` y activa **Modo de desarrollador**.
2. Elige **Cargar descomprimida** y selecciona la carpeta `tools/devtools-extension` de este repositorio.
3. Abre una aplicación Meeko servida con Vite en modo desarrollo, abre las herramientas de desarrollo de Chrome y selecciona la pestaña **Meeko**. Recarga la página si las herramientas ya estaban abiertas antes de cargar la extensión.

La carpeta es el paquete instalable para desarrollo. Si se distribuye como ZIP, hay que descomprimirlo antes de usar **Cargar descomprimida**. No se publica en Chrome Web Store desde este repositorio.

Para crear un ZIP con sólo los archivos necesarios de la extensión desde la raíz del repositorio:

```powershell
pwsh -NoProfile -File tools/devtools-extension/package-zip.ps1
```

El resultado aparece en `tools/devtools-extension/artifacts/meeko-devtools-1.0.0.zip`, contiene la carpeta `meeko-devtools/` y muestra su SHA-256. Para escribirlo fuera del repositorio, pasa `-OutputPath <ruta>.zip`. El empaquetador rechaza un nombre de archivo ya existente para evitar reemplazos accidentales. El ZIP no incluye pruebas, scripts, `tsconfig.json` ni las declaraciones de tipos. La versión de esta extensión es independiente de la versión del paquete npm.

## Funciones

- Agrupa instancias por componente y permite buscarlas por nombre o archivo.
- Muestra propiedades, señales, parentesco, estado y eventos del puente de desarrollo.
- **Editar señal**: sustituye el valor de una señal editable de la instancia seleccionada por un valor JSON. El panel valida el JSON y muestra junto a **Aplicar** el error o la confirmación. El texto que estés escribiendo no se pisa con los refrescos del panel.
- La línea de tiempo muestra el componente, el archivo `.meeko`, la señal y el valor posterior. Permite filtrar sólo señales o la instancia seleccionada. Pulsa un evento para volver a una instancia que siga activa. Los eventos conservan su origen después del desmontaje.
- Cada evento de señal indica qué la escribió: «Escrita en `archivo:línea:columna`» para una asignación `.value` del archivo `.meeko` (script o handler `on:`) o «Escrita desde DevTools» para una edición. Al desplegarlo se ven las lecturas que dependían de ella, con línea, columna y tipo: texto, atributo, `computed`, condición (`if:when`), lista (`each:of`) o prop de un componente hijo.
- Permite seleccionar una instancia, resaltar su DOM y activar o desactivar su breakpoint.
- Soporta navegación por teclado en la lista con flechas arriba y abajo.

El panel consulta `window.__MEEKO_DEVTOOLS__` de la página inspeccionada y sólo admite el protocolo 1. Si la página expone otra versión o un runtime anterior a 1.0 sin versión, muestra **Protocolo no compatible** con la versión encontrada y no lee sus datos; actualiza `@meekojs/meeko` en la aplicación. Además de leer `snapshot()`, sólo envía a la página las órdenes de una lista cerrada: `select`, `highlight`, `setBreakpoint` y `setSignal`. Este puente sólo existe tras la hidratación en el navegador con Vite en modo desarrollo. Una página SSR antes de hidratarse, una compilación de producción o una página ajena a Meeko mostrará **Meeko no detectado**. Los breakpoints pausan la ejecución al cambiar una señal de esa instancia; Chrome debe tener abiertos sus DevTools para ver la pausa. Las propiedades y señales llegan como copias acotadas (profundidad 4, 50 elementos por nivel y 500 caracteres por cadena) y el panel trunca su presentación a 100 000 caracteres por valor. Como el editor parte de esa copia, aplicar sin cambios un valor truncado lo sustituye por la versión acotada.

Las lecturas indican **dónde se usa la señal**; la escritura indica **qué produjo el nuevo valor**. Ambas sólo existen con la compilación de desarrollo (`hot`). Una escritura aparece sin ubicación en estos casos:

- se hizo desde un módulo `.ts`;
- su destino no es estable, como `make().value = 1`;
- es una asignación compuesta o un `++`/`--` que contiene un `await` o un `yield` directo.

Una lectura sólo se ubica como `computed` cuando se llama al identificador `computed` con una función literal. Los detalles están en [`docs/devtools.md`](../../docs/devtools.md).

## Verificación local

Desde la raíz del repositorio:

```powershell
pnpm run devtools:check
node --test tools/devtools-extension/tests/installed.e2e.js
```

`devtools:check` ejecuta `protocol.test.js`, `protocol-types.test.js` y `layout.test.js`, y después `tsc` con `checkJs` sobre la extensión.

Los tipos del protocolo no se escriben a mano en la extensión. `types/protocol.d.ts` se genera desde `src/devtools-protocol.ts`, y `protocol.js` y `panel.js` los importan mediante JSDoc. Después de cambiar el protocolo, regenera la copia con:

```powershell
pnpm run devtools:types
```

La prueba `protocol-types.test.js` falla si la copia no coincide con la fuente. `protocol.test.js` comprueba además la versión admitida, la lista cerrada de órdenes, la normalización de lecturas y escrituras y la validación del JSON del editor.

La prueba de layout abre Chrome en modo sin interfaz a 360, 400, 420 y 800 píxeles. Comprueba el contenido, el teclado, el editor (JSON no válido con su mensaje visible, y edición correcta), las escrituras y lecturas de la línea de tiempo, el aviso de protocolo no compatible y la ausencia de desplazamiento horizontal. Usa `playwright-core` del entorno de desarrollo y Chrome instalado; se omite cuando alguno no está disponible. Para otra ruta de Chrome, configura `MEEKO_CHROME` antes de ejecutarla.

La prueba `installed.e2e.js` inicia una aplicación Meeko con Vite y un perfil temporal aislado de **Chrome for Testing**. Carga la extensión real, comprueba que el panel se registre y usa `chrome.devtools.inspectedWindow.eval` para probar la versión del protocolo, instancias, selección, resaltado, breakpoint, eventos de señales con lectura `computed` y escritura `count.value++`, y `setSignal` reflejado en el DOM. Si Chrome for Testing está en otra ruta, usa `MEEKO_CHROME_FOR_TESTING`. Esta prueba se ejecuta aparte de `pnpm run verify` porque necesita una sesión gráfica. La apertura visual de la pestaña Meeko desde el menú de Chrome DevTools queda como comprobación manual.

Después de modificar un archivo de la extensión, usa **Recargar** en `chrome://extensions` y vuelve a abrir DevTools. El panel no necesita permisos de host ni scripts de contenido: usa la API oficial `chrome.devtools.inspectedWindow.eval` exclusivamente desde DevTools.
