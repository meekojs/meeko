/**
 * Archivos de la extensión que VS Code sólo relee al recargar la ventana: el manifiesto, la
 * configuración del lenguaje, la gramática, los snippets y el código compilado en `dist/`.
 * Es relativo a la raíz de la extensión y excluye `node_modules` para que `pnpm install` no recargue.
 */
export const reloadPattern = '{package.json,language-configuration.json,syntaxes/*.json,snippets/*.json,dist/*.js}'

/** Agrupa una ráfaga de eventos en una sola llamada diferida. */
export interface ReloadScheduler {
	/** Cancela la llamada pendiente, si la hay. */
	dispose(): void
	/** Reinicia la espera; `reload` se ejecuta cuando pasan `delay` ms sin otro aviso. */
	schedule(): void
}

/**
 * Crea un temporizador con rebote para recargar una sola vez tras varios cambios seguidos,
 * como los dos archivos que escribe un build de la extensión.
 * @param reload Acción que se ejecuta al terminar la ráfaga.
 * @param delay Milisegundos sin cambios antes de ejecutarla.
 */
export function createReloadScheduler(reload: () => void, delay = 300): ReloadScheduler {
	let timer: ReturnType<typeof setTimeout> | undefined
	let disposed = false
	const cancel = () => {
		if (timer !== undefined) clearTimeout(timer)
		timer = undefined
	}
	return {
		dispose() {
			disposed = true
			cancel()
		},
		schedule() {
			if (disposed) return
			cancel()
			timer = setTimeout(() => {
				timer = undefined
				reload()
			}, delay)
		},
	}
}
