import { inflateRawSync } from 'node:zlib'

const endSignature = 0x06054b50
const directorySignature = 0x02014b50
const localSignature = 0x04034b50

/**
 * Entradas del directorio central de un VSIX (un ZIP sin ZIP64).
 * @param {Buffer} archive Contenido del VSIX.
 * @returns {Array<{ name: string, mode: number, method: number, compressedSize: number, localOffset: number, directoryOffset: number }>} Entradas en el orden del archivo.
 */
export function zipEntries(archive) {
	let end = -1
	for (let offset = archive.length - 22; offset >= Math.max(0, archive.length - 65_557); offset--) {
		if (archive.readUInt32LE(offset) === endSignature && offset + 22 + archive.readUInt16LE(offset + 20) === archive.length) {
			end = offset
			break
		}
	}
	if (end < 0) throw new Error('No se encontró el directorio ZIP del VSIX.')
	const count = archive.readUInt16LE(end + 10)
	let offset = archive.readUInt32LE(end + 16)
	if (count === 0xffff || offset === 0xffffffff) throw new Error('El VSIX usa ZIP64, formato no admitido.')
	const entries = []
	for (let index = 0; index < count; index++) {
		if (archive.readUInt32LE(offset) !== directorySignature) throw new Error('El directorio ZIP del VSIX está dañado.')
		const nameLength = archive.readUInt16LE(offset + 28)
		const extraLength = archive.readUInt16LE(offset + 30)
		const commentLength = archive.readUInt16LE(offset + 32)
		entries.push({
			name: archive.toString('utf8', offset + 46, offset + 46 + nameLength),
			mode: (archive.readUInt32LE(offset + 38) >>> 16) & 0o777,
			method: archive.readUInt16LE(offset + 10),
			compressedSize: archive.readUInt32LE(offset + 20),
			localOffset: archive.readUInt32LE(offset + 42),
			directoryOffset: offset,
		})
		offset += 46 + nameLength + extraLength + commentLength
	}
	return entries
}

/**
 * Contenido descomprimido de una entrada del VSIX.
 * @param {Buffer} archive Contenido del VSIX.
 * @param {string} name Ruta interna, como `extension/package.json`.
 * @returns {Buffer | undefined} El contenido, o `undefined` si la entrada no existe.
 */
export function zipEntry(archive, name) {
	const entry = zipEntries(archive).find((item) => item.name === name)
	if (!entry) return undefined
	if (archive.readUInt32LE(entry.localOffset) !== localSignature) throw new Error(`La cabecera local de ${name} está dañada.`)
	const start = entry.localOffset + 30 + archive.readUInt16LE(entry.localOffset + 26) + archive.readUInt16LE(entry.localOffset + 28)
	const data = archive.subarray(start, start + entry.compressedSize)
	if (entry.method === 0) return Buffer.from(data)
	if (entry.method === 8) return inflateRawSync(data)
	throw new Error(`${name} usa el método de compresión ${entry.method}, no admitido.`)
}

/**
 * Marca una entrada como ejecutable (0755) cambiando sólo la metadata del directorio central:
 * reescribir el archivo con otra biblioteca ZIP corrompe las firmas binarias del paquete.
 * @param {Buffer} archive Contenido del VSIX; se modifica en el sitio.
 * @param {string} name Ruta interna del ejecutable.
 */
export function setExecutable(archive, name) {
	const matches = zipEntries(archive).filter((entry) => entry.name === name)
	if (matches.length !== 1) throw new Error(`Se encontraron ${matches.length} entradas para ${name}; se esperaba una.`)
	const offset = matches[0].directoryOffset + 38
	archive.writeUInt32LE(((archive.readUInt32LE(offset) & ~0x01ff0000) | 0x01ed0000) >>> 0, offset)
}
