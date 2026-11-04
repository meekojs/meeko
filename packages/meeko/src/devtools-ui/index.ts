import type { DevtoolsEvent, DevtoolsHook, DevtoolsInstance, DevtoolsProtocolVersion, DevtoolsReadSite, DevtoolsSnapshot, DevtoolsWriteSite } from '../app/runtime/devtools'

import { meekoMark } from './logo'

/** Versión del protocolo que entiende este panel; el tipo obliga a revisarlo si el protocolo cambia. */
const supportedProtocolVersion: DevtoolsProtocolVersion = 1

/**
 * Opciones de montaje del panel integrado de desarrollo.
 *
 * @example
 * ```ts
 * import type { DevtoolsPanelOptions } from "@meekojs/meeko/devtools-ui";
 *
 * const options: DevtoolsPanelOptions = { container: document.querySelector("#devtools") ?? document.body };
 * ```
 */
export interface DevtoolsPanelOptions {
	/** Elemento que recibirá el host del Shadow DOM. El valor predeterminado es `document.body`. */
	container?: Element
	/**
	 * Esquina de la ventana en la que se fija el panel. El valor predeterminado es `"bottom-right"`.
	 * @since 1.8.0
	 */
	position?: DevtoolsPanelPosition
}

/**
 * Esquina de la ventana en la que se fija el panel integrado: la opción `position` de
 * {@link mountDevtoolsPanel} y de `devtools` en `meeko.config.ts`.
 *
 * @since 1.8.0
 * @example
 * ```ts
 * import type { DevtoolsPanelPosition } from "@meekojs/meeko/devtools-ui";
 *
 * const position: DevtoolsPanelPosition = "bottom-left";
 * ```
 * @see https://github.com/meekojs/meeko/blob/main/docs/devtools.md#panel-dentro-de-la-página
 */
export type DevtoolsPanelPosition = 'bottom-left' | 'bottom-right' | 'top-left' | 'top-right'

/** The positions of the panel; `meeko.config.ts` checks its own copy, without loading this module. */
const panelPositions: readonly DevtoolsPanelPosition[] = ['bottom-right', 'bottom-left', 'top-right', 'top-left']

/**
 * Control del ciclo de vida del panel que devuelve {@link mountDevtoolsPanel}.
 *
 * @example
 * ```ts
 * const panel = mountDevtoolsPanel();
 * import.meta.hot?.dispose(() => panel.unmount());
 * ```
 */
export interface DevtoolsPanel {
	/** Reintenta encontrar el hook y actualiza los datos visibles. */
	refresh(): void
	/** Quita la interfaz y libera las suscripciones y eventos instalados. */
	unmount(): void
}

/*
 * Meeko's tokens (apps/meeko/app/styles/tokens.css), defined inside the shadow root so the page's CSS
 * never reaches them. Dark is the default world; light follows the system or the page's
 * data-theme, which the host mirrors. The pink of Meeko's nose only marks new events.
 */
