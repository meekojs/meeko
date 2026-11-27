/**
 * Espera `work` como mucho `milliseconds`; pasado ese tiempo rechaza con el error de `expired`.
 * `work` sigue su curso: quien llama decide qué hacer con una tarea que ya nadie espera.
 *
 * @param work Tarea que puede no terminar nunca.
 * @param milliseconds Tiempo máximo de espera.
 * @param expired Crea el error del rechazo cuando se agota el tiempo.
 */
export async function withDeadline<T>(work: Promise<T>, milliseconds: number, expired: () => Error): Promise<T> {
	let timer: ReturnType<typeof setTimeout> | undefined
	const deadline = new Promise<never>((_, reject) => {
		timer = setTimeout(() => reject(expired()), milliseconds)
	})
	try {
		return await Promise.race([work, deadline])
	} finally {
		clearTimeout(timer)
	}
}
