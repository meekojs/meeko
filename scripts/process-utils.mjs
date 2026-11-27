// Utilidades compartidas por los scripts de humo multiplataforma (prepare-host.mjs, package-consumer.mjs y
// package-workspace-smoke.mjs): lanzan procesos con tiempo límite, también los `.cmd` de Windows, y crean y
// limpian directorios temporales propios.
import { spawnSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, rmSync } from 'node:fs'
import { resolve, sep } from 'node:path'

/** Heap de V8 de todo proceso Node que lanzan los scripts, salvo que el entorno ya lo fije. */
export const nodeOptions = '--max-old-space-size=8192'
/** Tiempo límite por defecto de un proceso hijo: instalar dependencias es lo más lento. */
export const defaultTimeout = 15 * 60_000

/** Error de un paso fallido: su mensaje es lo único que se muestra al usuario. */
export class StepError extends Error {
	name = 'StepError'
}

/** Un argumento para `cmd.exe`: entre comillas si tiene espacios o metacaracteres, como una ruta con espacios. */
export const shellArgument = (value) => (/[\s"&|<>^()%!]/.test(value) ? `"${value.replaceAll('"', '""')}"` : value)

/**
 * Cómo se lanza un comando. En Windows `pnpm`, `npm` y los `.cmd` o `.bat` son scripts que sólo se ejecutan
 * a través de `cmd.exe`, que une los argumentos sin entrecomillarlos: se entrecomillan uno a uno y se pasa
 * una sola línea de comandos (con `args` y `shell` a la vez Node avisa de una API obsoleta). El resto se
 * lanza directamente.
 * @param {string} command Ejecutable o nombre de un comando del `PATH`.
 * @param {readonly string[]} args Argumentos.
 * @param {NodeJS.Platform} [platform] Sistema operativo; el actual por defecto.
 * @returns {{ command: string, args: string[], shell: boolean }} Lo que se pasa a `spawnSync`.
 */
export function commandSpec(command, args, platform = process.platform) {
	const shell = platform === 'win32' && (/\.(?:cmd|bat)$/i.test(command) || /^(?:pnpm|npm|npx|yarn)$/i.test(command))
	return shell ? { command: [command, ...args].map(shellArgument).join(' '), args: [], shell } : { command, args: [...args], shell }
}

/**
 * Entorno de un proceso hijo: el actual más `extra`, con el heap de Node limitado salvo que ya lo fije.
 * Un valor `undefined` en `extra` elimina la variable.
 * @param {Record<string, string | undefined>} [extra] Variables que se añaden o (con `undefined`) se quitan.
 * @param {NodeJS.ProcessEnv} [base] Entorno de partida.
 * @param {boolean} [limitHeap] `false` no toca `NODE_OPTIONS`: un ejecutable de Electron (VS Code) lo rechaza con un error en su registro.
 * @returns {NodeJS.ProcessEnv} El entorno del hijo.
 */
export function childEnv(extra = {}, base = process.env, limitHeap = true) {
	const env = { ...base, ...extra }
	for (const [name, value] of Object.entries(extra)) if (value === undefined) delete env[name]
	if (limitHeap && !/--max-old-space-size/.test(env.NODE_OPTIONS ?? '')) env.NODE_OPTIONS = [env.NODE_OPTIONS, nodeOptions].filter(Boolean).join(' ')
	return env
}

/**
 * Ejecuta un proceso y falla con `failure` si termina con error, con una señal o fuera de tiempo.
 * @param {string} command Ejecutable.
 * @param {readonly string[]} args Argumentos.
 * @param {{ cwd?: string, env?: NodeJS.ProcessEnv, timeout?: number, failure: string, capture?: boolean }} options `failure` es el mensaje del paso;
 * con `capture` se devuelve la salida estándar en vez de mostrarla.
 * @returns {string} La salida estándar si se pidió `capture`; si no, una cadena vacía.
 */
export function run(command, args, { cwd, env = childEnv(), timeout = defaultTimeout, failure, capture = false }) {
	const spec = commandSpec(command, args)
	const result = spawnSync(spec.command, spec.args, {
		cwd,
		env,
		encoding: 'utf8',
		killSignal: 'SIGKILL',
		shell: spec.shell,
		stdio: capture ? ['ignore', 'pipe', 'inherit'] : 'inherit',
		timeout,
		windowsHide: true,
	})
	if (result.error) {
		const reason = result.error.code === 'ETIMEDOUT' ? `tiempo agotado tras ${Math.round(timeout / 1000)} s` : result.error.message
		throw new StepError(`${failure} (${reason})`)
	}
	if (result.status !== 0) throw new StepError(failure)
	return result.stdout ?? ''
}

/** La última línea con contenido de una salida, como el nombre del tarball que imprime `pnpm pack`. */
export function lastLine(output) {
	return output
		.split(/\r?\n/)
		.map((line) => line.trim())
		.filter(Boolean)
		.at(-1)
}

/** Nombre de un archivo en una ruta con separadores de cualquier sistema. */
export const leafName = (path) => path.split(/[\\/]/).at(-1) ?? path

/**
 * Traduce los parámetros de PowerShell (`-Offline`, `-VSCodeExecutable`) a las opciones de `parseArgs`.
 * Un parámetro desconocido se deja como está para que `parseArgs` lo rechace.
 * @param {readonly string[]} argv Argumentos recibidos.
 * @param {Record<string, string>} aliases Mapa de `-Parametro` (sin distinguir mayúsculas) a `--opcion`.
 * @returns {string[]} Argumentos con las opciones traducidas.
 */
export function legacyArguments(argv, aliases) {
	const lookup = new Map(Object.entries(aliases).map(([name, option]) => [name.toLowerCase(), option]))
	return argv.map((argument) => (/^-[A-Za-z]/.test(argument) && lookup.has(argument.slice(1).toLowerCase()) ? lookup.get(argument.slice(1).toLowerCase()) : argument))
}

/**
 * Crea un directorio temporal propio y lo elimina al terminar, también si `work` falla.
 * @template T
 * @param {{ prefix: string, base: string, keep?: boolean }} options Prefijo, carpeta que lo contiene y si se conserva.
 * @param {(directory: string) => Promise<T> | T} work Trabajo que usa el directorio.
 * @returns {Promise<T>} Lo que devuelve `work`.
 */
export async function withTemporaryDirectory({ prefix, base, keep = false }, work) {
	mkdirSync(base, { recursive: true })
	const directory = mkdtempSync(resolve(base, prefix))
	try {
		return await work(directory)
	} finally {
		if (!keep) removeTemporaryDirectory(directory, base)
	}
}

/** Borra `directory` sólo si está dentro de `base`: una ruta mal calculada nunca elimina algo ajeno. */
export function removeTemporaryDirectory(directory, base) {
	const target = resolve(directory)
	if (!target.startsWith(resolve(base) + sep)) throw new Error(`Se niega a borrar ${target}: no está dentro de ${resolve(base)}.`)
	rmSync(target, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 })
}

/**
 * Ejecuta el punto de entrada de un script: un fallo muestra su mensaje en español y termina con código 1
 * (el de `throw` en PowerShell), después de que los `finally` hayan limpiado.
 * @param {() => Promise<void> | void} main Cuerpo del script.
 */
export async function runMain(main) {
	try {
		await main()
	} catch (error) {
		console.error(error instanceof StepError ? error.message : (error?.stack ?? String(error)))
		process.exitCode = 1
	}
}
