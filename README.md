# Meeko

<p align="center">
  <img src="https://raw.githubusercontent.com/meekojs/meeko/main/assets/brand/meeko-logo.png" alt="Carita de Meeko, una gatita de ojos azules, orejas oscuras y pelaje crema" width="160" />
</p>

**Meeko** es un motor de componentes `.meeko` tipados para TypeScript y un framework full-stack con SSR, hidratación y señales. Este repositorio es un workspace de pnpm con el paquete npm, las extensiones de editor y navegador y el sitio de documentación.

La guía de uso del paquete está en [`packages/meeko/README.md`](packages/meeko/README.md), que también es el README publicado en npm y la portada del sitio <https://meekojs.com>.

El módulo de traducciones está documentado en [i18n](docs/i18n.md).
La base de componentes visuales de `@meekojs/ui` está documentada en [UI](docs/ui.md); su web de documentación vive en `apps/ui`.

## Contenido

| Ruta | Qué es |
| --- | --- |
| [`packages/meeko`](packages/meeko) | `@meekojs/meeko`, el paquete publicado en npm: compilador, runtime, framework, CLI `meeko`, plugin de Vite y servidor de lenguaje. Incluye sus pruebas, ejemplos y benchmarks. |
| [`packages/ui`](packages/ui) | `@meekojs/ui`: componentes visuales y temas. |
| [`packages/i18n`](packages/i18n) | `@meekojs/i18n`: traducciones, cat�logos y m�dulo. |
| [`packages/eslint-plugin`](packages/eslint-plugin) | `@meekojs/eslint-plugin`: parser ESLint y reglas para `.meeko`. |
| [`packages/prettier-plugin`](packages/prettier-plugin) | `@meekojs/prettier-plugin`: formato de componentes. |
| [`packages/vscode`](packages/vscode) | Extensión de VS Code `meeko-language`: resaltado y cliente del servidor de lenguaje. |
| [`packages/devtools`](packages/devtools) | Extensión Meeko DevTools para Chrome. |
| [`apps/ui`](apps/ui) | Web de Meeko UI (<https://ui.meekojs.com>): componentes, API y ejemplos interactivos. |
| [`apps/i18n`](apps/i18n) | Web de Meeko i18n (<https://i18n.meekojs.com>): guias, API y laboratorio de idiomas. |
| [`packages/docs`](packages/docs) | Base documental privada compartida por las webs de UI e i18n. |
| [`apps/meeko`](apps/meeko) | Sitio de documentación (<https://meekojs.com>), hecho con Meeko a partir de estos Markdown. |
| [`docs`](docs) | Documentación del proyecto: framework, API, editores, DevTools, estabilidad, arquitectura y publicación. |
| [`assets/brand`](assets/brand) | Logo de Meeko, fuente de las imágenes del sitio y los ejemplos. Las extensiones llevan una copia idéntica porque se empaquetan solas. |

El paquete y cada extensión tienen versión propia; [docs/releasing.md](docs/releasing.md) explica cómo se publica cada uno.

## Desarrollo

Requiere Node 24 y pnpm 12. Desde la raíz:

```powershell
pnpm install                 # un único lockfile para todo el workspace
pnpm run verify              # comprobaciones y pruebas del paquete y de la extensión de Chrome
pnpm run e2e
pnpm run pilot:e2e
pnpm run conformance         # Node, Bun, Deno y workerd
pnpm run package:smoke
```

Las órdenes de la raíz reenvían al paquete (`pnpm -F @meekojs/meeko run <orden>`). Para las demás piezas:

```powershell
pnpm -F meeko-language run check          # extensión de VS Code; también test, build y package:vsix
pnpm -F meeko-devtools-extension run check
pnpm run site:build                       # compila el paquete y después el sitio
```

[CONTRIBUTING.md](CONTRIBUTING.md) recoge las convenciones y [SECURITY.md](SECURITY.md) cómo informar de una vulnerabilidad. El código se distribuye bajo la [licencia MIT](LICENSE).
