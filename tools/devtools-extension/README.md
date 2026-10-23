# Meeko DevTools para Chrome

Panel local de Chrome DevTools para inspeccionar componentes `.meeko` hidratados en desarrollo. No requiere instalación de dependencias ni compilación.

## Cargar la extensión

1. Abre `chrome://extensions` y activa **Modo de desarrollador**.
2. Elige **Cargar descomprimida** y selecciona la carpeta `tools/devtools-extension` de este repositorio.
3. Abre una aplicación Meeko servida con Vite en modo desarrollo, abre las herramientas de desarrollo de Chrome y selecciona la pestaña **Meeko**. Recarga la página si las herramientas ya estaban abiertas antes de cargar la extensión.

La carpeta es el paquete instalable para desarrollo. Si se distribuye como ZIP, hay que descomprimirlo antes de usar **Cargar descomprimida**. No se publica en Chrome Web Store desde este repositorio.

## Funciones

- Agrupa instancias por componente y permite buscarlas por nombre o archivo.
- Muestra propiedades, señales, parentesco, estado y eventos del puente de desarrollo.
- Permite seleccionar una instancia, resaltar su DOM y activar o desactivar su breakpoint.
- Soporta navegación por teclado en la lista con flechas arriba y abajo.

El panel consulta `window.__MEEKO_DEVTOOLS__` de la página inspeccionada. Este puente sólo existe tras la hidratación en el navegador con Vite en modo desarrollo. Una página SSR antes de hidratarse, una compilación de producción o una página ajena a Meeko mostrará **Meeko no detectado**. Los breakpoints pausan la ejecución al cambiar una señal de esa instancia; Chrome debe tener abiertos sus DevTools para ver la pausa. Las propiedades y señales se muestran como datos serializables y pueden aparecer truncadas a 100 000 caracteres por valor.

## Verificación local

Desde la raíz del repositorio:

```powershell
node --test tools/devtools-extension/tests/protocol.test.js
node --test tools/devtools-extension/tests/layout.test.js
pnpm exec tsc -p tools/devtools-extension/tsconfig.json
```

La prueba de layout abre Chrome en modo sin interfaz a 360, 400, 420 y 800 píxeles y comprueba contenido, teclado y ausencia de desplazamiento horizontal. Usa `playwright-core` del entorno de desarrollo y Chrome instalado; se omite cuando alguno no está disponible. Para otra ruta de Chrome, configura `MEEKO_CHROME` antes de ejecutarla.

Después de modificar un archivo de la extensión, usa **Recargar** en `chrome://extensions` y vuelve a abrir DevTools. El panel no necesita permisos de host ni scripts de contenido: usa la API oficial `chrome.devtools.inspectedWindow.eval` exclusivamente desde DevTools.
