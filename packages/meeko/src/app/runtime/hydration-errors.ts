/**
 * Errores de hidratación: el DOM que el navegador construyó con el HTML del servidor no es el que
 * el componente espera. Llevan la ubicación en la plantilla, el componente hijo si lo hay y, cuando
 * se conocen, el nodo esperado y el encontrado, para que `meeko dev` los muestre en el navegador.
 */

/**
 * Detalle opcional de un {@link HydrationMismatchError}.
 *
 * @example
 * ```ts
 * const detail: HydrationMismatchDetail = { expected: '<div>', found: '<p>' }
 * throw new HydrationMismatchError('Page.meeko:4:12', 'expected <div>, found <p>', detail)
 * ```
 */
export interface HydrationMismatchDetail {
	/** Nodo que la hidratación esperaba (`<div>`, `marcador /meeko:component:0`, un texto…). */
	readonly expected?: string
	/** Nodo que encontró en su lugar. */
	readonly found?: string
	/** Error que lo originó. */
	readonly cause?: unknown
}

/**
 * Fallo de hidratación. Su mensaje empieza por `Hydration mismatch in <ubicación>`, como desde la
 * 1.0; `location` es la ubicación en la plantilla (`Parent.meeko:6:20`), `component` el componente
 * hijo cuya región falló, si es uno, y `expected`/`found` el nodo esperado y el encontrado.
 *
 * @example
 * ```ts
 * try {
 *   hydrate(root, props)
 * } catch (error) {
 *   if (error instanceof HydrationMismatchError) console.error(error.component, error.expected, error.found)
 * }
 * ```
 */
export class HydrationMismatchError extends Error {
	/** Ubicación en la plantilla del `.meeko`, sin el componente (`Parent.meeko:6:20`). */
	readonly location: string
	/** Componente hijo cuya región no coincide (`Child`), si el fallo es de un componente. */
	readonly component?: string
	/** Nodo que la hidratación esperaba. */
	readonly expected?: string
	/** Nodo que encontró en su lugar. */
	readonly found?: string

	constructor(location: string, reason?: string, detail: HydrationMismatchDetail = {}) {
		super(`Hydration mismatch in ${location}${reason ? `: ${reason}` : ''}`, detail.cause === undefined ? undefined : { cause: detail.cause })
		this.name = 'HydrationMismatchError'
		const component = /^(.*) \(component ([^)]+)\)$/.exec(location)
		this.location = component ? component[1]! : location
		if (component) this.component = component[2]!
		const expected = detail.expected ?? nodeDetail(detail.cause, 'expected')
		const found = detail.found ?? nodeDetail(detail.cause, 'found')
		if (expected !== undefined) this.expected = expected
		if (found !== undefined) this.found = found
	}
}

/**
 * Marcador de una región sin su cierre porque el parser HTML movió parte del contenido: lleva el
 * nodo esperado y el encontrado, que {@link HydrationMismatchError} recoge de su `cause`.
 */
export class MisplacedRegionError extends Error {
	readonly expected: string
	readonly found?: string

	constructor(message: string, expected: string, found?: string) {
		super(message)
		this.name = 'MisplacedRegionError'
		this.expected = expected
		if (found !== undefined) this.found = found
	}
}

function nodeDetail(cause: unknown, key: 'expected' | 'found'): string | undefined {
	if (typeof cause !== 'object' || cause === null) return undefined
	const value = (cause as Record<string, unknown>)[key]
	return typeof value === 'string' ? value : undefined
}

/**
 * Elementos cuya etiqueta de apertura cierra un `<p>` abierto (`closes a p element` del estándar):
 * dentro de un `<p>`, el navegador termina el párrafo antes de ellos y saca de él lo que sigue.
 */
const closesParagraph: ReadonlySet<string> = new Set('address article aside blockquote details dialog div dl fieldset figcaption figure footer form h1 h2 h3 h4 h5 h6 header hgroup hr main menu nav ol p pre search section table ul'.split(' '))

/**
 * Error de una región `start` sin marcador de cierre entre sus hermanos. Si la región empieza en un
 * `<p>` seguido de un elemento de bloque, el HTML cerró el párrafo antes de ese elemento (un bloque
 * dentro de contenido de frase, `MEEK139`) y el mensaje lo explica.
 */
