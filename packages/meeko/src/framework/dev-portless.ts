import { execFile } from 'node:child_process'
import { existsSync } from 'node:fs'
import { connect } from 'node:net'
import { dirname, join, resolve } from 'node:path'

/** `PORTLESS=0` desactiva portless, también aquí. */
export const portlessDisabledEnv = 'PORTLESS'
/** URL que portless pasa a un proceso que lanza él mismo (`portless <name> meeko dev`). */
export const portlessUrlEnv = 'PORTLESS_URL'
/** Segundos tras los que se abandona una orden de portless; un fallo nunca tumba `meeko dev`. */
const commandTimeout = 20_000

/**
 * Opción `dev.portless` de `meeko.config.ts`: `true` deriva el nombre del `name` del
 * `package.json`; `{ name }` lo fija y admite subdominios (`ui.meeko`).
 *
 * @since 1.12.0
 */
export type DevPortlessConfig = boolean | { readonly name: string }

/**
 * Valida y normaliza un nombre de portless: etiquetas DNS (letras, dígitos y guiones, sin
 * empezar ni acabar en guion, hasta 63 caracteres) separadas por puntos. Devuelve el nombre en
 * minúsculas o un mensaje de error.
 */
export function normalizePortlessName(value: unknown): { readonly value: string } | { readonly error: string } {
	if (typeof value !== 'string' || !value.trim()) return { error: 'debe ser una cadena no vacía' }
	const name = value.trim().toLowerCase()
	for (const label of name.split('.')) {
		if (!/^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/.test(label)) {
			return { error: `"${value}" no es un nombre válido: usa etiquetas de letras, dígitos y guiones (sin empezar ni acabar en guion, de hasta 63 caracteres), separadas por puntos, como "mi-app" o "ui.meeko"` }
		}
	}
	return { value: name }
}

/**
 * Nombre derivado del `name` de un `package.json`: sin el ámbito (`@acme/web` da `web`),
 * saneado como etiqueta DNS. `undefined` si no queda nada utilizable.
 */
export function portlessNameFromPackage(packageName: string | undefined): string | undefined {
	if (!packageName) return undefined
	const bare = packageName.slice(packageName.lastIndexOf('/') + 1)
	const label = bare
		.toLowerCase()
		.replace(/[^a-z0-9-]+/g, '-')
		.replace(/^-+|-+$/g, '')
		.slice(0, 63)
		.replace(/-+$/g, '')
	return label || undefined
}

/**
 * Valida `dev.portless` y devuelve el error en español, o `undefined` si es válido. `label` es
 * el prefijo del mensaje (`<archivo>: dev.portless`).
 */
export function portlessConfigError(value: unknown, label: string): string | undefined {
	if (value === undefined || typeof value === 'boolean') return undefined
	if (!value || typeof value !== 'object' || Array.isArray(value)) return `${label} debe ser un booleano o un objeto { name }`
	const keys = Object.keys(value)
	const unknown = keys.find((key) => key !== 'name')
	if (unknown) return `${label}.${unknown} no es una opción; sólo existe name`
	const result = normalizePortlessName((value as { name?: unknown }).name)
	return 'error' in result ? `${label}.name ${result.error}` : undefined
}

/** Nombre que `dev.portless` pide, o `undefined` si está desactivado; `error` cuando no se puede derivar. */
export function resolvePortlessName(option: DevPortlessConfig | undefined, packageName: string | undefined): { readonly name: string } | { readonly error: string } | undefined {
	if (option === undefined || option === false) return undefined
	if (option === true) {
		const name = portlessNameFromPackage(packageName)
		return name ? { name } : { error: 'dev.portless: true necesita un "name" en el package.json del proyecto; indica el nombre con dev.portless: { name: "mi-app" }' }
	}
	const result = normalizePortlessName(option.name)
	return 'value' in result ? { name: result.value } : { error: `dev.portless.name ${result.error}` }
}

/** Argumentos de `portless alias <name> <port>`. */
export function portlessAliasArgs(name: string, port: number): string[] {
	return ['alias', name, String(port)]
}

/** Argumentos de `portless alias --remove <name>`. */
export function portlessRemoveArgs(name: string): string[] {
	return ['alias', '--remove', name]
}

