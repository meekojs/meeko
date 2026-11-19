/** Destinos con ejecutable nativo de TypeScript 7 y host de extensión de VS Code. */
export const targets: readonly string[]
/** Archivos que se copian a la carpeta aislada que empaqueta vsce. */
export const stagedFiles: readonly string[]
/** Carpetas que se copian a la carpeta aislada que empaqueta vsce. */
export const stagedFolders: readonly string[]
/** Destino del equipo actual, como `linux-x64`. */
export function hostTarget(): string
/** Ruta del VSIX de un destino en `artifacts/`. */
export function vsixPath(target: string): string
/**
 * Construye `artifacts/<nombre>-<versión>-<destino>.vsix`.
 * @param options Destino (el del equipo por defecto) y si se reutiliza `dist/`.
 * @returns Ruta del VSIX.
 */
export function packageVsix(options?: { target?: string; skipBuild?: boolean }): string
