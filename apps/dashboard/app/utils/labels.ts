import type { DivergenceState, DocsSite, JobKind, SourceKind } from '../../shared/schemas/dashboard'

/** Names of the webs, as their headers call them. */
export const siteLabels: Readonly<Record<DocsSite, string>> = { site: 'Framework', ui: 'UI', i18n: 'i18n' }

export const kindLabels: Readonly<Record<SourceKind, string>> = { guide: 'Guía', reference: 'Referencia', page: 'Página .meeko' }

/** What each divergence state means for the public web. */
export const stateLabels: Readonly<Record<DivergenceState, string>> = { git: 'Git', same: 'Igual a Git', edited: 'Editada', conflict: 'Conflicto', missing: 'Falta en Git' }

export const stateDescriptions: Readonly<Record<DivergenceState, string>> = {
	git: 'Sin revisión publicada: la web muestra el archivo de Git.',
	same: 'La revisión publicada coincide con Git.',
	edited: 'La revisión publicada difiere de Git, y Git no ha cambiado desde que se escribió.',
	conflict: 'La revisión publicada difiere y Git cambió después de escribirla.',
	missing: 'El archivo ya no existe en Git.',
}

/** Badge tone of each state: attention for the ones that need a decision. */
export const stateTones: Readonly<Record<DivergenceState, 'accent' | 'danger' | 'neutral'>> = { git: 'neutral', same: 'neutral', edited: 'accent', conflict: 'danger', missing: 'danger' }

export const jobLabels: Readonly<Record<JobKind, string>> = { import: 'Importación desde Git', publish: 'Publicación de snapshot', health: 'Comprobación de salud' }

export const states: readonly DivergenceState[] = ['git', 'same', 'edited', 'conflict', 'missing']
export const sites: readonly DocsSite[] = ['site', 'ui', 'i18n']
export const kinds: readonly SourceKind[] = ['guide', 'reference', 'page']