/** Argumentos de `portless get <name>`. */
export function portlessGetArgs(name: string): string[] {
	return ['get', name]
}

/** La URL que `portless get` imprime (la última línea que lo es), o `undefined`. */
export function parsePortlessUrl(output: string): URL | undefined {
	for (const line of output.split(/\r?\n/).reverse()) {
		const text = line.trim()
		if (!/^https?:\/\/\S+$/.test(text)) continue
		try {
			return new URL(text)
		} catch {
			/* sigue con la línea anterior */
		}
	}
	return undefined
}

/**
 * Entrada de `dev.allowedHosts` de una URL de portless: su host (sin puerto). `*.localhost` ya
 * pasa siempre; hace falta con otro TLD (`PORTLESS_TLD=test`).
 */
export function portlessAllowedHost(url: URL): string {
	return url.hostname.toLowerCase()
}

/** Dónde se busca el binario de portless: `node_modules/.bin` de `root` y de cada ancestro. */
export function portlessBinaryCandidates(root: string, platform: NodeJS.Platform = process.platform): string[] {
	const file = platform === 'win32' ? 'portless.cmd' : 'portless'
	const candidates: string[] = []
	let directory = resolve(root)
	for (;;) {
		candidates.push(join(directory, 'node_modules', '.bin', file))
		const parent = dirname(directory)
		if (parent === directory) return candidates
		directory = parent
	}
}

/** Resultado de una orden de portless. */
export interface PortlessResult {
	/** Código de salida; `null` si no llegó a ejecutarse (no está instalado, tiempo agotado). */
	readonly code: number | null
	readonly stdout: string
	readonly stderr: string
	/** `ENOENT` cuando el binario no existe. */
	readonly errorCode?: string
}

/** Ejecuta una orden de portless; las pruebas lo sustituyen. */
export type PortlessRunner = (command: string, args: readonly string[], env: NodeJS.ProcessEnv) => Promise<PortlessResult>

/** Ejecutor real: nunca rechaza, informa del fallo en el resultado. */
export const runPortless: PortlessRunner = (command, args, env) =>
	new Promise((done) => {
		// `.cmd` de Windows sólo se lanza a través de un shell; los argumentos son un nombre validado y un número.
		const shell = process.platform === 'win32' && /\.cmd$/i.test(command)
		execFile(command, [...args], { env, timeout: commandTimeout, windowsHide: true, shell }, (error, stdout, stderr) => {
			const failure = error as (NodeJS.ErrnoException & { code?: string | number }) | null
			if (!failure) return done({ code: 0, stdout: String(stdout), stderr: String(stderr) })
			done({ code: typeof failure.code === 'number' ? failure.code : null, stdout: String(stdout), stderr: String(stderr || failure.message), ...(typeof failure.code === 'string' ? { errorCode: failure.code } : {}) })
		})
	})

/** Si algo escucha en `127.0.0.1:port`; las pruebas lo sustituyen. */
export function isPortListening(port: number): Promise<boolean> {
	return new Promise((done) => {
		const socket = connect({ port, host: '127.0.0.1' })
		const finish = (listening: boolean): void => {
			socket.destroy()
			done(listening)
		}
		socket.setTimeout(1_000, () => finish(false))
		socket.once('connect', () => finish(true))
		socket.once('error', () => finish(false))
	})
}

/** Una ruta de portless activa para este `meeko dev`. */
export interface PortlessSession {
	/** URL con nombre (`https://ui.meeko.localhost`). */
	readonly url: string
	/** Host de la URL, que se añade a los hosts permitidos de dev. */
	readonly host: string
	/** Quita la ruta registrada; idempotente y sin rechazar. No hace nada si portless ya envolvía a meeko dev. */
	release(): Promise<void>
}

export interface StartPortlessOptions {
	/** Raíz del proyecto. */
	readonly root: string
	/** Valor de `dev.portless`. */
	readonly option: DevPortlessConfig | undefined
	/** `name` del `package.json` del proyecto. */
	readonly packageName: string | undefined
	/** Puerto HTTP en el que escucha `meeko dev`. */
	readonly port: number
	/** Variables de entorno; por defecto `process.env`. */
	readonly env?: NodeJS.ProcessEnv
	/** Avisos para el desarrollador. */
	readonly warn: (message: string) => void
	/** Ejecuta portless; por defecto el proceso real. */
	readonly run?: PortlessRunner
	/** Si existe un archivo; por defecto `existsSync`. */
	readonly exists?: (file: string) => boolean
	/** Si el proxy de portless escucha en un puerto local. */
	readonly listening?: (port: number) => Promise<boolean>
}

