# Extensión de VS Code para Meeko

La extensión reconoce archivos `.meeko`, resalta las secciones TypeScript, HTML y CSS y muestra los mismos diagnósticos de compilación y tipos que `meeko check`. El análisis semántico usa un archivo TypeScript virtual: las referencias del `<script>` y las expresiones del `<template>` comparten completado, navegación, hover y renombrado. El formato de documento delega cada sección al formateador de TypeScript, HTML o CSS instalado en VS Code.

El icono de la extensión y el icono de lenguaje de `.meeko` usan una copia de [`assets/brand/meeko-logo.png`](../../assets/brand/meeko-logo.png). VS Code muestra el icono del lenguaje cuando el tema de iconos activo admite ese mecanismo y no define otro icono para `.meeko`; algunos temas pueden reemplazarlo.

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

## Paquetes locales por plataforma

```powershell
pnpm run package:vsix
pwsh -NoProfile -File package-vsix.ps1 -Target linux-x64
pwsh -NoProfile -File package-vsix.ps1 -Target darwin-arm64
pnpm run test:host:isolated
```

`package:vsix` genera un VSIX para el sistema y arquitectura del equipo. `-Target` también admite `win32-x64`, `win32-arm64`, `linux-x64`, `linux-arm64`, `darwin-x64` y `darwin-arm64`, de modo que se pueden preparar paquetes para otros equipos desde Windows. Cada archivo se guarda en `artifacts/meeko-language-<versión>-<target>.vsix`; no se publica ni instala automáticamente. El script requiere PowerShell 7, aísla la instalación de TypeScript 6/7 y verifica que el VSIX contenga exactamente el ejecutable nativo de TypeScript 7 para su destino. [VS Code distribuye extensiones con binarios nativos por plataforma](https://code.visualstudio.com/api/working-with-extensions/publishing-extension#platform-specific-extensions).

`test:host:isolated` prueba el VSIX de la **plataforma anfitriona** en un VS Code real: extrae el paquete, instala Meeko en un proyecto consumidor temporal y comprueba diagnósticos, navegación, hover, renombrado, completado y formato. En Windows busca la instalación habitual de VS Code; en macOS y Linux intenta encontrar `code` en `PATH`. Si no lo encuentra, `@vscode/test-electron` descarga la versión estable en una carpeta temporal. Puedes indicar otra instalación con `pwsh -NoProfile -File tests/prepare-host.ps1 -VSCodeExecutable <ruta>`. La matriz de CI ejecuta esta prueba en Windows, Linux y macOS (con `xvfb-run` en Linux). No se generan VSIX para Alpine ni para web, que necesitarían soporte adicional del ejecutable TypeScript 7 y del host de extensión.

## Alcance actual

- Las referencias semánticas abarcan declaraciones del script, expresiones de texto y de directivas, incluso las variables locales de listas. El renombrado se limita al componente abierto; no reescribe otros archivos.
- El modelo virtual requiere que las secciones estén sintácticamente cerradas. Mientras se escribe un archivo incompleto, los diagnósticos siguen disponibles, pero las funciones semánticas pueden pausarse hasta que vuelva a ser válido.
- La interpolación de texto anidada y los valores de atributos sin comillas todavía no tienen correspondencia semántica completa. El compilador y `meeko check` siguen siendo la fuente de verdad para validar esos casos.
- El formato depende de que VS Code tenga proveedores para TypeScript, HTML y CSS. Una sección sin proveedor conserva su texto.
- El paquete sigue siendo local y no se ha publicado en el Marketplace. El host real se ha validado localmente en Windows x64; la matriz de CI verificará Linux y macOS al ejecutarse en GitHub. Generar un VSIX cruzado confirma su contenido, pero no sustituye la prueba del host de destino.