const styles = `
:host {
  --bg: #101115; --surface: #16181d; --surface-2: #1d2026; --ink: #eef0f3; --ink-soft: #c5c9d0; --muted: #8b909a;
  --line: rgb(255 255 255 / 0.08); --line-strong: rgb(255 255 255 / 0.14);
  --accent: #8fb4ff; --accent-ink: #a6c3ff; --accent-soft: rgb(143 180 255 / 0.12); --accent-line: rgb(143 180 255 / 0.34); --on-accent: #0a0b0d;
  --badge: #f4a3b1; --on-badge: #0a0b0d; --code-bg: #0e0f12; --success: #8fd6ae; --danger: #f0b46a; --selection: rgb(143 180 255 / 0.28);
  --shadow: 0 24px 64px -24px rgb(0 0 0 / 0.8), 0 2px 8px -2px rgb(0 0 0 / 0.5);
  --font-ui: "Inter Variable", Inter, system-ui, -apple-system, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif;
  --font-mono: ui-monospace, "SF Mono", "Cascadia Code", "JetBrains Mono", Menlo, Consolas, "Liberation Mono", monospace;
  --ease-out: cubic-bezier(0.16, 1, 0.3, 1);
  all: initial; position: fixed; z-index: 2147483647; right: 16px; bottom: 16px; width: min(680px, calc(100vw - 32px));
  color: var(--ink); font: 13px/1.45 var(--font-ui); font-feature-settings: "cv11", "ss03", "tnum"; color-scheme: dark;
}
@media (prefers-color-scheme: light) {
  :host(:not([data-theme="dark"])) {
    --bg: #ffffff; --surface: #f4f5f7; --surface-2: #eceef1; --ink: #0d0e10; --ink-soft: #33373e; --muted: #5f636c;
    --line: rgb(0 0 0 / 0.08); --line-strong: rgb(0 0 0 / 0.14);
    --accent: #2f63d6; --accent-ink: #2556c4; --accent-soft: rgb(47 99 214 / 0.09); --accent-line: rgb(47 99 214 / 0.32); --on-accent: #ffffff;
    --badge: #b8365a; --on-badge: #ffffff; --code-bg: #f6f7f9; --success: #23794c; --danger: #9a5a0c; --selection: rgb(47 99 214 / 0.18);
    --shadow: 0 24px 64px -28px rgb(13 14 16 / 0.28), 0 2px 8px -2px rgb(13 14 16 / 0.08);
    color-scheme: light;
  }
}
:host([data-theme="light"]) {
  --bg: #ffffff; --surface: #f4f5f7; --surface-2: #eceef1; --ink: #0d0e10; --ink-soft: #33373e; --muted: #5f636c;
  --line: rgb(0 0 0 / 0.08); --line-strong: rgb(0 0 0 / 0.14);
  --accent: #2f63d6; --accent-ink: #2556c4; --accent-soft: rgb(47 99 214 / 0.09); --accent-line: rgb(47 99 214 / 0.32); --on-accent: #ffffff;
  --badge: #b8365a; --on-badge: #ffffff; --code-bg: #f6f7f9; --success: #23794c; --danger: #9a5a0c; --selection: rgb(47 99 214 / 0.18);
  --shadow: 0 24px 64px -28px rgb(13 14 16 / 0.28), 0 2px 8px -2px rgb(13 14 16 / 0.08);
  color-scheme: light;
}
:host([data-position="bottom-left"]) { right: auto; left: 16px; }
:host([data-position="top-right"]) { bottom: auto; top: 16px; }
:host([data-position="top-left"]) { right: auto; bottom: auto; left: 16px; top: 16px; }
:host([data-minimized]) { width: auto; }
:host([data-dragging]) { transition: none; cursor: grabbing; }
* { box-sizing: border-box; }
::selection { background: var(--selection); color: var(--ink); }
[hidden] { display: none !important; }
.panel { display: flex; flex-direction: column; max-height: min(560px, calc(100vh - 32px)); overflow: hidden; border: 1px solid var(--line-strong); border-radius: 14px; background: var(--bg); box-shadow: var(--shadow); transform-origin: bottom right; animation: open 220ms var(--ease-out); }
:host([data-position="bottom-left"]) .panel { transform-origin: bottom left; }
:host([data-position="top-right"]) .panel { transform-origin: top right; }
:host([data-position="top-left"]) .panel { transform-origin: top left; }
@keyframes open { from { opacity: 0; transform: scale(0.96) translateY(4px); filter: blur(2px); } }
header { display: flex; align-items: center; gap: 4px; padding: 8px 8px 8px 10px; border-bottom: 1px solid var(--line); background: var(--surface); }
.brand { display: flex; align-items: center; gap: 8px; margin-right: auto; min-width: 0; }
.brand img { width: 22px; height: 22px; border-radius: 50%; flex: none; }
header strong { font-size: 13px; font-weight: 560; letter-spacing: -0.01em; white-space: nowrap; }
.icon-button { display: inline-grid; place-items: center; width: 28px; height: 28px; padding: 0; border: 1px solid transparent; border-radius: 7px; background: transparent; color: var(--muted); }
.icon-button:hover { background: var(--surface-2); color: var(--ink); border-color: transparent; }
.icon-button svg { width: 16px; height: 16px; fill: none; stroke: currentColor; stroke-width: 1.6; stroke-linecap: round; stroke-linejoin: round; }
.handle { cursor: grab; touch-action: none; }
.handle:active { cursor: grabbing; }
.mobile-switch { display: none; gap: 6px; padding: 8px 12px; border-bottom: 1px solid var(--line); }
.mobile-switch button { flex: 1; }
.content { display: grid; grid-template-columns: minmax(170px, 0.9fr) minmax(0, 1.6fr); min-height: 220px; overflow: auto; }
section { min-width: 0; padding: 12px; }
section + section { border-left: 1px solid var(--line); }
h2, h3 { margin: 0 0 8px; font-size: 12px; font-weight: 600; letter-spacing: -0.005em; color: var(--ink); }
h3 { margin-top: 14px; color: var(--ink-soft); }
p { margin: 0 0 8px; color: var(--muted); }
ul, ol { margin: 0; padding: 0; list-style: none; }
li + li { margin-top: 4px; }
button { appearance: none; border: 1px solid var(--line-strong); border-radius: 7px; background: var(--surface); color: var(--ink); padding: 5px 9px; font: inherit; font-weight: 500; cursor: pointer; transition: background-color 120ms, border-color 120ms, color 120ms; }
button:hover { background: var(--surface-2); border-color: var(--accent-line); }
button:focus-visible, input:focus-visible, select:focus-visible, textarea:focus-visible, summary:focus-visible { outline: 2px solid var(--accent); outline-offset: 2px; }
button[aria-pressed="true"] { border-color: var(--accent-line); background: var(--accent-soft); color: var(--accent-ink); }
input[type="checkbox"] { accent-color: var(--accent); margin: 0 4px 0 0; vertical-align: -2px; }
.tree-node { margin: 2px 0; }
.tree-node > button { width: 100%; text-align: left; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; border-color: transparent; background: transparent; }
.tree-node > button:hover { background: var(--surface); border-color: var(--line); }
.tree-node > button[aria-pressed="true"] { border-color: var(--accent-line); background: var(--accent-soft); color: var(--accent-ink); }
.tree-children { margin: 2px 0 4px 10px; padding-left: 10px; border-left: 1px solid var(--line-strong); }
.actions { display: flex; flex-wrap: wrap; gap: 6px; margin: 8px 0; }
.muted { color: var(--muted); }
.path { overflow-wrap: anywhere; font: 12px/1.45 var(--font-mono); }
pre { margin: 4px 0 0; padding: 8px 10px; max-height: 130px; overflow: auto; border: 1px solid var(--line); border-radius: 8px; background: var(--code-bg); color: var(--ink-soft); font: 12px/1.5 var(--font-mono); white-space: pre-wrap; overflow-wrap: anywhere; }
.events { border-top: 1px solid var(--line); padding: 10px 12px; max-height: 160px; overflow: auto; }
.events-head { display: flex; flex-wrap: wrap; align-items: center; justify-content: space-between; gap: 6px 12px; }
.events-head h2 { margin: 0 auto 0 0; }
.events-head label { color: var(--muted); }
.events ol { margin-top: 8px; }
.event-button { width: 100%; text-align: left; border-color: transparent; background: transparent; padding: 3px 6px; font-weight: 400; color: var(--ink-soft); }
.event-button:hover { background: var(--surface); border-color: var(--line); color: var(--ink); }
.event-reads { margin: 4px 0 8px 6px; color: var(--muted); }
.event-reads summary { cursor: pointer; border-radius: 4px; }
.event-reads li { overflow-wrap: anywhere; }
code { font: 12px/1.45 var(--font-mono); color: var(--ink-soft); }
.events li { overflow-wrap: anywhere; }
.event-write { margin: 2px 0 0 6px; color: var(--muted); overflow-wrap: anywhere; }
.editor { display: grid; gap: 6px; margin-top: 14px; padding-top: 12px; border-top: 1px solid var(--line); }
.editor h3 { margin-top: 0; }
.editor label { color: var(--muted); }
.editor select, .editor textarea { width: 100%; border: 1px solid var(--line-strong); border-radius: 7px; background: var(--code-bg); color: var(--ink); font: 12px/1.45 var(--font-mono); padding: 6px 8px; }
.editor textarea { min-height: 72px; resize: vertical; caret-color: var(--accent); }
.editor button[type="submit"] { justify-self: start; border-color: var(--accent); background: var(--accent); color: var(--on-accent); }
.editor button[type="submit"]:hover { border-color: var(--accent-ink); background: var(--accent-ink); }
.editor-message { margin: 0; min-height: 1.45em; }
.editor-message[data-state="error"] { color: var(--danger); }
.editor-message[data-state="ok"] { color: var(--success); }
.status { padding: 7px 12px; border-top: 1px solid var(--line); color: var(--muted); font-size: 12px; }
.pill { display: inline-flex; align-items: center; gap: 8px; padding: 4px 12px 4px 4px; border: 1px solid var(--line-strong); border-radius: 999px; background: var(--bg); color: var(--ink); box-shadow: var(--shadow); font-weight: 560; touch-action: none; }
.pill:hover { background: var(--surface); border-color: var(--accent-line); }
.pill img { width: 26px; height: 26px; border-radius: 50%; }
.badge { min-width: 20px; padding: 1px 6px; border-radius: 999px; background: var(--badge); color: var(--on-badge); font-size: 11px; font-weight: 650; text-align: center; font-variant-numeric: tabular-nums; }
.badge:empty { display: none; }
* { scrollbar-width: thin; scrollbar-color: var(--line-strong) transparent; }
@media (prefers-reduced-motion: reduce) { .panel { animation: none; } button { transition: none; } }
@media (max-width: 540px) {
  .mobile-switch { display: flex; }
  .content { display: block; min-height: 0; }
  .content[data-view="instances"] .detail { display: none; }
  .content[data-view="detail"] .instances { display: none; }
  section + section { border-left: 0; }
}
`

