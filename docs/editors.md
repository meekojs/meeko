# Editores

Meeko incluye un servidor de lenguaje ([Language Server Protocol](https://microsoft.github.io/language-server-protocol/)) que da a cualquier editor compatible las mismas funciones que la [extensión de VS Code](../editors/vscode/README.md): diagnósticos de `meeko check`, completado, hover, ir a definición, referencias, renombrado entre archivos `.meeko` y `.ts`, ayuda de firma, símbolos del documento, plegado, formato, tokens semánticos y acciones rápidas (añadir imports, resolver un autoimport ambiguo con un import explícito y quitar `params` de un `href` estático).

## Arrancar el servidor

El servidor viene en el paquete `@meekojs/meeko`. Instálalo como dependencia del proyecto para que el editor use la misma versión que el compilador:

```powershell
pnpm add -D @meekojs/meeko
```

Hay dos formas equivalentes de arrancarlo; ambas hablan JSON-RPC por la entrada y salida estándar:

```powershell
meeko lsp --stdio
meeko-language-server --stdio
```

Desde la raíz del proyecto, `npx meeko-language-server --stdio` (o `pnpm exec meeko-language-server --stdio`) usa el binario de `node_modules/.bin`. Además de `--stdio`, el servidor acepta `--node-ipc`, `--socket=<puerto>` y `--pipe=<nombre>`. Sin transporte termina con código 1 y muestra el uso. Requiere Node.js 24 o posterior.

El servidor reconoce los componentes por la extensión `.meeko` de su ruta; el `languageId` que envíe el editor no importa. Basta con asociar los archivos `.meeko` a un tipo de archivo propio (o a HTML) y lanzar el servidor para ese tipo.

### Opciones de inicialización

Se envían en `initializationOptions` de la petición `initialize`. Todas son opcionales.

| Opción | Por defecto | Efecto |
| --- | --- | --- |
| `trusted` | `true` | Con `true`, el servidor ejecuta `meeko.config.*` del proyecto con Node para conocer sus autoimports y comprueba los contratos de páginas y layouts al guardar. Con `false` no ejecuta código del proyecto: lee la configuración de forma estática (sólo listas literales) y omite los contratos. |
| `projectContracts` | `true` | `false` desactiva la comprobación de contratos de páginas (`MEEK_PAGE_PROPS`, `MEEK_LAYOUT_PROPS`, `MEEK_ERROR_PROPS`) al guardar. |
| `diagnosticsDelay` | `300` | Milisegundos de espera tras una edición antes de comprobar el componente. |

Fuera de VS Code `trusted` vale `true` porque es el usuario quien configura el servidor para su proyecto, del mismo modo que `meeko check` ejecuta la configuración. Usa `trusted: false` al abrir código de terceros. La extensión de VS Code envía el estado de confianza del workspace.

### Qué lee el servidor

- El `tsconfig.json` de la raíz del paquete (la carpeta con `package.json` más cercana) define las opciones de hover, completado y navegación, por ejemplo los alias `paths`. `meeko check`, y por tanto los diagnósticos del editor, usan las mismas opciones de resolución (`paths`, `baseUrl`, `types`, `typeRoots`, `customConditions`, `resolveJsonModule`, `allowImportingTsExtensions`) y conservan sus banderas estrictas de tipos.
- Para detectar cambios guardados en archivos `.ts`, `tsconfig*.json` y `meeko.config.*`, el servidor registra observadores con `workspace/didChangeWatchedFiles` cuando el cliente admite el registro dinámico. Si tu editor no lo admite, vuelve a abrir el componente o reinicia el servidor tras cambiar un módulo importado.

## Neovim

Con Neovim 0.11 o posterior y [nvim-lspconfig](https://github.com/neovim/nvim-lspconfig), declara el tipo de archivo y el servidor en tu `init.lua`:

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

`npx` resuelve el binario del proyecto cuando Neovim se abre dentro de él. Para resaltado sintáctico sin una gramática tree-sitter propia puedes reutilizar la de HTML con `vim.treesitter.language.register("html", "meeko")`; los tokens semánticos del servidor colorean las expresiones TypeScript del script y la plantilla.

## Helix

En `languages.toml` (global o `.helix/languages.toml` del proyecto):

```toml
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

Helix envía la tabla `config` como `initializationOptions`. `hx --health meeko` confirma que encuentra el servidor.

## Zed

Zed sólo asocia servidores de lenguaje a lenguajes que declara una extensión, y todavía no hay una extensión publicada de Meeko. Puedes instalar una extensión local con **zed: install dev extension** que contenga:

- `extension.toml` con `[language_servers.meeko-language-server]`, `name = "Meeko Language Server"` y `languages = ["Meeko"]`, además de la gramática `html` en `[grammars.html]`;
- `languages/meeko/config.toml` con `name = "Meeko"`, `grammar = "html"`, `path_suffixes = ["meeko"]` y `block_comment = ["<!-- ", " -->"]`, junto con las consultas `highlights.scm` copiadas del lenguaje HTML;
- `src/lib.rs` que devuelva el comando del servidor:

```rust
use zed_extension_api as zed;

struct Meeko;

impl zed::Extension for Meeko {
    fn new() -> Self {
        Meeko
    }

    fn language_server_command(&mut self, _id: &zed::LanguageServerId, worktree: &zed::Worktree) -> zed::Result<zed::Command> {
        let command = worktree
            .which("meeko-language-server")
            .ok_or("meeko-language-server is not on PATH; install @meekojs/meeko")?;
        Ok(zed::Command { command, args: vec!["--stdio".into()], env: Default::default() })
    }
}

zed::register_extension!(Meeko);
```

Las opciones de inicialización se pueden fijar sin recompilar en `settings.json`:

```json
{
  "lsp": {
    "meeko-language-server": {
      "initialization_options": { "trusted": true }
    }
  }
}
```

## JetBrains (LSP4IJ)

Los IDE de JetBrains se conectan mediante el plugin [LSP4IJ](https://plugins.jetbrains.com/plugin/23257-lsp4ij):

1. Instala LSP4IJ y abre **Settings → Languages & Frameworks → Language Servers**; pulsa **+** para crear un servidor.
2. En **Server**, nombre `Meeko` y comando `npx meeko-language-server --stdio` (en Windows, `npx.cmd meeko-language-server --stdio`).
3. En **Mappings → File name patterns**, añade `*.meeko` con el identificador de lenguaje `meeko`.
4. En **Configuration → Initialization Options**, escribe `{ "trusted": true }`.

Para el resaltado sintáctico, registra la gramática TextMate de la extensión de VS Code en **Settings → Editor → TextMate Bundles** apuntando a la carpeta `editors/vscode` del repositorio o a una extensión VSIX descomprimida.

## Sublime Text

Con el paquete [LSP](https://lsp.sublimetext.io/) y Sublime Text 4, crea primero una sintaxis que herede de HTML en `Packages/User/Meeko.sublime-syntax`:

```yaml
%YAML 1.2
---
name: Meeko
scope: text.html.meeko
version: 2
extends: Packages/HTML/HTML.sublime-syntax
file_extensions:
  - meeko
contexts: {}
```

Después añade el cliente en **Preferences → Package Settings → LSP → Settings**:

```json
{
  "clients": {
    "meeko": {
      "enabled": true,
      "command": ["npx", "meeko-language-server", "--stdio"],
      "selector": "text.html.meeko",
      "initializationOptions": { "trusted": true }
    }
  }
}
```

## Limitaciones

- Sólo se tiene en cuenta el `tsconfig.json` de la raíz del paquete; los tsconfig anidados o referenciados por `references` no cambian el análisis.
- El renombrado y las referencias que abarcan archivos `.meeko` se inician desde un `.meeko`. Desde un `.ts` responde el servidor TypeScript del editor, que no conoce los componentes.
- El modelo semántico necesita secciones sintácticamente cerradas. Mientras se escribe un archivo incompleto los diagnósticos siguen llegando, pero completado y navegación pueden pausarse hasta que vuelva a ser válido.
- Un proyecto con más de 2000 componentes `.meeko` sólo carga los primeros 2000 para referencias y renombrado entre archivos.