function installHint(): string {
	return 'Instálalo con `pnpm add -D portless` (o `npm i -D portless`, `yarn add -D portless`) o ponlo en el PATH; meeko dev sigue en su puerto.'
}

function firstLine(text: string): string {
	return (
		text
			.trim()
			.split(/\r?\n/)
			.find((line) => line.trim()) ?? ''
	)
}

/**
 * Pone `meeko dev` detrás de portless según `dev.portless`: registra `portless alias <name>
 * <port>` y averigua la URL con `portless get`. Devuelve `undefined` (con un aviso cuando hay algo
 * que corregir) si está desactivado, si `PORTLESS=0`, o si portless falta o falla: nunca rechaza.
 * Con `PORTLESS_URL` definido, `meeko dev` ya corre dentro de portless y sólo se acepta su host.
 */
export async function startPortless(options: StartPortlessOptions): Promise<PortlessSession | undefined> {
	const env = options.env ?? process.env
	const run = options.run ?? runPortless
	if (env[portlessDisabledEnv] === '0') return undefined
	const inherited = env[portlessUrlEnv]
	if (inherited) {
		const url = parsePortlessUrl(inherited)
		return url ? { url: url.origin, host: portlessAllowedHost(url), release: async () => undefined } : undefined
	}
	const wanted = resolvePortlessName(options.option, options.packageName)
	if (!wanted) return undefined
	if ('error' in wanted) {
		options.warn(`${wanted.error}; meeko dev sigue en su puerto.`)
		return undefined
	}
	const { name } = wanted
	const exists = options.exists ?? existsSync
	const command = portlessBinaryCandidates(options.root).find((candidate) => exists(candidate)) ?? 'portless'
	const failed = (what: string, result: PortlessResult): undefined => {
		if (result.errorCode === 'ENOENT') options.warn(`portless no está instalado (dev.portless). ${installHint()}`)
		else options.warn(`portless ${what} falló${result.code === null ? '' : ` (código ${result.code})`}: ${firstLine(result.stderr || result.stdout) || 'sin mensaje'}; meeko dev sigue en su puerto.`)
		return undefined
	}
	try {
		const registered = await run(command, portlessAliasArgs(name, options.port), env)
		if (registered.code !== 0) return failed(`alias ${name}`, registered)
		const remove = async (): Promise<void> => {
			try {
				await run(command, portlessRemoveArgs(name), env)
			} catch {
				/* la ruta queda hasta el próximo alias o portless alias --remove */
			}
		}
		// `alias` registers the name as given, but `get` prefixes the branch name inside a git worktree: the empty prefix makes it print the aliased URL.
		const printed = await run(command, portlessGetArgs(name), { ...env, PORTLESS_PREFIX: '' })
		const url = printed.code === 0 ? parsePortlessUrl(printed.stdout) : undefined
		if (!url) {
			await remove()
			return failed(`get ${name}`, printed.code === 0 ? { ...printed, code: null, stderr: 'no imprimió una URL' } : printed)
		}
		const proxyPort = url.port ? Number(url.port) : url.protocol === 'https:' ? 443 : 80
		if (!(await (options.listening ?? isPortListening)(proxyPort))) {
			options.warn(`El proxy de portless no escucha en el puerto ${proxyPort}; ${url.origin} no responderá hasta que lo arranques con \`portless proxy start\` (con PORTLESS_PORT, PORTLESS_HTTPS y PORTLESS_STATE_DIR si los usas).`)
		}
		let released: Promise<void> | undefined
		return { url: url.origin, host: portlessAllowedHost(url), release: () => (released ??= remove()) }
	} catch (error) {
		options.warn(`portless falló: ${error instanceof Error ? error.message : String(error)}; meeko dev sigue en su puerto.`)
		return undefined
	}
}