/** Formatea datos arbitrarios sin insertar HTML procedente de la aplicación. */
function formatValue(value: unknown): string {
	const seen = new WeakSet<object>()
	try {
		const result = JSON.stringify(
			value,
			(_key, current: unknown) => {
				if (typeof current === 'bigint') return `${current}n`
				if (typeof current === 'function') return '[función]'
				if (typeof current === 'symbol') return String(current)
				if (typeof current === 'object' && current !== null) {
					if (seen.has(current)) return '[circular]'
					seen.add(current)
				}
				return current
			},
			2,
		)
		return (result ?? String(value)).slice(0, 8000)
	} catch {
		return '[valor no representable]'
	}
}

/** Crea un elemento con texto seguro y una clase opcional. */
function element<K extends keyof HTMLElementTagNameMap>(document: Document, tag: K, text?: string, className?: string): HTMLElementTagNameMap[K] {
	const node = document.createElement(tag)
	if (text !== undefined) node.textContent = text
	if (className) node.className = className
	return node
}

/** Muestra el momento relativo comunicado por el runtime. */
function eventLabel(event: DevtoolsEvent): string {
	const kinds: Record<DevtoolsEvent['kind'], string> = {
		mount: 'Montaje',
		unmount: 'Desmontaje',
		signal: 'Señal',
		breakpoint: 'Punto de parada',
		select: 'Selección',
		hmr: 'HMR',
		navigation: 'Navegación',
		data: 'Datos',
	}
	const time = Number.isFinite(event.at) ? new Date(event.at).toLocaleTimeString('es', { hour12: false }) : 'hora desconocida'
	const detail = event.detail ? ` · ${event.detail}` : ''
	const source = event.componentName ? ` · ${event.componentName}` : ''
	const file = event.file ? ` · ${event.file}` : ''
	const value = event.kind === 'signal' && 'value' in event ? ` → ${formatValue(event.value).replace(/\s+/g, ' ').slice(0, 240)}` : ''
	return `${time} · ${kinds[event.kind]} · ${event.instanceId}${source}${file}${detail}${value}`
}

const readKinds: Record<DevtoolsReadSite['kind'], string> = {
	text: 'texto',
	attribute: 'atributo',
	computed: 'computed',
	if: 'if:when',
	each: 'each:of',
	prop: 'prop',
}

/** Describe la construcción que lee la señal, incluida la prop concreta de un hijo. */
function readKindLabel(read: DevtoolsReadSite): string {
	return read.kind === 'prop' && read.name ? `prop ${read.name}` : (readKinds[read.kind] ?? read.kind)
}

/** Texto del origen de una escritura conocida. */
function writeLabel(write: DevtoolsWriteSite): string {
	return write.kind === 'devtools' ? 'Escrita desde DevTools' : `Escrita en ${write.file}:${write.line}:${write.column}`
}

/** Mensaje para un hook o captura con una versión de protocolo distinta de la admitida. */
function protocolMismatch(version: unknown): string | undefined {
	if (version === supportedProtocolVersion) return undefined
	if (version === undefined) return `El runtime de la página no declara versión de protocolo (Meeko anterior a 1.0). Este panel admite la versión ${supportedProtocolVersion}; actualiza @meekojs/meeko.`
	return `Versión de protocolo DevTools no compatible: la página usa ${typeof version === 'number' ? version : JSON.stringify(version)} y este panel admite ${supportedProtocolVersion}. Usa el mismo @meekojs/meeko para el panel y la aplicación.`
}

/** The shortcut that folds and restores the panel, as the labels show it. */
const shortcutLabel = 'Alt+Mayús+M'

/** `localStorage` key of the panel's state in the page's origin. */
const panelStateKey = 'meeko:devtools-panel'

