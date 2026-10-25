# Changelog

## 1.0.0

- The extension is now a thin client of the Meeko language server (`meeko-language-server`), built on `vscode-languageclient`. The same server powers Neovim, Zed, Helix, JetBrains and Sublime Text.
- In trusted workspaces it starts the language server of the project's `@meekojs/meeko` package, so the editor matches the project's compiler; it falls back to the bundled server when that package is missing, predates the server, the workspace is restricted or `meeko.languageServer.preferWorkspace` is off.
- Restricted mode never runs project code: bundled server, static `meeko.config.*` reading and no page-contract checks. Granting trust restarts the server, which then executes the project configuration.
- New: references, signature help, document symbols, folding ranges and code actions (add missing imports, resolve ambiguous autoimports with an explicit import, remove `params` from a static `href`).
- Rename now crosses files: it rewrites the declaration and every use and import in `.meeko` and `.ts` files.
- Diagnostics cover the whole affected token instead of one character; multi-line template expressions get semantic tokens on every line.
- Hover, completion and navigation use the project's `tsconfig.json` (for example `paths` aliases) instead of fixed options, and diagnostics resolve the same aliases.
- New settings `meeko.languageServer.preferWorkspace` and `meeko.trace.server`.

## 0.0.1

- Initial Marketplace release of Meeko Language.
- Syntax highlighting for TypeScript, HTML, and CSS in `.meeko` components.
- Compiler and TypeScript diagnostics.
- Completion, hover, definition navigation, and component-local rename.
- Document formatting through installed TypeScript, HTML, and CSS providers.
- Platform-specific packages for Windows, Linux, and macOS on x64 and ARM64.
