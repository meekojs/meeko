// Instala el paquete @meekojs/meeko empaquetado en un consumidor externo temporal y comprueba CLI, SSR, tipos,
// Vite y `meeko init`. Funciona en Windows, macOS y Linux. Uso: node tests/package-consumer.mjs
// Termina con código 1 si falla un paso; el directorio temporal se elimina siempre.
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

import { childEnv, lastLine, leafName, run, runMain, StepError, withTemporaryDirectory } from '../../../scripts/process-utils.mjs'

const packageRoot = resolve(fileURLToPath(new URL('..', import.meta.url)))
/** Pasos que sólo ejecutan Node o TypeScript sobre archivos ya instalados. */
const quick = 5 * 60_000

const counter = `<script lang="ts">
import { signal } from "@meekojs/meeko";
interface Props { initial?: number }
const props = defineProps<Props>({ initial: 4 });
const count = signal(props.initial);
</script>
<template>
  <button>{count.value}</button>
</template>
`
const main = `import { hydrate } from "./Counter.meeko";
const root = document.getElementById("app");
if (root) hydrate(root, {});
`
const viteConfig = `import { defineConfig } from "vite";
import { meeko } from "@meekojs/meeko/vite";
export default defineConfig({ plugins: [meeko()] });
`
const smoke = `import { renderToString } from "./Counter.generated.ts";
import { mountDevtoolsPanel } from "@meekojs/meeko/devtools-ui";
if (!renderToString({}).includes("meeko:text:0-->4")) {
  throw new Error("SSR del paquete instalado produjo un resultado inesperado");
}
if (typeof mountDevtoolsPanel !== "function") {
  throw new Error("El paquete instalado no exporta el panel DevTools");
}
`
// Meeko no publica utilidades de PostCSS ni depende de Tailwind: el consumidor elige su CSS.
const cssBoundarySmoke = `import { readFileSync } from "node:fs";
const exported = await import("@meekojs/meeko/postcss").then(() => true, (error) => {
  if (error?.code !== "ERR_PACKAGE_PATH_NOT_EXPORTED") throw error;
  return false;
});
if (exported) throw new Error("El paquete instalado todavía exporta @meekojs/meeko/postcss");
const manifest = JSON.parse(readFileSync("node_modules/@meekojs/meeko/package.json", "utf8"));
const tailwind = Object.keys({ ...manifest.dependencies, ...manifest.peerDependencies }).filter((name) => /tailwind/i.test(name));
if (tailwind.length) throw new Error("El paquete instalado depende de " + tailwind.join(", "));
`

/** Escribe `content` en `path`, creando las carpetas que falten. */
function write(path, content) {
	mkdirSync(join(path, '..'), { recursive: true })
	writeFileSync(path, content)
}

/** Lee un manifiesto JSON. */
const readManifest = (path) => JSON.parse(readFileSync(path, 'utf8'))

/**
 * Ejecuta toda la comprobación en `testRoot`.
 * @param {string} testRoot Directorio temporal propio.
 */
