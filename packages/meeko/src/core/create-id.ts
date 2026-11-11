/**
 * Genera un UUID v4 criptográfico nuevo en servidor o navegador, sin contexto de componente.
 * Puede llamarse desde handlers, funciones y módulos. No produce el mismo valor durante SSR e
 * hidratación: para IDs de elementos que deban coincidir, usa `useId`; para conservar un ID de
 * datos creado en el servidor, envíalo al cliente con los datos serializados.
 *
 * Las colisiones son extremadamente improbables, no imposibles. Para unicidad absoluta de datos
 * persistidos, añade una restricción única en el almacenamiento y reintenta ante una colisión.
 *
 * @returns Un UUID como `3d17fca4-a544-4937-a47c-e9c32fbe4638`.
 * @example
 * ```ts
 * const item = { id: createId(), props: { label: 'Nuevo' }, action: save }
 * ```
 */
export function createId(): string {
	const crypto = globalThis.crypto
	if (typeof crypto?.randomUUID === 'function') return crypto.randomUUID()
	if (typeof crypto?.getRandomValues !== 'function') throw new Error('createId requiere Web Crypto para generar IDs criptográficos')
	// getRandomValues también está disponible en navegadores sin contexto seguro.
	const bytes = crypto.getRandomValues(new Uint8Array(16))
	bytes[6] = (bytes[6]! & 0x0f) | 0x40
	bytes[8] = (bytes[8]! & 0x3f) | 0x80
	const hex = Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('')
	return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`
}
