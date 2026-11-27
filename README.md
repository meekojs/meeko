# Meeko

<p align="center">
  <img src="https://raw.githubusercontent.com/meekojs/meeko/main/assets/brand/meeko-logo.png" alt="Carita de Meeko, una gatita de ojos azules, orejas oscuras y pelaje crema" width="160" />
</p>

**Meeko** es un motor de componentes `.meeko` tipados para TypeScript y un framework full-stack con SSR, hidratación y señales. Este repositorio es un workspace de pnpm con el paquete npm, las extensiones de editor y navegador y el sitio de documentación.

La guía de uso del paquete está en [`docs/inicio-rapido.md`](docs/inicio-rapido.md), que también es la página de inicio rápido del sitio <https://meekojs.com>. [`packages/meeko/README.md`](packages/meeko/README.md) es el README corto que se publica en npm.

El módulo de traducciones está documentado en [i18n](docs/i18n.md).
La base de componentes visuales de `@meekojs/ui` está documentada en [UI](docs/ui.md); su web de documentación vive en `apps/ui`.

## Contenido

| Ruta                                                   | Qué es                                                                                                                                                                         |
| ------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| [`packages/meeko`](packages/meeko)                     | `@meekojs/meeko`, el paquete publicado en npm: compilador, runtime, framework, CLI `meeko`, plugin de Vite y servidor de lenguaje. Incluye sus pruebas, ejemplos y benchmarks. |
| [`packages/ui`](packages/ui)                           | `@meekojs/ui`: componentes visuales y temas.                                                                                                                                   |
| [`packages/i18n`](packages/i18n)                       | `@meekojs/i18n`: traducciones, catálogos y módulo.                                                                                                                             |
| [`packages/eslint-plugin`](packages/eslint-plugin)     | `@meekojs/eslint-plugin`: parser ESLint y reglas para `.meeko`.                                                                                                                |
| [`packages/prettier-plugin`](packages/prettier-plugin) | `@meekojs/prettier-plugin`: formato de componentes.                                                                                                                            |
| [`packages/vscode`](packages/vscode)                   | Extensión de VS Code `meeko-language`: resaltado y cliente del servidor de lenguaje.                                                                                           |
| [`packages/devtools`](packages/devtools)               | Extensión Meeko DevTools para Chrome.                                                                                                                                          |
| [`apps/ui`](apps/ui)                                   | Web de Meeko UI (<https://ui.meekojs.com>): componentes, API y ejemplos interactivos.                                                                                          |
| [`apps/i18n`](apps/i18n)                               | Web de Meeko i18n (<https://i18n.meekojs.com>): guías, API y laboratorio de idiomas.                                                                                           |
| [`packages/docs`](packages/docs)                       | Base documental privada compartida por las webs de UI e i18n.                                                                                                                  |
| [`apps/meeko`](apps/meeko)                             | Sitio de documentación (<https://meekojs.com>), hecho con Meeko a partir de estos Markdown.                                                                                    |
| [`docs`](docs)                                         | Documentación del proyecto: framework, API, editores, DevTools, estabilidad, arquitectura y publicación.                                                                       |
| [`assets/brand`](assets/brand)                         | Logo de Meeko, fuente de las imágenes del sitio y los ejemplos. Las extensiones llevan una copia idéntica porque se empaquetan solas.                                          |

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
pnpm build --filter=meeko-site           # compila el paquete y después el sitio
```

Los comandos `build`, `check`, `tooling:build` y los builds/servidores de las aplicaciones usan
[Turborepo](https://turborepo.dev/docs) para respetar el grafo del workspace y reutilizar resultados.
La caché local vive en `.turbo/`; CI la conserva entre ejecuciones. Los comandos directos con
`pnpm -F <paquete>` siguen disponibles cuando se quiere trabajar sólo dentro de un paquete.

`pnpm dev` ejecuta los cuatro sitios en paralelo con `turbo watch`: framework en
`http://127.0.0.1:4173`, UI en `http://127.0.0.1:4174`, i18n en `http://127.0.0.1:4175` y dashboard en
`http://127.0.0.1:4310`. Prepara sus dependencias y, cuando cambia el código de un paquete del
workspace, Turbo actualiza sus builds. En `apps/ui`, Meeko lee los componentes fuente y aplica HMR
mientras el servidor sigue activo. Usa `dev:site`, `dev:ui`, `dev:i18n` o `dev:dashboard` para
iniciar una sola aplicación.

Con [portless](https://portless.sh) en marcha, esos mismos sitios también responden por nombre, sin
cambiar el comando: `https://meeko.localhost`, `https://ui.meeko.localhost`,
`https://i18n.meeko.localhost` y `https://dashboard.meeko.localhost`. Cada app lo declara con
`dev.portless` en su `meeko.config.ts`, así que `pnpm dev` y `dev:site`, `dev:ui`, `dev:i18n` y
`dev:dashboard` registran su ruta (`portless alias`) con el puerto que `meeko dev` ha elegido de
verdad, también si un `MEEKO_PORT` del `.env` de la app lo cambia, y la quitan al cerrar. No hay que
envolver ningún script con `portless` (envolverlo inyecta `HOST`, obsoleta, y asigna un puerto que un
`MEEKO_PORT` del `.env` puede ignorar) ni mantener una lista de nombres aparte. Meeko no arranca el
proxy: hazlo una vez con `pnpm exec portless proxy start`, que la primera vez crea una autoridad de
certificación local y pide permisos para escuchar en el puerto 443; `PORTLESS_HTTPS=0` sirve HTTP y
`PORTLESS_PORT=<puerto>` elige otro puerto, y `PORTLESS=0` desactiva el registro. Los nombres son los
mismos en todos los worktrees de git: si dos ejecutan la misma app a la vez, la ruta es la del último
que arrancó y desaparece cuando cualquiera de los dos se cierra. El dashboard acepta en desarrollo cualquier nombre `*.localhost` (véase
`apps/dashboard/README.md`); en producción sigue exigiendo `DASHBOARD_ALLOWED_HOSTS`.

[CONTRIBUTING.md](CONTRIBUTING.md) recoge las convenciones y [SECURITY.md](SECURITY.md) cómo informar de una vulnerabilidad. El código se distribuye bajo la [licencia MIT](LICENSE).
