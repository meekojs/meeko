/**
 * Destino del equipo actual, como `linux-x64`: el del VSIX que se prueba.
 * @param platform Sistema operativo.
 * @param arch Arquitectura de la CPU.
 */
export function hostTarget(platform?: NodeJS.Platform, arch?: string): string
/**
 * En WSL, el `code` de Windows se monta bajo `/mnt/<unidad>/` y abriría el VS Code de Windows.
 * @param path Ruta del `code` encontrado.
 * @param env Entorno con `WSL_DISTRO_NAME`.
 */
export function isWindowsCodeInWsl(path: string, env: NodeJS.ProcessEnv): boolean
/**
 * El VS Code con el que se prueba: el indicado, `MEEKO_HOST_VSCODE`, la instalación habitual de Windows o el
 * `code` del `PATH` (salvo el de Windows dentro de WSL). Sin ninguno, `@vscode/test-electron` descarga uno.
 * @param explicit Ruta indicada con `--vscode-executable`; si no existe, es un error.
 * @param env Entorno con `PATH`, `LOCALAPPDATA`, `MEEKO_HOST_VSCODE` y `WSL_DISTRO_NAME`.
 * @param platform Sistema operativo.
 */
export function findVSCode(explicit: string | undefined, env?: NodeJS.ProcessEnv, platform?: NodeJS.Platform): string | undefined
/**
 * Extrae un VSIX conservando los permisos Unix de cada entrada.
 * @param archive Contenido del VSIX.
 * @param destination Carpeta donde se extrae.
 */
export function extractVsix(archive: Buffer, destination: string): void
