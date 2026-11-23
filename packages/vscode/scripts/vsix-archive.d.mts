/** Entrada del directorio central de un ZIP. */
export interface ZipEntry {
	readonly name: string
	readonly mode: number
	readonly method: number
	readonly compressedSize: number
	readonly localOffset: number
	readonly directoryOffset: number
}
/** Entradas del directorio central de un VSIX (un ZIP sin ZIP64). */
export function zipEntries(archive: Buffer): ZipEntry[]
/** Contenido descomprimido de una entrada del VSIX, o `undefined` si no existe. */
export function zipEntry(archive: Buffer, name: string): Buffer | undefined
/** Marca una entrada como ejecutable (0755) cambiando sólo el directorio central. */
export function setExecutable(archive: Buffer, name: string): void
