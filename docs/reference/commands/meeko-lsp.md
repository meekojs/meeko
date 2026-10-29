---
title: meeko lsp
group: commands
since: 1.0.0
description: Arranca el servidor de lenguaje de los componentes .meeko, que usan VS Code, Neovim, Helix, Zed y JetBrains.
symbols:
  - "cli:lsp"
related:
  - "cli:check"
  - docs/editors.md#arrancar-el-servidor
  - docs/editors.md#opciones-de-inicialización
  - docs/editors.md#comprobación-del-proyecto
---

`meeko lsp` arranca el servidor de lenguaje (LSP) de Meeko: diagnósticos, completado, hover, ir a definición, acciones rápidas, CodeLens, formato con Prettier, tokens semánticos de reactividad y la comprobación de los contratos de páginas y layouts, para los archivos `.meeko`. Habla JSON-RPC por el transporte que se le indique, normalmente la entrada y salida estándar. No se ejecuta a mano: lo lanza el editor.

Es el mismo programa que el binario `meeko-language-server` del paquete; los dos aceptan los mismos transportes.

## Uso

```sh
meeko lsp --stdio
```

En Neovim 0.11, con nvim-lspconfig:

```lua
vim.filetype.add({ extension = { meeko = "meeko" } })
vim.lsp.config("meeko", {
  cmd = { "npx", "meeko-language-server", "--stdio" },
  filetypes = { "meeko" },
  root_markers = { "package.json", "tsconfig.json" },
  init_options = { trusted = true },
})
vim.lsp.enable("meeko")
```

## Opciones

| Opción | Tipo | Por defecto | Descripción |
| --- | --- | --- | --- |
| `--stdio` | transporte | | JSON-RPC por stdin y stdout. Es el que usan casi todos los editores. |
| `--node-ipc` | transporte | | El canal IPC de Node, para un cliente que lanza el servidor con `fork`. |
| `--socket=<puerto>` | transporte | | Un socket TCP en ese puerto. |
| `--pipe=<nombre>` | transporte | | Una tubería con nombre (un named pipe en Windows, un socket de dominio en POSIX). |

Las opciones del servidor van en `initializationOptions` del `initialize`, no en la línea de comandos: `trusted` (`true` por defecto: ejecuta `meeko.config.*` y los `setup` de los módulos), `projectContracts`, `diagnosticsDelay` y `format`. Véase [Opciones de inicialización](/docs/editors#opciones-de-inicialización).

## Resultado

Un proceso que atiende al editor hasta que éste cierra la conexión. Mientras corre:

- **stdout es del protocolo.** Con `--stdio`, todo lo que el código del proyecto escriba con `console.log`, `info`, `warn`, `error` o `debug` se envía al log del cliente, no a stdout, para no corromper el protocolo.
- **Comprueba el proyecto.** En un workspace de confianza genera las declaraciones de los componentes y comprueba los contratos de páginas, layouts y la página de error (`MEEK_PAGE_PROPS`, `MEEK_LAYOUT_PROPS`, `MEEK_ERROR_PROPS`) 450 ms después de cada cambio guardado.
- **Lee el proyecto.** El `tsconfig.json` de la raíz del paquete, `meeko.config.*` y los archivos de `.meeko/types/`.

Sin transporte, imprime `Uso: meeko lsp --stdio | --node-ipc | --socket=<puerto> | --pipe=<nombre>` en la salida de errores y termina con código `1`.

## Ejemplos

### Helix

```toml
# .helix/languages.toml
[language-server.meeko]
command = "npx"
args = ["meeko-language-server", "--stdio"]
config = { trusted = true }

[[language]]
name = "meeko"
scope = "source.meeko"
file-types = ["meeko"]
roots = ["package.json", "tsconfig.json"]
grammar = "html"
block-comment-tokens = { start = "<!--", end = "-->" }
language-servers = ["meeko"]
```

`hx --health meeko` confirma que Helix encuentra el servidor.

### Abrir código de terceros sin ejecutarlo

```lua
init_options = { trusted = false },
```

Con `trusted: false`, el servidor no ejecuta `meeko.config.*` ni los módulos: lee la configuración de forma estática (las listas literales de `layers` e `imports`) y omite la comprobación de contratos. La extensión de VS Code lo envía según la confianza del workspace.

### Comprobar que arranca

```sh
npx meeko lsp
```

```text
Uso: meeko lsp --stdio | --node-ipc | --socket=<puerto> | --pipe=<nombre>
```

Si ves esta línea, el binario se resuelve y Node 24 lo ejecuta; el editor debe pasar `--stdio`.

## Errores comunes

### Lanzarlo sin transporte

```sh bad
meeko lsp
```

`Uso: meeko lsp --stdio | --node-ipc | --socket=<puerto> | --pipe=<nombre>` y código `1`. Otro valor, como `--tcp`, da lo mismo.

```sh good
meeko lsp --stdio
```

### El servidor global en lugar del del proyecto

```lua bad
cmd = { "meeko-language-server", "--stdio" },  -- instalado con npm i -g
```

Un `@meekojs/meeko` global de otra versión compila los componentes con otro compilador y otros tipos que `meeko check` y `meeko build`: los diagnósticos del editor no coinciden con los de CI.

```lua good
cmd = { "npx", "meeko-language-server", "--stdio" },
```

`npx` (o `pnpm exec`) usa el binario de `node_modules/.bin` del proyecto.

## Notas

- **Ayuda.** Desde `1.7`, `meeko --help` lista los cuatro transportes (antes sólo `--stdio`) y `meeko lsp --help` imprime la ayuda del comando sin arrancar el servidor.
- **Seguridad.** Con `trusted: true`, abrir un proyecto ejecuta su `meeko.config.*` y el `setup` de sus módulos con Node, igual que `meeko check`. Usa `trusted: false` con código que no conoces.
- **Requisitos.** Node 24 o posterior y `@meekojs/meeko` instalado en el proyecto. Reconoce los componentes por la extensión `.meeko`; el `languageId` que envíe el editor no importa.
- **Rendimiento.** Los diagnósticos de un componente esperan `diagnosticsDelay` (300 ms) tras la última edición, y la comprobación del proyecto 450 ms tras guardar; los cambios de `.meeko/` y de `node_modules` no la lanzan.
- **Windows y POSIX.** Con `--pipe`, el nombre sigue la convención de la plataforma; con `--stdio` no hay diferencias.
