# Extensión de VS Code para Meeko

La extensión reconoce archivos `.meeko`, resalta las secciones TypeScript, HTML y CSS y muestra los mismos diagnósticos de compilación y tipos que `meeko check`. El análisis semántico usa un archivo TypeScript virtual: las referencias del `<script>` y las expresiones del `<template>` comparten completado, navegación, hover y renombrado. El formato de documento delega cada sección al formateador de TypeScript, HTML o CSS instalado en VS Code.

## Probar en desarrollo

Desde `D:\Clients\meeko\editors\vscode`:

```powershell
pnpm install
pnpm run check
pnpm run test
pnpm run build
code --new-window --extensionDevelopmentPath="D:\Clients\meeko\editors\vscode" "D:\Clients\meeko"
```

Abre un `.meeko` y consulta el panel **Problemas** para errores `MEEK` o `TS`. La extensión analiza los cambios después de una pausa de 450 ms. La salida **Meeko** registra fallos internos del comprobador. `meeko check <archivo.meeko> --json` permite contrastar los diagnósticos desde una terminal.

## Paquete local para Windows x64

```powershell
pnpm run package:vsix
pnpm run test:host:isolated
```

El primer comando genera `artifacts/meeko-language-0.0.1-win32-x64.vsix` sin publicarlo ni instalarlo en VS Code. Usa una carpeta temporal limpia para incorporar TypeScript 6, TypeScript 7 y su ejecutable nativo de Windows. El segundo extrae ese VSIX, crea fuera del monorepo un proyecto consumidor con Meeko instalado y comprueba diagnósticos, navegación, hover, renombrado y completado en un host real de VS Code. Requiere VS Code instalado en la ruta habitual de Windows.

## Alcance actual

- Las referencias semánticas abarcan declaraciones del script, expresiones de texto y de directivas, incluso las variables locales de listas. El renombrado se limita al componente abierto; no reescribe otros archivos.
- El modelo virtual requiere que las secciones estén sintácticamente cerradas. Mientras se escribe un archivo incompleto, los diagnósticos siguen disponibles, pero las funciones semánticas pueden pausarse hasta que vuelva a ser válido.
- La interpolación de texto anidada y los valores de atributos sin comillas todavía no tienen correspondencia semántica completa. El compilador y `meeko check` siguen siendo la fuente de verdad para validar esos casos.
- El formato depende de que VS Code tenga proveedores para TypeScript, HTML y CSS. Una sección sin proveedor conserva su texto.
- El VSIX generado es específico de Windows x64 porque TypeScript 7 incluye un ejecutable nativo para esa plataforma. Aún no se prepararon paquetes para otras plataformas ni se publicó la extensión.
