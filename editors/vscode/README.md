# Extensión de VS Code para Meeko

La extensión reconoce archivos `.meeko`, resalta las secciones TypeScript, HTML y CSS y muestra los mismos diagnósticos de compilación y tipos que `meeko check`. El análisis semántico usa un archivo TypeScript virtual: las referencias del `<script>` y las expresiones del `<template>` comparten completado, navegación, hover, renombrado y color semántico. Así, una constante conserva su clasificación al usarse en interpolaciones y directivas. El formato utiliza TypeScript y los servicios de lenguaje HTML y CSS integrados en la extensión, sin abrir documentos temporales al guardar.

`defineProps<Props>({ count: 0 })` ofrece defaults tipados en el editor: la prop puede omitirse al usar el componente y se reconoce como definida dentro de su script y plantilla. El compilador y el modelo semántico del editor comparten el análisis AST de esas claves.

## Primeros pasos

1. Instala **Meeko Language** en Visual Studio Code 1.140.0 o posterior.
2. Abre tu proyecto Meeko y un archivo con extensión `.meeko`.
3. Usa completado, hover, ir a definición, renombrado y **Format Document** desde el editor.

Consulta el panel **Problemas** para ver los diagnósticos de compilación y TypeScript. En un workspace confiable, al abrir o guardar una página, un layout o su sidecar, la extensión comprueba los contratos de props del proyecto y señala los errores `MEEK_PAGE_PROPS`, `MEEK_LAYOUT_PROPS` y `MEEK_ERROR_PROPS` sobre `defineProps` en el `.meeko`. Esta comprobación de proyecto usa los archivos guardados y no se ejecuta por cada pulsación. El canal de salida **Meeko** muestra los fallos internos del comprobador.

Al guardar un módulo TypeScript o JavaScript del mismo proyecto, la extensión vuelve a comprobar los componentes `.meeko` abiertos, actualiza sus tokens semánticos y recalcula los contratos de páginas y layouts abiertos. Esto permite ver un cambio de tipo de una dependencia, incluso del resultado de un loader, sin editar otra vez el componente.

La extensión incluye sus herramientas de análisis. Para crear y ejecutar una aplicación, consulta el [repositorio de Meeko](https://github.com/meekojs/meeko). Puedes reportar problemas en [GitHub Issues](https://github.com/meekojs/meeko/issues).

Se distribuyen paquetes para Windows, Linux y macOS, en arquitecturas x64 y ARM64. No se admite VS Code para web ni Alpine Linux.

El icono del lenguaje `.meeko` aparece cuando el tema de iconos activo admite ese mecanismo y no define otro icono para `.meeko`; algunos temas pueden reemplazarlo.

## Probar en desarrollo

Desde `editors/vscode` en el repositorio:

```powershell
pnpm install
pnpm run check
pnpm run test
pnpm run build
code --new-window --extensionDevelopmentPath="$(Get-Location)" "$(Resolve-Path ../..)"
```

Abre un `.meeko` y consulta el panel **Problemas** para errores `MEEK` o `TS`. La extensión analiza los cambios después de una pausa de 450 ms. La salida **Meeko** registra fallos internos del comprobador. `meeko check <archivo.meeko> --json` permite contrastar los diagnósticos desde una terminal.

## Desarrollo: paquetes por plataforma

```powershell
pnpm run package:vsix
pwsh -NoProfile -File package-vsix.ps1 -Target linux-x64
pwsh -NoProfile -File package-vsix.ps1 -Target darwin-arm64
pnpm run test:host:isolated
```

`package:vsix` genera un VSIX para el sistema y arquitectura del equipo. `-Target` también admite `win32-x64`, `win32-arm64`, `linux-x64`, `linux-arm64`, `darwin-x64` y `darwin-arm64`, de modo que se pueden preparar paquetes para otros equipos desde Windows. Cada archivo se guarda en `artifacts/meeko-language-<versión>-<target>.vsix`; no se publica ni instala automáticamente. El script requiere PowerShell 7, aísla la instalación de TypeScript 6/7 y verifica que el VSIX contenga exactamente el ejecutable nativo de TypeScript 7 para su destino. [VS Code distribuye extensiones con binarios nativos por plataforma](https://code.visualstudio.com/api/working-with-extensions/publishing-extension#platform-specific-extensions).

`test:host:isolated` prueba el VSIX de la **plataforma anfitriona** en un VS Code real: extrae el paquete, instala Meeko en un proyecto consumidor temporal y comprueba diagnósticos, navegación, hover, renombrado, completado y formato al guardar. En Windows busca la instalación habitual de VS Code; en macOS y Linux intenta encontrar `code` en `PATH`. Si no lo encuentra, `@vscode/test-electron` descarga la versión estable en una carpeta temporal. Puedes indicar otra instalación con `pwsh -NoProfile -File tests/prepare-host.ps1 -VSCodeExecutable <ruta>`. La matriz de CI ejecuta esta prueba en Windows, Linux y macOS (con `xvfb-run` en Linux). No se generan VSIX para Alpine ni para web, que necesitarían soporte adicional del ejecutable TypeScript 7 y del host de extensión.

## Alcance actual

- Las referencias semánticas abarcan declaraciones del script, expresiones de texto y de directivas, incluso las variables locales de listas. El renombrado se limita al componente abierto; no reescribe otros archivos.
- El modelo virtual requiere que las secciones estén sintácticamente cerradas. Mientras se escribe un archivo incompleto, los diagnósticos siguen disponibles, pero las funciones semánticas pueden pausarse hasta que vuelva a ser válido.
- El formato de HTML y CSS se ejecuta en memoria; no crea pestañas ni documentos temporales.
- Generar un VSIX cruzado confirma su contenido, pero no sustituye la prueba del host de destino. La matriz de CI comprueba la extensión en Windows, Linux y macOS.
