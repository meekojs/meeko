---
title: meeko lsp
group: commands
since: 1.0.0
description: Starts the language server for .meeko components, used by VS Code, Neovim, Helix, Zed and JetBrains.
symbols:
  - "cli:lsp"
related:
  - "cli:check"
  - docs/editors.md#arrancar-el-servidor
  - docs/editors.md#opciones-de-inicialización
  - docs/editors.md#comprobación-del-proyecto
source-hash: cf7fc9c75568b94470181d1bbb3e0ee298590ceef6f24c10758888e739f27c71
---

`meeko lsp` starts Meeko's language server (LSP): diagnostics, completion, hover, go to definition, quick fixes, CodeLens, Prettier formatting, semantic reactivity tokens and page and layout contract checking for `.meeko` files. It speaks JSON-RPC over the specified transport, usually standard input and output. You do not run it manually: the editor launches it.

It is the same program as the package's `meeko-language-server` binary; both accept the same transports.

## Usage

```sh
meeko lsp --stdio
```

In Neovim 0.11, with nvim-lspconfig:

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

## Options

| Option              | Type      | Default | Description                                                            |
| ------------------- | --------- | ------- | ---------------------------------------------------------------------- |
| `--stdio`           | transport |         | JSON-RPC over stdin and stdout. Used by almost all editors.            |
| `--node-ipc`        | transport |         | Node's IPC channel, for a client that launches the server with `fork`. |
| `--socket=<puerto>` | transport |         | A TCP socket on that port.                                             |
| `--pipe=<nombre>`   | transport |         | A named pipe (a named pipe on Windows, a domain socket on POSIX).      |

Server options go in `initializationOptions` of `initialize`, not on the command line: `trusted` (`true` by default: executes `meeko.config.*` and module `setup` functions), `projectContracts`, `diagnosticsDelay` and `format`. See [Initialization options](/en/docs/editors#initialization-options).

## Result

A process that serves the editor until it closes the connection. While running:

- **stdout belongs to the protocol.** With `--stdio`, anything project code writes with `console.log`, `info`, `warn`, `error` or `debug` is sent to the client log, not stdout, to avoid corrupting the protocol.
- **Checks the project.** In a trusted workspace it generates component declarations and checks page, layout and error page contracts (`MEEK_PAGE_PROPS`, `MEEK_LAYOUT_PROPS`, `MEEK_ERROR_PROPS`) 450 ms after each saved change.
- **Reads the project.** The package root's `tsconfig.json`, `meeko.config.*` and files in `.meeko/types/`.

Without a transport, it prints `Uso: meeko lsp --stdio | --node-ipc | --socket=<puerto> | --pipe=<nombre>` to standard error and exits with code `1`.

## Examples

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

`hx --health meeko` confirms that Helix finds the server.

### Open third-party code without executing it

```lua
init_options = { trusted = false },
```

With `trusted: false`, the server does not execute `meeko.config.*` or modules: it reads configuration statically (literal `layers` and `imports` lists) and skips contract checking. The VS Code extension sends this according to workspace trust.

### Check that it starts

```sh
npx meeko lsp
```

```text
Uso: meeko lsp --stdio | --node-ipc | --socket=<puerto> | --pipe=<nombre>
```

If you see this line, the binary resolves and Node 24 runs it; the editor must pass `--stdio`.

## Common mistakes

### Launch it without a transport

```sh bad
meeko lsp
```

`Uso: meeko lsp --stdio | --node-ipc | --socket=<puerto> | --pipe=<nombre>` and exit code `1`. Another value, such as `--tcp`, produces the same result.

```sh good
meeko lsp --stdio
```

### Use the global server instead of the project's server

```lua bad
cmd = { "meeko-language-server", "--stdio" },  -- installed with npm i -g
```

A global `@meekojs/meeko` of another version compiles components using a different compiler and types than `meeko check` and `meeko build`: editor diagnostics do not match CI diagnostics.

```lua good
cmd = { "npx", "meeko-language-server", "--stdio" },
```

`npx` (or `pnpm exec`) uses the binary in the project's `node_modules/.bin`.

## Notes

- **Help.** Since `1.7`, `meeko --help` lists all four transports (previously only `--stdio`) and `meeko lsp --help` prints the command's help without starting the server.
- **Security.** With `trusted: true`, opening a project executes its `meeko.config.*` and module `setup` functions with Node, like `meeko check`. Use `trusted: false` for unfamiliar code.
- **Requirements.** Node 24 or later and `@meekojs/meeko` installed in the project. Components are recognized by the `.meeko` extension; the `languageId` sent by the editor does not matter.
- **Performance.** Component diagnostics wait `diagnosticsDelay` (300 ms) after the last edit, and project checking waits 450 ms after saving; changes in `.meeko/` and `node_modules` do not trigger it.
- **Windows and POSIX.** With `--pipe`, the name follows platform conventions; with `--stdio` there are no differences.
