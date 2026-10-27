# Meeko

<p align="center">
  <img src="https://raw.githubusercontent.com/meekojs/meeko/main/assets/brand/meeko-logo.png" alt="Carita de Meeko, una gatita de ojos azules, orejas oscuras y pelaje crema" width="160" />
</p>

**Meeko** es un motor de componentes `.meeko` tipados para TypeScript y un framework full-stack con SSR, hidratación y señales. Este repositorio es un workspace de pnpm con el paquete npm, las extensiones de editor y navegador y el sitio de documentación.

La guía de uso del paquete está en [`packages/meeko/README.md`](packages/meeko/README.md), que también es el README publicado en npm y la portada del sitio <https://meeko.diegootayza.com>.

## Contenido

| Ruta | Qué es |
| --- | --- |
| [`packages/meeko`](packages/meeko) | `@meekojs/meeko`, el paquete publicado en npm: compilador, runtime, framework, CLI `meeko`, plugin de Vite y servidor de lenguaje. Incluye sus pruebas, ejemplos y benchmarks. |
| [`packages/vscode`](packages/vscode) | Extensión de VS Code `meeko-language`: resaltado y cliente del servidor de lenguaje. |
| [`packages/devtools`](packages/devtools) | Extensión Meeko DevTools para Chrome. |
| [`apps/site`](apps/site) | Sitio de documentación, hecho con Meeko a partir de estos Markdown. |
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