function check(testRoot) {
	const env = childEnv()
	const consumer = join(testRoot, 'consumer')
	mkdirSync(consumer, { recursive: true })
	// pnpm pack, not npm pack: it replaces the catalog: and workspace: versions, which npm cannot install.
	const packageName = lastLine(run('pnpm', ['-C', packageRoot, 'pack', '--pack-destination', testRoot], { env, failure: 'No se pudo empaquetar Meeko.', capture: true }))
	if (!packageName) throw new StepError('No se pudo empaquetar Meeko.')
	const tarball = join(testRoot, leafName(packageName))

	write(join(consumer, 'package.json'), '{"name":"meeko-external-consumer","private":true,"type":"module"}')
	write(join(consumer, 'Counter.meeko'), counter)
	write(join(consumer, 'main.ts'), main)
	write(join(consumer, 'index.html'), '<!doctype html><html><body><main id="app"></main><script type="module" src="/main.ts"></script></body></html>')
	write(join(consumer, 'vite.config.mjs'), viteConfig)
	write(join(consumer, 'tsconfig.json'), '{"compilerOptions":{"target":"ES2022","module":"NodeNext","moduleResolution":"NodeNext","strict":true,"noEmit":true,"lib":["ES2022","DOM"],"allowArbitraryExtensions":true,"rootDirs":[".",".meeko/types"]},"include":["main.ts"]}')
	write(join(consumer, 'smoke.mjs'), smoke)
	write(join(consumer, 'css-boundary-smoke.mjs'), cssBoundarySmoke)

	run('npm', ['install', '--prefix', consumer, '--ignore-scripts', '--no-audit', '--no-fund', tarball, 'vite@8.3.5'], { env, failure: 'No se pudo instalar el tarball en el consumidor externo.' })

	// `.bin/meeko` es un enlace en macOS y Linux y `meeko.cmd` en Windows.
	const cli = join(consumer, 'node_modules/.bin', process.platform === 'win32' ? 'meeko.cmd' : 'meeko')
	if (!existsSync(cli)) throw new StepError('El paquete no instaló el comando meeko.')
	const node = (script, failure, args = []) => run(process.execPath, [script, ...args], { cwd: consumer, env, failure, timeout: quick })
	const meeko = (args, failure, cwd = consumer) => run(cli, args, { cwd, env, failure, timeout: quick })

	meeko(['check', 'Counter.meeko'], 'Falló meeko check desde el paquete instalado.')
	meeko(['compile', 'Counter.meeko', 'Counter.generated.ts'], 'Falló meeko compile desde el paquete instalado.')
	node('smoke.mjs', 'Falló SSR desde el paquete instalado.')
	node('css-boundary-smoke.mjs', 'El paquete instalado publica utilidades de PostCSS o depende de Tailwind.')
	meeko(['types', 'Counter.meeko'], 'Falló meeko types desde el paquete instalado.')
	node('node_modules/typescript/bin/tsc', 'Falló TypeScript en el consumidor externo.', ['-p', 'tsconfig.json', '--noEmit'])
	node('node_modules/vite/bin/vite.js', 'Falló Vite en el consumidor externo.', ['build'])

	const packageVersion = readManifest(join(packageRoot, 'package.json')).version
	const starter = join(testRoot, 'starter')
	meeko(['init', starter], 'Falló meeko init desde el paquete instalado.')
	const starterManifestPath = join(starter, 'package.json')
	const starterManifest = readManifest(starterManifestPath)
	if (starterManifest.dependencies?.['@meekojs/meeko'] !== packageVersion) throw new StepError('El proyecto generado no fijó la versión instalada de Meeko.')
	starterManifest.dependencies['@meekojs/meeko'] = tarball
	writeFileSync(starterManifestPath, `${JSON.stringify(starterManifest, null, 2)}\n`)
	run('npm', ['install', '--prefix', starter, '--no-audit', '--no-fund'], { env, failure: 'No se pudieron instalar las dependencias del proyecto generado.' })
	run('npm', ['run', 'build', '--prefix', starter], { env, failure: 'Falló el build SSR del proyecto generado.' })

	const prepared = join(testRoot, 'prepared')
	write(join(prepared, 'package.json'), '{"name":"existing-shell","type":"commonjs","scripts":{"test":"echo original"},"dependencies":{"@meekojs/meeko":"^0.0.2"}}')
	write(join(prepared, 'pnpm-workspace.yaml'), "minimumReleaseAgeExclude:\n  - '@meekojs/meeko@0.0.2'\n")
	write(join(prepared, 'pnpm-lock.yaml'), "lockfileVersion: '9.0'\n")
	meeko(['init', prepared], 'Falló meeko init en un directorio preparado por pnpm.')
	const preparedManifestPath = join(prepared, 'package.json')
	const preparedManifest = readManifest(preparedManifestPath)
	if (preparedManifest.scripts?.test !== 'echo original' || preparedManifest.dependencies?.['@meekojs/meeko'] !== packageVersion) {
		throw new StepError('meeko init no conservó el manifiesto o no fijó la versión instalada.')
	}
	preparedManifest.dependencies['@meekojs/meeko'] = tarball
	writeFileSync(preparedManifestPath, `${JSON.stringify(preparedManifest, null, 2)}\n`)
	run('pnpm', ['-C', prepared, 'install', '--no-frozen-lockfile'], { env, failure: 'No se pudo instalar el proyecto preparado con pnpm.' })
	run('pnpm', ['-C', prepared, 'run', 'build'], { env, failure: 'Falló el build SSR del proyecto preparado con pnpm.' })

	console.log('Consumidor externo: CLI, tipos, Vite e init SSR OK.')
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
	await runMain(() => withTemporaryDirectory({ prefix: 'meeko-package-', base: tmpdir() }, check))
}
