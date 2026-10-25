# Extensión de VS Code para Meeko

La extensión reconoce archivos `.meeko`, resalta las secciones TypeScript, HTML y CSS y conecta VS Code con el **servidor de lenguaje de Meeko** (`meeko-language-server`). Toda la lógica del lenguaje vive en ese servidor, que es el mismo que usan Neovim, Zed, Helix, JetBrains o Sublime Text ([guía de editores](https://github.com/meekojs/meeko/blob/main/docs/editors.md)); la extensión sólo lo arranca y le pasa el estado de confianza del workspace.

El servidor publica los mismos diagnósticos de compilación y tipos que `meeko check`, con el rango completo del token afectado. El análisis semántico usa un archivo TypeScript virtual por componente dentro de un único servicio por proyecto, configurado con el `tsconfig.json` de la raíz del paquete: las referencias del `<script>` y las expresiones del `<template>` comparten completado, hover, ir a definición, referencias, renombrado, ayuda de firma y color semántico, también entre archivos `.meeko` y `.ts`. Además ofrece símbolos del documento, plegado, formato de las tres secciones y acciones rápidas (añadir imports, resolver autoimports ambiguos y quitar `params` sobrantes de un `href` estático).

`defineProps<Props>({ count: 0 })` ofrece defaults tipados en el editor: la prop puede omitirse al usar el componente y se reconoce como definida dentro de su script y plantilla. El compilador y el modelo semántico del editor comparten el análisis AST de esas claves.

## Primeros pasos

1. Instala **Meeko Language** en Visual Studio Code 1.140.0 o posterior.
2. Abre tu proyecto Meeko y un archivo con extensión `.meeko`.
3. Usa completado, hover, ir a definición, referencias, renombrado y **Format Document** desde el editor.

Consulta el panel **Problemas** para ver los diagnósticos de compilación y TypeScript. En un workspace de confianza, al abrir o guardar una página, un layout o su sidecar, el servidor comprueba los contratos de props del proyecto y señala los errores `MEEK_PAGE_PROPS`, `MEEK_LAYOUT_PROPS` y `MEEK_ERROR_PROPS` sobre el tipo de `defineProps` en el `.meeko`. Esta comprobación usa los archivos guardados y no se ejecuta por cada pulsación.

Al guardar un módulo TypeScript del mismo proyecto, el servidor vuelve a comprobar los componentes `.meeko` abiertos, actualiza sus tokens semánticos y recalcula los contratos de páginas y layouts abiertos.

## Qué servidor se usa

- Si el workspace es de confianza y el proyecto tiene `@meekojs/meeko` con el bin `meeko-language-server` en `node_modules` (se busca desde cada carpeta del workspace hacia arriba), la extensión arranca **ese** servidor. Así el editor usa la misma versión que el compilador del proyecto.
- Si no existe, es una versión anterior sin servidor de lenguaje, el ajuste `meeko.languageServer.preferWorkspace` está desactivado o el workspace no es de confianza, usa el **servidor incluido** en la extensión.

El canal de salida **Meeko** indica al arrancar qué servidor se eligió, su versión y el motivo de la elección, y registra los fallos internos del servidor.

## Modo restringido

En un workspace no confiable la extensión nunca ejecuta código del proyecto: usa el servidor incluido, lee `meeko.config.*` de forma estática (sólo listas literales) y no comprueba contratos de páginas. Al conceder la confianza, el servidor se reinicia y pasa a ejecutar la configuración del proyecto, de modo que las listas de `extends`, `modules` e `imports.serverDirs` pueden construirse dinámicamente.

## Ajustes

| Ajuste | Por defecto | Descripción |
| --- | --- | --- |
| `meeko.languageServer.preferWorkspace` | `true` | Usa el servidor de `@meekojs/meeko` del proyecto cuando existe. Se ignora en modo restringido. |
| `meeko.trace.server` | `off` | Registra la comunicación con el servidor (`messages` o `verbose`) en el canal **Meeko**. |

Cambiar un ajuste `meeko.languageServer.*` reinicia el servidor.

La extensión incluye TypeScript 6 (servicio de lenguaje) y el ejecutable nativo de TypeScript 7 (diagnósticos) para su plataforma. Para crear y ejecutar una aplicación, consulta el [repositorio de Meeko](https://github.com/meekojs/meeko). Puedes reportar problemas en [GitHub Issues](https://github.com/meekojs/meeko/issues).

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

`pnpm run build` genera el cliente (`dist/extension.js`) y el servidor incluido (`dist/server.js`, compilado desde `src/language-server/` del repositorio). Abre un `.meeko` y consulta el panel **Problemas** para errores `MEEK` o `TS`. El servidor analiza los cambios después de una pausa de 300 ms. La salida **Meeko** registra qué servidor se usa y sus fallos internos. `meeko check <archivo.meeko> --json` permite contrastar los diagnósticos desde una terminal.

## Desarrollo: paquetes por plataforma

```powershell
pnpm run package:vsix
pwsh -NoProfile -File package-vsix.ps1 -Target linux-x64
pwsh -NoProfile -File package-vsix.ps1 -Target darwin-arm64
pnpm run test:host:isolated
```

`package:vsix` genera un VSIX para el sistema y arquitectura del equipo. `-Target` también admite `win32-x64`, `win32-arm64`, `linux-x64`, `linux-arm64`, `darwin-x64` y `darwin-arm64`, de modo que se pueden preparar paquetes para otros equipos desde Windows. Cada archivo se guarda en `artifacts/meeko-language-<versión>-<target>.vsix`; no se publica ni instala automáticamente. El script requiere PowerShell 7, aísla la instalación de TypeScript 6/7 y verifica que el VSIX contenga exactamente el ejecutable nativo de TypeScript 7 para su destino. [VS Code distribuye extensiones con binarios nativos por plataforma](https://code.visualstudio.com/api/working-with-extensions/publishing-extension#platform-specific-extensions).

`test:host:isolated` prueba el VSIX de la **plataforma anfitriona** en un VS Code real: extrae el paquete, instala Meeko en un proyecto consumidor temporal y comprueba que se usa el servidor de lenguaje del proyecto, diagnósticos con rango completo, contratos, navegación, hover, referencias, renombrado, completado, ayuda de firma, símbolos, plegado, tokens semánticos y formato al guardar. En Windows busca la instalación habitual de VS Code; en macOS y Linux intenta encontrar `code` en `PATH`. Si no lo encuentra, `@vscode/test-electron` descarga la versión estable en una carpeta temporal. Puedes indicar otra instalación con `pwsh -NoProfile -File tests/prepare-host.ps1 -VSCodeExecutable <ruta>`. La matriz de CI ejecuta esta prueba en Windows, Linux y macOS (con `xvfb-run` en Linux). No se generan VSIX para Alpine ni para web, que necesitarían soporte adicional del ejecutable TypeScript 7 y del host de extensión.

## Alcance actual

- El renombrado se inicia desde un `.meeko` y reescribe la declaración y todos sus usos e imports en archivos `.meeko` y `.ts` del proyecto. Las referencias pedidas desde un `.ts` las resuelve el servicio TypeScript de VS Code, que no conoce los `.meeko`.
- Se usa el `tsconfig.json` de la raíz del paquete (la carpeta con `package.json`); los tsconfig anidados no se tienen en cuenta.
- El modelo virtual requiere que las secciones estén sintácticamente cerradas. Mientras se escribe un archivo incompleto, los diagnósticos siguen disponibles, pero las funciones semánticas pueden pausarse hasta que vuelva a ser válido.
- El formato de HTML y CSS se ejecuta en memoria; no crea pestañas ni documentos temporales.
- Generar un VSIX cruzado confirma su contenido, pero no sustituye la prueba del host de destino. La matriz de CI comprueba la extensión en Windows, Linux y macOS.
