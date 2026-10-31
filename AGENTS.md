# Repository Guidelines

## Estructura del proyecto

Meeko es un monorepo pnpm. Instala dependencias desde la raíz y conserva el único `pnpm-lock.yaml`.

- `packages/meeko/src/`: compilador, runtime SSR/hidratación, framework, CLI y servidor de lenguaje; pruebas en `packages/meeko/tests/`.
- `packages/ui/src/app/`: componentes `.meeko` y estilos CSS; `packages/i18n/`: internacionalización.
- `packages/eslint-plugin/` y `packages/prettier-plugin/`: herramientas compartidas.
- `packages/vscode/` y `packages/devtools/`: extensiones de editor y navegador.
- `apps/site/`, `apps/ui/`, `apps/i18n/`: webs públicas del framework, UI e i18n; `packages/docs/` es su base documental privada compartida para UI e i18n.
- `docs/`, `assets/brand/`, `scripts/`: documentación, recursos de marca y automatización.

## Comandos de desarrollo y validación

Requiere Node.js 24+ y pnpm 12.14.0. En Windows usa PowerShell 7.

- `pnpm install`: instala el workspace.
- `pnpm build`: construye núcleo, UI, i18n y plugins.
- `pnpm tooling:build`: prepara los paquetes usados por ESLint y Prettier.
- `pnpm dev` o `pnpm site:dev`: inicia el sitio del framework; `pnpm ui:dev`: inicia la web de UI.
- `pnpm i18n:dev`: inicia la web de i18n; `pnpm i18n:build` genera su build Node.
- `pnpm check`: comprueba tipos de los cinco paquetes principales.
- `pnpm test`: ejecuta las pruebas del núcleo; `pnpm verify`: amplía la validación con ejemplos, compilación y DevTools.
- `pnpm lint` y `pnpm format:check`: revisan lint y formato.
- `pnpm -F @meekojs/eslint-plugin test`: ejecuta las pruebas del plugin seleccionado.

## Estilo y nombres

Usa TypeScript, identificadores en inglés y JSDoc público en español. Prettier configura tabuladores, comillas simples, ausencia de punto y coma y un atributo por línea en plantillas. Respeta las excepciones locales.

La configuración raíz usa `defineEslint`, Perfectionist y unused-imports. Los imports relativos del código TypeScript fuente no llevan `.js`; el build añade las extensiones ESM. Edita componentes `.meeko` originales y regenera los artefactos necesarios. No edites `dist/` manualmente ni apliques autofix global sobre cambios ajenos.

## Pruebas

Predomina `node:test`, con `tsx` para TypeScript; las reglas ESLint también usan RuleTester. Nombra pruebas unitarias `*.test.ts` o `*.test.mjs`; los escenarios de navegador usan `*.e2e.ts`.

Añade regresiones de comportamiento. Para cambios del compilador, cubre SSR, hidratación, actualizaciones y liberación de recursos cuando corresponda. Ejecuta pruebas del paquete afectado y `pnpm e2e` para cambios de navegador. No hay un umbral numérico de cobertura configurado.

## Commits y pull requests

El historial usa prefijos como `feat(scope):`, `fix:` y `chore(release):`; `CONTRIBUTING.md` pide descripciones concretas en español e imperativo.

Mantén cada cambio enfocado. En la PR explica problema, comportamiento resultante, pruebas ejecutadas e incidencias relacionadas. Añade capturas para cambios visuales. Conserva cambios ajenos y excluye secretos, cachés y artefactos locales.
