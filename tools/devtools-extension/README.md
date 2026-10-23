# Meeko DevTools para Chrome

Panel local de Chrome DevTools para inspeccionar componentes `.meeko` hidratados en desarrollo. No requiere instalación de dependencias ni compilación.

## Cargar la extensión

1. Abre `chrome://extensions` y activa **Modo de desarrollador**.
2. Elige **Cargar descomprimida** y selecciona la carpeta `tools/devtools-extension` de este repositorio.
3. Abre una aplicación Meeko servida con Vite en modo desarrollo, abre las herramientas de desarrollo de Chrome y selecciona la pestaña **Meeko**. Recarga la página si las herramientas ya estaban abiertas antes de cargar la extensión.

La carpeta es el paquete instalable para desarrollo. Si se distribuye como ZIP, hay que descomprimirlo antes de usar **Cargar descomprimida**. No se publica en Chrome Web Store desde este repositorio.

Para crear un ZIP con sólo los archivos necesarios de la extensión desde la raíz del repositorio:

```powershell
pwsh -NoProfile -File tools/devtools-extension/package-zip.ps1
```

El resultado aparece en `tools/devtools-extension/artifacts/meeko-devtools-0.0.1.zip`, contiene la carpeta `meeko-devtools/` y muestra su SHA-256. El empaquetador rechaza un nombre de archivo ya existente para evitar reemplazos accidentales. La versión de esta extensión es independiente de la versión del paquete npm.

## Funciones

- Agrupa instancias por componente y permite buscarlas por nombre o archivo.
- Muestra propiedades, señales, parentesco, estado y eventos del puente de desarrollo.
- La línea de tiempo muestra el componente, archivo `.meeko`, señal y valor posterior; permite filtrar sólo señales o la instancia seleccionada. Pulsa un evento para volver a una instancia que siga activa. Los eventos conservan su origen después del desmontaje. Al desplegar un evento de señal se ven las expresiones de texto y atributo que dependían directamente de ella, con línea y columna.
- Permite seleccionar una instancia, resaltar su DOM y activar o desactivar su breakpoint.
- Soporta navegación por teclado en la lista con flechas arriba y abajo.

El panel consulta `window.__MEEKO_DEVTOOLS__` de la página inspeccionada. Este puente sólo existe tras la hidratación en el navegador con Vite en modo desarrollo. Una página SSR antes de hidratarse, una compilación de producción o una página ajena a Meeko mostrará **Meeko no detectado**. Los breakpoints pausan la ejecución al cambiar una señal de esa instancia; Chrome debe tener abiertos sus DevTools para ver la pausa. Las propiedades y señales se muestran como datos serializables y pueden aparecer truncadas a 100 000 caracteres por valor.

La ubicación de lectura indica **dónde se usa la señal en la plantilla**, no dónde el código escribió su nuevo valor. Sólo se muestran dependencias observadas directamente por expresiones de texto y atributos en la instancia actual. Las dependencias indirectas a través de `computed`, condiciones, listas o props de componentes no reciben una ubicación de lectura hasta que esos bindings tengan instrumentación propia.

## Verificación local

Desde la raíz del repositorio:

```powershell
node --test tools/devtools-extension/tests/protocol.test.js
node --test tools/devtools-extension/tests/layout.test.js
pnpm exec tsc -p tools/devtools-extension/tsconfig.json
node --test tools/devtools-extension/tests/installed.e2e.js
```

La prueba de layout abre Chrome en modo sin interfaz a 360, 400, 420 y 800 píxeles y comprueba contenido, teclado y ausencia de desplazamiento horizontal. Usa `playwright-core` del entorno de desarrollo y Chrome instalado; se omite cuando alguno no está disponible. Para otra ruta de Chrome, configura `MEEKO_CHROME` antes de ejecutarla.

La prueba `installed.e2e.js` inicia una aplicación Meeko con Vite y un perfil temporal aislado de **Chrome for Testing**. Carga la extensión real, comprueba que el panel se registre y usa `chrome.devtools.inspectedWindow.eval` para probar instancias, selección, resaltado, breakpoint y eventos de señales. Si Chrome for Testing está en otra ruta, usa `MEEKO_CHROME_FOR_TESTING`. Esta prueba se ejecuta aparte de `pnpm run verify` porque necesita una sesión gráfica. La apertura visual de la pestaña Meeko desde el menú de Chrome DevTools queda como comprobación manual.

Después de modificar un archivo de la extensión, usa **Recargar** en `chrome://extensions` y vuelve a abrir DevTools. El panel no necesita permisos de host ni scripts de contenido: usa la API oficial `chrome.devtools.inspectedWindow.eval` exclusivamente desde DevTools.
