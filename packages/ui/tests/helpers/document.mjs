/**
 * A document for the tests of the scroll lock and of the gutter of the scrollbar: an <html> with inline styles,
 * custom properties, attributes and a width, and the `getComputedStyle`, `innerWidth` and listeners of the window.
 * The inline styles are plain properties, so a test compares them with a spread; the computed ones read them,
 * with the `scrollbar-gutter: stable` of the base when there is no inline one.
 */
export function withDocument(options, run) {
	const { style = {}, innerWidth = 1280, clientWidth = 1265, left = 0, gutter = 'stable', scale, computed = true } = options
	const properties = new Map()
	Object.defineProperties(style, {
		setProperty: { value: (name, value) => properties.set(name, value) },
		getPropertyValue: { value: (name) => properties.get(name) ?? '' },
	})
	const attributes = new Map()
	const root = {
		style,
		clientWidth,
		getAttribute: (name) => attributes.get(name) ?? null,
		setAttribute: (name, value) => attributes.set(name, String(value)),
		// The box of the root: the window without the gutter, after it when it is on the left.
		getBoundingClientRect: () => ({ left, width: root.clientWidth }),
	}
	const listeners = new Map()
	const observers = []
	const globals = {
		document: { documentElement: root },
		innerWidth,
		addEventListener: (type, listener) => listeners.set(type, listener),
		ResizeObserver: class {
			constructor(callback) {
				this.callback = callback
				observers.push(this)
			}
			observe(target) {
				this.target = target
			}
		},
		...(scale === undefined ? {} : { visualViewport: { scale } }),
		...(computed ? { getComputedStyle: (element) => ({ overflowY: element.style.overflow || 'visible', scrollbarGutter: element.style.scrollbarGutter || gutter, marginLeft: '0px', marginRight: '0px' }) } : {}),
	}
	const previous = new Map(Object.keys(globals).map((name) => [name, Object.getOwnPropertyDescriptor(globalThis, name)]))
	for (const [name, value] of Object.entries(globals)) Object.defineProperty(globalThis, name, { value, configurable: true, writable: true })
	try {
		return run({ root, style, properties, attributes, listeners, observers })
	} finally {
		for (const [name, descriptor] of previous) {
			if (descriptor) Object.defineProperty(globalThis, name, descriptor)
			else delete globalThis[name]
		}
	}
}
