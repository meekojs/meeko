import type { ResolvedLanguageServer } from './server-resolution'

import { t } from './l10n'

/** Comando que reinicia todos los servidores de lenguaje. */
export const restartCommand = 'meeko.restartLanguageServer'

/** Comando que muestra el canal de salida `Meeko`. */
export const showOutputCommand = 'meeko.showOutput'

/** Estado del servidor que atiende un documento. */
export interface ServerState {
	/** `failed` si no arrancó; `stopped` si arrancó y después se detuvo sin que nadie lo pidiera. */
	readonly state: 'starting' | 'running' | 'failed' | 'stopped'
	/** Servidor elegido para la carpeta. */
	readonly resolution: ResolvedLanguageServer
	/** Nombre de la carpeta, o `global` para los archivos fuera del workspace. */
	readonly folder: string
	/** Error del arranque, sólo en `failed`. */
	readonly error?: string
}

/** Lo que muestra el indicador de estado del lenguaje. */
export interface ServerStatus {
	readonly text: string
	readonly detail: string
	readonly severity: 'information' | 'error'
	readonly busy: boolean
	readonly command: { readonly command: string; readonly title: string }
}

/** «workspace 1.8.0» para el servidor del proyecto y «bundled» («incluido» en español) para el de la extensión. */
export function serverLabel(resolution: ResolvedLanguageServer): string {
	if (resolution.source === 'bundled') return t('bundled')
	return resolution.version ? `workspace ${resolution.version}` : 'workspace'
}

/**
 * Texto, detalle y comando del indicador para el servidor de un documento.
 *
 * @param state Estado del servidor, o `undefined` si ninguno atiende el documento.
 */
export function serverStatus(state: ServerState | undefined): ServerStatus {
	const restart = { command: restartCommand, title: t('Restart') }
	if (!state) return { text: t('Meeko: no server'), detail: t('No language server handles this file'), severity: 'information', busy: false, command: restart }
	const label = serverLabel(state.resolution)
	if (state.state === 'stopped') {
		// It did start: the click brings it back, and the output is one command away.
		return { text: `Meeko: error (${label})`, detail: t('The language server for "{0}" stopped unexpectedly', state.folder), severity: 'error', busy: false, command: restart }
	}
	if (state.state === 'failed') {
		return {
			text: `Meeko: error (${label})`,
			detail: state.error ? t('The language server for "{0}" failed to start: {1}', state.folder, state.error) : t('The language server for "{0}" failed to start', state.folder),
			severity: 'error',
			busy: false,
			command: { command: showOutputCommand, title: t('Show Output') },
		}
	}
	return {
		text: `Meeko: ${label}`,
		detail: state.resolution.reason ?? t('@meekojs/meeko server of the "{0}" project', state.folder),
		severity: 'information',
		busy: state.state === 'starting',
		command: restart,
	}
}
