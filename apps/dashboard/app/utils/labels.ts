import type { DivergenceState, DocsSite, SourceKind } from '../../shared/schemas/dashboard'

/** Names of the webs, as their headers call them: the same in every language. */
export const siteLabels: Readonly<Record<DocsSite, string>> = { site: 'Framework', ui: 'UI', i18n: 'i18n' }

/** Badge tone of each state: attention for the ones that need a decision. */
export const stateTones: Readonly<Record<DivergenceState, 'accent' | 'danger' | 'neutral'>> = { git: 'neutral', same: 'neutral', edited: 'accent', conflict: 'danger', missing: 'danger' }

// Their names and descriptions are the catalog keys `labels.state.<state>`, `labels.stateHelp.<state>`,
// `labels.kind.<kind>` and `labels.job.<kind>` of app/locales/<locale>/common.json.
export const states: readonly DivergenceState[] = ['git', 'same', 'edited', 'conflict', 'missing']
export const sites: readonly DocsSite[] = ['site', 'ui', 'i18n']
export const kinds: readonly SourceKind[] = ['guide', 'reference', 'page']
