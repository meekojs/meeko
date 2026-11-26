import type { UIDefaults } from '@meekojs/ui'
import type { UIDateRangeIssue, UIDateRangePreset, UIDateRangeProps, UIDateRangeValue } from '@meekojs/ui/runtime'

import type { ComponentEmits, ComponentModels, ComponentProps } from '../../dist/app/components/DateRange.d.meeko.ts'

// The public type and the props of the compiled component accept the same thing.
const dateRange = (props: ComponentProps & UIDateRangeProps): void => void props

const yesterday: UIDateRangePreset = { label: 'Ayer', range: (today: string): UIDateRangeValue => ({ from: today, to: today }) }
dateRange({})
dateRange({ label: 'Periodo', fromName: 'desde', toName: 'hasta', form: 'filters', required: true, disabled: false })
dateRange({ ariaLabel: 'Periodo', min: '2026-01-01', max: '2026-12-31', maxDays: 366, today: '2026-11-24', presets: [yesterday] })
dateRange({ id: 'period', describedBy: 'period-hint', invalid: true, fromLabel: 'Inicio', toLabel: 'Fin', presets: [], class: 'mine', ui: { base: 'a', legend: 'b', presets: 'c', preset: 'd', fields: 'e', field: 'f', fieldLabel: 'g', input: 'h', error: 'i' } })
// The models also go by prop and event: `bind:from` and `on:update:from`.
dateRange({ from: '2026-11-01', to: '2026-11-24', onChange: (range) => void range.from })

// @ts-expect-error A legend and an aria-label at once: only one names the group.
dateRange({ label: 'Periodo', ariaLabel: 'Periodo' })
// @ts-expect-error A shortcut returns both dates.
dateRange({ presets: [{ label: 'Hoy', range: (today: string) => ({ from: today }) }] })
// @ts-expect-error The slots are those of the component.
dateRange({ ui: { button: 'x' } })
// @ts-expect-error maxDays is a number.
dateRange({ maxDays: '366' })

// `change` carries the range, and the models are two named strings.
type Equal<A, B> = (<T>() => T extends A ? 1 : 2) extends <T>() => T extends B ? 1 : 2 ? true : false
const change: Equal<ComponentEmits['change'], [range: UIDateRangeValue]> = true
const models: Equal<keyof ComponentModels, 'from' | 'to'> = true
const issue: UIDateRangeIssue = 'length'
const defaults: UIDefaults = { dateRange: { class: 'app-range', ui: { preset: 'app-preset' } } }
void [change, models, issue, defaults]
