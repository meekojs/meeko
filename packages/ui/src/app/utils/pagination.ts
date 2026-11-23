/** Los enteros de `from` a `to`, ambos incluidos. */
const range = (from: number, to: number): number[] => Array.from({ length: Math.max(0, to - from + 1) }, (_, index) => from + index)

/**
 * Los números que muestra `<UIPagination>` en su modo numerado: la primera y la última página, la actual
 * con `siblings` vecinas a cada lado y `null` donde se salta un tramo. Una elipsis nunca oculta una sola
 * página (sale su número), y la lista tiene siempre la misma longitud, `2 * siblings + 5`, cuando hay más
 * páginas que esa cifra: los botones no cambian de sitio al avanzar.
 *
 * @example
 * ```ts
 * paginationItems(5, 10) // [1, null, 4, 5, 6, null, 10]
 * paginationItems(2, 10) // [1, 2, 3, 4, 5, null, 10]
 * ```
 */
export function paginationItems(page: number, count: number, siblings = 1): (number | null)[] {
	const around = Math.max(0, Math.floor(siblings))
	if (count <= 2 * around + 5) return range(1, count)
	const start = Math.max(Math.min(page - around, count - 2 * around - 2), 3)
	const end = Math.min(Math.max(page + around, 2 * around + 3), count - 2)
	return [1, start > 3 ? null : 2, ...range(start, end), end < count - 2 ? null : count - 1, count]
}

/** El número de páginas: `pageCount` o, sin él, `total` entre `pageSize`; nunca menos de una. */
export function paginationCount(pageCount: number | undefined, total: number | undefined, pageSize: number | undefined): number {
	const count = pageCount ?? (total !== undefined && pageSize ? Math.ceil(total / pageSize) : 1)
	return Number.isFinite(count) ? Math.max(1, Math.floor(count)) : 1
}

/** `page` dentro de `1…count`; un valor que no es un número es la primera página. */
export const clampPage = (page: number, count: number): number => (Number.isFinite(page) ? Math.min(Math.max(1, Math.floor(page)), count) : 1)