export function missingRegionEnd(start: Comment): Error {
	const base = `Missing end marker for ${start.data}`
	const expected = `<!--/${start.data.split(':').slice(0, 3).join(':')}--> inside <${start.parentElement?.localName ?? 'root'}>`
	const parent = start.parentElement
	const next = parent?.localName === 'p' ? parent.nextElementSibling : null
	if (!next || !closesParagraph.has(next.localName)) return new MisplacedRegionError(base, expected)
	return new MisplacedRegionError(`${base}: the HTML parser closed <p> before <${next.localName}>, which cannot go inside a paragraph, and moved the rest of the region out of it. ` + `A block element inside phrasing content (MEEK139 of meeko check): write a <div> instead of the <p>, or make the component render phrasing content (<span>)`, expected, `<${next.localName}> after </p>`)
}

/** Lo que `meeko dev` muestra de un error de hidratación. */
export interface HydrationErrorReport {
	/** Texto de `console.error` y del overlay. */
	readonly message: string
	/** El {@link HydrationMismatchError} de la cadena de causas, si lo hay. */
	readonly mismatch?: HydrationMismatchError
}

/** El primer {@link HydrationMismatchError} de `error` y sus causas. */
function findMismatch(error: unknown): HydrationMismatchError | undefined {
	const seen = new Set<unknown>()
	for (let current = error; current instanceof Error && !seen.has(current); current = current.cause) {
		seen.add(current)
		if (current instanceof HydrationMismatchError) return current
	}
	return undefined
}

/**
 * Describe un error de la hidratación inicial para la consola y el overlay de `meeko dev`: el
 * componente, la ubicación y el nodo esperado y el encontrado, cuando el error los conoce.
 */
export function describeHydrationError(error: unknown): HydrationErrorReport {
	const mismatch = findMismatch(error)
	const text = error instanceof Error ? error.message : String(error)
	if (!mismatch) return { message: `[meeko] The page did not hydrate, so its controls do not respond:\n${text}` }
	const lines = [`[meeko] Hydration mismatch${mismatch.component ? ` in <${mismatch.component}>` : ''} at ${mismatch.location}: the page did not hydrate, so its controls do not respond.`]
	if (mismatch.expected !== undefined) lines.push(`  expected: ${mismatch.expected}`)
	if (mismatch.found !== undefined) lines.push(`  found:    ${mismatch.found}`)
	lines.push(mismatch.message)
	return { message: lines.join('\n'), mismatch }
}

/** Lo que `reportHydrationError` necesita del navegador. */
export interface HydrationErrorHost {
	readonly console: Pick<Console, 'error'>
	readonly document?: Document
	readonly customElements?: CustomElementRegistry
}

/** Constructor del overlay de errores del cliente de Vite (`<vite-error-overlay>`). */
type ViteErrorOverlay = new (error: { message: string; stack: string; id?: string; plugin?: string }, links?: boolean) => HTMLElement

/**
 * Muestra en el navegador, en desarrollo, un error de la hidratación inicial: `console.error` con
 * el componente, la ubicación y el nodo esperado y el encontrado, y el overlay de errores de Vite
 * (`<vite-error-overlay>`) si el cliente de Vite lo registró. La entrada de cliente de `meeko dev`
 * la llama; el build de producción la elimina.
 *
 * @param error Error que lanzó `mountClientApp`.
 * @param host Navegador; por defecto, `globalThis`.
 * @example
 * ```ts
 * try {
 *   await mountClientApp(options)
 * } catch (error) {
 *   if (import.meta.env.DEV) reportHydrationError(error)
 *   else throw error
 * }
 * ```
 */
export function reportHydrationError(error: unknown, host: HydrationErrorHost = globalThis as unknown as HydrationErrorHost): HydrationErrorReport {
	const report = describeHydrationError(error)
	host.console.error(report.message, error)
	const Overlay = host.customElements?.get('vite-error-overlay') as ViteErrorOverlay | undefined
	const body = host.document?.body
	if (Overlay && body) {
		try {
			// One overlay at a time, as Vite does for its own errors.
			for (const previous of body.querySelectorAll('vite-error-overlay')) previous.remove()
			body.appendChild(new Overlay({ message: report.message.replace(/^\[meeko\] /, ''), stack: error instanceof Error ? (error.stack ?? '') : '', plugin: 'meeko', ...(report.mismatch ? { id: report.mismatch.location } : {}) }))
		} catch {
			/* The overlay is a convenience: the console already has the error. */
		}
	}
	return report
}