/** What the panel remembers between reloads: folded or not, and the corner chosen for a configured one. */
interface PanelState {
	readonly minimized?: boolean
	readonly position?: DevtoolsPanelPosition
	readonly configured?: DevtoolsPanelPosition
}

/** The saved state, or `{}` when storage is blocked, empty or holds something else. */
function readPanelState(view: Window): PanelState {
	try {
		const value: unknown = JSON.parse(view.localStorage.getItem(panelStateKey) ?? '{}')
		return value && typeof value === 'object' && !Array.isArray(value) ? (value as PanelState) : {}
	} catch {
		return {}
	}
}

/** Saves the state; a blocked or full storage only loses the memory, never the panel. */
function writePanelState(view: Window, state: PanelState): void {
	try {
		view.localStorage.setItem(panelStateKey, JSON.stringify(state))
	} catch {
		/* Private mode or a sandboxed frame: nothing to remember. */
	}
}

/** A square button with a 16 px stroke icon and its accessible name (also its tooltip). */
function iconButton(document: Document, path: string, label: string, className = ''): HTMLButtonElement {
	const button = element(document, 'button', undefined, `icon-button ${className}`.trim())
	button.type = 'button'
	if (label) {
		button.setAttribute('aria-label', label)
		button.title = label
	}
	const namespace = 'http://www.w3.org/2000/svg'
	const svg = document.createElementNS(namespace, 'svg')
	svg.setAttribute('viewBox', '0 0 16 16')
	svg.setAttribute('aria-hidden', 'true')
	const shape = document.createElementNS(namespace, 'path')
	shape.setAttribute('d', path)
	svg.append(shape)
	button.append(svg)
	return button
}

/** Exige un documento conectado a una ventana para registrar eventos del hook. */
function requireView(document: Document): Window {
	const view = document.defaultView
	if (!view) throw new Error('Meeko DevTools requires a browser document')
	return view
}

/**
 * Monta el panel de Meeko DevTools en la página, aislado en Shadow DOM: árbol de instancias, props y
 * señales editables, línea de tiempo, resaltado del DOM y puntos de parada. Lee el hook
 * `window.__MEEKO_DEVTOOLS__`, que sólo existe en desarrollo; sin él, el panel lo indica y
 * `refresh()` lo vuelve a buscar.
 *
 * Desde `1.8`, `devtools: true` en `meeko.config.ts` lo monta en `meeko dev` sin este código. El
 * panel usa los colores de Meeko en tema claro u oscuro (el del sistema o `data-theme` de `<html>`),
 * se minimiza a una pastilla con el número de eventos nuevos (botón o `Alt+Mayús+M`) y se mueve a
 * otra esquina arrastrando su asa o con las flechas; recuerda ambas cosas en `localStorage`.
 *
 * @param options Contenedor del panel y, desde `1.8`, su esquina (`position`).
 * @returns El control del panel.
 * @throws {Error} Si el contenedor no pertenece a un documento de navegador.
 * @throws {TypeError} Si `position` no es una de las cuatro esquinas.
 * @example
 * ```ts
 * if (import.meta.env.DEV) {
 *   const { mountDevtoolsPanel } = await import("@meekojs/meeko/devtools-ui");
 *   const panel = mountDevtoolsPanel();
 *   // panel.unmount() libera la interfaz cuando deje de usarse.
 * }
 * ```
 * @see https://github.com/meekojs/meeko/blob/main/docs/devtools.md#panel-dentro-de-la-página
 */
