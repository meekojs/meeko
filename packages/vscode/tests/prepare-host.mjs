// Prepara un entorno aislado (VSIX extraído, consumidor con Meeko instalado desde su tarball y un segundo
// proyecto) y ejecuta en él las pruebas de host de VS Code. Funciona en Windows, macOS y Linux.
// Uso: node tests/prepare-host.mjs [--vscode-executable <ruta>]
// Variables que lee y que `run-host*.mjs` consumen: MEEKO_HOST_VSCODE (opcional), MEEKO_HOST_EXTENSION,
// MEEKO_HOST_CONSUMER, MEEKO_HOST_WORKSPACE, MEEKO_HOST_SECONDARY y MEEKO_HOST_DATA. Termina con código 1 si
// falla un paso; el directorio temporal se elimina siempre.
import { chmodSync, existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { delimiter, dirname, join, resolve, sep } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { parseArgs } from 'node:util'

import { childEnv, defaultTimeout, lastLine, leafName, legacyArguments, run, runMain, StepError, withTemporaryDirectory } from '../../../scripts/process-utils.mjs'
import { vsixPath } from '../package-vsix.mjs'
import { zipEntries, zipEntry } from '../scripts/vsix-archive.mjs'

const editorRoot = resolve(fileURLToPath(new URL('..', import.meta.url)))
const packageRoot = resolve(editorRoot, '../meeko')
/** Cada prueba de host abre una ventana de VS Code: el arranque y la descarga son lentos. */
const hostTimeout = 20 * 60_000

/**
 * Destino del equipo actual, como `linux-x64`: el del VSIX que se prueba.
 * @param {NodeJS.Platform} [platform] Sistema operativo.
 * @param {string} [arch] Arquitectura de la CPU.
 */
export function hostTarget(platform = process.platform, arch = process.arch) {
	if (platform !== 'win32' && platform !== 'linux' && platform !== 'darwin') throw new StepError('Sistema operativo no admitido por las pruebas host.')
	if (arch !== 'x64' && arch !== 'arm64') throw new StepError('Arquitectura no admitida por las pruebas host.')
	return `${platform}-${arch}`
}

/** Un archivo de `PATH`; en Windows también con las extensiones ejecutables habituales. */
function onPath(name, env, platform) {
	const extensions = platform === 'win32' ? ['.exe', '.cmd', '.bat', ''] : ['']
	for (const folder of (env.PATH ?? env.Path ?? '').split(delimiter).filter(Boolean)) {
		for (const extension of extensions) {
			const candidate = join(folder, name + extension)
			if (existsSync(candidate) && statSync(candidate).isFile()) return candidate
		}
	}
	return undefined
}

/** En WSL, el `code` de Windows se monta bajo `/mnt/<unidad>/` y abriría el VS Code de Windows. */
export const isWindowsCodeInWsl = (path, env) => Boolean(env.WSL_DISTRO_NAME) && path.startsWith('/mnt/')

/**
 * El VS Code con el que se prueba: el indicado, `MEEKO_HOST_VSCODE`, la instalación habitual de Windows o el
 * `code` del `PATH`. En WSL se ignora el `code` de Windows (bajo `/mnt/<unidad>/`), que abriría el VS Code de
 * Windows en vez de un host Linux. Sin ninguno, `@vscode/test-electron` descarga la versión estable.
 * @param {string | undefined} explicit Ruta indicada con `--vscode-executable`; si no existe, es un error.
 * @param {NodeJS.ProcessEnv} [env] Entorno con `PATH`, `LOCALAPPDATA`, `MEEKO_HOST_VSCODE` y `WSL_DISTRO_NAME`.
 * @param {NodeJS.Platform} [platform] Sistema operativo.
 * @returns {string | undefined} El ejecutable, o `undefined` si hay que descargar uno.
 */
export function findVSCode(explicit, env = process.env, platform = process.platform) {
	const isFile = (path) => existsSync(path) && statSync(path).isFile()
	if (explicit) {
		if (!isFile(explicit)) throw new StepError(`No se encontró el ejecutable de VS Code indicado: ${explicit}`)
		return explicit
	}
	if (env.MEEKO_HOST_VSCODE && isFile(env.MEEKO_HOST_VSCODE)) return env.MEEKO_HOST_VSCODE
	if (platform === 'win32') {
		const installed = env.LOCALAPPDATA ? join(env.LOCALAPPDATA, 'Programs/Microsoft VS Code/Code.exe') : undefined
		return installed && isFile(installed) ? installed : undefined
	}
	const code = onPath('code', env, platform)
	return code && !isWindowsCodeInWsl(code, env) ? code : undefined
}

/**
 * Extrae un VSIX conservando los permisos Unix de cada entrada (el ejecutable nativo de TypeScript debe seguir
 * siendo ejecutable) sin depender de `unzip` ni de `Expand-Archive`.
 * @param {Buffer} archive Contenido del VSIX.
 * @param {string} destination Carpeta donde se extrae; se crea si no existe.
 */
export function extractVsix(archive, destination) {
	const root = resolve(destination)
	mkdirSync(root, { recursive: true })
	for (const entry of zipEntries(archive)) {
		const target = resolve(root, entry.name)
		// Una entrada con `..` o una ruta absoluta escribiría fuera de la carpeta.
		if (!target.startsWith(root + sep)) throw new StepError(`El VSIX contiene una ruta fuera de su carpeta: ${entry.name}`)
		if (entry.name.endsWith('/')) {
			mkdirSync(target, { recursive: true })
			continue
		}
		mkdirSync(dirname(target), { recursive: true })
		const content = zipEntry(archive, entry.name)
		if (!content) throw new StepError(`No se pudo extraer ${entry.name} del VSIX.`)
		writeFileSync(target, content)
		if (process.platform !== 'win32') chmodSync(target, entry.mode || 0o644)
	}
}

/** Escribe `content` en `path`, creando las carpetas que falten. */
function write(path, content) {
	mkdirSync(dirname(path), { recursive: true })
	writeFileSync(path, content)
}

const counter = `<script lang="ts">
import { signal } from "@meekojs/meeko";
const count=signal(0);
const bad: number = "invalid";
</script>
<template><button  class="counter" on:click="() => count.value++">{count.value}</button></template>
<style>.counter{color:red;}</style>
`
const semantic = `<script lang="ts">
const title = "Hola";
const enabled = true;
const items = [{ name: "Ada" }];
const handler = () => title;
const chosen = { name: "Ada" };
let mutable = 1;
</script>
<template>
  <button on:click="handler" if:condition="enabled" bind:title="title">{title} {chosen.name}</button>
  <ul><li each:of="items" each:as="item">{item.name}</li></ul>
  <component is="chosen"></component>
  <p>{chosen?.name} {mutable} {title}</p>
</template>
`
const dependentRoute = `import { definePage } from "@meekojs/meeko/framework";
import type { Data } from "../../contract-data.js";
export const route = definePage({ load: (): Data => null as unknown as Data });
`
const zones = `<script server lang="ts">
import { definePage } from "@meekojs/meeko/framework";
export const route = definePage({ load: () => ({ title: "Zones" }) });
</script>
<script lang="ts">
import { signal } from "@meekojs/meeko";
const props = defineProps<{ data: { title: string } }>();
const count = signal(0);
onMounted(() => {
  count.value = 1;
});
</script>
<template><p>{props.data.title} {count.value}</p></template>
`

/**
 * Crea el consumidor, el proyecto secundario y el workspace de VS Code que usan las pruebas.
 * @param {string} consumer Carpeta del consumidor (ya con Meeko instalado después).
 * @param {string} secondary Carpeta del segundo proyecto.
 * @param {string} workspace Archivo `.code-workspace`.
 */
function writeProjects(consumer, secondary, workspace) {
	write(join(secondary, 'Secondary.meeko'), '<script lang="ts">const count = 1;</script><template><p>{count}</p></template>')
	write(workspace, '{"folders":[{"path":"consumer"},{"path":"secondary"}]}')
	write(join(consumer, 'package.json'), '{"name":"meeko-consumer-test","private":true,"type":"module"}')
	write(join(consumer, 'Counter.meeko'), counter)
	write(join(consumer, 'Semantic.meeko'), semantic)
	write(join(consumer, 'answer.ts'), 'export const answer = "ok";')
	write(join(consumer, 'Imported.meeko'), '<script lang="ts">import { answer } from "./answer.js"; const text: string = answer;</script><template>{text}</template>')
	write(join(consumer, 'app/styles/main.css'), '.btn-primary { color: white; background: navy; }')
	write(join(consumer, 'app/pages/index.meeko'), '<script lang="ts"></script><template><p>Home</p></template>')
	write(join(consumer, 'contract-data.ts'), 'export type Data = string;')
	write(join(consumer, 'app/pages/dependent.meeko'), '<script lang="ts">const props = defineProps<{ data: string }>();</script><template><p>{props.data}</p></template>')
	write(join(consumer, 'app/pages/dependent.route.ts'), dependentRoute)
	write(join(consumer, 'app/pages/zones.meeko'), zones)
	write(join(consumer, 'app/layouts/default.meeko'), '<script lang="ts">const props = defineProps<{ outlet: object; missing: string }>();</script><template><p>Layout</p></template>')
	write(join(consumer, 'app/layouts/links.meeko'), '<script lang="ts"></script><template><MeekoLink to="/" class="brand">Inicio</MeekoLink><MeekoOutlet /></template>')
}

/**
 * Prepara el entorno aislado en `testRoot` y ejecuta las pruebas de host.
 * @param {string} testRoot Directorio temporal propio.
 * @param {string | undefined} vscodeExecutable Ejecutable indicado con `--vscode-executable`.
 */
function prepareAndRun(testRoot, vscodeExecutable) {
	const target = hostTarget()
	const manifestName = JSON.parse(readFileSync(join(editorRoot, 'package.json'), 'utf8')).name
	const vscode = findVSCode(vscodeExecutable)
	const vsix = vsixPath(target)
	if (!existsSync(vsix)) throw new StepError(`Primero genera el VSIX para ${target}: ${vsix}`)
	const consumer = join(testRoot, 'consumer')
	const secondary = join(testRoot, 'secondary')
	const extractionRoot = join(testRoot, 'vsix')
	const workspace = join(testRoot, 'meeko.code-workspace')
	const env = childEnv()

	mkdirSync(consumer, { recursive: true })
	mkdirSync(secondary, { recursive: true })
	writeProjects(consumer, secondary, workspace)
	extractVsix(readFileSync(vsix), extractionRoot)
	if (!existsSync(join(extractionRoot, 'extension/package.json'))) throw new StepError(`El VSIX de ${manifestName} no contiene extension/package.json.`)
	// pnpm pack, not npm pack: it replaces the catalog: and workspace: versions, which npm cannot install.
	const packageName = lastLine(run('pnpm', ['-C', packageRoot, 'pack', '--pack-destination', testRoot], { env, failure: 'No se pudo empaquetar el motor Meeko.', capture: true }))
	if (!packageName) throw new StepError('No se pudo empaquetar el motor Meeko.')
	run('npm', ['install', '--prefix', consumer, '--ignore-scripts', '--no-audit', '--no-fund', join(testRoot, leafName(packageName))], { env, failure: 'No se pudo instalar Meeko en el proyecto consumidor.', timeout: defaultTimeout })

	// Sin límite de heap: los scripts run-host*.mjs sólo lanzan VS Code (Electron), que rechaza NODE_OPTIONS.
	const hostEnv = childEnv(
		{
			MEEKO_HOST_VSCODE: vscode,
			MEEKO_HOST_EXTENSION: join(extractionRoot, 'extension'),
			MEEKO_HOST_CONSUMER: consumer,
			MEEKO_HOST_WORKSPACE: workspace,
			MEEKO_HOST_SECONDARY: secondary,
			MEEKO_HOST_DATA: join(testRoot, 'user-data'),
		},
		process.env,
		false,
	)
	run('pnpm', ['run', 'test:host'], { cwd: editorRoot, env: hostEnv, failure: 'Falló la prueba en VS Code.', timeout: hostTimeout })
	run('pnpm', ['run', 'test:host:snippets'], { cwd: editorRoot, env: hostEnv, failure: 'Falló la prueba de fragmentos en VS Code.', timeout: hostTimeout })
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
	await runMain(async () => {
		const { values } = parseArgs({ args: legacyArguments(process.argv.slice(2), { VSCodeExecutable: '--vscode-executable' }), options: { 'vscode-executable': { type: 'string' } } })
		// En macOS el directorio temporal del sistema es tan largo que el socket IPC de VS Code (--user-data-dir)
		// supera el límite de ruta de Unix: fuera de Windows se usa /tmp.
		const base = process.platform !== 'win32' && existsSync('/tmp') ? '/tmp' : tmpdir()
		await withTemporaryDirectory({ prefix: 'meeko-host-', base }, (directory) => prepareAndRun(directory, values['vscode-executable']))
	})
}
