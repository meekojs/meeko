/** La primera letra o cifra de una palabra, o su primer carácter si no tiene ninguna; respeta los pares sustitutos. */
function firstLetter(word: string): string {
	return word.match(/[\p{L}\p{N}]/u)?.[0] ?? Array.from(word)[0] ?? ''
}

/**
 * Las iniciales de `<UIAvatar>`: la primera letra de hasta dos palabras de `name`, en mayúsculas. Un correo
 * da sólo la primera letra de lo que va antes de la `@`. Sin nombre, una cadena vacía.
 *
 * @example
 * ```ts
 * avatarInitials('ana maría pérez') // 'AM'
 * avatarInitials('ana@example.com') // 'A'
 * ```
 */
export function avatarInitials(name: string | undefined): string {
	const text = name?.trim() ?? ''
	if (!text) return ''
	if (/^[^\s@]+@[^\s@]*$/.test(text)) return firstLetter(text.slice(0, text.indexOf('@')) || text).toLocaleUpperCase()
	return text.split(/\s+/).slice(0, 2).map(firstLetter).join('').toLocaleUpperCase()
}