export function mountDevtoolsPanel(options: DevtoolsPanelOptions = {}): DevtoolsPanel {
	const position = options.position ?? 'bottom-right'
	if (!panelPositions.includes(position)) throw new TypeError(`Meeko DevTools: position must be one of ${panelPositions.join(', ')}`)
	const container = options.container ?? document.body
	const ownerDocument = container.ownerDocument
	const view = requireView(ownerDocument)

	const saved = readPanelState(view)
	// A corner the developer chose survives reloads while the configured one stays the same.
	let corner: DevtoolsPanelPosition = saved.configured === position && saved.position && panelPositions.includes(saved.position) ? saved.position : position
	let minimized = saved.minimized === true
	const host = element(ownerDocument, 'div')
	host.setAttribute('data-meeko-devtools-panel', '')
	host.setAttribute('data-position', corner)
	const shadow = host.attachShadow({ mode: 'open' })
	const style = element(ownerDocument, 'style', styles)
	const panel = element(ownerDocument, 'div', undefined, 'panel')
	panel.id = 'meeko-devtools-panel'
	panel.setAttribute('role', 'region')
	panel.setAttribute('aria-label', 'Meeko DevTools')
	const header = element(ownerDocument, 'header')
	const brand = element(ownerDocument, 'div', undefined, 'brand')
	const logo = element(ownerDocument, 'img')
	logo.src = meekoMark
	logo.alt = ''
	const title = element(ownerDocument, 'strong', 'Meeko DevTools')
	brand.append(logo, title)
	const handle = iconButton(ownerDocument, 'M5.5 3.5h.01M10.5 3.5h.01M5.5 8h.01M10.5 8h.01M5.5 12.5h.01M10.5 12.5h.01', '', 'handle')
	handle.querySelector('svg')!.style.strokeWidth = '2.6'
	const refreshButton = iconButton(ownerDocument, 'M13 2.8v3.4H9.6M12.7 6A5 5 0 1 0 13 9.4', 'Actualizar instancias de Meeko')
	const minimizeButton = iconButton(ownerDocument, 'M4 8.5h8', `Minimizar Meeko DevTools (${shortcutLabel})`)
	minimizeButton.setAttribute('aria-controls', panel.id)
	minimizeButton.setAttribute('aria-keyshortcuts', 'Alt+Shift+M')
	const closeButton = iconButton(ownerDocument, 'M4.5 4.5l7 7M11.5 4.5l-7 7', 'Cerrar Meeko DevTools')
	header.append(brand, handle, refreshButton, minimizeButton, closeButton)

	const pill = element(ownerDocument, 'button', undefined, 'pill')
	pill.type = 'button'
	pill.setAttribute('aria-controls', panel.id)
	pill.setAttribute('aria-expanded', 'false')
	pill.setAttribute('aria-keyshortcuts', 'Alt+Shift+M')
	const pillLogo = element(ownerDocument, 'img')
	pillLogo.src = meekoMark
	pillLogo.alt = ''
	const badge = element(ownerDocument, 'span', '', 'badge')
	badge.setAttribute('aria-hidden', 'true')
	pill.append(pillLogo, element(ownerDocument, 'span', 'Meeko'), badge)

	const mobileSwitch = element(ownerDocument, 'nav', undefined, 'mobile-switch')
	mobileSwitch.setAttribute('aria-label', 'Vistas de Meeko DevTools')
	const instancesButton = element(ownerDocument, 'button', 'Instancias')
	instancesButton.type = 'button'
	instancesButton.setAttribute('aria-controls', 'meeko-devtools-instances')
	const detailButton = element(ownerDocument, 'button', 'Detalle')
	detailButton.type = 'button'
	detailButton.setAttribute('aria-controls', 'meeko-devtools-detail')
	mobileSwitch.append(instancesButton, detailButton)

	const main = element(ownerDocument, 'div', undefined, 'content')
	const instancesSection = element(ownerDocument, 'section', undefined, 'instances')
	instancesSection.id = 'meeko-devtools-instances'
	const instancesTitle = element(ownerDocument, 'h2', 'Instancias')
	const instancesList = element(ownerDocument, 'ul')
	instancesList.setAttribute('aria-label', 'Instancias de Meeko')
	instancesSection.append(instancesTitle, instancesList)
	const detailSection = element(ownerDocument, 'section', undefined, 'detail')
	detailSection.id = 'meeko-devtools-detail'
	detailSection.setAttribute('aria-label', 'Detalle de instancia')
	main.append(instancesSection, detailSection)

	const eventsSection = element(ownerDocument, 'section', undefined, 'events')
	const eventsTitle = element(ownerDocument, 'h2', 'Eventos recientes')
	const eventsHead = element(ownerDocument, 'div', undefined, 'events-head')
	const signalFilterLabel = element(ownerDocument, 'label', ' Sólo señales')
	const signalFilter = element(ownerDocument, 'input')
	signalFilter.type = 'checkbox'
	signalFilter.setAttribute('aria-label', 'Mostrar sólo eventos de señales')
	signalFilterLabel.prepend(signalFilter)
	eventsHead.append(eventsTitle, signalFilterLabel)
	const activityFilterLabel = element(ownerDocument, 'label', ' Navegación y datos')
	const activityFilter = element(ownerDocument, 'input')
	activityFilter.type = 'checkbox'
	activityFilter.setAttribute('aria-label', 'Mostrar sólo navegación y datos')
	activityFilterLabel.prepend(activityFilter)
	eventsHead.append(activityFilterLabel)
	const eventsList = element(ownerDocument, 'ol')
	eventsList.setAttribute('aria-label', 'Eventos recientes de Meeko')
	eventsSection.append(eventsHead, eventsList)
	const status = element(ownerDocument, 'div', undefined, 'status')
	status.setAttribute('role', 'status')
	status.setAttribute('aria-live', 'polite')
	panel.append(header, mobileSwitch, main, eventsSection, status)
	shadow.append(style, panel, pill)
	container.appendChild(host)

	let hook: DevtoolsHook | undefined
	let unsubscribe: (() => void) | undefined
	let highlightedId: string | null = null
	let mounted = true
	let mobileView: 'instances' | 'detail' = 'instances'
	/** Estado del editor de señales; sobrevive a las reconstrucciones provocadas por cada notificación. */
	const editor: { instanceId: string; name: string; text: string; dirty: boolean; message: string; state: '' | 'ok' | 'error' } = {
		instanceId: '',
		name: '',
		text: '',
		dirty: false,
		message: '',
		state: '',
	}
	/** Id of the newest event seen with the panel open; the pill counts the ones after it. */
	let seenEventId = -1

	function persist(): void {
		writePanelState(view, { minimized, position: corner, configured: position })
	}

	/** Mirrors `data-theme="light" | "dark"` of the page's `<html>`; other values follow the system. */
	function syncTheme(): void {
		const theme = ownerDocument.documentElement.getAttribute('data-theme')
		if (theme === 'light' || theme === 'dark') host.setAttribute('data-theme', theme)
		else host.removeAttribute('data-theme')
	}
	const Observer = (view as Window & { MutationObserver?: typeof MutationObserver }).MutationObserver
	const themeObserver = typeof Observer === 'function' ? new Observer(syncTheme) : undefined
	themeObserver?.observe(ownerDocument.documentElement, { attributes: true, attributeFilter: ['data-theme'] })
	syncTheme()

	const cornerNames: Record<DevtoolsPanelPosition, string> = {
		'bottom-right': 'abajo a la derecha',
		'bottom-left': 'abajo a la izquierda',
		'top-right': 'arriba a la derecha',
		'top-left': 'arriba a la izquierda',
	}
	function setCorner(next: DevtoolsPanelPosition): void {
		corner = next
		host.setAttribute('data-position', next)
		handle.setAttribute('aria-label', `Mover el panel (ahora ${cornerNames[next]}): arrastra o usa las flechas`)
		handle.title = 'Mover el panel: arrastra o usa las flechas'
		persist()
	}

	/** Events after {@link seenEventId}, or 0 without a readable hook. */
	function newEvents(): number {
		if (!hook || protocolMismatch(hook.protocolVersion)) return 0
		try {
			const { events } = hook.snapshot()
			// Folded since the page loaded: what came before the panel connected is not new.
			if (seenEventId < 0) for (const event of events) seenEventId = Math.max(seenEventId, event.id)
			return events.filter((event) => event.id > seenEventId).length
		} catch {
			return 0
		}
	}

	function updatePill(): void {
		const count = newEvents()
		badge.textContent = count === 0 ? '' : count > 99 ? '99+' : String(count)
		pill.setAttribute('aria-label', `Restaurar Meeko DevTools${count ? ` · ${count === 1 ? '1 evento nuevo' : `${count} eventos nuevos`}` : ''} (${shortcutLabel})`)
		pill.title = `Restaurar (${shortcutLabel})`
	}

	/** Folds the panel into the pill, or opens it again; focus follows when it was inside. */
	function setMinimized(next: boolean, moveFocus: boolean): void {
		minimized = next
		host.toggleAttribute('data-minimized', next)
		panel.hidden = next
		pill.hidden = !next
		minimizeButton.setAttribute('aria-expanded', String(!next))
		persist()
		render()
		if (moveFocus) (next ? pill : minimizeButton).focus()
	}

	function onShortcut(event: KeyboardEvent): void {
		if (!event.altKey || !event.shiftKey || event.ctrlKey || event.metaKey || event.code !== 'KeyM') return
		event.preventDefault()
		const inside = shadow.activeElement !== null
		setMinimized(!minimized, inside || minimized)
	}

	// Drag the handle or the pill and drop it near a corner; a short press on the pill is a click.
	let drag: { readonly id: number; readonly x: number; readonly y: number; moved: boolean } | undefined
	let suppressClick = false
	function startDrag(event: PointerEvent): void {
		if (event.button !== 0) return
		drag = { id: event.pointerId, x: event.clientX, y: event.clientY, moved: false }
		;(event.currentTarget as Element).setPointerCapture?.(event.pointerId)
	}
	function moveDrag(event: PointerEvent): void {
		if (!drag || event.pointerId !== drag.id) return
		const dx = event.clientX - drag.x
		const dy = event.clientY - drag.y
		if (!drag.moved && Math.hypot(dx, dy) < 4) return
		drag.moved = true
		host.setAttribute('data-dragging', '')
		host.style.translate = `${dx}px ${dy}px`
	}
	function endDrag(event: PointerEvent): void {
		if (!drag || event.pointerId !== drag.id) return
		const moved = drag.moved
		drag = undefined
		host.removeAttribute('data-dragging')
		host.style.translate = ''
		if (!moved) return
		suppressClick = true
		const top = event.clientY < view.innerHeight / 2
		const left = event.clientX < view.innerWidth / 2
		setCorner(`${top ? 'top' : 'bottom'}-${left ? 'left' : 'right'}`)
	}
	for (const target of [handle, pill]) {
		target.addEventListener('pointerdown', startDrag)
		target.addEventListener('pointermove', moveDrag)
		target.addEventListener('pointerup', endDrag)
		target.addEventListener('pointercancel', endDrag)
	}
	handle.addEventListener('keydown', (event) => {
		const [vertical, horizontal] = corner.split('-') as ['bottom' | 'top', 'left' | 'right']
		const next = event.key === 'ArrowUp' ? `top-${horizontal}` : event.key === 'ArrowDown' ? `bottom-${horizontal}` : event.key === 'ArrowLeft' ? `${vertical}-left` : event.key === 'ArrowRight' ? `${vertical}-right` : undefined
		if (!next) return
		event.preventDefault()
		setCorner(next as DevtoolsPanelPosition)
	})
	pill.addEventListener('click', () => {
		if (suppressClick) {
			suppressClick = false
			return
		}
		setMinimized(false, true)
	})
	minimizeButton.addEventListener('click', () => setMinimized(true, true))
	view.addEventListener('keydown', onShortcut)
	setCorner(corner)
	host.toggleAttribute('data-minimized', minimized)
	panel.hidden = minimized
	pill.hidden = !minimized
	minimizeButton.setAttribute('aria-expanded', String(!minimized))

	/** Valida el JSON escrito y lo envía al runtime; los errores se muestran junto al editor. */
	function applyEdit(instanceId: string): void {
		let value: unknown
		try {
			value = JSON.parse(editor.text)
		} catch (error) {
			editor.message = `JSON no válido: ${error instanceof Error ? error.message : String(error)}`
			editor.state = 'error'
			render()
			return
		}
		let result: ReturnType<DevtoolsHook['setSignal']>
		try {
			result = typeof hook?.setSignal === 'function' ? hook.setSignal(instanceId, editor.name, value as Parameters<DevtoolsHook['setSignal']>[2]) : { ok: false, error: 'el runtime de la página no permite editar señales' }
		} catch (error) {
			result = { ok: false, error: error instanceof Error ? error.message : String(error) }
		}
		if (result.ok) {
			editor.dirty = false
			editor.message = `Señal ${editor.name} actualizada.`
			editor.state = 'ok'
		} else {
			editor.message = `No se pudo editar ${editor.name}: ${result.error}`
			editor.state = 'error'
		}
		render()
	}

	/** Cambia la vista móvil y comunica el botón activo a tecnologías de asistencia. */
	function showMobileView(next: 'instances' | 'detail'): void {
		mobileView = next
		main.dataset.view = mobileView
		instancesButton.setAttribute('aria-pressed', String(mobileView === 'instances'))
		detailButton.setAttribute('aria-pressed', String(mobileView === 'detail'))
	}

	showMobileView(mobileView)
	instancesButton.addEventListener('click', () => showMobileView('instances'))
	detailButton.addEventListener('click', () => showMobileView('detail'))

	/** Conserva el foco y la selección de texto al reconstruir el panel después de una notificación. */
	function restoreFocus(id: string | undefined, action: string | undefined, selection: [number, number] | undefined): void {
		if (!id || !action) return
		for (const control of shadow.querySelectorAll<HTMLElement>('[data-instance-id][data-action]')) {
			if (control.dataset.instanceId === id && control.dataset.action === action) {
				control.focus()
				if (selection && control.tagName === 'TEXTAREA') (control as HTMLTextAreaElement).setSelectionRange(...selection)
				break
			}
		}
	}

	/** Muestra un estado sin datos en las tres zonas del panel. */
	function renderUnavailable(message: string, detail: string): void {
		status.textContent = message
		instancesList.append(element(ownerDocument, 'li', 'No hay instancias disponibles.', 'muted'))
		detailSection.append(element(ownerDocument, 'p', detail))
		eventsList.append(element(ownerDocument, 'li', 'Sin eventos.', 'muted'))
	}

	/** Reconstruye sólo el contenido variable usando nodos de texto seguros. */
	function render(): void {
		if (!mounted) return
		// Folded, the panel only keeps the pill's count up to date.
		if (minimized) {
			updatePill()
			return
		}
		const active = shadow.activeElement as HTMLElement | null
		const focusId = active?.dataset.instanceId
		const focusAction = active?.dataset.action
		const focusSelection: [number, number] | undefined = active?.tagName === 'TEXTAREA' ? [(active as HTMLTextAreaElement).selectionStart, (active as HTMLTextAreaElement).selectionEnd] : undefined
		instancesList.replaceChildren()
		detailSection.replaceChildren()
		eventsList.replaceChildren()
		if (!hook) {
			renderUnavailable('Hook no disponible. Abre una página Meeko con Vite en desarrollo y pulsa Actualizar.', 'El runtime de desarrollo aún no está conectado.')
			return
		}
		const hookMismatch = protocolMismatch(hook.protocolVersion)
		if (hookMismatch) {
			renderUnavailable(hookMismatch, 'El panel no lee datos de un protocolo que no conoce.')
			return
		}

		let snapshot: DevtoolsSnapshot
		try {
			snapshot = hook.snapshot()
		} catch (error) {
			status.textContent = `No se pudo leer el hook: ${error instanceof Error ? error.message : String(error)}`
			return
		}
		const snapshotMismatch = protocolMismatch(snapshot.protocolVersion)
		if (snapshotMismatch) {
			renderUnavailable(snapshotMismatch, 'El panel no lee datos de un protocolo que no conoce.')
			return
		}
		for (const event of snapshot.events) if (event.id > seenEventId) seenEventId = event.id
		status.textContent = `${snapshot.instances.length} instancia(s) · ${snapshot.events.length} evento(s)`
		if (snapshot.instances.length === 0) instancesList.append(element(ownerDocument, 'li', 'No hay componentes hidratados.', 'muted'))
		const byId = new Map(snapshot.instances.map((instance) => [instance.id, instance]))
		const rendered = new Set<string>()
		function appendInstance(instance: DevtoolsInstance, list: HTMLUListElement): void {
			if (rendered.has(instance.id)) return
			rendered.add(instance.id)
			const row = element(ownerDocument, 'li', undefined, 'tree-node')
			const selectButton = element(ownerDocument, 'button', instance.name || instance.componentId)
			selectButton.type = 'button'
			selectButton.title = `${instance.name} · ${instance.file}`
			selectButton.setAttribute('aria-label', `Seleccionar ${instance.name || instance.componentId}`)
			selectButton.dataset.instanceId = instance.id
			selectButton.dataset.action = 'select'
			selectButton.setAttribute('aria-pressed', String(snapshot.selectedId === instance.id))
			selectButton.addEventListener('click', () => {
				hook?.select(instance.id)
				showMobileView('detail')
				render()
				if (view.matchMedia('(max-width: 540px)').matches) detailButton.focus()
			})
			row.append(selectButton)
			list.append(row)
			const children = instance.childIds.map((id) => byId.get(id)).filter((child): child is DevtoolsInstance => child !== undefined)
			if (children.length > 0) {
				const nested = element(ownerDocument, 'ul', undefined, 'tree-children')
				for (const child of children) appendInstance(child, nested)
				if (nested.childElementCount > 0) row.append(nested)
			}
		}
		for (const instance of snapshot.instances) if (!instance.parentId || !byId.has(instance.parentId)) appendInstance(instance, instancesList)
		for (const instance of snapshot.instances) appendInstance(instance, instancesList)

		const selected = snapshot.instances.find((instance: DevtoolsInstance) => instance.id === snapshot.selectedId)
		if (selected) {
			detailSection.append(element(ownerDocument, 'h2', selected.name || selected.componentId))
			detailSection.append(element(ownerDocument, 'p', selected.file, 'path'))
			detailSection.append(element(ownerDocument, 'p', `ID: ${selected.id} · Estado: ${selected.status === 'hydrated' ? 'Hidratado' : selected.status} · Padre: ${selected.parentId ?? 'ninguno'} · Hijos: ${selected.childIds.length}`))
			const actions = element(ownerDocument, 'div', undefined, 'actions')
			const highlightButton = element(ownerDocument, 'button', highlightedId === selected.id ? 'Quitar resaltado' : 'Resaltar en página')
			highlightButton.type = 'button'
			highlightButton.setAttribute('aria-pressed', String(highlightedId === selected.id))
			highlightButton.dataset.instanceId = selected.id
			highlightButton.dataset.action = 'highlight'
			highlightButton.addEventListener('click', () => {
				highlightedId = highlightedId === selected.id ? null : selected.id
				hook?.highlight(highlightedId)
				render()
			})
			const breakpointButton = element(ownerDocument, 'button', selected.breakpoint ? 'Desactivar punto de parada' : 'Activar punto de parada')
			breakpointButton.type = 'button'
			breakpointButton.setAttribute('aria-pressed', String(selected.breakpoint))
			breakpointButton.dataset.instanceId = selected.id
			breakpointButton.dataset.action = 'breakpoint'
			breakpointButton.addEventListener('click', () => {
				hook?.setBreakpoint(selected.id, !selected.breakpoint)
				render()
			})
			actions.append(highlightButton, breakpointButton)
			detailSection.append(actions, element(ownerDocument, 'h3', 'Props'), element(ownerDocument, 'pre', formatValue(selected.props)), element(ownerDocument, 'h3', 'Señales'), element(ownerDocument, 'pre', formatValue(selected.signals)))
			appendEditor(selected)
		} else {
			detailSection.append(element(ownerDocument, 'p', 'Selecciona una instancia para ver props y señales.'))
		}

		const recent = snapshot.events
			.filter((event) => (!signalFilter.checked || event.kind === 'signal') && (!activityFilter.checked || event.kind === 'navigation' || event.kind === 'data'))
			.slice(-30)
			.reverse()
		if (recent.length === 0) eventsList.append(element(ownerDocument, 'li', 'Sin eventos.', 'muted'))
		for (const event of recent) {
			const row = element(ownerDocument, 'li')
			const instance = byId.get(event.instanceId)
			const label = eventLabel(event)
			if (instance) {
				const button = element(ownerDocument, 'button', label, 'event-button')
				button.type = 'button'
				button.dataset.instanceId = instance.id
				button.dataset.action = 'event'
				button.addEventListener('click', () => {
					hook?.select(instance.id)
					showMobileView('detail')
					render()
				})
				row.append(button)
			} else {
				row.textContent = label
			}
			if (event.kind === 'signal' && event.write) {
				const write = element(ownerDocument, 'p', writeLabel(event.write), 'event-write')
				if (event.write.kind === 'assignment') write.append(element(ownerDocument, 'span', ': '), element(ownerDocument, 'code', event.write.expression))
				row.append(write)
			}
			if (event.kind === 'signal' && event.reads?.length) {
				const sites = element(ownerDocument, 'details', undefined, 'event-reads')
				sites.append(element(ownerDocument, 'summary', `${event.reads.length} lectura(s) que dependen de la señal`))
				const list = element(ownerDocument, 'ul')
				for (const read of event.reads) {
					const usage = element(ownerDocument, 'li')
					usage.append(element(ownerDocument, 'code', `${read.file}:${read.line}:${read.column}`), element(ownerDocument, 'span', ` ${readKindLabel(read)}: `), element(ownerDocument, 'code', read.expression))
					list.append(usage)
				}
				sites.append(list)
				row.append(sites)
			}
			eventsList.append(row)
		}
		restoreFocus(focusId, focusAction, focusSelection)
	}

	/** Editor JSON de las señales editables de la instancia seleccionada. */
	function appendEditor(selected: DevtoolsInstance): void {
		const names = Object.keys(selected.signals)
		if (editor.instanceId !== selected.id) {
			Object.assign(editor, { instanceId: selected.id, name: names[0] ?? '', text: '', dirty: false, message: '', state: '' })
		}
		if (!names.includes(editor.name)) {
			editor.name = names[0] ?? ''
			editor.dirty = false
		}
		if (names.length === 0) return
		const form = element(ownerDocument, 'form', undefined, 'editor')
		form.setAttribute('aria-label', 'Editar señal')
		form.noValidate = true
		const nameLabel = element(ownerDocument, 'label', 'Señal')
		const select = element(ownerDocument, 'select')
		select.id = 'meeko-devtools-edit-name'
		nameLabel.htmlFor = select.id
		select.dataset.instanceId = selected.id
		select.dataset.action = 'edit-name'
		for (const name of names) {
			const option = element(ownerDocument, 'option', name)
			option.value = name
			select.append(option)
		}
		select.value = editor.name
		const valueLabel = element(ownerDocument, 'label', 'Nuevo valor (JSON)')
		const textarea = element(ownerDocument, 'textarea')
		textarea.id = 'meeko-devtools-edit-value'
		valueLabel.htmlFor = textarea.id
		textarea.spellcheck = false
		textarea.dataset.instanceId = selected.id
		textarea.dataset.action = 'edit-value'
		if (!editor.dirty) editor.text = JSON.stringify(selected.signals[editor.name], null, 2) ?? 'null'
		textarea.value = editor.text
		const hint = element(ownerDocument, 'p', 'Sustituye el valor completo de la señal. El valor mostrado es una copia acotada.', 'muted')
		const apply = element(ownerDocument, 'button', 'Aplicar')
		apply.type = 'submit'
		apply.dataset.instanceId = selected.id
		apply.dataset.action = 'edit-apply'
		const message = element(ownerDocument, 'p', editor.message, 'editor-message')
		message.setAttribute('role', editor.state === 'error' ? 'alert' : 'status')
		if (editor.state) message.dataset.state = editor.state
		select.addEventListener('change', () => {
			Object.assign(editor, { name: select.value, dirty: false, message: '', state: '' })
			render()
		})
		textarea.addEventListener('input', () => {
			editor.text = textarea.value
			editor.dirty = true
		})
		form.addEventListener('submit', (event) => {
			event.preventDefault()
			applyEdit(selected.id)
		})
		form.append(element(ownerDocument, 'h3', 'Editar señal'), nameLabel, select, valueLabel, textarea, hint, apply, message)
		detailSection.append(form)
	}

	/** Descubre el hook al inicio, al recibir el evento de disponibilidad o al pulsar Actualizar. */
	function connect(): void {
		if (!mounted) return
		const next = (view as Window & { __MEEKO_DEVTOOLS__?: DevtoolsHook }).__MEEKO_DEVTOOLS__
		if (next !== hook) {
			unsubscribe?.()
			hook = next
			unsubscribe = hook?.subscribe(render)
		}
		render()
	}

	function unmount(): void {
		if (!mounted) return
		mounted = false
		unsubscribe?.()
		view.removeEventListener('meeko:devtools-ready', connect)
		view.removeEventListener('keydown', onShortcut)
		themeObserver?.disconnect()
		refreshButton.removeEventListener('click', connect)
		closeButton.removeEventListener('click', unmount)
		if (highlightedId) hook?.highlight(null)
		host.remove()
		hook = undefined
	}

	view.addEventListener('meeko:devtools-ready', connect)
	signalFilter.addEventListener('change', () => {
		if (signalFilter.checked) activityFilter.checked = false
		render()
	})
	activityFilter.addEventListener('change', () => {
		if (activityFilter.checked) signalFilter.checked = false
		render()
	})
	refreshButton.addEventListener('click', connect)
	closeButton.addEventListener('click', unmount)
	connect()
	return { refresh: connect, unmount }
}
