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

## Trabajo con varios agentes

Claude Code y Codex leen este archivo. Una sola sesión coordina: reparte tareas, integra, revisa el diff final y resuelve conflictos. Los agentes trabajadores no hacen commit ni push y no lanzan otros agentes salvo que la tarea lo indique.

- Lanza trabajadores con `hc` (herdr) en segundo plano: `hc run --bg --name <tarea> --cwd <worktree> <plantilla> "<tarea>"`. Espera con `hc wait --children all`, nunca con `sleep`; lee resultados con `hc read <tarea>` y, al aceptarlos, cierra con `hc kill` y `hc rm`.
- Elige la plantilla por complejidad: `*-quick` para cambios acotados y mecánicos; `*-impl` para features y bugs normales; `claude-impl` para compilador, runtime, hidratación o cambios entre paquetes; `*-review` para revisión independiente de sólo lectura. Revisa con el agente contrario al que implementó. Codex se lanza siempre con `--no-daemon` y su sandbox no puede usar `hc send`: recoge su informe con `hc read` cuando `hc wait` indique `done`.
- Usa un worktree por tarea, siempre bajo `.claude/worktrees/<tarea>`. Claude los crea solo (`claude -w <tarea>` o subagentes con `isolation: worktree`); para Codex u otros, `git worktree add .claude/worktrees/<tarea> -b <rama>` y `pnpm install` dentro. Nunca asignes los mismos archivos a dos agentes y elimina el worktree con `git worktree remove` al integrar.
- En un worktree no uses Serena: está ligada al checkout principal y editaría `main`. Las plantillas de `hc` ya la desactivan.
- Los especialistas viven en `.codex/agents/*.toml`, que es la fuente única. `pnpm agents:sync` genera `.claude/agents/*.md` y `pnpm agents:check` (incluido en `pnpm verify`) detecta desajustes; no edites los archivos generados.

### Git y recursos seguros

Los hooks de `.claude/settings.json` (`.claude/hooks/`) aplican parte de estas reglas en Claude Code; Codex debe cumplirlas por su cuenta.

- No uses `--ignored`, `-x` ni `-X` con `git status`, `ls-files` o `clean` en la raíz ni sobre carpetas con `node_modules`: recorren los enlaces de pnpm durante minutos. Usa `git check-ignore -v <ruta>` o limita la orden a un subdirectorio.
- En lecturas automáticas usa `git --no-optional-locks ...`. No interrumpas un git que escribe (`add`, `commit`, `checkout`, `stash`, `worktree` o `status` sin `--no-optional-locks`).
- Si aparece `.git/index.lock`, no lo borres: avisa al coordinador, que comprueba que no queda ningún `git.exe` escritor vivo antes de quitarlo.
- No cambies el cwd ni ejecutes herramientas que escanean el disco (Tailwind/oxide, Vite, `find`, git con `--ignored`) fuera de la raíz del proyecto o de un directorio temporal propio: un `process.chdir('D:/')` hizo que el escáner nativo de Tailwind recorriera todo el disco y llegara a 97 GB.
- Todo proceso `node` de pruebas, build o servidor lleva un timeout y `NODE_OPTIONS=--max-old-space-size=8192`, salvo que el script ya lo fije. Ese límite solo cubre el heap de V8, no la memoria nativa; el hook `memory-guard` bloquea órdenes nuevas de Node si la memoria comprometida libre baja del 10 % y lista los procesos que más ocupan.
- Cierra los servidores de desarrollo al terminar y no dejes procesos huérfanos. El coordinador no tiene más de tres agentes ejecutando suites pesadas o e2e a la vez.

## Commits y pull requests

El historial usa prefijos como `feat(scope):`, `fix:` y `chore(release):`; `CONTRIBUTING.md` pide descripciones concretas en español e imperativo.

Mantén cada cambio enfocado. En la PR explica problema, comportamiento resultante, pruebas ejecutadas e incidencias relacionadas. Añade capturas para cambios visuales. Conserva cambios ajenos y excluye secretos, cachés y artefactos locales.
